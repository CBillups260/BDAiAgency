import { fal } from "@fal-ai/client";

/**
 * Topaz video enhancement on Fal — upscaling and frame interpolation.
 *
 * Two endpoints, because they price differently:
 *
 *   fal-ai/topaz/upscale/video   — upscales, and will interpolate in the same
 *                                  pass via `target_fps`. Billed per second of
 *                                  video by OUTPUT resolution, so it is the
 *                                  right call whenever the frame is growing:
 *                                  one pass, one bill, no generation loss from
 *                                  running two models back to back.
 *   topaz/interpolate/video      — interpolation only. Billed per NEWLY
 *                                  GENERATED frame, so a 30→60 pass at the
 *                                  source resolution costs a fraction of
 *                                  running the upscaler at 1x.
 *
 * Both are queued rather than awaited: a minute of 1080p footage can take
 * several minutes, which outruns both the Netlify proxy (26s) and the Cloud
 * Function ceiling (540s). The caller submits, gets a request id back, and
 * polls `enhanceStatus`.
 */

const UPSCALE_ENDPOINT = "fal-ai/topaz/upscale/video";
const INTERPOLATE_ENDPOINT = "topaz/interpolate/video";

/** Upscale models, in the order the UI lists them. */
export const UPSCALE_MODELS = [
  "Proteus",
  "Artemis HQ",
  "Artemis MQ",
  "Artemis LQ",
  "Gaia HQ",
  "Gaia CG",
  "Gaia 2",
  "Nyx",
  "Nyx Fast",
  "Starlight Precise 2.5",
  "Starlight Fast 2",
] as const;

/** Interpolation models — Apollo general, Chronos real-world, Aion extreme motion. */
export const INTERPOLATE_MODELS = ["Apollo", "Chronos", "Aion"] as const;

/**
 * Per-endpoint fps ceilings. The upscaler's schema caps interpolation at 60;
 * the dedicated interpolator goes to 120. Sending 120 to the upscaler is a
 * 422 from Fal, so clamp here rather than trusting the client.
 */
const FPS_BOUNDS = {
  [UPSCALE_ENDPOINT]: { min: 16, max: 60 },
  [INTERPOLATE_ENDPOINT]: { min: 16, max: 120 },
} as const;

let configured = false;
function ensureConfigured(): void {
  if (configured) return;
  const key = process.env.FAL_KEY;
  if (!key) throw new Error("FAL_KEY is not configured on the server.");
  fal.config({ credentials: key });
  configured = true;
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

export interface EnhanceVideoOptions {
  /** Publicly fetchable URL — Fal pulls the file itself, we never relay it. */
  videoUrl: string;
  /** 1 = don't resize. Up to 4x. */
  upscaleFactor: number;
  /** null = keep the source frame rate. */
  targetFps: number | null;
  /** A name from UPSCALE_MODELS or INTERPOLATE_MODELS, matching the chosen path. */
  model: string;
  /**
   * H.264 instead of Topaz's H.265 default. On by default everywhere we call
   * this: Chrome won't play H.265 in a <video> tag, so an H.265 result shows
   * the user a black box and most social uploaders reject it too.
   */
  h264: boolean;
}

/**
 * Pick the endpoint and build its input. Exported so the route can report the
 * endpoint back to the client, which has to pass it to the status poll (Fal's
 * queue API is per-endpoint — a request id alone isn't addressable).
 */
export function planEnhance(opts: EnhanceVideoOptions): {
  endpoint: string;
  input: Record<string, unknown>;
} {
  const factor = clamp(Number(opts.upscaleFactor) || 1, 1, 4);
  const wantsUpscale = factor > 1;
  const wantsFps = opts.targetFps != null && Number.isFinite(opts.targetFps);

  if (!wantsUpscale && !wantsFps) {
    throw new Error("Nothing to do — turn on upscaling, a higher frame rate, or both.");
  }

  const endpoint = wantsUpscale ? UPSCALE_ENDPOINT : INTERPOLATE_ENDPOINT;
  const bounds = FPS_BOUNDS[endpoint as keyof typeof FPS_BOUNDS];

  const input: Record<string, unknown> = {
    video_url: opts.videoUrl,
    model: opts.model,
    H264_output: opts.h264 !== false,
  };

  if (wantsUpscale) {
    input.upscale_factor = factor;
    // `target_fps` is what switches interpolation on inside the upscaler;
    // leaving it unset keeps the source frame rate.
    if (wantsFps) input.target_fps = Math.round(clamp(opts.targetFps as number, bounds.min, bounds.max));
  } else {
    input.target_fps = Math.round(clamp(opts.targetFps as number, bounds.min, bounds.max));
    // We expose retiming, not slow motion — 1 keeps the clip's real duration.
    input.slowdown_factor = 1;
  }

  return { endpoint, input };
}

/** Queue the job. Returns immediately with the id to poll. */
export async function submitEnhance(
  opts: EnhanceVideoOptions,
): Promise<{ requestId: string; endpoint: string }> {
  ensureConfigured();
  const { endpoint, input } = planEnhance(opts);

  try {
    const queued = await fal.queue.submit(endpoint, { input } as never);
    return { requestId: queued.request_id, endpoint };
  } catch (err) {
    const status = (err as { status?: number })?.status;
    const msg = String((err as { message?: string })?.message ?? "");
    if (status === 404 || /not found/i.test(msg)) {
      throw new Error(`This Topaz model isn't available on Fal right now (${endpoint}).`);
    }
    if (status === 422) {
      throw new Error(
        `Fal rejected those settings. Check the video URL is publicly reachable and the ` +
          `model matches the job (${endpoint}).`,
      );
    }
    throw err;
  }
}

export interface EnhanceStatus {
  /** IN_QUEUE | IN_PROGRESS | COMPLETED */
  status: string;
  queuePosition: number | null;
  /** Last few Topaz log lines, so the UI can show real progress not a spinner. */
  logs: string[];
  /** Set only once status is COMPLETED. */
  videoUrl: string | null;
}

/** Poll one queued job. */
export async function enhanceStatus(
  endpoint: string,
  requestId: string,
): Promise<EnhanceStatus> {
  ensureConfigured();

  const status = (await fal.queue.status(endpoint, {
    requestId,
    logs: true,
  })) as {
    status: string;
    queue_position?: number;
    logs?: { message?: string }[];
  };

  const logs = (status.logs ?? [])
    .map((l) => String(l?.message ?? "").trim())
    .filter(Boolean)
    .slice(-5);

  if (status.status !== "COMPLETED") {
    return {
      status: status.status,
      queuePosition: typeof status.queue_position === "number" ? status.queue_position : null,
      logs,
      videoUrl: null,
    };
  }

  const { data } = (await fal.queue.result(endpoint, { requestId })) as {
    data?: { video?: { url?: string } };
  };
  const videoUrl = data?.video?.url ?? null;
  if (!videoUrl) {
    throw new Error("Topaz finished but returned no video. Try again with a different model.");
  }

  return { status: "COMPLETED", queuePosition: null, logs, videoUrl };
}
