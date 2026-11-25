import { authedFetch } from '../lib/api';
import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Upload,
  Loader,
  Download,
  X,
  Check,
  Plus,
  AlertTriangle,
  Edit3,
  Delete,
  Square,
  PenTool,
  CornerUpLeft,
  CornerUpRight,
  Shuffle,
  Trash2,
  Eye,
  EyeOff,
  Layers,
  Zap,
  Image as ImageIcon,
} from '@geist-ui/icons';
import { usePersistedState } from '../hooks/usePersistedState';
import { addToFlowBucket } from './FlowBucket';

/**
 * In Paint — paint over part of an image, describe what goes there, and only
 * that part changes. Backed by /api/content/inpaint (functions/src/lib/falInpaint.ts).
 *
 * The mask lives in an offscreen-sized <canvas> laid over the image. It is kept
 * at most MASK_MAX_EDGE on its long side: a hand-painted mask has no detail
 * finer than that, and the undo history snapshots the whole canvas, so a 4K
 * mask would cost ~64MB per step. The server stretches it to the image.
 */

type Img = { base64: string; mimeType: string };
type Mode = 'fill' | 'erase';
type Tool = 'brush' | 'eraser' | 'rect' | 'lasso';

interface InpaintModelInfo {
  key: string;
  name: string;
  mode: Mode;
  /** Composite = the model has no mask input; we show it the area and paste its edit back. */
  composite?: boolean;
  refs: 'none' | 'optional' | 'required';
  strength?: boolean;
  gpt?: boolean;
  eraseTiers?: boolean;
  price: string;
  blurb: string;
}

// Mirrors MODELS in functions/src/lib/falInpaint.ts. Blurbs come from side-by-side
// test renders, not marketing copy.
const MODELS: InpaintModelInfo[] = [
  { key: 'gpt-image-2.6-flare', name: 'GPT Image 2.6 Flare', mode: 'fill', refs: 'optional', gpt: true, price: '$$', blurb: 'Best all-rounder. Sees the art under your paint and builds on it — ideal for adding small details. Takes reference images.' },
  { key: 'gpt-image-2.6-sunburst', name: 'GPT Image 2.6 Sunburst', mode: 'fill', refs: 'optional', gpt: true, price: '$$$', blurb: 'The top OpenAI tier. Closest match to a reference in testing — for hero shots where detail has to hold up.' },
  { key: 'gpt-image-2.5-flare', name: 'GPT Image 2.5 Flare', mode: 'fill', refs: 'optional', gpt: true, price: '$$', blurb: 'Previous OpenAI generation. Use if 2.6 refuses or drifts on a specific image.' },
  { key: 'ideogram-v3-edit', name: 'Ideogram v3 Edit', mode: 'fill', refs: 'none', price: '$0.09', blurb: 'Cleanest object swaps when the mask covers the whole object. Strong at signage and lettering.' },
  { key: 'flux-pro-fill', name: 'FLUX.1 Pro Fill', mode: 'fill', refs: 'none', price: '$0.05/MP', blurb: 'Photoreal fill that keeps the original object’s shape — good for retexturing and recolouring.' },
  { key: 'bria-genfill', name: 'Bria GenFill', mode: 'fill', refs: 'none', price: '$0.04', blurb: 'Trained on licensed images only — the commercially-safe pick for client work.' },
  { key: 'qwen-inpaint', name: 'Qwen Image Inpaint', mode: 'fill', refs: 'none', strength: true, price: '$0.03/MP', blurb: 'Cheapest fill. Strength dial controls how far it departs from what’s there.' },
  { key: 'kontext-inpaint', name: 'FLUX Kontext Inpaint', mode: 'fill', refs: 'required', strength: true, price: '$0.035/MP', blurb: 'Product placement: drops your reference image into the painted area. Needs a reference.' },
  { key: 'nano-banana-pro', name: 'Nano Banana Pro', mode: 'fill', composite: true, refs: 'optional', price: '$$', blurb: 'Google’s editor has no mask input — we show it the area and paste its edit back. Paint generously.' },
  { key: 'nano-banana-2.1', name: 'Nano Banana 2.1', mode: 'fill', composite: true, refs: 'optional', price: '$$', blurb: 'Newer Nano Banana, same paste-back approach. Paint generously.' },
  { key: 'seedream-5-pro', name: 'Seedream 5 Pro', mode: 'fill', composite: true, refs: 'optional', price: '$', blurb: 'ByteDance editor via paste-back. Good at matching textures.' },
  { key: 'object-removal', name: 'Object Removal', mode: 'erase', refs: 'none', eraseTiers: true, price: '$0.006–$0.024', blurb: 'Removes the object and its shadow/reflection, rebuilding what was behind it.' },
  { key: 'bria-eraser', name: 'Bria Eraser', mode: 'erase', refs: 'none', price: '$0.04', blurb: 'Commercially-safe eraser. Fast and clean on simple backgrounds.' },
];

const GPT_QUALITIES = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
const ERASE_TIERS = [
  ['low_quality', 'Low'],
  ['medium_quality', 'Medium'],
  ['high_quality', 'High'],
  ['best_quality', 'Best'],
] as const;

const MASK_MAX_EDGE = 1536;
const HISTORY_LIMIT = 30;
const MASK_RGB = [168, 85, 247];

interface Variant {
  id: string;
  status: 'running' | 'done' | 'error';
  startedAt: number;
  finishedAt?: number;
  image?: Img;
  error?: string;
  model: string;
}

function readFile(file: File): Promise<Img> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const s = String(r.result);
      resolve({ base64: s.slice(s.indexOf(',') + 1), mimeType: file.type || 'image/png' });
    };
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

const dataUrl = (i: Img) => `data:${i.mimeType};base64,${i.base64}`;

function downloadImg(img: Img, name: string) {
  const a = document.createElement('a');
  a.href = dataUrl(img);
  a.download = name;
  a.click();
}

export interface InpaintEditorProps {
  image: Img;
  /** When set, results get an extra action that hands the image back (e.g. "Add to Composer"). */
  onAdd?: (img: Img) => void;
  addLabel?: string;
}

export function InpaintEditor({ image, onAdd, addLabel = 'Add' }: InpaintEditorProps) {
  // Working image and the versions it replaced ("Continue from this" chains edits).
  const [working, setWorking] = useState<Img>(image);
  const [versions, setVersions] = useState<Img[]>([]);
  // Keyed on the bytes, not the object: a parent re-render hands us a fresh
  // object with the same image, and resetting then would wipe the user's work.
  useEffect(() => {
    setWorking(image);
    setVersions([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [image.base64]);

  // Settings (persisted per browser session).
  const [mode, setMode] = usePersistedState<Mode>('inpaint.mode', 'fill');
  const [fillModel, setFillModel] = usePersistedState<string>('inpaint.fillModel', 'gpt-image-2.6-flare');
  const [eraseModel, setEraseModel] = usePersistedState<string>('inpaint.eraseModel', 'object-removal');
  const [prompt, setPrompt] = usePersistedState<string>('inpaint.prompt', '');
  const [expand, setExpand] = usePersistedState<number>('inpaint.expand', 12);
  const [feather, setFeather] = usePersistedState<number>('inpaint.feather', 10);
  const [protect, setProtect] = usePersistedState<boolean>('inpaint.protect', true);
  const [strength, setStrength] = usePersistedState<number>('inpaint.strength', 0.9);
  const [quality, setQuality] = usePersistedState<string>('inpaint.quality', 'high');
  const [eraseTier, setEraseTier] = usePersistedState<string>('inpaint.eraseTier', 'best_quality');
  const [count, setCount] = usePersistedState<number>('inpaint.count', 2);
  const [brush, setBrush] = usePersistedState<number>('inpaint.brush', 48);
  const [focus, setFocus] = usePersistedState<boolean>('inpaint.focus', true);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [refs, setRefs] = useState<Img[]>([]);

  const modelKey = mode === 'fill' ? fillModel : eraseModel;
  const model = MODELS.find((m) => m.key === modelKey) ?? MODELS.find((m) => m.mode === mode)!;

  // Canvas + tools
  const [tool, setTool] = useState<Tool>('brush');
  const [showMask, setShowMask] = useState(true);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [hasMask, setHasMask] = useState(false);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const undoRef = useRef<ImageData[]>([]);
  const redoRef = useRef<ImageData[]>([]);
  const drawing = useRef<{ last?: [number, number]; start?: [number, number]; subtract?: boolean } | null>(null);
  const [shapePreview, setShapePreview] = useState<{ rect?: [number, number, number, number]; lasso?: [number, number][]; subtract?: boolean } | null>(null);
  const lassoPts = useRef<[number, number][]>([]);
  // Set when painting starts on a result: that result becomes the working image
  // mid-gesture, and the reset below must not wipe the stroke being drawn.
  const keepMaskRef = useRef(false);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [displayScale, setDisplayScale] = useState(1); // canvas px per CSS px
  const [displaySize, setDisplaySize] = useState({ w: 0, h: 0 });
  // Painted area's bounding box (canvas px) — anchors the floating prompt.
  const [maskBox, setMaskBox] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [bubbleOpen, setBubbleOpen] = useState(false);

  // Results
  const [variants, setVariants] = useState<Variant[]>([]);
  const [viewing, setViewing] = useState<string | null>(null);
  const [comparing, setComparing] = useState(false);
  const [added, setAdded] = useState<Record<string, boolean>>({});
  const [now, setNow] = useState(Date.now());
  const running = variants.some((v) => v.status === 'running');
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running]);

  const maskDims = natural
    ? (() => {
        const s = Math.min(1, MASK_MAX_EDGE / Math.max(natural.w, natural.h));
        return { w: Math.max(1, Math.round(natural.w * s)), h: Math.max(1, Math.round(natural.h * s)) };
      })()
    : null;

  // Resizing the canvas clears it — which is exactly what a new working image needs.
  useEffect(() => {
    const c = canvasRef.current;
    if (!c || !maskDims) return;
    if (keepMaskRef.current && c.width === maskDims.w && c.height === maskDims.h) {
      keepMaskRef.current = false;
      return;
    }
    keepMaskRef.current = false;
    c.width = maskDims.w;
    c.height = maskDims.h;
    undoRef.current = [];
    redoRef.current = [];
    setCanUndo(false);
    setCanRedo(false);
    setHasMask(false);
  }, [maskDims?.w, maskDims?.h, working]);

  // Keep track of how many canvas px one CSS px is, for brush size and cursor.
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const update = () => {
      const r = c.getBoundingClientRect();
      if (r.width) {
        setDisplayScale(c.width / r.width);
        setDisplaySize({ w: r.width, h: r.height });
      }
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(c);
    return () => ro.disconnect();
  }, [maskDims?.w, maskDims?.h]);

  const ctx = () => canvasRef.current?.getContext('2d', { willReadFrequently: true }) ?? null;

  const refreshHasMask = useCallback(() => {
    const c = canvasRef.current;
    const x = ctx();
    if (!c || !x) return;
    const d = x.getImageData(0, 0, c.width, c.height).data;
    let x0 = c.width, y0 = c.height, x1 = -1, y1 = -1;
    for (let y = 0; y < c.height; y += 2) {
      const row = y * c.width * 4;
      for (let xx = 0; xx < c.width; xx += 2) {
        if (d[row + xx * 4 + 3] > 0) {
          if (xx < x0) x0 = xx;
          if (xx > x1) x1 = xx;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
      }
    }
    const any = x1 >= 0;
    setHasMask(any);
    setMaskBox(any ? { x0, y0, x1, y1 } : null);
    if (!any) setBubbleOpen(false);
  }, []);

  const snapshot = () => {
    const c = canvasRef.current;
    const x = ctx();
    if (!c || !x) return;
    undoRef.current.push(x.getImageData(0, 0, c.width, c.height));
    if (undoRef.current.length > HISTORY_LIMIT) undoRef.current.shift();
    redoRef.current = [];
    setCanUndo(true);
    setCanRedo(false);
  };

  const undo = useCallback(() => {
    const c = canvasRef.current;
    const x = ctx();
    const prev = undoRef.current.pop();
    if (!c || !x || !prev) return;
    redoRef.current.push(x.getImageData(0, 0, c.width, c.height));
    x.putImageData(prev, 0, 0);
    setCanUndo(undoRef.current.length > 0);
    setCanRedo(true);
    refreshHasMask();
  }, [refreshHasMask]);

  const redo = useCallback(() => {
    const c = canvasRef.current;
    const x = ctx();
    const next = redoRef.current.pop();
    if (!c || !x || !next) return;
    undoRef.current.push(x.getImageData(0, 0, c.width, c.height));
    x.putImageData(next, 0, 0);
    setCanRedo(redoRef.current.length > 0);
    setCanUndo(true);
    refreshHasMask();
  }, [refreshHasMask]);

  const clearMask = () => {
    const c = canvasRef.current;
    const x = ctx();
    if (!c || !x || !hasMask) return;
    snapshot();
    x.clearRect(0, 0, c.width, c.height);
    setHasMask(false);
    setMaskBox(null);
    setBubbleOpen(false);
  };

  const invertMask = () => {
    const c = canvasRef.current;
    const x = ctx();
    if (!c || !x) return;
    snapshot();
    const img = x.getImageData(0, 0, c.width, c.height);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      d[i] = MASK_RGB[0];
      d[i + 1] = MASK_RGB[1];
      d[i + 2] = MASK_RGB[2];
      d[i + 3] = 255 - d[i + 3];
    }
    x.putImageData(img, 0, 0);
    refreshHasMask();
  };

  const toCanvas = (e: React.PointerEvent): [number, number] => {
    const c = canvasRef.current!;
    const r = c.getBoundingClientRect();
    return [((e.clientX - r.left) * c.width) / r.width, ((e.clientY - r.top) * c.height) / r.height];
  };

  const paintStyle = (x: CanvasRenderingContext2D, subtract: boolean) => {
    x.globalCompositeOperation = subtract ? 'destination-out' : 'source-over';
    x.fillStyle = x.strokeStyle = `rgb(${MASK_RGB.join(',')})`;
    x.lineCap = 'round';
    x.lineJoin = 'round';
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.button > 0) return;
    setBubbleOpen(false);
    const x = ctx();
    if (!x) return;
    // Painting on a result = touch it up: it becomes the image being edited and
    // the new mask starts empty, so only the spot painted now gets redone.
    if (viewed) {
      const c = canvasRef.current!;
      x.clearRect(0, 0, c.width, c.height);
      undoRef.current = [];
      redoRef.current = [];
      keepMaskRef.current = true;
      continueFrom(viewed.image!);
      setComparing(false);
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = toCanvas(e);
    const subtract = tool === 'eraser' || e.altKey;
    snapshot();
    if (tool === 'brush' || tool === 'eraser') {
      paintStyle(x, subtract);
      x.beginPath();
      x.arc(p[0], p[1], (brush * displayScale) / 2, 0, Math.PI * 2);
      x.fill();
      drawing.current = { last: p, subtract };
    } else if (tool === 'rect') {
      drawing.current = { start: p, subtract };
      setShapePreview({ rect: [p[0], p[1], 0, 0], subtract });
    } else {
      lassoPts.current = [p];
      drawing.current = { subtract };
      setShapePreview({ lasso: [p], subtract });
    }
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    setCursor({ x: e.clientX - r.left, y: e.clientY - r.top });
    const d = drawing.current;
    if (!d) return;
    const p = toCanvas(e);
    const x = ctx();
    if (!x) return;
    if ((tool === 'brush' || tool === 'eraser') && d.last) {
      paintStyle(x, !!d.subtract);
      x.lineWidth = brush * displayScale;
      x.beginPath();
      x.moveTo(d.last[0], d.last[1]);
      x.lineTo(p[0], p[1]);
      x.stroke();
      d.last = p;
    } else if (tool === 'rect' && d.start) {
      setShapePreview({
        rect: [Math.min(d.start[0], p[0]), Math.min(d.start[1], p[1]), Math.abs(p[0] - d.start[0]), Math.abs(p[1] - d.start[1])],
        subtract: d.subtract,
      });
    } else if (tool === 'lasso') {
      const pts = lassoPts.current;
      const last = pts[pts.length - 1];
      if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) > 2 * displayScale) {
        pts.push(p);
        setShapePreview({ lasso: [...pts], subtract: d.subtract });
      }
    }
  };

  const onPointerUp = () => {
    const d = drawing.current;
    drawing.current = null;
    const x = ctx();
    if (!d || !x) return;
    if (tool === 'rect' && shapePreview?.rect) {
      const [rx, ry, rw, rh] = shapePreview.rect;
      if (rw > 2 && rh > 2) {
        paintStyle(x, !!d.subtract);
        x.fillRect(rx, ry, rw, rh);
      } else {
        undoRef.current.pop(); // a click, not a box — don't leave a no-op undo step
        setCanUndo(undoRef.current.length > 0);
      }
    } else if (tool === 'lasso') {
      const pts = lassoPts.current;
      if (pts.length > 2) {
        paintStyle(x, !!d.subtract);
        x.beginPath();
        x.moveTo(pts[0][0], pts[0][1]);
        for (const p of pts.slice(1)) x.lineTo(p[0], p[1]);
        x.closePath();
        x.fill();
      } else {
        undoRef.current.pop();
        setCanUndo(undoRef.current.length > 0);
      }
      lassoPts.current = [];
    }
    setShapePreview(null);
    refreshHasMask();
    setBubbleOpen(true);
  };

  // Keyboard: B/E/R/L tools, [ ] brush size, ⌘Z / ⇧⌘Z, X invert, M toggle mask.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      const k = e.key.toLowerCase();
      if ((e.metaKey || e.ctrlKey) && k === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (k === 'b') setTool('brush');
      else if (k === 'e') setTool('eraser');
      else if (k === 'r') setTool('rect');
      else if (k === 'l') setTool('lasso');
      else if (k === '[') setBrush((b) => Math.max(4, Math.round(b / 1.2)));
      else if (k === ']') setBrush((b) => Math.min(400, Math.round(b * 1.2)));
      else if (k === 'm') setShowMask((s) => !s);
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo, setBrush]);

  /** White-on-black PNG of the mask, as the server expects. */
  const exportMask = (): string | null => {
    const c = canvasRef.current;
    const x = ctx();
    if (!c || !x) return null;
    const src = x.getImageData(0, 0, c.width, c.height).data;
    const out = document.createElement('canvas');
    out.width = c.width;
    out.height = c.height;
    const ox = out.getContext('2d')!;
    const img = ox.createImageData(c.width, c.height);
    for (let i = 0; i < src.length; i += 4) {
      const a = src[i + 3];
      img.data[i] = img.data[i + 1] = img.data[i + 2] = a;
      img.data[i + 3] = 255;
    }
    ox.putImageData(img, 0, 0);
    const url = out.toDataURL('image/png');
    return url.slice(url.indexOf(',') + 1);
  };

  const needsPrompt = model.mode === 'fill';
  const missingRef = model.refs === 'required' && refs.length === 0;
  const blocker = !hasMask
    ? 'Paint over the area to change'
    : needsPrompt && !prompt.trim()
      ? 'Describe what goes in the painted area'
      : missingRef
        ? `${model.name} needs a reference image`
        : null;

  const run = async () => {
    if (blocker || running) return;
    const mask = exportMask();
    if (!mask) return;
    setBubbleOpen(false);
    const n = Math.max(1, Math.min(4, count));
    const batch: Variant[] = Array.from({ length: n }, () => ({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      status: 'running',
      startedAt: Date.now(),
      model: model.key,
    }));
    setVariants((v) => [...batch, ...v]);
    setNow(Date.now());
    const body = JSON.stringify({
      model: model.key,
      prompt: needsPrompt ? prompt.trim() : '',
      image: working,
      mask: { base64: mask, mimeType: 'image/png' },
      references: model.refs === 'none' ? [] : refs,
      expand,
      feather,
      protect,
      strength,
      quality,
      eraseQuality: eraseTier,
      focus,
    });
    await Promise.all(
      batch.map(async (v) => {
        try {
          const res = await authedFetch('/api/content/inpaint', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body,
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data.error || `In-paint failed (${res.status}).`);
          const img = data.images?.[0];
          if (!img?.base64) throw new Error('No image came back.');
          setVariants((all) =>
            all.map((x) => (x.id === v.id ? { ...x, status: 'done', image: img, finishedAt: Date.now() } : x)),
          );
          setViewing((cur) => cur ?? v.id);
        } catch (e: any) {
          setVariants((all) =>
            all.map((x) =>
              x.id === v.id ? { ...x, status: 'error', error: e?.message || 'In-paint failed.', finishedAt: Date.now() } : x,
            ),
          );
        }
      }),
    );
  };

  const viewed = variants.find((v) => v.id === viewing && v.image);
  const stageImg = viewed && !comparing ? viewed.image! : working;

  const continueFrom = (img: Img) => {
    setVersions((v) => [...v, working]);
    setWorking(img);
    setViewing(null);
  };

  const revert = () => {
    if (!versions.length) return;
    setWorking(versions[versions.length - 1]);
    setVersions(versions.slice(0, -1));
    setViewing(null);
  };

  const addRef = async (files: FileList | null) => {
    if (!files) return;
    const imgs = await Promise.all(Array.from(files).filter((f) => f.type.startsWith('image/')).map(readFile));
    setRefs((r) => [...r, ...imgs].slice(0, 4));
  };

  const fillModels = MODELS.filter((m) => m.mode === 'fill');
  const eraseModels = MODELS.filter((m) => m.mode === 'erase');

  // A render helper, not a component: defined inline as a component it would
  // get a new identity every render and remount mid-click.
  const toolBtn = (id: Tool, icon: React.ReactNode, label: string, keyHint: string) => (
    <button
      key={id}
      onClick={() => setTool(id)}
      title={`${label} (${keyHint})`}
      className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs transition-colors ${
        tool === id ? 'bg-purple-600 text-white' : 'text-zinc-400 hover:text-white hover:bg-white/5'
      }`}
    >
      {icon}
      <span className="hidden sm:inline">{label}</span>
    </button>
  );

  return (
    <div className="grid lg:grid-cols-[1fr_340px] gap-4">
      {/* ── Stage ─────────────────────────────────────────── */}
      <div className="bg-[#12121A] border border-[#27273A] rounded-2xl p-3 sm:p-4 min-w-0">
        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-1 mb-3">
          <div className="flex items-center gap-0.5 bg-[#0A0A0F] border border-[#27273A] rounded-xl p-0.5">
            {toolBtn('brush', <Edit3 size={13} />, 'Brush', 'B')}
            {toolBtn('eraser', <Delete size={13} />, 'Erase', 'E')}
            {toolBtn('rect', <Square size={13} />, 'Box', 'R')}
            {toolBtn('lasso', <PenTool size={13} />, 'Lasso', 'L')}
          </div>
          {(tool === 'brush' || tool === 'eraser') && (
            <label className="flex items-center gap-2 px-2 text-[11px] text-zinc-400" title="Brush size ( [ and ] )">
              Size
              <input
                type="range"
                min={4}
                max={400}
                value={brush}
                onChange={(e) => setBrush(Number(e.target.value))}
                className="w-24 accent-purple-500"
              />
              <span className="tabular-nums w-7 text-zinc-500">{brush}</span>
            </label>
          )}
          <div className="flex items-center gap-0.5 ml-auto">
            <IconBtn onClick={undo} disabled={!canUndo} title="Undo (⌘Z)"><CornerUpLeft size={14} /></IconBtn>
            <IconBtn onClick={redo} disabled={!canRedo} title="Redo (⇧⌘Z)"><CornerUpRight size={14} /></IconBtn>
            <IconBtn onClick={invertMask} disabled={!!viewing} title="Invert mask — change everything except what you painted"><Shuffle size={14} /></IconBtn>
            <IconBtn onClick={() => setShowMask((s) => !s)} title="Show / hide mask (M)">{showMask ? <Eye size={14} /> : <EyeOff size={14} />}</IconBtn>
            <IconBtn onClick={clearMask} disabled={!hasMask || !!viewing} title="Clear mask"><Trash2 size={14} /></IconBtn>
          </div>
        </div>

        {/* Canvas */}
        <div className="flex justify-center bg-[#0A0A0F] rounded-xl p-2 overflow-hidden">
          <div className="relative inline-block max-w-full">
            <img
              src={dataUrl(stageImg)}
              alt=""
              draggable={false}
              onLoad={(e) => {
                if (stageImg !== working) return;
                const el = e.currentTarget;
                setNatural((n) => (n && n.w === el.naturalWidth && n.h === el.naturalHeight ? n : { w: el.naturalWidth, h: el.naturalHeight }));
              }}
              className="block max-w-full max-h-[68vh] w-auto h-auto select-none"
            />
            <canvas
              ref={canvasRef}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              onPointerLeave={() => setCursor(null)}
              className="absolute inset-0 w-full h-full"
              style={{
                opacity: showMask && !viewing ? 0.5 : 0,
                touchAction: 'none',
                cursor: tool === 'brush' || tool === 'eraser' ? 'none' : 'crosshair',
              }}
            />
            {shapePreview && maskDims && (
              <svg
                className="absolute inset-0 w-full h-full pointer-events-none"
                viewBox={`0 0 ${maskDims.w} ${maskDims.h}`}
                preserveAspectRatio="none"
              >
                {shapePreview.rect && (
                  <rect
                    x={shapePreview.rect[0]}
                    y={shapePreview.rect[1]}
                    width={shapePreview.rect[2]}
                    height={shapePreview.rect[3]}
                    fill={shapePreview.subtract ? 'rgba(0,0,0,0.35)' : 'rgba(168,85,247,0.35)'}
                    stroke="white"
                    strokeDasharray="6 4"
                    vectorEffect="non-scaling-stroke"
                  />
                )}
                {shapePreview.lasso && (
                  <polygon
                    points={shapePreview.lasso.map((p) => p.join(',')).join(' ')}
                    fill={shapePreview.subtract ? 'rgba(0,0,0,0.35)' : 'rgba(168,85,247,0.35)'}
                    stroke="white"
                    strokeDasharray="6 4"
                    vectorEffect="non-scaling-stroke"
                  />
                )}
              </svg>
            )}
            {cursor && (tool === 'brush' || tool === 'eraser') && (
              <div
                className="absolute pointer-events-none rounded-full border border-white mix-blend-difference"
                style={{ left: cursor.x - brush / 2, top: cursor.y - brush / 2, width: brush, height: brush }}
              />
            )}
            {bubbleOpen && !viewed && hasMask && maskBox && displaySize.w > 0 && (() => {
              // Canva / Generative-Fill style prompt, pinned under the selection
              // (or above it when there's no room), kept inside the image.
              const bw = Math.min(320, displaySize.w);
              const bh = mode === 'fill' ? 118 : 60;
              const cx = (maskBox.x0 + maskBox.x1) / 2 / displayScale;
              const below = maskBox.y1 / displayScale + 10;
              const above = maskBox.y0 / displayScale - bh - 10;
              const top = below + bh <= displaySize.h ? below : above >= 0 ? above : Math.max(0, displaySize.h - bh);
              const left = Math.min(Math.max(0, cx - bw / 2), displaySize.w - bw);
              return (
                <div
                  className="absolute z-20 rounded-xl bg-[#12121A]/95 border border-purple-500/50 shadow-2xl p-2 backdrop-blur"
                  style={{ left, top, width: bw }}
                  onPointerDown={(e) => e.stopPropagation()}
                >
                  {mode === 'fill' ? (
                    <textarea
                      autoFocus={!prompt}
                      rows={2}
                      value={prompt}
                      onChange={(e) => setPrompt(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          run();
                        } else if (e.key === 'Escape') {
                          setBubbleOpen(false);
                        }
                      }}
                      placeholder="What should change here?"
                      className="w-full bg-[#0A0A0F] border border-[#27273A] rounded-lg px-2 py-1.5 text-xs text-white placeholder-zinc-600 focus:outline-none focus:border-purple-500/60 resize-none"
                    />
                  ) : (
                    <p className="text-xs text-zinc-300 px-1 py-1">Remove what you painted and rebuild what&rsquo;s behind it.</p>
                  )}
                  <div className="flex items-center gap-1 mt-1.5">
                    {model.refs !== 'none' && (
                      <label
                        className={`flex items-center gap-1 px-1.5 py-1 rounded-md text-[10px] cursor-pointer whitespace-nowrap ${refs.length ? 'bg-sky-500/15 text-sky-300' : 'text-zinc-400 hover:text-white hover:bg-white/5'}`}
                        title="Attach a reference image — a close-up of the detail you want, a product shot, a logo"
                      >
                        <ImageIcon size={11} />
                        {refs.length ? `${refs.length} ref` : model.refs === 'required' ? 'Add ref (required)' : 'Reference'}
                        <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => { addRef(e.target.files); e.target.value = ''; }} />
                      </label>
                    )}
                    <span className="text-[10px] text-zinc-600 truncate flex-1" title="Change the model in the side panel">
                      {model.name}
                    </span>
                    <button onClick={() => setBubbleOpen(false)} className="p-1 rounded-md text-zinc-500 hover:text-white" title="Hide (Esc)">
                      <X size={11} />
                    </button>
                    <button
                      onClick={run}
                      disabled={!!blocker || running}
                      title={blocker ?? undefined}
                      className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-gradient-to-r from-purple-600 to-purple-500 text-white text-[11px] font-medium disabled:opacity-40 whitespace-nowrap"
                    >
                      <Zap size={11} />
                      {mode === 'fill' ? 'Generate' : 'Remove'}
                      {count > 1 ? ` ×${count}` : ''}
                    </button>
                  </div>
                </div>
              );
            })()}
            {viewed && (
              <div className="absolute top-2 left-2 px-2 py-0.5 rounded-md bg-black/60 text-[10px] text-white">
                {comparing ? 'Before' : 'After'}
              </div>
            )}
          </div>
        </div>

        {/* Stage footer */}
        <div className="flex flex-wrap items-center gap-2 mt-3 text-[11px] text-zinc-500">
          {viewed ? (
            <>
              <button
                onPointerDown={() => setComparing(true)}
                onPointerUp={() => setComparing(false)}
                onPointerLeave={() => setComparing(false)}
                className="px-2.5 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-zinc-200 select-none"
              >
                Hold to compare
              </button>
              <button
                onClick={() => continueFrom(viewed.image!)}
                className="px-2.5 py-1.5 rounded-lg bg-purple-600/80 hover:bg-purple-600 text-white flex items-center gap-1"
                title="Edit this result instead of the original — paint just the spot that needs fixing and run again"
              >
                <Layers size={12} /> Touch up this result
              </button>
              <button onClick={() => setViewing(null)} className="px-2.5 py-1.5 rounded-lg hover:bg-white/5 text-zinc-300">
                Back to mask
              </button>
              <span className="basis-full text-zinc-500">
                Something off in one spot? Just paint over it here &mdash; the rest of this result is kept and only that spot is redone.
              </span>
            </>
          ) : (
            <span>
              Paint the area to change. Hold <kbd className="text-zinc-400">Alt</kbd> with Box or Lasso to subtract.
              Cover the whole object plus a little margin — a tight outline leaves its shadow behind.
            </span>
          )}
          {versions.length > 0 && (
            <button onClick={revert} className="ml-auto px-2.5 py-1.5 rounded-lg hover:bg-white/5 text-zinc-300" title="Go back to the image before your last 'Continue editing'">
              Undo step ({versions.length})
            </button>
          )}
        </div>

        {/* Results */}
        {variants.length > 0 && (
          <div className="mt-4 border-t border-[#27273A] pt-3">
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-xs font-medium text-zinc-400 uppercase tracking-wider">Results</h4>
              {!running && (
                <button onClick={() => { setVariants([]); setViewing(null); }} className="text-[11px] text-zinc-500 hover:text-zinc-300">
                  Clear
                </button>
              )}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {variants.map((v) => (
                <div
                  key={v.id}
                  className={`rounded-lg overflow-hidden border bg-[#0A0A0F] ${viewing === v.id ? 'border-purple-500' : 'border-[#27273A]'}`}
                >
                  {v.status === 'done' && v.image ? (
                    <>
                      <button onClick={() => setViewing(v.id)} className="block w-full">
                        <img src={dataUrl(v.image)} alt="" className="w-full h-24 object-cover" />
                      </button>
                      <div className="flex items-center gap-1 p-1">
                        <span className="text-[9px] text-zinc-500 truncate flex-1" title={MODELS.find((m) => m.key === v.model)?.name}>
                          {MODELS.find((m) => m.key === v.model)?.name}
                        </span>
                        <IconBtn small onClick={() => downloadImg(v.image!, `inpaint-${v.id}.png`)} title="Download"><Download size={12} /></IconBtn>
                        {onAdd && (
                          <IconBtn
                            small
                            onClick={() => {
                              onAdd(v.image!);
                              setAdded((a) => ({ ...a, [v.id]: true }));
                            }}
                            title={addLabel}
                          >
                            {added[v.id] ? <Check size={12} className="text-emerald-400" /> : <Plus size={12} />}
                          </IconBtn>
                        )}
                      </div>
                    </>
                  ) : v.status === 'running' ? (
                    <div className="h-[124px] flex flex-col items-center justify-center gap-1 text-zinc-500 text-[10px]">
                      <Loader size={16} className="animate-spin text-purple-400" />
                      {Math.max(0, Math.round((now - v.startedAt) / 1000))}s
                    </div>
                  ) : (
                    <div className="h-[124px] p-2 flex flex-col gap-1 text-[10px] text-red-300 overflow-auto">
                      <AlertTriangle size={12} className="shrink-0" />
                      {v.error}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── Controls ──────────────────────────────────────── */}
      <div className="bg-[#12121A] border border-[#27273A] rounded-2xl p-4 space-y-4 h-fit">
        <div className="grid grid-cols-2 gap-1 bg-[#0A0A0F] border border-[#27273A] rounded-xl p-1">
          {(['fill', 'erase'] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`py-1.5 rounded-lg text-xs font-medium transition-colors ${
                mode === m ? 'bg-purple-600 text-white' : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              {m === 'fill' ? 'Replace / Add' : 'Remove'}
            </button>
          ))}
        </div>

        {mode === 'fill' && (
          <div>
            <label className="block text-xs text-zinc-400 mb-1.5">What goes in the painted area?</label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={3}
              placeholder="e.g. a tall glass of fresh orange juice"
              className="w-full bg-[#0A0A0F] border border-[#27273A] rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-purple-500/60 resize-y"
            />
            <p className="text-[10px] text-zinc-600 mt-1">Describe the new thing, not the whole picture.</p>
          </div>
        )}

        <div>
          <label className="block text-xs text-zinc-400 mb-1.5">Model</label>
          <div className="space-y-1.5 max-h-[300px] overflow-y-auto pr-1">
            {(mode === 'fill' ? fillModels : eraseModels).map((m) => (
              <button
                key={m.key}
                onClick={() => (mode === 'fill' ? setFillModel(m.key) : setEraseModel(m.key))}
                className={`w-full text-left rounded-lg border px-2.5 py-2 transition-colors ${
                  model.key === m.key ? 'border-purple-500 bg-purple-500/10' : 'border-[#27273A] hover:border-zinc-600'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-white flex-1">{m.name}</span>
                  {m.composite && <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300">paste-back</span>}
                  {m.refs === 'required' && <span className="text-[9px] px-1.5 py-0.5 rounded bg-sky-500/15 text-sky-300">needs ref</span>}
                  <span className="text-[10px] text-zinc-500">{m.price}</span>
                </div>
                <p className="text-[10px] text-zinc-500 mt-0.5 leading-snug">{m.blurb}</p>
              </button>
            ))}
          </div>
        </div>

        {model.refs !== 'none' && (
          <div>
            <label className="block text-xs text-zinc-400 mb-1.5">
              Reference images {model.refs === 'required' ? <span className="text-sky-300">(required)</span> : <span className="text-zinc-600">(optional)</span>}
            </label>
            <div className="flex flex-wrap gap-1.5">
              {refs.map((r, i) => (
                <div key={i} className="relative w-14 h-14 rounded-lg overflow-hidden border border-[#27273A]">
                  <img src={dataUrl(r)} alt="" className="w-full h-full object-cover" />
                  <button
                    onClick={() => setRefs((all) => all.filter((_, j) => j !== i))}
                    className="absolute top-0.5 right-0.5 p-0.5 rounded bg-black/70 text-white"
                  >
                    <X size={10} />
                  </button>
                </div>
              ))}
              {refs.length < 4 && (
                <label className="w-14 h-14 rounded-lg border border-dashed border-[#3A3A50] hover:border-purple-500/60 flex items-center justify-center text-zinc-500 cursor-pointer">
                  <Plus size={16} />
                  <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => { addRef(e.target.files); e.target.value = ''; }} />
                </label>
              )}
            </div>
            <p className="text-[10px] text-zinc-600 mt-1">e.g. the client&rsquo;s product, logo, or a dish photo to place in the area.</p>
          </div>
        )}

        {model.gpt && (
          <div>
            <label className="block text-xs text-zinc-400 mb-1.5">Quality</label>
            <div className="flex gap-1">
              {GPT_QUALITIES.map((q) => (
                <button
                  key={q}
                  onClick={() => setQuality(q)}
                  className={`flex-1 py-1 rounded-md text-[11px] capitalize ${quality === q ? 'bg-purple-600 text-white' : 'bg-[#0A0A0F] text-zinc-400 hover:text-white border border-[#27273A]'}`}
                >
                  {q === 'xhigh' ? 'X-High' : q}
                </button>
              ))}
            </div>
          </div>
        )}

        {model.eraseTiers && (
          <div>
            <label className="block text-xs text-zinc-400 mb-1.5">Quality</label>
            <div className="flex gap-1">
              {ERASE_TIERS.map(([id, label]) => (
                <button
                  key={id}
                  onClick={() => setEraseTier(id)}
                  className={`flex-1 py-1 rounded-md text-[11px] ${eraseTier === id ? 'bg-purple-600 text-white' : 'bg-[#0A0A0F] text-zinc-400 hover:text-white border border-[#27273A]'}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        )}

        <div>
          <label className="block text-xs text-zinc-400 mb-1.5">Variations</label>
          <div className="flex gap-1">
            {[1, 2, 3, 4].map((n) => (
              <button
                key={n}
                onClick={() => setCount(n)}
                className={`flex-1 py-1 rounded-md text-[11px] ${count === n ? 'bg-purple-600 text-white' : 'bg-[#0A0A0F] text-zinc-400 hover:text-white border border-[#27273A]'}`}
              >
                {n}
              </button>
            ))}
          </div>
        </div>

        <div>
          <button onClick={() => setShowAdvanced((s) => !s)} className="text-xs text-zinc-400 hover:text-zinc-200">
            {showAdvanced ? '− Advanced' : '+ Advanced'}
          </button>
          {showAdvanced && (
            <div className="mt-2 space-y-3">
              <Slider
                label="Grow mask"
                hint="Widens what you painted before the model sees it, so edges and shadows get rebuilt too."
                value={expand}
                min={0}
                max={48}
                unit="px"
                onChange={setExpand}
              />
              <Slider
                label="Edge blend"
                hint="Feathers the seam where the edit meets the original."
                value={feather}
                min={0}
                max={48}
                unit="px"
                onChange={setFeather}
              />
              {model.strength && (
                <Slider
                  label="Strength"
                  hint="Lower keeps more of what's under the mask; 1 ignores it entirely."
                  value={Math.round(strength * 100)}
                  min={5}
                  max={100}
                  unit="%"
                  onChange={(v) => setStrength(v / 100)}
                />
              )}
              <label className="flex items-start gap-2 text-xs">
                <input type="checkbox" checked={focus} onChange={(e) => setFocus(e.target.checked)} className="mt-0.5 accent-purple-500" />
                <span>
                  <span className="text-zinc-200">Zoom into the painted area</span>
                  <span className="block text-[10px] text-zinc-500">
                    For small edits the model works on a close-up of your selection at full resolution, like
                    Photoshop&rsquo;s Generative Fill &mdash; much finer detail. Turn off for edits that need the whole picture as context.
                  </span>
                </span>
              </label>
              <label className={`flex items-start gap-2 text-xs ${model.composite || model.gpt ? 'opacity-60' : ''}`}>
                <input
                  type="checkbox"
                  checked={protect || !!model.composite || !!model.gpt}
                  disabled={!!model.composite || !!model.gpt}
                  onChange={(e) => setProtect(e.target.checked)}
                  className="mt-0.5 accent-purple-500"
                />
                <span>
                  <span className="text-zinc-200">Lock everything outside the mask</span>
                  <span className="block text-[10px] text-zinc-500">
                    {model.composite || model.gpt
                      ? 'Always on for this model — it’s how its edit is kept inside the mask.'
                      : 'Models redraw the whole frame and drift colours and detail. This pastes only the painted area back onto your original.'}
                  </span>
                </span>
              </label>
            </div>
          )}
        </div>

        <button
          onClick={run}
          disabled={!!blocker || running}
          className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-gradient-to-r from-purple-600 to-purple-500 text-white text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {running ? <Loader size={15} className="animate-spin" /> : <Zap size={15} />}
          {running ? 'Painting…' : mode === 'fill' ? `In Paint${count > 1 ? ` × ${count}` : ''}` : `Remove${count > 1 ? ` × ${count}` : ''}`}
        </button>
        {blocker && !running && <p className="text-[11px] text-zinc-500 text-center -mt-2">{blocker}</p>}
      </div>
    </div>
  );
}

function IconBtn({
  children,
  onClick,
  disabled,
  title,
  small,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  title: string;
  small?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`${small ? 'p-1' : 'p-1.5'} rounded-lg text-zinc-400 hover:text-white hover:bg-white/5 disabled:opacity-30 disabled:hover:bg-transparent transition-colors`}
    >
      {children}
    </button>
  );
}

function Slider({
  label,
  hint,
  value,
  min,
  max,
  unit,
  onChange,
}: {
  label: string;
  hint: string;
  value: number;
  min: number;
  max: number;
  unit: string;
  onChange: (v: number) => void;
}) {
  return (
    <label className="block">
      <div className="flex items-center justify-between text-xs">
        <span className="text-zinc-300">{label}</span>
        <span className="text-zinc-500 tabular-nums">
          {value}
          {unit}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-purple-500"
      />
      <span className="block text-[10px] text-zinc-600 leading-snug">{hint}</span>
    </label>
  );
}

/** Full-screen wrapper for opening the editor from another tool (the Composer). */
export function InpaintModal({
  image,
  onClose,
  onAdd,
  addLabel,
}: {
  image: Img;
  onClose: () => void;
  onAdd?: (img: Img) => void;
  addLabel?: string;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[70] bg-black/80 backdrop-blur-sm overflow-y-auto p-2 sm:p-6">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-semibold text-white">In Paint</h3>
          <button onClick={onClose} className="p-2 rounded-lg text-zinc-400 hover:text-white hover:bg-white/10" title="Close (Esc)">
            <X size={18} />
          </button>
        </div>
        <InpaintEditor image={image} onAdd={onAdd} addLabel={addLabel} />
      </div>
    </div>
  );
}

/** Content Creation tab: upload an image, then edit it. */
export default function InpaintStudio() {
  const [image, setImage] = useState<Img | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [bucketMsg, setBucketMsg] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = async (files: FileList | null) => {
    const f = files && Array.from(files).find((x) => x.type.startsWith('image/'));
    if (f) setImage(await readFile(f));
  };

  if (!image) {
    return (
      <div className="bg-[#12121A] border border-[#27273A] rounded-2xl p-5 max-w-3xl">
        <h3 className="text-sm font-medium text-zinc-400 uppercase tracking-wider mb-1">In Paint</h3>
        <p className="text-xs text-zinc-500 mb-4">
          Paint over part of an image and describe what should be there — swap a product, fix a hand, remove a
          stray object, add a sign. Everything you don&rsquo;t paint stays pixel-for-pixel the same.
        </p>
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            load(e.dataTransfer.files);
          }}
          onClick={() => inputRef.current?.click()}
          className={`border-2 border-dashed rounded-xl p-10 flex flex-col items-center justify-center gap-2 cursor-pointer transition-colors ${
            dragOver ? 'border-purple-500 bg-purple-500/5' : 'border-[#3A3A50] hover:border-purple-500/50'
          }`}
        >
          <Upload size={24} className="text-zinc-500" />
          <span className="text-sm text-zinc-300">Drop an image or click to upload</span>
          <span className="text-[11px] text-zinc-600">JPG, PNG or WebP</span>
          <input
            ref={inputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={(e) => {
              load(e.target.files);
              e.target.value = '';
            }}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <button
          onClick={() => setImage(null)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#12121A] border border-[#27273A] text-xs text-zinc-300 hover:text-white"
        >
          <ImageIcon size={13} /> Change image
        </button>
        {bucketMsg && <span className="text-[11px] text-emerald-400">{bucketMsg}</span>}
      </div>
      <InpaintEditor
        image={image}
        addLabel="Save to Flow Bucket"
        onAdd={async (img) => {
          await addToFlowBucket({ name: 'In Paint', base64: img.base64, mimeType: img.mimeType });
          setBucketMsg('Saved to Flow Bucket');
          setTimeout(() => setBucketMsg(null), 2500);
        }}
      />
    </div>
  );
}
