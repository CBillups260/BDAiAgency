import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  Loader,
  Upload,
  X,
  Download,
  Check,
  ChevronRight,
  ChevronLeft,
  RefreshCw,
  Image,
  Bookmark,
  Package,
} from '@geist-ui/icons';
import { addToFlowBucket, useFlowBucketDrop, flowItemToBase64, type FlowBucketItem } from './FlowBucket';
import { useFirestoreAccounts, useFirestoreAccount, useFirestoreMediaAssets } from '../hooks/useFirestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { storage } from '../lib/firebase';

// ─── Types ────────────────────────────────────────────────

interface GraphicAnalysis {
  layout: { type: string; orientation: string; gridDescription: string };
  elements: { type: string; position: string; size: string; content: string; style: string }[];
  colorScheme: { primary: string; secondary: string; accent: string | null; background: string; textColor: string };
  typography: { headingStyle: string; bodyStyle: string; decorativeStyle: string | null };
  mood: string;
  backgroundStyle: string;
}

interface ImageData {
  base64: string;
  mimeType: string;
  preview: string;
}

interface ReplacementAsset {
  image: ImageData;
  description: string;
}

type Stage = 'upload' | 'cropping' | 'analyzing' | 'review' | 'mapping' | 'generating' | 'result';

interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const MODELS = [
  { id: 'gemini-3-pro-image-preview', label: 'Gemini 3 Pro', sub: 'Higher quality' },
  { id: 'gemini-3.1-flash-image-preview', label: 'Gemini 3.1 Flash', sub: 'Faster' },
];

const RESOLUTIONS = [
  { id: '1K', label: '1K' },
  { id: '2K', label: '2K' },
  { id: '4K', label: '4K' },
];

const RATIOS = [
  { id: '1:1', label: '1:1', sub: '1024x1024' },
  { id: '4:5', label: '4:5', sub: '960x1200' },
  { id: '3:4', label: '3:4', sub: '768x1024' },
  { id: '2:3', label: '2:3', sub: '680x1024' },
  { id: '9:16', label: '9:16', sub: '576x1024' },
  { id: '5:4', label: '5:4', sub: '1200x960' },
  { id: '4:3', label: '4:3', sub: '1024x768' },
  { id: '3:2', label: '3:2', sub: '1024x680' },
  { id: '16:9', label: '16:9', sub: '1024x576' },
];

const ELEMENT_COLORS: Record<string, string> = {
  logo: 'bg-purple-500/20 text-purple-300',
  'food-photo': 'bg-amber-500/20 text-amber-300',
  'product-photo': 'bg-blue-500/20 text-blue-300',
  'text-heading': 'bg-emerald-500/20 text-emerald-300',
  'text-subheading': 'bg-teal-500/20 text-teal-300',
  'text-body': 'bg-zinc-500/20 text-zinc-300',
  background: 'bg-zinc-600/20 text-zinc-400',
  shape: 'bg-pink-500/20 text-pink-300',
  decorative: 'bg-rose-500/20 text-rose-300',
  icon: 'bg-indigo-500/20 text-indigo-300',
};

// ─── Component ────────────────────────────────────────────

export default function RemixCreator() {
  const { accounts, loading: accountsLoading } = useFirestoreAccounts();
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const { account: fullAccount } = useFirestoreAccount(selectedAccountId);
  const { assets: savedAssets, addAsset: addMediaAsset } = useFirestoreMediaAssets(selectedAccountId);
  const selectedAccount = accounts.find(a => a.id === selectedAccountId) || null;

  // Stages
  const [stage, setStage] = useState<Stage>('upload');
  const [inputGraphic, setInputGraphic] = useState<ImageData | null>(null);
  const [analysis, setAnalysis] = useState<GraphicAnalysis | null>(null);
  const [replacements, setReplacements] = useState<Map<number, ReplacementAsset>>(new Map());
  const [model, setModel] = useState('gemini-3-pro-image-preview');
  const [resolution, setResolution] = useState('1K');
  const [ratio, setRatio] = useState('1:1');
  const [instructions, setInstructions] = useState('');
  const [improveQuality, setImproveQuality] = useState(false);
  const [textOverrides, setTextOverrides] = useState<Map<number, string>>(new Map());
  const [result, setResult] = useState<{ base64: string; mimeType: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Slider
  const [compareMode, setCompareMode] = useState(false);
  const [sliderPos, setSliderPos] = useState(50);
  const sliderRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const fileRef = useRef<HTMLInputElement>(null);
  const assetFileRefs = useRef<Map<number, HTMLInputElement | null>>(new Map());

  // Flow Bucket drop support
  const flowDrop = useFlowBucketDrop(async (item: FlowBucketItem) => {
    const data = await flowItemToBase64(item);
    const img = new window.Image();
    img.onload = () => {
      setImgNaturalSize({ w: img.naturalWidth, h: img.naturalHeight });
      setCropRect({ x: 0, y: 0, w: img.naturalWidth, h: img.naturalHeight });
      setInputGraphic({ base64: data.base64, mimeType: data.mimeType, preview: data.preview });
      setStage('cropping');
    };
    img.src = data.preview;
  });

  // Crop
  const [cropRect, setCropRect] = useState<CropRect | null>(null);
  const [imgNaturalSize, setImgNaturalSize] = useState<{ w: number; h: number } | null>(null);
  const cropContainerRef = useRef<HTMLDivElement>(null);
  const cropDragging = useRef<{ type: 'move' | 'nw' | 'ne' | 'sw' | 'se' | 'n' | 's' | 'e' | 'w'; startX: number; startY: number; startRect: CropRect } | null>(null);

  // Paste listener
  useEffect(() => {
    const handle = (e: ClipboardEvent) => {
      if ((stage !== 'upload' && stage !== 'cropping') || !selectedAccountId) return;
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of Array.from(items)) {
        if (item.kind === 'file' && item.type.startsWith('image/')) {
          e.preventDefault();
          const file = item.getAsFile();
          if (file) handleFile(file);
          break;
        }
      }
    };
    document.addEventListener('paste', handle);
    return () => document.removeEventListener('paste', handle);
  }, [stage, selectedAccountId]);

  // Slider drag
  const handleSliderMove = useCallback((clientX: number) => {
    if (!sliderRef.current) return;
    const rect = sliderRef.current.getBoundingClientRect();
    setSliderPos(Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100)));
  }, []);

  useEffect(() => {
    const onMove = (e: MouseEvent) => { if (dragging.current) handleSliderMove(e.clientX); };
    const onUp = () => { dragging.current = false; };
    const onTouch = (e: TouchEvent) => { if (dragging.current) handleSliderMove(e.touches[0].clientX); };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('touchmove', onTouch);
    window.addEventListener('touchend', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); window.removeEventListener('touchmove', onTouch); window.removeEventListener('touchend', onUp); };
  }, [handleSliderMove]);

  // ── Handlers ──────────────────────────────────────────

  const handleFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      setInputGraphic({ base64: dataUrl.split(',')[1], mimeType: file.type, preview: dataUrl });
      // Get natural dimensions for crop
      const img = new window.Image();
      img.onload = () => {
        setImgNaturalSize({ w: img.naturalWidth, h: img.naturalHeight });
        setCropRect({ x: 0, y: 0, w: img.naturalWidth, h: img.naturalHeight });
        setStage('cropping');
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  };

  const applyCrop = () => {
    if (!inputGraphic || !cropRect || !imgNaturalSize) return;
    const img = new window.Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = cropRect.w;
      canvas.height = cropRect.h;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, cropRect.x, cropRect.y, cropRect.w, cropRect.h, 0, 0, cropRect.w, cropRect.h);
      const dataUrl = canvas.toDataURL('image/png');
      setInputGraphic({ base64: dataUrl.split(',')[1], mimeType: 'image/png', preview: dataUrl });
      setStage('upload');
    };
    img.src = inputGraphic.preview;
  };

  // Store cropRect in a ref so event handlers always see latest
  const cropRectRef = useRef(cropRect);
  cropRectRef.current = cropRect;
  const imgSizeRef = useRef(imgNaturalSize);
  imgSizeRef.current = imgNaturalSize;

  useEffect(() => {
    if (stage !== 'cropping') return;

    const onMouseMove = (e: MouseEvent) => {
      const d = cropDragging.current;
      const ns = imgSizeRef.current;
      if (!d || !ns || !cropContainerRef.current) return;

      const rect = cropContainerRef.current.getBoundingClientRect();
      const sx = ns.w / rect.width;
      const sy = ns.h / rect.height;
      const dx = (e.clientX - d.startX) * sx;
      const dy = (e.clientY - d.startY) * sy;
      const s = d.startRect;

      let x = s.x, y = s.y, w = s.w, h = s.h;

      if (d.type === 'move') {
        x = Math.max(0, Math.min(ns.w - w, s.x + dx));
        y = Math.max(0, Math.min(ns.h - h, s.y + dy));
      } else {
        // Edges: left
        if (d.type === 'nw' || d.type === 'sw' || d.type === 'w') {
          const newX = Math.max(0, s.x + dx);
          w = s.w + (s.x - newX);
          x = newX;
        }
        // Edges: right
        if (d.type === 'ne' || d.type === 'se' || d.type === 'e') {
          w = Math.min(ns.w - s.x, s.w + dx);
        }
        // Edges: top
        if (d.type === 'nw' || d.type === 'ne' || d.type === 'n') {
          const newY = Math.max(0, s.y + dy);
          h = s.h + (s.y - newY);
          y = newY;
        }
        // Edges: bottom
        if (d.type === 'sw' || d.type === 'se' || d.type === 's') {
          h = Math.min(ns.h - s.y, s.h + dy);
        }
        w = Math.max(40, w);
        h = Math.max(40, h);
      }

      setCropRect({ x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) });
    };

    const onMouseUp = () => { cropDragging.current = null; };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [stage]);

  const analyzeGraphic = async () => {
    if (!inputGraphic) return;
    setStage('analyzing');
    setError(null);
    try {
      const res = await fetch('/api/content/analyze-graphic', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64: inputGraphic.base64, imageMimeType: inputGraphic.mimeType }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setAnalysis(data);
      // Pre-fill text overrides with detected text
      const overrides = new Map<number, string>();
      (data.elements || []).forEach((el: any, i: number) => {
        if (el.type?.startsWith('text') && el.content) {
          overrides.set(i, el.content);
        }
      });
      setTextOverrides(overrides);
      setStage('review');
    } catch (e: any) {
      setError(e.message);
      setStage('upload');
    }
  };

  const analyzeAsset = async (file: File, elementIdx: number) => {
    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = reader.result as string;
      const base64 = dataUrl.split(',')[1];
      const imageData: ImageData = { base64, mimeType: file.type, preview: dataUrl };

      // Auto-analyze
      try {
        const res = await fetch('/api/content/analyze-asset', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ imageBase64: base64, imageMimeType: file.type }),
        });
        const data = await res.json();
        setReplacements(prev => new Map(prev).set(elementIdx, {
          image: imageData,
          description: data.name || data.description || 'Food/product image',
        }));
      } catch {
        setReplacements(prev => new Map(prev).set(elementIdx, {
          image: imageData,
          description: 'Food/product image',
        }));
      }
    };
    reader.readAsDataURL(file);
  };

  const selectSavedAsset = (elementIdx: number, asset: any) => {
    setReplacements(prev => new Map(prev).set(elementIdx, {
      image: { base64: '', mimeType: asset.mimeType || 'image/png', preview: asset.imageUrl },
      description: asset.name || asset.description || 'Asset',
    }));
  };

  const generateRemix = async () => {
    if (!inputGraphic || !analysis) return;
    setStage('generating');
    setError(null);

    const logo = selectedAccount?.primaryLogo || selectedAccount?.lightLogo || selectedAccount?.darkLogo;
    let logoData: { base64: string; mimeType: string } | null = null;
    if (logo) {
      // Fetch logo and convert to base64 if it's a URL
      if (logo.startsWith('data:')) {
        logoData = { base64: logo.split(',')[1], mimeType: logo.split(';')[0].split(':')[1] };
      } else {
        try {
          const res = await fetch(`/api/content/image-proxy?url=${encodeURIComponent(logo)}`);
          const blob = await res.blob();
          const reader = new FileReader();
          const dataUrl: string = await new Promise(resolve => { reader.onload = () => resolve(reader.result as string); reader.readAsDataURL(blob); });
          logoData = { base64: dataUrl.split(',')[1], mimeType: blob.type };
        } catch {}
      }
    }

    // Build replacement assets — need base64 for each
    const repAssets: { base64: string; mimeType: string; description: string }[] = [];
    for (const [, rep] of replacements) {
      if (rep.image.base64) {
        repAssets.push({ base64: rep.image.base64, mimeType: rep.image.mimeType, description: rep.description });
      } else if (rep.image.preview) {
        // Fetch from URL
        try {
          const res = await fetch(`/api/content/image-proxy?url=${encodeURIComponent(rep.image.preview)}`);
          const blob = await res.blob();
          const reader = new FileReader();
          const dataUrl: string = await new Promise(resolve => { reader.onload = () => resolve(reader.result as string); reader.readAsDataURL(blob); });
          repAssets.push({ base64: dataUrl.split(',')[1], mimeType: blob.type, description: rep.description });
        } catch {}
      }
    }

    try {
      const res = await fetch('/api/content/remix-graphic', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          originalImage: { base64: inputGraphic.base64, mimeType: inputGraphic.mimeType },
          analysis,
          logo: logoData,
          brandColors: selectedAccount?.brandColors || [],
          brandFont: selectedAccount?.brandFont || null,
          companyName: selectedAccount?.company || '',
          replacementAssets: repAssets,
          model,
          resolution,
          aspectRatio: ratio,
          additionalInstructions: instructions,
          improveQuality,
          textOverrides: Object.fromEntries(textOverrides),
        }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      if (data.images?.[0]) {
        setResult(data.images[0]);
        setStage('result');
      }
    } catch (e: any) {
      setError(e.message);
      setStage('mapping');
    }
  };

  const downloadResult = () => {
    if (!result) return;
    const link = document.createElement('a');
    link.href = `data:${result.mimeType};base64,${result.base64}`;
    link.download = `remix-${selectedAccount?.company?.replace(/\s+/g, '-') || 'graphic'}-${Date.now()}.png`;
    link.click();
  };

  const saveToLibrary = async () => {
    if (!result || !selectedAccountId || saving) return;
    setSaving(true);
    try {
      const analysisRes = await fetch('/api/content/analyze-asset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64: result.base64, imageMimeType: result.mimeType }),
      });
      const assetAnalysis = await analysisRes.json();

      const fileName = `${Date.now()}-remix-${(assetAnalysis.name || 'graphic').replace(/\s+/g, '-').toLowerCase()}.png`;
      const storageRef = ref(storage, `assets/${selectedAccountId}/${fileName}`);
      const bytes = Uint8Array.from(atob(result.base64), c => c.charCodeAt(0));
      await uploadBytes(storageRef, bytes, { contentType: result.mimeType });
      const imageUrl = await getDownloadURL(storageRef);

      await addMediaAsset({
        accountId: selectedAccountId,
        name: assetAnalysis.name || 'Remixed Graphic',
        category: assetAnalysis.category || 'Graphic',
        tags: assetAnalysis.tags || ['remix'],
        description: assetAnalysis.description || null,
        menuMatch: null,
        imageUrl,
        mimeType: result.mimeType,
      });
    } catch (e: any) {
      setError('Save failed: ' + e.message);
    } finally {
      setSaving(false);
    }
  };

  // Derived
  const photoElements = analysis?.elements.filter(e => e.type === 'food-photo' || e.type === 'product-photo') || [];
  const logoElement = analysis?.elements.find(e => e.type === 'logo');
  const brandLogo = selectedAccount?.primaryLogo || selectedAccount?.lightLogo || selectedAccount?.darkLogo;
  const brandColors = selectedAccount?.brandColors || [];

  // ── Render ────────────────────────────────────────────

  return (
    <div className="max-w-6xl mx-auto space-y-5">
      {/* Account Selector */}
      <div className="bg-[#12121A] border border-[#27273A] rounded-2xl p-5">
        <h3 className="text-sm font-medium text-zinc-400 uppercase tracking-wider mb-3">Select Brand</h3>
        {accountsLoading ? <p className="text-sm text-zinc-600">Loading...</p> : (
          <div className="flex flex-wrap gap-2">
            {accounts.map((acct) => (
              <button
                key={acct.id}
                onClick={() => { setSelectedAccountId(acct.id); setStage('upload'); setAnalysis(null); setResult(null); setReplacements(new Map()); }}
                className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-left transition-all border ${
                  selectedAccountId === acct.id ? 'bg-purple-500/10 border-purple-500/30' : 'border-[#27273A] hover:bg-[#181824]'
                }`}
              >
                <img src={acct.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(acct.company)}&background=27273A&color=fff&size=28`} alt="" className="w-7 h-7 rounded-lg border border-[#27273A] object-cover shrink-0" />
                <span className="text-xs font-medium text-white truncate max-w-[120px]">{acct.company}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {selectedAccount && (
        <>
          {/* Progress Steps */}
          <div className="flex items-center gap-2">
            {[
              { id: 'upload', label: 'Upload' },
              { id: 'crop', label: 'Crop' },
              { id: 'review', label: 'Analysis' },
              { id: 'mapping', label: 'Map Assets' },
              { id: 'result', label: 'Result' },
            ].map((step, i, arr) => {
              const stages: Stage[] = ['upload', 'cropping', 'analyzing', 'review', 'mapping', 'generating', 'result'];
              const currentIdx = stages.indexOf(stage);
              const stepStages: Record<string, number> = { upload: 0, crop: 1, review: 3, mapping: 4, result: 6 };
              const isActive = currentIdx >= stepStages[step.id];
              const isCurrent = (step.id === 'upload' && currentIdx === 0) || (step.id === 'crop' && currentIdx === 1) || (step.id === 'review' && (currentIdx === 2 || currentIdx === 3)) || (step.id === 'mapping' && (currentIdx === 4 || currentIdx === 5)) || (step.id === 'result' && currentIdx === 6);
              return (
                <React.Fragment key={step.id}>
                  <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium transition-all ${
                    isCurrent ? 'bg-purple-500/15 text-purple-300 border border-purple-500/30' : isActive ? 'text-emerald-400' : 'text-zinc-600'
                  }`}>
                    {isActive && !isCurrent && <Check size={10} />}
                    {step.label}
                  </div>
                  {i < arr.length - 1 && <ChevronRight size={12} className="text-zinc-700" />}
                </React.Fragment>
              );
            })}
          </div>

          {/* ── Stage: Cropping ───────────────────────── */}
          {stage === 'cropping' && inputGraphic && imgNaturalSize && cropRect && (
            <div className="bg-[#12121A] border border-[#27273A] rounded-2xl p-5">
              <h3 className="text-sm font-medium text-zinc-400 uppercase tracking-wider mb-2">Crop — Remove Unwanted Areas</h3>
              <p className="text-[10px] text-zinc-600 mb-4">Drag the edges or corners to crop out parts you don't want in the remix.</p>

              <div ref={cropContainerRef} className="relative mx-auto select-none" style={{ maxWidth: 600 }}>
                {/* Full image (dimmed) */}
                <img src={inputGraphic.preview} alt="" className="w-full rounded-xl" style={{ opacity: 0.3 }} draggable={false} />

                {/* Crop overlay */}
                {(() => {
                  const container = cropContainerRef.current;
                  if (!container) return null;
                  const cw = container.offsetWidth;
                  const ch = container.offsetHeight;
                  const sx = cw / imgNaturalSize.w;
                  const sy = ch / imgNaturalSize.h;
                  const cx = cropRect.x * sx;
                  const cy = cropRect.y * sy;
                  const cWidth = cropRect.w * sx;
                  const cHeight = cropRect.h * sy;

                  const onStart = (type: string) => (e: React.MouseEvent) => {
                    e.preventDefault();
                    e.stopPropagation();
                    cropDragging.current = { type: type as any, startX: e.clientX, startY: e.clientY, startRect: { ...cropRect } };
                  };

                  const handleStyle = 'absolute bg-white border-2 border-purple-500 z-10';

                  return (
                    <>
                      {/* Bright crop window */}
                      <div className="absolute overflow-hidden" style={{ left: cx, top: cy, width: cWidth, height: cHeight }}>
                        <img src={inputGraphic.preview} alt="" className="absolute" style={{ left: -cx, top: -cy, width: cw, height: ch }} draggable={false} />
                      </div>

                      {/* Border + move area */}
                      <div
                        className="absolute border-2 border-purple-400 cursor-move"
                        style={{ left: cx, top: cy, width: cWidth, height: cHeight }}
                        onMouseDown={onStart('move')}
                      >
                        {/* Rule of thirds grid lines */}
                        <div className="absolute inset-0 pointer-events-none">
                          <div className="absolute left-1/3 top-0 bottom-0 w-px bg-white/20" />
                          <div className="absolute left-2/3 top-0 bottom-0 w-px bg-white/20" />
                          <div className="absolute top-1/3 left-0 right-0 h-px bg-white/20" />
                          <div className="absolute top-2/3 left-0 right-0 h-px bg-white/20" />
                        </div>

                        {/* Dimension label */}
                        <div className="absolute -top-6 left-1/2 -translate-x-1/2 px-2 py-0.5 rounded bg-purple-600 text-[9px] text-white font-mono whitespace-nowrap">
                          {cropRect.w} x {cropRect.h}
                        </div>
                      </div>

                      {/* Corner handles */}
                      <div className={`${handleStyle} w-4 h-4 rounded-sm cursor-nwse-resize`} style={{ left: cx - 8, top: cy - 8 }} onMouseDown={onStart('nw')} />
                      <div className={`${handleStyle} w-4 h-4 rounded-sm cursor-nesw-resize`} style={{ left: cx + cWidth - 8, top: cy - 8 }} onMouseDown={onStart('ne')} />
                      <div className={`${handleStyle} w-4 h-4 rounded-sm cursor-nesw-resize`} style={{ left: cx - 8, top: cy + cHeight - 8 }} onMouseDown={onStart('sw')} />
                      <div className={`${handleStyle} w-4 h-4 rounded-sm cursor-nwse-resize`} style={{ left: cx + cWidth - 8, top: cy + cHeight - 8 }} onMouseDown={onStart('se')} />

                      {/* Edge midpoint handles */}
                      <div className={`${handleStyle} w-8 h-3 rounded-full cursor-ns-resize`} style={{ left: cx + cWidth / 2 - 16, top: cy - 6 }} onMouseDown={onStart('n')} />
                      <div className={`${handleStyle} w-8 h-3 rounded-full cursor-ns-resize`} style={{ left: cx + cWidth / 2 - 16, top: cy + cHeight - 6 }} onMouseDown={onStart('s')} />
                      <div className={`${handleStyle} w-3 h-8 rounded-full cursor-ew-resize`} style={{ left: cx - 6, top: cy + cHeight / 2 - 16 }} onMouseDown={onStart('w')} />
                      <div className={`${handleStyle} w-3 h-8 rounded-full cursor-ew-resize`} style={{ left: cx + cWidth - 6, top: cy + cHeight / 2 - 16 }} onMouseDown={onStart('e')} />
                    </>
                  );
                })()}
              </div>

              <div className="flex items-center justify-center gap-3 mt-4">
                <button
                  onClick={() => { setCropRect({ x: 0, y: 0, w: imgNaturalSize.w, h: imgNaturalSize.h }); }}
                  className="px-4 py-2 rounded-xl border border-[#27273A] text-xs text-zinc-400 hover:text-zinc-200 hover:bg-[#181824] transition-all"
                >
                  Reset
                </button>
                <button
                  onClick={() => setStage('upload')}
                  className="px-4 py-2 rounded-xl border border-[#27273A] text-xs text-zinc-400 hover:text-zinc-200 hover:bg-[#181824] transition-all"
                >
                  Skip Crop
                </button>
                <button
                  onClick={applyCrop}
                  className="flex items-center gap-2 px-5 py-2 rounded-xl bg-gradient-to-r from-purple-600 to-purple-500 text-sm text-white font-medium hover:from-purple-500 hover:to-purple-400 transition-all"
                >
                  <Check size={14} /> Apply Crop
                </button>
              </div>
            </div>
          )}

          {/* ── Stage: Upload ──────────────────────────── */}
          {(stage === 'upload' || stage === 'analyzing') && (
            <div className="bg-[#12121A] border border-[#27273A] rounded-2xl p-5">
              <h3 className="text-sm font-medium text-zinc-400 uppercase tracking-wider mb-4">Upload Graphic to Remix</h3>

              {inputGraphic ? (
                <div className="space-y-4">
                  <div
                    className={`relative max-w-md mx-auto rounded-xl border-2 transition-all ${flowDrop.dragOver ? 'border-amber-400' : 'border-transparent'}`}
                    onDragOver={flowDrop.handleDragOver}
                    onDragLeave={flowDrop.handleDragLeave}
                    onDrop={flowDrop.handleDrop}
                  >
                    <img src={inputGraphic.preview} alt="" className="w-full rounded-xl border border-[#27273A]" />
                    {flowDrop.dragOver && (
                      <div className="absolute inset-0 bg-amber-500/20 rounded-xl flex items-center justify-center">
                        <span className="text-xs text-amber-300 font-medium bg-black/60 px-3 py-1.5 rounded-lg">Drop to replace</span>
                      </div>
                    )}
                    <button onClick={() => { setInputGraphic(null); setAnalysis(null); }} className="absolute top-2 right-2 p-1.5 rounded-lg bg-black/60 text-white hover:bg-black/80"><X size={14} /></button>
                  </div>
                  <div className="flex justify-center">
                    <button
                      onClick={analyzeGraphic}
                      disabled={stage === 'analyzing'}
                      className="flex items-center gap-2 px-6 py-3 rounded-xl bg-gradient-to-r from-purple-600 to-purple-500 text-sm text-white font-medium hover:from-purple-500 hover:to-purple-400 transition-all disabled:opacity-40"
                    >
                      {stage === 'analyzing' ? <><Loader size={14} className="animate-spin" /> Analyzing design...</> : <><ChevronRight size={14} /> Analyze Design</>}
                    </button>
                  </div>
                </div>
              ) : (
                <div
                  onClick={() => fileRef.current?.click()}
                  onDragOver={flowDrop.handleDragOver}
                  onDragLeave={flowDrop.handleDragLeave}
                  onDrop={flowDrop.handleDrop}
                  className={`border-2 border-dashed rounded-xl p-12 text-center cursor-pointer transition-all ${
                    flowDrop.dragOver ? 'border-amber-400 bg-amber-500/10' : 'border-[#27273A] hover:border-zinc-600 hover:bg-[#0A0A0F]'
                  }`}
                >
                  <Upload size={36} className="mx-auto mb-3 text-zinc-500" />
                  <p className="text-sm text-zinc-400">Upload a graphic to remix</p>
                  <p className="text-[10px] text-zinc-600 mt-1">Social post, flyer, menu graphic, ad — any design</p>
                  <p className="text-[10px] text-zinc-500 mt-2">
                    or <kbd className="px-1.5 py-0.5 rounded bg-[#1a1a2e] border border-[#27273A] text-zinc-400 font-mono text-[9px]">&#8984;V</kbd> to paste
                  </p>
                </div>
              )}
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
            </div>
          )}

          {/* ── Stage: Review Analysis ─────────────────── */}
          {stage === 'review' && analysis && (
            <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-5">
              <div className="bg-[#12121A] border border-[#27273A] rounded-2xl p-5">
                <h3 className="text-sm font-medium text-zinc-400 uppercase tracking-wider mb-4">Design Analysis</h3>

                {/* Layout */}
                <div className="mb-4 p-3 bg-[#0A0A0F] rounded-xl border border-[#27273A]">
                  <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">Layout</p>
                  <p className="text-sm text-zinc-200">{analysis.layout.gridDescription}</p>
                  <div className="flex gap-2 mt-2">
                    <span className="text-[9px] px-2 py-0.5 rounded bg-[#27273A] text-zinc-400 capitalize">{analysis.layout.type}</span>
                    <span className="text-[9px] px-2 py-0.5 rounded bg-[#27273A] text-zinc-400 capitalize">{analysis.layout.orientation}</span>
                  </div>
                </div>

                {/* Elements */}
                <div className="mb-4">
                  <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-2">Detected Elements ({analysis.elements.length})</p>
                  <div className="space-y-1.5">
                    {analysis.elements.map((el, i) => (
                      <div key={i} className="flex items-start gap-2 p-2 bg-[#0A0A0F] rounded-lg border border-[#27273A]">
                        <span className={`text-[9px] px-1.5 py-0.5 rounded font-medium capitalize shrink-0 ${ELEMENT_COLORS[el.type] || 'bg-zinc-500/20 text-zinc-400'}`}>{el.type}</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-[11px] text-zinc-300 truncate">{el.content}</p>
                          <p className="text-[9px] text-zinc-600">{el.position} · {el.size}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Colors */}
                <div className="mb-4">
                  <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-2">Color Scheme</p>
                  <div className="flex gap-2">
                    {[
                      { label: 'Primary', color: analysis.colorScheme.primary },
                      { label: 'Secondary', color: analysis.colorScheme.secondary },
                      { label: 'Accent', color: analysis.colorScheme.accent },
                    ].filter(c => c.color).map((c, i) => (
                      <div key={i} className="text-center">
                        <div className="w-10 h-10 rounded-lg border border-[#27273A]" style={{ backgroundColor: c.color! }} />
                        <p className="text-[8px] text-zinc-600 mt-0.5">{c.label}</p>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Mood */}
                <div className="p-3 bg-[#0A0A0F] rounded-xl border border-[#27273A]">
                  <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">Mood</p>
                  <p className="text-sm text-zinc-300">{analysis.mood}</p>
                </div>
              </div>

              {/* Right: Preview + Action */}
              <div className="space-y-4">
                <div className="bg-[#12121A] border border-[#27273A] rounded-2xl p-5">
                  <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-2">Original</p>
                  <img src={inputGraphic!.preview} alt="" className="w-full rounded-xl border border-[#27273A]" />
                </div>
                <button
                  onClick={() => setStage('mapping')}
                  className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-gradient-to-r from-purple-600 to-purple-500 text-sm text-white font-medium hover:from-purple-500 hover:to-purple-400 transition-all"
                >
                  <ChevronRight size={14} /> Continue to Asset Mapping
                </button>
              </div>
            </div>
          )}

          {/* ── Stage: Mapping ─────────────────────────── */}
          {(stage === 'mapping' || stage === 'generating') && analysis && (
            <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-5">
              <div className="space-y-4">
                {/* Brand Assets Summary */}
                <div className="bg-[#12121A] border border-[#27273A] rounded-2xl p-5">
                  <h3 className="text-sm font-medium text-zinc-400 uppercase tracking-wider mb-3">Brand Assets</h3>
                  <div className="flex items-center gap-4">
                    {/* Logo */}
                    <div className="text-center">
                      <p className="text-[9px] text-zinc-500 mb-1">Logo</p>
                      {brandLogo ? (
                        <div className="w-16 h-12 rounded-lg border border-[#27273A] bg-[#0A0A0F] flex items-center justify-center p-1">
                          <img src={brandLogo} alt="" className="max-h-full max-w-full object-contain" />
                        </div>
                      ) : (
                        <div className="w-16 h-12 rounded-lg border border-dashed border-amber-500/30 bg-amber-500/5 flex items-center justify-center">
                          <span className="text-[8px] text-amber-400">Not set</span>
                        </div>
                      )}
                    </div>
                    {/* Colors */}
                    <div>
                      <p className="text-[9px] text-zinc-500 mb-1">Brand Colors</p>
                      {brandColors.length > 0 ? (
                        <div className="flex gap-1">
                          {brandColors.map((c, i) => <div key={i} className="w-8 h-8 rounded-lg border border-[#27273A]" style={{ backgroundColor: c }} />)}
                        </div>
                      ) : (
                        <span className="text-[9px] text-amber-400">Not set in CRM</span>
                      )}
                    </div>
                  </div>
                  {(!brandLogo || brandColors.length === 0) && (
                    <p className="text-[9px] text-amber-400/70 mt-2">Missing brand assets — add them in the CRM Accounts section for best results.</p>
                  )}
                </div>

                {/* Photo/Product Replacements */}
                {photoElements.length > 0 && (
                  <div className="bg-[#12121A] border border-[#27273A] rounded-2xl p-5">
                    <h3 className="text-sm font-medium text-zinc-400 uppercase tracking-wider mb-3">
                      Replace Images ({replacements.size}/{photoElements.length} mapped)
                    </h3>
                    <div className="space-y-3">
                      {photoElements.map((el, i) => {
                        const elIdx = analysis.elements.indexOf(el);
                        const rep = replacements.get(elIdx);
                        return (
                          <div key={i} className="p-3 bg-[#0A0A0F] rounded-xl border border-[#27273A]">
                            <div className="flex items-center justify-between mb-2">
                              <div>
                                <span className={`text-[9px] px-1.5 py-0.5 rounded font-medium ${ELEMENT_COLORS[el.type] || ''}`}>{el.type}</span>
                                <span className="text-[10px] text-zinc-500 ml-2">{el.position}</span>
                              </div>
                              {rep && (
                                <button onClick={() => { const m = new Map(replacements); m.delete(elIdx); setReplacements(m); }} className="text-[9px] text-zinc-500 hover:text-zinc-300">
                                  <X size={10} />
                                </button>
                              )}
                            </div>
                            <p className="text-[10px] text-zinc-400 mb-2">Original: "{el.content}"</p>

                            {rep ? (
                              <div className="flex items-center gap-3">
                                <img src={rep.image.preview} alt="" className="w-16 h-16 rounded-lg object-cover border border-[#27273A]" />
                                <div>
                                  <p className="text-[11px] text-emerald-400 flex items-center gap-1"><Check size={10} /> Mapped</p>
                                  <p className="text-[9px] text-zinc-500">{rep.description}</p>
                                </div>
                              </div>
                            ) : (
                              <div className="flex gap-2">
                                <label className="flex-1 border border-dashed border-[#27273A] rounded-lg py-3 text-center cursor-pointer hover:border-zinc-600 transition-colors">
                                  <Upload size={14} className="mx-auto mb-1 text-zinc-500" />
                                  <span className="text-[10px] text-zinc-500">Upload</span>
                                  <input type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) analyzeAsset(f, elIdx); }} />
                                </label>
                                {savedAssets.length > 0 && (
                                  <div className="flex-1 border border-[#27273A] rounded-lg p-2 max-h-24 overflow-y-auto">
                                    <p className="text-[8px] text-zinc-600 mb-1">From Library</p>
                                    <div className="flex flex-wrap gap-1">
                                      {savedAssets.slice(0, 6).map(asset => (
                                        <button key={asset.id} onClick={() => selectSavedAsset(elIdx, asset)} className="w-9 h-9 rounded border border-[#27273A] overflow-hidden hover:border-purple-500/40 transition-colors">
                                          <img src={asset.imageUrl} alt="" className="w-full h-full object-contain" />
                                        </button>
                                      ))}
                                    </div>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Text Overrides */}
                {textOverrides.size > 0 && (
                  <div className="bg-[#12121A] border border-[#27273A] rounded-2xl p-5">
                    <h3 className="text-sm font-medium text-zinc-400 uppercase tracking-wider mb-1">Edit Text</h3>
                    <p className="text-[9px] text-zinc-600 mb-3">Detected text from the graphic — edit to personalize your remix</p>
                    <div className="space-y-3">
                      {analysis!.elements.map((el, i) => {
                        if (!el.type?.startsWith('text') || !el.content) return null;
                        const override = textOverrides.get(i);
                        const isChanged = override !== el.content;
                        return (
                          <div key={i}>
                            <div className="flex items-center justify-between mb-1">
                              <span className={`text-[9px] px-1.5 py-0.5 rounded font-medium capitalize ${
                                el.type === 'text-heading' ? 'bg-emerald-500/20 text-emerald-300' :
                                el.type === 'text-subheading' ? 'bg-teal-500/20 text-teal-300' :
                                'bg-zinc-500/20 text-zinc-400'
                              }`}>{el.type.replace('text-', '')}</span>
                              {isChanged && (
                                <button
                                  onClick={() => setTextOverrides(prev => new Map(prev).set(i, el.content))}
                                  className="text-[8px] text-zinc-600 hover:text-zinc-400"
                                >
                                  Reset
                                </button>
                              )}
                            </div>
                            <div className="relative">
                              <input
                                value={override ?? el.content}
                                onChange={(e) => setTextOverrides(prev => new Map(prev).set(i, e.target.value))}
                                className={`w-full bg-[#0A0A0F] border rounded-lg px-3 py-2 text-sm text-white outline-none transition-colors ${
                                  isChanged ? 'border-purple-500/40' : 'border-[#27273A]'
                                } focus:border-purple-500/40`}
                              />
                              {isChanged && (
                                <div className="absolute right-2 top-1/2 -translate-y-1/2">
                                  <span className="text-[8px] text-purple-400 bg-purple-500/10 px-1.5 py-0.5 rounded">edited</span>
                                </div>
                              )}
                            </div>
                            <p className="text-[8px] text-zinc-700 mt-0.5">{el.position} · {el.style}</p>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Additional Instructions */}
                <div className="bg-[#12121A] border border-[#27273A] rounded-2xl p-5">
                  <h3 className="text-sm font-medium text-zinc-400 uppercase tracking-wider mb-3">Additional Instructions</h3>
                  <textarea
                    value={instructions}
                    onChange={(e) => setInstructions(e.target.value)}
                    placeholder="Optional: e.g. Change the heading to say 'GRAND OPENING', make the background darker, add a 20% OFF badge..."
                    rows={3}
                    className="w-full bg-[#0A0A0F] border border-[#27273A] rounded-xl px-3 py-2.5 text-sm text-white placeholder-zinc-600 outline-none resize-none focus:border-purple-500/40"
                  />
                </div>
              </div>

              {/* Right: Settings + Generate */}
              <div className="space-y-4">
                <div className="bg-[#12121A] border border-[#27273A] rounded-2xl p-5">
                  <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-2">Original</p>
                  <img src={inputGraphic!.preview} alt="" className="w-full rounded-xl border border-[#27273A] mb-4" />

                  <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-2">Model</p>
                  <div className="grid grid-cols-2 gap-1.5 mb-3">
                    {MODELS.map(m => (
                      <button key={m.id} onClick={() => setModel(m.id)} className={`py-2 rounded-lg border text-center transition-all ${model === m.id ? 'bg-purple-500/10 border-purple-500/30' : 'border-[#27273A] bg-[#0A0A0F] hover:border-zinc-600'}`}>
                        <p className={`text-[10px] font-medium ${model === m.id ? 'text-purple-300' : 'text-zinc-300'}`}>{m.label}</p>
                      </button>
                    ))}
                  </div>

                  <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-2">Resolution</p>
                  <div className="flex gap-1.5 mb-3">
                    {RESOLUTIONS.map(r => (
                      <button key={r.id} onClick={() => setResolution(r.id)} className={`flex-1 py-1.5 rounded-lg border text-[10px] font-medium transition-all ${resolution === r.id ? 'bg-purple-500/10 border-purple-500/30 text-purple-300' : 'border-[#27273A] text-zinc-400'}`}>{r.label}</button>
                    ))}
                  </div>

                  <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-2">Aspect Ratio</p>
                  <div className="grid grid-cols-3 gap-1.5 mb-4">
                    {RATIOS.map(r => (
                      <button key={r.id} onClick={() => setRatio(r.id)} className={`py-2 rounded-lg border text-center transition-all ${ratio === r.id ? 'bg-purple-500/10 border-purple-500/30' : 'border-[#27273A] hover:border-zinc-600'}`}>
                        <p className={`text-[10px] font-medium ${ratio === r.id ? 'text-purple-300' : 'text-zinc-300'}`}>{r.label}</p>
                        <p className="text-[8px] text-zinc-600">{r.sub}</p>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Improve Quality Toggle */}
                <div
                  onClick={() => setImproveQuality(!improveQuality)}
                  className={`flex items-center justify-between p-4 rounded-xl border cursor-pointer transition-all ${
                    improveQuality ? 'bg-purple-500/10 border-purple-500/30' : 'border-[#27273A] hover:border-zinc-600'
                  }`}
                >
                  <div>
                    <p className={`text-[12px] font-medium ${improveQuality ? 'text-purple-300' : 'text-zinc-300'}`}>Improve Quality</p>
                    <p className="text-[9px] text-zinc-500 mt-0.5">Enhance composition, lighting, and overall visual polish</p>
                  </div>
                  <div className={`w-9 h-5 rounded-full transition-colors flex items-center ${improveQuality ? 'bg-purple-500 justify-end' : 'bg-[#27273A] justify-start'}`}>
                    <div className="w-4 h-4 rounded-full bg-white mx-0.5 shadow" />
                  </div>
                </div>

                <button
                  onClick={generateRemix}
                  disabled={stage === 'generating'}
                  className="w-full flex items-center justify-center gap-2 px-4 py-3.5 rounded-xl bg-gradient-to-r from-purple-600 to-purple-500 text-sm text-white font-medium hover:from-purple-500 hover:to-purple-400 transition-all shadow-[0_0_15px_rgba(168,85,247,0.2)] disabled:opacity-40"
                >
                  {stage === 'generating' ? <><Loader size={14} className="animate-spin" /> Remixing...</> : <><RefreshCw size={14} /> Remix Graphic</>}
                </button>
              </div>
            </div>
          )}

          {/* ── Stage: Result ──────────────────────────── */}
          {stage === 'result' && result && (
            <div className="space-y-5">
              <div className="bg-[#12121A] border border-[#27273A] rounded-2xl p-5">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-medium text-zinc-400 uppercase tracking-wider">Remix Result</h3>
                  <div className="flex items-center gap-2">
                    <button onClick={() => setCompareMode(!compareMode)} className={`px-3 py-1.5 rounded-lg text-[11px] font-medium transition-all border ${compareMode ? 'bg-purple-500/15 border-purple-500/30 text-purple-300' : 'border-[#27273A] text-zinc-500 hover:text-zinc-300'}`}>Before / After</button>
                    {selectedAccountId && (
                      <button onClick={saveToLibrary} disabled={saving} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-purple-500/30 text-purple-300 hover:bg-purple-500/10 transition-all disabled:opacity-40">
                        {saving ? <Loader size={12} className="animate-spin" /> : <Bookmark size={12} />}
                        {saving ? 'Saving...' : 'Save to Library'}
                      </button>
                    )}
                    <button onClick={downloadResult} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-gradient-to-r from-purple-600 to-purple-500 text-white hover:from-purple-500 hover:to-purple-400 transition-all">
                      <Download size={12} /> Download
                    </button>
                    <button
                      onClick={() => { if (result) addToFlowBucket({ name: `Remix ${selectedAccount?.company || ''}`, base64: result.base64, mimeType: result.mimeType }); }}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-amber-500/30 text-amber-300 hover:bg-amber-500/10 transition-all"
                    >
                      <Package size={12} /> Flow
                    </button>
                  </div>
                </div>

                {compareMode && inputGraphic ? (
                  <div
                    ref={sliderRef}
                    className="relative rounded-xl overflow-hidden border border-[#27273A] mx-auto cursor-col-resize select-none"
                    style={{ maxWidth: 600 }}
                    onMouseDown={(e) => { dragging.current = true; handleSliderMove(e.clientX); }}
                    onTouchStart={(e) => { dragging.current = true; handleSliderMove(e.touches[0].clientX); }}
                  >
                    <img src={`data:${result.mimeType};base64,${result.base64}`} alt="After" className="w-full" />
                    <div className="absolute inset-0 overflow-hidden" style={{ width: `${sliderPos}%` }}>
                      <img src={inputGraphic.preview} alt="Before" style={{ width: sliderRef.current?.offsetWidth || '100%', height: '100%', objectFit: 'cover' }} />
                    </div>
                    <div className="absolute top-0 bottom-0 z-10" style={{ left: `${sliderPos}%`, transform: 'translateX(-50%)' }}>
                      <div className="w-0.5 h-full bg-white shadow-[0_0_8px_rgba(0,0,0,0.5)]" />
                      <div className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-10 h-10 rounded-full bg-white shadow-lg flex items-center justify-center">
                        <div className="flex items-center gap-0.5 text-zinc-600">
                          <svg width="8" height="12" viewBox="0 0 8 12" fill="currentColor"><path d="M6 0L0 6l6 6V0z"/></svg>
                          <svg width="8" height="12" viewBox="0 0 8 12" fill="currentColor"><path d="M2 0l6 6-6 6V0z"/></svg>
                        </div>
                      </div>
                    </div>
                    <div className="absolute top-3 left-3 px-2 py-1 rounded-md bg-black/60 text-[10px] text-white font-medium z-10">Original</div>
                    <div className="absolute top-3 right-3 px-2 py-1 rounded-md bg-black/60 text-[10px] text-white font-medium z-10">Remixed</div>
                  </div>
                ) : (
                  <div className="flex gap-4 justify-center">
                    <div className="flex-1 max-w-sm">
                      <p className="text-[10px] text-zinc-500 mb-1.5 text-center">Original</p>
                      <img src={inputGraphic!.preview} alt="" className="w-full rounded-xl border border-[#27273A]" />
                    </div>
                    <div className="flex-1 max-w-sm">
                      <p className="text-[10px] text-zinc-500 mb-1.5 text-center">Remixed</p>
                      <img src={`data:${result.mimeType};base64,${result.base64}`} alt="" className="w-full rounded-xl border border-purple-500/30" />
                    </div>
                  </div>
                )}
              </div>

              <div className="flex gap-3 justify-center">
                <button onClick={() => setStage('mapping')} className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-[#27273A] text-xs text-zinc-400 hover:text-zinc-200 hover:bg-[#181824] transition-all">
                  <RefreshCw size={12} /> Remix Again
                </button>
                <button onClick={() => { setStage('upload'); setInputGraphic(null); setAnalysis(null); setResult(null); setReplacements(new Map()); setInstructions(''); }} className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-[#27273A] text-xs text-zinc-400 hover:text-zinc-200 hover:bg-[#181824] transition-all">
                  <Upload size={12} /> New Graphic
                </button>
              </div>
            </div>
          )}

          {error && (
            <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-3">
              <p className="text-xs text-red-400">{error}</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
