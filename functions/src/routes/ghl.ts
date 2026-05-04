import { Router } from "express";
import { GoogleGenAI } from "@google/genai";
import { GHLError } from "@gohighlevel/api-client";
import {
  formatGhlUserFacingError,
  getDefaultGhlUserId,
  getGhlClientForLocation,
  ghlerrMessage,
  hasAnyGhlTokenSource,
  readGhlLocationTokensMap,
} from "../services/ghlClient.js";

const router = Router();
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

function privateTokenFromBody(body: { privateIntegrationToken?: unknown } | undefined): string | undefined {
  const t = body?.privateIntegrationToken;
  return typeof t === "string" && t.trim() ? t.trim() : undefined;
}

/** Prefer JSON inside ```json … ```; otherwise use full text. */
function stripMarkdownCodeFences(text: string): string {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence?.[1]) return fence[1].trim();
  return text.trim();
}

function normalizeAiIsoTimestamp(raw: string): string {
  let s = raw.trim().replace(/^["'“”‘’]+|["'“”‘’]+$/g, "");
  s = s.replace(/\u00a0/g, " ");
  return s;
}

/**
 * If the model returns a wall-clock time that parses as already past (timezone confusion) or barely behind "now",
 * advance in 1-hour steps until we're safely in the future and still inside the HighLevel fetch window.
 */
function bumpInstantToFutureInWindow(
  instantMs: number,
  windowEndMs: number,
  windowDays: number
): number | null {
  const minLeadMs = 5 * 60 * 1000;
  const minTs = Date.now() + minLeadMs;
  const maxSteps = Math.max(72, windowDays * 24 + 48);
  let x = instantMs;
  for (let i = 0; i < maxSteps && x < minTs; i++) {
    x += 60 * 60 * 1000;
  }
  if (x < minTs) return null;
  if (x > windowEndMs) return null;
  return x;
}

function postsFromListResponse(data: unknown): Record<string, unknown>[] {
  const d = data as Record<string, unknown> | null | undefined;
  const results = (d?.results ?? d) as Record<string, unknown> | undefined;
  const posts = results?.posts;
  if (Array.isArray(posts)) return posts as Record<string, unknown>[];
  return [];
}

function extractSlotIso(p: Record<string, unknown>): string | null {
  const raw =
    (typeof p.scheduleDate === "string" && p.scheduleDate) ||
    (typeof p.displayDate === "string" && p.displayDate) ||
    (typeof p.publishedAt === "string" && p.publishedAt) ||
    null;
  if (!raw) return null;
  const t = Date.parse(raw);
  if (Number.isNaN(t)) return null;
  return new Date(t).toISOString();
}

router.get("/status", (_req, res) => {
  const configured = hasAnyGhlTokenSource();
  const locationTokenEntries = Object.keys(readGhlLocationTokensMap()).length;
  const hasEnvUserId = !!getDefaultGhlUserId();
  let message: string;
  if (!configured) {
    message =
      "Add GHL_PRIVATE_INTEGRATION_TOKEN (fallback), and/or GHL_LOCATION_TOKENS as a JSON map of locationId → token, and/or save a per-client token in Accounts.";
  } else if (locationTokenEntries > 0 && !process.env.GHL_PRIVATE_INTEGRATION_TOKEN?.trim() && !process.env.GHL_ACCESS_TOKEN?.trim()) {
    message = `Using GHL_LOCATION_TOKENS for ${locationTokenEntries} location(s). Requests still need a matching location id (and optional per-account token in CRM).`;
    if (!hasEnvUserId) message += " Set default user id in Settings or GHL_USER_ID.";
  } else {
    message = hasEnvUserId
      ? "Ready to call HighLevel (default user id is set on the server)."
      : "API token OK. Set a default HighLevel user id in Settings (team-wide), or set GHL_USER_ID in the server environment.";
  }
  res.json({
    configured,
    hasEnvUserId,
    locationTokenMapSize: locationTokenEntries,
    message,
  });
});

function usersArrayFromResponse(data: unknown): unknown[] {
  const d = data as Record<string, unknown> | null | undefined;
  if (!d) return [];
  if (Array.isArray(d.users)) return d.users;
  const r = d.results as Record<string, unknown> | undefined;
  if (r && Array.isArray(r.users)) return r.users;
  return [];
}

/** Pull IANA timezone from HighLevel getLocation payloads (shape varies by API version). */
function extractTimezoneFromLocationPayload(data: unknown): string | null {
  const tryObj = (o: unknown): string | null => {
    if (!o || typeof o !== "object") return null;
    const r = o as Record<string, unknown>;
    const tz = r.timezone ?? r.timeZone ?? r.time_zone;
    if (typeof tz === "string" && tz.trim()) return tz.trim();
    for (const key of ["location", "data", "result", "meta"]) {
      if (r[key] != null) {
        const inner = tryObj(r[key]);
        if (inner) return inner;
      }
    }
    return null;
  };
  return tryObj(data);
}

function extractLocationDisplayName(data: unknown): string | null {
  const tryObj = (o: unknown): string | null => {
    if (!o || typeof o !== "object") return null;
    const r = o as Record<string, unknown>;
    const name = r.name ?? r.businessName ?? r.title;
    if (typeof name === "string" && name.trim()) return name.trim();
    for (const key of ["location", "data", "result"]) {
      if (r[key] != null) {
        const inner = tryObj(r[key]);
        if (inner) return inner;
      }
    }
    return null;
  };
  return tryObj(data);
}

function normalizeGhlUsers(raw: unknown): { id: string; name: string; email?: string }[] {
  const list = Array.isArray(raw) ? raw : [];
  return list
    .map((u) => {
      const o = u as Record<string, unknown>;
      const id = String(o.id ?? "").trim();
      if (!id) return null;
      const first = typeof o.firstName === "string" ? o.firstName : "";
      const last = typeof o.lastName === "string" ? o.lastName : "";
      const name =
        (typeof o.name === "string" && o.name.trim()) ||
        `${first} ${last}`.trim() ||
        id;
      const email = typeof o.email === "string" ? o.email : undefined;
      return { id, name, email };
    })
    .filter(Boolean) as { id: string; name: string; email?: string }[];
}

/** List users for a sub-account: works with a location token (preferred) or agency token + company id. */
router.post("/location-users", async (req, res) => {
  try {
    const { locationId, companyId } = req.body as { locationId?: string; companyId?: string };
    if (!locationId?.trim()) {
      return res.status(400).json({ error: "locationId is required." });
    }
    const loc = locationId.trim();
    const ghl = getGhlClientForLocation(loc, privateTokenFromBody(req.body));
    const cid = (companyId?.trim() || process.env.GHL_COMPANY_ID?.trim()) ?? "";

    try {
      const byLoc = await ghl.users.getUserByLocation({ locationId: loc });
      const users = normalizeGhlUsers(usersArrayFromResponse(byLoc));
      if (users.length > 0) {
        return res.json({ source: "location", users });
      }
    } catch {
      /* try agency search */
    }

    if (!cid) {
      return res.status(422).json({
        error:
          "No users returned for this location with your token. Use a sub-account (location) Private Integration token, or add your HighLevel Company ID in Settings (or GHL_COMPANY_ID in env) and try again so we can search users at that location.",
      });
    }

    const search = await ghl.users.searchUsers(
      { companyId: cid, locationId: loc, limit: "100", skip: "0" },
      { preferredTokenType: "company" }
    );
    const users = normalizeGhlUsers(usersArrayFromResponse(search));
    res.json({ source: "agency_search", users });
  } catch (err: unknown) {
    console.error("GHL location-users:", ghlerrMessage(err));
    const status = err instanceof GHLError ? err.statusCode || 502 : (err as { status?: number })?.status || 500;
    res.status(typeof status === "number" ? status : 500).json({ error: formatGhlUserFacingError(err) });
  }
});

/** Sub-account timezone + display name for scheduler UI (from HighLevel). */
router.post("/location-meta", async (req, res) => {
  try {
    const { locationId } = req.body as { locationId?: string };
    if (!locationId?.trim()) {
      return res.status(400).json({ error: "locationId is required." });
    }
    const loc = locationId.trim();
    const ghl = getGhlClientForLocation(loc, privateTokenFromBody(req.body));
    const data = await ghl.locations.getLocation({ locationId: loc });
    const timezone = extractTimezoneFromLocationPayload(data) || "America/New_York";
    const name = extractLocationDisplayName(data);
    res.json({ timezone, name });
  } catch (err: unknown) {
    console.error("GHL location-meta:", ghlerrMessage(err));
    const status = err instanceof GHLError ? err.statusCode || 502 : (err as { status?: number })?.status || 500;
    res.status(typeof status === "number" ? status : 500).json({ error: formatGhlUserFacingError(err) });
  }
});

router.post("/accounts", async (req, res) => {
  try {
    const { locationId } = req.body as { locationId?: string };
    if (!locationId?.trim()) {
      return res.status(400).json({ error: "locationId is required." });
    }
    const loc = locationId.trim();
    const ghl = getGhlClientForLocation(loc, privateTokenFromBody(req.body));
    const data = await ghl.socialMediaPosting.getAccount({ locationId: loc });
    res.json(data);
  } catch (err: unknown) {
    console.error("GHL getAccount:", ghlerrMessage(err));
    const status = err instanceof GHLError ? err.statusCode || 502 : (err as { status?: number })?.status || 500;
    res.status(typeof status === "number" ? status : 500).json({ error: formatGhlUserFacingError(err) });
  }
});

router.post("/posts/list", async (req, res) => {
  try {
    const { locationId, fromDate, toDate, skip, limit } = req.body as {
      locationId?: string;
      fromDate?: string;
      toDate?: string;
      skip?: string;
      limit?: string;
    };
    if (!locationId?.trim()) {
      return res.status(400).json({ error: "locationId is required." });
    }
    const loc = locationId.trim();
    const end = toDate ? new Date(toDate) : new Date();
    const start = fromDate ? new Date(fromDate) : new Date(end.getTime() - 14 * 24 * 60 * 60 * 1000);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      return res.status(400).json({ error: "Invalid fromDate or toDate." });
    }

    const ghl = getGhlClientForLocation(loc, privateTokenFromBody(req.body));
    const body = {
      skip: skip ?? "0",
      limit: limit ?? "100",
      fromDate: start.toISOString(),
      toDate: end.toISOString(),
      includeUsers: "true",
    };
    const data = await ghl.socialMediaPosting.getPosts({ locationId: loc }, body);
    const rawPosts = postsFromListResponse(data);
    const slots = rawPosts
      .map((p) => ({
        summary: typeof p.summary === "string" ? p.summary : undefined,
        scheduleDate: extractSlotIso(p),
        platform: typeof p.platform === "string" ? p.platform : undefined,
        status: p.status,
      }))
      .filter((s) => s.scheduleDate);

    res.json({ raw: data, slots });
  } catch (err: unknown) {
    console.error("GHL getPosts:", ghlerrMessage(err));
    const status = err instanceof GHLError ? err.statusCode || 502 : (err as { status?: number })?.status || 500;
    res.status(typeof status === "number" ? status : 500).json({ error: formatGhlUserFacingError(err) });
  }
});

interface SuggestBody {
  locationId?: string;
  caption?: string;
  timezone?: string;
  minGapHours?: number;
  windowDays?: number;
  preferences?: string;
  privateIntegrationToken?: string;
}

router.post("/suggest-schedule", async (req, res) => {
  try {
    if (!process.env.GEMINI_API_KEY) {
      return res.status(503).json({ error: "GEMINI_API_KEY is not configured on the server." });
    }

    const {
      locationId,
      caption,
      timezone = "America/New_York",
      minGapHours = 4,
      windowDays = 14,
      preferences,
      privateIntegrationToken,
    } = req.body as SuggestBody;

    if (!locationId?.trim()) {
      return res.status(400).json({ error: "locationId is required." });
    }
    if (!caption?.trim()) {
      return res.status(400).json({ error: "caption is required." });
    }

    const loc = locationId.trim();
    const ghl = getGhlClientForLocation(loc, privateIntegrationToken);
    const end = new Date();
    end.setDate(end.getDate() + Math.max(1, Math.min(60, windowDays)));
    const start = new Date();

    const listBody = {
      skip: "0",
      limit: "100",
      fromDate: start.toISOString(),
      toDate: end.toISOString(),
      includeUsers: "true",
    };
    const listData = await ghl.socialMediaPosting.getPosts({ locationId: loc }, listBody);
    const rawPosts = postsFromListResponse(listData);
    const existingSlots = rawPosts
      .map((p) => ({
        summary: typeof p.summary === "string" ? p.summary.slice(0, 200) : "",
        time: extractSlotIso(p),
        platform: typeof p.platform === "string" ? p.platform : "",
      }))
      .filter((s) => s.time);

    const nowUtcIso = new Date().toISOString();
    const windowEndMs = end.getTime();

    const prompt = `You are scheduling social media posts for a marketing agency using Go High Level.

CRITICAL — use these absolute instants (do not choose a time at or before NOW_UTC):
- NOW_UTC (current instant, UTC): ${nowUtcIso}
- WINDOW_END_UTC (latest allowed instant for this request): ${end.toISOString()}
- Target time zone for human-facing scheduling intent: ${timezone}

Minimum spacing from any existing scheduled time: ${minGapHours} hours (avoid closer spacing unless unavoidable).

Existing scheduled/relevant slots in the window (ISO times):
${JSON.stringify(existingSlots, null, 2)}

New post caption (for context only — do not rewrite unless needed for scheduling logic):
"""
${caption.trim().slice(0, 8000)}
"""

${preferences?.trim() ? `Extra scheduling preferences from the user:\n${preferences.trim()}\n` : ""}

Pick ONE best date/time for this new post strictly AFTER NOW_UTC and before WINDOW_END_UTC, interpreted in ${timezone} for business hours / preferences, then express it as a single ISO-8601 instant.

You MUST set scheduledAt to a full ISO-8601 instant with explicit UTC offset or Z (examples: 2026-04-08T17:30:00.000Z or 2026-04-08T13:30:00-04:00). Do not return a bare local string without offset.

Return ONLY valid JSON (no markdown code fences) in this exact shape:
{"scheduledAt":"<ISO-8601 with Z or numeric offset>","reason":"<one short sentence>"}`;

    const response = await ai.models.generateContent({
      model: "gemini-2.0-flash",
      contents: prompt,
    });

    const text = stripMarkdownCodeFences(response.text ?? "");
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    let scheduledAt = "";
    let reason = "";
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]) as { scheduledAt?: string; reason?: string };
        if (parsed.scheduledAt) scheduledAt = normalizeAiIsoTimestamp(parsed.scheduledAt);
        if (parsed.reason) reason = String(parsed.reason).trim();
      } catch {
        /* fall through */
      }
    }

    if (!scheduledAt) {
      return res.status(422).json({
        error: "Could not parse AI scheduling response. Try again.",
        raw: (response.text ?? "").slice(0, 2000),
        existingSlots,
      });
    }

    let proposedMs = Date.parse(scheduledAt);
    if (Number.isNaN(proposedMs)) {
      return res.status(422).json({
        error: "AI returned a scheduledAt string that is not a valid date. Try again.",
        scheduledAt,
        existingSlots,
      });
    }

    /* Any instant not strictly after "now" is treated as past (fixes TZ-naive ISO and model clock drift). */
    if (proposedMs <= Date.now()) {
      const bumped = bumpInstantToFutureInWindow(proposedMs, windowEndMs, windowDays);
      if (bumped === null) {
        return res.status(422).json({
          error:
            "AI chose a time in the past (often a timezone/format issue). Try again, or set the time manually in AI Scheduler.",
          scheduledAt,
          existingSlots,
        });
      }
      proposedMs = bumped;
      reason = reason ? `${reason} (Adjusted forward to stay in the future.)` : "Adjusted forward to stay in the future.";
    }

    if (proposedMs > windowEndMs) {
      proposedMs = Math.min(proposedMs, windowEndMs - 60_000);
      if (proposedMs < Date.now() + 60_000) {
        return res.status(422).json({
          error: "AI chose a time outside the scheduling window. Try again or increase Window (days).",
          scheduledAt,
          existingSlots,
        });
      }
      reason = reason ? `${reason} (Clamped to scheduling window.)` : "Clamped to scheduling window.";
    }
    const existingMs = existingSlots
      .map((s) => Date.parse(s.time!))
      .filter((n) => !Number.isNaN(n));
    const minMs = minGapHours * 60 * 60 * 1000;
    let t = proposedMs;
    let guard = 0;
    while (guard++ < 50) {
      let conflict = false;
      for (const u of existingMs) {
        if (Math.abs(t - u) < minMs) {
          t = u + minMs;
          conflict = true;
        }
      }
      if (!conflict) break;
    }
    if (t > windowEndMs) {
      return res.status(422).json({
        error:
          "No slot fits in the scheduling window after spacing around existing posts. Increase Window (days), lower Min gap, or pick manual time.",
        existingSlots,
      });
    }
    const adjusted = new Date(t).toISOString();

    res.json({
      scheduledAt: adjusted,
      reason,
      existingSlots,
      minGapHours,
      timezone,
    });
  } catch (err: unknown) {
    console.error("GHL suggest-schedule:", ghlerrMessage(err));
    const status = err instanceof GHLError ? err.statusCode || 502 : (err as { status?: number })?.status || 500;
    res.status(typeof status === "number" ? status : 500).json({ error: formatGhlUserFacingError(err) });
  }
});

router.post("/schedule", async (req, res) => {
  try {
    const {
      locationId,
      caption,
      accountIds,
      scheduleDate,
      mediaUrls,
      userId: bodyUserId,
    } = req.body as {
      locationId?: string;
      caption?: string;
      accountIds?: string[];
      scheduleDate?: string;
      mediaUrls?: string[];
      userId?: string;
      privateIntegrationToken?: string;
    };

    if (!locationId?.trim()) {
      return res.status(400).json({ error: "locationId is required." });
    }
    if (!caption?.trim()) {
      return res.status(400).json({ error: "caption is required." });
    }
    if (!Array.isArray(accountIds) || accountIds.length === 0) {
      return res.status(400).json({ error: "accountIds must be a non-empty array of HighLevel social account ids." });
    }
    if (!scheduleDate?.trim()) {
      return res.status(400).json({ error: "scheduleDate is required (ISO-8601)." });
    }

    const userId = bodyUserId?.trim() || getDefaultGhlUserId();
    if (!userId) {
      return res.status(400).json({
        error: "Missing GHL user id. Set GHL_USER_ID in the server environment or pass userId in the request.",
      });
    }

    const loc = locationId.trim();
    const ghl = getGhlClientForLocation(loc, privateTokenFromBody(req.body));
    const media =
      Array.isArray(mediaUrls) && mediaUrls.length > 0
        ? mediaUrls.filter((u) => typeof u === "string" && u.trim()).map((url) => ({ url: url.trim() }))
        : undefined;

    const data = await ghl.socialMediaPosting.createPost({ locationId: loc }, {
      accountIds,
      summary: caption.trim(),
      scheduleDate: new Date(scheduleDate).toISOString(),
      type: "post",
      userId,
      media,
    });
    res.status(201).json(data);
  } catch (err: unknown) {
    console.error("GHL schedule:", ghlerrMessage(err));
    const status = err instanceof GHLError ? err.statusCode || 502 : (err as { status?: number })?.status || 500;
    res.status(typeof status === "number" ? status : 500).json({ error: formatGhlUserFacingError(err) });
  }
});

export default router;
