import { Router } from "express";

const router = Router();

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

// ─── Multi-platform fetch ────────────────────────────────

router.post("/fetch-all", async (req, res) => {
  try {
    const { handles } = req.body as {
      handles: { platform: string; username: string }[];
    };

    if (!handles?.length) {
      return res.status(400).json({ error: "No social handles provided." });
    }

    const results: Record<string, any> = {};
    const errors: Record<string, string> = {};

    await Promise.allSettled(
      handles.map(async ({ platform, username }) => {
        try {
          const r = await fetch(`http://localhost:${process.env.PORT || 3001}/api/social/${platform}/${encodeURIComponent(username)}`, {
            headers: { "x-api-key": scKey() },
          });
          const data = await r.json();
          if (data.error) throw new Error(data.error);
          results[platform] = data;
        } catch (e: any) {
          errors[platform] = e.message;
        }
      })
    );

    res.json({ results, errors });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || "Failed to fetch social data." });
  }
});

export default router;
