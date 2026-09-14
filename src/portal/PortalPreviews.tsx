/**
 * Light-theme Facebook / Instagram feed mock-ups for the client portal.
 * Plain inline styles on purpose: these must look like the real apps, not the
 * agency backend.
 */
import React, { useState } from "react";
import type { PortalPost, PortalAccount } from "./portalApi";

export type PreviewPlatform = "instagram" | "facebook";

const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

export function Avatar({ name, src, size = 34, color }: { name: string; src?: string | null; size?: number; color?: string | null }) {
  const [broken, setBroken] = useState(false);
  if (src && !broken) {
    return (
      <img
        src={src}
        alt=""
        onError={() => setBroken(true)}
        style={{ width: size, height: size, borderRadius: "50%", objectFit: "cover", flexShrink: 0, background: "#eee" }}
      />
    );
  }
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: color || "#111827",
        color: "#fff",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontWeight: 700,
        fontSize: Math.max(10, size * 0.38),
        flexShrink: 0,
        letterSpacing: 0.3,
      }}
    >
      {initials(name) || "•"}
    </div>
  );
}

function isVideo(m: PortalPost["media"][number]): boolean {
  const t = (m.type || "").toLowerCase();
  if (t.startsWith("video")) return true;
  return /\.(mp4|mov|m4v|webm)(\?|$)/i.test(m.url);
}

/**
 * Always show the whole graphic at its real proportions. Clients are proofing
 * the artwork, so cropping to a square (like the old Instagram grid) hides
 * exactly the parts they need to check.
 */
function MediaBox({ post }: { post: PortalPost }) {
  const [broken, setBroken] = useState(false);
  const m = post.media[0];
  const extra = post.media.length - 1;
  const boxStyle: React.CSSProperties = { width: "100%", background: "#f2f2f2", position: "relative", overflow: "hidden", lineHeight: 0 };
  if (!m || broken) {
    return (
      <div style={{ ...boxStyle, aspectRatio: "1 / 1", display: "flex", alignItems: "center", justifyContent: "center", color: "#9ca3af", fontSize: 13 }}>
        {broken ? "Image unavailable" : "Text-only post"}
      </div>
    );
  }
  return (
    <div style={boxStyle}>
      {isVideo(m) ? (
        <video
          src={m.url}
          poster={m.thumbnail || undefined}
          playsInline
          muted
          controls
          preload="metadata"
          style={{ width: "100%", height: "auto", maxHeight: "70vh", objectFit: "contain", display: "block", background: "#000" }}
        />
      ) : (
        <img
          src={m.url}
          alt=""
          onError={() => setBroken(true)}
          draggable={false}
          style={{ width: "100%", height: "auto", display: "block" }}
        />
      )}
      {extra > 0 && (
        <div
          style={{
            position: "absolute",
            top: 10,
            right: 10,
            background: "rgba(0,0,0,.6)",
            color: "#fff",
            fontSize: 11,
            fontWeight: 600,
            padding: "3px 8px",
            borderRadius: 999,
          }}
        >
          1/{post.media.length}
        </div>
      )}
    </div>
  );
}

function pickAccount(post: PortalPost, platform: PreviewPlatform): PortalAccount | null {
  const hit = post.accounts.find((a) => (a.platform || "").toLowerCase().includes(platform));
  return hit ?? post.accounts[0] ?? null;
}

function handleFrom(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9._]/g, "").slice(0, 28) || "brand";
}

/** Instagram splits caption after ~125 chars with "… more". We show it all (client is proofreading). */
function Caption({ text, bold }: { text: string; bold?: string }) {
  return (
    <div style={{ fontSize: 14, lineHeight: 1.45, color: "#111", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
      {bold && <span style={{ fontWeight: 600, marginRight: 6 }}>{bold}</span>}
      {text || <span style={{ color: "#9ca3af" }}>No caption yet</span>}
    </div>
  );
}

// ─── Icons (thin, like the real apps) ─────────────────────

const I = {
  heart: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#111" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" /></svg>,
  comment: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#111" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 8.6 8.6 0 0 1-3.8-.9L3 21l1.9-4.4A8.4 8.4 0 0 1 12 3a8.4 8.4 0 0 1 9 8.5z" /></svg>,
  send: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#111" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>,
  bookmark: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#111" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" /></svg>,
  more: <svg width="20" height="20" viewBox="0 0 24 24" fill="#111"><circle cx="5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="19" cy="12" r="1.6" /></svg>,
  globe: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#65676b" strokeWidth="2"><circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" /><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" /></svg>,
  like: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#65676b" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3" /></svg>,
  fbComment: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#65676b" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 8.6 8.6 0 0 1-3.8-.9L3 21l1.9-4.4A8.4 8.4 0 0 1 12 3a8.4 8.4 0 0 1 9 8.5z" /></svg>,
  share: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#65676b" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" /><polyline points="16 6 12 2 8 6" /><line x1="12" y1="2" x2="12" y2="15" /></svg>,
};

// ─── Instagram ────────────────────────────────────────────

export function InstagramCard({ post, brandName, brandLogo, brandColor }: { post: PortalPost; brandName: string; brandLogo?: string | null; brandColor?: string | null }) {
  const acct = pickAccount(post, "instagram");
  const name = acct?.name || brandName;
  const handle = handleFrom(name);
  return (
    <div style={{ background: "#fff", fontFamily: FONT, color: "#111" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px" }}>
        <div style={{ padding: 2, borderRadius: "50%", background: "linear-gradient(45deg,#f9ce34,#ee2a7b,#6228d7)" }}>
          <div style={{ padding: 2, borderRadius: "50%", background: "#fff" }}>
            <Avatar name={name} src={acct?.avatar || brandLogo} size={32} color={brandColor} />
          </div>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{handle}</div>
          <div style={{ fontSize: 11, color: "#737373" }}>Scheduled</div>
        </div>
        {I.more}
      </div>
      <MediaBox post={post} />
      <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "10px 12px 6px" }}>
        {I.heart}
        {I.comment}
        {I.send}
        <div style={{ flex: 1 }} />
        {I.bookmark}
      </div>
      <div style={{ padding: "0 12px 4px", fontWeight: 600, fontSize: 13 }}>Be the first to like this</div>
      <div style={{ padding: "0 12px 12px" }}>
        <Caption text={post.summary} bold={handle} />
      </div>
    </div>
  );
}

// ─── Facebook ─────────────────────────────────────────────

export function FacebookCard({ post, brandName, brandLogo, brandColor, when }: { post: PortalPost; brandName: string; brandLogo?: string | null; brandColor?: string | null; when: string }) {
  const acct = pickAccount(post, "facebook");
  const name = acct?.name || brandName;
  return (
    <div style={{ background: "#fff", fontFamily: FONT, color: "#050505" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 12px 8px" }}>
        <Avatar name={name} src={acct?.avatar || brandLogo} size={40} color={brandColor} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 15, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</div>
          <div style={{ fontSize: 12, color: "#65676b", display: "flex", alignItems: "center", gap: 4 }}>
            <span>{when}</span>
            <span>·</span>
            {I.globe}
          </div>
        </div>
        {I.more}
      </div>
      <div style={{ padding: "0 12px 10px" }}>
        <Caption text={post.summary} />
      </div>
      <MediaBox post={post} />
      <div style={{ display: "flex", justifyContent: "space-around", padding: "6px 8px", borderTop: "1px solid #e4e6eb", marginTop: 0 }}>
        {[
          ["Like", I.like],
          ["Comment", I.fbComment],
          ["Share", I.share],
        ].map(([label, icon]) => (
          <div key={label as string} style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 10px", color: "#65676b", fontSize: 14, fontWeight: 600 }}>
            {icon}
            {label}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Which preview to show first for a post: whatever it's actually going to. */
export function defaultPlatformFor(post: PortalPost, fallback: PreviewPlatform): PreviewPlatform {
  const p = post.platforms.map((x) => x.toLowerCase());
  if (p.some((x) => x.includes("instagram")) && !p.some((x) => x.includes("facebook"))) return "instagram";
  if (p.some((x) => x.includes("facebook")) && !p.some((x) => x.includes("instagram"))) return "facebook";
  return fallback;
}
