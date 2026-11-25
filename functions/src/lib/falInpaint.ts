import { fal } from "@fal-ai/client";
import sharp from "sharp";

/**
 * Masked editing ("In Paint") on Fal.
 *
 * Three kinds of model sit behind one call:
 *
 *   native     — the endpoint takes a real mask (GPT Image edit, FLUX Fill,
 *                Ideogram v3 Edit, Qwen/Kontext inpaint, Bria GenFill).
 *                Z-Image Turbo inpaint exists too but is left out: in testing it
 *                ignored the surrounding scene and pasted a flat patch.
 *   erase      — mask-only object removal; no prompt (Fal object-removal,
 *                Bria Eraser).
 *   composite  — instruction editors with NO mask input (Nano Banana, Seedream).
 *                We show the model the region as a red highlight in a second
 *                reference image, then paste its output back through the mask,
 *                so the edit can't leak outside the brushed area.
 *
 * Every result is pasted back over the original through a feathered copy of the
 * mask unless the caller turns that off. Even the mask-native models re-render
 * the whole frame (GPT Image especially drifts colour and fine detail outside
 * the mask), so this is what makes "only change what I painted" literally true.
 *
 * Mask convention everywhere: white = change, black = keep.
 */

export type InpaintKind = "native" | "erase" | "composite";

interface InpaintModel {
  key: string;
  endpoint: string;
  kind: InpaintKind;
  /** Accepts extra reference images ("put THIS in the masked area"). */
  refs: "none" | "optional" | "required";
  /** Has a denoise `strength` knob. */
  strength?: boolean;
  /** Edge cap for the image we send. */
  maxEdge: number;
  /** OpenAI's total-pixel window; edges must also be multiples of 16. */
  pixelWindow?: [number, number];
}

const MODELS: Record<string, InpaintModel> = {
  "gpt-image-2.6-sunburst": { key: "gpt-image-2.6-sunburst", endpoint: "openai/gpt-image-2.6/sunburst/edit", kind: "native", refs: "optional", maxEdge: 3840, pixelWindow: [655_360, 8_294_400] },
  "gpt-image-2.6-flare": { key: "gpt-image-2.6-flare", endpoint: "openai/gpt-image-2.6/flare/edit", kind: "native", refs: "optional", maxEdge: 3840, pixelWindow: [655_360, 8_294_400] },
  "gpt-image-2.5-flare": { key: "gpt-image-2.5-flare", endpoint: "openai/gpt-image-2.5/flare/edit", kind: "native", refs: "optional", maxEdge: 3840, pixelWindow: [655_360, 8_294_400] },
  "flux-pro-fill": { key: "flux-pro-fill", endpoint: "fal-ai/flux-pro/v1/fill", kind: "native", refs: "none", maxEdge: 2048 },
  "ideogram-v3-edit": { key: "ideogram-v3-edit", endpoint: "fal-ai/ideogram/v3/edit", kind: "native", refs: "none", maxEdge: 2048 },
  "kontext-inpaint": { key: "kontext-inpaint", endpoint: "fal-ai/flux-kontext-lora/inpaint", kind: "native", refs: "required", strength: true, maxEdge: 2048 },
  "qwen-inpaint": { key: "qwen-inpaint", endpoint: "fal-ai/qwen-image-edit/inpaint", kind: "native", refs: "none", strength: true, maxEdge: 2048 },
  "bria-genfill": { key: "bria-genfill", endpoint: "fal-ai/bria/genfill", kind: "native", refs: "none", maxEdge: 2048 },
  "object-removal": { key: "object-removal", endpoint: "fal-ai/object-removal/mask", kind: "erase", refs: "none", maxEdge: 2048 },
  "bria-eraser": { key: "bria-eraser", endpoint: "fal-ai/bria/eraser", kind: "erase", refs: "none", maxEdge: 2048 },
  "nano-banana-pro": { key: "nano-banana-pro", endpoint: "fal-ai/nano-banana-pro/edit", kind: "composite", refs: "optional", maxEdge: 4096 },
  "nano-banana-2.1": { key: "nano-banana-2.1", endpoint: "google/nano-banana-2.1/edit", kind: "composite", refs: "optional", maxEdge: 4096 },
  "seedream-5-pro": { key: "seedream-5-pro", endpoint: "bytedance/seedream/v5/pro/edit", kind: "composite", refs: "optional", maxEdge: 4096 },
};

/** Endpoints whose input schema declares `seed`. */
const SEEDED = new Set(["flux-pro-fill", "ideogram-v3-edit", "kontext-inpaint", "qwen-inpaint", "bria-genfill"]);

export const INPAINT_MODEL_KEYS = Object.keys(MODELS);

let configured = false;
function ensureConfigured(): void {
  if (configured) return;
  const key = process.env.FAL_KEY;
  if (!key) throw new Error("FAL_KEY is not configured on the server.");
  fal.config({ credentials: key });
  configured = true;
}

/** Same unwrapping as the video adapter: Fal hides the real reason in body.detail. */
function falErrorMessage(err: unknown, fallback: string): string {
  const detail = (err as { body?: { detail?: unknown } })?.body?.detail;
  if (Array.isArray(detail) && detail.length) {
    const parts = detail
      .map((d) => {
        const info = d as { loc?: unknown[]; msg?: string };
        const field = Array.isArray(info.loc) ? String(info.loc[info.loc.length - 1] ?? "") : "";
        const msg = String(info.msg ?? "").trim();
        if (!msg) return "";
        return field && field !== "body" ? `${field}: ${msg}` : msg;
      })
      .filter(Boolean);
    if (parts.length) return `The model rejected this edit — ${parts.join("; ")}.`;
  }
  if (typeof detail === "string" && detail.trim()) return `The model rejected this edit — ${detail.trim()}`;
  const msg = String((err as { message?: string })?.message ?? "").trim();
  return msg && !/^unprocessable entity$/i.test(msg) ? msg : fallback;
}

/** Working size for the model: within its edge cap and (for OpenAI) pixel window. */
function workSize(w: number, h: number, m: InpaintModel): { width: number; height: number } {
  let s = Math.min(1, m.maxEdge / Math.max(w, h));
  if (m.pixelWindow) {
    const [lo, hi] = m.pixelWindow;
    const area = w * h * s * s;
    if (area > hi) s *= Math.sqrt(hi / area);
    if (area < lo) s *= Math.sqrt(lo / area);
    const snap = (n: number, grow: boolean) => Math.max(16, (grow ? Math.ceil(n / 16) : Math.floor(n / 16)) * 16);
    const grow = w * h * s * s < lo * 1.001;
    let width = snap(w * s, grow);
    let height = snap(h * s, grow);
    if (width > m.maxEdge) width = Math.floor(m.maxEdge / 16) * 16;
    if (height > m.maxEdge) height = Math.floor(m.maxEdge / 16) * 16;
    return { width, height };
  }
  // Even edges keep the diffusion models' VAE happy.
  return { width: Math.max(8, Math.round((w * s) / 8) * 8), height: Math.max(8, Math.round((h * s) / 8) * 8) };
}

/**
 * The mask as a hard single-channel PNG at the given size, grown by `expand`
 * pixels. Growing gives the model a margin of context to blend into — a mask
 * traced tight to an object leaves its shadow and halo behind.
 */
async function prepareMask(mask: Buffer, width: number, height: number, expand: number): Promise<Buffer> {
  let img = sharp(mask).flatten({ background: "#000" }).greyscale().resize(width, height, { fit: "fill" });
  if (expand > 0) {
    // Blur then a low threshold = dilation by roughly `expand` pixels.
    const buf = await img.png().toBuffer();
    img = sharp(buf).blur(Math.max(0.3, expand / 2)).threshold(12);
  } else {
    img = img.threshold(128);
  }
  return img.png().toBuffer();
}

/** Has the user actually painted anything? */
async function maskCoverage(maskPng: Buffer): Promise<number> {
  const { data, info } = await sharp(maskPng).greyscale().raw().toBuffer({ resolveWithObject: true });
  let on = 0;
  for (let i = 0; i < data.length; i += info.channels) if (data[i] > 127) on++;
  return on / (info.width * info.height);
}

/** Red tint over the masked region — how composite models are told where to edit. */
async function highlightImage(image: Buffer, maskPng: Buffer, width: number, height: number): Promise<Buffer> {
  const alpha = await sharp(maskPng).resize(width, height, { fit: "fill" }).greyscale().linear(0.55, 0).raw().toBuffer();
  const red = await sharp({ create: { width, height, channels: 3, background: { r: 255, g: 0, b: 0 } } })
    .joinChannel(alpha, { raw: { width, height, channels: 1 } })
    .png()
    .toBuffer();
  const base = await sharp(image).resize(width, height, { fit: "fill" }).png().toBuffer();
  return sharp(base).composite([{ input: red }]).png().toBuffer();
}

/**
 * Paste `result` over `original` through the mask, feathered by `feather` px.
 * Output is the original's exact dimensions.
 */
/**
 * The model's output at the original's size with no transparency left in it.
 * GPT Image returns RGBA; anything it leaves see-through is filled from the
 * original rather than dropped — removeAlpha() alone would turn it black.
 */
async function solidResult(original: Buffer, result: Buffer, width: number, height: number): Promise<Buffer> {
  const resized = await sharp(result).resize(width, height, { fit: "fill" }).ensureAlpha().png().toBuffer();
  const base = await sharp(original).resize(width, height, { fit: "fill" }).removeAlpha().png().toBuffer();
  return sharp(base).composite([{ input: resized }]).removeAlpha().png().toBuffer();
}

/**
 * Share of the painted area that came back black or see-through. A model's
 * safety filter answers with an all-black frame, and once that is pasted back
 * through the mask it reads as a black hole in the image.
 */
async function blankShare(img: Buffer, maskPng: Buffer, width: number, height: number): Promise<number> {
  const px = await sharp(img).resize(width, height, { fit: "fill" }).ensureAlpha().raw().toBuffer();
  const m = await sharp(maskPng).resize(width, height, { fit: "fill" }).greyscale().raw().toBuffer();
  let n = 0;
  let blank = 0;
  for (let i = 0; i < width * height; i++) {
    if (m[i] < 128) continue;
    n++;
    const o = i * 4;
    if (px[o + 3] < 30 || px[o] + px[o + 1] + px[o + 2] < 36) blank++;
  }
  return n ? blank / n : 0;
}

async function compositeThroughMask(
  original: Buffer,
  result: Buffer,
  maskPng: Buffer,
  width: number,
  height: number,
  feather: number,
): Promise<Buffer> {
  let alpha = sharp(maskPng).resize(width, height, { fit: "fill" }).greyscale();
  if (feather > 0) alpha = alpha.blur(Math.max(0.3, feather / 2));
  const alphaRaw = await alpha.raw().toBuffer();
  // Two passes on purpose: sharp runs a pipeline in its own fixed order, and
  // removeAlpha() lands AFTER joinChannel() — in one chain it strips the mask
  // we just attached and the whole result pastes over the original opaque.
  const rgb = await solidResult(original, result, width, height);
  const top = await sharp(rgb)
    .joinChannel(alphaRaw, { raw: { width, height, channels: 1 } })
    .png()
    .toBuffer();
  const base = await sharp(original).removeAlpha().png().toBuffer();
  return sharp(base).composite([{ input: top }]).png().toBuffer();
}

async function upload(buf: Buffer, mime = "image/png"): Promise<string> {
  return fal.storage.upload(new Blob([new Uint8Array(buf)], { type: mime }));
}

export interface InpaintOptions {
  model: string;
  prompt: string;
  image: { base64: string; mimeType: string };
  /** White = change. Any size; it is stretched to the image. */
  mask: { base64: string; mimeType?: string };
  references?: { base64: string; mimeType: string }[];
  /** Grow the mask by this many px before the model sees it (0–64). */
  expand?: number;
  /** Feather for the paste-back, px (0–64). */
  feather?: number;
  /** Paste back through the mask so nothing outside it can change. */
  protect?: boolean;
  /** Denoise strength for models that expose it (0.05–1). */
  strength?: number;
  /** GPT Image quality tier. */
  quality?: string;
  /** Object-removal quality tier. */
  eraseQuality?: string;
}

export async function inpaint(opts: InpaintOptions): Promise<{ base64: string; mimeType: string; model: string }> {
  ensureConfigured();
  const m = MODELS[opts.model];
  if (!m) throw new Error(`Unknown in-paint model "${opts.model}".`);

  const prompt = String(opts.prompt ?? "").trim();
  if (m.kind !== "erase" && !prompt) throw new Error("Describe what should appear in the painted area.");
  const refs = (opts.references ?? []).filter((r) => r?.base64);
  if (m.refs === "required" && refs.length === 0) {
    throw new Error("This model needs a reference image of what to place in the painted area.");
  }

  // Normalise orientation once so the mask (drawn on the displayed image) lines up.
  const original = await sharp(Buffer.from(opts.image.base64, "base64")).rotate().png().toBuffer();
  const meta = await sharp(original).metadata();
  const W = meta.width ?? 0;
  const H = meta.height ?? 0;
  if (!W || !H) throw new Error("Couldn't read the image.");

  const expand = Math.max(0, Math.min(64, Math.round(Number(opts.expand ?? 0))));
  const feather = Math.max(0, Math.min(64, Math.round(Number(opts.feather ?? 8))));
  const protect = opts.protect !== false || m.kind === "composite";

  const fullMask = await prepareMask(Buffer.from(opts.mask.base64, "base64"), W, H, expand);
  const coverage = await maskCoverage(fullMask);
  if (coverage < 0.0005) throw new Error("Paint over the area you want to change first.");
  if (coverage > 0.985) throw new Error("The mask covers the whole image — that's a regenerate, not an in-paint. Leave some of the original unpainted.");

  const { width, height } = workSize(W, H, m);
  const workImage = await sharp(original).resize(width, height, { fit: "fill" }).removeAlpha().png().toBuffer();
  const workMask = await sharp(fullMask).resize(width, height, { fit: "fill" }).threshold(128).png().toBuffer();

  const [imageUrl, maskUrl] = await Promise.all([upload(workImage), upload(workMask)]);
  const refUrls = await Promise.all(refs.slice(0, 8).map((r) => upload(Buffer.from(r.base64, "base64"), r.mimeType || "image/png")));

  const strength = Math.max(0.05, Math.min(1, Number(opts.strength ?? 0.9) || 0.9));
  let input: Record<string, unknown>;

  switch (m.key) {
    case "gpt-image-2.6-sunburst":
    case "gpt-image-2.6-flare":
    case "gpt-image-2.5-flare": {
      const q = ["low", "medium", "high", "xhigh", "max"].includes(String(opts.quality)) ? opts.quality : "high";
      input = {
        prompt,
        image_urls: [imageUrl, ...refUrls],
        mask_url: maskUrl,
        image_size: { width, height },
        quality: q,
        output_format: "png",
        num_images: 1,
        ...(m.key.startsWith("gpt-image-2.6") ? { reasoning_effort: "high" } : {}),
      };
      break;
    }
    case "flux-pro-fill":
      input = { prompt, image_url: imageUrl, mask_url: maskUrl, output_format: "png", safety_tolerance: "5", num_images: 1 };
      break;
    case "ideogram-v3-edit":
      input = { prompt, image_url: imageUrl, mask_url: maskUrl, rendering_speed: "QUALITY", num_images: 1 };
      break;
    case "kontext-inpaint":
      input = { prompt, image_url: imageUrl, reference_image_url: refUrls[0], mask_url: maskUrl, strength, num_images: 1, output_format: "png" };
      break;
    case "qwen-inpaint":
      input = { prompt, image_url: imageUrl, mask_url: maskUrl, strength, image_size: { width, height }, output_format: "png", num_images: 1 };
      break;
    case "bria-genfill":
      input = { prompt, image_url: imageUrl, mask_url: maskUrl, num_images: 1 };
      break;
    case "object-removal": {
      const tier = ["low_quality", "medium_quality", "high_quality", "best_quality"].includes(String(opts.eraseQuality))
        ? opts.eraseQuality
        : "best_quality";
      // We grow the mask ourselves (and the user can see the setting), so
      // don't let the model add its default 15px on top.
      input = { image_url: imageUrl, mask_url: maskUrl, model: tier, mask_expansion: 0 };
      break;
    }
    case "bria-eraser":
      input = { image_url: imageUrl, mask_url: maskUrl, mask_type: "manual" };
      break;
    default: {
      // Composite: show the region as a red highlight in a second image.
      const highlight = await highlightImage(workImage, workMask, width, height);
      const highlightUrl = await upload(highlight);
      const instruction =
        `${prompt}\n\nEdit ONLY the region tinted red in the second image; it marks the area to change on the first image. ` +
        `Keep every other part of the first image identical — same framing, lighting, colours and detail. ` +
        `The red tint is only a marker: the output must not contain any red overlay.` +
        (refUrls.length ? ` Use the remaining image(s) as the reference for what goes in that region.` : "");
      input = {
        prompt: instruction,
        image_urls: [imageUrl, highlightUrl, ...refUrls],
        num_images: 1,
        output_format: "png",
        ...(m.key.startsWith("nano-banana") ? { resolution: Math.max(width, height) > 2048 ? "4K" : Math.max(width, height) > 1024 ? "2K" : "1K" } : {}),
        ...(m.key === "seedream-5-pro" ? { image_size: { width: Math.max(1024, width), height: Math.max(1024, height) }, max_images: 1 } : {}),
      };
      if (m.key.startsWith("nano-banana")) {
        // Nano Banana takes an aspect enum, not a size; pick the nearest.
        const ratios = ["21:9", "16:9", "3:2", "4:3", "5:4", "1:1", "4:5", "3:4", "2:3", "9:16"];
        const target = width / height;
        input.aspect_ratio = ratios.reduce((best, r) => {
          const [a, b] = r.split(":").map(Number);
          const [c, d] = best.split(":").map(Number);
          return Math.abs(a / b - target) < Math.abs(c / d - target) ? r : best;
        }, "1:1");
      }
    }
  }

  // The painted area in the original, for telling a black result from a
  // legitimately dark one (a black can, a night sky).
  const originalBlank = await blankShare(original, fullMask, W, H);

  const callOnce = async (): Promise<{ buf: Buffer; flagged: boolean }> => {
    let data: unknown;
    try {
      ({ data } = await fal.subscribe(m.endpoint, { input } as never));
    } catch (err) {
      const status = (err as { status?: number })?.status;
      if (status === 404) throw new Error(`That in-paint model isn't available on Fal right now (${m.endpoint}).`);
      throw new Error(falErrorMessage(err, "The in-paint request failed. Try a different model."));
    }
    const d = data as { images?: { url?: string }[]; image?: { url?: string }; has_nsfw_concepts?: boolean[] };
    const url = d?.images?.[0]?.url ?? d?.image?.url;
    if (!url) throw new Error("The model returned no image. Try again or pick a different model.");
    let buf: Buffer;
    if (url.startsWith("data:")) {
      buf = Buffer.from(url.slice(url.indexOf(",") + 1), "base64");
    } else {
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`Couldn't fetch the edited image (${resp.status}).`);
      buf = Buffer.from(await resp.arrayBuffer());
    }
    const flagged = Array.isArray(d?.has_nsfw_concepts) && d.has_nsfw_concepts.some(Boolean);
    return { buf, flagged };
  };

  // One automatic retry: filter misfires and empty fills are usually one-offs.
  let resultBuf: Buffer | null = null;
  let lastFlagged = false;
  for (let attempt = 0; attempt < 2 && !resultBuf; attempt++) {
    // Models whose schema has a seed get a fresh one; the rest re-roll anyway.
    if (attempt > 0 && SEEDED.has(m.key)) input.seed = Math.floor(Math.random() * 2 ** 31);
    const { buf, flagged } = await callOnce();
    const blank = await blankShare(buf, fullMask, W, H);
    lastFlagged = flagged;
    if (!flagged && !(blank > 0.8 && originalBlank < 0.4)) resultBuf = buf;
  }
  if (!resultBuf) {
    throw new Error(
      lastFlagged
        ? `${m.endpoint.split("/").slice(-2).join(" ")} blacked out the painted area — its safety filter flagged the image (often a false alarm on alcohol, skin or text). Try GPT Image 2.6 or Bria GenFill.`
        : `The model came back with an empty (black) area twice. Try a different model, or paint a little wider so it has more of the image to work from.`,
    );
  }

  const out = protect
    ? await compositeThroughMask(original, resultBuf, fullMask, W, H, feather)
    : await solidResult(original, resultBuf, W, H);

  return { base64: out.toString("base64"), mimeType: "image/png", model: m.key };
}
