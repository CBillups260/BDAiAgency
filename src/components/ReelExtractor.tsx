import { authedFetch } from '../lib/api';
import React, { useState } from 'react';
import { usePersistedState } from '../hooks/usePersistedState';
import {
  Link as LinkIcon,
  Download,
  Loader,
  Copy,
  Check,
  Eye,
  Heart,
  ExternalLink,
  Film,
  AlertCircle,
  Play,
  Edit3,
} from '@geist-ui/icons';
import { motion } from 'motion/react';
import ReelBrander from './ReelBrander';

type Platform = 'facebook' | 'instagram' | 'tiktok';

interface ExtractDownload {
  quality: string;
  url: string;
  recommended?: boolean;
}

interface ExtractResult {
  platform: Platform;
  sourceUrl: string;
  caption: string;
  thumbnail: string | null;
  author: string | null;
  views: number;
  likes: number;
  width: number | null;
  height: number | null;
  downloads: ExtractDownload[];
}

const DEFAULT_ASPECT = 9 / 16;

/** Reduce w:h to a tidy label ("9:16", "16:9", "1:1"); fall back to WxH. */
function ratioLabel(w: number, h: number): string {
  const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
  const g = gcd(w, h) || 1;
  const rw = Math.round(w / g);
  const rh = Math.round(h / g);
  if (rw <= 40 && rh <= 40) return `${rw}:${rh}`;
  return `${w}×${h}`;
}

const COMMON_RATIOS: [number, number][] = [
  [9, 16], [16, 9], [1, 1], [4, 5], [5, 4], [3, 4], [4, 3], [2, 3], [3, 2],
];

/** Short ratio badge: exact w:h if known, else snap the aspect to a common one. */
function aspectBadge(aspect: number, w: number | null, h: number | null): string {
  if (w && h) return ratioLabel(w, h);
  for (const [a, b] of COMMON_RATIOS) {
    if (Math.abs(aspect - a / b) < 0.03) return `${a}:${b}`;
  }
  return aspect >= 1 ? 'Landscape' : 'Portrait';
}

const PLATFORMS: Record<Platform, { label: string; color: string }> = {
  facebook: { label: 'Facebook', color: '#1877F2' },
  instagram: { label: 'Instagram', color: '#E4405F' },
  tiktok: { label: 'TikTok', color: '#25F4EE' },
};

/** Client-side platform hint — instant feedback before we hit the server. */
function detectPlatform(raw: string): Platform | null {
  let host = '';
  try {
    host = new URL(raw.trim()).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
  if (host === 'tiktok.com' || host.endsWith('.tiktok.com')) return 'tiktok';
  if (host === 'instagram.com' || host.endsWith('.instagram.com') || host === 'instagr.am') return 'instagram';
  if (host === 'facebook.com' || host.endsWith('.facebook.com') || host === 'fb.watch' || host === 'fb.me') return 'facebook';
  return null;
}

function formatCount(n: number): string {
  if (!n) return '0';
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
  return String(n);
}

export default function ReelExtractor() {
  const [url, setUrl] = usePersistedState<string>('reel.url', '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ExtractResult | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [branding, setBranding] = useState(false);
  // Aspect ratio measured from the thumbnail — the fallback when the API
  // doesn't report native video dimensions.
  const [measuredAspect, setMeasuredAspect] = useState<number | null>(null);

  const detected = detectPlatform(url);

  // Prefer the API's native dimensions; otherwise use the measured thumbnail;
  // finally fall back to portrait 9:16. Drives the preview + branding canvas.
  const dimsW = result?.width && result?.height ? result.width : null;
  const dimsH = result?.width && result?.height ? result.height : null;
  const aspect = dimsW && dimsH ? dimsW / dimsH : measuredAspect ?? DEFAULT_ASPECT;

  const extract = async () => {
    const u = url.trim();
    if (!u || loading) return;
    if (!detectPlatform(u)) {
      setError('Paste a Facebook, Instagram, or TikTok video / reel link.');
      return;
    }
    setLoading(true);
    setError(null);
    setResult(null);
    setMeasuredAspect(null);
    try {
      const res = await authedFetch(`/api/social/extract?url=${encodeURIComponent(u)}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || 'Extraction failed');
      }
      setResult(await res.json());
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const download = async (d: ExtractDownload) => {
    if (!result) return;
    setDownloading(d.url);
    setError(null);
    try {
      const fname =
        `${result.platform}-${result.author || 'reel'}-${d.quality}`.replace(/[^a-z0-9._-]/gi, '_') + '.mp4';
      const res = await authedFetch(
        `/api/social/download?url=${encodeURIComponent(d.url)}&filename=${encodeURIComponent(fname)}`
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || 'Download failed');
      }
      const blob = await res.blob();
      const objUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objUrl;
      a.download = fname;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objUrl);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setDownloading(null);
    }
  };

  const copyCaption = async () => {
    if (!result?.caption) return;
    try {
      await navigator.clipboard.writeText(result.caption);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };

  const proxiedThumb = result?.thumbnail
    ? `/api/content/image-proxy?url=${encodeURIComponent(result.thumbnail)}`
    : null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="max-w-3xl mx-auto space-y-6"
    >
      {/* ── URL Input ─────────────────────────────────── */}
      <div className="bg-[#12121A] border border-[#27273A] rounded-3xl p-6 shadow-lg">
        <div className="flex items-center gap-2 mb-4">
          <Film size={18} className="text-purple-400" />
          <h3 className="text-sm font-medium text-zinc-300 uppercase tracking-wider">Reel Extractor</h3>
        </div>
        <p className="text-zinc-500 text-xs mb-4">
          Paste any Facebook, Instagram, or TikTok video / reel link — we'll detect the platform and pull the
          downloadable video.
        </p>

        <div className="flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <LinkIcon
              size={15}
              className="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-600 pointer-events-none"
            />
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && extract()}
              placeholder="https://www.facebook.com/reel/…  ·  instagram.com/reel/…  ·  tiktok.com/@user/video/…"
              className="w-full bg-[#0A0A0F] border border-[#27273A] rounded-xl pl-10 pr-24 py-3 text-sm text-white placeholder-zinc-600 outline-none focus:border-purple-500/40 transition-colors"
            />
            {detected && (
              <span
                className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1.5 text-[11px] font-medium text-zinc-400"
                title={`Detected ${PLATFORMS[detected].label}`}
              >
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: PLATFORMS[detected].color }} />
                {PLATFORMS[detected].label}
              </span>
            )}
          </div>
          <button
            onClick={extract}
            disabled={loading || !url.trim()}
            className="flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-gradient-to-r from-purple-600 to-purple-500 text-sm text-white font-medium hover:from-purple-500 hover:to-purple-400 transition-all shadow-[0_0_15px_rgba(168,85,247,0.2)] disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
          >
            {loading ? (
              <>
                <Loader size={15} className="animate-spin" /> Extracting…
              </>
            ) : (
              <>
                <Download size={15} /> Extract
              </>
            )}
          </button>
        </div>

        {error && (
          <div className="flex items-start gap-2 mt-3 text-xs text-red-400">
            <AlertCircle size={14} className="shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}
      </div>

      {/* ── Result ────────────────────────────────────── */}
      {result && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="bg-[#12121A] border border-[#27273A] rounded-3xl p-6 shadow-lg"
        >
          <div className="grid grid-cols-1 sm:grid-cols-[180px_1fr] gap-6">
            {/* Thumbnail */}
            <a
              href={result.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{ aspectRatio: String(aspect) }}
              className="group relative block w-full sm:w-[180px] rounded-2xl overflow-hidden bg-[#0A0A0F] border border-[#27273A]"
              title="Open original"
            >
              {proxiedThumb ? (
                <img
                  src={proxiedThumb}
                  alt="Reel thumbnail"
                  onLoad={(e) => {
                    // API dims win; only measure the thumbnail when they're absent.
                    if (dimsW && dimsH) return;
                    const img = e.currentTarget;
                    if (img.naturalWidth > 0 && img.naturalHeight > 0) {
                      setMeasuredAspect(img.naturalWidth / img.naturalHeight);
                    }
                  }}
                  className="absolute inset-0 w-full h-full object-cover"
                />
              ) : (
                <div className="absolute inset-0 flex items-center justify-center text-zinc-700">
                  <Film size={32} strokeWidth={1} />
                </div>
              )}
              <div className="absolute inset-0 flex items-center justify-center bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity">
                <div className="w-11 h-11 rounded-full bg-black/60 flex items-center justify-center">
                  <Play size={18} className="text-white translate-x-0.5" />
                </div>
              </div>
              <span
                className="absolute top-2 left-2 flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-medium text-white bg-black/55 backdrop-blur"
              >
                <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: PLATFORMS[result.platform].color }} />
                {PLATFORMS[result.platform].label}
              </span>
              {(dimsW || measuredAspect != null) && (
                <span
                  className="absolute bottom-2 right-2 px-2 py-0.5 rounded-full text-[10px] font-medium text-white bg-black/55 backdrop-blur"
                  title={dimsW && dimsH ? `${dimsW}×${dimsH}` : undefined}
                >
                  {aspectBadge(aspect, dimsW, dimsH)}
                </span>
              )}
            </a>

            {/* Info + downloads */}
            <div className="min-w-0 space-y-4">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                {result.author && (
                  <span className="text-sm font-medium text-white truncate">@{result.author}</span>
                )}
                <span className="flex items-center gap-1 text-xs text-zinc-400">
                  <Eye size={13} /> {formatCount(result.views)}
                </span>
                <span className="flex items-center gap-1 text-xs text-zinc-400">
                  <Heart size={13} /> {formatCount(result.likes)}
                </span>
                <a
                  href={result.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-xs text-zinc-500 hover:text-purple-300 transition-colors ml-auto"
                >
                  <ExternalLink size={12} /> Original
                </a>
              </div>

              {result.caption && (
                <div className="relative">
                  <p className="text-xs text-zinc-400 leading-relaxed whitespace-pre-wrap line-clamp-4 pr-9 bg-[#0A0A0F] border border-[#27273A] rounded-xl p-3">
                    {result.caption}
                  </p>
                  <button
                    onClick={copyCaption}
                    title="Copy caption"
                    className="absolute top-2 right-2 p-1.5 rounded-lg text-zinc-500 hover:text-zinc-200 hover:bg-[#181824] transition-colors"
                  >
                    {copied ? <Check size={13} className="text-green-400" /> : <Copy size={13} />}
                  </button>
                </div>
              )}

              <div>
                <p className="text-[11px] text-zinc-500 uppercase tracking-wider mb-2">Download</p>
                <div className="flex flex-wrap gap-2">
                  {result.downloads.map((d) => (
                    <button
                      key={d.url}
                      onClick={() => download(d)}
                      disabled={downloading === d.url}
                      className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed ${
                        d.recommended
                          ? 'bg-gradient-to-r from-purple-600 to-purple-500 text-white hover:from-purple-500 hover:to-purple-400 shadow-[0_0_12px_rgba(168,85,247,0.2)]'
                          : 'border border-[#27273A] bg-[#0A0A0F] text-zinc-300 hover:border-zinc-600'
                      }`}
                    >
                      {downloading === d.url ? (
                        <Loader size={14} className="animate-spin" />
                      ) : (
                        <Download size={14} />
                      )}
                      {d.quality}
                    </button>
                  ))}
                </div>
                <p className="text-[10px] text-zinc-600 mt-2">
                  Saves the .mp4 to your device. Respect each platform's terms and the original creator's rights.
                </p>
              </div>
            </div>
          </div>

          {/* Brand it → quick on-brand cover image from the reel frame */}
          {result.thumbnail && (
            <div className="mt-5">
              <button
                onClick={() => setBranding((v) => !v)}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium border border-purple-500/30 text-purple-200 hover:bg-purple-500/10 transition-all"
              >
                <Edit3 size={14} /> {branding ? 'Hide branding' : 'Brand this reel — add your logo & info'}
              </button>
            </div>
          )}
          {branding && result.thumbnail && (
            <ReelBrander
              thumbnailUrl={result.thumbnail}
              downloadUrl={(result.downloads.find((d) => d.recommended) || result.downloads[0])?.url || null}
              defaultName={`${result.platform}-${result.author || 'reel'}`}
              aspect={aspect}
            />
          )}
        </motion.div>
      )}
    </motion.div>
  );
}
