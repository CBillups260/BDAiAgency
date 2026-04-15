import React, { useState, useCallback } from 'react';
import {
  Type,
  Loader,
  Copy,
  Check,
  Hash,
  ChevronLeft,
  ChevronRight,
  Bookmark,
} from '@geist-ui/icons';

// ─── Types ────────────────────────────────────────────────

interface BrandContext {
  company: string;
  industry?: string | null;
  description?: string | null;
  brandVoice?: string | null;
  targetAudience?: string | null;
  socialHandles?: Record<string, string> | null;
}

interface CaptionWidgetProps {
  brandContext: BrandContext | null;
  /** Extra context string — e.g. review text, post prompt */
  contentContext?: string;
  onCaptionsSaved?: (captions: string[]) => void;
  savedCaptions?: string[];
  /** If true, the side panel starts open (Post Creator). */
  defaultOpen?: boolean;
}

const PLATFORMS = [
  { id: 'instagram', label: 'IG' },
  { id: 'facebook', label: 'FB' },
  { id: 'twitter', label: 'X' },
  { id: 'linkedin', label: 'LI' },
  { id: 'tiktok', label: 'TT' },
];

// ─── Component ────────────────────────────────────────────

export default function CaptionWidget({
  brandContext,
  contentContext,
  onCaptionsSaved,
  savedCaptions,
  defaultOpen = false,
}: CaptionWidgetProps) {
  const [open, setOpen] = useState(defaultOpen);
  const [platform, setPlatform] = useState('instagram');
  const [includeHashtags, setIncludeHashtags] = useState(true);
  const [includeEmojis, setIncludeEmojis] = useState(false);
  const [loading, setLoading] = useState(false);
  const [captions, setCaptions] = useState<string[]>(savedCaptions || []);
  const [error, setError] = useState<string | null>(null);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);

  const generate = useCallback(async () => {
    if (!brandContext) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/content/generate-caption', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          brandContext,
          platform,
          topic: contentContext || undefined,
          includeHashtags,
          includeEmojis,
        }),
      });
      const text = await res.text();
      let msg = 'Generation failed';
      try {
        const body = JSON.parse(text);
        if (!res.ok) throw new Error(body.error || msg);
        setCaptions(body.captions || []);
      } catch (e: any) {
        if (!res.ok) throw new Error(text || msg);
        throw e;
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [brandContext, platform, contentContext, includeHashtags, includeEmojis]);

  const copy = (text: string, idx: number) => {
    navigator.clipboard.writeText(text);
    setCopiedIdx(idx);
    setTimeout(() => setCopiedIdx(null), 2000);
  };

  return (
    <>
      {/* ── Toggle Tab ──────────────────────────────── */}
      <div
        onClick={() => setOpen(!open)}
        className="fixed top-1/2 -translate-y-1/2 z-40 cursor-pointer"
        style={{ left: open ? 'calc(16rem + 320px)' : '16rem', transition: 'left 0.3s ease' }}
      >
        <div className="flex items-center gap-1 bg-purple-600 hover:bg-purple-500 text-white px-2 py-3 rounded-r-xl shadow-lg transition-colors"
          style={{ writingMode: open ? undefined : 'vertical-rl' }}
        >
          {open ? <ChevronLeft size={14} /> : (
            <>
              <Type size={12} />
              <span className="text-[10px] font-semibold tracking-wider">CAPTIONS</span>
            </>
          )}
        </div>
      </div>

      {/* ── Sliding Panel ───────────────────────────── */}
      <div
        className="fixed top-0 h-full z-30 bg-[#0D0D14] border-r border-[#27273A] shadow-2xl flex flex-col"
        style={{
          left: '16rem',
          width: 320,
          transform: open ? 'translateX(0)' : 'translateX(-100%)',
          transition: 'transform 0.3s ease',
        }}
      >
        {/* Header */}
        <div className="p-4 border-b border-[#27273A] shrink-0">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-white flex items-center gap-2">
              <Type size={14} className="text-purple-400" />
              Caption Generator
            </h3>
            {captions.length > 0 && onCaptionsSaved && (
              <button
                onClick={() => onCaptionsSaved(captions)}
                className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium bg-purple-500/15 text-purple-300 border border-purple-500/30 hover:bg-purple-500/25 transition-colors"
              >
                <Bookmark size={10} /> Bundle
              </button>
            )}
          </div>
          {brandContext && (
            <p className="text-[10px] text-zinc-500 mt-1 truncate">
              Generating for {brandContext.company}
            </p>
          )}
        </div>

        {/* Controls */}
        <div className="p-4 border-b border-[#27273A] space-y-3 shrink-0">
          {/* Platform */}
          <div className="flex gap-1">
            {PLATFORMS.map(p => (
              <button
                key={p.id}
                onClick={() => setPlatform(p.id)}
                className={`flex-1 py-1.5 rounded-lg text-[10px] font-medium transition-all border ${
                  platform === p.id
                    ? 'bg-purple-500/15 border-purple-500/30 text-purple-300'
                    : 'border-[#27273A] text-zinc-500 hover:text-zinc-300'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>

          {/* Toggles */}
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input type="checkbox" checked={includeHashtags} onChange={e => setIncludeHashtags(e.target.checked)} className="accent-purple-500 w-3 h-3" />
              <span className="text-[10px] text-zinc-300 flex items-center gap-0.5"><Hash size={9} /> Tags</span>
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input type="checkbox" checked={includeEmojis} onChange={e => setIncludeEmojis(e.target.checked)} className="accent-purple-500 w-3 h-3" />
              <span className="text-[10px] text-zinc-300">Emojis</span>
            </label>
          </div>

          {/* Context preview */}
          {contentContext && (
            <div className="bg-[#12121A] rounded-lg p-2.5 border border-[#27273A]">
              <p className="text-[9px] text-zinc-500 uppercase tracking-wider mb-1">Context</p>
              <p className="text-[10px] text-zinc-400 line-clamp-3 leading-relaxed">{contentContext}</p>
            </div>
          )}

          {/* Generate */}
          <button
            onClick={generate}
            disabled={loading || !brandContext}
            className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl bg-gradient-to-r from-purple-600 to-purple-500 text-xs text-white font-medium hover:from-purple-500 hover:to-purple-400 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {loading ? (
              <><Loader size={12} className="animate-spin" /> Generating...</>
            ) : (
              <><Type size={12} /> Generate Captions</>
            )}
          </button>

          {error && <p className="text-[10px] text-red-400">{error}</p>}
        </div>

        {/* Results */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {captions.length === 0 && !loading && (
            <div className="text-center py-8">
              <Type size={24} className="mx-auto mb-2 text-zinc-700" />
              <p className="text-[11px] text-zinc-600">
                {brandContext
                  ? 'Hit generate to create captions from your current content'
                  : 'Select a brand first'}
              </p>
            </div>
          )}

          {captions.map((caption, idx) => (
            <div
              key={idx}
              className="bg-[#12121A] border border-[#27273A] rounded-xl p-3 group"
            >
              <p className="text-[11px] text-zinc-200 leading-relaxed whitespace-pre-line">{caption}</p>
              <div className="flex items-center justify-between mt-2">
                <span className="text-[9px] text-zinc-600 font-mono">{caption.length} chars</span>
                <button
                  onClick={() => copy(caption, idx)}
                  className="p-1 rounded-md text-zinc-500 hover:text-white hover:bg-[#27273A] transition-colors"
                >
                  {copiedIdx === idx ? <Check size={11} className="text-emerald-400" /> : <Copy size={11} />}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
