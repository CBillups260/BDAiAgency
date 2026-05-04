import { authedFetch } from '../lib/api';
import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Upload, Loader, Plus, Download, Trash2, X } from '@geist-ui/icons';
import { motion } from 'motion/react';
import { useFirestoreAccounts } from '../hooks/useFirestore';

const MODELS = [
  { id: 'gemini-3-pro-image-preview', label: 'Gemini 3 Pro', sub: 'Higher quality, slower' },
  { id: 'gemini-3.1-flash-image-preview', label: 'Gemini 3.1 Flash', sub: 'Faster' },
  { id: 'gpt-image-2', label: 'OpenAI Image 2', sub: 'OpenAI, photo-realistic' },
];

const RATIOS = [
  { id: '1:1', label: '1:1', sub: 'Square' },
  { id: '4:5', label: '4:5', sub: 'IG Post' },
  { id: '5:4', label: '5:4', sub: 'Landscape' },
  { id: '3:4', label: '3:4', sub: 'Portrait' },
  { id: '4:3', label: '4:3', sub: 'Standard' },
  { id: '2:3', label: '2:3', sub: 'Pinterest' },
  { id: '3:2', label: '3:2', sub: 'Photo' },
  { id: '9:16', label: '9:16', sub: 'Story / Reel' },
  { id: '16:9', label: '16:9', sub: 'Wide / YT' },
];

interface RefImage {
  base64: string;
  mimeType: string;
  preview: string;
}

interface GeneratedAsset {
  base64: string;
  mimeType: string;
  timestamp: number;
}

export default function Resizer() {
  const { accounts, loading: accountsLoading } = useFirestoreAccounts();
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);

  const [refImage, setRefImage] = useState<RefImage | null>(null);
  const [model, setModel] = useState('gemini-3-pro-image-preview');
  const [ratio, setRatio] = useState('1:1');
  const [count, setCount] = useState(1);
  const [dragOver, setDragOver] = useState(false);

  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [assets, setAssets] = useState<GeneratedAsset[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [customW, setCustomW] = useState('');
  const [customH, setCustomH] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isPresetRatio = RATIOS.some((r) => r.id === ratio);
  const customRatioValid = (() => {
    const w = Number(customW);
    const h = Number(customH);
    if (!w || !h || w <= 0 || h <= 0) return false;
    const r = w / h;
    return r >= 1 / 3 - 1e-6 && r <= 3 + 1e-6;
  })();
  const applyCustomRatio = () => {
    if (!customRatioValid) return;
    setRatio(`${Number(customW)}:${Number(customH)}`);
  };

  useEffect(() => {
    if (model !== 'gpt-image-2' && !isPresetRatio) {
      setRatio('1:1');
    }
  }, [model, isPresetRatio]);

  const processFile = useCallback((file: File) => {
    if (!file.type.startsWith('image/')) {
      setError('Only image files are supported.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const base64 = dataUrl.split(',')[1];
      setRefImage({ base64, mimeType: file.type, preview: dataUrl });
      setError(null);
    };
    reader.readAsDataURL(file);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files?.[0];
      if (file) processFile(file);
    },
    [processFile],
  );

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of Array.from(items)) {
        if (item.kind === 'file') {
          const file = item.getAsFile();
          if (file) {
            e.preventDefault();
            processFile(file);
            return;
          }
        }
      }
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [processFile]);

  const generate = async () => {
    if (!refImage || generating) return;
    const n = Math.min(Math.max(count, 1), 4);
    setGenerating(true);
    setError(null);
    setProgress({ done: 0, total: n });

    const body = {
      mode: 'resize',
      model,
      aspectRatio: ratio,
      referenceImage: { base64: refImage.base64, mimeType: refImage.mimeType },
    };

    type ReqResult = { ok: true; images: { base64: string; mimeType: string }[] } | { ok: false; error: string };
    const requestOne = async (): Promise<ReqResult> => {
      try {
        const res = await authedFetch('/api/content/generate-asset', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const text = await res.text();
        let data: any;
        try { data = JSON.parse(text); } catch { return { ok: false, error: text || 'Resize failed' }; }
        if (!res.ok) return { ok: false, error: data.error || 'Resize failed' };
        return { ok: true, images: data.images ?? [] };
      } catch (e: any) {
        return { ok: false, error: e.message || 'Network error' };
      } finally {
        setProgress((p) => ({ ...p, done: p.done + 1 }));
      }
    };

    try {
      const results = await Promise.all(Array.from({ length: n }, () => requestOne()));
      const ts = Date.now();
      const newAssets: GeneratedAsset[] = [];
      const errors: string[] = [];
      results.forEach((r, i) => {
        if (r.ok === true) {
          r.images.forEach((img, j) => {
            newAssets.push({ base64: img.base64, mimeType: img.mimeType, timestamp: ts + i * 1000 + j });
          });
        } else {
          errors.push(r.error);
        }
      });
      if (newAssets.length) setAssets((prev) => [...newAssets, ...prev]);
      if (errors.length) {
        setError(newAssets.length ? `${errors.length} of ${n} failed: ${errors[0]}` : errors[0]);
      }
    } finally {
      setGenerating(false);
      setProgress({ done: 0, total: 0 });
    }
  };

  const downloadAsset = (asset: GeneratedAsset) => {
    const link = document.createElement('a');
    link.href = `data:${asset.mimeType};base64,${asset.base64}`;
    link.download = `resized-${ratio.replace(':', 'x')}-${asset.timestamp}.png`;
    link.click();
  };

  const selectedAccount = accounts.find((a) => a.id === selectedAccountId) || null;

  return (
    <div className="space-y-5 max-w-5xl">
      {/* Brand */}
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
                onClick={() => setSelectedAccountId(acct.id)}
                className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-left transition-all border ${
                  selectedAccountId === acct.id
                    ? 'bg-purple-500/10 border-purple-500/30'
                    : 'border-[#27273A] hover:bg-[#181824]'
                }`}
              >
                <img
                  src={acct.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(acct.company)}&background=27273A&color=fff&size=28`}
                  alt=""
                  className="w-7 h-7 rounded-lg border border-[#27273A] object-cover shrink-0"
                />
                <span className="text-xs font-medium text-white truncate max-w-[120px]">{acct.company}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {selectedAccount && (
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_360px] gap-5">
          {/* Preview / Upload */}
          <div className="bg-[#12121A] border border-[#27273A] rounded-2xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium text-zinc-400 uppercase tracking-wider">Source Image</h3>
              {refImage && (
                <button
                  onClick={() => { setRefImage(null); setAssets([]); }}
                  className="text-[10px] text-zinc-500 hover:text-zinc-300 transition-colors flex items-center gap-1"
                >
                  <X size={10} /> Clear
                </button>
              )}
            </div>

            {!refImage ? (
              <div
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-xl p-12 text-center cursor-pointer transition-all ${
                  dragOver ? 'border-purple-500 bg-purple-500/5' : 'border-[#27273A] hover:border-zinc-600 hover:bg-[#0A0A0F]'
                }`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => e.target.files?.[0] && processFile(e.target.files[0])}
                />
                <Upload size={32} className="mx-auto mb-3 text-zinc-500" />
                <p className="text-sm text-zinc-400 mb-1">Drop an image or click to upload</p>
                <p className="text-[10px] text-zinc-600">
                  or press <kbd className="px-1.5 py-0.5 rounded bg-[#1a1a2e] border border-[#27273A] text-zinc-400 font-mono text-[9px]">&#8984;V</kbd> to paste
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="rounded-xl overflow-hidden bg-[#0A0A0F] border border-[#27273A] flex items-center justify-center min-h-[200px]">
                  <img src={refImage.preview} alt="source" className="max-w-full max-h-[420px] object-contain" />
                </div>
                {assets.length > 0 && (
                  <div>
                    <h4 className="text-[11px] font-medium text-zinc-500 uppercase tracking-wider mb-2">Results</h4>
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2.5">
                      {assets.map((asset) => (
                        <motion.div
                          key={asset.timestamp}
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          className="relative group rounded-xl overflow-hidden bg-[#0A0A0F] border border-[#27273A]"
                        >
                          <img
                            src={`data:${asset.mimeType};base64,${asset.base64}`}
                            alt=""
                            className="w-full h-auto block"
                          />
                          <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                            <button
                              onClick={() => downloadAsset(asset)}
                              className="p-2 rounded-lg bg-white/10 hover:bg-white/20 text-white transition-colors"
                              title="Download"
                            >
                              <Download size={14} />
                            </button>
                            <button
                              onClick={() => setAssets((prev) => prev.filter((a) => a.timestamp !== asset.timestamp))}
                              className="p-2 rounded-lg bg-white/10 hover:bg-red-500/40 text-white transition-colors"
                              title="Delete"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </motion.div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {error && (
              <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-3">
                <p className="text-xs text-red-400">{error}</p>
              </div>
            )}
          </div>

          {/* Controls */}
          <div className="space-y-5">
            <div className="bg-[#12121A] border border-[#27273A] rounded-2xl p-5">
              <h3 className="text-sm font-medium text-zinc-400 uppercase tracking-wider mb-3">AI Model</h3>
              <div className="grid grid-cols-1 gap-1.5">
                {MODELS.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => setModel(m.id)}
                    className={`px-3 py-2.5 rounded-xl border text-left transition-all ${
                      model === m.id ? 'bg-purple-500/10 border-purple-500/30' : 'border-[#27273A] bg-[#0A0A0F] hover:border-zinc-600'
                    }`}
                  >
                    <p className={`text-[12px] font-semibold ${model === m.id ? 'text-purple-300' : 'text-zinc-300'}`}>{m.label}</p>
                    <p className="text-[9px] text-zinc-500">{m.sub}</p>
                  </button>
                ))}
              </div>
            </div>

            <div className="bg-[#12121A] border border-[#27273A] rounded-2xl p-5">
              <h3 className="text-sm font-medium text-zinc-400 uppercase tracking-wider mb-3">Aspect Ratio</h3>
              <div className="grid grid-cols-3 gap-1.5">
                {RATIOS.map((r) => (
                  <button
                    key={r.id}
                    onClick={() => setRatio(r.id)}
                    className={`px-2 py-2 rounded-lg border text-center transition-all ${
                      ratio === r.id ? 'bg-purple-500/10 border-purple-500/30' : 'border-[#27273A] bg-[#0A0A0F] hover:border-zinc-600'
                    }`}
                  >
                    <p className={`text-[11px] font-semibold ${ratio === r.id ? 'text-purple-300' : 'text-zinc-300'}`}>{r.label}</p>
                    <p className="text-[8px] text-zinc-500 mt-0.5 leading-tight">{r.sub}</p>
                  </button>
                ))}
              </div>

              {model === 'gpt-image-2' && (
                <div className="mt-3 pt-3 border-t border-[#27273A] space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-[10px] text-zinc-500 uppercase tracking-wider font-medium">Custom Ratio</p>
                    <p className="text-[9px] text-zinc-600">1:3 to 3:1 · OpenAI only</p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="number"
                      min="1"
                      value={customW}
                      onChange={(e) => setCustomW(e.target.value)}
                      placeholder="W"
                      className="w-16 bg-[#0A0A0F] border border-[#27273A] rounded-lg px-2 py-1.5 text-xs text-white placeholder-zinc-600 outline-none focus:border-purple-500/40 text-center"
                    />
                    <span className="text-zinc-500 text-sm">:</span>
                    <input
                      type="number"
                      min="1"
                      value={customH}
                      onChange={(e) => setCustomH(e.target.value)}
                      placeholder="H"
                      className="w-16 bg-[#0A0A0F] border border-[#27273A] rounded-lg px-2 py-1.5 text-xs text-white placeholder-zinc-600 outline-none focus:border-purple-500/40 text-center"
                    />
                    <button
                      onClick={applyCustomRatio}
                      disabled={!customRatioValid}
                      className="ml-auto px-3 py-1.5 rounded-lg text-[11px] font-medium bg-purple-500/15 border border-purple-500/30 text-purple-200 hover:bg-purple-500/25 transition-all disabled:opacity-40 disabled:cursor-not-allowed disabled:bg-[#0A0A0F] disabled:border-[#27273A] disabled:text-zinc-500"
                    >
                      Use
                    </button>
                  </div>
                  {!isPresetRatio && (
                    <p className="text-[10px] text-purple-300 font-mono">Active: {ratio}</p>
                  )}
                  {customW && customH && !customRatioValid && (
                    <p className="text-[10px] text-red-400">Ratio must be between 1:3 and 3:1.</p>
                  )}
                </div>
              )}
            </div>

            <div className="sticky bottom-0 bg-[#12121A] border border-[#27273A] rounded-2xl p-5 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-[11px] font-medium text-zinc-400 uppercase tracking-wider">Count</h3>
                <div className="flex gap-1">
                  {[1, 2, 3, 4].map((n) => (
                    <button
                      key={n}
                      onClick={() => setCount(n)}
                      disabled={generating}
                      className={`w-9 h-9 rounded-lg border text-xs font-medium transition-all ${
                        count === n
                          ? 'bg-purple-500/15 border-purple-500/40 text-purple-200'
                          : 'border-[#27273A] bg-[#0A0A0F] text-zinc-400 hover:border-zinc-600'
                      } disabled:opacity-40 disabled:cursor-not-allowed`}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </div>
              <button
                onClick={generate}
                disabled={!refImage || generating}
                className="w-full flex items-center justify-center gap-2 px-4 py-3.5 rounded-xl bg-gradient-to-r from-purple-600 to-purple-500 text-sm text-white font-medium hover:from-purple-500 hover:to-purple-400 transition-all shadow-[0_0_15px_rgba(168,85,247,0.2)] disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {generating ? (
                  <>
                    <Loader size={14} className="animate-spin" />
                    Resizing
                    {progress.total > 1 ? ` ${progress.done}/${progress.total}…` : '…'}
                  </>
                ) : (
                  <>
                    <Plus size={14} />
                    Resize Image
                    {count > 1 ? ` × ${count}` : ''}
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
