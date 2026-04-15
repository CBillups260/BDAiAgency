import { HighLevel, GHLError } from "@gohighlevel/api-client";

const API_VERSION = process.env.GHL_API_VERSION || "2021-07-28";

function normalizeGhlTokenString(raw: string): string {
  return raw
    .trim()
    .replace(/^["']/, "")
    .replace(/["']$/, "")
    .trim();
}

function readGhlToken(): string {
  const raw =
    process.env.GHL_PRIVATE_INTEGRATION_TOKEN ||
    process.env.GHL_ACCESS_TOKEN ||
    "";
  return normalizeGhlTokenString(raw);
}

let locationTokensCache: Record<string, string> | null = null;

/**
 * JSON map in env: locationId → Private Integration token (sub-account tokens with Social Planner scopes).
 * Example: GHL_LOCATION_TOKENS='{"abc123xyz":"pit-...","def456":"pit-..."}'
 */
export function readGhlLocationTokensMap(): Readonly<Record<string, string>> {
  if (locationTokensCache) return locationTokensCache;
  const raw = process.env.GHL_LOCATION_TOKENS?.trim();
  if (!raw) {
    locationTokensCache = {};
    return locationTokensCache;
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        const key = k.trim();
        if (!key || typeof v !== "string") continue;
        const t = normalizeGhlTokenString(v);
        if (t) out[key] = t;
      }
      locationTokensCache = out;
      return locationTokensCache;
    }
  } catch {
    /* ignore invalid JSON */
  }
  locationTokensCache = {};
  return locationTokensCache;
}

export function hasAnyGhlTokenSource(): boolean {
  if (readGhlToken().length > 0) return true;
  return Object.keys(readGhlLocationTokensMap()).length > 0;
}

/**
 * Resolves which Private Integration token to use for a sub-account API call.
 * Precedence: request body token (from CRM) → GHL_LOCATION_TOKENS[locationId] → global env token.
 */
export function resolveGhlTokenForLocation(locationId: string, requestToken?: string | null): string {
  const fromReq = requestToken != null ? normalizeGhlTokenString(String(requestToken)) : "";
  if (fromReq) return fromReq;
  const loc = locationId.trim();
  if (loc) {
    const fromMap = readGhlLocationTokensMap()[loc];
    if (fromMap?.trim()) return fromMap;
  }
  return readGhlToken();
}

export function getGhlClient(): HighLevel {
  const token = readGhlToken();
  if (!token) {
    throw Object.assign(new Error("Set GHL_PRIVATE_INTEGRATION_TOKEN (or GHL_ACCESS_TOKEN) in the server environment."), {
      status: 503,
    });
  }
  return new HighLevel({
    privateIntegrationToken: token,
    apiVersion: API_VERSION,
  });
}

export function getGhlClientForLocation(locationId: string, requestToken?: string | null): HighLevel {
  const token = resolveGhlTokenForLocation(locationId, requestToken);
  if (!token) {
    throw Object.assign(
      new Error(
        "No HighLevel token for this location. Options: set GHL_PRIVATE_INTEGRATION_TOKEN; add this location id to GHL_LOCATION_TOKENS (JSON map in env); or save a location Private Integration token on the client in Accounts (CRM)."
      ),
      { status: 503 }
    );
  }
  return new HighLevel({
    privateIntegrationToken: token,
    apiVersion: API_VERSION,
  });
}

export function getDefaultGhlUserId(): string | undefined {
  const id = process.env.GHL_USER_ID?.trim();
  return id || undefined;
}

export function ghlerrMessage(err: unknown): string {
  if (err instanceof GHLError) {
    const ax = err.response as { data?: { message?: string } } | undefined;
    const apiMsg = ax?.data && typeof ax.data.message === "string" ? ax.data.message.trim() : "";
    return apiMsg || err.message || "HighLevel API error";
  }
  if (err instanceof Error) return err.message;
  return String(err);
}

/** Appends scope guidance when HighLevel returns a scopes / authorization error. */
export function formatGhlUserFacingError(err: unknown): string {
  const m = ghlerrMessage(err);
  if (/scope|not authorized/i.test(m)) {
    return `${m} — Open HighLevel → Settings → Private Integrations → your integration → ⋮ → Edit scopes. Enable: socialplanner/account.readonly, socialplanner/post.readonly, socialplanner/post.write. For “Fetch users” in app Settings, add users.readonly. Social Planner scopes are usually only on sub-account integrations: store each location’s token in CRM or in GHL_LOCATION_TOKENS in env.`;
  }
  return m;
}
