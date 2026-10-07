import { db } from "./firebase-admin.js";

/**
 * Firestore-backed OAuth token store.
 *
 * Tokens are keyed by integration name + a workspace key (currently "default" since
 * the app is single-tenant per Firebase project). Migration target collections:
 *
 *   - integration_tokens/gmail/{key}
 *   - integration_tokens/canva/{key}
 *
 * Per-user tokens can be added later by passing the user's UID as the key.
 */

export interface GmailTokenRecord {
  email: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: string | null;
  updatedAt: string;
}

export interface CanvaTokenRecord {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  updatedAt: string;
}

const tokenDoc = (integration: "gmail" | "canva", key: string = "default") =>
  db.collection("integration_tokens").doc(integration).collection("keys").doc(key);

export async function getGmailTokens(key: string = "default"): Promise<GmailTokenRecord | null> {
  const snap = await tokenDoc("gmail", key).get();
  if (!snap.exists) return null;
  return snap.data() as GmailTokenRecord;
}

export async function setGmailTokens(record: GmailTokenRecord, key: string = "default"): Promise<void> {
  await tokenDoc("gmail", key).set(record, { merge: true });
}

export async function clearGmailTokens(key: string = "default"): Promise<void> {
  await tokenDoc("gmail", key).delete();
}

export async function getCanvaTokens(key: string = "default"): Promise<CanvaTokenRecord | null> {
  const snap = await tokenDoc("canva", key).get();
  if (!snap.exists) return null;
  return snap.data() as CanvaTokenRecord;
}

export async function setCanvaTokens(record: CanvaTokenRecord, key: string = "default"): Promise<void> {
  await tokenDoc("canva", key).set(record, { merge: true });
}

export async function clearCanvaTokens(key: string = "default"): Promise<void> {
  await tokenDoc("canva", key).delete();
}

/**
 * PKCE state for the Canva OAuth flow. Lives in Firestore so it survives between
 * the /auth and /callback requests (Cloud Functions instances are not sticky).
 * Documents auto-expire via TTL on `expiresAt` if you configure a TTL policy on
 * `oauth_pending_state.expiresAt` in the Firebase console.
 */
export interface PendingOAuthState {
  codeVerifier: string;
  state: string;
  integration: "canva";
  expiresAt: Date;
}

export async function savePendingOAuthState(state: string, record: PendingOAuthState): Promise<void> {
  await db.collection("oauth_pending_state").doc(state).set(record);
}

export async function consumePendingOAuthState(state: string): Promise<PendingOAuthState | null> {
  const ref = db.collection("oauth_pending_state").doc(state);
  const snap = await ref.get();
  if (!snap.exists) return null;
  await ref.delete();
  return snap.data() as PendingOAuthState;
}
