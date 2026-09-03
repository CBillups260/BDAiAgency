import { Router } from "express";
import { GoogleGenAI } from "@google/genai";

const router = Router();

// Reuse the same Gemini client pattern as content.ts.
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// ─── Scrape Creators (Pinterest) ─────────────────────────
// Mirrors the helper in routes/social.ts.
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

/**
 * Shared error responder for the Gemini SDK, which wraps API errors as a JSON
 * string in `.message` (same handling as content.ts).
 */
function sendGeminiError(res: any, err: any, fallback: string) {
  console.error("Inspiration error:", err?.message || err);
  let userMessage = fallback;
  let statusCode = 500;
  if (err?.status && typeof err.status === "number") statusCode = err.status;
  if (err?.message) {
    try {
      userMessage = JSON.parse(err.message)?.error?.message || err.message;
    } catch {
      userMessage = err.message;
    }
  }
  res.status(statusCode).json({ error: userMessage });
}

// ─── POST /api/inspiration/ideas ─────────────────────────
// Day-of-week + brand aware post ideas. Each idea ships with an `imageQuery`
// the client can feed straight into Pinterest / review-photo search.
router.post("/ideas", async (req, res) => {
  try {
    const {
      brandContext,
      dayOfWeek,
      date,
      menuItems = [],
      themes = [],
      topic,
      count = 4,
    } = req.body as {
      brandContext?: {
        company: string;
        industry?: string | null;
        description?: string | null;
        brandVoice?: string | null;
        targetAudience?: string | null;
        website?: string | null;
      };
      dayOfWeek?: string;
      date?: string;
      menuItems?: { name: string; category?: string | null }[];
      themes?: { title: string; notes?: string | null }[];
      topic?: string;
      count?: number;
    };

    if (!brandContext?.company) {
      return res.status(400).json({ error: "brandContext.company is required." });
    }

    const n = Math.min(Math.max(Number(count) || 4, 1), 8);
    const brand = brandContext;

    const offerings = (menuItems || [])
      .map((m) => (m.category ? `${m.name} (${m.category})` : m.name))
      .filter(Boolean)
      .slice(0, 25);

    const themeLines = (themes || [])
      .map((t) => (t.notes ? `${t.title} — ${t.notes}` : t.title))
      .filter(Boolean);

    const prompt = `You are the creative director for ${brand.company}. Your job is to spark ideas for ONE social media post they could publish today.

BRAND:
- Company: ${brand.company}
- Industry: ${brand.industry || "N/A"}
- About: ${brand.description || "N/A"}
- Voice: ${brand.brandVoice || "Warm, fun, and authentic"}
- Audience: ${brand.targetAudience || "General local audience"}
- Website: ${brand.website || "N/A"}

TODAY: ${dayOfWeek || "today"}${date ? ` (${date})` : ""}
${themeLines.length ? `\nSCHEDULED THEMES FOR TODAY (lean into these — they are the client's recurring hooks):\n${themeLines.map((t) => `- ${t}`).join("\n")}` : ""}
${offerings.length ? `\nTHINGS THEY OFFER (feature real ones, don't invent):\n${offerings.map((o) => `- ${o}`).join("\n")}` : ""}
${topic?.trim() ? `\nEXTRA GUIDANCE FROM THE USER (must shape every idea): ${topic.trim()}` : ""}

YOUR JOB:
Generate ${n} distinct post ideas tailored to ${brand.company} AND to the fact that it's ${dayOfWeek || "today"}. Use the day meaningfully — weekend kickoff energy on Friday, fresh-start motivation on Monday, slower cozy vibes midweek, etc. Each idea must be specific and realistic for THIS business, not generic filler.

For EACH idea provide:
- "title": a short internal name for the idea (3-6 words)
- "hook": one scroll-stopping line that could open the caption
- "idea": 1-2 sentences describing what to actually post (the visual + the angle)
- "caption": a ready-to-use first-draft caption in the brand's voice
- "imageQuery": a concise visual search phrase (4-8 words) to find a reference photo for this post — describe the SHOT, e.g. "rustic plated lasagna overhead wooden table", not the brand name
- "hashtags": an array of 3-5 specific hashtags (no generic ones like #food #love)

FORMAT: Return ONLY a JSON array of exactly ${n} objects with those keys. No markdown, no commentary.`;

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: [{ role: "user", parts: [{ text: prompt }] }],
    });

    const text = response.text ?? "";
    let ideas: any[] = [];
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      try {
        ideas = JSON.parse(jsonMatch[0]);
      } catch {
        /* fall through */
      }
    }

    if (!Array.isArray(ideas) || !ideas.length) {
      return res.status(422).json({ error: "Failed to generate ideas. Try again." });
    }

    // Normalize so the client always gets the same shape.
    const normalized = ideas
      .filter((i) => i && (i.title || i.idea || i.hook))
      .map((i: any) => ({
        title: String(i.title || i.idea || "Post idea").slice(0, 120),
        hook: i.hook ? String(i.hook) : "",
        idea: i.idea ? String(i.idea) : "",
        caption: i.caption ? String(i.caption) : "",
        imageQuery: i.imageQuery ? String(i.imageQuery) : String(i.title || ""),
        hashtags: Array.isArray(i.hashtags) ? i.hashtags.map((h: any) => String(h)).slice(0, 6) : [],
      }))
      .slice(0, n);

    res.json({ ideas: normalized, dayOfWeek: dayOfWeek || null });
  } catch (err: any) {
    sendGeminiError(res, err, "Failed to generate inspiration ideas.");
  }
});

// ─── GET /api/inspiration/pinterest ──────────────────────
// Pinterest visual inspiration via Scrape Creators.
router.get("/pinterest", async (req, res) => {
  try {
    const query = String(req.query.query || "").trim();
    const cursor = String(req.query.cursor || "").trim();
    const limit = Math.min(parseInt(String(req.query.limit || "40"), 10) || 40, 50);
    if (!query) {
      return res.status(400).json({ error: "A query is required." });
    }
    if (!scKey()) {
      return res.status(400).json({ error: "SCRAPECREATORS_API_KEY is not configured." });
    }

    // `cursor` advances to the next page of results. Repeat searches pass the
    // previous cursor so we fetch FRESH pins instead of re-buying page one.
    let path = `/v1/pinterest/search?query=${encodeURIComponent(query)}&trim=true`;
    if (cursor) path += `&cursor=${encodeURIComponent(cursor)}`;

    const data = await scFetch(path);

    const pins = data.pins || data.data?.pins || data.data || [];
    const images = (Array.isArray(pins) ? pins : [])
      .map((p: any) => {
        const url =
          p.images?.orig?.url ||
          p.image?.orig?.url ||
          p.images?.["736x"]?.url ||
          p.image_large_url ||
          null;
        return {
          id: String(p.id || p.pin_id || url || Math.random()),
          url,
          title: p.title || p.grid_title || p.description || p.auto_alt_text || "",
          source: p.link || p.url || "",
          provider: "pinterest" as const,
        };
      })
      .filter((i: any) => !!i.url)
      .slice(0, limit);

    // Pinterest's pagination token — field name varies, so check the usual spots.
    const nextCursor =
      data.cursor || data.data?.cursor || data.bookmark || data.next_cursor || null;
    res.json({ images, query, cursor: nextCursor });
  } catch (err: any) {
    console.error("Pinterest search error:", err?.message || err);
    res.status(500).json({ error: err?.message || "Failed to search Pinterest." });
  }
});

// ─── POST /api/inspiration/review-photos ─────────────────
// Customer photos pulled from a brand's Google reviews. Resolves the brand to a
// Google Place (text search) when no placeId is supplied, then pulls reviewer
// photos via SerpAPI's google_maps_reviews engine.
router.post("/review-photos", async (req, res) => {
  try {
    const {
      query,
      placeId: placeIdIn,
      limit = 16,
    } = req.body as { query?: string; placeId?: string; limit?: number };

    const apiKey = process.env.GOOGLE_PLACES_API_KEY || process.env.GEMINI_API_KEY;
    let placeId = placeIdIn?.trim() || "";
    let placeName = "";

    if (!placeId) {
      if (!query?.trim()) {
        return res.status(400).json({ error: "A query or placeId is required." });
      }
      if (!apiKey) {
        return res.status(400).json({ error: "No Google API key configured." });
      }
      const searchUrl = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(
        query.trim()
      )}&key=${apiKey}`;
      const sResp = await fetch(searchUrl);
      const sData = await sResp.json();
      const top = (sData.results || [])[0];
      if (!top?.place_id) {
        return res.json({
          placeId: null,
          placeName: "",
          images: [],
          note: "No matching Google listing found for this brand.",
        });
      }
      placeId = top.place_id;
      placeName = top.name || "";
    }

    const serpKey = process.env.SERPAPI_KEY;
    if (!serpKey) {
      return res.json({
        placeId,
        placeName,
        images: [],
        note: "Review photos require SERPAPI_KEY.",
      });
    }

    const reviewsUrl = `https://serpapi.com/search.json?engine=google_maps_reviews&place_id=${encodeURIComponent(
      placeId
    )}&api_key=${serpKey}`;
    const rResp = await fetch(reviewsUrl);
    const rData = await rResp.json();

    if (rData.error) {
      console.error("SerpAPI error:", rData.error);
      return res.json({ placeId, placeName, images: [], note: "Could not load reviews." });
    }

    const max = Math.min(Number(limit) || 16, 30);
    const images: any[] = [];
    for (const r of rData.reviews || []) {
      for (const img of r.images || []) {
        if (typeof img !== "string") continue;
        images.push({
          id: `${placeId}-${images.length}`,
          url: img.replace(/=w\d+-h\d+/, "=w800-h800"),
          title: (r.snippet || r.text || "").slice(0, 120),
          source: r.link || "",
          reviewText: r.snippet || r.text || "",
          author: r.user?.name || "",
          rating: r.rating || null,
          provider: "google-reviews" as const,
        });
        if (images.length >= max) break;
      }
      if (images.length >= max) break;
    }

    res.json({
      placeId,
      placeName: placeName || rData.place_info?.title || "",
      images,
      ...(images.length ? {} : { note: "No customer photos found in recent reviews." }),
    });
  } catch (err: any) {
    console.error("Review photos error:", err?.message || err);
    res.status(500).json({ error: err?.message || "Failed to fetch review photos." });
  }
});

export default router;
