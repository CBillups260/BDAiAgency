import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  Star,
  Loader,
  Upload,
  X,
  Download,
  Search,
  Check,
  ChevronDown,
  RefreshCw,
  MapPin,
  Image,
  Bookmark,
  Type,
  Package,
  Layout,
  Droplet,
} from '@geist-ui/icons';
import { addToFlowBucket } from './FlowBucket';
import { motion, AnimatePresence } from 'motion/react';
import { toPng } from 'html-to-image';
import { useFirestoreAccounts } from '../hooks/useFirestore';
import SocialPostPreview from './SocialPostPreview';
import CaptionWidget from './CaptionWidget';

// ─── Types ────────────────────────────────────────────────

interface ReviewData {
  reviewerName: string;
  platform: 'google' | 'yelp' | 'facebook' | 'tripadvisor';
  rating: number;
  text: string;
  localGuideLevel?: number;
  photos?: string[];
}

interface PlaceResult {
  id: string;
  name: string;
  address: string;
  rating?: number;
  reviewCount?: number;
  photoUrl?: string | null;
}

interface FetchedReview {
  authorName: string;
  authorPhoto: string | null;
  rating: number;
  text: string;
  relativeTime: string;
  photos: string[];
}

// ─── Platform Config ──────────────────────────────────────

const PLATFORMS = [
  { id: 'google' as const, label: 'Google' },
  { id: 'yelp' as const, label: 'Yelp' },
  { id: 'facebook' as const, label: 'Facebook' },
  { id: 'tripadvisor' as const, label: 'TripAdvisor' },
];

const PLATFORM_STYLES: Record<
  string,
  { reviewerLabel: string; color1: string; color2: string }
> = {
  google: { reviewerLabel: 'Google Reviewer', color1: '#1B5E20', color2: '#7f1d1d' },
  yelp: { reviewerLabel: 'Yelp Reviewer', color1: '#7f1d1d', color2: '#b45309' },
  facebook: { reviewerLabel: 'Facebook Reviewer', color1: '#1e3a5f', color2: '#1e40af' },
  tripadvisor: { reviewerLabel: 'TripAdvisor Reviewer', color1: '#1B5E20', color2: '#004D40' },
};

// ─── Helpers ──────────────────────────────────────────────

function splitFirstSentence(text: string): { bold: string; rest: string } {
  const m = text.match(/^(.+?[.!?])\s*/);
  if (m && m[0].length < text.length) return { bold: m[1], rest: text.slice(m[0].length) };
  return { bold: text, rest: '' };
}

// Inline SVG logos for the graphic (must be inline for html-to-image)
function GoogleGIcon({ size = 48 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size}>
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </svg>
  );
}

function GoogleReviewsLogo() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
      <div style={{ display: 'flex', gap: 1, fontWeight: 700, fontSize: 20, fontFamily: "'Product Sans', Arial, sans-serif" }}>
        <span style={{ color: '#4285F4' }}>G</span>
        <span style={{ color: '#EA4335' }}>o</span>
        <span style={{ color: '#FBBC05' }}>o</span>
        <span style={{ color: '#4285F4' }}>g</span>
        <span style={{ color: '#34A853' }}>l</span>
        <span style={{ color: '#EA4335' }}>e</span>
      </div>
      <div style={{ fontSize: 13, color: '#555', fontWeight: 500, display: 'flex', alignItems: 'center', gap: 4 }}>
        Reviews
        <span style={{ color: '#FBBC05', fontSize: 12 }}>★★★★</span>
      </div>
    </div>
  );
}

function YelpLogo() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
      <div style={{ fontWeight: 900, fontSize: 24, color: '#D32323', fontStyle: 'italic', fontFamily: "Arial, sans-serif", letterSpacing: -1 }}>yelp</div>
      <div style={{ fontSize: 12, color: '#555', fontWeight: 500 }}>Reviews</div>
    </div>
  );
}

function YelpIcon({ size = 48 }: { size?: number }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%', background: '#D32323',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontWeight: 900, fontSize: size * 0.55, color: 'white', fontStyle: 'italic',
      fontFamily: "Arial, sans-serif",
    }}>
      y
    </div>
  );
}

function FacebookIcon({ size = 48 }: { size?: number }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%', background: '#1877F2',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontWeight: 800, fontSize: size * 0.65, color: 'white',
      fontFamily: "Arial, sans-serif",
    }}>
      f
    </div>
  );
}

function TripAdvisorIcon({ size = 48 }: { size?: number }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%', background: '#34E0A1',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontWeight: 800, fontSize: size * 0.35, color: '#000',
      fontFamily: "Arial, sans-serif",
    }}>
      TA
    </div>
  );
}

function PlatformCardLogo({ platform }: { platform: string }) {
  if (platform === 'google') return <GoogleReviewsLogo />;
  if (platform === 'yelp') return <YelpLogo />;
  if (platform === 'facebook')
    return (
      <div style={{ fontWeight: 700, fontSize: 20, color: '#1877F2', fontFamily: "Arial, sans-serif" }}>
        facebook
        <div style={{ fontSize: 12, color: '#555', fontWeight: 500 }}>Reviews</div>
      </div>
    );
  return (
    <div style={{ fontWeight: 700, fontSize: 16, color: '#00AA6C', fontFamily: "Arial, sans-serif" }}>
      TripAdvisor
      <div style={{ fontSize: 12, color: '#555', fontWeight: 500 }}>Reviews</div>
    </div>
  );
}

function PlatformBubbleIcon({ platform, size = 48 }: { platform: string; size?: number }) {
  if (platform === 'google') return <GoogleGIcon size={size} />;
  if (platform === 'yelp') return <YelpIcon size={size} />;
  if (platform === 'facebook') return <FacebookIcon size={size} />;
  return <TripAdvisorIcon size={size} />;
}

// ─── Bucket (saved review graphics) ───────────────────────

const BUCKET_KEY = 'bdai-review-bucket';
const REVIEW_CACHE_PREFIX = 'bdai-reviews-';

interface BucketItem {
  id: string;
  timestamp: number;
  accountId: string;
  accountName: string;
  accountAvatar?: string | null;
  review: ReviewData;
  backgroundImage: string | null;
  overlayStyle: OverlayStyleId;
  placeId?: string;
  placeName?: string;
  captions?: string[];
}

function loadBucket(): BucketItem[] {
  try {
    return JSON.parse(localStorage.getItem(BUCKET_KEY) || '[]');
  } catch { return []; }
}

function saveBucket(items: BucketItem[]) {
  // Keep max 20, newest first
  localStorage.setItem(BUCKET_KEY, JSON.stringify(items.slice(0, 20)));
}

function cacheReviews(placeId: string, reviews: FetchedReview[], nextPageToken?: string | null) {
  try {
    localStorage.setItem(REVIEW_CACHE_PREFIX + placeId, JSON.stringify({ ts: Date.now(), reviews, nextPageToken: nextPageToken || null }));
  } catch {}
}

function getCachedReviews(placeId: string): { reviews: FetchedReview[]; ts: number; nextPageToken: string | null } | null {
  try {
    const raw = localStorage.getItem(REVIEW_CACHE_PREFIX + placeId);
    if (!raw) return null;
    const { ts, reviews, nextPageToken } = JSON.parse(raw);
    // Cache valid for 1 year
    if (Date.now() - ts > 365 * 86400000) return null;
    return { reviews, ts, nextPageToken: nextPageToken || null };
  } catch { return null; }
}

// ─── Overlay Presets ───────────────────────────────────────

type OverlayStyleId =
  | 'dual-tone'
  | 'angled-dual'
  | 'solid'
  | 'solid-blur'
  | 'black-blur'
  | 'white-blur'
  | 'gradient-fade'
  | 'vignette'
  | 'none';

const OVERLAY_PRESETS: { id: OverlayStyleId; label: string; sub: string }[] = [
  { id: 'dual-tone', label: 'Dual Tone', sub: 'Split colors' },
  { id: 'angled-dual', label: 'Angled Dual', sub: 'Diagonal split' },
  { id: 'solid', label: 'Solid Color', sub: '50% opacity' },
  { id: 'solid-blur', label: 'Color Blur', sub: 'Solid + blur' },
  { id: 'black-blur', label: 'Dark Blur', sub: 'Black + blur' },
  { id: 'white-blur', label: 'Light Blur', sub: 'White + blur' },
  { id: 'gradient-fade', label: 'Gradient Fade', sub: 'Top to bottom' },
  { id: 'vignette', label: 'Vignette', sub: 'Dark edges' },
  { id: 'none', label: 'None', sub: 'No overlay' },
];

// ─── Text Layout Presets ──────────────────────────────────

type TextLayoutId = 'card' | 'editorial' | 'minimal' | 'bold-banner' | 'split';

const TEXT_LAYOUTS: { id: TextLayoutId; label: string; sub: string }[] = [
  { id: 'card', label: 'Card', sub: 'Classic white card' },
  { id: 'editorial', label: 'Editorial', sub: 'Quote marks, left-aligned' },
  { id: 'minimal', label: 'Minimal', sub: 'Clean centered text' },
  { id: 'bold-banner', label: 'Bold Banner', sub: 'Large text, no card' },
  { id: 'split', label: 'Split', sub: 'Two-column layout' },
];

// ─── Mini Font Picker (for review generator) ─────────────

function MiniFontPicker({ value, onChange, brandFont, brandFontData }: {
  value: string;
  onChange: (font: string) => void;
  brandFont?: string | null;
  brandFontData?: string | null;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<{ family: string; category: string }[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Load the selected font
  useEffect(() => {
    if (!value || value === brandFont) return;
    const link = document.createElement('link');
    link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(value)}&display=swap`;
    link.rel = 'stylesheet';
    document.head.appendChild(link);
    return () => { document.head.removeChild(link); };
  }, [value, brandFont]);

  const search = useCallback((q: string) => {
    if (!q.trim()) { setResults([]); return; }
    setLoading(true);
    fetch(`/api/content/fonts?q=${encodeURIComponent(q.trim())}`)
      .then(r => r.json())
      .then(data => { setResults(data.fonts || []); setOpen(true); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleChange = (val: string) => {
    setQuery(val);
    clearTimeout(debounceRef.current!);
    debounceRef.current = setTimeout(() => search(val), 300);
  };

  const selectFont = (family: string) => {
    setQuery('');
    onChange(family);
    setOpen(false);
    const link = document.createElement('link');
    link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}&display=swap`;
    link.rel = 'stylesheet';
    document.head.appendChild(link);
  };

  useEffect(() => {
    const handle = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, []);

  const inputCls = "w-full bg-[#0A0A0F] border border-[#27273A] rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 outline-none focus:border-purple-500/40 transition-colors";

  return (
    <div ref={containerRef} className="relative space-y-2">
      {/* Current font display */}
      {value && (
        <div className="flex items-center justify-between bg-[#0A0A0F] border border-[#27273A] rounded-lg px-3 py-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-xs text-white truncate" style={{ fontFamily: `'${value}', serif` }}>{value}</span>
            {value === brandFont && <span className="text-[8px] bg-emerald-500/20 text-emerald-300 px-1.5 py-0.5 rounded-full shrink-0">Brand</span>}
          </div>
          {value !== brandFont && (
            <button
              type="button"
              onClick={() => { onChange(brandFont || ''); setQuery(''); }}
              className="text-[9px] text-zinc-500 hover:text-zinc-300 shrink-0 ml-2"
            >
              Reset
            </button>
          )}
        </div>
      )}

      {/* Search */}
      <input
        className={inputCls}
        value={query}
        onChange={(e) => handleChange(e.target.value)}
        onFocus={() => { if (results.length) setOpen(true); }}
        placeholder="Search Google Fonts to override..."
      />

      {/* Dropdown */}
      {open && results.length > 0 && (
        <div className="absolute z-50 left-0 right-0 mt-1 max-h-44 overflow-y-auto bg-[#12121A] border border-[#27273A] rounded-xl shadow-2xl">
          {results.map((font) => (
            <button
              key={font.family}
              type="button"
              onClick={() => selectFont(font.family)}
              className="w-full text-left px-3 py-2 hover:bg-purple-500/10 transition-colors border-b border-[#27273A] last:border-0"
            >
              <link href={`https://fonts.googleapis.com/css2?family=${encodeURIComponent(font.family)}&text=${encodeURIComponent(font.family)}&display=swap`} rel="stylesheet" />
              <span style={{ fontFamily: `'${font.family}', ${font.category}` }} className="text-xs text-white">{font.family}</span>
              <span className="text-[9px] text-zinc-600 ml-2 capitalize">{font.category}</span>
            </button>
          ))}
        </div>
      )}
      {loading && <p className="text-[10px] text-zinc-500 mt-1">Searching fonts...</p>}
    </div>
  );
}

function buildOverlayStyles(
  style: OverlayStyleId,
  color1: string,
  color2: string,
  hasImage: boolean,
): React.CSSProperties[] {
  // Returns [backgroundStyles, blurStyles] — two layers so blur doesn't affect the overlay color
  const fallbackBg = `linear-gradient(135deg, ${color1} 0%, ${color2} 100%)`;

  switch (style) {
    case 'dual-tone':
      return [{
        position: 'absolute', inset: 0,
        background: hasImage
          ? `linear-gradient(90deg, ${color1}bb 0%, ${color1}bb 50%, ${color2}99 50%, ${color2}99 100%)`
          : `linear-gradient(90deg, ${color1} 0%, ${color1} 50%, ${color2} 50%, ${color2} 100%)`,
      }];
    case 'angled-dual':
      return [{
        position: 'absolute', inset: 0,
        background: hasImage
          ? `linear-gradient(135deg, ${color1}bb 0%, ${color1}bb 50%, ${color2}99 50%, ${color2}99 100%)`
          : `linear-gradient(135deg, ${color1} 0%, ${color1} 50%, ${color2} 50%, ${color2} 100%)`,
      }];
    case 'solid':
      return [{
        position: 'absolute', inset: 0,
        background: hasImage ? `${color1}80` : color1,
      }];
    case 'solid-blur':
      return [
        { position: 'absolute', inset: -20, backdropFilter: 'blur(18px)', WebkitBackdropFilter: 'blur(18px)' } as any,
        { position: 'absolute', inset: 0, background: `${color1}70` },
      ];
    case 'black-blur':
      return [
        { position: 'absolute', inset: -20, backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)' } as any,
        { position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.55)' },
      ];
    case 'white-blur':
      return [
        { position: 'absolute', inset: -20, backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)' } as any,
        { position: 'absolute', inset: 0, background: 'rgba(255,255,255,0.45)' },
      ];
    case 'gradient-fade':
      return [{
        position: 'absolute', inset: 0,
        background: hasImage
          ? `linear-gradient(180deg, ${color1}cc 0%, transparent 40%, transparent 60%, ${color2}cc 100%)`
          : fallbackBg,
      }];
    case 'vignette':
      return [{
        position: 'absolute', inset: 0,
        background: 'radial-gradient(ellipse at center, transparent 30%, rgba(0,0,0,0.75) 100%)',
      }];
    case 'none':
      return [];
    default:
      return [];
  }
}

// ─── Graphic Inner (reusable for preview + export) ────────

const GRAPHIC_FORMATS = [
  { id: 'fb-mobile', label: 'FB Mobile', sub: '1080x1350 (4:5)', w: 1080, h: 1350 },
  { id: 'ig-square', label: 'Square', sub: '1080x1080', w: 1080, h: 1080 },
  { id: 'ig-portrait', label: 'IG Portrait', sub: '1080x1350', w: 1080, h: 1350 },
  { id: 'fb-landscape', label: 'FB Landscape', sub: '1200x630', w: 1200, h: 630 },
  { id: 'story', label: 'Story / Reel', sub: '1080x1920', w: 1080, h: 1920 },
  { id: 'twitter', label: 'X / Twitter', sub: '1600x900', w: 1600, h: 900 },
  { id: 'linkedin', label: 'LinkedIn', sub: '1200x627', w: 1200, h: 627 },
] as const;

type FormatId = (typeof GRAPHIC_FORMATS)[number]['id'];

interface GraphicInnerProps {
  backgroundImage: string | null;
  overlayColor1: string;
  overlayColor2: string;
  overlayStyle: OverlayStyleId;
  gWidth: number;
  gHeight: number;
  company: string;
  logo?: string | null;
  brandFont?: string | null;
  review: ReviewData | null;
  bold: string;
  rest: string;
  pStyle: { reviewerLabel: string; color1: string; color2: string };
  textLayout?: TextLayoutId;
}

// ─── Auto-fit text size helper ───────────────────────────
// Estimates font size so the full review text fits within the given area.
// Starts at baseFontSize and shrinks until it fits, down to minFontSize.

function fitTextSize(
  text: string,
  availableWidth: number,
  availableHeight: number,
  baseFontSize: number,
  lineHeight: number,
  minFontSize: number = 16,
): number {
  if (!text || availableWidth <= 0 || availableHeight <= 0) return baseFontSize;
  const avgCharWidth = 0.52; // average char width as fraction of font size

  let fontSize = baseFontSize;
  while (fontSize > minFontSize) {
    const charsPerLine = Math.floor(availableWidth / (fontSize * avgCharWidth));
    if (charsPerLine <= 0) { fontSize -= 1; continue; }
    // Word-wrap estimation: split into words and simulate line breaks
    const words = text.split(/\s+/);
    let lines = 1;
    let lineLen = 0;
    for (const word of words) {
      if (lineLen + word.length + (lineLen > 0 ? 1 : 0) > charsPerLine) {
        lines++;
        lineLen = word.length;
      } else {
        lineLen += (lineLen > 0 ? 1 : 0) + word.length;
      }
    }
    const heightNeeded = lines * fontSize * lineHeight;
    if (heightNeeded <= availableHeight) return fontSize;
    fontSize -= 1;
  }
  return minFontSize;
}

function proxyUrl(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  if (url.startsWith('data:')) return url;
  if (url.startsWith('/')) return url;
  return `/api/content/image-proxy?url=${encodeURIComponent(url)}`;
}

function GraphicInner({ backgroundImage, overlayColor1, overlayColor2, overlayStyle, gWidth, gHeight, company, logo, brandFont, review, bold, rest, pStyle, textLayout = 'card' }: GraphicInnerProps) {
  const overlayLayers = buildOverlayStyles(overlayStyle, overlayColor1, overlayColor2, !!backgroundImage);
  const isLightOverlay = overlayStyle === 'white-blur';
  const textColor = isLightOverlay ? '#1a1a1a' : 'white';
  const textShadow = isLightOverlay ? 'none' : '2px 4px 24px rgba(0,0,0,0.35)';
  const subTextShadow = isLightOverlay ? 'none' : '1px 2px 8px rgba(0,0,0,0.3)';
  const headingFont = brandFont
    ? `'${brandFont}', Georgia, 'Times New Roman', serif`
    : "'Playfair Display', Georgia, 'Times New Roman', serif";

  // Shared star row
  const starsRow = review ? (
    <div style={{ display: 'flex', gap: 2 }}>
      {Array.from({ length: 5 }, (_, i) => (
        <span key={i} style={{ color: i < review.rating ? '#FBBC05' : '#DDD', fontSize: 26 }}>★</span>
      ))}
    </div>
  ) : null;

  // Shared polaroid photos
  const polaroidPhotos = review?.photos && review.photos.length > 0 ? (() => {
    const angles = [-12, -3, 9];
    const xOffsets = [0, 230, 470];
    const yOffsets = [15, -10, 20];
    return (
      <div style={{ position: 'absolute', bottom: 15, left: 30, width: 780, height: 380, zIndex: 3 }}>
        {review.photos!.slice(0, 3).map((photo, i) => (
          <div key={i} style={{
            position: 'absolute', left: xOffsets[i], bottom: yOffsets[i], width: 280,
            background: 'white', borderRadius: 8, padding: '12px 12px 42px 12px',
            boxShadow: '0 12px 40px rgba(0,0,0,0.45)', transform: `rotate(${angles[i]}deg)`,
          }}>
            <div style={{ width: 256, height: 256, borderRadius: 4, overflow: 'hidden', background: '#ddd' }}>
              <img src={proxyUrl(photo) || ''} alt="" crossOrigin="anonymous" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
            </div>
          </div>
        ))}
      </div>
    );
  })() : null;

  // Platform bubble
  const platformBubble = (
    <div style={{
      position: 'absolute', bottom: 30, right: 60,
      width: 90, height: 90, borderRadius: '50%', background: 'white',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      boxShadow: '0 8px 30px rgba(0,0,0,0.35)', zIndex: 2,
    }}>
      <PlatformBubbleIcon platform={review?.platform || 'google'} size={54} />
    </div>
  );

  // Empty state
  const emptyState = (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2 }}>
      <div style={{ textAlign: 'center', color: 'rgba(255,255,255,0.5)' }}>
        <div style={{ fontSize: 48, marginBottom: 12 }}>★</div>
        <div style={{ fontSize: 18 }}>Enter a review to see the graphic</div>
      </div>
    </div>
  );

  // ── Layout renderers ──────────────────────────────────
  // All layouts auto-size the review text so the entire review is visible.

  const fullText = review ? review.text : '';

  const renderCardLayout = () => {
    // Card occupies ~85% width, with 55px padding each side
    const cardPadX = 110;
    const cardTextW = gWidth * 0.85 - cardPadX;
    // Overhead inside card: name(~50) + label(~30) + marginTop(30) + stars(~60) + platform(~30) + padding(~100) = ~300px
    const cardOverhead = 300;
    // Card stretches to fit — available height for text = card height minus overhead
    // Card can use from ~25% to ~80% of the graphic, more if no photos
    const cardMaxH = review?.photos?.length ? gHeight * 0.48 : gHeight * 0.55;
    const textAvailH = Math.max(cardMaxH - cardOverhead, 120);
    const reviewFs = review ? fitTextSize(fullText, cardTextW, textAvailH, 29, 1.6, 16) : 29;

    return (
      <>
        {/* Header */}
        <div style={{ position: 'absolute', top: 60, left: 65, zIndex: 2 }}>
          <div style={{ fontFamily: headingFont, fontSize: 110, fontWeight: 800, color: textColor, lineHeight: 0.95, textShadow }}>
            Customer<br />Review
          </div>
          <div style={{ color: textColor, fontSize: 22, fontWeight: 600, marginTop: 10, opacity: 0.9, textShadow: subTextShadow }}>{company}</div>
        </div>
        {logo && (
          <img src={proxyUrl(logo) || ''} alt="" crossOrigin="anonymous" style={{
            position: 'absolute', top: 50, right: 60, maxHeight: 350, maxWidth: 550, objectFit: 'contain', zIndex: 2,
            filter: 'drop-shadow(0 2px 12px rgba(0,0,0,0.3))',
          }} />
        )}
        {review ? (
          <>
            <div style={{
              position: 'absolute', top: '50%', left: '50%',
              transform: review.photos?.length ? 'translate(-50%, -55%)' : 'translate(-50%, -45%)',
              width: '85%', background: 'white', borderRadius: 22,
              padding: '50px 55px 48px',
              boxShadow: '0 20px 60px rgba(0,0,0,0.35)', textAlign: 'center', zIndex: 2,
            }}>
              <div style={{ fontSize: 36, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 3, color: '#1a1a1a' }}>{review.reviewerName}</div>
              <div style={{ fontSize: 19, fontStyle: 'italic', color: '#888', marginTop: 6 }}>{pStyle.reviewerLabel}</div>
              <div style={{ fontSize: reviewFs, lineHeight: 1.6, color: '#333', marginTop: 30 }}>
                <span style={{ fontWeight: 700 }}>{bold}</span>
                {rest && <span style={{ fontWeight: 400 }}>{' '}{rest}</span>}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, marginTop: 28 }}>
                {starsRow}
                <span style={{ fontWeight: 700, fontSize: 16, color: '#1a1a1a' }}>{review.rating} Star Review</span>
              </div>
              <div style={{ fontSize: 14, color: '#777', marginTop: 4, textAlign: 'center' }}>
                {review.platform === 'google' && review.localGuideLevel ? `Local Guide · ${review.localGuideLevel} · ` : ''}
                <PlatformCardLogo platform={review.platform} />
              </div>
            </div>
            {polaroidPhotos}
            {platformBubble}
          </>
        ) : emptyState}
      </>
    );
  };

  const renderEditorialLayout = () => {
    // Text area: from 18% to ~72% of height (leaving room for attribution + photos)
    const textW = gWidth - 140; // 70px padding each side
    const attrH = 100; // attribution block height
    const photoH = review?.photos?.length ? 380 : 0;
    const textAvailH = gHeight * (review?.photos?.length ? 0.50 : 0.58) - attrH;
    const reviewFs = review ? fitTextSize(fullText, textW, Math.max(textAvailH, 120), 42, 1.4, 18) : 42;

    return (
      <>
        {/* Large decorative quote mark */}
        <div style={{ position: 'absolute', top: 50, left: 55, fontSize: 280, fontFamily: 'Georgia, serif', color: `${overlayColor1}44`, lineHeight: 0.8, zIndex: 1, userSelect: 'none' }}>"</div>
        {logo && (
          <img src={proxyUrl(logo) || ''} alt="" crossOrigin="anonymous" style={{
            position: 'absolute', top: 50, right: 60, maxHeight: 120, maxWidth: 300, objectFit: 'contain', zIndex: 2,
            filter: 'drop-shadow(0 2px 12px rgba(0,0,0,0.3))',
          }} />
        )}
        {review ? (
          <>
            <div style={{
              position: 'absolute', top: '15%', left: 70, right: 70, bottom: photoH > 0 ? photoH + 20 : 120, zIndex: 2,
              display: 'flex', flexDirection: 'column', justifyContent: 'center',
            }}>
              <div style={{
                fontFamily: headingFont, fontSize: reviewFs, fontWeight: 700,
                color: textColor, lineHeight: 1.4, textShadow,
              }}>
                <span style={{ fontWeight: 800 }}>{bold}</span>
                {rest && <span style={{ fontWeight: 400, opacity: 0.9 }}>{' '}{rest}</span>}
              </div>
              <div style={{ marginTop: 40, display: 'flex', alignItems: 'center', gap: 20, flexShrink: 0 }}>
                {starsRow}
                <div style={{ width: 2, height: 36, background: `${textColor}33` }} />
                <div>
                  <div style={{ fontSize: 28, fontWeight: 800, color: textColor, textTransform: 'uppercase', letterSpacing: 2, textShadow: subTextShadow }}>{review.reviewerName}</div>
                  <div style={{ fontSize: 16, color: textColor, opacity: 0.7, marginTop: 4, textShadow: subTextShadow }}>
                    {pStyle.reviewerLabel} · {company}
                  </div>
                </div>
              </div>
            </div>
            {polaroidPhotos}
            {platformBubble}
          </>
        ) : emptyState}
      </>
    );
  };

  const renderMinimalLayout = () => {
    // Text centered, full width minus padding — stars(~50) + attribution(~80) + platform(~70) = ~200 overhead
    const textW = gWidth * 0.8;
    const overhead = 200;
    const textAvailH = gHeight * 0.65 - overhead;
    const reviewFs = review ? fitTextSize(fullText, textW, Math.max(textAvailH, 120), 38, 1.5, 16) : 38;

    return (
      <>
        {logo && (
          <img src={proxyUrl(logo) || ''} alt="" crossOrigin="anonymous" style={{
            position: 'absolute', top: 50, left: '50%', transform: 'translateX(-50%)',
            maxHeight: 100, maxWidth: 300, objectFit: 'contain', zIndex: 2,
            filter: 'drop-shadow(0 2px 12px rgba(0,0,0,0.3))',
          }} />
        )}
        {review ? (
          <>
            <div style={{
              position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
              width: '80%', textAlign: 'center', zIndex: 2,
            }}>
              <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 30 }}>{starsRow}</div>
              <div style={{
                fontFamily: headingFont, fontSize: reviewFs, lineHeight: 1.5,
                color: textColor, textShadow,
              }}>
                <span style={{ fontWeight: 700 }}>{bold}</span>
                {rest && <span style={{ fontWeight: 400, opacity: 0.9 }}>{' '}{rest}</span>}
              </div>
              <div style={{ marginTop: 35, color: textColor, opacity: 0.7, textShadow: subTextShadow }}>
                <div style={{ fontSize: 20, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 2 }}>{review.reviewerName}</div>
                <div style={{ fontSize: 15, marginTop: 6, opacity: 0.8 }}>{company}</div>
              </div>
            </div>
            <div style={{ position: 'absolute', bottom: 40, left: '50%', transform: 'translateX(-50%)', zIndex: 2 }}>
              <PlatformBubbleIcon platform={review.platform} size={48} />
            </div>
          </>
        ) : emptyState}
      </>
    );
  };

  const renderBoldBannerLayout = () => {
    // Bold uses the full text: bold portion at large size, rest at smaller size
    // Available: from 20% top down to ~120px from bottom (attribution area)
    const textW = gWidth - 130; // 65px padding each side
    const attrH = 120; // bottom attribution
    const starsH = 60;
    const totalAvailH = gHeight * 0.80 - attrH - starsH;
    // Allocate proportionally: bold gets ~65% of space, rest gets ~35%
    const hasBothParts = !!rest;
    const boldAvailH = hasBothParts ? totalAvailH * 0.65 : totalAvailH;
    const restAvailH = hasBothParts ? totalAvailH * 0.35 : 0;
    const boldFs = review ? fitTextSize(bold, textW, Math.max(boldAvailH, 80), 72, 1.15, 22) : 72;
    const restFs = rest ? fitTextSize(rest, textW, Math.max(restAvailH, 60), 26, 1.6, 14) : 26;

    return (
      <>
        {logo && (
          <img src={proxyUrl(logo) || ''} alt="" crossOrigin="anonymous" style={{
            position: 'absolute', top: 45, right: 55, maxHeight: 100, maxWidth: 280, objectFit: 'contain', zIndex: 2,
            filter: 'drop-shadow(0 2px 12px rgba(0,0,0,0.3))',
          }} />
        )}
        {review ? (
          <>
            <div style={{ position: 'absolute', top: 50, left: 65, zIndex: 2 }}>
              <div style={{ display: 'flex', gap: 2 }}>
                {Array.from({ length: 5 }, (_, i) => (
                  <span key={i} style={{ color: i < review.rating ? '#FBBC05' : '#DDD', fontSize: 36 }}>★</span>
                ))}
              </div>
            </div>
            <div style={{
              position: 'absolute', top: '12%', left: 65, right: 65, bottom: attrH + 30, zIndex: 2,
              display: 'flex', flexDirection: 'column', justifyContent: 'center',
            }}>
              <div style={{
                fontFamily: headingFont, fontSize: boldFs, fontWeight: 900, lineHeight: 1.15,
                color: textColor, textShadow,
              }}>
                {bold}
              </div>
              {rest && (
                <div style={{
                  fontSize: restFs, lineHeight: 1.6, color: textColor, opacity: 0.8,
                  marginTop: 24, textShadow: subTextShadow,
                }}>
                  {rest}
                </div>
              )}
            </div>
            <div style={{
              position: 'absolute', bottom: 55, left: 65, right: 65, zIndex: 2,
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                <PlatformBubbleIcon platform={review.platform} size={52} />
                <div>
                  <div style={{ fontSize: 24, fontWeight: 800, color: textColor, textTransform: 'uppercase', letterSpacing: 2, textShadow: subTextShadow }}>
                    {review.reviewerName}
                  </div>
                  <div style={{ fontSize: 15, color: textColor, opacity: 0.7, marginTop: 3, textShadow: subTextShadow }}>
                    {pStyle.reviewerLabel} · {company}
                  </div>
                </div>
              </div>
            </div>
          </>
        ) : emptyState}
      </>
    );
  };

  const renderSplitLayout = () => {
    // Left column: 55% width, padded 65px left 55px right, 60px top/bottom
    const leftPadX = 120; // 65 + 55
    const leftW = gWidth * 0.55 - leftPadX;
    // Overhead: logo(~110) + stars(~50) + attribution(~80) = ~240
    const overhead = (logo ? 110 : 0) + 50 + 80;
    const textAvailH = gHeight - 120 - overhead; // 60px padding top+bottom
    const reviewFs = review ? fitTextSize(fullText, leftW, Math.max(textAvailH, 120), 34, 1.5, 16) : 34;

    return (
      <>
        {review ? (
          <>
            {/* Left column — review text */}
            <div style={{
              position: 'absolute', top: 0, left: 0, width: '55%', height: '100%',
              display: 'flex', flexDirection: 'column', justifyContent: 'center',
              padding: '60px 55px 60px 65px', zIndex: 2,
            }}>
              {logo && (
                <img src={proxyUrl(logo) || ''} alt="" crossOrigin="anonymous" style={{
                  maxHeight: 80, maxWidth: 200, objectFit: 'contain', marginBottom: 30, flexShrink: 0,
                  filter: 'drop-shadow(0 2px 12px rgba(0,0,0,0.3))',
                }} />
              )}
              <div style={{ display: 'flex', gap: 2, marginBottom: 20, flexShrink: 0 }}>
                {Array.from({ length: 5 }, (_, i) => (
                  <span key={i} style={{ color: i < review.rating ? '#FBBC05' : '#DDD', fontSize: 30 }}>★</span>
                ))}
              </div>
              <div style={{
                fontFamily: headingFont, fontSize: reviewFs, lineHeight: 1.5,
                color: textColor, textShadow,
              }}>
                <span style={{ fontWeight: 700 }}>{bold}</span>
                {rest && <span style={{ fontWeight: 400, opacity: 0.9 }}>{' '}{rest}</span>}
              </div>
              <div style={{ marginTop: 30, textShadow: subTextShadow, flexShrink: 0 }}>
                <div style={{ fontSize: 22, fontWeight: 800, color: textColor, textTransform: 'uppercase', letterSpacing: 2 }}>
                  {review.reviewerName}
                </div>
                <div style={{ fontSize: 14, color: textColor, opacity: 0.7, marginTop: 4 }}>
                  {pStyle.reviewerLabel} · {company}
                </div>
              </div>
            </div>
            {/* Right column — decorative / photos / platform */}
            <div style={{
              position: 'absolute', top: 0, right: 0, width: '45%', height: '100%',
              background: `${overlayColor2}33`, zIndex: 2,
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            }}>
              {review.photos && review.photos.length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 40 }}>
                  {review.photos.slice(0, 2).map((photo, i) => (
                    <div key={i} style={{
                      width: gWidth * 0.35, height: gWidth * 0.25,
                      borderRadius: 16, overflow: 'hidden',
                      boxShadow: '0 12px 40px rgba(0,0,0,0.4)',
                    }}>
                      <img src={proxyUrl(photo) || ''} alt="" crossOrigin="anonymous" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ fontSize: 220, fontFamily: 'Georgia, serif', color: `${textColor}15`, lineHeight: 0.8, userSelect: 'none' }}>"</div>
              )}
              <div style={{ position: 'absolute', bottom: 35, right: 35 }}>
                <PlatformBubbleIcon platform={review.platform} size={54} />
              </div>
            </div>
          </>
        ) : emptyState}
      </>
    );
  };

  // ── Main render ───────────────────────────────────────

  const layoutRenderers: Record<TextLayoutId, () => React.ReactNode> = {
    'card': renderCardLayout,
    'editorial': renderEditorialLayout,
    'minimal': renderMinimalLayout,
    'bold-banner': renderBoldBannerLayout,
    'split': renderSplitLayout,
  };

  return (
    <div style={{ width: gWidth, height: gHeight, position: 'relative', overflow: 'hidden', fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif", backgroundColor: '#1a1a2e' }}>
      {backgroundImage && (
        <img src={proxyUrl(backgroundImage) || ''} alt="" crossOrigin="anonymous" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
      )}
      {overlayLayers.map((layerStyle, i) => (
        <div key={i} style={layerStyle as React.CSSProperties} />
      ))}
      {layoutRenderers[textLayout]()}
    </div>
  );
}

// ─── Component ────────────────────────────────────────────

export default function ReviewGraphicGenerator() {
  const { accounts, loading: accountsLoading } = useFirestoreAccounts();

  // Bucket
  const [bucket, setBucket] = useState<BucketItem[]>(() => loadBucket());

  // Core state
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [review, setReview] = useState<ReviewData>({
    reviewerName: '',
    platform: 'google',
    rating: 5,
    text: '',
    localGuideLevel: undefined,
  });
  const [backgroundImage, setBackgroundImage] = useState<string | null>(null);
  const [overlayStyle, setOverlayStyle] = useState<OverlayStyleId>('dual-tone');
  const [graphicFormat, setGraphicFormat] = useState<FormatId>('fb-mobile');
  const [textLayout, setTextLayout] = useState<TextLayoutId>('card');
  const [fontOverride, setFontOverride] = useState<string>('');
  const [customColor1, setCustomColor1] = useState<string>('');
  const [customColor2, setCustomColor2] = useState<string>('');
  const [useCustomColors, setUseCustomColors] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Google search state
  const [reviewSource, setReviewSource] = useState<'manual' | 'google'>('manual');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<PlaceResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [selectedPlace, setSelectedPlace] = useState<PlaceResult | null>(null);
  const [fetchedReviews, setFetchedReviews] = useState<FetchedReview[]>([]);
  const [fetchingReviews, setFetchingReviews] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [reviewsCached, setReviewsCached] = useState(false);
  const [cacheDate, setCacheDate] = useState<number | null>(null);
  const [photosOnly, setPhotosOnly] = useState(false);
  const [hasMoreReviews, setHasMoreReviews] = useState(false);
  const [nextPageToken, setNextPageToken] = useState<string | null>(null);
  const [bundledCaptions, setBundledCaptions] = useState<string[]>([]);

  // Refs
  const graphicRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const gfmt = GRAPHIC_FORMATS.find(f => f.id === graphicFormat) || GRAPHIC_FORMATS[0];
  const GRAPHIC_W = gfmt.w;
  const GRAPHIC_H = gfmt.h;

  const selectedAccount = accounts.find((a) => a.id === selectedAccountId) || null;

  // Font loading (Playfair Display default + brand font if set)
  useEffect(() => {
    const elements: HTMLElement[] = [];
    const addGoogleFont = (family: string, weights = '700;800;900') => {
      const link = document.createElement('link');
      link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}:ital,wght@0,${weights.replace(/;/g, ';0,')};1,${weights.replace(/;/g, ';1,')}&display=swap`;
      link.rel = 'stylesheet';
      document.head.appendChild(link);
      elements.push(link);
    };
    addGoogleFont('Playfair Display');
    if (selectedAccount?.brandFont) {
      if (selectedAccount.brandFontData) {
        // Custom uploaded font — register @font-face
        const style = document.createElement('style');
        style.textContent = `@font-face { font-family: '${selectedAccount.brandFont}'; src: url('${selectedAccount.brandFontData}'); font-display: swap; }`;
        document.head.appendChild(style);
        elements.push(style);
      } else {
        addGoogleFont(selectedAccount.brandFont, '400;600;700;800');
      }
    }
    return () => elements.forEach(el => document.head.removeChild(el));
  }, [selectedAccount?.brandFont, selectedAccount?.brandFontData]);

  // Load font override
  useEffect(() => {
    if (!fontOverride || fontOverride === selectedAccount?.brandFont) return;
    const link = document.createElement('link');
    link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(fontOverride)}:wght@400;600;700;800;900&display=swap`;
    link.rel = 'stylesheet';
    document.head.appendChild(link);
    return () => { document.head.removeChild(link); };
  }, [fontOverride, selectedAccount?.brandFont]);

  // Reset font override when account changes
  useEffect(() => {
    setFontOverride('');
  }, [selectedAccountId]);

  // Sync custom colors to brand colors when account changes
  useEffect(() => {
    if (selectedAccount?.brandColors?.length) {
      setCustomColor1(selectedAccount.brandColors[0]);
      setCustomColor2(selectedAccount.brandColors[1] || selectedAccount.brandColors[0]);
    }
  }, [selectedAccountId]);

  const pStyle = PLATFORM_STYLES[review.platform];
  const baseBrandColor1 = selectedAccount?.brandColors?.[0] || pStyle.color1;
  const baseBrandColor2 = selectedAccount?.brandColors?.[1] || pStyle.color2;
  const overlayColor1 = useCustomColors ? (customColor1 || baseBrandColor1) : baseBrandColor1;
  const overlayColor2 = useCustomColors ? (customColor2 || baseBrandColor2) : baseBrandColor2;
  const activeBrandFont = fontOverride || selectedAccount?.brandFont || null;
  const hasReview = review.reviewerName.trim().length > 0 && review.text.trim().length > 0;

  // Auto-fill search with account company name
  useEffect(() => {
    if (selectedAccount && !searchQuery) {
      setSearchQuery(selectedAccount.company);
    }
  }, [selectedAccount]);

  // ── Handlers ──────────────────────────────────────────

  const handleBackgroundUpload = useCallback((files: FileList | null) => {
    if (!files?.length) return;
    const file = files[0];
    if (!file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = () => setBackgroundImage(reader.result as string);
    reader.readAsDataURL(file);
  }, []);

  const searchPlaces = useCallback(async () => {
    if (!searchQuery.trim()) return;
    setSearching(true);
    setSearchError(null);
    setSearchResults([]);
    setSelectedPlace(null);
    setFetchedReviews([]);
    try {
      const res = await fetch('/api/content/search-places', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: searchQuery.trim() }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setSearchResults(data.places || []);
      if (!data.places?.length) setSearchError('No places found.');
    } catch (e: any) {
      setSearchError(e.message);
    } finally {
      setSearching(false);
    }
  }, [searchQuery]);

  const fetchReviews = useCallback(async (place: PlaceResult, skipCache = false) => {
    setSelectedPlace(place);
    // Auto-set the Google business photo as background
    if (place.photoUrl) {
      setBackgroundImage(place.photoUrl);
    }
    // Try cache first
    if (!skipCache) {
      const cached = getCachedReviews(place.id);
      if (cached) {
        setFetchedReviews(cached.reviews);
        setReviewsCached(true);
        setCacheDate(cached.ts);
        if (cached.nextPageToken) {
          // New cache format — has pagination token
          setHasMoreReviews(true);
          setNextPageToken(cached.nextPageToken);
        } else {
          // Old cache or end of results — force a fresh fetch on "Load More"
          setHasMoreReviews(true);
          setNextPageToken(null);
        }
        return;
      }
    }
    setReviewsCached(false);
    setCacheDate(null);
    setFetchingReviews(true);
    setFetchedReviews([]);
    setHasMoreReviews(false);
    setNextPageToken(null);
    try {
      const res = await fetch('/api/content/place-reviews', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ placeId: place.id }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      const reviews = data.reviews || [];
      setFetchedReviews(reviews);
      setHasMoreReviews(!!data.hasMore);
      setNextPageToken(data.nextPageToken || null);
      setReviewsCached(true);
      setCacheDate(Date.now());
      cacheReviews(place.id, reviews, data.nextPageToken || null);
    } catch (e: any) {
      setSearchError(e.message);
    } finally {
      setFetchingReviews(false);
    }
  }, []);

  const loadMoreReviews = useCallback(async () => {
    if (!selectedPlace || loadingMore || !hasMoreReviews) return;
    setLoadingMore(true);
    try {
      let token = nextPageToken;

      // If no token yet (old cache), do a fresh first-page fetch to get one
      if (!token) {
        const firstRes = await fetch('/api/content/place-reviews', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ placeId: selectedPlace.id }),
        });
        const firstData = await firstRes.json();
        token = firstData.nextPageToken || null;
        if (!token) {
          setHasMoreReviews(false);
          setLoadingMore(false);
          return;
        }
      }

      const res = await fetch('/api/content/place-reviews', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ placeId: selectedPlace.id, nextPageToken: token }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      const newReviews = data.reviews || [];
      // Deduplicate by author name + text
      const existingKeys = new Set(fetchedReviews.map(r => `${r.authorName}::${r.text}`));
      const unique = newReviews.filter((r: any) => !existingKeys.has(`${r.authorName}::${r.text}`));
      const merged = [...fetchedReviews, ...unique];
      setFetchedReviews(merged);
      setHasMoreReviews(!!data.hasMore);
      setNextPageToken(data.nextPageToken || null);
      cacheReviews(selectedPlace.id, merged, data.nextPageToken || null);
    } catch (e: any) {
      setSearchError(e.message);
    } finally {
      setLoadingMore(false);
    }
  }, [selectedPlace, loadingMore, hasMoreReviews, nextPageToken, fetchedReviews]);

  const selectFetchedReview = (r: FetchedReview) => {
    setReview({
      reviewerName: r.authorName,
      platform: 'google',
      rating: r.rating,
      text: r.text,
      photos: r.photos,
    });
    // Auto-set first reviewer photo as background if available and no background set
    if (r.photos.length > 0 && !backgroundImage) {
      setBackgroundImage(r.photos[0]);
    }
    setError(null);
  };

  // ── Bucket operations ──────────────────────────────────

  const saveToBucket = useCallback(() => {
    if (!hasReview || !selectedAccount) return;
    const item: BucketItem = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      timestamp: Date.now(),
      accountId: selectedAccount.id,
      accountName: selectedAccount.company,
      accountAvatar: selectedAccount.avatar,
      review: { ...review },
      backgroundImage: backgroundImage && !backgroundImage.startsWith('data:') ? backgroundImage : null,
      overlayStyle,
      placeId: selectedPlace?.id,
      placeName: selectedPlace?.name,
      captions: bundledCaptions.length > 0 ? bundledCaptions : undefined,
    };
    const updated = [item, ...bucket.filter(b =>
      !(b.review.reviewerName === review.reviewerName && b.accountId === selectedAccount.id)
    )];
    setBucket(updated);
    saveBucket(updated);
  }, [hasReview, selectedAccount, review, backgroundImage, overlayStyle, selectedPlace, bucket, bundledCaptions]);

  const loadFromBucket = useCallback((item: BucketItem) => {
    setSelectedAccountId(item.accountId);
    setReview(item.review);
    if (item.backgroundImage) setBackgroundImage(item.backgroundImage);
    setOverlayStyle(item.overlayStyle);
    setBundledCaptions(item.captions || []);
    if (item.placeId) {
      setSelectedPlace({ id: item.placeId, name: item.placeName || '', address: '' });
      setReviewSource('google');
      const cached = getCachedReviews(item.placeId);
      if (cached) {
        setFetchedReviews(cached.reviews);
        setReviewsCached(true);
        setCacheDate(cached.ts);
      }
    }
    setError(null);
  }, []);

  const removeFromBucket = useCallback((id: string) => {
    const updated = bucket.filter(b => b.id !== id);
    setBucket(updated);
    saveBucket(updated);
  }, [bucket]);

  const handleExport = useCallback(async () => {
    if (!graphicRef.current) return;
    setExporting(true);
    try {
      await document.fonts.ready;
      const dataUrl = await toPng(graphicRef.current, {
        width: GRAPHIC_W,
        height: GRAPHIC_H,
        pixelRatio: 2,
        quality: 1.0,
        style: { transform: 'none' },
        cacheBust: true,
      });
      const link = document.createElement('a');
      link.download = `review-${selectedAccount?.company?.replace(/\s+/g, '-') || 'graphic'}-${Date.now()}.png`;
      link.href = dataUrl;
      link.click();
      // Auto-save to flow bucket
      const b64 = dataUrl.split(',')[1];
      addToFlowBucket({ name: `Review - ${review.reviewerName}`, base64: b64, mimeType: 'image/png' });
      // Auto-save to bucket on successful export
      saveToBucket();
    } catch (e: any) {
      setError('Export failed: ' + e.message);
    } finally {
      setExporting(false);
    }
  }, [selectedAccount, saveToBucket]);

  // ── Derived ───────────────────────────────────────────

  const { bold, rest } = splitFirstSentence(review.text);

  // ── Render ────────────────────────────────────────────

  return (
    <div className="space-y-5 max-w-7xl">
      {/* ── Caption Widget (sliding left panel) ────────── */}
      <CaptionWidget
        brandContext={selectedAccount ? {
          company: selectedAccount.company,
          industry: selectedAccount.industry,
          description: selectedAccount.description,
          brandVoice: selectedAccount.brandVoice,
          targetAudience: selectedAccount.targetAudience,
          socialHandles: selectedAccount.socialHandles,
        } : null}
        contentContext={hasReview ? `Customer review for ${selectedAccount?.company || 'business'}: "${review.text}" — ${review.rating} star review by ${review.reviewerName} on ${review.platform}` : undefined}
        savedCaptions={bundledCaptions}
        onCaptionsSaved={(captions) => setBundledCaptions(captions)}
      />

      {/* ── Bucket: Saved Review Graphics ──────────────── */}
      {bucket.length > 0 && (
        <div className="bg-[#12121A] border border-[#27273A] rounded-2xl p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-medium text-zinc-400 uppercase tracking-wider">Recent</h3>
            <span className="text-[10px] text-zinc-600">{bucket.length} saved</span>
          </div>
          <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-thin">
            {bucket.map((item) => (
              <button
                key={item.id}
                onClick={() => loadFromBucket(item)}
                className="group relative flex-shrink-0 w-44 bg-[#0A0A0F] border border-[#27273A] rounded-xl p-3 text-left hover:border-purple-500/30 hover:bg-purple-500/5 transition-all"
              >
                {/* Remove button */}
                <div
                  onClick={(e) => { e.stopPropagation(); removeFromBucket(item.id); }}
                  className="absolute top-1.5 right-1.5 p-1 rounded-md bg-[#12121A] border border-[#27273A] text-zinc-600 hover:text-red-400 hover:border-red-500/30 opacity-0 group-hover:opacity-100 transition-all cursor-pointer"
                >
                  <X size={10} />
                </div>
                {/* Content */}
                <div className="flex items-center gap-2 mb-2">
                  <img
                    src={item.accountAvatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(item.accountName)}&background=27273A&color=fff&size=20`}
                    alt=""
                    className="w-5 h-5 rounded-md border border-[#27273A] object-cover"
                  />
                  <span className="text-[10px] text-zinc-500 truncate">{item.accountName}</span>
                </div>
                <p className="text-[11px] font-medium text-white truncate">{item.review.reviewerName}</p>
                <div className="flex items-center gap-1.5 mt-1">
                  <span className="text-[10px] text-amber-400">{'★'.repeat(item.review.rating)}</span>
                  <span className="text-[9px] text-zinc-600 capitalize">{item.review.platform}</span>
                </div>
                <p className="text-[9px] text-zinc-500 mt-1.5 line-clamp-2 leading-relaxed">{item.review.text}</p>
                <div className="flex items-center gap-1.5 mt-2">
                  <div className="flex gap-0.5">
                    <div className="w-3 h-3 rounded-sm" style={{ background: PLATFORM_STYLES[item.review.platform]?.color1 || '#333' }} />
                    <div className="w-3 h-3 rounded-sm" style={{ background: PLATFORM_STYLES[item.review.platform]?.color2 || '#555' }} />
                  </div>
                  <span className="text-[8px] text-zinc-600">
                    {new Date(item.timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                  </span>
                  {item.review.photos && item.review.photos.length > 0 && (
                    <span className="text-[8px] text-zinc-600 flex items-center gap-0.5">
                      <Image size={8} /> {item.review.photos.length}
                    </span>
                  )}
                  {item.captions && item.captions.length > 0 && (
                    <span className="text-[8px] text-purple-400 flex items-center gap-0.5">
                      <Type size={8} /> {item.captions.length}
                    </span>
                  )}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Brand Selector ─────────────────────────────── */}
      <div className="bg-[#12121A] border border-[#27273A] rounded-2xl p-5">
        <h3 className="text-sm font-medium text-zinc-400 uppercase tracking-wider mb-3">Select Brand</h3>
        {accountsLoading ? (
          <p className="text-sm text-zinc-600">Loading accounts...</p>
        ) : accounts.length === 0 ? (
          <p className="text-sm text-zinc-500">No accounts yet. Add one in the CRM.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {accounts.map((acct) => (
              <button
                key={acct.id}
                onClick={() => { setSelectedAccountId(acct.id); setError(null); }}
                className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-left transition-all border ${
                  selectedAccountId === acct.id
                    ? 'bg-purple-500/10 border-purple-500/30'
                    : 'border-[#27273A] hover:bg-[#181824]'
                }`}
              >
                <img
                  src={
                    acct.avatar ||
                    `https://ui-avatars.com/api/?name=${encodeURIComponent(acct.company)}&background=27273A&color=fff&size=28`
                  }
                  alt=""
                  className="w-7 h-7 rounded-lg border border-[#27273A] object-cover shrink-0"
                />
                <span className="text-xs font-medium text-white truncate max-w-[120px]">{acct.company}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── Main Layout ────────────────────────────────── */}
      <AnimatePresence>
        {selectedAccount && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-6">
              {/* ── LEFT: Platform Preview ──────────────── */}
              <div className="space-y-4">
                <div className="bg-[#12121A] border border-[#27273A] rounded-2xl p-5">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-sm font-medium text-zinc-400 uppercase tracking-wider">Platform Preview</h3>
                    {hasReview && (
                      <button
                        onClick={handleExport}
                        disabled={exporting}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-gradient-to-r from-purple-600 to-purple-500 text-white hover:from-purple-500 hover:to-purple-400 transition-all disabled:opacity-40"
                      >
                        {exporting ? <Loader size={12} className="animate-spin" /> : <Download size={12} />}
                        {exporting ? 'Exporting...' : 'Download PNG'}
                      </button>
                    )}
                  </div>

                  <SocialPostPreview
                    accountName={selectedAccount.company}
                    accountAvatar={selectedAccount.avatar}
                    defaultPlatform="instagram"
                    imageContent={<GraphicInner
                      backgroundImage={backgroundImage}
                      overlayColor1={overlayColor1}
                      overlayColor2={overlayColor2}
                      overlayStyle={overlayStyle}
                      gWidth={GRAPHIC_W}
                      gHeight={GRAPHIC_H}
                      company={selectedAccount.company}
                      logo={selectedAccount.primaryLogo || selectedAccount.lightLogo || selectedAccount.logo}
                      brandFont={activeBrandFont}
                      review={hasReview ? review : null}
                      bold={bold}
                      rest={rest}
                      pStyle={pStyle}
                      textLayout={textLayout}
                    />}
                  />
                </div>

                {/* Hidden full-size graphic for PNG export */}
                <div style={{ position: 'absolute', left: -9999, top: -9999, pointerEvents: 'none' }}>
                  <div
                    ref={graphicRef}
                    style={{
                      width: GRAPHIC_W,
                      height: GRAPHIC_H,
                      position: 'relative',
                      overflow: 'hidden',
                      fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif",
                      backgroundColor: '#1a1a2e',
                    }}
                  >
                    <GraphicInner
                      backgroundImage={backgroundImage}
                      overlayColor1={overlayColor1}
                      overlayColor2={overlayColor2}
                      overlayStyle={overlayStyle}
                      gWidth={GRAPHIC_W}
                      gHeight={GRAPHIC_H}
                      company={selectedAccount.company}
                      logo={selectedAccount.primaryLogo || selectedAccount.lightLogo || selectedAccount.logo}
                      brandFont={activeBrandFont}
                      review={hasReview ? review : null}
                      bold={bold}
                      rest={rest}
                      pStyle={pStyle}
                      textLayout={textLayout}
                    />
                  </div>
                </div>

                {error && (
                  <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-3">
                    <p className="text-xs text-red-400">{error}</p>
                  </div>
                )}
              </div>

              {/* ── RIGHT: Controls ─────────────────────── */}
              <div className="space-y-4">
                {/* Background Image */}
                <div className="bg-[#12121A] border border-[#27273A] rounded-2xl p-5">
                  <h3 className="text-sm font-medium text-zinc-400 uppercase tracking-wider mb-3">
                    Background Photo
                  </h3>
                  {backgroundImage ? (
                    <div className="relative">
                      <img
                        src={backgroundImage}
                        alt=""
                        className="w-full h-32 rounded-xl object-cover border border-[#27273A]"
                      />
                      <button
                        onClick={() => setBackgroundImage(null)}
                        className="absolute top-2 right-2 p-1.5 rounded-lg bg-black/60 text-white hover:bg-black/80 transition-colors"
                      >
                        <X size={12} />
                      </button>
                    </div>
                  ) : (
                    <div
                      onClick={() => fileInputRef.current?.click()}
                      className="border-2 border-dashed border-[#27273A] rounded-xl p-6 text-center cursor-pointer hover:border-zinc-600 hover:bg-[#0A0A0F] transition-all"
                    >
                      <Upload size={24} className="mx-auto mb-2 text-zinc-500" />
                      <p className="text-xs text-zinc-400">Upload a business photo</p>
                      <p className="text-[10px] text-zinc-600 mt-1">JPG, PNG, WebP</p>
                    </div>
                  )}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="hidden"
                    onChange={(e) => handleBackgroundUpload(e.target.files)}
                  />
                </div>

                {/* Overlay Style */}
                <div className="bg-[#12121A] border border-[#27273A] rounded-2xl p-5">
                  <h3 className="text-sm font-medium text-zinc-400 uppercase tracking-wider mb-3">
                    Overlay Style
                  </h3>
                  <div className="grid grid-cols-3 gap-1.5">
                    {OVERLAY_PRESETS.map((preset) => (
                      <button
                        key={preset.id}
                        onClick={() => setOverlayStyle(preset.id)}
                        className={`px-2 py-2.5 rounded-xl border text-center transition-all ${
                          overlayStyle === preset.id
                            ? 'bg-purple-500/10 border-purple-500/30'
                            : 'border-[#27273A] bg-[#0A0A0F] hover:border-zinc-600'
                        }`}
                      >
                        <p className={`text-[11px] font-medium leading-tight ${
                          overlayStyle === preset.id ? 'text-purple-300' : 'text-zinc-300'
                        }`}>
                          {preset.label}
                        </p>
                        <p className="text-[9px] text-zinc-500 mt-0.5">{preset.sub}</p>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Overlay Colors */}
                <div className="bg-[#12121A] border border-[#27273A] rounded-2xl p-5">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-medium text-zinc-400 uppercase tracking-wider">
                      <Droplet size={12} className="inline mr-1.5 -mt-0.5" />Overlay Colors
                    </h3>
                    <button
                      onClick={() => setUseCustomColors(!useCustomColors)}
                      className={`text-[10px] px-2.5 py-1 rounded-lg border transition-all ${
                        useCustomColors
                          ? 'bg-purple-500/15 border-purple-500/30 text-purple-300'
                          : 'border-[#27273A] text-zinc-500 hover:text-zinc-300'
                      }`}
                    >
                      {useCustomColors ? 'Custom' : 'Brand Default'}
                    </button>
                  </div>

                  {/* Brand color quick-picks */}
                  {selectedAccount?.brandColors && selectedAccount.brandColors.length > 0 && (
                    <div className="mb-3">
                      <p className="text-[10px] text-zinc-500 mb-1.5">Brand Colors</p>
                      <div className="flex items-center gap-1.5">
                        {(selectedAccount.brandColors as string[]).map((c, i) => (
                          <button
                            key={i}
                            type="button"
                            onClick={() => {
                              setUseCustomColors(true);
                              // Alternate filling color1/color2
                              if (customColor1 === c) {
                                setCustomColor2(c);
                              } else {
                                setCustomColor1(c);
                              }
                            }}
                            className="group/swatch"
                            title={c}
                          >
                            <div className="w-7 h-7 rounded-lg border-2 border-[#27273A] group-hover/swatch:border-purple-500 transition-colors" style={{ backgroundColor: c }} />
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Custom color pickers */}
                  {useCustomColors && (
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-[10px] text-zinc-500 mb-1 block">Color 1</label>
                        <div className="flex items-center gap-2">
                          <input
                            type="color"
                            value={customColor1 || baseBrandColor1}
                            onChange={(e) => setCustomColor1(e.target.value)}
                            className="w-8 h-8 rounded-lg border border-[#27273A] cursor-pointer bg-transparent [&::-webkit-color-swatch-wrapper]:p-0.5 [&::-webkit-color-swatch]:rounded-md [&::-webkit-color-swatch]:border-0"
                          />
                          <input
                            type="text"
                            value={customColor1 || baseBrandColor1}
                            onChange={(e) => setCustomColor1(e.target.value)}
                            className="flex-1 bg-[#0A0A0F] border border-[#27273A] rounded-lg px-2 py-1.5 text-[11px] text-white font-mono outline-none focus:border-purple-500/40"
                          />
                        </div>
                      </div>
                      <div>
                        <label className="text-[10px] text-zinc-500 mb-1 block">Color 2</label>
                        <div className="flex items-center gap-2">
                          <input
                            type="color"
                            value={customColor2 || baseBrandColor2}
                            onChange={(e) => setCustomColor2(e.target.value)}
                            className="w-8 h-8 rounded-lg border border-[#27273A] cursor-pointer bg-transparent [&::-webkit-color-swatch-wrapper]:p-0.5 [&::-webkit-color-swatch]:rounded-md [&::-webkit-color-swatch]:border-0"
                          />
                          <input
                            type="text"
                            value={customColor2 || baseBrandColor2}
                            onChange={(e) => setCustomColor2(e.target.value)}
                            className="flex-1 bg-[#0A0A0F] border border-[#27273A] rounded-lg px-2 py-1.5 text-[11px] text-white font-mono outline-none focus:border-purple-500/40"
                          />
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Color preview strip */}
                  <div className="mt-3 flex rounded-lg overflow-hidden h-4 border border-[#27273A]">
                    <div className="flex-1" style={{ background: overlayColor1 }} />
                    <div className="flex-1" style={{ background: overlayColor2 }} />
                  </div>
                </div>

                {/* Text Layout */}
                <div className="bg-[#12121A] border border-[#27273A] rounded-2xl p-5">
                  <h3 className="text-sm font-medium text-zinc-400 uppercase tracking-wider mb-3">
                    <Layout size={12} className="inline mr-1.5 -mt-0.5" />Text Layout
                  </h3>
                  <div className="grid grid-cols-3 gap-1.5">
                    {TEXT_LAYOUTS.map((layout) => (
                      <button
                        key={layout.id}
                        onClick={() => setTextLayout(layout.id)}
                        className={`px-2 py-2.5 rounded-xl border text-center transition-all ${
                          textLayout === layout.id
                            ? 'bg-purple-500/10 border-purple-500/30'
                            : 'border-[#27273A] bg-[#0A0A0F] hover:border-zinc-600'
                        }`}
                      >
                        <p className={`text-[11px] font-medium leading-tight ${
                          textLayout === layout.id ? 'text-purple-300' : 'text-zinc-300'
                        }`}>
                          {layout.label}
                        </p>
                        <p className="text-[9px] text-zinc-500 mt-0.5">{layout.sub}</p>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Font Override */}
                <div className="bg-[#12121A] border border-[#27273A] rounded-2xl p-5">
                  <h3 className="text-sm font-medium text-zinc-400 uppercase tracking-wider mb-3">
                    <Type size={12} className="inline mr-1.5 -mt-0.5" />Font
                  </h3>
                  <MiniFontPicker
                    value={activeBrandFont || ''}
                    onChange={(font) => setFontOverride(font)}
                    brandFont={selectedAccount?.brandFont}
                    brandFontData={selectedAccount?.brandFontData}
                  />
                </div>

                {/* Format / Dimensions */}
                <div className="bg-[#12121A] border border-[#27273A] rounded-2xl p-5">
                  <h3 className="text-sm font-medium text-zinc-400 uppercase tracking-wider mb-3">
                    Format
                  </h3>
                  <div className="grid grid-cols-2 gap-1.5">
                    {GRAPHIC_FORMATS.map((fmt) => (
                      <button
                        key={fmt.id}
                        onClick={() => setGraphicFormat(fmt.id)}
                        className={`px-2 py-2 rounded-xl border text-center transition-all ${
                          graphicFormat === fmt.id
                            ? 'bg-purple-500/10 border-purple-500/30'
                            : 'border-[#27273A] bg-[#0A0A0F] hover:border-zinc-600'
                        }`}
                      >
                        <p className={`text-[11px] font-medium leading-tight ${
                          graphicFormat === fmt.id ? 'text-purple-300' : 'text-zinc-300'
                        }`}>{fmt.label}</p>
                        <p className="text-[9px] text-zinc-500 mt-0.5">{fmt.sub}</p>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Review Source Toggle */}
                <div className="bg-[#12121A] border border-[#27273A] rounded-2xl p-5">
                  <h3 className="text-sm font-medium text-zinc-400 uppercase tracking-wider mb-3">
                    Review Source
                  </h3>
                  <div className="flex gap-1 bg-[#0A0A0F] rounded-xl p-1 mb-4">
                    {(['manual', 'google'] as const).map((mode) => (
                      <button
                        key={mode}
                        onClick={() => setReviewSource(mode)}
                        className={`flex-1 px-3 py-2 rounded-lg text-xs font-medium transition-all ${
                          reviewSource === mode
                            ? 'bg-purple-500/15 text-purple-300 border border-purple-500/30'
                            : 'text-zinc-400 hover:text-zinc-200 border border-transparent'
                        }`}
                      >
                        {mode === 'manual' ? 'Manual Entry' : 'Search Google'}
                      </button>
                    ))}
                  </div>

                  {reviewSource === 'google' ? (
                    <div className="space-y-3">
                      {/* Search bar */}
                      <div className="flex gap-2">
                        <input
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && searchPlaces()}
                          placeholder="Business name or address..."
                          className="flex-1 bg-[#0A0A0F] border border-[#27273A] rounded-xl px-3 py-2.5 text-sm text-white placeholder-zinc-600 outline-none focus:border-purple-500/40 transition-colors"
                        />
                        <button
                          onClick={searchPlaces}
                          disabled={searching || !searchQuery.trim()}
                          className="px-3 py-2.5 rounded-xl bg-purple-600 text-white hover:bg-purple-500 transition-colors disabled:opacity-40"
                        >
                          {searching ? <Loader size={14} className="animate-spin" /> : <Search size={14} />}
                        </button>
                      </div>

                      {searchError && (
                        <p className="text-[11px] text-amber-400">{searchError}</p>
                      )}

                      {/* Search Results */}
                      {searchResults.length > 0 && !selectedPlace && (
                        <div className="space-y-1.5 max-h-48 overflow-y-auto">
                          {searchResults.map((place) => (
                            <button
                              key={place.id}
                              onClick={() => fetchReviews(place)}
                              className="w-full text-left p-3 rounded-xl border border-[#27273A] hover:border-purple-500/30 hover:bg-purple-500/5 transition-all"
                            >
                              <p className="text-xs font-medium text-white truncate">{place.name}</p>
                              <p className="text-[10px] text-zinc-500 truncate flex items-center gap-1">
                                <MapPin size={9} /> {place.address}
                              </p>
                              {place.rating && (
                                <p className="text-[10px] text-zinc-400 mt-0.5">
                                  <span className="text-amber-400">★</span> {place.rating}
                                  {place.reviewCount ? ` (${place.reviewCount} reviews)` : ''}
                                </p>
                              )}
                            </button>
                          ))}
                        </div>
                      )}

                      {/* Selected Place + Reviews */}
                      {selectedPlace && (
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <p className="text-xs text-zinc-300 font-medium truncate flex-1">
                              {selectedPlace.name}
                            </p>
                            <button
                              onClick={() => {
                                setSelectedPlace(null);
                                setFetchedReviews([]);
                                setReviewsCached(false);
                                setCacheDate(null);
                              }}
                              className="text-[10px] text-zinc-500 hover:text-zinc-300 flex items-center gap-1"
                            >
                              <X size={10} /> Change
                            </button>
                          </div>

                          {/* Cache status indicator */}
                          {reviewsCached && cacheDate && (
                            <div className="flex items-center justify-between bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-2.5 py-1.5 mb-2">
                              <div className="flex items-center gap-1.5">
                                <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                                <span className="text-[10px] text-emerald-400 font-medium">Cached</span>
                                <span className="text-[9px] text-emerald-400/60">
                                  {new Date(cacheDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                                </span>
                              </div>
                              <button
                                type="button"
                                onClick={() => {
                                  localStorage.removeItem(REVIEW_CACHE_PREFIX + selectedPlace.id);
                                  setReviewsCached(false);
                                  setCacheDate(null);
                                  fetchReviews({ ...selectedPlace, photoUrl: null }, true);
                                }}
                                className="text-[9px] text-emerald-400/60 hover:text-emerald-300 transition-colors"
                              >
                                Refresh
                              </button>
                            </div>
                          )}

                          {/* Photo filter toggle */}
                          {!fetchingReviews && fetchedReviews.some(r => r.photos.length > 0) && (
                            <button
                              onClick={() => setPhotosOnly(!photosOnly)}
                              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[10px] font-medium transition-all border ${
                                photosOnly
                                  ? 'bg-purple-500/15 border-purple-500/30 text-purple-300'
                                  : 'border-[#27273A] text-zinc-500 hover:text-zinc-300'
                              }`}
                            >
                              <Image size={10} />
                              {photosOnly ? 'Showing with photos' : 'Filter: has photos'}
                            </button>
                          )}

                          {fetchingReviews ? (
                            <div className="flex items-center gap-2 py-4 justify-center">
                              <Loader size={14} className="animate-spin text-purple-400" />
                              <span className="text-xs text-zinc-400">Fetching reviews...</span>
                            </div>
                          ) : fetchedReviews.length > 0 ? (
                            <div className="space-y-1.5 max-h-64 overflow-y-auto">
                              {fetchedReviews.filter(r => !photosOnly || r.photos.length > 0).map((r, i) => (
                                <button
                                  key={i}
                                  onClick={() => selectFetchedReview(r)}
                                  className={`w-full text-left p-3 rounded-xl border transition-all ${
                                    review.text === r.text
                                      ? 'border-purple-500/40 bg-purple-500/10'
                                      : 'border-[#27273A] hover:border-purple-500/20 hover:bg-[#181824]'
                                  }`}
                                >
                                  <div className="flex items-center justify-between mb-1">
                                    <p className="text-[11px] font-medium text-white">{r.authorName}</p>
                                    <span className="text-[10px] text-amber-400">
                                      {'★'.repeat(r.rating)}{'☆'.repeat(5 - r.rating)}
                                    </span>
                                  </div>
                                  <p className="text-[10px] text-zinc-400 line-clamp-2 leading-relaxed">
                                    {r.text}
                                  </p>
                                  {r.photos.length > 0 && (
                                    <div className="flex gap-1 mt-1.5">
                                      {r.photos.slice(0, 4).map((photo, pi) => (
                                        <img key={pi} src={photo} alt="" className="w-10 h-10 rounded-md object-cover border border-[#27273A]" />
                                      ))}
                                      {r.photos.length > 4 && (
                                        <span className="w-10 h-10 rounded-md bg-[#0A0A0F] border border-[#27273A] flex items-center justify-center text-[9px] text-zinc-500">
                                          +{r.photos.length - 4}
                                        </span>
                                      )}
                                    </div>
                                  )}
                                  <p className="text-[9px] text-zinc-600 mt-1">{r.relativeTime}</p>
                                </button>
                              ))}
                              {hasMoreReviews && (
                                <button
                                  onClick={loadMoreReviews}
                                  disabled={loadingMore}
                                  className="w-full mt-2 py-2 rounded-xl border border-[#27273A] text-xs font-medium text-zinc-400 hover:text-purple-300 hover:border-purple-500/30 hover:bg-purple-500/5 transition-all disabled:opacity-40"
                                >
                                  {loadingMore ? (
                                    <span className="flex items-center justify-center gap-2">
                                      <Loader size={12} className="animate-spin" /> Loading more...
                                    </span>
                                  ) : (
                                    `Load More Reviews`
                                  )}
                                </button>
                              )}
                            </div>
                          ) : (
                            <p className="text-xs text-zinc-500 py-2 text-center">No reviews found.</p>
                          )}
                        </div>
                      )}
                    </div>
                  ) : (
                    /* ── Manual Entry Form ────────────── */
                    <div className="space-y-3">
                      <div>
                        <label className="text-[11px] text-zinc-500 uppercase tracking-wider font-medium mb-1 block">
                          Reviewer Name
                        </label>
                        <input
                          value={review.reviewerName}
                          onChange={(e) => setReview((r) => ({ ...r, reviewerName: e.target.value }))}
                          placeholder="e.g. Eric W."
                          className="w-full bg-[#0A0A0F] border border-[#27273A] rounded-xl px-3 py-2.5 text-sm text-white placeholder-zinc-600 outline-none focus:border-purple-500/40 transition-colors"
                        />
                      </div>
                      <div>
                        <label className="text-[11px] text-zinc-500 uppercase tracking-wider font-medium mb-1 block">
                          Review Text
                        </label>
                        <textarea
                          value={review.text}
                          onChange={(e) => setReview((r) => ({ ...r, text: e.target.value }))}
                          placeholder="Paste the review here..."
                          rows={4}
                          className="w-full bg-[#0A0A0F] border border-[#27273A] rounded-xl px-3 py-2.5 text-sm text-white placeholder-zinc-600 outline-none resize-none focus:border-purple-500/40 transition-colors"
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="text-[11px] text-zinc-500 uppercase tracking-wider font-medium mb-1 block">
                            Rating
                          </label>
                          <div className="flex gap-1">
                            {[1, 2, 3, 4, 5].map((n) => (
                              <button
                                key={n}
                                onClick={() => setReview((r) => ({ ...r, rating: n }))}
                                className={`text-lg transition-colors ${
                                  n <= review.rating ? 'text-amber-400' : 'text-zinc-600'
                                }`}
                              >
                                ★
                              </button>
                            ))}
                          </div>
                        </div>
                        <div>
                          <label className="text-[11px] text-zinc-500 uppercase tracking-wider font-medium mb-1 block">
                            Guide Level
                          </label>
                          <input
                            type="number"
                            min={1}
                            max={10}
                            value={review.localGuideLevel || ''}
                            onChange={(e) =>
                              setReview((r) => ({
                                ...r,
                                localGuideLevel: e.target.value ? parseInt(e.target.value) : undefined,
                              }))
                            }
                            placeholder="Optional"
                            className="w-full bg-[#0A0A0F] border border-[#27273A] rounded-xl px-3 py-2 text-sm text-white placeholder-zinc-600 outline-none focus:border-purple-500/40 transition-colors"
                          />
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Platform Selector */}
                <div className="bg-[#12121A] border border-[#27273A] rounded-2xl p-5">
                  <h3 className="text-sm font-medium text-zinc-400 uppercase tracking-wider mb-3">
                    Platform
                  </h3>
                  <div className="grid grid-cols-2 gap-1.5">
                    {PLATFORMS.map((p) => (
                      <button
                        key={p.id}
                        onClick={() => setReview((r) => ({ ...r, platform: p.id }))}
                        className={`px-3 py-2.5 rounded-xl border text-xs font-medium transition-all text-center ${
                          review.platform === p.id
                            ? 'bg-purple-500/10 border-purple-500/30 text-purple-300'
                            : 'border-[#27273A] bg-[#0A0A0F] text-zinc-400 hover:border-zinc-600'
                        }`}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Quick Actions */}
                {hasReview && (
                  <div className="bg-[#12121A] border border-[#27273A] rounded-2xl p-5 space-y-3">
                    <h3 className="text-sm font-medium text-zinc-400 uppercase tracking-wider">Actions</h3>
                    <button
                      onClick={handleExport}
                      disabled={exporting}
                      className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-gradient-to-r from-purple-600 to-purple-500 text-sm text-white font-medium hover:from-purple-500 hover:to-purple-400 transition-all shadow-[0_0_15px_rgba(168,85,247,0.2)] disabled:opacity-40"
                    >
                      {exporting ? (
                        <>
                          <Loader size={14} className="animate-spin" /> Exporting...
                        </>
                      ) : (
                        <>
                          <Download size={14} /> Download Review Graphic
                        </>
                      )}
                    </button>
                    <button
                      onClick={() => {
                        setReview({ reviewerName: '', platform: review.platform, rating: 5, text: '' });
                        setError(null);
                      }}
                      className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-[#27273A] text-xs text-zinc-400 hover:text-zinc-200 hover:bg-[#181824] transition-all"
                    >
                      <RefreshCw size={12} /> New Review
                    </button>
                    <button
                      onClick={saveToBucket}
                      className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-[#27273A] text-xs text-zinc-400 hover:text-zinc-200 hover:bg-[#181824] transition-all"
                    >
                      <Bookmark size={12} /> Save to Bucket
                    </button>
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
