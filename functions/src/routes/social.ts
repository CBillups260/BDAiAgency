import { Router } from "express";
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import ffmpegStatic from "ffmpeg-static";

const router = Router();

// ffmpeg-static's default export is the absolute path to the bundled binary at
// runtime; its bundled types mis-describe it, so normalize to a string here.
const ffmpegPath: string | null = ffmpegStatic as unknown as string | null;

const SC_BASE = "https://api.scrapecreators.com";
const scKey = () => process.env.SCRAPECREATORS_API_KEY || "";

async function scFetch(path: string) {
  const res = await fetch(`${SC_BASE}${path}`, {
    headers: { "x-api-key": scKey() },
  });
  const data = await res.json();
  if (!data.success && data.message) throw new Error(data.message);
  return data;
}

// Normalize post data across platforms
interface NormalizedPost {
  id: string;
  platform: string;
  type: string; // post, reel, video, tweet
  text: string;
  media: string | null; // thumbnail/image URL
  likes: number;
  comments: number;
  shares: number;
  views: number;
  date: string;
  url: string;
  engagement: number; // calculated engagement rate
}

// ─── Instagram ───────────────────────────────────────────

router.get("/instagram/:username", async (req, res) => {
  try {
    const { username } = req.params;
    const data = await scFetch(`/v2/instagram/user/posts?handle=${encodeURIComponent(username)}`);

    const items = data.items || data.data?.items || [];
    const posts: NormalizedPost[] = items.map((p: any) => {
      const captionText = typeof p.caption === "object" ? p.caption?.text || "" : p.caption || "";
      return {
        id: p.id || p.pk || String(Math.random()),
        platform: "instagram",
        type: p.media_type === 2 ? "video" : p.media_type === 8 ? "carousel" : p.product_type === "clips" ? "reel" : "post",
        text: captionText,
        media: p.image_versions2?.candidates?.[0]?.url || p.display_uri || p.thumbnail_url || null,
        likes: p.like_count || 0,
        comments: p.comment_count || 0,
        shares: 0,
        views: p.view_count || p.play_count || 0,
        date: p.taken_at ? new Date(p.taken_at * 1000).toISOString() : "",
        url: p.url || (p.code ? `https://www.instagram.com/p/${p.code}/` : ""),
        engagement: 0,
      };
    });

    const followerCount = data.user?.follower_count || 1;
    posts.forEach(p => {
      p.engagement = followerCount > 0
        ? parseFloat((((p.likes + p.comments + p.shares) / followerCount) * 100).toFixed(2))
        : 0;
    });

    res.json({
      platform: "instagram",
      username,
      followerCount,
      posts,
    });
  } catch (err: any) {
    console.error("Instagram scrape error:", err?.message);
    res.status(500).json({ error: err?.message || "Failed to fetch Instagram posts." });
  }
});

// ─── Facebook ────────────────────────────────────────────

router.get("/facebook/:username", async (req, res) => {
  try {
    const { username } = req.params;
    const fbUrl = encodeURIComponent(`https://www.facebook.com/${username}`);
    const data = await scFetch(`/v1/facebook/profile/posts?url=${fbUrl}`);

    const posts: NormalizedPost[] = (data.posts || []).map((p: any) => ({
      id: p.id || String(Math.random()),
      platform: "facebook",
      type: p.videoDetails ? "video" : "post",
      text: p.text || "",
      media: p.image || null,
      likes: p.reactionCount || 0,
      comments: p.commentCount || 0,
      shares: p.shareCount || 0,
      views: p.videoViewCount || 0,
      date: p.publishTime || "",
      url: p.url || p.permalink || "",
      engagement: 0,
    }));

    res.json({ platform: "facebook", username, posts });
  } catch (err: any) {
    console.error("Facebook scrape error:", err?.message);
    res.status(500).json({ error: err?.message || "Failed to fetch Facebook posts." });
  }
});

// ─── TikTok ──────────────────────────────────────────────

router.get("/tiktok/:username", async (req, res) => {
  try {
    const { username } = req.params;
    const data = await scFetch(`/v3/tiktok/profile/videos?handle=${encodeURIComponent(username)}`);

    const posts: NormalizedPost[] = (data.data?.videos || data.videos || data.data || []).map((v: any) => ({
      id: v.id || v.video_id || String(Math.random()),
      platform: "tiktok",
      type: "video",
      text: v.title || v.desc || v.description || "",
      media: v.cover || v.origin_cover || v.thumbnail || null,
      likes: v.digg_count || v.likes || v.like_count || 0,
      comments: v.comment_count || v.comments || 0,
      shares: v.share_count || v.shares || 0,
      views: v.play_count || v.views || v.view_count || 0,
      date: v.create_time ? new Date(v.create_time * 1000).toISOString() : v.createTime || "",
      url: v.url || (v.id ? `https://www.tiktok.com/@${username}/video/${v.id}` : ""),
      engagement: 0,
    }));

    const followerCount = data.data?.user?.follower_count || data.follower_count || 1;
    posts.forEach(p => {
      p.engagement = followerCount > 0
        ? parseFloat((((p.likes + p.comments + p.shares) / followerCount) * 100).toFixed(2))
        : 0;
    });

    res.json({ platform: "tiktok", username, followerCount, posts });
  } catch (err: any) {
    console.error("TikTok scrape error:", err?.message);
    res.status(500).json({ error: err?.message || "Failed to fetch TikTok posts." });
  }
});

// ─── Twitter / X ─────────────────────────────────────────

router.get("/twitter/:username", async (req, res) => {
  try {
    const { username } = req.params;
    const data = await scFetch(`/v1/twitter/user-tweets?handle=${encodeURIComponent(username)}`);

    const posts: NormalizedPost[] = (data.data?.tweets || data.tweets || data.data || []).map((t: any) => ({
      id: t.id || t.tweet_id || String(Math.random()),
      platform: "twitter",
      type: t.type || "tweet",
      text: t.text || t.full_text || t.content || "",
      media: t.media?.[0]?.media_url_https || t.media?.[0]?.url || t.image || null,
      likes: t.favorite_count || t.likes || t.like_count || 0,
      comments: t.reply_count || t.replies || t.comments || 0,
      shares: t.retweet_count || t.retweets || t.shares || 0,
      views: t.views || t.view_count || t.impression_count || 0,
      date: t.created_at || t.timestamp || "",
      url: t.url || (t.id ? `https://x.com/${username}/status/${t.id}` : ""),
      engagement: 0,
    }));

    res.json({ platform: "twitter", username, posts });
  } catch (err: any) {
    console.error("Twitter scrape error:", err?.message);
    res.status(500).json({ error: err?.message || "Failed to fetch tweets." });
  }
});

// ─── Universal Reel / Video Extractor ────────────────────
//
// Paste any Facebook, Instagram, or TikTok video/reel URL. We detect the
// platform from the hostname (no LLM needed) and hit the matching
// ScrapeCreators "single post/reel by URL" endpoint, then normalize the
// response down to the bits the UI cares about: a caption, a thumbnail, some
// stats, and one or more downloadable MP4 URLs.

type ExtractPlatform = "facebook" | "instagram" | "tiktok";

interface ExtractDownload {
  quality: string; // "HD", "SD", "No watermark", "Original", ...
  url: string;
  recommended?: boolean;
}

interface ExtractResult {
  platform: ExtractPlatform;
  sourceUrl: string;
  caption: string;
  thumbnail: string | null;
  author: string | null;
  views: number;
  likes: number;
  width: number | null; // native video pixel width, when the API reports it
  height: number | null; // native video pixel height
  downloads: ExtractDownload[];
}

/**
 * Return the first valid [width, height] pair from a list of candidates.
 * Different platforms (and even different responses from the same platform)
 * expose dimensions under different keys, so we probe several and take the
 * first positive, finite pair. Returns nulls when nothing usable is found —
 * the frontend then falls back to measuring the thumbnail.
 */
function pickDims(...pairs: Array<[unknown, unknown]>): { width: number | null; height: number | null } {
  for (const [w, h] of pairs) {
    const nw = Number(w);
    const nh = Number(h);
    if (Number.isFinite(nw) && Number.isFinite(nh) && nw > 0 && nh > 0) {
      return { width: Math.round(nw), height: Math.round(nh) };
    }
  }
  return { width: null, height: null };
}

/** Detect platform from the URL's hostname. Returns null if unsupported. */
function detectPlatform(rawUrl: string): ExtractPlatform | null {
  let host = "";
  try {
    host = new URL(rawUrl).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
  if (host === "tiktok.com" || host.endsWith(".tiktok.com")) return "tiktok"; // incl. vm./vt.
  if (host === "instagram.com" || host.endsWith(".instagram.com") || host === "instagr.am") return "instagram";
  if (host === "facebook.com" || host.endsWith(".facebook.com") || host === "fb.watch" || host === "fb.me") return "facebook";
  return null;
}

// Query params that are pure tracking / share cruft. Stripping them turns a
// messy "Copy link" URL into the canonical one ScrapeCreators expects. We keep
// functional params (e.g. ?v= on /watch/) by only removing this known set plus
// any Facebook __cft__ / __tn__ style keys.
const TRACKING_PARAMS = new Set([
  "mibextid", "rdid", "_rdc", "_rdr", "fs", "ref", "refsrc", "hrc", "paipv",
  "comment_id", "reply_comment_id", "notif_id", "notif_t",
  "igsh", "igshid", "img_index", // instagram
  "is_from_webapp", "sender_device", "web_id", "_r", "_t", // tiktok
  "utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term",
]);

function cleanUrl(raw: string): string {
  try {
    const u = new URL(raw.trim());
    for (const key of [...u.searchParams.keys()]) {
      if (TRACKING_PARAMS.has(key) || key.startsWith("__")) u.searchParams.delete(key);
    }
    return u.toString();
  } catch {
    return raw.trim();
  }
}

/**
 * Status-based ScrapeCreators GET. Unlike `scFetch`, this does NOT throw merely
 * because the JSON contains a `message` field — Facebook stores post text in a
 * field literally named `message`, which would otherwise blow up valid
 * responses. It DOES throw on a non-2xx status or an explicit `error` field
 * (ScrapeCreators sometimes returns `success: true` alongside `error:
 * "not_found"`). The thrown Error carries `upstreamStatus`/`upstreamError` so
 * the route can map it to a friendly message.
 */
async function scGet(path: string): Promise<any> {
  const r = await fetch(`${SC_BASE}${path}`, { headers: { "x-api-key": scKey() } });
  const text = await r.text().catch(() => "");
  let body: any = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { _raw: text };
  }
  if (!r.ok || (body && typeof body.error === "string" && body.error)) {
    const err: any = new Error(body?.message || body?.error || `ScrapeCreators request failed (HTTP ${r.status}).`);
    err.upstreamStatus = r.status;
    err.upstreamError = body?.error || null;
    throw err;
  }
  return body;
}

router.get("/extract", async (req, res) => {
  try {
    if (!scKey()) {
      return res.status(400).json({ error: "SCRAPECREATORS_API_KEY is not configured." });
    }
    const url = ((req.query.url as string) || "").trim();
    if (!url) return res.status(400).json({ error: "url param required" });

    const platform = detectPlatform(url);
    if (!platform) {
      return res.status(400).json({
        error: "Unrecognized link. Paste a Facebook, Instagram, or TikTok video / reel URL.",
      });
    }

    const cleaned = cleanUrl(url);
    let result: ExtractResult;

    if (platform === "facebook") {
      const data = await scGet(`/v1/facebook/post?url=${encodeURIComponent(cleaned)}`);
      const v = data.video || {};
      const downloads: ExtractDownload[] = [];
      if (v.hd_url) downloads.push({ quality: "HD", url: v.hd_url, recommended: true });
      if (v.sd_url) downloads.push({ quality: "SD", url: v.sd_url, recommended: !v.hd_url });
      const { width, height } = pickDims(
        [v.width, v.height],
        [data.width, data.height],
        [data.videoDetails?.width, data.videoDetails?.height],
      );
      result = {
        platform,
        sourceUrl: url,
        caption: data.description || data.text || data.message || "",
        thumbnail: v.thumbnail || data.image_url || data.image || null,
        author: data.author?.name || data.pageName || null,
        views: data.view_count || data.videoViewCount || 0,
        likes: data.like_count || data.reactionCount || 0,
        width,
        height,
        downloads,
      };
    } else if (platform === "instagram") {
      const data = await scGet(`/v1/instagram/post?url=${encodeURIComponent(cleaned)}`);
      const media = data.data?.xdt_shortcode_media || data.xdt_shortcode_media || {};
      const downloads: ExtractDownload[] = [];
      if (media.video_url) downloads.push({ quality: "Original", url: media.video_url, recommended: true });
      const { width, height } = pickDims(
        [media.dimensions?.width, media.dimensions?.height],
        [media.original_width, media.original_height],
      );
      result = {
        platform,
        sourceUrl: url,
        caption: media.edge_media_to_caption?.edges?.[0]?.node?.text || "",
        thumbnail: media.thumbnail_src || media.display_url || null,
        author: media.owner?.username || null,
        views: media.video_view_count || media.video_play_count || 0,
        likes: media.edge_media_preview_like?.count || media.edge_liked_by?.count || 0,
        width,
        height,
        downloads,
      };
    } else {
      const data = await scGet(`/v2/tiktok/video?url=${encodeURIComponent(cleaned)}`);
      const detail = data.aweme_detail || {};
      const video = detail.video || {};
      const noWm = video.download_no_watermark_addr?.url_list?.[0];
      const play = video.play_addr?.url_list?.[0];
      const downloads: ExtractDownload[] = [];
      if (noWm) downloads.push({ quality: "No watermark", url: noWm, recommended: true });
      if (play && play !== noWm) {
        downloads.push({ quality: video.has_watermark ? "With watermark" : "Original", url: play, recommended: !noWm });
      }
      const { width, height } = pickDims(
        [video.width, video.height],
        [video.play_addr?.width, video.play_addr?.height],
        [video.download_addr?.width, video.download_addr?.height],
        [video.origin_cover?.width, video.origin_cover?.height],
      );
      result = {
        platform,
        sourceUrl: url,
        caption: detail.desc || "",
        thumbnail: video.cover?.url_list?.[0] || video.origin_cover?.url_list?.[0] || null,
        author: detail.author?.unique_id || detail.author?.nickname || null,
        views: detail.statistics?.play_count || 0,
        likes: detail.statistics?.digg_count || 0,
        width,
        height,
        downloads,
      };
    }

    if (!result.downloads.length) {
      return res.status(404).json({
        error: "No downloadable video found for that link. It may be a photo post, private, or removed.",
      });
    }

    res.json(result);
  } catch (err: any) {
    console.error("Reel extract error:", err?.message);
    const code = err?.upstreamError;
    const status = err?.upstreamStatus;
    const looksMissing =
      code === "not_found" ||
      status === 404 ||
      /behind the login|does[n']?t exist|not found|private|log ?in/i.test(String(err?.message || ""));
    if (looksMissing) {
      return res.status(404).json({
        error:
          "Couldn't access that post. It has to be public (not private or login-only) and a direct video/reel link. " +
          "Tip: open the reel, tap Share → Copy link, and paste that — e.g. https://www.facebook.com/reel/<id>.",
      });
    }
    res.status(502).json({ error: err?.message || "Failed to extract video." });
  }
});

// CDN hosts we'll proxy a download from. Keeps /download from being an open proxy.
const DOWNLOAD_HOST_ALLOW = [
  "fbcdn.net",
  "facebook.com",
  "cdninstagram.com",
  "instagram.com",
  "tiktokcdn.com",
  "tiktokcdn-us.com",
  "tiktokv.com",
  "muscdn.com",
  "byteicdn.com",
  "ibyteimg.com",
  "akamaized.net",
];

/**
 * Force-download proxy. Browsers ignore the `download` attribute on cross-origin
 * CDN links (they navigate/stream instead), so we fetch the MP4 server-side and
 * hand it back with Content-Disposition: attachment. The frontend calls this via
 * authedFetch and saves the resulting blob. Reels are short, so buffering (like
 * the existing image-proxy) is fine.
 */
router.get("/download", async (req, res) => {
  try {
    const url = ((req.query.url as string) || "").trim();
    const filename = ((req.query.filename as string) || "reel.mp4").replace(/[^a-zA-Z0-9._-]/g, "_");
    if (!url) return res.status(400).json({ error: "url param required" });

    let host = "";
    try {
      host = new URL(url).hostname.toLowerCase();
    } catch {
      return res.status(400).json({ error: "Invalid url." });
    }
    const allowed = DOWNLOAD_HOST_ALLOW.some((h) => host === h || host.endsWith("." + h));
    if (!allowed) return res.status(403).json({ error: "Host not allowed for download proxy." });

    const upstream = await fetch(url);
    if (!upstream.ok) return res.status(upstream.status).end();
    const buf = Buffer.from(await upstream.arrayBuffer());

    res.setHeader("Content-Type", upstream.headers.get("content-type") || "video/mp4");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Length", String(buf.length));
    res.send(buf);
  } catch (err: any) {
    console.error("Reel download proxy error:", err?.message);
    res.status(500).end();
  }
});

// ─── Video Branding (server-side ffmpeg overlay) ─────────
//
// Burns a small, subtle brand strip onto the actual reel. The frontend renders
// the strip as a transparent full-frame PNG (logo + "shop here" text at the
// bottom) and POSTs it here with the video URL. ffmpeg scales the overlay to
// the video and composites it for the full duration, keeping the original
// audio. Returns a post-ready MP4.

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!ffmpegPath) return reject(new Error("ffmpeg binary not available"));
    const proc = spawn(ffmpegPath, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    proc.stderr?.on("data", (d: Buffer) => {
      stderr += d.toString();
      if (stderr.length > 8000) stderr = stderr.slice(-8000);
    });
    proc.on("error", reject);
    proc.on("close", (code: number | null) =>
      code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-400)}`))
    );
  });
}

const MAX_VIDEO_BYTES = 120 * 1024 * 1024; // 120MB safety cap

/** Clamp to a sane even integer (libx264/yuv420p needs even dimensions). */
function evenClamp(n: unknown, fallback: number): number {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v) || v < 2 || v > 4096) return fallback;
  return v % 2 ? v - 1 : v;
}

router.post("/brand-video", async (req, res) => {
  const { videoUrl, overlayBase64, filename, overlayWidth, overlayHeight } = (req.body || {}) as {
    videoUrl?: string;
    overlayBase64?: string;
    filename?: string;
    overlayWidth?: number;
    overlayHeight?: number;
  };

  if (!videoUrl || !overlayBase64) {
    return res.status(400).json({ error: "videoUrl and overlayBase64 are required." });
  }

  // Target canvas = the overlay PNG's own dimensions (the frontend sizes it to
  // the reel's real aspect ratio). Falls back to 1080×1920 for older clients
  // that don't send dims, preserving the original 9:16 behavior.
  const targetW = evenClamp(overlayWidth, 1080);
  const targetH = evenClamp(overlayHeight, 1920);

  // Only proxy/download from known CDNs (same allowlist as /download).
  let host = "";
  try {
    host = new URL(videoUrl).hostname.toLowerCase();
  } catch {
    return res.status(400).json({ error: "Invalid videoUrl." });
  }
  if (!DOWNLOAD_HOST_ALLOW.some((h) => host === h || host.endsWith("." + h))) {
    return res.status(403).json({ error: "Video host not allowed." });
  }

  const dir = os.tmpdir();
  const id = randomUUID();
  const inPath = path.join(dir, `bdai-in-${id}.mp4`);
  const ovPath = path.join(dir, `bdai-ov-${id}.png`);
  const outPath = path.join(dir, `bdai-out-${id}.mp4`);
  const safeName = (filename || "branded-reel.mp4").replace(/[^a-zA-Z0-9._-]/g, "_");

  try {
    // 1. Download source video into /tmp.
    const upstream = await fetch(videoUrl);
    if (!upstream.ok) {
      return res.status(502).json({ error: `Could not fetch the source video (HTTP ${upstream.status}).` });
    }
    const buf = Buffer.from(await upstream.arrayBuffer());
    if (buf.length > MAX_VIDEO_BYTES) {
      return res.status(413).json({ error: "That video is too large to brand (over 120MB)." });
    }
    await fs.writeFile(inPath, buf);

    // 2. Write the overlay PNG.
    const pngB64 = overlayBase64.replace(/^data:image\/\w+;base64,/, "");
    await fs.writeFile(ovPath, Buffer.from(pngB64, "base64"));

    // 3. Composite: scale the video to the overlay's canvas (which matches the
    // reel's real aspect ratio, so padding is ~zero — no forced 9:16 bars),
    // scale the overlay to the exact same box so it aligns pixel-for-pixel,
    // then burn it in and keep the audio. Passing explicit dims to both scales
    // sidesteps scale2ref's alpha pitfalls on any aspect ratio.
    await runFfmpeg([
      "-y",
      "-i", inPath,
      "-i", ovPath,
      "-filter_complex",
      `[0:v]scale=${targetW}:${targetH}:force_original_aspect_ratio=decrease,` +
        `pad=${targetW}:${targetH}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1[v];` +
        `[1:v]scale=${targetW}:${targetH}[ov];` +
        `[v][ov]overlay=0:0:format=auto[outv]`,
      "-map", "[outv]",
      "-map", "0:a?",
      "-c:v", "libx264",
      "-preset", "veryfast",
      "-crf", "20",
      "-pix_fmt", "yuv420p",
      "-movflags", "+faststart",
      "-c:a", "aac",
      "-b:a", "128k",
      outPath,
    ]);

    // 4. Stream the branded MP4 back as a download.
    const out = await fs.readFile(outPath);
    res.setHeader("Content-Type", "video/mp4");
    res.setHeader("Content-Disposition", `attachment; filename="${safeName}"`);
    res.setHeader("Content-Length", String(out.length));
    res.send(out);
  } catch (err: any) {
    console.error("Brand video error:", err?.message);
    res.status(500).json({ error: err?.message || "Failed to brand the video." });
  } finally {
    await Promise.allSettled([fs.unlink(inPath), fs.unlink(ovPath), fs.unlink(outPath)]);
  }
});

export default router;
