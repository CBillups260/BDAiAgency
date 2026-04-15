import React, { useState, useRef, useCallback } from 'react';
import {
  Image,
  Layers,
  Download,
  Trash2,
  Eye,
  EyeOff,
  Star,
  Loader,
  Plus,
  Edit3,
  RefreshCw,
  Check,
  X,
  Package,
} from '@geist-ui/icons';
import { motion } from 'motion/react';
import CaptionGenerator from './CaptionGenerator';
import ReviewGraphicGenerator from './ReviewGraphicGenerator';
import SocialPostPreview from './SocialPostPreview';
import CaptionWidget from './CaptionWidget';
import AssetCreator from './AssetCreator';
import RemixCreator from './RemixCreator';
import VideoCreator from './VideoCreator';
import QuoteGenerator from './QuoteGenerator';
import SubjectIsolator from './SubjectIsolator';
import GhlSchedulePanel from './GhlSchedulePanel';
import { addToFlowBucket, useFlowBucketDrop, flowItemToBase64, type FlowBucketItem } from './FlowBucket';

interface ContentLayer {
  id: string;
  name: string;
  type: 'background';
  visible: boolean;
  data?: string;
  mimeType?: string;
}

const ASPECT_RATIOS = [
  { id: '1:1', label: '1:1', sub: 'Square', w: 1, h: 1 },
  { id: '4:5', label: '4:5', sub: 'IG Post', w: 4, h: 5 },
  { id: '5:4', label: '5:4', sub: 'Landscape', w: 5, h: 4 },
  { id: '3:4', label: '3:4', sub: 'Portrait', w: 3, h: 4 },
  { id: '4:3', label: '4:3', sub: 'Standard', w: 4, h: 3 },
  { id: '2:3', label: '2:3', sub: 'Pinterest', w: 2, h: 3 },
  { id: '3:2', label: '3:2', sub: 'Photo', w: 3, h: 2 },
  { id: '9:16', label: '9:16', sub: 'Story/Reel', w: 9, h: 16 },
  { id: '16:9', label: '16:9', sub: 'Wide/YT', w: 16, h: 9 },
] as const;

type RatioId = (typeof ASPECT_RATIOS)[number]['id'];

const STYLE_PRESETS = [
  { id: 'none', label: 'None', prompt: '' },
  { id: 'vector', label: 'Vector', prompt: 'clean vector illustration style, flat design, sharp edges' },
  { id: 'gradient', label: 'Gradient', prompt: 'smooth gradient background, soft color transitions, modern' },
  { id: 'abstract', label: 'Abstract', prompt: 'abstract art style, organic shapes, artistic composition' },
  { id: '3d-render', label: '3D Render', prompt: '3D rendered style, volumetric lighting, depth, modern 3D' },
  { id: 'geometric', label: 'Geometric', prompt: 'geometric pattern, clean lines, symmetrical shapes, modern' },
  { id: 'watercolor', label: 'Watercolor', prompt: 'watercolor painting style, soft washes, artistic, textured paper' },
  { id: 'minimal', label: 'Minimal', prompt: 'minimalist design, lots of negative space, clean, simple' },
  { id: 'neon', label: 'Neon Glow', prompt: 'neon glow aesthetic, dark background, vibrant neon lights, cyberpunk' },
  { id: 'texture', label: 'Texture', prompt: 'rich textured surface, tactile, detailed material texture' },
  { id: 'photo', label: 'Photo Real', prompt: 'photorealistic, high quality photograph, 4K, HDR, professional photography' },
  { id: 'retro', label: 'Retro', prompt: 'retro vintage style, nostalgic, 70s/80s color palette, grain' },
] as const;

type StyleId = (typeof STYLE_PRESETS)[number]['id'];

const COLOR_PALETTE = [
  { hex: '#EF4444', name: 'Red' },
  { hex: '#F97316', name: 'Orange' },
  { hex: '#EAB308', name: 'Yellow' },
  { hex: '#22C55E', name: 'Green' },
  { hex: '#06B6D4', name: 'Cyan' },
  { hex: '#3B82F6', name: 'Blue' },
  { hex: '#8B5CF6', name: 'Purple' },
  { hex: '#EC4899', name: 'Pink' },
  { hex: '#F43F5E', name: 'Rose' },
  { hex: '#14B8A6', name: 'Teal' },
  { hex: '#A855F7', name: 'Violet' },
  { hex: '#F59E0B', name: 'Amber' },
  { hex: '#FFFFFF', name: 'White' },
  { hex: '#000000', name: 'Black' },
  { hex: '#78716C', name: 'Stone' },
  { hex: '#C4B5A0', name: 'Tan' },
] as const;

export default function ContentCreation() {
  const [contentSubTab, setContentSubTab] = useState<'captions' | 'post-creator' | 'quote-generator' | 'isolator' | 'review-graphics' | 'asset-creator' | 'remix' | 'video-creator' | 'ai-scheduler'>('captions');
  const [prompt, setPrompt] = useState('');
  const [aspectRatio, setAspectRatio] = useState<RatioId>('1:1');
  const [selectedStyle, setSelectedStyle] = useState<StyleId>('none');
  const [selectedColors, setSelectedColors] = useState<string[]>([]);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [canvasView, setCanvasView] = useState<'canvas' | 'preview'>('canvas');
  const [layers, setLayers] = useState<ContentLayer[]>([
    { id: 'bg', name: 'Background', type: 'background', visible: true },
  ]);

  const canvasRef = useRef<HTMLDivElement>(null);
  const ratio = ASPECT_RATIOS.find((r) => r.id === aspectRatio)!;
  const bgLayer = layers.find((l) => l.id === 'bg');
  const hasBackground = !!bgLayer?.data;

  // Flow Bucket drop support — accept dragged items as the canvas background
  const flowDrop = useFlowBucketDrop(async (item: FlowBucketItem) => {
    const data = await flowItemToBase64(item);
    setLayers((prev) =>
      prev.map((l) =>
        l.id === 'bg' ? { ...l, data: data.base64, mimeType: data.mimeType } : l
      )
    );
  });

  const toggleColor = (hex: string) => {
    setSelectedColors((prev) =>
      prev.includes(hex) ? prev.filter((c) => c !== hex) : [...prev, hex]
    );
  };

  const buildFullPrompt = useCallback(() => {
    const parts: string[] = [];
    const style = STYLE_PRESETS.find((s) => s.id === selectedStyle);
    if (style && style.prompt) parts.push(style.prompt);
    parts.push(prompt.trim());
    if (selectedColors.length > 0) {
      const colorNames = selectedColors
        .map((hex) => COLOR_PALETTE.find((c) => c.hex === hex)?.name)
        .filter(Boolean);
      parts.push(`using ${colorNames.join(', ')} colors`);
    }
    return parts.join(', ');
  }, [prompt, selectedStyle, selectedColors]);

  const generateBackground = useCallback(async () => {
    if (!prompt.trim() || generating) return;
    setGenerating(true);
    setError(null);

    const fullPrompt = buildFullPrompt();

    try {
      const res = await fetch('/api/content/generate-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: fullPrompt,
          aspectRatio,
          numberOfImages: 1,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || 'Generation failed');
      }

      const { images } = await res.json();
      if (!images?.length) throw new Error('No image returned');

      setLayers((prev) =>
        prev.map((l) =>
          l.id === 'bg'
            ? { ...l, data: images[0].base64, mimeType: images[0].mimeType }
            : l
        )
      );

      // Auto-save to Flow Bucket
      addToFlowBucket({
        name: prompt.trim().slice(0, 40) || 'Post Background',
        base64: images[0].base64,
        mimeType: images[0].mimeType,
      });
    } catch (e: any) {
      setError(e.message);
    } finally {
      setGenerating(false);
    }
  }, [prompt, aspectRatio, generating, buildFullPrompt]);

  const clearBackground = () => {
    setLayers((prev) =>
      prev.map((l) =>
        l.id === 'bg' ? { ...l, data: undefined, mimeType: undefined } : l
      )
    );
  };

  const toggleLayerVisibility = (id: string) => {
    setLayers((prev) =>
      prev.map((l) => (l.id === id ? { ...l, visible: !l.visible } : l))
    );
  };

  const downloadImage = () => {
    if (!bgLayer?.data) return;
    const link = document.createElement('a');
    link.href = `data:${bgLayer.mimeType || 'image/png'};base64,${bgLayer.data}`;
    link.download = `post-${aspectRatio.replace(':', 'x')}-${Date.now()}.png`;
    link.click();
  };

  const canvasMaxW = 560;
  const canvasH = Math.round(canvasMaxW * (ratio.h / ratio.w));

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="max-w-7xl mx-auto"
    >
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-6 gap-4">
        <div>
          <h2 className="text-3xl font-semibold text-white">Content Creation</h2>
          <p className="text-zinc-400 text-sm mt-1">
            AI-powered content tools for social media
          </p>
        </div>
        <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-[#12121A] border border-[#27273A] text-sm text-zinc-300">
          <Star size={16} className="text-purple-400" />
          Google AI
        </div>
      </div>

      {/* Sub-tabs */}
      <div className="flex items-center gap-1 mb-8 bg-[#12121A] border border-[#27273A] rounded-xl p-1 w-fit">
        {([['captions', 'Caption Generator'], ['post-creator', 'Post Creator'], ['quote-generator', 'Quote Generator'], ['isolator', 'BG Extractor'], ['review-graphics', 'Review Graphics'], ['asset-creator', 'Products/Food/Graphics'], ['remix', 'Remix'], ['video-creator', 'AI Video'], ['ai-scheduler', 'AI Scheduler']] as const).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setContentSubTab(id)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              contentSubTab === id
                ? 'bg-gradient-to-r from-purple-600 to-purple-500 text-white shadow-[0_0_10px_rgba(168,85,247,0.2)]'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {contentSubTab === 'captions' ? <CaptionGenerator /> : contentSubTab === 'ai-scheduler' ? <GhlSchedulePanel /> : contentSubTab === 'quote-generator' ? <QuoteGenerator /> : contentSubTab === 'isolator' ? <SubjectIsolator /> : contentSubTab === 'review-graphics' ? <ReviewGraphicGenerator /> : contentSubTab === 'asset-creator' ? <AssetCreator /> : contentSubTab === 'remix' ? <RemixCreator /> : contentSubTab === 'video-creator' ? <VideoCreator /> : (
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
        {/* Caption Widget */}
        <CaptionWidget
          brandContext={{ company: 'Your Brand' }}
          contentContext={prompt.trim() || undefined}
          defaultOpen
        />
        {/* ── Left: Canvas + Prompt ─────────────────────── */}
        <div className="space-y-6">
          {/* Canvas / Preview */}
          <div className="bg-[#12121A] border border-[#27273A] rounded-3xl p-6 shadow-lg">
            <div className="flex items-center justify-between mb-4">
              {/* View toggle */}
              <div className="flex items-center gap-1 bg-[#0A0A0F] rounded-lg p-0.5">
                {([['canvas', 'Canvas'], ['preview', 'Platform Preview']] as const).map(([id, label]) => (
                  <button
                    key={id}
                    onClick={() => setCanvasView(id)}
                    className={`px-3 py-1.5 rounded-md text-[11px] font-medium transition-all ${
                      canvasView === id
                        ? 'bg-purple-500/15 text-purple-300'
                        : 'text-zinc-500 hover:text-zinc-300'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2">
                {hasBackground && (
                  <>
                    <button
                      onClick={() => {
                        if (bgLayer?.data) {
                          addToFlowBucket({
                            name: prompt.trim().slice(0, 40) || 'Post Background',
                            base64: bgLayer.data,
                            mimeType: bgLayer.mimeType || 'image/png',
                          });
                        }
                      }}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-amber-500/30 text-amber-300 hover:bg-amber-500/10 transition-all"
                      title="Add to Flow Bucket"
                    >
                      <Package size={12} /> Flow
                    </button>
                    <button
                      onClick={downloadImage}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-zinc-300 hover:bg-[#181824] transition-colors"
                    >
                      <Download size={13} /> Export
                    </button>
                    <button
                      onClick={clearBackground}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-zinc-400 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                    >
                      <Trash2 size={13} /> Clear
                    </button>
                  </>
                )}
              </div>
            </div>

            {canvasView === 'canvas' ? (
              /* Raw Canvas */
              <div className="flex items-center justify-center">
                <div
                  ref={canvasRef}
                  onDragOver={flowDrop.handleDragOver}
                  onDragLeave={flowDrop.handleDragLeave}
                  onDrop={flowDrop.handleDrop}
                  className={`relative bg-[#0A0A0F] border-2 border-dashed rounded-2xl overflow-hidden transition-all duration-300 flex items-center justify-center ${
                    flowDrop.dragOver ? 'border-purple-500 bg-purple-500/5' : 'border-[#27273A]'
                  }`}
                  style={{
                    width: '100%',
                    maxWidth: canvasMaxW,
                    aspectRatio: `${ratio.w}/${ratio.h}`,
                  }}
                >
                  {bgLayer?.visible && bgLayer?.data ? (
                    <img
                      src={`data:${bgLayer.mimeType || 'image/png'};base64,${bgLayer.data}`}
                      alt="Generated background"
                      className="absolute inset-0 w-full h-full object-cover"
                    />
                  ) : (
                    <div className="flex flex-col items-center gap-3 text-zinc-600 p-8">
                      <Image size={40} strokeWidth={1} />
                      <p className="text-sm text-center">
                        {generating
                          ? 'Generating...'
                          : 'Describe a background below and hit Generate'}
                      </p>
                    </div>
                  )}

                  {generating && (
                    <div className="absolute inset-0 bg-[#0A0A0F]/80 flex flex-col items-center justify-center gap-3 z-10">
                      <Loader size={28} className="text-purple-400 animate-spin" />
                      <p className="text-sm text-zinc-400">Generating with Nano Banana 2...</p>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              /* Platform Preview */
              <SocialPostPreview
                accountName="Your Brand"
                defaultPlatform="instagram"
                image={hasBackground ? `data:${bgLayer?.mimeType || 'image/png'};base64,${bgLayer?.data}` : undefined}
              />
            )}
          </div>

          {/* Prompt Input */}
          <div className="bg-[#12121A] border border-[#27273A] rounded-3xl p-6 shadow-lg">
            <h3 className="text-sm font-medium text-zinc-400 uppercase tracking-wider mb-4">
              Background Prompt
            </h3>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Describe the background you want to generate... e.g. &quot;A vibrant sunset over a tropical beach with palm trees, golden hour lighting, photorealistic&quot;"
              rows={3}
              className="w-full bg-[#0A0A0F] border border-[#27273A] rounded-xl p-4 text-sm text-white placeholder-zinc-600 outline-none resize-none focus:border-purple-500/40 transition-colors"
            />
            {error && (
              <p className="text-xs text-red-400 mt-2">{error}</p>
            )}
            <div className="flex items-center justify-between mt-4">
              <p className="text-[11px] text-zinc-600">
                Max 480 tokens &middot; English only
              </p>
              <button
                onClick={generateBackground}
                disabled={generating || !prompt.trim()}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-purple-600 to-purple-500 text-sm text-white font-medium hover:from-purple-500 hover:to-purple-400 transition-all shadow-[0_0_15px_rgba(168,85,247,0.2)] disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {generating ? (
                  <>
                    <Loader size={14} className="animate-spin" /> Generating...
                  </>
                ) : hasBackground ? (
                  <>
                    <RefreshCw size={14} /> Regenerate
                  </>
                ) : (
                  <>
                    <Plus size={14} /> Generate Background
                  </>
                )}
              </button>
            </div>
          </div>
        </div>

        {/* ── Right: Sidebar Controls ───────────────────── */}
        <div className="space-y-6">
          {/* Aspect Ratio */}
          <div className="bg-[#12121A] border border-[#27273A] rounded-3xl p-6 shadow-lg">
            <h3 className="text-sm font-medium text-zinc-400 uppercase tracking-wider mb-4 flex items-center gap-2">
              Aspect Ratio
            </h3>
            <div className="grid grid-cols-3 gap-1.5">
              {ASPECT_RATIOS.map((r) => (
                <button
                  key={r.id}
                  onClick={() => setAspectRatio(r.id)}
                  className={`flex flex-col items-center gap-1.5 p-2.5 rounded-xl border transition-all ${
                    aspectRatio === r.id
                      ? 'bg-purple-500/10 border-purple-500/40 shadow-[0_0_10px_rgba(168,85,247,0.1)]'
                      : 'border-[#27273A] hover:border-zinc-600 bg-[#0A0A0F]'
                  }`}
                >
                  <div
                    className={`rounded border flex-shrink-0 ${
                      aspectRatio === r.id
                        ? 'border-purple-400 bg-purple-500/20'
                        : 'border-zinc-600 bg-zinc-800'
                    }`}
                    style={{
                      width: r.w >= r.h ? 20 : Math.round(20 * (r.w / r.h)),
                      height: r.h >= r.w ? 20 : Math.round(20 * (r.h / r.w)),
                    }}
                  />
                  <div className="text-center">
                    <p
                      className={`text-[11px] font-medium leading-tight ${
                        aspectRatio === r.id ? 'text-purple-300' : 'text-zinc-300'
                      }`}
                    >
                      {r.label}
                    </p>
                    <p className="text-[9px] text-zinc-500">{r.sub}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Style Presets */}
          <div className="bg-[#12121A] border border-[#27273A] rounded-3xl p-6 shadow-lg">
            <h3 className="text-sm font-medium text-zinc-400 uppercase tracking-wider mb-4">
              Style
            </h3>
            <div className="grid grid-cols-3 gap-1.5">
              {STYLE_PRESETS.map((style) => (
                <button
                  key={style.id}
                  onClick={() => setSelectedStyle(style.id)}
                  className={`px-2 py-2 rounded-lg border text-[11px] font-medium transition-all text-center ${
                    selectedStyle === style.id
                      ? 'bg-purple-500/15 border-purple-500/40 text-purple-300'
                      : 'border-[#27273A] bg-[#0A0A0F] text-zinc-400 hover:border-zinc-600 hover:text-zinc-300'
                  }`}
                >
                  {style.label}
                </button>
              ))}
            </div>
          </div>

          {/* Color Palette */}
          <div className="bg-[#12121A] border border-[#27273A] rounded-3xl p-6 shadow-lg">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-medium text-zinc-400 uppercase tracking-wider">
                Colors
              </h3>
              {selectedColors.length > 0 && (
                <button
                  onClick={() => setSelectedColors([])}
                  className="text-[10px] text-zinc-500 hover:text-zinc-300 transition-colors flex items-center gap-1"
                >
                  <X size={10} /> Clear
                </button>
              )}
            </div>
            <div className="grid grid-cols-8 gap-1.5">
              {COLOR_PALETTE.map((color) => {
                const isSelected = selectedColors.includes(color.hex);
                return (
                  <button
                    key={color.hex}
                    onClick={() => toggleColor(color.hex)}
                    title={color.name}
                    className={`w-full aspect-square rounded-lg border-2 transition-all relative flex items-center justify-center ${
                      isSelected
                        ? 'border-purple-400 scale-110 shadow-[0_0_8px_rgba(168,85,247,0.3)]'
                        : 'border-transparent hover:border-zinc-600 hover:scale-105'
                    }`}
                    style={{ backgroundColor: color.hex }}
                  >
                    {isSelected && (
                      <Check
                        size={12}
                        className={color.hex === '#000000' || color.hex === '#EF4444' || color.hex === '#3B82F6' || color.hex === '#8B5CF6' || color.hex === '#EC4899' || color.hex === '#F43F5E' || color.hex === '#A855F7'
                          ? 'text-white'
                          : 'text-zinc-900'}
                        strokeWidth={3}
                      />
                    )}
                  </button>
                );
              })}
            </div>
            {selectedColors.length > 0 && (
              <p className="text-[10px] text-zinc-500 mt-3">
                {selectedColors.map((hex) => COLOR_PALETTE.find((c) => c.hex === hex)?.name).join(', ')}
              </p>
            )}
          </div>

          {/* Layers Panel */}
          <div className="bg-[#12121A] border border-[#27273A] rounded-3xl p-6 shadow-lg">
            <h3 className="text-sm font-medium text-zinc-400 uppercase tracking-wider mb-4 flex items-center gap-2">
              <Layers size={14} className="text-purple-400" /> Layers
            </h3>
            <div className="space-y-2">
              {layers.map((layer) => (
                <div
                  key={layer.id}
                  className="flex items-center gap-3 p-3 rounded-xl bg-[#0A0A0F] border border-[#27273A] group"
                >
                  {/* Thumbnail */}
                  <div className="w-9 h-9 rounded-lg overflow-hidden bg-[#12121A] border border-[#27273A] flex items-center justify-center shrink-0">
                    {layer.data ? (
                      <img
                        src={`data:${layer.mimeType || 'image/png'};base64,${layer.data}`}
                        alt=""
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <Image size={14} className="text-zinc-600" />
                    )}
                  </div>

                  {/* Name */}
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-zinc-300 truncate">
                      {layer.name}
                    </p>
                    <p className="text-[10px] text-zinc-600">
                      {layer.data ? 'Generated' : 'Empty'}
                    </p>
                  </div>

                  {/* Visibility */}
                  <button
                    onClick={() => toggleLayerVisibility(layer.id)}
                    className="p-1.5 rounded-lg text-zinc-500 hover:text-zinc-300 hover:bg-[#181824] transition-colors"
                  >
                    {layer.visible ? <Eye size={14} /> : <EyeOff size={14} />}
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
      )}
    </motion.div>
  );
}
