import { Router } from "express";
import crypto from "crypto";
import {
  getCanvaTokens,
  setCanvaTokens,
  clearCanvaTokens,
  savePendingOAuthState,
  consumePendingOAuthState,
} from "../lib/tokens.js";

const router = Router();

const CANVA_CLIENT_ID = () => process.env.CANVA_CLIENT_ID || "";
const CANVA_CLIENT_SECRET = () => process.env.CANVA_CLIENT_SECRET || "";
const REDIRECT_URI = () =>
  `${process.env.APP_URL || "http://localhost:3001"}/api/canva/callback`;

router.get("/auth", async (_req, res) => {
  if (!CANVA_CLIENT_ID()) {
    return res.status(400).json({ error: "CANVA_CLIENT_ID not configured." });
  }

  const codeVerifier = crypto.randomBytes(32).toString("base64url");
  const codeChallenge = crypto
    .createHash("sha256")
    .update(codeVerifier)
    .digest("base64url");
  const state = crypto.randomBytes(16).toString("hex");

  await savePendingOAuthState(state, {
    codeVerifier,
    state,
    integration: "canva",
    expiresAt: new Date(Date.now() + 10 * 60 * 1000),
  });

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

router.get("/callback", async (req, res) => {
  const { code, state } = req.query as { code?: string; state?: string };
  if (!code || !state) {
    return res.status(400).send("Invalid OAuth callback.");
  }

  const pending = await consumePendingOAuthState(state);
  if (!pending) {
    return res.status(400).send("OAuth state not found or expired.");
  }

  try {
    const tokenRes = await fetch("https://api.canva.com/rest/v1/oauth/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${Buffer.from(
          `${CANVA_CLIENT_ID()}:${CANVA_CLIENT_SECRET()}`
        ).toString("base64")}`,
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: REDIRECT_URI(),
        code_verifier: pending.codeVerifier,
      }),
    });

    const data = (await tokenRes.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      error?: string;
      error_description?: string;
    };

    if (data.error || !data.access_token) {
      return res.status(400).send(`Canva auth failed: ${data.error_description || data.error || "unknown"}`);
    }

    await setCanvaTokens({
      accessToken: data.access_token,
      refreshToken: data.refresh_token || "",
      expiresAt: Date.now() + (data.expires_in || 3600) * 1000,
      updatedAt: new Date().toISOString(),
    });

    res.redirect(`${process.env.APP_URL || "http://localhost:3000"}?canva=connected`);
  } catch (err: any) {
    res.status(500).send(`Token exchange failed: ${err.message}`);
  }
});

async function getValidToken(): Promise<string | null> {
  let stored: Awaited<ReturnType<typeof getCanvaTokens>> = null;
  try {
    stored = await getCanvaTokens();
  } catch (err) {
    console.warn("[canva] token store unavailable:", (err as Error).message);
    return null;
  }
  if (!stored) return null;

  if (Date.now() < stored.expiresAt - 60_000) {
    return stored.accessToken;
  }

  try {
    const tokenRes = await fetch("https://api.canva.com/rest/v1/oauth/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${Buffer.from(
          `${CANVA_CLIENT_ID()}:${CANVA_CLIENT_SECRET()}`
        ).toString("base64")}`,
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: stored.refreshToken,
      }),
    });

    const data = (await tokenRes.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
    };

    if (data.access_token) {
      await setCanvaTokens({
        accessToken: data.access_token,
        refreshToken: data.refresh_token || stored.refreshToken,
        expiresAt: Date.now() + (data.expires_in || 3600) * 1000,
        updatedAt: new Date().toISOString(),
      });
      return data.access_token;
    }
  } catch {
    /* fall through */
  }

  return null;
}

router.get("/status", async (_req, res) => {
  try {
    const token = await getValidToken();
    res.json({ connected: !!token, configured: !!CANVA_CLIENT_ID() });
  } catch (err) {
    console.warn("[canva] status check failed:", (err as Error).message);
    res.json({ connected: false, configured: !!CANVA_CLIENT_ID() });
  }
});

router.post("/disconnect", async (_req, res) => {
  try {
    await clearCanvaTokens();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

router.post("/upload", async (req, res) => {
  try {
    const { base64, mimeType: _mimeType, name } = req.body as {
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

    const data = (await uploadRes.json()) as any;

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
