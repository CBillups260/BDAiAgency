/**
 * Client Portal — a passcode-gated, mobile-first view of upcoming Social Planner
 * posts for one or more brands (e.g. a parent company that owns several
 * restaurants). Clients open /p/<slug>, enter a passcode, swipe through
 * Facebook / Instagram-style previews and can reword captions before they go
 * live. Edits are written straight back to HighLevel.
 *
 * Routes:
 *   Public (no Firebase auth — see OPEN_PATHS in app.ts):
 *     GET  /api/portal/public/:slug            portal name (for the passcode screen)
 *     POST /api/portal/public/:slug/auth       { passcode } → { token }
 *     GET  /api/portal/public/:slug/brands     brands in this portal (portal token)
 *     GET  /api/portal/public/:slug/posts      upcoming posts for all brands (portal token)
 *     PUT  /api/portal/public/:slug/posts/:id  { brandId, summary } → edit caption (portal token)
 *   Admin (Firebase auth + team_members role = admin):
 *     GET    /api/portal/admin                 list portals
 *     POST   /api/portal/admin                 create / update a portal
 *     DELETE /api/portal/admin/:slug           delete a portal
 *     GET    /api/portal/admin/:slug/edits     recent client edits
 */
import { Router, type Request, type Response, type NextFunction } from "express";
import crypto from "node:crypto";
import { GHLError } from "@gohighlevel/api-client";
import { db } from "../lib/firebase-admin.js";
import type { AuthedRequest } from "../lib/auth.js";
import {
  formatGhlUserFacingError,
  getDefaultGhlUserId,
  getGhlClientForLocation,
  ghlerrMessage,
} from "../services/ghlClient.js";

const router = Router();

const PORTALS = "client_portals";
const EDIT_LOG = "portal_edit_log";
const ACCOUNTS = "accounts";
const TEAM_MEMBERS = "team_members";
const BUSINESS_SETTINGS = "business_settings";

/** Portal sessions last this long before the passcode is asked again. */
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** Upcoming window shown in the portal. */
const DEFAULT_WINDOW_DAYS = 31;
/** Statuses that count as "not live yet" and are therefore editable. */
const EDITABLE_STATUSES = new Set(["scheduled", "in_review", "pending", "draft", "notification_sent"]);

// ─── Types ───────────────────────────────────────────────────

interface PortalDoc {
  slug: string;
  name: string;
  passcodeHash: string;
  passcodeSalt: string;
  sessionSecret: string;
  accountIds: string[];
  active: boolean;
  createdAt?: FirebaseFirestore.Timestamp;
  updatedAt?: FirebaseFirestore.Timestamp;
  createdBy?: string | null;
}

interface Brand {
  id: string;
  name: string;
  logo: string | null;
  color: string | null;
  locationId: string;
  token: string | null;
  connected: boolean;
}

interface PortalAccount {
  id: string;
  name: string;
  platform: string | null;
  avatar: string | null;
}

interface PortalPost {
  id: string;
  brandId: string;
  brandName: string;
  locationId: string;
  summary: string;
  scheduleDate: string;
  status: string;
  type: string;
  media: { url: string; type: string | null; thumbnail: string | null }[];
  accountIds: string[];
  accounts: PortalAccount[];
  platforms: string[];
}

interface PortalRequest extends Request {
  portal?: PortalDoc;
}

// ─── Passcode + session helpers ──────────────────────────────

function hashPasscode(passcode: string, salt: string): string {
  return crypto.scryptSync(passcode.normalize("NFKC"), salt, 32).toString("hex");
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

function b64url(input: string | Buffer): string {
  return Buffer.from(input).toString("base64url");
}

function signSession(slug: string, secret: string): { token: string; exp: number } {
  const exp = Date.now() + SESSION_TTL_MS;
  const payload = b64url(JSON.stringify({ slug, exp }));
  const sig = crypto.createHmac("sha256", secret).update(payload).digest("base64url");
  return { token: `${payload}.${sig}`, exp };
}

function verifySession(token: string, portal: PortalDoc): boolean {
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return false;
  const expected = crypto.createHmac("sha256", portal.sessionSecret).update(payload).digest("base64url");
  if (!safeEqual(sig, expected)) return false;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { slug?: string; exp?: number };
    return parsed.slug === portal.slug && typeof parsed.exp === "number" && parsed.exp > Date.now();
  } catch {
    return false;
  }
}

/** Small in-memory brute-force guard: 8 bad passcodes per 15 minutes per IP+slug. */
const attempts = new Map<string, { count: number; resetAt: number }>();
const MAX_ATTEMPTS = 8;
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;

function attemptKey(req: Request, slug: string): string {
  const fwd = req.headers["x-forwarded-for"];
  const ip = (Array.isArray(fwd) ? fwd[0] : fwd?.split(",")[0])?.trim() || req.ip || "unknown";
  return `${slug}:${ip}`;
}

function tooManyAttempts(key: string): boolean {
  const now = Date.now();
  const rec = attempts.get(key);
  if (!rec || rec.resetAt < now) return false;
  return rec.count >= MAX_ATTEMPTS;
}

function recordFailedAttempt(key: string): void {
  const now = Date.now();
  const rec = attempts.get(key);
  if (!rec || rec.resetAt < now) {
    attempts.set(key, { count: 1, resetAt: now + ATTEMPT_WINDOW_MS });
  } else {
    rec.count += 1;
  }
}

function normalizeSlug(raw: string): string {
  return raw
    .toLowerCase()
    .trim()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

async function loadPortal(slug: string): Promise<PortalDoc | null> {
  const s = normalizeSlug(slug);
  if (!s) return null;
  const snap = await db.collection(PORTALS).doc(s).get();
  if (!snap.exists) return null;
  const d = snap.data() as Partial<PortalDoc>;
  return {
    slug: s,
    name: typeof d.name === "string" ? d.name : s,
    passcodeHash: String(d.passcodeHash ?? ""),
    passcodeSalt: String(d.passcodeSalt ?? ""),
    sessionSecret: String(d.sessionSecret ?? ""),
    accountIds: Array.isArray(d.accountIds) ? d.accountIds.filter((x): x is string => typeof x === "string") : [],
    active: d.active !== false,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
    createdBy: d.createdBy ?? null,
  };
}

/** Portal-session middleware for the public routes that need a passcode session. */
async function portalSession(req: PortalRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const portal = await loadPortal(String(req.params.slug ?? ""));
    if (!portal || !portal.active) {
      res.status(404).json({ error: "This portal link is no longer active." });
      return;
    }
    const header = req.headers.authorization || "";
    const bearer = header.match(/^Bearer (.+)$/i)?.[1];
    const token = bearer || (typeof req.headers["x-portal-token"] === "string" ? req.headers["x-portal-token"] : "");
    if (!token || !verifySession(token, portal)) {
      res.status(401).json({ error: "Please enter the passcode again." });
      return;
    }
    req.portal = portal;
    next();
  } catch (err) {
    next(err);
  }
}

// ─── Brand + GHL helpers ─────────────────────────────────────

function readString(o: Record<string, unknown> | null | undefined, ...keys: string[]): string {
  if (!o) return "";
  for (const k of keys) {
    const v = o[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

function accountLocationId(a: Record<string, unknown>): string {
  const top = readString(a, "ghlLocationId");
  if (top) return top;
  const meta = (a.metadata ?? null) as Record<string, unknown> | null;
  const ghl = (meta?.ghl ?? null) as Record<string, unknown> | null;
  return readString(ghl, "locationId") || readString(meta, "ghlLocationId");
}

function accountToken(a: Record<string, unknown>): string {
  const top = readString(a, "ghlPrivateIntegrationToken");
  if (top) return top;
  const meta = (a.metadata ?? null) as Record<string, unknown> | null;
  const ghl = (meta?.ghl ?? null) as Record<string, unknown> | null;
  return readString(ghl, "privateIntegrationToken");
}

async function loadBrands(portal: PortalDoc): Promise<Brand[]> {
  if (portal.accountIds.length === 0) return [];
  const snaps = await Promise.all(portal.accountIds.map((id) => db.collection(ACCOUNTS).doc(id).get()));
  const brands: Brand[] = [];
  for (const snap of snaps) {
    if (!snap.exists) continue;
    const a = snap.data() as Record<string, unknown>;
    const locationId = accountLocationId(a);
    const colors = Array.isArray(a.brandColors) ? (a.brandColors as unknown[]).filter((c): c is string => typeof c === "string") : [];
    brands.push({
      id: snap.id,
      name: readString(a, "name", "company") || "Brand",
      logo: readString(a, "primaryLogo", "logo", "simplisticLogo", "avatar") || null,
      color: colors[0] ?? null,
      locationId,
      token: accountToken(a) || null,
      connected: locationId.length > 0,
    });
  }
  return brands;
}

function publicBrand(b: Brand): Omit<Brand, "token" | "locationId"> {
  return { id: b.id, name: b.name, logo: b.logo, color: b.color, connected: b.connected };
}

/** Connected social accounts per location, cached briefly so a page load doesn't hammer HighLevel. */
const accountsCache = new Map<string, { at: number; accounts: PortalAccount[] }>();
const ACCOUNTS_TTL_MS = 5 * 60 * 1000;

function parseAccountsResponse(data: unknown): PortalAccount[] {
  const d = data as Record<string, unknown> | null | undefined;
  const results = (d?.results ?? d) as Record<string, unknown> | undefined;
  const raw = (results?.accounts ?? results?.data) as unknown;
  const list = Array.isArray(raw) ? raw : (raw as Record<string, unknown> | undefined)?.accounts;
  if (!Array.isArray(list)) return [];
  return list
    .map((item) => {
      const a = item as Record<string, unknown>;
      return {
        id: readString(a, "id", "_id"),
        name: readString(a, "name", "accountName") || "Connected account",
        platform: readString(a, "platform") || null,
        avatar: readString(a, "avatar", "profilePicture", "picture") || null,
      };
    })
    .filter((a) => a.id.length > 0);
}

async function loadAccountsForBrand(brand: Brand): Promise<PortalAccount[]> {
  const cached = accountsCache.get(brand.locationId);
  if (cached && Date.now() - cached.at < ACCOUNTS_TTL_MS) return cached.accounts;
  try {
    const ghl = getGhlClientForLocation(brand.locationId, brand.token);
    const data = await ghl.socialMediaPosting.getAccount({ locationId: brand.locationId });
    const accounts = parseAccountsResponse(data);
    accountsCache.set(brand.locationId, { at: Date.now(), accounts });
    return accounts;
  } catch (err) {
    console.warn(`[portal] accounts for ${brand.name}:`, ghlerrMessage(err));
    return cached?.accounts ?? [];
  }
}

function postsFromListResponse(data: unknown): Record<string, unknown>[] {
  const d = data as Record<string, unknown> | null | undefined;
  const results = (d?.results ?? d) as Record<string, unknown> | undefined;
  const posts = results?.posts;
  return Array.isArray(posts) ? (posts as Record<string, unknown>[]) : [];
}

function postFromGetResponse(data: unknown): Record<string, unknown> | null {
  const d = data as Record<string, unknown> | null | undefined;
  const results = (d?.results ?? d) as Record<string, unknown> | undefined;
  const post = (results?.post ?? results) as Record<string, unknown> | undefined;
  if (!post || typeof post !== "object") return null;
  return post;
}

function postIso(p: Record<string, unknown>): string | null {
  const raw = readString(p, "scheduleDate", "displayDate", "publishedAt");
  if (!raw) return null;
  const t = Date.parse(raw);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

function normalizePost(p: Record<string, unknown>, brand: Brand, accounts: PortalAccount[]): PortalPost | null {
  const id = readString(p, "_id", "id");
  const scheduleDate = postIso(p);
  if (!id || !scheduleDate) return null;
  const accountIds = Array.isArray(p.accountIds) ? (p.accountIds as unknown[]).filter((x): x is string => typeof x === "string") : [];
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const linked = accountIds.map((aid) => byId.get(aid)).filter((a): a is PortalAccount => Boolean(a));
  const platforms = Array.from(new Set(linked.map((a) => (a.platform || "").toLowerCase()).filter(Boolean)));
  const rawMedia = Array.isArray(p.media) ? (p.media as unknown[]) : [];
  const media = rawMedia
    .map((m) => {
      const mm = (typeof m === "string" ? { url: m } : m) as Record<string, unknown>;
      const url = readString(mm, "url");
      return url ? { url, type: readString(mm, "type") || null, thumbnail: readString(mm, "thumbnail", "defaultThumb") || null } : null;
    })
    .filter((m): m is PortalPost["media"][number] => m !== null);
  return {
    id,
    brandId: brand.id,
    brandName: brand.name,
    locationId: brand.locationId,
    summary: typeof p.summary === "string" ? p.summary : "",
    scheduleDate,
    status: readString(p, "status") || "scheduled",
    type: readString(p, "type") || "post",
    media,
    accountIds,
    accounts: linked,
    platforms,
  };
}

/**
 * Pull every upcoming post for one brand. Asks HighLevel for `type: "scheduled"`
 * first; if their validator rejects that filter we fall back to the unfiltered
 * list and keep only not-yet-live statuses ourselves.
 */
async function loadPostsForBrand(brand: Brand, fromIso: string, toIso: string): Promise<PortalPost[]> {
  const ghl = getGhlClientForLocation(brand.locationId, brand.token);
  const accounts = await loadAccountsForBrand(brand);
  const out: PortalPost[] = [];
  const limit = 100;
  let useTypeFilter = true;
  for (let page = 0; page < 5; page++) {
    const body: Record<string, string> = {
      skip: String(page * limit),
      limit: String(limit),
      fromDate: fromIso,
      toDate: toIso,
      includeUsers: "true",
    };
    if (useTypeFilter) body.type = "scheduled";
    let raw: Record<string, unknown>[];
    try {
      raw = postsFromListResponse(await ghl.socialMediaPosting.getPosts({ locationId: brand.locationId }, body as never));
    } catch (err) {
      const msg = ghlerrMessage(err);
      if (useTypeFilter && page === 0 && /type/i.test(msg) && (err as GHLError)?.statusCode !== 401) {
        useTypeFilter = false;
        page -= 1;
        continue;
      }
      throw err;
    }
    for (const p of raw) {
      const n = normalizePost(p, brand, accounts);
      if (!n) continue;
      if (!EDITABLE_STATUSES.has(n.status.toLowerCase())) continue;
      out.push(n);
    }
    if (raw.length < limit) break;
  }
  out.sort((a, b) => a.scheduleDate.localeCompare(b.scheduleDate));
  return out;
}

async function defaultGhlUserId(): Promise<string | undefined> {
  try {
    const snap = await db.collection(BUSINESS_SETTINGS).doc("default").get();
    const id = (snap.data() as Record<string, unknown> | undefined)?.ghlDefaultUserId;
    if (typeof id === "string" && id.trim()) return id.trim();
  } catch {
    /* fall through to env */
  }
  return getDefaultGhlUserId();
}

function ghlStatus(err: unknown): number {
  if (err instanceof GHLError) return err.statusCode || 502;
  const s = (err as { status?: number })?.status;
  return typeof s === "number" ? s : 500;
}

// ─── Public routes ───────────────────────────────────────────

router.get("/public/:slug", async (req, res, next) => {
  try {
    const portal = await loadPortal(String(req.params.slug ?? ""));
    if (!portal || !portal.active) {
      return res.status(404).json({ error: "This portal link is no longer active." });
    }
    res.json({ slug: portal.slug, name: portal.name, brandCount: portal.accountIds.length });
  } catch (err) {
    next(err);
  }
});

router.post("/public/:slug/auth", async (req, res, next) => {
  try {
    const portal = await loadPortal(String(req.params.slug ?? ""));
    if (!portal || !portal.active) {
      return res.status(404).json({ error: "This portal link is no longer active." });
    }
    const key = attemptKey(req, portal.slug);
    if (tooManyAttempts(key)) {
      return res.status(429).json({ error: "Too many attempts. Please wait 15 minutes and try again." });
    }
    const passcode = String((req.body as { passcode?: unknown })?.passcode ?? "").trim();
    if (!passcode) return res.status(400).json({ error: "Enter the passcode." });
    const ok = portal.passcodeHash && safeEqual(hashPasscode(passcode, portal.passcodeSalt), portal.passcodeHash);
    if (!ok) {
      recordFailedAttempt(key);
      return res.status(401).json({ error: "That passcode isn't right." });
    }
    attempts.delete(key);
    const session = signSession(portal.slug, portal.sessionSecret);
    res.json({ token: session.token, exp: session.exp, name: portal.name });
  } catch (err) {
    next(err);
  }
});

router.get("/public/:slug/brands", portalSession, async (req: PortalRequest, res, next) => {
  try {
    const brands = await loadBrands(req.portal!);
    res.json({ name: req.portal!.name, brands: brands.map(publicBrand) });
  } catch (err) {
    next(err);
  }
});

router.get("/public/:slug/posts", portalSession, async (req: PortalRequest, res, next) => {
  try {
    const portal = req.portal!;
    const brandFilter = typeof req.query.brand === "string" ? req.query.brand : "";
    const daysRaw = Number.parseInt(String(req.query.days ?? ""), 10);
    const days = Number.isFinite(daysRaw) && daysRaw > 0 ? Math.min(daysRaw, 92) : DEFAULT_WINDOW_DAYS;
    const from = new Date(Date.now() - 60 * 60 * 1000); // small grace so "just now" posts still show
    const to = new Date(Date.now() + days * 24 * 60 * 60 * 1000);

    const brands = (await loadBrands(portal)).filter((b) => (brandFilter ? b.id === brandFilter : true));
    const results = await Promise.all(
      brands.map(async (b) => {
        if (!b.connected) return { brand: b, posts: [] as PortalPost[], error: "Not connected to the scheduler yet." };
        try {
          return { brand: b, posts: await loadPostsForBrand(b, from.toISOString(), to.toISOString()), error: null };
        } catch (err) {
          console.error(`[portal] posts for ${b.name}:`, ghlerrMessage(err));
          return { brand: b, posts: [] as PortalPost[], error: formatGhlUserFacingError(err) };
        }
      })
    );

    res.json({
      name: portal.name,
      window: { from: from.toISOString(), to: to.toISOString(), days },
      brands: results.map((r) => ({ ...publicBrand(r.brand), postCount: r.posts.length, error: r.error })),
      posts: results.flatMap((r) => r.posts),
    });
  } catch (err) {
    next(err);
  }
});

router.put("/public/:slug/posts/:postId", portalSession, async (req: PortalRequest, res, next) => {
  try {
    const portal = req.portal!;
    const postId = String(req.params.postId ?? "").trim();
    const { brandId, summary } = (req.body ?? {}) as { brandId?: unknown; summary?: unknown };
    if (!postId) return res.status(400).json({ error: "Missing post id." });
    if (typeof brandId !== "string" || !brandId.trim()) return res.status(400).json({ error: "Missing brand." });
    if (typeof summary !== "string" || !summary.trim()) return res.status(400).json({ error: "The caption can't be empty." });
    if (summary.length > 5000) return res.status(400).json({ error: "That caption is too long." });

    const brand = (await loadBrands(portal)).find((b) => b.id === brandId.trim());
    if (!brand) return res.status(404).json({ error: "That brand isn't part of this portal." });
    if (!brand.connected) return res.status(409).json({ error: "This brand isn't connected to the scheduler yet." });

    const ghl = getGhlClientForLocation(brand.locationId, brand.token);
    const existing = postFromGetResponse(await ghl.socialMediaPosting.getPost({ locationId: brand.locationId, id: postId }));
    if (!existing) return res.status(404).json({ error: "That post no longer exists in the scheduler." });

    const status = readString(existing, "status").toLowerCase() || "scheduled";
    if (!EDITABLE_STATUSES.has(status)) {
      return res.status(409).json({ error: `This post is already ${status.replace(/_/g, " ")} and can't be edited here.` });
    }
    const when = postIso(existing);
    if (when && Date.parse(when) < Date.now() - 60_000) {
      return res.status(409).json({ error: "This post's publish time has already passed." });
    }

    const accountIds = Array.isArray(existing.accountIds)
      ? (existing.accountIds as unknown[]).filter((x): x is string => typeof x === "string")
      : [];
    const media = Array.isArray(existing.media)
      ? (existing.media as unknown[])
          .map((m) => {
            const mm = (typeof m === "string" ? { url: m } : m) as Record<string, unknown>;
            const url = readString(mm, "url");
            if (!url) return null;
            const out: Record<string, string> = { url };
            for (const k of ["type", "caption", "thumbnail", "defaultThumb", "id"]) {
              const v = readString(mm, k);
              if (v) out[k] = v;
            }
            return out;
          })
          .filter((m): m is Record<string, string> => m !== null)
      : [];

    const userId = readString(existing, "userId", "createdBy") || (await defaultGhlUserId());
    const body: Record<string, unknown> = {
      type: readString(existing, "type") || "post",
      accountIds,
      summary: summary.trim(),
      status: readString(existing, "status") || "scheduled",
    };
    if (media.length > 0) body.media = media;
    if (when) body.scheduleDate = when;
    if (userId) body.userId = userId;
    for (const k of ["followUpComment", "tags", "categoryId", "ogTagsDetails", "tiktokPostDetails", "gmbPostDetails"]) {
      const v = existing[k];
      if (v !== undefined && v !== null && v !== "") body[k] = v;
    }

    await ghl.socialMediaPosting.editPost({ locationId: brand.locationId, id: postId }, body as never);

    const before = typeof existing.summary === "string" ? existing.summary : "";
    await db.collection(EDIT_LOG).add({
      portalSlug: portal.slug,
      portalName: portal.name,
      brandId: brand.id,
      brandName: brand.name,
      locationId: brand.locationId,
      postId,
      scheduleDate: when ?? null,
      before,
      after: summary.trim(),
      editedAt: new Date(),
    });

    res.json({ ok: true, postId, summary: summary.trim() });
  } catch (err) {
    console.error("[portal] edit post:", ghlerrMessage(err));
    if (err instanceof GHLError || typeof (err as { status?: number })?.status === "number") {
      return res.status(ghlStatus(err)).json({ error: formatGhlUserFacingError(err) });
    }
    next(err);
  }
});

// ─── Admin routes ────────────────────────────────────────────

async function requireAdmin(req: AuthedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    if (process.env.ALLOW_UNAUTHENTICATED === "true" && !req.uid) {
      next();
      return;
    }
    if (!req.uid) {
      res.status(401).json({ error: "Sign in required." });
      return;
    }
    const snap = await db.collection(TEAM_MEMBERS).doc(req.uid).get();
    const role = (snap.data() as Record<string, unknown> | undefined)?.role;
    if (role !== "admin") {
      res.status(403).json({ error: "Only admins can manage client portals." });
      return;
    }
    next();
  } catch (err) {
    next(err);
  }
}

function adminView(p: PortalDoc, brands?: Brand[]) {
  return {
    slug: p.slug,
    name: p.name,
    accountIds: p.accountIds,
    active: p.active,
    createdAt: p.createdAt?.toDate?.().toISOString() ?? null,
    updatedAt: p.updatedAt?.toDate?.().toISOString() ?? null,
    brands: brands?.map((b) => ({ id: b.id, name: b.name, connected: b.connected, hasToken: Boolean(b.token) })),
  };
}

router.get("/admin", requireAdmin, async (_req, res, next) => {
  try {
    const snap = await db.collection(PORTALS).orderBy("name").get();
    const portals = await Promise.all(
      snap.docs.map(async (d) => {
        const p = (await loadPortal(d.id))!;
        return adminView(p, await loadBrands(p));
      })
    );
    res.json({ portals });
  } catch (err) {
    next(err);
  }
});

router.post("/admin", requireAdmin, async (req: AuthedRequest, res, next) => {
  try {
    const body = (req.body ?? {}) as { slug?: unknown; name?: unknown; accountIds?: unknown; passcode?: unknown; active?: unknown };
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) return res.status(400).json({ error: "Give the portal a name (e.g. the client's company)." });
    const slug = normalizeSlug(typeof body.slug === "string" && body.slug.trim() ? body.slug : name);
    if (!slug) return res.status(400).json({ error: "Could not build a link from that name." });
    const accountIds = Array.isArray(body.accountIds)
      ? Array.from(new Set((body.accountIds as unknown[]).filter((x): x is string => typeof x === "string" && x.trim().length > 0)))
      : [];
    const passcode = typeof body.passcode === "string" ? body.passcode.trim() : "";

    const ref = db.collection(PORTALS).doc(slug);
    const existing = await ref.get();
    if (!existing.exists && !passcode) return res.status(400).json({ error: "Set a passcode for the new portal." });
    if (passcode && passcode.length < 4) return res.status(400).json({ error: "Passcode must be at least 4 characters." });

    const update: Record<string, unknown> = {
      slug,
      name,
      accountIds,
      active: body.active === undefined ? (existing.data()?.active ?? true) : Boolean(body.active),
      updatedAt: new Date(),
    };
    if (!existing.exists) {
      update.createdAt = new Date();
      update.createdBy = req.uid ?? null;
    }
    if (passcode) {
      const salt = crypto.randomBytes(16).toString("hex");
      update.passcodeSalt = salt;
      update.passcodeHash = hashPasscode(passcode, salt);
      // New passcode → new session secret, so old phones must re-enter it.
      update.sessionSecret = crypto.randomBytes(32).toString("hex");
    }
    await ref.set(update, { merge: true });
    const p = (await loadPortal(slug))!;
    res.status(existing.exists ? 200 : 201).json({ portal: adminView(p, await loadBrands(p)) });
  } catch (err) {
    next(err);
  }
});

router.delete("/admin/:slug", requireAdmin, async (req, res, next) => {
  try {
    const slug = normalizeSlug(String(req.params.slug ?? ""));
    if (!slug) return res.status(400).json({ error: "Missing portal." });
    await db.collection(PORTALS).doc(slug).delete();
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.get("/admin/:slug/edits", requireAdmin, async (req, res, next) => {
  try {
    const slug = normalizeSlug(String(req.params.slug ?? ""));
    const snap = await db.collection(EDIT_LOG).where("portalSlug", "==", slug).orderBy("editedAt", "desc").limit(50).get();
    const edits = snap.docs.map((d) => {
      const x = d.data() as Record<string, unknown>;
      const at = x.editedAt as FirebaseFirestore.Timestamp | undefined;
      return { id: d.id, ...x, editedAt: at?.toDate?.().toISOString() ?? null };
    });
    res.json({ edits });
  } catch (err) {
    next(err);
  }
});

export default router;
