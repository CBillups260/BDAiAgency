/**
 * yt-dlp wrapper — the YouTube half of the reel extractor.
 *
 * Why this exists: ScrapeCreators powers Facebook / Instagram / TikTok and has
 * a YouTube metadata endpoint, but it cannot hand us the actual file. Its
 * `downloadOptions.formats` is usually empty, and on the rare video where it is
 * populated the googlevideo URL is IP-locked to ScrapeCreators' own fetcher
 * (403 from anywhere else). Their `/v1/youtube/video/download` route returns a
 * 500 on every video tried. So the bytes come from yt-dlp instead, the same way
 * the video brander leans on a bundled ffmpeg binary.
 *
 * The binary ships with the `youtube-dl-exec` package. It is a Python zipapp,
 * so the host needs python3 >= 3.10 on PATH; `ytDlpUnavailableReason()` turns a
 * missing/old interpreter into a message the UI can show instead of a stack
 * trace.
 */
import { spawn } from "child_process";
import path from "path";
import { createRequire } from "module";
import ffmpegStatic from "ffmpeg-static";

const ffmpegPath: string | null = ffmpegStatic as unknown as string | null;

/**
 * Pick a yt-dlp to run, most specific first:
 *   1. YTDLP_PATH — an explicit override.
 *   2. A `yt-dlp` already on PATH. Standalone installs (uv, brew, pipx) bring
 *      their own interpreter, so they work on hosts whose system python is too
 *      old for the zipapp — which is the usual case on macOS.
 *   3. The zipapp bundled with `youtube-dl-exec`, which is what deploys with
 *      the function.
 * Resolution is cached after the first successful probe.
 */
interface YtCommand {
  bin: string;
  /** Args that go before yt-dlp's own, e.g. the zipapp path for an interpreter. */
  prefix: string[];
}

let resolved: YtCommand | null = null;

function bundledPath(): string {
  // These functions are ESM, so `require` doesn't exist — build one to resolve
  // the package directory.
  const req = createRequire(import.meta.url);
  return path.join(path.dirname(req.resolve("youtube-dl-exec/package.json")), "bin", "yt-dlp");
}

/**
 * Interpreters to try the bundled zipapp with. Its shebang is `env python3`,
 * which on macOS is usually the system 3.9 — too old for yt-dlp — while a
 * usable 3.13 sits beside it under a versioned name. Naming them explicitly
 * avoids asking anyone to repoint their default python3.
 */
const PYTHONS = ["python3.13", "python3.12", "python3.11", "python3.10", "python3"];

function candidates(): YtCommand[] {
  const list: YtCommand[] = [];
  if (process.env.YTDLP_PATH) list.push({ bin: process.env.YTDLP_PATH, prefix: [] });
  // A standalone install (uv, brew, pipx) carries its own interpreter.
  list.push({ bin: "yt-dlp", prefix: [] });
  try {
    const zipapp = bundledPath();
    // Direct first: on hosts whose python3 is modern (Cloud Functions), the
    // shebang alone is enough.
    list.push({ bin: zipapp, prefix: [] });
    for (const py of PYTHONS) list.push({ bin: py, prefix: [zipapp] });
  } catch {
    /* package not installed — a PATH yt-dlp may still exist */
  }
  return list;
}

async function ytDlpCommand(): Promise<YtCommand> {
  if (resolved) return resolved;
  const errors: string[] = [];
  for (const cmd of candidates()) {
    try {
      await run(cmd.bin, [...cmd.prefix, "--version"], 15_000);
      resolved = cmd;
      return cmd;
    } catch (err: any) {
      const msg = String(err?.message || "failed");
      // ENOENT just means "not installed under that name" — not worth surfacing.
      if (!/ENOENT/.test(msg)) errors.push(msg);
    }
  }
  throw new Error(
    errors[errors.length - 1] ||
      "yt-dlp isn't available on this server. Install it (macOS: `uv tool install yt-dlp` " +
        "or `brew install yt-dlp`) and retry — YouTube needs it for the video file.",
  );
}

export interface YtFormat {
  /** Vertical resolution, e.g. 1080. Null for audio-only rows (filtered out). */
  height: number | null;
  ext: string;
  /** Approximate size in bytes when yt-dlp reports one. */
  filesize: number | null;
}

export interface YtProbe {
  id: string;
  title: string;
  description: string;
  durationSeconds: number | null;
  width: number | null;
  height: number | null;
  thumbnail: string | null;
  uploader: string | null;
  viewCount: number;
  likeCount: number;
  /** Distinct progressive heights we can actually deliver, highest first. */
  heights: number[];
}

function run(
  bin: string,
  args: string[],
  timeoutMs: number,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
      reject(new Error("yt-dlp timed out."));
    }, timeoutMs);
    proc.stdout?.on("data", (d: Buffer) => {
      stdout += d.toString();
    });
    proc.stderr?.on("data", (d: Buffer) => {
      stderr += d.toString();
      if (stderr.length > 8000) stderr = stderr.slice(-8000);
    });
    proc.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    proc.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(friendlyError(stderr) || `yt-dlp exited ${code}`));
    });
  });
}

/**
 * Map yt-dlp's noisier failures onto something a user can act on. Anything
 * unrecognized falls through to the raw tail of stderr.
 */
function friendlyError(stderr: string): string | null {
  if (/unsupported version of Python|Only Python versions 3\.10/i.test(stderr)) {
    return (
      "YouTube downloading needs python3 3.10 or newer on the server. " +
      "Install it (on macOS: `brew install python@3.13`) and retry."
    );
  }
  if (/env: python3: No such file|command not found/i.test(stderr)) {
    return "YouTube downloading needs python3 installed on the server.";
  }
  if (/Sign in to confirm|not a bot|cookies/i.test(stderr)) {
    return (
      "YouTube blocked this request as automated traffic. This usually happens " +
      "from datacenter IPs — it generally works when the server runs locally."
    );
  }
  if (/Private video|members-only|Join this channel/i.test(stderr)) {
    return "That video is private or members-only, so it can't be extracted.";
  }
  if (/Video unavailable|has been removed|does not exist/i.test(stderr)) {
    return "That video is unavailable — it may have been removed or made private.";
  }
  if (/age|confirm your age/i.test(stderr)) {
    return "That video is age-restricted, which blocks automated extraction.";
  }
  const tail = stderr.trim().split("\n").filter(Boolean).pop();
  return tail ? tail.slice(0, 300) : null;
}

/**
 * Cheap preflight: is the bundled yt-dlp actually runnable here? Returns null
 * when it is, or a user-facing reason when it is not. Called by /extract so a
 * broken host degrades to "metadata only" instead of failing the whole request.
 */
export async function ytDlpUnavailableReason(): Promise<string | null> {
  try {
    await ytDlpCommand();
    return null;
  } catch (err: any) {
    return err?.message || "yt-dlp is not available on this server.";
  }
}

/** Read a video's metadata and the progressive heights we can deliver. */
export async function ytProbe(url: string): Promise<YtProbe> {
  const cmd = await ytDlpCommand();
  const { stdout } = await run(
    cmd.bin,
    [...cmd.prefix, "--no-warnings", "--no-playlist", "--dump-single-json", url],
    90_000,
  );
  const d = JSON.parse(stdout);

  const formats: YtFormat[] = (d.formats || [])
    .filter((f: any) => f.vcodec && f.vcodec !== "none" && Number(f.height) > 0)
    .map((f: any) => ({
      height: Number(f.height),
      ext: String(f.ext || "mp4"),
      filesize: Number(f.filesize || f.filesize_approx) || null,
    }));

  const heights = [...new Set(formats.map((f) => f.height as number))].sort((a, b) => b - a);

  return {
    id: String(d.id || ""),
    title: String(d.title || ""),
    description: String(d.description || ""),
    durationSeconds: Number.isFinite(Number(d.duration)) ? Number(d.duration) : null,
    width: Number(d.width) || null,
    height: Number(d.height) || null,
    thumbnail: d.thumbnail || null,
    uploader: d.uploader || d.channel || null,
    viewCount: Number(d.view_count) || 0,
    likeCount: Number(d.like_count) || 0,
    heights,
  };
}

/**
 * Download one video to `outPath` as an MP4, capped at `maxHeight` (0 = best
 * available). Prefers a progressive MP4, falling back to merging the best video
 * and audio streams — which needs ffmpeg, so we hand yt-dlp the bundled binary
 * rather than hoping for one on PATH.
 */
export async function ytDownload(
  url: string,
  outPath: string,
  maxHeight: number,
): Promise<void> {
  const cap = maxHeight > 0 ? `[height<=${maxHeight}]` : "";
  const format =
    `bv*${cap}[ext=mp4]+ba[ext=m4a]/b${cap}[ext=mp4]/bv*${cap}+ba/b${cap}/best`;

  const args = [
    "--no-warnings",
    "--no-playlist",
    "--no-part",
    "--retries", "3",
    "--socket-timeout", "30",
    "-f", format,
    "--merge-output-format", "mp4",
    "-o", outPath,
  ];
  if (ffmpegPath) args.push("--ffmpeg-location", ffmpegPath);
  args.push(url);

  const cmd = await ytDlpCommand();
  await run(cmd.bin, [...cmd.prefix, ...args], 10 * 60_000);
}
