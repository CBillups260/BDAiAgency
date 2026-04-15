import { google } from "googleapis";
import { sqlite } from "../db/index.js";

// ─── OAuth2 Client ───────────────────────────────────────

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

// ─── Auth URL ────────────────────────────────────────────

const SCOPES = ["https://www.googleapis.com/auth/gmail.send"];

export function getAuthUrl(): string {
  const oAuth2Client = getOAuth2Client();
  return oAuth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: SCOPES,
  });
}

// ─── Handle OAuth Callback ──────────────────────────────

export async function handleCallback(code: string): Promise<{ email: string }> {
  const oAuth2Client = getOAuth2Client();
  const { tokens } = await oAuth2Client.getToken(code);
  oAuth2Client.setCredentials(tokens);

  const gmail = google.gmail({ version: "v1", auth: oAuth2Client });
  const profile = await gmail.users.getProfile({ userId: "me" });
  const email = profile.data.emailAddress || "unknown";

  const stmt = sqlite.prepare(`
    INSERT OR REPLACE INTO gmail_tokens (id, email, access_token, refresh_token, expires_at, created_at)
    VALUES ('default', ?, ?, ?, ?, datetime('now'))
  `);
  stmt.run(
    email,
    tokens.access_token || "",
    tokens.refresh_token || "",
    tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : ""
  );

  return { email };
}

// ─── Connection Status ───────────────────────────────────

export function getConnectionStatus(): {
  connected: boolean;
  email: string | null;
} {
  try {
    const row = sqlite
      .prepare("SELECT email FROM gmail_tokens WHERE id = 'default'")
      .get() as { email: string } | undefined;

    if (!row) return { connected: false, email: null };
    return { connected: true, email: row.email };
  } catch {
    return { connected: false, email: null };
  }
}

// ─── Send Email ──────────────────────────────────────────

export async function sendEmail(
  to: string,
  subject: string,
  body: string
): Promise<{ messageId: string }> {
  const row = sqlite
    .prepare("SELECT * FROM gmail_tokens WHERE id = 'default'")
    .get() as
    | { email: string; access_token: string; refresh_token: string }
    | undefined;

  if (!row) throw new Error("Gmail is not connected. Please authenticate first.");

  const oAuth2Client = getOAuth2Client();
  oAuth2Client.setCredentials({
    access_token: row.access_token,
    refresh_token: row.refresh_token,
  });

  oAuth2Client.on("tokens", (tokens) => {
    if (tokens.access_token) {
      sqlite
        .prepare(
          "UPDATE gmail_tokens SET access_token = ?, expires_at = ? WHERE id = 'default'"
        )
        .run(
          tokens.access_token,
          tokens.expiry_date
            ? new Date(tokens.expiry_date).toISOString()
            : ""
        );
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
