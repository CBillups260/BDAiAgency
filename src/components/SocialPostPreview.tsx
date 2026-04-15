import React, { useState, useRef, useEffect } from 'react';

// ─── Types ────────────────────────────────────────────────

interface SocialPostPreviewProps {
  accountName: string;
  accountAvatar?: string | null;
  accountHandle?: string | null;
  caption?: string;
  image?: string;                   // data URL or URL
  imageContent?: React.ReactNode;   // alternative: raw JSX (e.g. review graphic)
  defaultPlatform?: string;
}

const PREVIEW_PLATFORMS = [
  { id: 'instagram', label: 'Instagram' },
  { id: 'facebook', label: 'Facebook' },
  { id: 'twitter', label: 'X' },
  { id: 'linkedin', label: 'LinkedIn' },
  { id: 'tiktok', label: 'TikTok' },
] as const;

// ─── Tiny SVG icons for platform chrome ───────────────────

const Heart = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
);
const Comment = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
);
const Send = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
);
const Bookmark = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
);
const MoreH = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/></svg>
);
const Globe = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
);
const Repost = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>
);
const BarChart = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
);
const ThumbsUp = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/></svg>
);
const MusicNote = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 3v10.55A4 4 0 1 0 14 17V7h4V3h-6z"/></svg>
);

// ─── Avatar helper ────────────────────────────────────────

function Avatar({ name, src, size = 32 }: { name: string; src?: string | null; size?: number }) {
  const url = src || `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=27273A&color=fff&size=${size * 2}`;
  return (
    <img
      src={url}
      alt=""
      style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }}
    />
  );
}

// ─── Image area shared ───────────────────────────────────

function PostImage({ image, imageContent, aspect = '1/1' }: {
  image?: string;
  imageContent?: React.ReactNode;
  aspect?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.38);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current || !imageContent) return;
    const obs = new ResizeObserver(([entry]) => {
      // Get the actual width of the graphic content (first child)
      const content = contentRef.current?.firstElementChild as HTMLElement | null;
      const contentW = content?.offsetWidth || 1080;
      setScale(entry.contentRect.width / contentW);
    });
    obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, [!!imageContent]);

  // Derive aspect ratio from imageContent's actual dimensions
  const contentEl = contentRef.current?.firstElementChild as HTMLElement | null;
  const autoAspect = contentEl ? `${contentEl.offsetWidth}/${contentEl.offsetHeight}` : aspect;

  return (
    <div ref={containerRef} style={{ width: '100%', aspectRatio: imageContent ? autoAspect : aspect, overflow: 'hidden', background: '#000', position: 'relative' }}>
      {imageContent ? (
        <div ref={contentRef} style={{ transform: `scale(${scale})`, transformOrigin: 'top left' }}>{imageContent}</div>
      ) : image ? (
        <img src={image} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
      ) : (
        <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#444', fontSize: 14 }}>
          No image
        </div>
      )}
    </div>
  );
}

// ─── Instagram ────────────────────────────────────────────

function InstagramPreview({ accountName, accountAvatar, caption, image, imageContent }: SocialPostPreviewProps) {
  return (
    <div style={{ background: '#000', borderRadius: 12, overflow: 'hidden', fontFamily: "-apple-system, 'Helvetica Neue', sans-serif", color: '#fff', fontSize: 13 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', padding: '10px 12px', gap: 10 }}>
        <Avatar name={accountName} src={accountAvatar} size={32} />
        <span style={{ fontWeight: 600, fontSize: 13, flex: 1 }}>{accountName.toLowerCase().replace(/[^a-z0-9]/g, '')}</span>
        <MoreH />
      </div>

      {/* Image */}
      <PostImage image={image} imageContent={imageContent} aspect="1/1" />

      {/* Actions */}
      <div style={{ display: 'flex', alignItems: 'center', padding: '10px 12px', gap: 14 }}>
        <Heart /><Comment /><Send />
        <div style={{ flex: 1 }} />
        <Bookmark />
      </div>

      {/* Likes */}
      <div style={{ padding: '0 12px 4px', fontWeight: 600, fontSize: 13 }}>1,247 likes</div>

      {/* Caption */}
      {caption && (
        <div style={{ padding: '0 12px 6px', fontSize: 13, lineHeight: 1.5 }}>
          <span style={{ fontWeight: 600 }}>{accountName.toLowerCase().replace(/[^a-z0-9]/g, '')}</span>{' '}
          <span style={{ color: '#e4e4e4' }}>{caption.length > 150 ? caption.slice(0, 150) + '... more' : caption}</span>
        </div>
      )}

      {/* Comments & time */}
      <div style={{ padding: '0 12px', fontSize: 12, color: '#a8a8a8' }}>View all 42 comments</div>
      <div style={{ padding: '4px 12px 12px', fontSize: 10, color: '#a8a8a8', textTransform: 'uppercase', letterSpacing: 0.5 }}>2 hours ago</div>
    </div>
  );
}

// ─── Facebook ─────────────────────────────────────────────

function FacebookPreview({ accountName, accountAvatar, caption, image, imageContent }: SocialPostPreviewProps) {
  return (
    <div style={{ background: '#242526', borderRadius: 12, overflow: 'hidden', fontFamily: "-apple-system, 'Helvetica Neue', sans-serif", color: '#e4e6eb', fontSize: 14 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', padding: '12px 14px', gap: 10 }}>
        <Avatar name={accountName} src={accountAvatar} size={38} />
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600, fontSize: 14 }}>{accountName}</div>
          <div style={{ fontSize: 12, color: '#b0b3b8', display: 'flex', alignItems: 'center', gap: 4 }}>
            2h <span style={{ margin: '0 2px' }}>&middot;</span> <Globe />
          </div>
        </div>
        <MoreH />
      </div>

      {/* Caption */}
      {caption && (
        <div style={{ padding: '0 14px 10px', fontSize: 14, lineHeight: 1.5, color: '#e4e6eb' }}>
          {caption.length > 200 ? caption.slice(0, 200) + '... See more' : caption}
        </div>
      )}

      {/* Image */}
      <PostImage image={image} imageContent={imageContent} aspect="1/1" />

      {/* Reactions */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 14px', fontSize: 13, color: '#b0b3b8' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ fontSize: 16 }}>👍❤️</span> 128
        </div>
        <span>18 comments &middot; 5 shares</span>
      </div>

      {/* Divider */}
      <div style={{ height: 1, background: '#3e4042', margin: '0 14px' }} />

      {/* Actions */}
      <div style={{ display: 'flex', padding: '4px 8px 8px' }}>
        {[
          { icon: <ThumbsUp />, label: 'Like' },
          { icon: <Comment />, label: 'Comment' },
          { icon: <Send />, label: 'Share' },
        ].map(a => (
          <button key={a.label} style={{
            flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            padding: '8px 0', color: '#b0b3b8', fontSize: 13, fontWeight: 600,
            background: 'transparent', border: 'none', cursor: 'default', borderRadius: 6,
          }}>
            {a.icon} {a.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Twitter / X ──────────────────────────────────────────

function TwitterPreview({ accountName, accountAvatar, accountHandle, caption, image, imageContent }: SocialPostPreviewProps) {
  const handle = accountHandle || '@' + accountName.toLowerCase().replace(/[^a-z0-9]/g, '');
  return (
    <div style={{ background: '#000', borderRadius: 12, overflow: 'hidden', fontFamily: "-apple-system, 'Helvetica Neue', sans-serif", color: '#e7e9ea', fontSize: 15, padding: '12px 14px' }}>
      {/* Header */}
      <div style={{ display: 'flex', gap: 10 }}>
        <Avatar name={accountName} src={accountAvatar} size={38} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ fontWeight: 700, fontSize: 15 }}>{accountName}</span>
            <span style={{ color: '#71767b', fontSize: 14 }}>{handle} &middot; 2h</span>
          </div>

          {/* Text */}
          {caption && (
            <div style={{ marginTop: 4, fontSize: 15, lineHeight: 1.45, color: '#e7e9ea', whiteSpace: 'pre-wrap' }}>
              {caption.length > 280 ? caption.slice(0, 277) + '...' : caption}
            </div>
          )}

          {/* Image */}
          {(image || imageContent) && (
            <div style={{ marginTop: 10, borderRadius: 16, overflow: 'hidden', border: '1px solid #2f3336' }}>
              <PostImage image={image} imageContent={imageContent} aspect="16/10" />
            </div>
          )}

          {/* Actions */}
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 10, color: '#71767b', maxWidth: 360 }}>
            {[
              { icon: <Comment />, count: '12' },
              { icon: <Repost />, count: '5' },
              { icon: <Heart />, count: '148' },
              { icon: <BarChart />, count: '2.4K' },
            ].map((a, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13 }}>
                <span style={{ transform: 'scale(0.75)', display: 'flex' }}>{a.icon}</span> {a.count}
              </div>
            ))}
            <span style={{ transform: 'scale(0.75)', display: 'flex' }}><Bookmark /></span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── LinkedIn ─────────────────────────────────────────────

function LinkedInPreview({ accountName, accountAvatar, caption, image, imageContent }: SocialPostPreviewProps) {
  return (
    <div style={{ background: '#1b1f23', borderRadius: 12, overflow: 'hidden', fontFamily: "-apple-system, 'Helvetica Neue', sans-serif", color: '#e0dfdc', fontSize: 14 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', padding: '12px 14px', gap: 10 }}>
        <Avatar name={accountName} src={accountAvatar} size={44} />
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600, fontSize: 14 }}>{accountName}</div>
          <div style={{ fontSize: 12, color: '#ffffffa0' }}>Company &middot; 2h &middot; <Globe /></div>
        </div>
        <MoreH />
      </div>

      {/* Caption */}
      {caption && (
        <div style={{ padding: '0 14px 10px', fontSize: 14, lineHeight: 1.5, color: '#e0dfdc' }}>
          {caption.length > 250 ? caption.slice(0, 250) + '... see more' : caption}
        </div>
      )}

      {/* Image */}
      <PostImage image={image} imageContent={imageContent} aspect="4/3" />

      {/* Reactions */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 14px', fontSize: 12, color: '#ffffffa0' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ fontSize: 14 }}>👍💡</span> 94 reactions
        </div>
        <span>12 comments &middot; 3 reposts</span>
      </div>

      {/* Divider */}
      <div style={{ height: 1, background: '#38434f', margin: '0 14px' }} />

      {/* Actions */}
      <div style={{ display: 'flex', padding: '4px 6px 8px' }}>
        {[
          { icon: <ThumbsUp />, label: 'Like' },
          { icon: <Comment />, label: 'Comment' },
          { icon: <Repost />, label: 'Repost' },
          { icon: <Send />, label: 'Send' },
        ].map(a => (
          <button key={a.label} style={{
            flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
            padding: '8px 0', color: '#ffffffa0', fontSize: 12, fontWeight: 600,
            background: 'transparent', border: 'none', cursor: 'default', borderRadius: 4,
          }}>
            <span style={{ transform: 'scale(0.8)', display: 'flex' }}>{a.icon}</span> {a.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── TikTok ───────────────────────────────────────────────

function TikTokPreview({ accountName, caption, image, imageContent }: SocialPostPreviewProps) {
  const handle = '@' + accountName.toLowerCase().replace(/[^a-z0-9]/g, '');
  return (
    <div style={{
      background: '#000', borderRadius: 12, overflow: 'hidden',
      fontFamily: "-apple-system, 'Helvetica Neue', sans-serif", color: '#fff',
      position: 'relative', maxWidth: 300, margin: '0 auto',
    }}>
      {/* Vertical image area */}
      <div style={{ position: 'relative', aspectRatio: '9/16', overflow: 'hidden' }}>
        {imageContent ? (
          <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#000' }}>
            {imageContent}
          </div>
        ) : image ? (
          <img src={image} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
        ) : (
          <div style={{ width: '100%', height: '100%', background: '#111', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#444', fontSize: 14 }}>
            No image
          </div>
        )}

        {/* Gradient overlay at bottom */}
        <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: '50%', background: 'linear-gradient(transparent, rgba(0,0,0,0.85))' }} />

        {/* Right side icons */}
        <div style={{
          position: 'absolute', right: 10, bottom: 100, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 18,
        }}>
          {[
            { icon: <Heart />, count: '1.2K' },
            { icon: <Comment />, count: '42' },
            { icon: <Bookmark />, count: '89' },
            { icon: <Send />, count: '15' },
          ].map((a, i) => (
            <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
              <span style={{ transform: 'scale(0.9)', display: 'flex' }}>{a.icon}</span>
              <span style={{ fontSize: 10, fontWeight: 600 }}>{a.count}</span>
            </div>
          ))}
        </div>

        {/* Bottom info */}
        <div style={{ position: 'absolute', bottom: 14, left: 12, right: 60 }}>
          <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>{handle}</div>
          {caption && (
            <div style={{ fontSize: 13, lineHeight: 1.4, color: '#ffffffdd' }}>
              {caption.length > 100 ? caption.slice(0, 97) + '...' : caption}
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 8, fontSize: 12, color: '#ffffffaa' }}>
            <MusicNote /> Original Sound - {accountName}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────

export default function SocialPostPreview(props: SocialPostPreviewProps) {
  const [platform, setPlatform] = useState(props.defaultPlatform || 'instagram');

  const renderPreview = () => {
    switch (platform) {
      case 'instagram': return <InstagramPreview {...props} />;
      case 'facebook': return <FacebookPreview {...props} />;
      case 'twitter': return <TwitterPreview {...props} />;
      case 'linkedin': return <LinkedInPreview {...props} />;
      case 'tiktok': return <TikTokPreview {...props} />;
      default: return <InstagramPreview {...props} />;
    }
  };

  return (
    <div>
      {/* Platform selector */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 12, flexWrap: 'wrap' }}>
        {PREVIEW_PLATFORMS.map(p => (
          <button
            key={p.id}
            onClick={() => setPlatform(p.id)}
            className={`px-3 py-1.5 rounded-lg text-[11px] font-medium transition-all border ${
              platform === p.id
                ? 'bg-purple-500/15 border-purple-500/40 text-purple-300'
                : 'border-[#27273A] bg-[#0A0A0F] text-zinc-500 hover:text-zinc-300 hover:border-zinc-600'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Preview */}
      <div className="rounded-2xl overflow-hidden border border-[#27273A]" style={{ maxWidth: platform === 'tiktok' ? 300 : 420, margin: '0 auto' }}>
        {renderPreview()}
      </div>
    </div>
  );
}
