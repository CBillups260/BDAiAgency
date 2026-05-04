import { auth } from "./firebase";

/**
 * Wrapper around `fetch` that attaches the current user's Firebase ID token
 * as a Bearer Authorization header. Use this for ALL `/api/*` calls.
 *
 * The token is fetched fresh on every call (Firebase SDK caches it internally
 * and refreshes when needed).
 */
export async function authedFetch(
  input: RequestInfo | URL,
  init: RequestInit = {}
): Promise<Response> {
  const headers = new Headers(init.headers);
  const user = auth.currentUser;
  if (user) {
    const token = await user.getIdToken();
    headers.set("Authorization", `Bearer ${token}`);
  }
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  return fetch(input, { ...init, headers });
}
