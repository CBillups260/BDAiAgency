import { Router } from "express";
import {
  searchBusiness,
  searchNearby,
  findFacebookUrl,
  enrichFromFacebook,
  analyzeProspect,
  generateOutreachSequence,
  findOwnerName,
} from "../services/prospectingService.js";
import {
  getAuthUrl,
  handleCallback,
  getConnectionStatus,
  sendEmail,
} from "../services/gmailService.js";

const router = Router();

// ─── Search Business (SerpAPI / Google Places) ───────────

router.post("/search", async (req, res) => {
  try {
    const { businessName, location } = req.body as {
      businessName?: string;
      location?: string;
    };
    if (!businessName?.trim()) {
      return res.status(400).json({ error: "Business name is required." });
    }

    const results = await searchBusiness(businessName.trim(), location?.trim());
    res.json({ results });
  } catch (err: any) {
    console.error("Prospecting search error:", err?.message || err);
    res.status(500).json({ error: err?.message || "Search failed." });
  }
});

// ─── Nearby Business Discovery ───────────────────────────

router.post("/nearby", async (req, res) => {
  try {
    const { lat, lng, radius, type, keyword } = req.body as {
      lat?: number;
      lng?: number;
      radius?: number;
      type?: string;
      keyword?: string;
    };
    if (lat == null || lng == null) {
      return res.status(400).json({ error: "lat and lng are required." });
    }
    const results = await searchNearby(lat, lng, radius, type, keyword);
    res.json({ results });
  } catch (err: any) {
    console.error("Nearby search error:", err?.message || err);
    res.status(500).json({ error: err?.message || "Nearby search failed." });
  }
});

// ─── Find Facebook URL (ScrapeCreator Google Search) ─────

router.post("/find-facebook", async (req, res) => {
  try {
    const { businessName, location } = req.body as {
      businessName?: string;
      location?: string;
    };
    if (!businessName?.trim()) {
      return res.status(400).json({ error: "Business name is required." });
    }

    const facebookUrl = await findFacebookUrl(businessName.trim(), location?.trim());
    res.json({ facebookUrl });
  } catch (err: any) {
    console.error("Facebook URL lookup error:", err?.message || err);
    res.status(500).json({ error: err?.message || "Facebook lookup failed." });
  }
});

// ─── Enrich via Facebook (ScrapeCreator) ─────────────────

router.post("/enrich", async (req, res) => {
  try {
    const { facebookUrl } = req.body as { facebookUrl?: string };
    if (!facebookUrl?.trim()) {
      return res.status(400).json({ error: "Facebook URL is required." });
    }

    const data = await enrichFromFacebook(facebookUrl.trim());
    res.json(data);
  } catch (err: any) {
    console.error("Facebook enrichment error:", err?.message || err);
    res.status(500).json({ error: err?.message || "Enrichment failed." });
  }
});

// ─── AI Draft Email/DM Sequence (Gemini Flash) ──────────

router.post("/draft-emails", async (req, res) => {
  try {
    const { prospect, serviceName, serviceDescription, sender } = req.body as {
      prospect?: {
        businessName: string;
        email: string;
        category: string;
        address: string;
        website: string;
        pageIntro: string;
        recentPosts: { text: string; date: string }[];
        googleRating: number | null;
        googleReviewCount: number | null;
        followerCount: number;
        prospectLat: number | null;
        prospectLng: number | null;
      };
      serviceName?: string;
      serviceDescription?: string;
      sender?: {
        userName?: string;
        userEmail?: string;
        agencyName?: string;
        agencyDescription?: string;
        agencyWebsite?: string;
        agencyEmail?: string;
        agencyPhone?: string;
        ownerName?: string;
        ownerTitle?: string;
        brandVoice?: string;
        valuePropositions?: string[];
        caseStudies?: string;
        signOffName?: string;
        agencyLat?: number;
        agencyLng?: number;
        localRadiusMiles?: number;
      };
    };

    if (!prospect || !serviceName) {
      return res
        .status(400)
        .json({ error: "Prospect data and service name are required." });
    }

    const analysis = analyzeProspect({
      website: prospect.website,
      email: prospect.email,
      phone: "",
      googleRating: prospect.googleRating ?? null,
      googleReviewCount: prospect.googleReviewCount ?? null,
      followerCount: prospect.followerCount || 0,
      recentPosts: prospect.recentPosts || [],
      prospectLat: prospect.prospectLat ?? null,
      prospectLng: prospect.prospectLng ?? null,
      agencyLat: sender?.agencyLat || 0,
      agencyLng: sender?.agencyLng || 0,
      localRadiusMiles: sender?.localRadiusMiles || 40,
    });

    const ownerName = await findOwnerName(
      prospect.businessName,
      prospect.address,
      prospect.pageIntro || "",
      prospect.website || ""
    );

    const drafts = await generateOutreachSequence(
      prospect,
      { name: serviceName, description: serviceDescription || "" },
      analysis,
      sender,
      ownerName
    );

    res.json({ drafts });
  } catch (err: any) {
    console.error("Outreach drafting error:", err?.message || err);
    res.status(500).json({ error: err?.message || "Failed to draft outreach." });
  }
});

// ─── Gmail OAuth2: Auth URL ──────────────────────────────

router.get("/gmail/auth-url", async (_req, res) => {
  try {
    const url = getAuthUrl();
    res.json({ url });
  } catch (err: any) {
    console.error("Gmail auth URL error:", err?.message || err);
    res.status(500).json({ error: err?.message || "Failed to generate auth URL." });
  }
});

// ─── Gmail OAuth2: Callback ─────────────────────────────

router.get("/gmail/callback", async (req, res) => {
  try {
    const code = req.query.code as string;
    if (!code) {
      return res.status(400).send("Missing authorization code.");
    }

    const { email } = await handleCallback(code);

    // Redirect back to the app with success
    const redirectUrl = process.env.NODE_ENV === "production"
      ? "/"
      : "http://localhost:3000";
    res.redirect(`${redirectUrl}?gmail_connected=true&gmail_email=${encodeURIComponent(email)}`);
  } catch (err: any) {
    console.error("Gmail callback error:", err?.message || err);
    res.status(500).send(`Gmail connection failed: ${err?.message}`);
  }
});

// ─── Gmail: Send Email ──────────────────────────────────

router.post("/gmail/send", async (req, res) => {
  try {
    const { to, subject, body } = req.body as {
      to?: string;
      subject?: string;
      body?: string;
    };

    if (!to || !subject || !body) {
      return res.status(400).json({ error: "to, subject, and body are required." });
    }

    const result = await sendEmail(to, subject, body);
    res.json(result);
  } catch (err: any) {
    console.error("Gmail send error:", err?.message || err);
    res.status(500).json({ error: err?.message || "Failed to send email." });
  }
});

// ─── Gmail: Connection Status ───────────────────────────

router.get("/gmail/status", async (_req, res) => {
  try {
    const status = await getConnectionStatus();
    res.json(status);
  } catch (err: any) {
    console.error("Gmail status error:", err?.message || err);
    res.status(500).json({ error: err?.message || "Failed to check Gmail status." });
  }
});

export default router;
