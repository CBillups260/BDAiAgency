/**
 * Image-model catalog powering the ModelPicker (Freepik-style browser).
 *
 * This is the single source of truth for what the UI shows. Each model's `id`
 * is the exact string sent to the backend:
 *   - `direct: true`  → routed to our own Gemini/OpenAI SDK branches.
 *   - otherwise        → passed straight to Fal via `fal.subscribe(id, …)`.
 *
 * Adding a model is one entry here. The backend accepts any Fal id generically,
 * so new/newest models work without backend changes. If Fal renames a slug,
 * fix the `id` here (one line) — everything else is display metadata.
 */

export type RefMode = 'none' | 'single' | 'multi';
export type Resolution = '1K' | '2K' | '4K';

/** Tag vocabulary for the "Best for" filter. Keep labels short + human. */
export const BEST_FOR_TAGS = {
  photoreal: 'Photorealism',
  design: 'Graphic design',
  typography: 'Text & typography',
  logos: 'Logos & branding',
  vector: 'Vector / SVG',
  artistic: 'Artistic / stylized',
  anime: 'Anime / illustration',
  editing: 'Editing & compositing',
  fast: 'Fast drafts',
  budget: 'Low cost',
} as const;
export type BestForTag = keyof typeof BEST_FOR_TAGS;

/** Feature filters (the "Features" dropdown). */
export const FEATURE_TAGS = {
  refs: 'Reference images',
  hires: 'High-res (4K)',
  transparent: 'Transparent background',
  vector: 'Vector output',
  new: 'New',
} as const;
export type FeatureTag = keyof typeof FEATURE_TAGS;

export interface CatalogModel {
  id: string;
  name: string;
  provider: string; // Provider.key
  refs: RefMode;
  maxRes: Resolution;
  bestFor: BestForTag[];
  /** Extra feature flags surfaced as chips / used by the Features filter. */
  features?: FeatureTag[];
  isNew?: boolean;
  featured?: boolean;
  /** Direct = our own Gemini/OpenAI integration (not Fal). */
  direct?: boolean;
  /** Rough relative cost hint shown as dots (1 cheap … 4 premium). */
  tier?: 1 | 2 | 3 | 4;
}

export interface Provider {
  key: string;
  name: string;
  /** Emoji/glyph avatar (self-contained, no external logos). */
  icon: string;
  /** Accent color for the avatar chip. */
  color: string;
}

export const PROVIDERS: Provider[] = [
  { key: 'google', name: 'Google', icon: 'G', color: '#4285F4' },
  { key: 'openai', name: 'OpenAI', icon: '◍', color: '#10A37F' },
  { key: 'bfl', name: 'Black Forest Labs', icon: '❖', color: '#8B5CF6' },
  { key: 'bytedance', name: 'Seedream', icon: '❁', color: '#EC4899' },
  { key: 'ideogram', name: 'Ideogram', icon: 'I', color: '#F59E0B' },
  { key: 'recraft', name: 'Recraft', icon: 'R', color: '#EF4444' },
  { key: 'krea', name: 'Krea', icon: 'K', color: '#06B6D4' },
  { key: 'qwen', name: 'Qwen', icon: 'Q', color: '#6366F1' },
  { key: 'zimage', name: 'Z-Image', icon: 'Z', color: '#14B8A6' },
  { key: 'wan', name: 'Wan', icon: 'W', color: '#A855F7' },
  { key: 'stability', name: 'Stability', icon: '◈', color: '#7C3AED' },
  { key: 'hidream', name: 'HiDream', icon: 'H', color: '#F97316' },
  { key: 'bria', name: 'Bria', icon: 'B', color: '#0EA5E9' },
  { key: 'luma', name: 'Luma', icon: '☾', color: '#22D3EE' },
  { key: 'xai', name: 'xAI (Grok)', icon: '✕', color: '#64748B' },
  { key: 'hunyuan', name: 'Hunyuan', icon: '混', color: '#3B82F6' },
  { key: 'other', name: 'More models', icon: '✦', color: '#94A3B8' },
];

export const PROVIDER_MAP: Record<string, Provider> = Object.fromEntries(
  PROVIDERS.map((p) => [p.key, p]),
);

/**
 * The catalog. Reference-capable models are grouped near the top of each
 * provider block; the rest are text-to-image.
 *
 * IMPORTANT — `id` is the EXACT Fal endpoint slug. Older fal-hosted models use
 * the `fal-ai/…` owner prefix, but NEWER VENDOR MODELS use their own owner
 * namespace with NO prefix: `bytedance/…`, `ideogram/v4`, `xai/…`, `google/…`,
 * `microsoft/…`, `wan/…`, `bria/…`. Always verify a new id against Fal's
 * registry before adding — `https://fal.ai/api/models?keywords=<name>` returns
 * the canonical `id`. `direct` entries are our own Gemini/OpenAI models.
 */
export const MODELS: CatalogModel[] = [
  // ─────────────── Google (direct Gemini + Fal Nano Banana) ───────────────
  { id: 'gemini-3-pro-image-preview', name: 'Gemini 3 Pro', provider: 'google', refs: 'multi', maxRes: '4K', bestFor: ['photoreal', 'editing'], features: ['refs', 'hires'], featured: true, direct: true, tier: 3 },
  { id: 'gemini-3.1-flash-image-preview', name: 'Gemini 3.1 Flash', provider: 'google', refs: 'multi', maxRes: '4K', bestFor: ['photoreal', 'fast', 'editing'], features: ['refs', 'hires'], direct: true, tier: 2 },
  { id: 'fal-ai/nano-banana-pro', name: 'Nano Banana Pro', provider: 'google', refs: 'multi', maxRes: '4K', bestFor: ['photoreal', 'editing'], features: ['refs', 'hires'], isNew: true, featured: true, tier: 3 },
  { id: 'fal-ai/nano-banana-2', name: 'Nano Banana 2', provider: 'google', refs: 'multi', maxRes: '4K', bestFor: ['photoreal', 'editing'], features: ['refs', 'hires'], isNew: true, tier: 3 },
  { id: 'google/nano-banana-2-lite', name: 'Nano Banana 2 Lite', provider: 'google', refs: 'multi', maxRes: '2K', bestFor: ['fast', 'editing'], features: ['refs'], isNew: true, tier: 2 },
  { id: 'fal-ai/nano-banana', name: 'Nano Banana', provider: 'google', refs: 'multi', maxRes: '2K', bestFor: ['editing', 'photoreal'], features: ['refs'], tier: 2 },
  { id: 'fal-ai/gemini-25-flash-image', name: 'Gemini 2.5 Flash Image', provider: 'google', refs: 'multi', maxRes: '2K', bestFor: ['fast', 'editing'], features: ['refs'], tier: 2 },

  // ─────────────── OpenAI ───────────────
  // GPT Image 2.5 (Sept 2026) ships as two Fal-hosted variants. Flare = default
  // (higher quality than GPT Image 2 at ~50% lower latency); Sunburst = premium,
  // tighter control across multi-turn edits. Both take up to 16 refs via `/edit`.
  { id: 'openai/gpt-image-2.5/flare/text-to-image', name: 'GPT Image 2.5 Flare', provider: 'openai', refs: 'multi', maxRes: '4K', bestFor: ['photoreal', 'editing', 'typography'], features: ['refs', 'hires'], isNew: true, featured: true, tier: 3 },
  { id: 'openai/gpt-image-2.5/sunburst/text-to-image', name: 'GPT Image 2.5 Sunburst', provider: 'openai', refs: 'multi', maxRes: '4K', bestFor: ['photoreal', 'editing', 'typography'], features: ['refs', 'hires'], isNew: true, featured: true, tier: 4 },
  { id: 'gpt-image-2', name: 'GPT Image 2', provider: 'openai', refs: 'single', maxRes: '4K', bestFor: ['photoreal', 'editing'], features: ['refs', 'hires'], featured: true, direct: true, tier: 3 },
  { id: 'fal-ai/gpt-image-1/text-to-image', name: 'GPT Image 1', provider: 'openai', refs: 'none', maxRes: '2K', bestFor: ['photoreal'], tier: 3 },
  { id: 'fal-ai/gpt-image-1-mini', name: 'GPT Image 1 Mini', provider: 'openai', refs: 'none', maxRes: '2K', bestFor: ['fast', 'budget'], tier: 2 },

  // ─────────────── Black Forest Labs (FLUX) ───────────────
  { id: 'fal-ai/flux-pro/kontext', name: 'FLUX Kontext Pro', provider: 'bfl', refs: 'single', maxRes: '2K', bestFor: ['editing', 'photoreal'], features: ['refs'], featured: true, tier: 3 },
  { id: 'fal-ai/flux-2-pro', name: 'FLUX 2 Pro', provider: 'bfl', refs: 'single', maxRes: '4K', bestFor: ['photoreal', 'design'], features: ['refs', 'hires'], isNew: true, featured: true, tier: 3 },
  { id: 'fal-ai/flux-2', name: 'FLUX 2', provider: 'bfl', refs: 'single', maxRes: '2K', bestFor: ['photoreal', 'design'], features: ['refs'], isNew: true, tier: 2 },
  { id: 'fal-ai/flux-pro/v1.1-ultra', name: 'FLUX 1.1 Pro Ultra', provider: 'bfl', refs: 'none', maxRes: '4K', bestFor: ['photoreal'], features: ['hires'], tier: 3 },
  { id: 'fal-ai/flux-pro/v1.1', name: 'FLUX 1.1 Pro', provider: 'bfl', refs: 'none', maxRes: '2K', bestFor: ['photoreal'], tier: 3 },
  { id: 'fal-ai/flux/dev', name: 'FLUX.1 dev', provider: 'bfl', refs: 'none', maxRes: '2K', bestFor: ['artistic', 'design'], tier: 2 },
  { id: 'fal-ai/flux/schnell', name: 'FLUX.1 schnell', provider: 'bfl', refs: 'none', maxRes: '2K', bestFor: ['fast', 'budget'], tier: 1 },
  { id: 'fal-ai/flux/krea', name: 'FLUX Krea', provider: 'bfl', refs: 'none', maxRes: '2K', bestFor: ['photoreal', 'artistic'], tier: 2 },

  // ─────────────── ByteDance / Seedream ───────────────
  { id: 'bytedance/seedream/v5/pro/text-to-image', name: 'Seedream 5 Pro', provider: 'bytedance', refs: 'multi', maxRes: '4K', bestFor: ['photoreal', 'editing'], features: ['refs', 'hires'], isNew: true, featured: true, tier: 3 },
  { id: 'fal-ai/bytedance/seedream/v5/lite/text-to-image', name: 'Seedream 5 Lite', provider: 'bytedance', refs: 'multi', maxRes: '4K', bestFor: ['fast', 'editing'], features: ['refs', 'hires'], isNew: true, tier: 2 },
  { id: 'fal-ai/bytedance/seedream/v4.5/text-to-image', name: 'Seedream 4.5', provider: 'bytedance', refs: 'multi', maxRes: '4K', bestFor: ['photoreal', 'editing'], features: ['refs', 'hires'], isNew: true, tier: 2 },
  { id: 'fal-ai/bytedance/seedream/v4/text-to-image', name: 'Seedream 4.0', provider: 'bytedance', refs: 'multi', maxRes: '4K', bestFor: ['photoreal', 'editing'], features: ['refs', 'hires'], tier: 2 },
  { id: 'fal-ai/bytedance/dreamina/v3.1/text-to-image', name: 'Dreamina 3.1', provider: 'bytedance', refs: 'none', maxRes: '2K', bestFor: ['artistic', 'design'], tier: 2 },

  // ─────────────── Ideogram ───────────────
  { id: 'ideogram/v4', name: 'Ideogram v4', provider: 'ideogram', refs: 'none', maxRes: '2K', bestFor: ['typography', 'design', 'logos'], isNew: true, featured: true, tier: 3 },
  { id: 'fal-ai/ideogram/v3', name: 'Ideogram v3', provider: 'ideogram', refs: 'none', maxRes: '2K', bestFor: ['typography', 'design'], tier: 2 },
  { id: 'fal-ai/ideogram/v3/generate-transparent', name: 'Ideogram v3 Transparent', provider: 'ideogram', refs: 'none', maxRes: '2K', bestFor: ['logos', 'design'], features: ['transparent'], tier: 2 },
  { id: 'fal-ai/ideogram/v2a/turbo', name: 'Ideogram v2a Turbo', provider: 'ideogram', refs: 'none', maxRes: '2K', bestFor: ['typography', 'fast'], tier: 1 },

  // ─────────────── Recraft ───────────────
  { id: 'fal-ai/recraft/v4.1/text-to-image', name: 'Recraft v4.1', provider: 'recraft', refs: 'none', maxRes: '2K', bestFor: ['logos', 'design', 'typography'], isNew: true, featured: true, tier: 3 },
  { id: 'fal-ai/recraft/v4.1/pro/text-to-image', name: 'Recraft v4.1 Pro', provider: 'recraft', refs: 'none', maxRes: '2K', bestFor: ['logos', 'design'], isNew: true, tier: 3 },
  { id: 'fal-ai/recraft/v4/text-to-image', name: 'Recraft v4', provider: 'recraft', refs: 'none', maxRes: '2K', bestFor: ['logos', 'design'], isNew: true, tier: 3 },
  { id: 'fal-ai/recraft/v3/text-to-image', name: 'Recraft v3', provider: 'recraft', refs: 'none', maxRes: '2K', bestFor: ['logos', 'design'], tier: 2 },
  { id: 'fal-ai/recraft/v4.1/text-to-vector', name: 'Recraft v4.1 Vector', provider: 'recraft', refs: 'none', maxRes: '2K', bestFor: ['vector', 'logos'], features: ['vector'], isNew: true, tier: 3 },

  // ─────────────── Krea ───────────────
  { id: 'fal-ai/krea-2/turbo', name: 'Krea 2 Turbo', provider: 'krea', refs: 'none', maxRes: '2K', bestFor: ['artistic', 'fast'], isNew: true, tier: 2 },
  { id: 'fal-ai/krea/v2/large/text-to-image', name: 'Krea 2 Large', provider: 'krea', refs: 'none', maxRes: '2K', bestFor: ['artistic', 'photoreal'], isNew: true, tier: 3 },
  { id: 'fal-ai/krea/v2/medium/text-to-image', name: 'Krea 2 Medium', provider: 'krea', refs: 'none', maxRes: '2K', bestFor: ['artistic'], isNew: true, tier: 2 },

  // ─────────────── Qwen ───────────────
  { id: 'fal-ai/qwen-image-2/pro/text-to-image', name: 'Qwen Image 2 Pro', provider: 'qwen', refs: 'none', maxRes: '2K', bestFor: ['photoreal', 'design'], isNew: true, tier: 2 },
  { id: 'fal-ai/qwen-image-2/text-to-image', name: 'Qwen Image 2', provider: 'qwen', refs: 'none', maxRes: '2K', bestFor: ['design', 'budget'], isNew: true, tier: 1 },
  { id: 'fal-ai/qwen-image', name: 'Qwen Image', provider: 'qwen', refs: 'none', maxRes: '2K', bestFor: ['budget', 'design'], tier: 1 },

  // ─────────────── Z-Image ───────────────
  { id: 'fal-ai/z-image/turbo', name: 'Z-Image Turbo', provider: 'zimage', refs: 'none', maxRes: '2K', bestFor: ['fast', 'budget', 'photoreal'], isNew: true, tier: 1 },
  { id: 'fal-ai/z-image/base', name: 'Z-Image Base', provider: 'zimage', refs: 'none', maxRes: '2K', bestFor: ['photoreal', 'budget'], isNew: true, tier: 1 },

  // ─────────────── Wan ───────────────
  { id: 'fal-ai/wan/v2.7/text-to-image', name: 'Wan 2.7', provider: 'wan', refs: 'none', maxRes: '2K', bestFor: ['photoreal', 'artistic'], isNew: true, tier: 2 },
  { id: 'wan/v2.6/text-to-image', name: 'Wan 2.6', provider: 'wan', refs: 'none', maxRes: '2K', bestFor: ['photoreal'], isNew: true, tier: 2 },
  { id: 'fal-ai/wan/v2.2-a14b/text-to-image', name: 'Wan 2.2 A14B', provider: 'wan', refs: 'none', maxRes: '2K', bestFor: ['artistic', 'budget'], tier: 1 },

  // ─────────────── Stability ───────────────
  { id: 'fal-ai/stable-diffusion-v35-large', name: 'Stable Diffusion 3.5 Large', provider: 'stability', refs: 'none', maxRes: '2K', bestFor: ['artistic', 'design'], tier: 2 },
  { id: 'fal-ai/fast-sdxl', name: 'Fast SDXL', provider: 'stability', refs: 'none', maxRes: '2K', bestFor: ['fast', 'budget'], tier: 1 },

  // ─────────────── HiDream ───────────────
  { id: 'fal-ai/hidream-i1-full', name: 'HiDream I1 Full', provider: 'hidream', refs: 'none', maxRes: '2K', bestFor: ['photoreal', 'artistic'], tier: 2 },
  { id: 'fal-ai/hidream-i1-fast', name: 'HiDream I1 Fast', provider: 'hidream', refs: 'none', maxRes: '2K', bestFor: ['fast'], tier: 1 },

  // ─────────────── Bria (commercial-safe) ───────────────
  { id: 'fal-ai/bria/text-to-image/hd', name: 'Bria HD', provider: 'bria', refs: 'none', maxRes: '4K', bestFor: ['design', 'photoreal'], features: ['hires'], tier: 2 },
  { id: 'bria/fibo-lite/generate', name: 'Bria FIBO Lite', provider: 'bria', refs: 'none', maxRes: '2K', bestFor: ['design'], isNew: true, tier: 2 },

  // ─────────────── Luma ───────────────
  { id: 'fal-ai/luma-photon', name: 'Luma Photon', provider: 'luma', refs: 'none', maxRes: '2K', bestFor: ['photoreal', 'artistic'], tier: 2 },
  { id: 'fal-ai/luma-photon/flash', name: 'Luma Photon Flash', provider: 'luma', refs: 'none', maxRes: '2K', bestFor: ['fast', 'budget'], tier: 1 },

  // ─────────────── xAI (Grok) ───────────────
  { id: 'xai/grok-imagine-image', name: 'Grok Imagine', provider: 'xai', refs: 'none', maxRes: '2K', bestFor: ['artistic', 'photoreal'], isNew: true, tier: 2 },

  // ─────────────── Hunyuan ───────────────
  { id: 'fal-ai/hunyuan-image/v3/text-to-image', name: 'Hunyuan Image v3', provider: 'hunyuan', refs: 'none', maxRes: '2K', bestFor: ['photoreal', 'artistic'], isNew: true, tier: 2 },

  // ─────────────── More ───────────────
  { id: 'fal-ai/sana', name: 'Sana', provider: 'other', refs: 'none', maxRes: '2K', bestFor: ['fast', 'budget'], tier: 1 },
  { id: 'fal-ai/minimax/image-01', name: 'MiniMax Image 01', provider: 'other', refs: 'none', maxRes: '2K', bestFor: ['artistic'], tier: 2 },
  { id: 'fal-ai/kolors', name: 'Kolors', provider: 'other', refs: 'none', maxRes: '2K', bestFor: ['artistic', 'anime'], tier: 1 },
  { id: 'fal-ai/playground-v25', name: 'Playground v2.5', provider: 'other', refs: 'none', maxRes: '2K', bestFor: ['artistic'], tier: 1 },
  { id: 'fal-ai/aura-flow', name: 'AuraFlow', provider: 'other', refs: 'none', maxRes: '2K', bestFor: ['artistic'], tier: 1 },
  { id: 'microsoft/mai-image-2.5', name: 'Microsoft MAI 2.5', provider: 'other', refs: 'none', maxRes: '2K', bestFor: ['photoreal', 'design'], isNew: true, tier: 2 },
];

// ── Lookups & helpers ────────────────────────────────────────────────────
export const MODEL_MAP: Record<string, CatalogModel> = Object.fromEntries(
  MODELS.map((m) => [m.id, m]),
);

export function getModel(id: string): CatalogModel | undefined {
  return MODEL_MAP[id];
}

export function modelName(id: string): string {
  return MODEL_MAP[id]?.name ?? id;
}

export const DEFAULT_MODEL_ID = 'gemini-3-pro-image-preview';

// ── OpenAI quality ladder ────────────────────────────────────────────────
export interface QualityOption { id: string; label: string; sub: string }

/** Quality tiers exposed for OpenAI image models. `xhigh` / `max` only exist on GPT Image 2.5. */
export const OPENAI_QUALITY_OPTIONS: QualityOption[] = [
  { id: 'low', label: 'Low', sub: 'Fast, cheap' },
  { id: 'medium', label: 'Medium', sub: 'Balanced' },
  { id: 'high', label: 'High', sub: 'Best detail' },
  { id: 'xhigh', label: 'X-High', sub: '2.5 only · more detail' },
  { id: 'max', label: 'Max', sub: '2.5 only · slowest, priciest' },
];

/** Fal-hosted GPT Image 2.5 (Flare / Sunburst). */
export function isGptImage25(id: string): boolean {
  return id.startsWith('openai/gpt-image-2.5/');
}

/** Models that accept the OpenAI `quality` parameter (direct gpt-image-2 + Fal GPT Image 2.5). */
export function supportsQuality(id: string): boolean {
  return id === 'gpt-image-2' || isGptImage25(id);
}

/** The quality tiers valid for a given model. */
export function qualityOptions(id: string): QualityOption[] {
  if (isGptImage25(id)) return OPENAI_QUALITY_OPTIONS;
  if (id === 'gpt-image-2') return OPENAI_QUALITY_OPTIONS.filter((q) => q.id !== 'xhigh' && q.id !== 'max');
  return [];
}

/** Providers that actually have models, in catalog order, for the grouped list. */
export function providersWithModels(): Provider[] {
  const present = new Set(MODELS.map((m) => m.provider));
  return PROVIDERS.filter((p) => present.has(p.key));
}

export function modelsByProvider(providerKey: string): CatalogModel[] {
  return MODELS.filter((m) => m.provider === providerKey);
}
