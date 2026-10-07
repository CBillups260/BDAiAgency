// Client for the external GPU SynthID-removal service (see gpu-service/).
//
// Invisible-watermark removal needs a GPU and a ~10 GB diffusion model, so it
// can't run in Firebase Functions. It runs as a separate Modal endpoint; this
// module forwards an image to it and returns the regenerated (SynthID-free) PNG.

export interface InvisibleRemovalResult {
  base64: string;
  width: number;
  height: number;
  method: string;
}

export class SynthIDServiceError extends Error {
  /** True when the service simply isn't configured (vs. a runtime failure). */
  notConfigured: boolean;
  constructor(message: string, notConfigured = false) {
    super(message);
    this.name = "SynthIDServiceError";
    this.notConfigured = notConfigured;
  }
}

export function isInvisibleRemovalConfigured(): boolean {
  return !!process.env.SYNTHID_SERVICE_URL;
}

/**
 * Send a base64 image to the GPU service for invisible (SynthID) removal.
 *
 * @param base64  Image bytes (PNG/JPEG), base64-encoded. Pass the visible-cleaned
 *                image so the diffusion pass operates on already-de-sparkled pixels.
 * @param vendor  SynthID strength hint: "google" (0.30) for Gemini output, "openai"
 *                (0.20) for gpt-image. Defaults to "google" (our composer is Gemini).
 */
export async function removeInvisibleWatermark(
  base64: string,
  vendor: "google" | "openai" | "unknown" = "google",
): Promise<InvisibleRemovalResult> {
  const url = process.env.SYNTHID_SERVICE_URL;
  if (!url) {
    throw new SynthIDServiceError(
      "Invisible watermark removal isn't configured. Deploy the GPU service (see gpu-service/README.md) and set SYNTHID_SERVICE_URL.",
      true,
    );
  }

  // Diffusion takes ~10–40s on a cloud GPU but 1–5 min on a local Mac (MPS),
  // especially the first run after a restart (Metal compiles kernels). Allow a
  // generous ceiling so a slow local run completes rather than erroring; override
  // with SYNTHID_SERVICE_TIMEOUT_MS. Node 18+ AbortSignal.timeout drives the abort.
  const timeoutMs = Number(process.env.SYNTHID_SERVICE_TIMEOUT_MS) || 600_000;
  let resp: Response;
  try {
    resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        image_base64: base64,
        token: process.env.SYNTHID_SERVICE_TOKEN ?? undefined,
        vendor,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err: any) {
    const reason = err?.name === "TimeoutError" ? "timed out" : err?.message || "request failed";
    throw new SynthIDServiceError(`GPU service ${reason}.`);
  }

  if (!resp.ok) {
    let detail = `${resp.status}`;
    try {
      const body = (await resp.json()) as { detail?: string; error?: string };
      detail = body.detail || body.error || detail;
    } catch {
      /* non-JSON error body */
    }
    throw new SynthIDServiceError(`GPU service error: ${detail}`);
  }

  const data = (await resp.json()) as Partial<InvisibleRemovalResult> & { image_base64?: string };
  if (!data.image_base64) {
    throw new SynthIDServiceError("GPU service returned no image.");
  }
  return {
    base64: data.image_base64,
    width: data.width ?? 0,
    height: data.height ?? 0,
    method: data.method ?? "diffusion",
  };
}
