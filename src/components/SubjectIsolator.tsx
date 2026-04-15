import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  Upload,
  X,
  Download,
  Loader,
  RefreshCw,
  Check,
  Package,
} from '@geist-ui/icons';
import { motion, AnimatePresence } from 'motion/react';
import { addToFlowBucket } from './FlowBucket';

const RATIOS = [
  { id: '1:1', label: '1:1', w: 1, h: 1 },
  { id: '4:5', label: '4:5', w: 4, h: 5 },
  { id: '5:4', label: '5:4', w: 5, h: 4 },
  { id: '9:16', label: '9:16', w: 9, h: 16 },
  { id: '16:9', label: '16:9', w: 16, h: 9 },
  { id: '3:4', label: '3:4', w: 3, h: 4 },
  { id: '4:3', label: '4:3', w: 4, h: 3 },
  { id: '2:3', label: '2:3', w: 2, h: 3 },
  { id: '3:2', label: '3:2', w: 3, h: 2 },
] as const;

export default function SubjectIsolator() {
  // Input
  const [sourceImage, setSourceImage] = useState<string | null>(null);
  const [sourceBase64, setSourceBase64] = useState<string | null>(null);
  const [sourceMime, setSourceMime] = useState('image/jpeg');
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Options
  const [aspectRatio, setAspectRatio] = useState('1:1');

  // Result
  const [resultImage, setResultImage] = useState<string | null>(null);
  const [resultBase64, setResultBase64] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Export
  const [flowAdded, setFlowAdded] = useState(false);

  // ── File handling ─────────────────────────────────────
  const processFile = useCallback((file: File) => {
    if (!file.type.startsWith('image/')) return;
    if (file.size > 20 * 1024 * 1024) {
      setError('Image must be under 20 MB');
      return;
    }
    const url = URL.createObjectURL(file);
    setSourceImage(url);
    setSourceMime(file.type);
    setResultImage(null);
    setResultBase64(null);
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

  const clearAll = () => {
    setSourceImage(null);
    setSourceBase64(null);
    setResultImage(null);
    setResultBase64(null);
    setError(null);
  };

  // ── Generate ──────────────────────────────────────────
  const handleGenerate = useCallback(async () => {
    if (!sourceBase64) return;
    setLoading(true);
    setError(null);
    setResultImage(null);
    setResultBase64(null);
    try {
      const res = await fetch('/api/content/extract-background', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image: { base64: sourceBase64, mimeType: sourceMime },
          aspectRatio,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(body.error || 'Background extraction failed');
      }
      const data = await res.json();
      if (!data.images?.length) throw new Error('No image returned');
      const img = data.images[0];
      setResultBase64(img.base64);
      setResultImage(`data:${img.mimeType};base64,${img.base64}`);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [sourceBase64, sourceMime, aspectRatio]);

  // ── Export ─────────────────────────────────────────────
  const handleDownload = () => {
    if (!resultImage) return;
    const a = document.createElement('a');
    a.href = resultImage;
    a.download = `background-${Date.now()}.png`;
    a.click();
  };

  const handleFlowBucket = async () => {
    if (!resultBase64) return;
    await addToFlowBucket({ name: 'Extracted Background', base64: resultBase64, mimeType: 'image/png' });
    setFlowAdded(true);
    setTimeout(() => setFlowAdded(false), 2000);
  };

  return (
    <div className="max-w-4xl space-y-5">
      {/* ── Upload ────────────────────────────────────────── */}
      <div className="bg-[#12121A] border border-[#27273A] rounded-2xl p-5">
        <h3 className="text-sm font-medium text-zinc-400 uppercase tracking-wider mb-1">Upload Image</h3>
        <p className="text-[10px] text-zinc-600 mb-4">Upload a photo with a subject in it &mdash; AI will remove the subject and give you a clean, usable background.</p>

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
            <p className="text-sm text-zinc-400 mb-1">Drop an image to extract its background</p>
            <p className="text-[10px] text-zinc-600">
              JPG, PNG, WebP &mdash; or press <kbd className="px-1.5 py-0.5 rounded bg-[#1a1a2e] border border-[#27273A] text-zinc-400 font-mono text-[9px]">&#8984;V</kbd> to paste
            </p>
          </div>
        ) : (
          <div className="flex items-start gap-4">
            <div className="relative shrink-0">
              <img
                src={sourceImage}
                alt="Source"
                className="w-32 h-32 rounded-xl object-cover border border-[#27273A]"
              />
              <button
                onClick={clearAll}
                className="absolute -top-1.5 -right-1.5 p-1 rounded-full bg-[#12121A] border border-[#27273A] text-zinc-500 hover:text-white transition-colors"
              >
                <X size={10} />
              </button>
            </div>
            <div className="flex-1 min-w-0 space-y-3">
              <p className="text-xs text-zinc-400">Image uploaded. Pick your output aspect ratio and extract the background.</p>
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

      {/* ── Aspect Ratio + Generate ───────────────────────── */}
      <AnimatePresence>
        {sourceImage && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden space-y-5"
          >
            <div className="bg-[#12121A] border border-[#27273A] rounded-2xl p-5">
              <h3 className="text-sm font-medium text-zinc-400 uppercase tracking-wider mb-3">Output Aspect Ratio</h3>
              <div className="flex flex-wrap gap-2">
                {RATIOS.map((r) => (
                  <button
                    key={r.id}
                    onClick={() => setAspectRatio(r.id)}
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg border transition-all ${
                      aspectRatio === r.id
                        ? 'bg-purple-500/10 border-purple-500/30 text-purple-300'
                        : 'border-[#27273A] text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    <div
                      className={`border rounded-sm ${
                        aspectRatio === r.id ? 'border-purple-400' : 'border-zinc-600'
                      }`}
                      style={{
                        width: `${Math.round((r.w / Math.max(r.w, r.h)) * 16)}px`,
                        height: `${Math.round((r.h / Math.max(r.w, r.h)) * 16)}px`,
                      }}
                    />
                    <span className="text-xs font-medium">{r.label}</span>
                  </button>
                ))}
              </div>
              <p className="text-[10px] text-zinc-600 mt-2">
                AI will extend or crop the background to fill the selected ratio.
              </p>
            </div>

            <button
              onClick={handleGenerate}
              disabled={loading || !sourceBase64}
              className="w-full flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl bg-gradient-to-r from-purple-600 to-purple-500 text-sm text-white font-medium hover:from-purple-500 hover:to-purple-400 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {loading ? (
                <>
                  <Loader size={16} className="animate-spin" />
                  Removing subject &amp; extracting background...
                </>
              ) : resultImage ? (
                <>
                  <RefreshCw size={16} />
                  Regenerate
                </>
              ) : (
                'Extract Background'
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
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-medium text-zinc-400 uppercase tracking-wider">Extracted Background</h3>
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
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-gradient-to-r from-purple-600 to-purple-500 text-white hover:from-purple-500 hover:to-purple-400 transition-all"
                >
                  <Download size={12} />
                  Download
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Original */}
              <div>
                <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-2">Original</p>
                <div className="rounded-xl overflow-hidden border border-[#27273A] bg-[#0A0A0F]">
                  <img
                    src={sourceImage!}
                    alt="Original"
                    className="w-full object-contain max-h-[400px]"
                  />
                </div>
              </div>
              {/* Clean background */}
              <div>
                <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-2">Clean Background &middot; {aspectRatio}</p>
                <div className="rounded-xl overflow-hidden border border-[#27273A] bg-[#0A0A0F]">
                  <img
                    src={resultImage}
                    alt="Extracted background"
                    className="w-full object-contain max-h-[400px]"
                  />
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
