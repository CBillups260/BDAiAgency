import { Router } from "express";
import crypto from "crypto";

const router = Router();

const CANVA_CLIENT_ID = () => process.env.CANVA_CLIENT_ID || "";
const CANVA_CLIENT_SECRET = () => process.env.CANVA_CLIENT_SECRET || "";
const REDIRECT_URI = () => `${process.env.APP_URL || "http://localhost:3001"}/api/canva/callback`;

// In-memory token store (per session — in production use a DB)
const tokenStore: Record<string, { accessToken: string; refreshToken: string; expiresAt: number }> = {};
const pendingAuth: Record<string, { codeVerifier: string; state: string }> = {};

// ─── OAuth: Start ────────────────────────────────────────

router.get("/auth", (_req, res) => {
  if (!CANVA_CLIENT_ID()) {
    return res.status(400).json({ error: "CANVA_CLIENT_ID not configured." });
  }

  // PKCE
  const codeVerifier = crypto.randomBytes(32).toString("base64url");
  const codeChallenge = crypto.createHash("sha256").update(codeVerifier).digest("base64url");
  const state = crypto.randomBytes(16).toString("hex");

  pendingAuth[state] = { codeVerifier, state };

  const params = new URLSearchParams({
    response_type: "code",
    client_id: CANVA_CLIENT_ID(),
    redirect_uri: REDIRECT_URI(),
    scope: "asset:write asset:read design:content:write design:content:read",
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });

  res.json({ url: `https://www.canva.com/api/oauth/authorize?${params}` });
});

// ─── OAuth: Callback ─────────────────────────────────────

router.get("/callback", async (req, res) => {
  const { code, state } = req.query as { code?: string; state?: string };

  if (!code || !state || !pendingAuth[state]) {
    return res.status(400).send("Invalid OAuth callback.");
  }

  const { codeVerifier } = pendingAuth[state];
  delete pendingAuth[state];

  try {
    const tokenRes = await fetch("https://api.canva.com/rest/v1/oauth/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${Buffer.from(`${CANVA_CLIENT_ID()}:${CANVA_CLIENT_SECRET()}`).toString("base64")}`,
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: REDIRECT_URI(),
        code_verifier: codeVerifier,
      }),
    });

    const data = await tokenRes.json();

    if (data.error) {
      return res.status(400).send(`Canva auth failed: ${data.error_description || data.error}`);
    }

    tokenStore["default"] = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: Date.now() + (data.expires_in || 3600) * 1000,
    };

    // Redirect back to the app
    res.redirect(`${process.env.APP_URL || "http://localhost:3000"}?canva=connected`);
  } catch (err: any) {
    res.status(500).send(`Token exchange failed: ${err.message}`);
  }
});

// ─── Refresh token ───────────────────────────────────────

async function getValidToken(): Promise<string | null> {
  const stored = tokenStore["default"];
  if (!stored) return null;

  if (Date.now() < stored.expiresAt - 60000) {
    return stored.accessToken;
  }

  // Refresh
  try {
    const tokenRes = await fetch("https://api.canva.com/rest/v1/oauth/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${Buffer.from(`${CANVA_CLIENT_ID()}:${CANVA_CLIENT_SECRET()}`).toString("base64")}`,
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: stored.refreshToken,
      }),
    });

    const data = await tokenRes.json();
    if (data.access_token) {
      stored.accessToken = data.access_token;
      stored.refreshToken = data.refresh_token || stored.refreshToken;
      stored.expiresAt = Date.now() + (data.expires_in || 3600) * 1000;
      return stored.accessToken;
    }
  } catch {}

  return null;
}

// ─── Status ──────────────────────────────────────────────

router.get("/status", async (_req, res) => {
  const token = await getValidToken();
  res.json({
    connected: !!token,
    configured: !!CANVA_CLIENT_ID(),
  });
});

// ─── Disconnect ──────────────────────────────────────────

router.post("/disconnect", (_req, res) => {
  delete tokenStore["default"];
  res.json({ ok: true });
});

// ─── Upload Asset ────────────────────────────────────────

router.post("/upload", async (req, res) => {
  try {
    const { base64, mimeType, name } = req.body as {
      base64: string;
      mimeType: string;
      name: string;
    };

    if (!base64 || !name) {
      return res.status(400).json({ error: "base64 and name are required." });
    }

    const token = await getValidToken();
    if (!token) {
      return res.status(401).json({ error: "Not connected to Canva. Please connect first." });
    }

    // Convert base64 to buffer
    const buffer = Buffer.from(base64, "base64");
    const nameBase64 = Buffer.from(name.slice(0, 50)).toString("base64");

    const uploadRes = await fetch("https://api.canva.com/rest/v1/asset-uploads", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/octet-stream",
        "Asset-Upload-Metadata": JSON.stringify({ name_base64: nameBase64 }),
      },
      body: buffer,
    });

    const data = await uploadRes.json();

    if (!uploadRes.ok) {
      return res.status(uploadRes.status).json({
        error: data.message || data.error?.message || "Upload failed.",
      });
    }

    res.json({
      jobId: data.job?.id,
      status: data.job?.status,
      asset: data.job?.asset,
    });
  } catch (err: any) {
    console.error("Canva upload error:", err.message);
    res.status(500).json({ error: err.message || "Failed to upload to Canva." });
  }
});

export default router;
