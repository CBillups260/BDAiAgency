/**
 * Client Portal — /p/:slug
 *
 * Mobile-first, light-themed page a client opens from a text or email link:
 *   1. Passcode (numeric keypad, remembered on the phone for 30 days)
 *   2. Brand picker (one tile per restaurant, with upcoming-post counts)
 *   3. Swipe deck of Facebook / Instagram-style previews — swipe left for the
 *      next post, right to go back, tap the card to reword the caption.
 *
 * Deliberately separate from the agency backend: its own light palette, no
 * Firebase login, and every control sized for a thumb.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { AnimatePresence, motion, useMotionValue, useTransform } from "motion/react";
import { ArrowLeftRight, Check, Hand, HelpCircle, MousePointerClick, Pencil, Pointer, X } from "lucide-react";
import {
  portalApi,
  PortalApiError,
  readPortalToken,
  writePortalToken,
  type PortalBrand,
  type PortalPost,
  type PortalPostsResponse,
} from "./portalApi";
import { Avatar, FacebookCard, InstagramCard, defaultPlatformFor, type PreviewPlatform } from "./PortalPreviews";

// ─── Theme ────────────────────────────────────────────────

const T = {
  bg: "#F4F5F7",
  card: "#FFFFFF",
  text: "#111827",
  muted: "#6B7280",
  faint: "#9CA3AF",
  line: "#E5E7EB",
  accent: "#111827",
  success: "#059669",
  danger: "#DC2626",
  font: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
};

const ALL = "__all__";

/** Waving hand (Lucide) — used on both welcomes. */
function WavingHand({ size = 22, color = "#F59E0B" }: { size?: number; color?: string }) {
  return (
    <motion.span
      aria-hidden
      animate={{ rotate: [0, 18, -8, 18, -4, 0] }}
      transition={{ repeat: Infinity, repeatDelay: 1.6, duration: 1.1, ease: "easeInOut" }}
      style={{ display: "inline-flex", transformOrigin: "70% 80%", verticalAlign: "middle" }}
    >
      <Hand size={size} color={color} strokeWidth={2.2} />
    </motion.span>
  );
}

/** Hand sliding left/right to say "swipe". */
function SwipeHint({ size = 40, color = "#fff" }: { size?: number; color?: string }) {
  return (
    <span aria-hidden style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      <motion.span animate={{ opacity: [0.35, 1, 0.35] }} transition={{ repeat: Infinity, duration: 2.2 }} style={{ display: "inline-flex" }}>
        <ArrowLeftRight size={size * 0.5} color={color} strokeWidth={2.2} />
      </motion.span>
      <motion.span
        animate={{ x: [26, -26, 26], rotate: [6, -6, 6] }}
        transition={{ repeat: Infinity, duration: 2.2, ease: "easeInOut" }}
        style={{ display: "inline-flex" }}
      >
        <Hand size={size} color={color} strokeWidth={2} />
      </motion.span>
    </span>
  );
}

/** Pointer pressing down to say "tap". */
function TapHint({ size = 40, color = "#fff" }: { size?: number; color?: string }) {
  return (
    <motion.span
      aria-hidden
      animate={{ scale: [1, 0.82, 1], y: [0, 4, 0] }}
      transition={{ repeat: Infinity, duration: 1.5, ease: "easeInOut" }}
      style={{ display: "inline-flex" }}
    >
      <MousePointerClick size={size} color={color} strokeWidth={2} />
    </motion.span>
  );
}

/** Tiny per-phone flags (welcome card dismissed, coach marks seen). */
function flagKey(slug: string, name: string) {
  return `bdai:portal:${slug}:${name}`;
}
function readFlag(slug: string, name: string): boolean {
  try {
    return localStorage.getItem(flagKey(slug, name)) === "1";
  } catch {
    return false;
  }
}
function writeFlag(slug: string, name: string, on: boolean) {
  try {
    if (on) localStorage.setItem(flagKey(slug, name), "1");
    else localStorage.removeItem(flagKey(slug, name));
  } catch {
    /* ignore */
  }
}

function fmtWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(d);
}

function fmtDay(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const tomorrow = new Date(today.getTime() + 86400e3);
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (same(d, today)) return "Today";
  if (same(d, tomorrow)) return "Tomorrow";
  return new Intl.DateTimeFormat(undefined, { weekday: "long", month: "short", day: "numeric" }).format(d);
}

function fmtTime(iso: string): string {
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(iso));
}

function PlatformIcon({ platform, size = 14 }: { platform: string; size?: number }) {
  const p = platform.toLowerCase();
  if (p.includes("instagram")) {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="2" width="20" height="20" rx="5" /><circle cx="12" cy="12" r="4" /><circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none" /></svg>
    );
  }
  if (p.includes("facebook")) {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor"><path d="M14 8h3V4h-3c-2.8 0-5 2.2-5 5v2H6v4h3v9h4v-9h3l1-4h-4V9c0-.6.4-1 1-1z" /></svg>
    );
  }
  return <span style={{ fontSize: size - 3, textTransform: "capitalize" }}>{p.slice(0, 2)}</span>;
}

// ─── Shell ────────────────────────────────────────────────

export default function ClientPortal() {
  const { slug: rawSlug } = useParams<{ slug: string }>();
  const slug = (rawSlug || "").toLowerCase();

  const [portalName, setPortalName] = useState<string>("");
  const [notFound, setNotFound] = useState(false);
  const [authed, setAuthed] = useState<boolean>(() => Boolean(readPortalToken(slug)));
  const [data, setData] = useState<PortalPostsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [brandId, setBrandId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // Light chrome for the whole document while the portal is mounted.
  useEffect(() => {
    const prevBodyBg = document.body.style.backgroundColor;
    const prevBodyColor = document.body.style.color;
    const prevTitle = document.title;
    document.body.style.backgroundColor = T.bg;
    document.body.style.color = T.text;
    let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    const prevMeta = meta?.getAttribute("content") ?? null;
    if (!meta) {
      meta = document.createElement("meta");
      meta.name = "theme-color";
      document.head.appendChild(meta);
    }
    meta.setAttribute("content", T.bg);
    const status = document.querySelector<HTMLMetaElement>('meta[name="apple-mobile-web-app-status-bar-style"]');
    const prevStatus = status?.getAttribute("content") ?? null;
    status?.setAttribute("content", "default");
    return () => {
      document.body.style.backgroundColor = prevBodyBg;
      document.body.style.color = prevBodyColor;
      document.title = prevTitle;
      if (prevMeta !== null) meta?.setAttribute("content", prevMeta);
      if (prevStatus !== null) status?.setAttribute("content", prevStatus);
    };
  }, []);

  useEffect(() => {
    document.title = portalName ? `${portalName} · Upcoming posts` : "Upcoming posts";
  }, [portalName]);

  useEffect(() => {
    if (!slug) return;
    portalApi
      .meta(slug)
      .then((m) => setPortalName(m.name))
      .catch((e: unknown) => {
        if (e instanceof PortalApiError && e.status === 404) setNotFound(true);
      });
  }, [slug]);

  const load = useCallback(async () => {
    if (!slug) return;
    setLoading(true);
    setLoadError(null);
    try {
      const d = await portalApi.posts(slug);
      setData(d);
      setPortalName(d.name);
    } catch (e: unknown) {
      if (e instanceof PortalApiError && e.status === 401) {
        writePortalToken(slug, null);
        setAuthed(false);
        setData(null);
      } else {
        setLoadError(e instanceof Error ? e.message : "Couldn't load posts.");
      }
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    if (authed) void load();
  }, [authed, load]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  const updatePost = useCallback((postId: string, summary: string) => {
    setData((d) => (d ? { ...d, posts: d.posts.map((p) => (p.id === postId ? { ...p, summary } : p)) } : d));
  }, []);

  const signOut = () => {
    writePortalToken(slug, null);
    setAuthed(false);
    setData(null);
    setBrandId(null);
  };

  let body: React.ReactNode;
  if (notFound) {
    body = <Centered title="This link isn't active" sub="Ask your agency contact for a fresh link." />;
  } else if (!authed) {
    body = (
      <PasscodeScreen
        name={portalName}
        onSubmit={async (code) => {
          const r = await portalApi.auth(slug, code);
          writePortalToken(slug, r.token);
          setPortalName(r.name);
          setAuthed(true);
        }}
      />
    );
  } else if (brandId && data) {
    const brand = brandId === ALL ? null : data.brands.find((b) => b.id === brandId) ?? null;
    const posts = data.posts.filter((p) => brandId === ALL || p.brandId === brandId);
    body = (
      <Deck
        key={brandId}
        slug={slug}
        title={brand?.name ?? "All brands"}
        brand={brand}
        brands={data.brands}
        posts={posts}
        onBack={() => setBrandId(null)}
        onSaved={(id, summary) => {
          updatePost(id, summary);
          setToast("Saved to the scheduler");
        }}
      />
    );
  } else {
    body = (
      <BrandScreen
        slug={slug}
        name={portalName || data?.name || "Upcoming posts"}
        data={data}
        loading={loading}
        error={loadError}
        onRefresh={load}
        onPick={setBrandId}
        onSignOut={signOut}
      />
    );
  }

  return (
    <div
      style={{
        minHeight: "100dvh",
        background: T.bg,
        color: T.text,
        fontFamily: T.font,
        WebkitFontSmoothing: "antialiased",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div style={{ width: "100%", maxWidth: 520, margin: "0 auto", flex: 1, display: "flex", flexDirection: "column" }}>{body}</div>
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            style={{
              position: "fixed",
              left: "50%",
              bottom: "calc(24px + env(safe-area-inset-bottom))",
              transform: "translateX(-50%)",
              background: T.text,
              color: "#fff",
              padding: "12px 18px",
              borderRadius: 999,
              fontSize: 14,
              fontWeight: 600,
              boxShadow: "0 10px 30px rgba(0,0,0,.18)",
              zIndex: 60,
              display: "flex",
              alignItems: "center",
              gap: 8,
              whiteSpace: "nowrap",
              maxWidth: "calc(100vw - 32px)",
            }}
          >
            <Check size={16} color="#34D399" strokeWidth={3} /> {toast}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Centered({ title, sub }: { title: string; sub?: string }) {
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 32, textAlign: "center" }}>
      <div style={{ fontSize: 20, fontWeight: 700 }}>{title}</div>
      {sub && <div style={{ color: T.muted, marginTop: 8, fontSize: 14 }}>{sub}</div>}
    </div>
  );
}

// ─── Passcode ─────────────────────────────────────────────

function PasscodeScreen({ name, onSubmit }: { name: string; onSubmit: (code: string) => Promise<void> }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 250);
    return () => clearTimeout(t);
  }, []);

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!code.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit(code.trim());
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Couldn't sign in.");
      setCode("");
      inputRef.current?.focus();
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      onSubmit={submit}
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        padding: "calc(24px + env(safe-area-inset-top)) 24px calc(32px + env(safe-area-inset-bottom))",
        gap: 18,
      }}
    >
      <div style={{ textAlign: "center", marginBottom: 6 }}>
        <div
          style={{
            width: 64,
            height: 64,
            borderRadius: 20,
            background: "#fff",
            border: `1px solid ${T.line}`,
            margin: "0 auto 18px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            boxShadow: "0 4px 16px rgba(0,0,0,.06)",
          }}
        >
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke={T.text} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
        </div>
        <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: -0.4, display: "flex", alignItems: "center", justifyContent: "center", gap: 10 }}>
          <span>Welcome{name ? `, ${name}` : ""}</span>
          <WavingHand size={26} />
        </div>
        <div style={{ color: T.muted, marginTop: 8, fontSize: 15, lineHeight: 1.45, maxWidth: 320, marginLeft: "auto", marginRight: "auto" }}>
          Your upcoming social posts are ready for a quick look. Pop in your passcode to get started.
        </div>
      </div>

      <input
        ref={inputRef}
        value={code}
        onChange={(e) => setCode(e.target.value)}
        type="text"
        inputMode="text"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        onKeyDown={(e) => {
          if (e.key === "Enter") void submit();
        }}
        autoComplete="off"
        enterKeyHint="go"
        placeholder="Passcode"
        aria-label="Passcode"
        style={{
          width: "100%",
          fontSize: 26,
          textAlign: "center",
          letterSpacing: !code ? 0.2 : /^\d+$/.test(code) ? 8 : 2,
          padding: "18px 16px",
          borderRadius: 18,
          border: `1.5px solid ${error ? T.danger : T.line}`,
          background: "#fff",
          color: T.text,
          outline: "none",
          fontFamily: T.font,
          fontWeight: 700,
        }}
      />
      {error && (
        <div role="alert" style={{ color: T.danger, textAlign: "center", fontSize: 14, marginTop: -6 }}>
          {error}
        </div>
      )}
      <button
        type="submit"
        disabled={busy || !code.trim()}
        style={{
          width: "100%",
          padding: "18px",
          borderRadius: 18,
          border: "none",
          background: T.accent,
          color: "#fff",
          fontSize: 17,
          fontWeight: 700,
          opacity: busy || !code.trim() ? 0.5 : 1,
          fontFamily: T.font,
        }}
      >
        {busy ? "Checking…" : "Continue"}
      </button>
      <div style={{ textAlign: "center", color: T.faint, fontSize: 12 }}>We'll remember this phone for 30 days.</div>
    </form>
  );
}

// ─── Brand picker ─────────────────────────────────────────

function BrandScreen({
  slug,
  name,
  data,
  loading,
  error,
  onRefresh,
  onPick,
  onSignOut,
}: {
  slug: string;
  name: string;
  data: PortalPostsResponse | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
  onPick: (brandId: string) => void;
  onSignOut: () => void;
}) {
  const total = data?.posts.length ?? 0;
  const [welcomeOpen, setWelcomeOpen] = useState(() => !readFlag(slug, "welcomed"));
  const nextByBrand = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of data?.posts ?? []) if (!m.has(p.brandId)) m.set(p.brandId, p.scheduleDate);
    return m;
  }, [data]);

  return (
    <div style={{ padding: "calc(16px + env(safe-area-inset-top)) 16px calc(24px + env(safe-area-inset-bottom))" }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 18 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 13, color: T.muted, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.6 }}>Upcoming posts</div>
          <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: -0.5, lineHeight: 1.15, marginTop: 2 }}>{name}</div>
          <div style={{ color: T.muted, fontSize: 14, marginTop: 4 }}>
            {loading && !data ? "Loading the schedule…" : `${total} post${total === 1 ? "" : "s"} in the next ${data?.window.days ?? 31} days`}
          </div>
        </div>
        <button
          onClick={onRefresh}
          aria-label="Refresh"
          disabled={loading}
          style={{
            width: 44,
            height: 44,
            borderRadius: 14,
            border: `1px solid ${T.line}`,
            background: "#fff",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          <motion.svg animate={loading ? { rotate: 360 } : { rotate: 0 }} transition={loading ? { repeat: Infinity, duration: 1, ease: "linear" } : { duration: 0 }} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={T.text} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" /></motion.svg>
        </button>
      </div>

      {error && (
        <div style={{ background: "#FEF2F2", color: T.danger, border: "1px solid #FECACA", borderRadius: 14, padding: "12px 14px", fontSize: 14, marginBottom: 14 }}>
          {error}
        </div>
      )}

      <AnimatePresence initial={false}>
        {welcomeOpen && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, height: 0, marginBottom: 0, overflow: "hidden" }}
            style={{
              background: "linear-gradient(135deg,#111827,#1F2937)",
              color: "#fff",
              borderRadius: 20,
              padding: "16px 16px 14px",
              marginBottom: 14,
              boxShadow: "0 8px 24px rgba(17,24,39,.18)",
              position: "relative",
            }}
          >
            <button
              onClick={() => {
                setWelcomeOpen(false);
                writeFlag(slug, "welcomed", true);
              }}
              aria-label="Dismiss"
              style={{ position: "absolute", top: 8, right: 8, width: 36, height: 36, borderRadius: 12, border: "none", background: "rgba(255,255,255,.12)", color: "#fff", fontSize: 16 }}
            >
              <X size={16} />
            </button>
            <div style={{ fontSize: 17, fontWeight: 800, paddingRight: 40, display: "flex", alignItems: "center", gap: 8 }}>
              <span>Hi there</span>
              <WavingHand size={20} />
            </div>
            <div style={{ fontSize: 14, lineHeight: 1.5, color: "rgba(255,255,255,.85)", marginTop: 6 }}>
              Everything below is lined up to post over the next month. <strong style={{ color: "#fff" }}>Tap a brand</strong> to flip through its posts. If any wording needs a tweak, you can change it right here on your phone.
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "8px 16px", marginTop: 14, fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,.8)" }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <Pointer size={14} color="#FCD34D" /> Tap a brand
              </span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <ArrowLeftRight size={14} color="#FCD34D" /> Swipe posts
              </span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <Pencil size={14} color="#FCD34D" /> Edit wording
              </span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {!data && loading ? (
        <div style={{ display: "grid", gap: 12 }}>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} style={{ height: 84, borderRadius: 20, background: "#fff", border: `1px solid ${T.line}`, opacity: 0.7 }} />
          ))}
        </div>
      ) : data ? (
        <div style={{ display: "grid", gap: 12 }}>
          {data.brands.length > 1 && (
            <BrandTile
              name="All brands"
              sub={total ? `Everything, in date order` : "Nothing scheduled yet"}
              count={total}
              icon={
                <div style={{ width: 48, height: 48, borderRadius: 16, background: T.text, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round"><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></svg>
                </div>
              }
              onClick={() => onPick(ALL)}
            />
          )}
          {data.brands.map((b) => {
            const next = nextByBrand.get(b.id);
            const sub = b.error
              ? "Not connected yet"
              : !b.postCount
              ? "Nothing scheduled yet"
              : next
              ? `Next: ${fmtDay(next)} · ${fmtTime(next)}`
              : "";
            return (
              <BrandTile
                key={b.id}
                name={b.name}
                sub={sub}
                warn={Boolean(b.error)}
                count={b.postCount ?? 0}
                icon={<Avatar name={b.name} src={b.logo} size={48} color={b.color} />}
                onClick={() => onPick(b.id)}
              />
            );
          })}
          {data.brands.length === 0 && <Centered title="No brands yet" sub="Your agency hasn't added any brands to this link." />}
        </div>
      ) : null}

      <button
        onClick={onSignOut}
        style={{ display: "block", margin: "28px auto 0", background: "none", border: "none", color: T.faint, fontSize: 13, padding: 12, fontFamily: T.font }}
      >
        Forget this phone
      </button>
    </div>
  );
}

function BrandTile({ name, sub, count, icon, onClick, warn }: { name: string; sub: string; count: number; icon: React.ReactNode; onClick: () => void; warn?: boolean }) {
  return (
    <motion.button
      whileTap={{ scale: 0.98 }}
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 14,
        width: "100%",
        textAlign: "left",
        padding: 16,
        borderRadius: 20,
        background: T.card,
        border: `1px solid ${T.line}`,
        boxShadow: "0 1px 2px rgba(0,0,0,.03)",
        fontFamily: T.font,
        color: T.text,
      }}
    >
      {icon}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 17, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</div>
        <div style={{ fontSize: 13, color: warn ? "#B45309" : T.muted, marginTop: 2 }}>{sub}</div>
      </div>
      <div
        style={{
          minWidth: 34,
          height: 34,
          padding: "0 10px",
          borderRadius: 999,
          background: count ? T.text : "#F3F4F6",
          color: count ? "#fff" : T.faint,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontWeight: 700,
          fontSize: 14,
        }}
      >
        {count}
      </div>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={T.faint} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
    </motion.button>
  );
}

// ─── Swipe deck ───────────────────────────────────────────

function Deck({
  slug,
  title,
  brand,
  brands,
  posts,
  onBack,
  onSaved,
}: {
  slug: string;
  title: string;
  brand: PortalBrand | null;
  brands: PortalBrand[];
  posts: PortalPost[];
  onBack: () => void;
  onSaved: (postId: string, summary: string) => void;
}) {
  const [index, setIndex] = useState(0);
  const [direction, setDirection] = useState(1);
  const [platform, setPlatform] = useState<PreviewPlatform>("instagram");
  const [autoPlatform, setAutoPlatform] = useState(true);
  const [editing, setEditing] = useState<PortalPost | null>(null);
  const [view, setView] = useState<"swipe" | "list">("swipe");
  const [coach, setCoach] = useState(() => posts.length > 0 && !readFlag(slug, "coached"));

  const count = posts.length;
  const safeIndex = Math.min(index, Math.max(0, count - 1));
  const post = posts[safeIndex];
  const brandFor = (p: PortalPost) => brands.find((b) => b.id === p.brandId) ?? brand;

  useEffect(() => {
    if (post && autoPlatform) setPlatform(defaultPlatformFor(post, platform));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [post?.id]);

  const go = useCallback(
    (dir: 1 | -1) => {
      setIndex((i) => {
        const n = i + dir;
        if (n < 0 || n >= count) return i;
        setDirection(dir);
        return n;
      });
    },
    [count]
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (editing) return;
      if (e.key === "ArrowRight") go(1);
      if (e.key === "ArrowLeft") go(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, editing]);

  const iconBtn: React.CSSProperties = {
    width: 44,
    height: 44,
    borderRadius: 14,
    border: `1px solid ${T.line}`,
    background: "#fff",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  };

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: "100dvh" }}>
      {/* Top bar */}
      <div style={{ padding: "calc(10px + env(safe-area-inset-top)) 14px 8px", display: "flex", alignItems: "center", gap: 10 }}>
        <button onClick={onBack} aria-label="Back" style={iconBtn}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={T.text} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 800, fontSize: 17, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", letterSpacing: -0.2 }}>{title}</div>
          <div style={{ fontSize: 12, color: T.muted }}>{count ? `${safeIndex + 1} of ${count} upcoming` : "Nothing upcoming"}</div>
        </div>
        {count > 0 && (
          <button onClick={() => setCoach(true)} aria-label="How this works" style={iconBtn}>
            <HelpCircle size={20} color={T.text} strokeWidth={2.2} />
          </button>
        )}
        <button onClick={() => setView((v) => (v === "swipe" ? "list" : "swipe"))} aria-label={view === "swipe" ? "List view" : "Swipe view"} style={iconBtn}>
          {view === "swipe" ? (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={T.text} strokeWidth="2.2" strokeLinecap="round"><line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" /><circle cx="4" cy="6" r="1" fill={T.text} /><circle cx="4" cy="12" r="1" fill={T.text} /><circle cx="4" cy="18" r="1" fill={T.text} /></svg>
          ) : (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={T.text} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="3" width="14" height="18" rx="3" /><line x1="2" y1="8" x2="2" y2="16" /><line x1="22" y1="8" x2="22" y2="16" /></svg>
          )}
        </button>
      </div>

      {view === "list" ? (
        <ListView
          posts={posts}
          brands={brands}
          showBrand={!brand}
          onOpen={(i) => {
            setDirection(1);
            setIndex(i);
            setView("swipe");
          }}
        />
      ) : !post ? (
        <Centered title="Nothing scheduled yet" sub="When new posts are lined up they'll show here." />
      ) : (
        <>
          {/* Progress */}
          <div style={{ padding: "0 14px 10px", display: "flex", gap: 3 }}>
            {posts.slice(0, 40).map((p, i) => (
              <div key={p.id} style={{ flex: 1, height: 3, borderRadius: 2, background: i <= safeIndex ? T.text : T.line, transition: "background .2s" }} />
            ))}
          </div>

          {/* Platform toggle */}
          <div style={{ padding: "0 14px 10px", display: "flex", justifyContent: "center" }}>
            <div style={{ display: "inline-flex", background: "#E9EAEE", borderRadius: 999, padding: 3 }}>
              {(["instagram", "facebook"] as PreviewPlatform[]).map((p) => {
                const active = platform === p;
                return (
                  <button
                    key={p}
                    onClick={() => {
                      setPlatform(p);
                      setAutoPlatform(false);
                    }}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      padding: "9px 16px",
                      borderRadius: 999,
                      border: "none",
                      background: active ? "#fff" : "transparent",
                      color: active ? T.text : T.muted,
                      fontWeight: 700,
                      fontSize: 13,
                      boxShadow: active ? "0 1px 3px rgba(0,0,0,.12)" : "none",
                      fontFamily: T.font,
                      minHeight: 38,
                    }}
                  >
                    <PlatformIcon platform={p} size={15} />
                    {p === "instagram" ? "Instagram" : "Facebook"}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Card stage */}
          <div style={{ flex: 1, position: "relative", padding: "0 14px", minHeight: 0 }}>
            {posts[safeIndex + 1] && (
              <div
                aria-hidden
                style={{
                  position: "absolute",
                  left: 22,
                  right: 22,
                  top: 10,
                  bottom: 0,
                  borderRadius: 22,
                  background: "#fff",
                  border: `1px solid ${T.line}`,
                  transform: "scale(.96)",
                  opacity: 0.7,
                }}
              />
            )}
            <AnimatePresence initial={false} custom={direction} mode="popLayout">
              <SwipeCard
                key={post.id}
                direction={direction}
                onSwipe={go}
                onTap={() => setEditing(post)}
                canPrev={safeIndex > 0}
                canNext={safeIndex < count - 1}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", borderBottom: `1px solid ${T.line}`, background: "#FAFAFB" }}>
                  {!brand && (
                    <>
                      <Avatar name={post.brandName} src={brandFor(post)?.logo} size={22} color={brandFor(post)?.color} />
                      <span style={{ fontSize: 12, fontWeight: 700, maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{post.brandName}</span>
                      <span style={{ color: T.line }}>|</span>
                    </>
                  )}
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={T.muted} strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
                  <span style={{ fontSize: 12, fontWeight: 600, color: T.muted }}>{fmtWhen(post.scheduleDate)}</span>
                  <div style={{ flex: 1 }} />
                  <div style={{ display: "flex", gap: 6, color: T.muted }}>
                    {post.platforms.map((p) => (
                      <span key={p} title={p}>
                        <PlatformIcon platform={p} size={14} />
                      </span>
                    ))}
                  </div>
                </div>
                {platform === "instagram" ? (
                  <InstagramCard post={post} brandName={post.brandName} brandLogo={brandFor(post)?.logo} brandColor={brandFor(post)?.color} />
                ) : (
                  <FacebookCard post={post} brandName={post.brandName} brandLogo={brandFor(post)?.logo} brandColor={brandFor(post)?.color} when={fmtWhen(post.scheduleDate)} />
                )}
              </SwipeCard>
            </AnimatePresence>
          </div>

          {/* Bottom controls — thumb zone */}
          <div style={{ padding: "12px 14px calc(14px + env(safe-area-inset-bottom))", display: "flex", alignItems: "center", gap: 10 }}>
            <button onClick={() => go(-1)} disabled={safeIndex === 0} aria-label="Previous post" style={{ ...iconBtn, width: 52, height: 52, borderRadius: 18, opacity: safeIndex === 0 ? 0.35 : 1 }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={T.text} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
            </button>
            <button
              onClick={() => setEditing(post)}
              style={{
                flex: 1,
                height: 52,
                borderRadius: 18,
                border: "none",
                background: T.accent,
                color: "#fff",
                fontWeight: 700,
                fontSize: 16,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                fontFamily: T.font,
              }}
            >
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></svg>
              Edit caption
            </button>
            <button onClick={() => go(1)} disabled={safeIndex >= count - 1} aria-label="Next post" style={{ ...iconBtn, width: 52, height: 52, borderRadius: 18, opacity: safeIndex >= count - 1 ? 0.35 : 1 }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={T.text} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
            </button>
          </div>
        </>
      )}

      <AnimatePresence>
        {coach && view === "swipe" && count > 0 && (
          <CoachMarks
            key="coach"
            onDone={() => {
              setCoach(false);
              writeFlag(slug, "coached", true);
            }}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {editing && (
          <EditSheet
            key={editing.id}
            slug={slug}
            post={editing}
            onClose={() => setEditing(null)}
            onSaved={(summary) => {
              onSaved(editing.id, summary);
              setEditing(null);
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

/** One-time, two-step "how it works" overlay. Big words, one button. */
function CoachMarks({ onDone }: { onDone: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onDone}
      role="dialog"
      aria-label="How this works"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 45,
        background: "rgba(17,24,39,.72)",
        backdropFilter: "blur(2px)",
        WebkitBackdropFilter: "blur(2px)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px 28px calc(24px + env(safe-area-inset-bottom))",
        color: "#fff",
        textAlign: "center",
        fontFamily: T.font,
      }}
    >
      <motion.div initial={{ y: 16, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.05 }} style={{ maxWidth: 340, width: "100%" }}>
        <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: -0.3, marginBottom: 22 }}>Two things to know</div>

        {/* Swipe */}
        <div style={{ background: "rgba(255,255,255,.08)", border: "1px solid rgba(255,255,255,.14)", borderRadius: 20, padding: "18px 16px", marginBottom: 12 }}>
          <div style={{ height: 48, marginBottom: 10, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <SwipeHint size={40} color="#FCD34D" />
          </div>
          <div style={{ fontSize: 17, fontWeight: 700 }}>Swipe to see the next post</div>
          <div style={{ fontSize: 14, color: "rgba(255,255,255,.75)", marginTop: 4 }}>Swipe left for the next one, right to go back. The arrows at the bottom work too.</div>
        </div>

        {/* Tap */}
        <div style={{ background: "rgba(255,255,255,.08)", border: "1px solid rgba(255,255,255,.14)", borderRadius: 20, padding: "18px 16px" }}>
          <div style={{ height: 48, marginBottom: 10, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <TapHint size={40} color="#FCD34D" />
          </div>
          <div style={{ fontSize: 17, fontWeight: 700 }}>Tap a post to change the wording</div>
          <div style={{ fontSize: 14, color: "rgba(255,255,255,.75)", marginTop: 4 }}>Fix a typo or reword it, hit Save, and it updates in the schedule right away.</div>
        </div>

        <button
          onClick={onDone}
          style={{
            marginTop: 22,
            width: "100%",
            height: 54,
            borderRadius: 18,
            border: "none",
            background: "#fff",
            color: T.text,
            fontSize: 17,
            fontWeight: 800,
            fontFamily: T.font,
          }}
        >
          Got it, let's go
        </button>
        <div style={{ fontSize: 12, color: "rgba(255,255,255,.55)", marginTop: 12, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
          Tap <HelpCircle size={14} /> at the top any time to see this again.
        </div>
      </motion.div>
    </motion.div>
  );
}

const CARD_VARIANTS = {
  enter: (d: number) => ({ x: d > 0 ? 320 : -320, opacity: 0, scale: 0.96 }),
  center: { x: 0, opacity: 1, scale: 1 },
  exit: (d: number) => ({ x: d > 0 ? -420 : 420, opacity: 0, transition: { duration: 0.22 } }),
};

function SwipeCard({
  children,
  direction,
  onSwipe,
  onTap,
  canPrev,
  canNext,
}: {
  children: React.ReactNode;
  direction: number;
  onSwipe: (dir: 1 | -1) => void;
  onTap: () => void;
  canPrev: boolean;
  canNext: boolean;
}) {
  const x = useMotionValue(0);
  const rotate = useTransform(x, [-260, 0, 260], [-6, 0, 6]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const dragged = useRef(false);

  return (
    <motion.div
      custom={direction}
      variants={CARD_VARIANTS}
      initial="enter"
      animate="center"
      exit="exit"
      transition={{ type: "spring", stiffness: 420, damping: 36 }}
      drag="x"
      dragDirectionLock
      dragConstraints={{ left: 0, right: 0 }}
      dragElastic={0.85}
      style={{ x, rotate, position: "absolute", top: 0, bottom: 0, left: 14, right: 14, touchAction: "pan-y" }}
      onDragStart={() => {
        dragged.current = true;
      }}
      onDragEnd={(_, info) => {
        const swipeLeft = info.offset.x < -70 || info.velocity.x < -450;
        const swipeRight = info.offset.x > 70 || info.velocity.x > 450;
        if (swipeLeft && canNext) onSwipe(1);
        else if (swipeRight && canPrev) onSwipe(-1);
        setTimeout(() => {
          dragged.current = false;
        }, 50);
      }}
      onTap={() => {
        if (!dragged.current) onTap();
      }}
    >
      <div
        ref={scrollRef}
        style={{
          height: "100%",
          overflowY: "auto",
          WebkitOverflowScrolling: "touch",
          borderRadius: 22,
          background: "#fff",
          border: `1px solid ${T.line}`,
          boxShadow: "0 12px 34px rgba(17,24,39,.10)",
          overscrollBehavior: "contain",
        }}
      >
        {children}
        <div style={{ textAlign: "center", color: T.faint, fontSize: 12, padding: "6px 0 14px" }}>Tap to edit · swipe for next</div>
      </div>
    </motion.div>
  );
}

// ─── List view ────────────────────────────────────────────

function ListView({ posts, brands, showBrand, onOpen }: { posts: PortalPost[]; brands: PortalBrand[]; showBrand: boolean; onOpen: (index: number) => void }) {
  const groups = useMemo(() => {
    const m = new Map<string, { label: string; items: { p: PortalPost; i: number }[] }>();
    posts.forEach((p, i) => {
      const key = new Date(p.scheduleDate).toDateString();
      if (!m.has(key)) m.set(key, { label: fmtDay(p.scheduleDate), items: [] });
      m.get(key)!.items.push({ p, i });
    });
    return Array.from(m.values());
  }, [posts]);

  if (posts.length === 0) return <Centered title="Nothing scheduled yet" />;

  return (
    <div style={{ padding: "4px 14px calc(24px + env(safe-area-inset-bottom))", overflowY: "auto" }}>
      {groups.map((g) => (
        <div key={g.label} style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: T.muted, textTransform: "uppercase", letterSpacing: 0.6, padding: "6px 2px 8px" }}>{g.label}</div>
          <div style={{ background: "#fff", border: `1px solid ${T.line}`, borderRadius: 18, overflow: "hidden" }}>
            {g.items.map(({ p, i }, k) => {
              const b = brands.find((x) => x.id === p.brandId);
              const m = p.media[0];
              return (
                <button
                  key={p.id}
                  onClick={() => onOpen(i)}
                  style={{
                    display: "flex",
                    gap: 12,
                    alignItems: "center",
                    width: "100%",
                    textAlign: "left",
                    padding: 12,
                    background: "none",
                    border: "none",
                    borderTop: k ? `1px solid ${T.line}` : "none",
                    fontFamily: T.font,
                    color: T.text,
                    minHeight: 72,
                  }}
                >
                  <div style={{ width: 52, height: 52, borderRadius: 12, background: "#F3F4F6", overflow: "hidden", flexShrink: 0 }}>
                    {m ? (
                      <img src={m.thumbnail || m.url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                    ) : (
                      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: T.faint, fontSize: 11 }}>Aa</div>
                    )}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: T.muted, marginBottom: 3 }}>
                      <span style={{ fontWeight: 700, color: T.text }}>{fmtTime(p.scheduleDate)}</span>
                      {b && showBrand && (
                        <>
                          <span>·</span>
                          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{b.name}</span>
                        </>
                      )}
                      <span style={{ display: "flex", gap: 4, marginLeft: "auto" }}>
                        {p.platforms.map((pl) => (
                          <PlatformIcon key={pl} platform={pl} size={13} />
                        ))}
                      </span>
                    </div>
                    <div style={{ fontSize: 14, lineHeight: 1.35, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                      {p.summary || <span style={{ color: T.faint }}>No caption</span>}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Edit sheet ───────────────────────────────────────────

function EditSheet({ slug, post, onClose, onSaved }: { slug: string; post: PortalPost; onClose: () => void; onSaved: (summary: string) => void }) {
  const [text, setText] = useState(post.summary);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);
  const dirty = text.trim() !== post.summary.trim();

  useEffect(() => {
    const t = setTimeout(() => {
      ref.current?.focus();
      const len = ref.current?.value.length ?? 0;
      ref.current?.setSelectionRange(len, len);
    }, 220);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, Math.round(window.innerHeight * 0.4))}px`;
  }, [text]);

  const save = async () => {
    if (!dirty || busy) return;
    if (!text.trim()) {
      setError("The caption can't be empty.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await portalApi.editCaption(slug, post.id, post.brandId, text.trim());
      onSaved(r.summary);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Couldn't save. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={busy ? undefined : onClose}
        style={{ position: "fixed", inset: 0, background: "rgba(17,24,39,.45)", zIndex: 50 }}
      />
      <motion.div
        initial={{ y: "100%" }}
        animate={{ y: 0 }}
        exit={{ y: "100%" }}
        transition={{ type: "spring", stiffness: 380, damping: 38 }}
        role="dialog"
        aria-label="Edit caption"
        style={{
          position: "fixed",
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 55,
          background: "#fff",
          borderRadius: "24px 24px 0 0",
          padding: "10px 16px calc(16px + env(safe-area-inset-bottom))",
          maxWidth: 520,
          margin: "0 auto",
          boxShadow: "0 -10px 40px rgba(0,0,0,.15)",
          fontFamily: T.font,
        }}
      >
        <div style={{ width: 40, height: 4, borderRadius: 2, background: T.line, margin: "0 auto 12px" }} />
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: 17 }}>Edit caption</div>
            <div style={{ fontSize: 12, color: T.muted }}>
              {post.brandName} · {fmtWhen(post.scheduleDate)}
            </div>
          </div>
          <button onClick={onClose} disabled={busy} aria-label="Close" style={{ width: 40, height: 40, borderRadius: 12, border: "none", background: "#F3F4F6", color: T.muted, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <X size={18} />
          </button>
        </div>
        <textarea
          ref={ref}
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={4}
          style={{
            width: "100%",
            fontSize: 16,
            lineHeight: 1.45,
            padding: 14,
            borderRadius: 16,
            border: `1.5px solid ${error ? T.danger : T.line}`,
            background: "#FAFAFB",
            color: T.text,
            resize: "none",
            outline: "none",
            fontFamily: T.font,
            minHeight: 120,
          }}
        />
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 6, fontSize: 12, color: T.faint }}>
          <span>{error ? <span style={{ color: T.danger }}>{error}</span> : "Changes go straight to the scheduler."}</span>
          <span>{text.length}</span>
        </div>
        <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
          <button
            onClick={onClose}
            disabled={busy}
            style={{ flex: 1, height: 52, borderRadius: 16, border: `1px solid ${T.line}`, background: "#fff", fontWeight: 700, fontSize: 16, color: T.text, fontFamily: T.font }}
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={!dirty || busy}
            style={{
              flex: 2,
              height: 52,
              borderRadius: 16,
              border: "none",
              background: T.accent,
              color: "#fff",
              fontWeight: 700,
              fontSize: 16,
              opacity: !dirty || busy ? 0.5 : 1,
              fontFamily: T.font,
            }}
          >
            {busy ? "Saving…" : "Save changes"}
          </button>
        </div>
      </motion.div>
    </>
  );
}
