import { google } from "googleapis";
import {
  getGmailTokens,
  setGmailTokens,
  clearGmailTokens,
} from "../lib/tokens.js";

function getOAuth2Client() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri =
    process.env.GOOGLE_REDIRECT_URI ||
    "http://localhost:3001/api/prospecting/gmail/callback";

  if (!clientId || !clientSecret) {
    throw new Error("GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set.");
  }

  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

const SCOPES = ["https://www.googleapis.com/auth/gmail.send"];

export function getAuthUrl(): string {
  const oAuth2Client = getOAuth2Client();
  return oAuth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: SCOPES,
  });
}

export async function handleCallback(code: string): Promise<{ email: string }> {
  const oAuth2Client = getOAuth2Client();
  const { tokens } = await oAuth2Client.getToken(code);
  oAuth2Client.setCredentials(tokens);

  const gmail = google.gmail({ version: "v1", auth: oAuth2Client });
  const profile = await gmail.users.getProfile({ userId: "me" });
  const email = profile.data.emailAddress || "unknown";

  await setGmailTokens({
    email,
    accessToken: tokens.access_token || "",
    refreshToken: tokens.refresh_token || "",
    expiresAt: tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null,
    updatedAt: new Date().toISOString(),
  });

  return { email };
}

export async function getConnectionStatus(): Promise<{
  connected: boolean;
  email: string | null;
}> {
  try {
    const row = await getGmailTokens();
    if (!row) return { connected: false, email: null };
    return { connected: true, email: row.email };
  } catch {
    return { connected: false, email: null };
  }
}

export async function disconnectGmail(): Promise<void> {
  await clearGmailTokens();
}

export async function sendEmail(
  to: string,
  subject: string,
  body: string
): Promise<{ messageId: string }> {
  const row = await getGmailTokens();
  if (!row) throw new Error("Gmail is not connected. Please authenticate first.");

  const oAuth2Client = getOAuth2Client();
  oAuth2Client.setCredentials({
    access_token: row.accessToken,
    refresh_token: row.refreshToken,
  });

  oAuth2Client.on("tokens", (tokens) => {
    if (tokens.access_token) {
      void setGmailTokens({
        email: row.email,
        accessToken: tokens.access_token,
        refreshToken: row.refreshToken,
        expiresAt: tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null,
        updatedAt: new Date().toISOString(),
      });
    }
  });

  const gmail = google.gmail({ version: "v1", auth: oAuth2Client });

  const raw = Buffer.from(
    [
      `To: ${to}`,
      `Subject: ${subject}`,
      "Content-Type: text/html; charset=utf-8",
      "MIME-Version: 1.0",
      "",
      body.replace(/\n/g, "<br>"),
    ].join("\r\n")
  )
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  const result = await gmail.users.messages.send({
    userId: "me",
    requestBody: { raw },
  });

  return { messageId: result.data.id || "" };
}
