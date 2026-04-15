import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  Loader,
  Download,
  Trash2,
  Plus,
  Upload,
  X,
  Image,
  Type,
} from '@geist-ui/icons';

// ─── Config ──────────────────────────────────────────────

const MODELS = [
  { id: 'gemini-3-pro-image-preview', label: 'Gemini 3 Pro', sub: 'Higher quality, slower' },
  { id: 'gemini-3.1-flash-image-preview', label: 'Gemini 3.1 Flash', sub: 'Faster, thinking mode' },
];

const RESOLUTIONS = [
  { id: '512', label: '512px', sub: 'Fast preview' },
  { id: '1K', label: '1K', sub: 'Standard' },
  { id: '2K', label: '2K', sub: 'High res' },
  { id: '4K', label: '4K', sub: 'Ultra' },
];

const THINKING_LEVELS = [
  { id: '', label: 'Off', sub: 'No thinking' },
  { id: 'Minimal', label: 'Minimal', sub: 'Light reasoning' },
  { id: 'High', label: 'High', sub: 'Deep reasoning' },
];

const BG_COLORS = [
  { hex: '#00B140', name: 'Chroma Green' },
  { hex: '#00FF00', name: 'Green Screen' },
  { hex: '#0047FF', name: 'Chroma Blue' },
  { hex: '#0000FF', name: 'Blue Screen' },
  { hex: '#808080', name: 'Mid Gray' },
  { hex: '#A0A0A0', name: 'Light Gray' },
  { hex: '#C0C0C0', name: 'Silver' },
  { hex: '#FFFFFF', name: 'White' },
  { hex: '#E0E0E0', name: 'Soft Gray' },
  { hex: '#000000', name: 'Black' },
];

const RATIOS = [
  { id: '1:1' as const, label: '1:1', sub: 'Square' },
  { id: '4:5' as const, label: '4:5', sub: 'Portrait' },
  { id: '9:16' as const, label: '9:16', sub: 'Story' },
  { id: '16:9' as const, label: '16:9', sub: 'Wide' },
  { id: '3:2' as const, label: '3:2', sub: 'Banner' },
];

const TEXT_STYLES = [
  { id: '', label: 'Default' },
  { id: 'Bold 3D extruded text with depth and shadow', label: '3D Extruded' },
  { id: 'Neon glowing text with light bloom effect', label: 'Neon Glow' },
  { id: 'Hand-lettered brush script calligraphy', label: 'Brush Script' },
  { id: 'Retro vintage marquee sign lettering', label: 'Retro Marquee' },
  { id: 'Chrome metallic reflective text', label: 'Chrome Metal' },
  { id: 'Grunge distressed weathered text', label: 'Grunge' },
  { id: 'Elegant serif gold foil embossed text', label: 'Gold Foil' },
  { id: 'Clean modern sans-serif minimalist text', label: 'Modern Sans' },
  { id: 'Chalk-style hand-drawn text on dark surface', label: 'Chalk' },
  { id: 'Watercolor painted text with soft bleeds', label: 'Watercolor' },
  { id: 'Bold stencil military style text', label: 'Stencil' },
  { id: 'Pixel art retro 8-bit style text', label: 'Pixel Art' },
  { id: 'Dripping liquid paint text effect', label: 'Drip Paint' },
  { id: 'Ice frosted frozen crystalline text', label: 'Frozen Ice' },
  { id: 'Fire and flame infused burning text', label: 'Fire Text' },
  { id: 'Wooden carved engraved text', label: 'Wood Carved' },
  { id: 'Glass transparent refractive text', label: 'Glass' },
  { id: 'Balloon inflated glossy 3D text', label: 'Balloon' },
  { id: 'Smoke and vapor dissolving text', label: 'Smoke' },
];

interface GeneratedTitle {
  base64: string;
  mimeType: string;
  prompt: string;
  timestamp: number;
}

// ─── Component ───────────────────────────────────────────

export default function TitleGenerator() {
  const [titleText, setTitleText] = useState('');
  const [model, setModel] = useState('gemini-3-pro-image-preview');
  const [resolution, setResolution] = useState('1K');
  const [thinkingLevel, setThinkingLevel] = useState('');
  const [textStyle, setTextStyle] = useState('');
  const [extraInstructions, setExtraInstructions] = useState('');

  const [bgColor, setBgColor] = useState('#00B140');
  const [customBg, setCustomBg] = useState('');
  const [ratio, setRatio] = useState<string>('16:9');

  const [refImage, setRefImage] = useState<{ base64: string; mimeType: string; preview: string } | null>(null);

  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [titles, setTitles] = useState<GeneratedTitle[]>([]);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const activeBg = customBg || bgColor;

  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of Array.from(items)) {
        if (item.kind === 'file' && item.type.startsWith('image/')) {
          e.preventDefault();
          const file = item.getAsFile();
          if (!file) continue;
          const reader = new FileReader();
          reader.onload = () => {
            const dataUrl = reader.result as string;
            const base64 = dataUrl.split(',')[1];
            setRefImage({ base64, mimeType: file.type, preview: dataUrl });
          };
          reader.readAsDataURL(file);
          break;
        }
      }
    };
    document.addEventListener('paste', handlePaste);
    return () => document.removeEventListener('paste', handlePaste);
  }, []);

  const handleRefUpload = useCallback((files: FileList | null) => {
    if (!files?.length) return;
    const file = files[0];
    if (!file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const base64 = dataUrl.split(',')[1];
      setRefImage({ base64, mimeType: file.type, preview: dataUrl });
    };
    reader.readAsDataURL(file);
  }, []);

  const generate = async () => {
    if (!titleText.trim() || generating) return;
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch('/api/content/generate-title', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          titleText: titleText.trim(),
          model,
          resolution,
          thinkingLevel: model === 'gemini-3.1-flash-image-preview' ? thinkingLevel : '',
          textStyle,
          extraInstructions: extraInstructions.trim(),
          backgroundColor: activeBg,
          aspectRatio: ratio,
          referenceImage: refImage ? { base64: refImage.base64, mimeType: refImage.mimeType } : undefined,
        }),
      });
      const text = await res.text();
      let data: any;
      try { data = JSON.parse(text); } catch { throw new Error(text || 'Generation failed'); }
      if (!res.ok) throw new Error(data.error || 'Generation failed');
      if (data.images?.length) {
        const newTitles = data.images.map((img: any) => ({
          base64: img.base64,
          mimeType: img.mimeType,
          prompt: titleText.trim(),
          timestamp: Date.now(),
        }));
        setTitles(prev => [...newTitles, ...prev]);
        setSelectedIdx(0);
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setGenerating(false);
    }
  };

  const downloadTitle = (title: GeneratedTitle) => {
    const link = document.createElement('a');
    link.href = `data:${title.mimeType};base64,${title.base64}`;
    link.download = `title-${title.prompt.replace(/\s+/g, '-').slice(0, 30)}-${Date.now()}.png`;
    link.click();
  };

  const removeTitle = (idx: number) => {
    setTitles(prev => prev.filter((_, i) => i !== idx));
    if (selectedIdx === idx) setSelectedIdx(null);
    else if (selectedIdx !== null && selectedIdx > idx) setSelectedIdx(selectedIdx - 1);
  };

  const selected = selectedIdx !== null ? titles[selectedIdx] : null;

  return (
    <div className="max-w-7xl mx-auto space-y-5">
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_400px] gap-6">
        {/* ── Left: Preview + Gallery ─────────────────── */}
        <div className="space-y-5">
          {/* Main preview */}
          <div className="bg-[#12121A] border border-[#27273A] rounded-2xl p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-medium text-zinc-400 uppercase tracking-wider">Preview</h3>
              {selected && (
                <button
                  onClick={() => downloadTitle(selected)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-gradient-to-r from-purple-600 to-purple-500 text-white hover:from-purple-500 hover:to-purple-400 transition-all"
                >
                  <Download size={12} /> Download PNG
                </button>
              )}
            </div>

            <div className="flex gap-4">
              {refImage && !generating && (
                <div className="shrink-0">
                  <p className="text-[10px] text-zinc-500 mb-1.5">Style Reference</p>
                  <div className="w-32 h-32 rounded-xl overflow-hidden border border-[#27273A] bg-[#0A0A0F]">
                    <img src={refImage.preview} alt="" className="w-full h-full object-cover" />
                  </div>
                </div>
              )}
              <div className="flex-1">
                {refImage && !generating && <p className="text-[10px] text-zinc-500 mb-1.5">Result</p>}
                <div
                  className="rounded-xl overflow-hidden border border-[#27273A] flex items-center justify-center mx-auto"
                  style={{ maxWidth: 600, aspectRatio: ratio.replace(':', '/'), backgroundColor: selected ? activeBg : '#0A0A0F' }}
                >
                  {generating ? (
                    <div className="flex flex-col items-center gap-3 py-16">
                      <Loader size={32} className="text-purple-400 animate-spin" />
                      <p className="text-sm text-zinc-400">Generating title...</p>
                      <p className="text-[10px] text-zinc-600">This may take 15-30 seconds</p>
                    </div>
                  ) : selected ? (
                    <img
                      src={`data:${selected.mimeType};base64,${selected.base64}`}
                      alt=""
                      className="w-full h-full object-contain"
                    />
                  ) : (
                    <div className="flex flex-col items-center gap-3 py-16 text-zinc-600">
                      <Type size={40} strokeWidth={1} />
                      <p className="text-sm">Type your title text and hit Generate</p>
                      <p className="text-[10px] text-zinc-500">Optionally upload a style reference image</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Gallery */}
          {titles.length > 0 && (
            <div className="bg-[#12121A] border border-[#27273A] rounded-2xl p-5">
              <h3 className="text-sm font-medium text-zinc-400 uppercase tracking-wider mb-3">
                Generated Titles <span className="text-zinc-600">({titles.length})</span>
              </h3>
              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2">
                {titles.map((title, idx) => (
                  <div
                    key={idx}
                    onClick={() => setSelectedIdx(idx)}
                    className={`relative group cursor-pointer rounded-lg overflow-hidden border-2 transition-all ${
                      selectedIdx === idx
                        ? 'border-purple-500 shadow-[0_0_10px_rgba(168,85,247,0.2)]'
                        : 'border-[#27273A] hover:border-zinc-600'
                    }`}
                  >
                    <div className="aspect-video" style={{ backgroundColor: '#f5f5f5' }}>
                      <img src={`data:${title.mimeType};base64,${title.base64}`} alt="" className="w-full h-full object-contain" />
                    </div>
                    <div className="absolute top-1 right-1 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={(e) => { e.stopPropagation(); downloadTitle(title); }}
                        className="p-1 rounded bg-black/70 text-white"
                      >
                        <Download size={10} />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); removeTitle(idx); }}
                        className="p-1 rounded bg-black/70 text-white"
                      >
                        <Trash2 size={10} />
                      </button>
                    </div>
                    <div className="absolute bottom-0 inset-x-0 bg-black/60 px-1.5 py-1">
                      <p className="text-[9px] text-white truncate">{title.prompt}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {error && (
            <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-3">
              <p className="text-xs text-red-400">{error}</p>
            </div>
          )}
        </div>

        {/* ── Right: Controls ─────────────────────────── */}
        <div className="space-y-4 overflow-y-auto max-h-[calc(100vh-200px)] pr-1">
          {/* Style Reference Upload */}
          <div className="bg-[#12121A] border border-[#27273A] rounded-2xl p-5">
            <h3 className="text-sm font-medium text-zinc-400 uppercase tracking-wider mb-3">Style Reference</h3>
            <p className="text-[10px] text-zinc-500 mb-3">Upload an image of a text style you want to recreate</p>
            {refImage ? (
              <div className="relative group">
                <img src={refImage.preview} alt="" className="w-full h-36 rounded-xl object-cover border border-[#27273A]" />
                <button onClick={() => setRefImage(null)} className="absolute top-2 right-2 p-1.5 rounded-lg bg-black/60 text-white hover:bg-black/80 transition-colors">
                  <X size={12} />
                </button>
              </div>
            ) : (
              <div
                onClick={() => fileInputRef.current?.click()}
                className="border-2 border-dashed border-[#27273A] rounded-xl p-6 text-center cursor-pointer hover:border-zinc-600 hover:bg-[#0A0A0F] transition-all"
              >
                <Upload size={24} className="mx-auto mb-2 text-zinc-500" />
                <p className="text-xs text-zinc-400">Upload a text style reference</p>
                <p className="text-[10px] text-zinc-600 mt-1">Logo, sign, typography example, etc.</p>
                <p className="text-[10px] text-zinc-500 mt-2">
                  or press <kbd className="px-1.5 py-0.5 rounded bg-[#1a1a2e] border border-[#27273A] text-zinc-400 font-mono text-[9px]">&#8984;V</kbd> to paste
                </p>
              </div>
            )}
            <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => handleRefUpload(e.target.files)} />
          </div>

          {/* Title Text */}
          <div className="bg-[#12121A] border border-[#27273A] rounded-2xl p-5">
            <h3 className="text-sm font-medium text-zinc-400 uppercase tracking-wider mb-3">Title Text</h3>
            <textarea
              value={titleText}
              onChange={(e) => setTitleText(e.target.value)}
              placeholder='e.g. "GRAND OPENING" or "Summer Sale 50% Off"'
              rows={2}
              className="w-full bg-[#0A0A0F] border border-[#27273A] rounded-xl px-3 py-2.5 text-sm text-white placeholder-zinc-600 outline-none focus:border-purple-500/40 transition-colors resize-none"
            />
          </div>

          {/* Text Style Preset */}
          <div className="bg-[#12121A] border border-[#27273A] rounded-2xl p-5">
            <h3 className="text-sm font-medium text-zinc-400 uppercase tracking-wider mb-3">Text Style</h3>
            <div className="flex flex-wrap gap-1.5">
              {TEXT_STYLES.map((s) => (
                <button
                  key={s.id}
                  onClick={() => setTextStyle(s.id)}
                  className={`px-3 py-1.5 rounded-lg border text-[10px] font-medium transition-all ${
                    textStyle === s.id ? 'bg-purple-500/10 border-purple-500/30 text-purple-300' : 'border-[#27273A] bg-[#0A0A0F] text-zinc-400 hover:border-zinc-600'
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          {/* Extra Instructions */}
          <div className="bg-[#12121A] border border-[#27273A] rounded-2xl p-5">
            <h3 className="text-sm font-medium text-zinc-400 uppercase tracking-wider mb-3">Extra Instructions <span className="text-zinc-600 normal-case">(optional)</span></h3>
            <input
              value={extraInstructions}
              onChange={(e) => setExtraInstructions(e.target.value)}
              placeholder="e.g. use red and gold colors, add a subtle shadow"
              className="w-full bg-[#0A0A0F] border border-[#27273A] rounded-xl px-3 py-2.5 text-sm text-white placeholder-zinc-600 outline-none focus:border-purple-500/40 transition-colors"
            />
          </div>

          {/* AI Model */}
          <div className="bg-[#12121A] border border-[#27273A] rounded-2xl p-5">
            <h3 className="text-sm font-medium text-zinc-400 uppercase tracking-wider mb-3">AI Model</h3>
            <div className="grid grid-cols-2 gap-1.5">
              {MODELS.map((m) => (
                <button
                  key={m.id}
                  onClick={() => setModel(m.id)}
                  className={`px-3 py-3 rounded-xl border text-center transition-all ${
                    model === m.id ? 'bg-purple-500/10 border-purple-500/30' : 'border-[#27273A] bg-[#0A0A0F] hover:border-zinc-600'
                  }`}
                >
                  <p className={`text-[12px] font-semibold ${model === m.id ? 'text-purple-300' : 'text-zinc-300'}`}>{m.label}</p>
                  <p className="text-[9px] text-zinc-500 mt-0.5">{m.sub}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Resolution */}
          <div className="bg-[#12121A] border border-[#27273A] rounded-2xl p-5">
            <h3 className="text-sm font-medium text-zinc-400 uppercase tracking-wider mb-3">Resolution</h3>
            <div className="flex gap-1.5">
              {RESOLUTIONS.map((r) => (
                <button
                  key={r.id}
                  onClick={() => setResolution(r.id)}
                  className={`flex-1 py-2 rounded-xl border text-center transition-all ${
                    resolution === r.id ? 'bg-purple-500/10 border-purple-500/30' : 'border-[#27273A] bg-[#0A0A0F] hover:border-zinc-600'
                  }`}
                >
                  <p className={`text-[12px] font-semibold ${resolution === r.id ? 'text-purple-300' : 'text-zinc-300'}`}>{r.label}</p>
                  <p className="text-[9px] text-zinc-500">{r.sub}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Thinking Mode (Flash only) */}
          {model === 'gemini-3.1-flash-image-preview' && (
            <div className="bg-[#12121A] border border-[#27273A] rounded-2xl p-5">
              <h3 className="text-sm font-medium text-zinc-400 uppercase tracking-wider mb-3">Thinking Mode</h3>
              <div className="flex gap-1.5">
                {THINKING_LEVELS.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setThinkingLevel(t.id)}
                    className={`flex-1 py-2 rounded-xl border text-center transition-all ${
                      thinkingLevel === t.id ? 'bg-purple-500/10 border-purple-500/30' : 'border-[#27273A] bg-[#0A0A0F] hover:border-zinc-600'
                    }`}
                  >
                    <p className={`text-[12px] font-semibold ${thinkingLevel === t.id ? 'text-purple-300' : 'text-zinc-300'}`}>{t.label}</p>
                    <p className="text-[9px] text-zinc-500">{t.sub}</p>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Background */}
          <div className="bg-[#12121A] border border-[#27273A] rounded-2xl p-5">
            <h3 className="text-sm font-medium text-zinc-400 uppercase tracking-wider mb-3">Background</h3>
            <div className="grid grid-cols-5 gap-1.5 mb-3">
              {BG_COLORS.map((c) => (
                <button
                  key={c.hex}
                  onClick={() => { setBgColor(c.hex); setCustomBg(''); }}
                  title={c.name}
                  className={`aspect-square rounded-lg border-2 transition-all ${
                    bgColor === c.hex && !customBg
                      ? 'border-purple-400 scale-110 shadow-[0_0_8px_rgba(168,85,247,0.3)]'
                      : 'border-transparent hover:border-zinc-600 hover:scale-105'
                  }`}
                  style={{ backgroundColor: c.hex }}
                />
              ))}
            </div>
            <div className="flex items-center gap-2">
              <input type="color" value={customBg || bgColor} onChange={(e) => setCustomBg(e.target.value)} className="w-8 h-8 rounded-lg border border-[#27273A] cursor-pointer bg-transparent" />
              <input value={customBg || bgColor} onChange={(e) => setCustomBg(e.target.value)} placeholder="#FFFFFF" className="flex-1 bg-[#0A0A0F] border border-[#27273A] rounded-lg px-3 py-1.5 text-xs text-white font-mono placeholder-zinc-600 outline-none focus:border-purple-500/40" />
            </div>
          </div>

          {/* Aspect Ratio */}
          <div className="bg-[#12121A] border border-[#27273A] rounded-2xl p-5">
            <h3 className="text-sm font-medium text-zinc-400 uppercase tracking-wider mb-3">Aspect Ratio</h3>
            <div className="flex gap-1.5">
              {RATIOS.map((r) => (
                <button
                  key={r.id}
                  onClick={() => setRatio(r.id)}
                  className={`flex-1 py-2 rounded-xl border text-center transition-all ${
                    ratio === r.id ? 'bg-purple-500/10 border-purple-500/30' : 'border-[#27273A] bg-[#0A0A0F] hover:border-zinc-600'
                  }`}
                >
                  <p className={`text-[11px] font-medium ${ratio === r.id ? 'text-purple-300' : 'text-zinc-300'}`}>{r.label}</p>
                  <p className="text-[9px] text-zinc-500">{r.sub}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Generate Button */}
          <div className="sticky bottom-0 bg-[#12121A] border border-[#27273A] rounded-2xl p-5">
            <button
              onClick={generate}
              disabled={generating || !titleText.trim()}
              className="w-full flex items-center justify-center gap-2 px-4 py-3.5 rounded-xl bg-gradient-to-r from-purple-600 to-purple-500 text-sm text-white font-medium hover:from-purple-500 hover:to-purple-400 transition-all shadow-[0_0_15px_rgba(168,85,247,0.2)] disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {generating ? (
                <><Loader size={14} className="animate-spin" /> Generating...</>
              ) : (
                <><Plus size={14} /> Generate Title</>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
