import { authedFetch } from './api';

/**
 * Logo Lock — composite the brand's REAL logo onto a generated image so it is
 * pixel-identical to the brand asset (image models can't be trusted to redraw a
 * mark faithfully). Runs client-side on a canvas. Best-effort: throws on hard
 * failure so the caller can fall back to the raw image.
 */

export type Corner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image load failed'));
    img.src = src;
  });
}

/** Fetch an image URL through the same-origin proxy and return a data URL. */
export async function fetchAsDataUrl(url: string): Promise<string> {
  if (url.startsWith('data:')) return url;
  const res = await authedFetch(`/api/content/image-proxy?url=${encodeURIComponent(url)}`);
  if (!res.ok) throw new Error('logo fetch failed');
  const blob = await res.blob();
  return await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(new Error('read failed'));
    r.readAsDataURL(blob);
  });
}

/** Mean luminance (0–1) of a rectangular region, sampling every 8th pixel. */
function regionLuminance(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): number {
  const { data } = ctx.getImageData(x, y, w, h);
  let sum = 0;
  let n = 0;
  for (let i = 0; i < data.length; i += 4 * 8) {
    sum += (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) / 255;
    n++;
  }
  return n ? sum / n : 1;
}

interface CompositeArgs {
  baseBase64: string;
  baseMime: string;
  /** Light (for dark backgrounds) and dark (for light backgrounds) logo data URLs. */
  lightLogo?: string | null;
  darkLogo?: string | null;
  corner?: Corner;
  /** Logo's longest edge as a fraction of the image's short edge. */
  sizePct?: number;
  padPct?: number;
}

export async function compositeLogo(
  args: CompositeArgs,
): Promise<{ base64: string; mimeType: string }> {
  const corner = args.corner ?? 'bottom-right';
  const sizePct = args.sizePct ?? 0.16;
  const padPct = args.padPct ?? 0.045;

  const base = await loadImage(`data:${args.baseMime};base64,${args.baseBase64}`);
  const W = base.naturalWidth;
  const H = base.naturalHeight;
  if (!W || !H) throw new Error('bad base image');

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no 2d context');
  ctx.drawImage(base, 0, 0, W, H);

  const shortEdge = Math.min(W, H);
  const pad = Math.round(shortEdge * padPct);
  const box = Math.round(shortEdge * sizePct);

  // Sample the target corner to pick the variant that will contrast.
  const sampleW = Math.min(W, box + pad * 2);
  const sampleH = Math.min(H, box + pad * 2);
  const sx = corner.includes('right') ? Math.max(0, W - sampleW) : 0;
  const sy = corner.includes('bottom') ? Math.max(0, H - sampleH) : 0;
  let wantDark = true;
  try {
    wantDark = regionLuminance(ctx, sx, sy, sampleW, sampleH) > 0.5;
  } catch {
    /* keep default */
  }
  const chosen = wantDark ? args.darkLogo || args.lightLogo : args.lightLogo || args.darkLogo;
  if (!chosen) throw new Error('no logo variant available');

  const logo = await loadImage(chosen);
  const lAspect = (logo.naturalWidth || 1) / (logo.naturalHeight || 1);
  let lw = box;
  let lh = box;
  if (lAspect >= 1) lh = Math.round(box / lAspect);
  else lw = Math.round(box * lAspect);

  const lx = corner.includes('right') ? W - lw - pad : pad;
  const ly = corner.includes('bottom') ? H - lh - pad : pad;
  ctx.drawImage(logo, lx, ly, lw, lh);

  const dataUrl = canvas.toDataURL('image/png');
  return { base64: dataUrl.split(',')[1], mimeType: 'image/png' };
}
