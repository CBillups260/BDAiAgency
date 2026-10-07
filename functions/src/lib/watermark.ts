// AI watermark remover.
//
// Two independent operations, both CPU-only and offline (no model calls):
//
//   1. Visible Gemini ("Nano Banana") sparkle removal via reverse alpha blending.
//      Google stamps a fixed semi-transparent white sparkle in the corner using
//          watermarked = a * logo + (1 - a) * original
//      We reverse it with a captured alpha map to recover the true pixels:
//          original = (watermarked - a * logo) / (1 - a)
//      This recovers the real content instead of hallucinating an inpaint, and —
//      crucially — does NOT re-encode the image through an AI model, so it never
//      re-introduces a fresh SynthID / sparkle the way "ask Gemini to remove it"
//      would. Port of the reverse-alpha core from wiltodelta/remove-ai-watermarks
//      (itself a port of allenk/GeminiWatermarkTool).
//
//   2. AI-provenance metadata stripping. Re-encoding the pixels through sharp
//      drops the C2PA manifest, EXIF, XMP DigitalSourceType, and PNG text chunks
//      that social platforms (Instagram / Facebook / X) read to auto-apply a
//      "Made with AI" label.
//
// The watermark position/size for our own composer output is deterministic
// (Gemini's fixed corner margins), so no template-matching detector is needed.
// Inputs that were resized/cropped outside the composer may not line up; that
// path (a full NCC detector) is intentionally out of scope here.

import sharp from "sharp";

import {
  GEMINI_BG_48_PNG_BASE64,
  GEMINI_BG_96_PNG_BASE64,
} from "./watermarkAssets.js";

// ── Tunables (ported verbatim from the reference engine) ─────────────────────

/** White logo value the sparkle is blended toward. */
const LOGO_VALUE = 255;
/** Below this alpha the mark barely affects the pixel — leave it untouched. */
const ALPHA_MIN = 0.002;
/** Reverse-alpha is ill-conditioned as alpha→1; clamp to keep it stable. */
const ALPHA_MAX = 0.99;
/** Footprint pixels at/above this alpha form the sparkle "body". */
const FOOTPRINT_ALPHA = 0.1;
/** If more than this fraction of body pixels over-subtract, inpaint instead. */
const OVERSUB_FOOTPRINT_FRAC = 0.05;
/** Per-image alpha gain is clamped to [1, MAX] so it only strengthens removal. */
const ALPHA_GAIN_MAX = 1.94;
/** Body pixels at ≥ this × peak alpha define the bright core. */
const ALPHA_GAIN_CORE_FRAC = 0.8;
/** Only apply the gain above this, so a matching sparkle stays untouched. */
const ALPHA_GAIN_DEADBAND = 1.05;

// ── Alpha-map loading (decoded once, lazily) ─────────────────────────────────

interface AlphaMap {
  size: number;
  /** Per-pixel alpha in row-major order, length size*size. */
  data: Float32Array;
  /** Peak alpha across the map. */
  peak: number;
}

let alphaMapsPromise: Promise<{ small: AlphaMap; large: AlphaMap }> | null = null;

async function decodeAlphaMap(base64: string, expected: number): Promise<AlphaMap> {
  // alpha = max(R, G, B) / 255 over the black-background capture.
  let img = sharp(Buffer.from(base64, "base64"));
  const meta = await img.metadata();
  if (meta.width !== expected || meta.height !== expected) {
    img = img.resize(expected, expected, { fit: "fill" });
  }
  const { data, info } = await img
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const ch = info.channels; // 3 after removeAlpha
  const out = new Float32Array(expected * expected);
  let peak = 0;
  for (let i = 0; i < out.length; i++) {
    const o = i * ch;
    const m = Math.max(data[o], data[o + 1], data[o + 2]) / 255;
    out[i] = m;
    if (m > peak) peak = m;
  }
  return { size: expected, data: out, peak };
}

function loadAlphaMaps(): Promise<{ small: AlphaMap; large: AlphaMap }> {
  if (!alphaMapsPromise) {
    alphaMapsPromise = Promise.all([
      decodeAlphaMap(GEMINI_BG_48_PNG_BASE64, 48),
      decodeAlphaMap(GEMINI_BG_96_PNG_BASE64, 96),
    ]).then(([small, large]) => ({ small, large }));
  }
  return alphaMapsPromise;
}

// ── Geometry (Gemini's fixed corner placement) ───────────────────────────────

interface Placement {
  size: number;
  x: number;
  y: number;
}

/**
 * Gemini's deterministic mark geometry:
 *   - width>1024 AND height>1024 → 96px logo, 64px margins
 *   - otherwise                  → 48px logo, 32px margins
 * Positioned in the bottom-right corner.
 */
function getPlacement(width: number, height: number): Placement {
  const large = width > 1024 && height > 1024;
  const size = large ? 96 : 48;
  const margin = large ? 64 : 32;
  return { size, x: width - margin - size, y: height - margin - size };
}

// ── Pixel buffer wrapper ─────────────────────────────────────────────────────

interface Raw {
  data: Buffer; // RGBA, row-major
  width: number;
  height: number;
  channels: number; // 4
}

/** Mean of the R,G,B channels at pixel (px, py). */
function grayAt(raw: Raw, px: number, py: number): number {
  const o = (py * raw.width + px) * raw.channels;
  return (raw.data[o] + raw.data[o + 1] + raw.data[o + 2]) / 3;
}

// ── Core: per-image alpha gain (under-subtraction fix) ────────────────────────

interface CoreAndBg {
  coreObs: number; // 75th-pct brightness over the high-alpha core
  bg: number; // local background ring median
  aCap: number; // captured peak alpha over the placed footprint
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round((p / 100) * (sorted.length - 1))));
  return sorted[idx];
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function coreAndBg(raw: Raw, alpha: AlphaMap, place: Placement): CoreAndBg | null {
  const { size } = alpha;
  const x1 = Math.max(0, place.x);
  const y1 = Math.max(0, place.y);
  const x2 = Math.min(raw.width, place.x + size);
  const y2 = Math.min(raw.height, place.y + size);
  if (x1 >= x2 || y1 >= y2) return null;

  const aCap = alpha.peak;
  if (aCap < 0.2) return null;

  // Bright-core brightness: 75th percentile of gray over body pixels (alpha ≥ 0.8·peak).
  const coreVals: number[] = [];
  for (let py = y1; py < y2; py++) {
    for (let px = x1; px < x2; px++) {
      const a = alpha.data[(py - place.y) * size + (px - place.x)];
      if (a >= aCap * ALPHA_GAIN_CORE_FRAC) coreVals.push(grayAt(raw, px, py));
    }
  }
  if (coreVals.length === 0) return null;
  const coreObs = percentile(coreVals, 75);

  // Local background = a ring just outside the footprint box.
  const pad = Math.round((x2 - x1) * 0.7);
  const ry1 = Math.max(0, y1 - pad);
  const ry2 = Math.min(raw.height, y2 + pad);
  const rx1 = Math.max(0, x1 - pad);
  const rx2 = Math.min(raw.width, x2 + pad);
  const ring: number[] = [];
  for (let py = ry1; py < ry2; py++) {
    for (let px = rx1; px < rx2; px++) {
      const inside = px >= x1 && px < x2 && py >= y1 && py < y2;
      if (!inside) ring.push(grayAt(raw, px, py));
    }
  }
  if (ring.length < 10) return null;
  return { coreObs, bg: median(ring), aCap };
}

function estimateAlphaGain(raw: Raw, alpha: AlphaMap, place: Placement): number {
  const cb = coreAndBg(raw, alpha, place);
  if (!cb) return 1;
  if (255 - cb.bg < 5) return 1;
  const aEff = Math.min(0.99, Math.max(0, (cb.coreObs - cb.bg) / (255 - cb.bg)));
  return Math.min(ALPHA_GAIN_MAX, Math.max(1, aEff / cb.aCap));
}

// ── Core: over-subtraction test (dark-background guard, issue #30) ────────────

function reverseAlphaOversubtracts(raw: Raw, alpha: Float32Array, size: number, place: Placement): boolean {
  let body = 0;
  let negative = 0;
  for (let ay = 0; ay < size; ay++) {
    const py = place.y + ay;
    if (py < 0 || py >= raw.height) continue;
    for (let ax = 0; ax < size; ax++) {
      const a = alpha[ay * size + ax];
      if (a < FOOTPRINT_ALPHA) continue;
      const px = place.x + ax;
      if (px < 0 || px >= raw.width) continue;
      body++;
      const numerator = grayAt(raw, px, py) - Math.min(a, ALPHA_MAX) * LOGO_VALUE;
      if (numerator < 0) negative++;
    }
  }
  if (body === 0) return false;
  return negative / body > OVERSUB_FOOTPRINT_FRAC;
}

// ── Core: reverse alpha blend (in place) ─────────────────────────────────────

function reverseAlphaBlend(raw: Raw, alpha: Float32Array, size: number, place: Placement): void {
  for (let ay = 0; ay < size; ay++) {
    const py = place.y + ay;
    if (py < 0 || py >= raw.height) continue;
    for (let ax = 0; ax < size; ax++) {
      let a = alpha[ay * size + ax];
      if (a < ALPHA_MIN) continue;
      const px = place.x + ax;
      if (px < 0 || px >= raw.width) continue;
      if (a > ALPHA_MAX) a = ALPHA_MAX;
      const oneMinus = 1 - a;
      const o = (py * raw.width + px) * raw.channels;
      for (let c = 0; c < 3; c++) {
        const v = raw.data[o + c];
        let restored = (v - a * LOGO_VALUE) / oneMinus;
        if (restored < 0) restored = 0;
        else if (restored > 255) restored = 255;
        raw.data[o + c] = Math.round(restored);
      }
    }
  }
}

// ── Fallback: footprint fill for dark backgrounds ────────────────────────────
//
// When reverse-alpha would over-subtract (dark/textured background), the
// reference uses cv2's Navier-Stokes inpaint. We don't ship OpenCV; instead we
// fill the small sparkle body with the local background ring color. Cruder than
// NS inpaint but it replaces the mark with plausible background instead of a
// black pit, and it only ever runs on the dark-background minority — bright
// marketing backgrounds take the exact reverse-alpha path above.

function fillFootprint(raw: Raw, alpha: AlphaMap, place: Placement): void {
  const { size } = alpha;
  const cb = coreAndBg(raw, alpha, place);
  // Sample a representative background color from the ring just outside the box.
  const x1 = Math.max(0, place.x);
  const y1 = Math.max(0, place.y);
  const x2 = Math.min(raw.width, place.x + size);
  const y2 = Math.min(raw.height, place.y + size);
  const pad = Math.round((x2 - x1) * 0.7);
  const rSum = [0, 0, 0];
  let rCount = 0;
  for (let py = Math.max(0, y1 - pad); py < Math.min(raw.height, y2 + pad); py++) {
    for (let px = Math.max(0, x1 - pad); px < Math.min(raw.width, x2 + pad); px++) {
      const inside = px >= x1 && px < x2 && py >= y1 && py < y2;
      if (inside) continue;
      const o = (py * raw.width + px) * raw.channels;
      rSum[0] += raw.data[o];
      rSum[1] += raw.data[o + 1];
      rSum[2] += raw.data[o + 2];
      rCount++;
    }
  }
  if (rCount === 0) return;
  const fill = [Math.round(rSum[0] / rCount), Math.round(rSum[1] / rCount), Math.round(rSum[2] / rCount)];
  void cb;
  for (let ay = 0; ay < size; ay++) {
    const py = place.y + ay;
    if (py < 0 || py >= raw.height) continue;
    for (let ax = 0; ax < size; ax++) {
      if (alpha.data[ay * size + ax] < FOOTPRINT_ALPHA) continue;
      const px = place.x + ax;
      if (px < 0 || px >= raw.width) continue;
      const o = (py * raw.width + px) * raw.channels;
      raw.data[o] = fill[0];
      raw.data[o + 1] = fill[1];
      raw.data[o + 2] = fill[2];
    }
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

export interface RemoveWatermarkOptions {
  /** Remove the visible Gemini sparkle (default true). */
  removeSparkle?: boolean;
  /** Strip C2PA / EXIF / XMP "Made with AI" metadata (default true). */
  stripMetadata?: boolean;
}

export interface RemoveWatermarkReport {
  sparkleRemoved: boolean;
  metadataStripped: boolean;
  /** "reverse-alpha" | "inpaint" | "skipped" */
  method: string;
  width: number;
  height: number;
}

export interface RemoveWatermarkResult {
  base64: string;
  mimeType: string;
  report: RemoveWatermarkReport;
}

/**
 * Remove the visible Gemini sparkle and/or strip AI-provenance metadata from an
 * image. Always returns a PNG (lossless; re-encoding is what strips metadata).
 */
export async function removeWatermark(
  inputBase64: string,
  opts: RemoveWatermarkOptions = {},
): Promise<RemoveWatermarkResult> {
  const removeSparkle = opts.removeSparkle !== false;
  const stripMetadata = opts.stripMetadata !== false;

  const input = Buffer.from(inputBase64, "base64");
  let method = "skipped";
  let sparkleRemoved = false;

  // Nothing to do — hand the original bytes back untouched (metadata intact).
  if (!removeSparkle && !stripMetadata) {
    const meta = await sharp(input).metadata();
    return {
      base64: inputBase64,
      mimeType: `image/${meta.format ?? "png"}`,
      report: {
        sparkleRemoved: false,
        metadataStripped: false,
        method: "skipped",
        width: meta.width ?? 0,
        height: meta.height ?? 0,
      },
    };
  }

  // Decode to a flat RGBA buffer so we can edit pixels and re-encode losslessly.
  const { data, info } = await sharp(input)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const raw: Raw = { data, width: info.width, height: info.height, channels: info.channels };

  if (removeSparkle) {
    const maps = await loadAlphaMaps();
    const place = getPlacement(raw.width, raw.height);
    const alpha = place.size === 96 ? maps.large : maps.small;

    if (place.x >= 0 && place.y >= 0) {
      // Match captured alpha to this image's sparkle opacity (under-subtraction fix).
      let alphaData = alpha.data;
      const gain = estimateAlphaGain(raw, alpha, place);
      if (gain > ALPHA_GAIN_DEADBAND) {
        alphaData = new Float32Array(alpha.data.length);
        for (let i = 0; i < alphaData.length; i++) {
          alphaData[i] = Math.min(0.99, alpha.data[i] * gain);
        }
      }

      if (reverseAlphaOversubtracts(raw, alphaData, place.size, place)) {
        fillFootprint(raw, { ...alpha, data: alphaData }, place);
        method = "inpaint";
      } else {
        reverseAlphaBlend(raw, alphaData, place.size, place);
        method = "reverse-alpha";
      }
      sparkleRemoved = true;
    }
  }

  // Re-encode as PNG from the raw pixels. sharp does not carry input metadata to
  // the output, so this unconditionally drops the C2PA manifest, EXIF, XMP, and
  // PNG text chunks — there is no way to preserve the original provenance once we
  // round-trip through raw pixels, and stripping it is the whole point here.
  const out = await sharp(raw.data, {
    raw: { width: raw.width, height: raw.height, channels: raw.channels as 1 | 2 | 3 | 4 },
  })
    .png()
    .toBuffer();

  return {
    base64: out.toString("base64"),
    mimeType: "image/png",
    report: {
      sparkleRemoved,
      metadataStripped: true,
      method,
      width: raw.width,
      height: raw.height,
    },
  };
}
