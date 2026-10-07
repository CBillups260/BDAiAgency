import { fal } from "@fal-ai/client";

/**
 * Generic Fal.ai image adapter.
 *
 * Fronts the entire Fal image catalog behind one API/key and normalizes each
 * model's varied input schema into the same call our routes use. Every model
 * returns `{ base64, mimeType }[]` — identical to the Gemini/OpenAI branches —
 * so the frontend contract is unchanged.
 *
 * There is intentionally NO closed model registry: any `fal-ai/...` id the UI
 * sends is accepted and passed to `fal.subscribe`. The common text-to-image
 * schema (`prompt`, `image_size`, `num_images`, `sync_mode`) covers the vast
 * majority; the small set of divergent behaviours (aspect-ratio-only models,
 * reference/edit endpoints, per-family extras) is handled by the pattern-based
 * helpers below. Adding a model to the catalog needs no change here.
 *
 * Reference images are passed inline as base64 data URIs (Fal accepts them),
 * and outputs use `sync_mode: true` so they come back as data URIs in the same
 * request. Models that ignore `sync_mode` (returning a hosted URL) are handled
 * by a fetch fallback in `urlToImage`.
 */

type RefMode = "single" | "multi";

// OpenAI GPT Image 2.5 (Flare / Sunburst) hosted on Fal under the `openai/`
// owner namespace. Text-to-image and `/edit` siblings share one schema:
// `quality` (auto|low|medium|high|xhigh|max), `image_size` {width,height}
// with both edges multiples of 16, max edge 3840, aspect ≤ 3:1, and a total
// pixel budget of 655,360–8,294,400.
function isOpenAIGptImage(id: string): boolean {
  return id.startsWith("openai/gpt-image-");
}

const OPENAI_QUALITIES = ["auto", "low", "medium", "high", "xhigh", "max"] as const;
type OpenAIQuality = (typeof OPENAI_QUALITIES)[number];
function normalizeOpenAIQuality(q: unknown): OpenAIQuality {
  return (OPENAI_QUALITIES as readonly string[]).includes(q as string)
    ? (q as OpenAIQuality)
    : "high";
}

/**
 * A Fal model id is anything with a namespace slash. Our direct models
 * (`gemini-3-pro-image-preview`, `gpt-image-2`, …) have no slash, so this
 * cleanly separates the two routing paths.
 */
export function isFalModel(model: unknown): model is string {
  return typeof model === "string" && model.includes("/");
}

// Models whose output dimensions go through an `aspect_ratio` enum rather than
// an `image_size` {width,height} object. Sending `image_size` to one of these
// is silently ignored by Fal, so the model falls back to its own defaults —
// which is how the whole Nano Banana family ended up stuck at 1K.
// Verified against each endpoint's OpenAPI input schema.
const ASPECT_RATIO_FAMILIES = [
  "kontext",
  "v1.1-ultra",
  "nano-banana",
  "gemini-25-flash-image",
  "/krea/v2/",
  "ideogram/v3/generate-transparent",
  "ideogram/v2a",
  "luma-photon",
  "minimax",
  "mai-image",
  "bria/text-to-image",
  "fibo-lite",
  "grok-imagine-image",
];
function usesAspectRatio(id: string): boolean {
  return ASPECT_RATIO_FAMILIES.some((f) => id.includes(f));
}

// Of the aspect-ratio models, these also take a `resolution` enum — the only
// way to ask them for 2K/4K instead of their 1K default.
function usesResolutionEnum(id: string): boolean {
  // Careful: `nano-banana-2-lite` is NOT in this set, so match the version
  // segment exactly rather than by substring.
  return (
    id.includes("nano-banana-pro") ||
    /nano-banana-2(\.1)?(\/|$)/.test(id) ||
    id.includes("grok-imagine-image")
  );
}

// Nano Banana's enum differs from the FLUX-style one: it adds 5:4 / 4:5 and
// the extreme 4:1 … 1:8 ratios, and has no 9:21.
const NANO_BANANA_ASPECT_ENUM = [
  "21:9", "16:9", "3:2", "4:3", "5:4", "1:1", "4:5", "3:4", "2:3", "9:16",
];
function aspectEnumFor(id: string): string[] {
  return id.includes("nano-banana") ? NANO_BANANA_ASPECT_ENUM : ASPECT_ENUM;
}

// Reference/edit routing. Returns the endpoint to hit (and how many refs it
// takes) when the caller supplies reference images, or null if the model is
// text-to-image only.
function resolveEditEndpoint(
  id: string,
): { endpoint: string; refMode: RefMode; maxRefs?: number } | null {
  // OpenAI GPT Image 2.5 / 2 on Fal — `/edit` sibling, up to 16 refs:
  //   openai/gpt-image-2.5/flare/text-to-image → openai/gpt-image-2.5/flare/edit
  //   openai/gpt-image-2                       → openai/gpt-image-2/edit
  if (isOpenAIGptImage(id)) {
    const endpoint = id.endsWith("/edit")
      ? id
      : id.endsWith("/text-to-image")
        ? id.replace(/\/text-to-image$/, "/edit")
        : `${id}/edit`;
    return { endpoint, refMode: "multi", maxRefs: 16 };
  }
  // Seedream — every tier/version has a dedicated `/edit` sibling (up to 10
  // refs). Match on `/seedream/…/text-to-image` regardless of how many path
  // segments the version has, so v4, v4.5, v5/pro and v5/lite all resolve:
  //   .../seedream/v5/pro/text-to-image  → .../seedream/v5/pro/edit
  if (/\/seedream\/.+\/text-to-image$/.test(id)) {
    return { endpoint: id.replace(/\/text-to-image$/, "/edit"), refMode: "multi" };
  }
  // FLUX Kontext IS the edit endpoint (single reference).
  if (id.includes("/kontext")) return { endpoint: id, refMode: "single" };
  // FLUX 2 family accepts an optional reference `image_url` on the base endpoint.
  if (id.includes("flux-2")) return { endpoint: id, refMode: "single" };
  // Nano Banana / Gemini image (Google) edit via an `/edit` sibling, multi-ref.
  if (id.includes("nano-banana") || id.includes("gemini-25-flash-image")) {
    return { endpoint: id.endsWith("/edit") ? id : `${id}/edit`, refMode: "multi" };
  }
  return null;
}

// Some models are edit-only (Kontext can't do pure text-to-image). Fall back to
// an in-family text-to-image endpoint when no references are supplied.
function noRefEndpoint(id: string): string {
  if (id.includes("/kontext")) return "fal-ai/flux/dev";
  return id;
}

// Per-family static input extras.
function familyExtras(id: string, quality?: unknown): Record<string, unknown> {
  if (isOpenAIGptImage(id)) {
    return { quality: normalizeOpenAIQuality(quality), output_format: "png" };
  }
  if (id.includes("ideogram")) return { rendering_speed: "BALANCED" };
  if (id.includes("qwen-image")) return { acceleration: "regular" };
  return {};
}

// Per-family size clamp bounds (px).
function sizeBounds(id: string): { minEdge: number; maxEdge: number } {
  if (isOpenAIGptImage(id)) return { minEdge: 512, maxEdge: 3840 };
  const min = id.includes("seedream") ? 1024 : 512;
  const hiRes =
    id.includes("seedream") ||
    id.includes("nano-banana") ||
    id.includes("gemini-25-flash-image") ||
    id.includes("v1.1-ultra") ||
    id.includes("flux-2") ||
    id.includes("bria") ||
    id.includes("hunyuan");
  return { minEdge: min, maxEdge: hiRes ? 4096 : 2048 };
}

// Per-family total-pixel budget. Only OpenAI GPT Image enforces one today:
// 3840×3840 (14.7MP) would be rejected, so 4K square scales to ~2880².
function pixelBounds(id: string): { minPixels: number; maxPixels: number } {
  if (isOpenAIGptImage(id)) return { minPixels: 655_360, maxPixels: 8_294_400 };
  return { minPixels: 0, maxPixels: Infinity };
}

// Aspect ratios accepted by FLUX Kontext / ultra `aspect_ratio` enums.
const ASPECT_ENUM = ["21:9", "16:9", "4:3", "3:2", "1:1", "2:3", "3:4", "9:16", "9:21"];

const RES_TARGET: Record<string, number> = {
  "512": 768,
  "1K": 1024,
  "2K": 2048,
  "4K": 4096,
};

function edgesFor(
  aspectRatio: string,
  resolution: string,
  minEdge: number,
  maxEdge: number,
): { width: number; height: number } {
  const [wR, hR] = aspectRatio.split(":").map(Number);
  const target = Math.min(maxEdge, RES_TARGET[resolution] ?? 2048);
  let width: number;
  let height: number;
  if (!wR || !hR || wR === hR) {
    width = target;
    height = target;
  } else if (wR > hR) {
    width = target;
    height = target * (hR / wR);
  } else {
    height = target;
    width = target * (wR / hR);
  }
  const clamp = (n: number) => Math.min(maxEdge, Math.max(minEdge, Math.round(n / 16) * 16));
  return { width: clamp(width), height: clamp(height) };
}

// Scale a {width,height} pair into a total-pixel window, keeping the aspect
// ratio and 16px alignment. Round up when growing, down when shrinking, so the
// result never lands back outside the window.
function fitPixelBudget(
  size: { width: number; height: number },
  minPixels: number,
  maxPixels: number,
  maxEdge: number,
): { width: number; height: number } {
  const area = size.width * size.height;
  if (area >= minPixels && area <= maxPixels) return size;
  const grow = area < minPixels;
  const s = Math.sqrt((grow ? minPixels : maxPixels) / area);
  const snap = (n: number) =>
    Math.min(maxEdge, (grow ? Math.ceil(n / 16) : Math.floor(n / 16)) * 16);
  return { width: snap(size.width * s), height: snap(size.height * s) };
}

function nearestAspectRatio(aspectRatio: string, enumValues: string[] = ASPECT_ENUM): string {
  const val = (s: string) => {
    const [w, h] = s.split(":").map(Number);
    return w && h ? w / h : 1;
  };
  const target = val(aspectRatio);
  let best = enumValues[0];
  let bestDelta = Infinity;
  for (const a of enumValues) {
    const d = Math.abs(val(a) - target);
    if (d < bestDelta) {
      bestDelta = d;
      best = a;
    }
  }
  return best;
}

function applySize(
  input: Record<string, unknown>,
  endpoint: string,
  aspectRatio: string,
  resolution: string,
): void {
  if (usesAspectRatio(endpoint)) {
    input.aspect_ratio = nearestAspectRatio(aspectRatio, aspectEnumFor(endpoint));
    if (usesResolutionEnum(endpoint)) {
      // `resolution` is the only 2K/4K lever these models expose, and it is
      // what drives their token cost — pass the user's choice straight through.
      input.resolution = ["1K", "2K", "4K"].includes(resolution) ? resolution : "1K";
    }
  } else {
    const { minEdge, maxEdge } = sizeBounds(endpoint);
    const { minPixels, maxPixels } = pixelBounds(endpoint);
    input.image_size = fitPixelBudget(
      edgesFor(aspectRatio, resolution, minEdge, maxEdge),
      minPixels,
      maxPixels,
      maxEdge,
    );
  }
}

let configured = false;
function ensureConfigured(): void {
  if (configured) return;
  const key = process.env.FAL_KEY;
  if (!key) throw new Error("FAL_KEY is not configured on the server.");
  fal.config({ credentials: key });
  configured = true;
}

async function urlToImage(
  url: unknown,
): Promise<{ base64: string; mimeType: string } | null> {
  if (typeof url !== "string" || !url) return null;
  if (url.startsWith("data:")) {
    const m = /^data:([^;]+);base64,(.*)$/s.exec(url);
    if (!m) return null;
    return { mimeType: m[1] || "image/png", base64: m[2] };
  }
  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`Failed to fetch generated image from Fal (${resp.status}).`);
  }
  const mimeType = resp.headers.get("content-type") || "image/png";
  const buf = Buffer.from(await resp.arrayBuffer());
  return { base64: buf.toString("base64"), mimeType };
}

export interface FalImageOptions {
  model: string;
  prompt: string;
  aspectRatio: string;
  resolution: string;
  references?: { base64: string; mimeType: string }[];
  /** OpenAI GPT Image quality tier (auto|low|medium|high|xhigh|max). Ignored by other families. */
  quality?: string;
}

/**
 * Generate one image via Fal, returning it in the same `{ base64, mimeType }`
 * shape the Gemini/OpenAI branches produce. Throws a user-facing Error on
 * misuse (references sent to a text-to-image-only model) or Fal failure.
 */
export async function generateFalImage(
  opts: FalImageOptions,
): Promise<{ base64: string; mimeType: string }[]> {
  ensureConfigured();

  const references = opts.references ?? [];
  const hasRefs = references.length > 0;

  const input: Record<string, unknown> = {
    prompt: opts.prompt,
    num_images: 1,
    sync_mode: true,
    ...familyExtras(opts.model, opts.quality),
  };

  let endpoint: string;
  if (hasRefs) {
    const edit = resolveEditEndpoint(opts.model);
    if (!edit) {
      throw new Error(
        `${opts.model} is a text-to-image model and can't use reference images. ` +
          `Remove the reference image(s) or pick a reference-capable model ` +
          `(GPT Image 2.5, Seedream, FLUX Kontext, Nano Banana, or a Gemini model).`,
      );
    }
    endpoint = edit.endpoint;
    const dataUris = references.map((r) => `data:${r.mimeType};base64,${r.base64}`);
    if (edit.refMode === "single") {
      input.image_url = dataUris[0];
    } else {
      input.image_urls = dataUris.slice(0, edit.maxRefs ?? 10);
      // `max_images` is a Nano Banana / Seedream knob; OpenAI's schema
      // doesn't declare it, so keep it off that family.
      if (!isOpenAIGptImage(endpoint)) input.max_images = 1;
    }
  } else {
    endpoint = noRefEndpoint(opts.model);
  }

  applySize(input, endpoint, opts.aspectRatio, opts.resolution);

  let data: unknown;
  try {
    ({ data } = await fal.subscribe(endpoint, { input }));
  } catch (err) {
    const status = (err as { status?: number })?.status;
    const msg = String((err as { message?: string })?.message ?? "");
    if (status === 404 || /not found/i.test(msg)) {
      throw new Error(
        `This model isn't available on Fal right now (${endpoint}). Please pick a different model.`,
      );
    }
    throw err;
  }
  const outImages = ((data as { images?: { url?: string }[] })?.images) ?? [];

  const results: { base64: string; mimeType: string }[] = [];
  for (const img of outImages) {
    const parsed = await urlToImage(img?.url);
    if (parsed) results.push(parsed);
  }
  if (results.length === 0) {
    throw new Error("Fal returned no image. Try a different prompt or model.");
  }
  return results;
}
