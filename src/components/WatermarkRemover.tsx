import { authedFetch } from '../lib/api';
import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  Upload,
  X,
  Download,
  Loader,
  RefreshCw,
  Check,
  Package,
  Star,
  FileText,
  EyeOff,
  AlertTriangle,
} from '@geist-ui/icons';
import { motion, AnimatePresence } from 'motion/react';
import { addToFlowBucket } from './FlowBucket';
import { usePersistedState } from '../hooks/usePersistedState';

interface RemovalReport {
  sparkleRemoved: boolean;
  metadataStripped: boolean;
  invisibleRemoved?: boolean;
  method: string;
  width: number;
  height: number;
}

export default function WatermarkRemover() {
  // Input
  const [sourceImage, setSourceImage] = usePersistedState<string | null>('watermark.sourceImage', null);
  const [sourceBase64, setSourceBase64] = usePersistedState<string | null>('watermark.sourceBase64', null);
  const [sourceMime, setSourceMime] = usePersistedState<string>('watermark.sourceMime', 'image/png');
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Options
  const [removeSparkle, setRemoveSparkle] = usePersistedState<boolean>('watermark.removeSparkle', true);
  const [stripMetadata, setStripMetadata] = usePersistedState<boolean>('watermark.stripMetadata', true);
  const [removeInvisible, setRemoveInvisible] = usePersistedState<boolean>('watermark.removeInvisible', false);
  // Whether the GPU SynthID service is configured on the backend.
  const [invisibleAvailable, setInvisibleAvailable] = useState<boolean | null>(null);

  // Result
  const [resultImage, setResultImage] = usePersistedState<string | null>('watermark.resultImage', null);
  const [resultBase64, setResultBase64] = usePersistedState<string | null>('watermark.resultBase64', null);
  const [report, setReport] = useState<RemovalReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flowAdded, setFlowAdded] = useState(false);

  // ── File handling ─────────────────────────────────────
  const processFile = useCallback((file: File) => {
    if (!file.type.startsWith('image/')) return;
    if (file.size > 25 * 1024 * 1024) {
      setError('Image must be under 25 MB');
      return;
    }
    const url = URL.createObjectURL(file);
    setSourceImage(url);
    setSourceMime(file.type);
    setResultImage(null);
    setResultBase64(null);
    setReport(null);
    setError(null);

    const reader = new FileReader();
    reader.onload = () => setSourceBase64((reader.result as string).split(',')[1]);
    reader.readAsDataURL(file);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files[0]) processFile(e.dataTransfer.files[0]);
  }, [processFile]);

  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of Array.from(items)) {
        if (item.kind === 'file' && item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) { e.preventDefault(); processFile(file); }
          return;
        }
      }
    };
    document.addEventListener('paste', handlePaste);
    return () => document.removeEventListener('paste', handlePaste);
  }, [processFile]);

  // Is the GPU service for invisible removal configured?
  useEffect(() => {
    let cancelled = false;
    authedFetch('/api/content/remove-watermark/capabilities')
      .then((r) => (r.ok ? r.json() : { invisibleAvailable: false }))
      .then((d) => { if (!cancelled) setInvisibleAvailable(!!d.invisibleAvailable); })
      .catch(() => { if (!cancelled) setInvisibleAvailable(false); });
    return () => { cancelled = true; };
  }, []);

  const clearAll = () => {
    setSourceImage(null);
    setSourceBase64(null);
    setResultImage(null);
    setResultBase64(null);
    setReport(null);
    setError(null);
  };

  // ── Remove ─────────────────────────────────────────────
  const handleRemove = useCallback(async () => {
    if (!sourceBase64) return;
    if (!removeSparkle && !stripMetadata && !removeInvisible) {
      setError('Pick at least one thing to remove.');
      return;
    }
    setLoading(true);
    setError(null);
    setResultImage(null);
    setResultBase64(null);
    setReport(null);
    try {
      const res = await authedFetch('/api/content/remove-watermark', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image: { base64: sourceBase64, mimeType: sourceMime },
          removeSparkle,
          stripMetadata,
          removeInvisible,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(body.error || 'Watermark removal failed');
      }
      const data = await res.json();
      if (!data.images?.length) throw new Error('No image returned');
      const img = data.images[0];
      setResultBase64(img.base64);
      setResultImage(`data:${img.mimeType};base64,${img.base64}`);
      setReport(data.report ?? null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [sourceBase64, sourceMime, removeSparkle, stripMetadata]);

  // ── Export ─────────────────────────────────────────────
  const handleDownload = () => {
    if (!resultImage) return;
    const a = document.createElement('a');
    a.href = resultImage;
    a.download = `cleaned-${Date.now()}.png`;
    a.click();
  };

  const handleFlowBucket = async () => {
    if (!resultBase64) return;
    await addToFlowBucket({ name: 'Watermark Removed', base64: resultBase64, mimeType: 'image/png' });
    setFlowAdded(true);
    setTimeout(() => setFlowAdded(false), 2000);
  };

  const Toggle = ({
    on, onClick, icon, title, sub,
  }: { on: boolean; onClick: () => void; icon: React.ReactNode; title: string; sub: string }) => (
    <button
      onClick={onClick}
      className={`flex items-start gap-3 text-left p-3.5 rounded-xl border transition-all ${
        on ? 'bg-purple-500/10 border-purple-500/30' : 'border-[#27273A] hover:border-zinc-600'
      }`}
    >
      <div className={`mt-0.5 ${on ? 'text-purple-300' : 'text-zinc-500'}`}>{icon}</div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className={`text-sm font-medium ${on ? 'text-purple-200' : 'text-zinc-300'}`}>{title}</span>
          <div className={`w-9 h-5 rounded-full p-0.5 shrink-0 transition-colors ${on ? 'bg-purple-500' : 'bg-[#27273A]'}`}>
            <div className={`w-4 h-4 rounded-full bg-white transition-transform ${on ? 'translate-x-4' : ''}`} />
          </div>
        </div>
        <p className="text-[10px] text-zinc-500 mt-1">{sub}</p>
      </div>
    </button>
  );

  return (
    <div className="max-w-4xl space-y-5">
      {/* ── Upload ────────────────────────────────────────── */}
      <div className="bg-[#12121A] border border-[#27273A] rounded-2xl p-5">
        <h3 className="text-sm font-medium text-zinc-400 uppercase tracking-wider mb-1">AI Watermark Remover</h3>
        <p className="text-[10px] text-zinc-600 mb-4">
          Removes the visible Gemini / Nano&nbsp;Banana sparkle and strips the &ldquo;Made&nbsp;with&nbsp;AI&rdquo; metadata
          that social platforms read &mdash; recovers the real pixels instead of regenerating the image.
        </p>

        {!sourceImage ? (
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`border-2 border-dashed rounded-xl p-14 text-center cursor-pointer transition-all ${
              dragOver ? 'border-purple-500 bg-purple-500/5' : 'border-[#27273A] hover:border-zinc-600 hover:bg-[#0A0A0F]'
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && processFile(e.target.files[0])}
            />
            <Upload size={36} className="mx-auto mb-3 text-zinc-500" />
            <p className="text-sm text-zinc-400 mb-1">Drop an AI image to clean it up</p>
            <p className="text-[10px] text-zinc-600">
              JPG, PNG, WebP &mdash; or press <kbd className="px-1.5 py-0.5 rounded bg-[#1a1a2e] border border-[#27273A] text-zinc-400 font-mono text-[9px]">&#8984;V</kbd> to paste
            </p>
          </div>
        ) : (
          <div className="flex items-start gap-4">
            <div className="relative shrink-0">
              <img src={sourceImage} alt="Source" className="w-32 h-32 rounded-xl object-cover border border-[#27273A]" />
              <button
                onClick={clearAll}
                className="absolute -top-1.5 -right-1.5 p-1 rounded-full bg-[#12121A] border border-[#27273A] text-zinc-500 hover:text-white transition-colors"
              >
                <X size={10} />
              </button>
            </div>
            <div className="flex-1 min-w-0 space-y-3">
              <p className="text-xs text-zinc-400">Image loaded. Choose what to remove, then clean it.</p>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="text-[10px] text-zinc-500 hover:text-zinc-300 transition-colors px-2 py-1 rounded-lg border border-[#27273A] hover:bg-[#181824]"
              >
                Replace image
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={(e) => e.target.files?.[0] && processFile(e.target.files[0])}
              />
            </div>
          </div>
        )}
      </div>

      {/* ── Options + Remove ──────────────────────────────── */}
      <AnimatePresence>
        {sourceImage && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden space-y-5"
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Toggle
                on={removeSparkle}
                onClick={() => setRemoveSparkle(!removeSparkle)}
                icon={<Star size={18} />}
                title="Remove visible sparkle"
                sub="Reverse-alpha removal of the Gemini corner mark. Recovers the true pixels."
              />
              <Toggle
                on={stripMetadata}
                onClick={() => setStripMetadata(!stripMetadata)}
                icon={<FileText size={18} />}
                title="Strip AI metadata"
                sub="Removes C2PA / EXIF / XMP that triggers the platform “Made with AI” label."
              />
            </div>

            {/* Invisible (SynthID) removal — GPU, opt-in */}
            <div
              className={`p-3.5 rounded-xl border transition-all ${
                invisibleAvailable === false ? 'opacity-60 border-[#27273A]' : ''
              } ${removeInvisible ? 'bg-purple-500/10 border-purple-500/30' : 'border-[#27273A]'}`}
            >
              <button
                onClick={() => invisibleAvailable && setRemoveInvisible(!removeInvisible)}
                disabled={invisibleAvailable !== true}
                className="flex items-start gap-3 text-left w-full disabled:cursor-not-allowed"
              >
                <div className={`mt-0.5 ${removeInvisible ? 'text-purple-300' : 'text-zinc-500'}`}>
                  <EyeOff size={18} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className={`text-sm font-medium ${removeInvisible ? 'text-purple-200' : 'text-zinc-300'}`}>
                      Remove invisible watermark (SynthID)
                    </span>
                    <div className={`w-9 h-5 rounded-full p-0.5 shrink-0 transition-colors ${removeInvisible ? 'bg-purple-500' : 'bg-[#27273A]'}`}>
                      <div className={`w-4 h-4 rounded-full bg-white transition-transform ${removeInvisible ? 'translate-x-4' : ''}`} />
                    </div>
                  </div>
                  <p className="text-[10px] text-zinc-500 mt-1">
                    {invisibleAvailable === false
                      ? 'GPU service not configured — see gpu-service/README.md to enable.'
                      : invisibleAvailable === null
                        ? 'Checking availability…'
                        : 'Diffusion regeneration on a GPU. Removes the hidden SynthID pattern.'}
                  </p>
                </div>
              </button>

              {removeInvisible && (
                <div className="flex gap-2 mt-3 p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20">
                  <AlertTriangle size={13} className="text-amber-400 shrink-0 mt-0.5" />
                  <p className="text-[10px] text-amber-300/90 leading-snug">
                    Regenerates the whole image — fine detail, faces, and text can drift, and it takes
                    ~10–40s. Defeating the SynthID verifier isn’t the same as being undetectable as AI.
                  </p>
                </div>
              )}
            </div>

            <button
              onClick={handleRemove}
              disabled={loading || !sourceBase64}
              className="w-full flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl bg-gradient-to-r from-purple-600 to-purple-500 text-sm text-white font-medium hover:from-purple-500 hover:to-purple-400 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {loading ? (
                <>
                  <Loader size={16} className="animate-spin" />
                  {removeInvisible ? 'Regenerating to remove SynthID… (~10–40s)' : 'Cleaning image…'}
                </>
              ) : resultImage ? (
                <>
                  <RefreshCw size={16} />
                  Run again
                </>
              ) : (
                'Remove Watermark'
              )}
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Error ─────────────────────────────────────────── */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-3">
          <p className="text-xs text-red-400">{error}</p>
        </div>
      )}

      {/* ── Result ────────────────────────────────────────── */}
      <AnimatePresence>
        {resultImage && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-[#12121A] border border-[#27273A] rounded-2xl p-5"
          >
            <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
              <h3 className="text-sm font-medium text-zinc-400 uppercase tracking-wider">Cleaned Result</h3>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleFlowBucket}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-[#27273A] text-zinc-400 hover:text-white hover:bg-[#181824] transition-colors"
                >
                  {flowAdded ? <Check size={12} className="text-emerald-400" /> : <Package size={12} />}
                  {flowAdded ? 'Added' : 'Flow Bucket'}
                </button>
                <button
                  onClick={handleDownload}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-purple-600 text-white hover:bg-purple-500 transition-colors"
                >
                  <Download size={12} />
                  Download
                </button>
              </div>
            </div>

            {/* Before / After */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-[10px] text-zinc-600 uppercase tracking-wider mb-1.5">Before</p>
                <img src={sourceImage ?? ''} alt="Before" className="w-full rounded-xl border border-[#27273A]" />
              </div>
              <div>
                <p className="text-[10px] text-zinc-600 uppercase tracking-wider mb-1.5">After</p>
                <img src={resultImage} alt="After" className="w-full rounded-xl border border-[#27273A]" />
              </div>
            </div>

            {/* Report */}
            {report && (
              <div className="flex flex-wrap gap-2 mt-4">
                {report.sparkleRemoved && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-medium bg-emerald-500/10 text-emerald-300 border border-emerald-500/20">
                    <Check size={10} /> Sparkle removed ({report.method})
                  </span>
                )}
                {report.metadataStripped && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-medium bg-emerald-500/10 text-emerald-300 border border-emerald-500/20">
                    <Check size={10} /> AI metadata stripped
                  </span>
                )}
                {report.invisibleRemoved && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-medium bg-emerald-500/10 text-emerald-300 border border-emerald-500/20">
                    <Check size={10} /> SynthID removed (diffusion)
                  </span>
                )}
                <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[10px] font-medium bg-[#1a1a24] text-zinc-400 border border-[#27273A]">
                  {report.width}×{report.height} · PNG
                </span>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
