import { auth } from "./firebase";

// Direct Cloud Function origin, used to bypass the Netlify proxy on slow calls.
// Netlify rewrites /api/* to this same function, but proxy rewrites abort at a
// hard 26s timeout (https://docs.netlify.com/routing/redirects/rewrites-proxies/).
// OpenAI gpt-image-2 generations routinely run longer than that, so they 502
// through the proxy even though the function itself allows 540s. The Express app
// is mounted at /api and served by a function named `api`, hence the .../api base
// with the request path appended (mirrors the target in netlify.toml). Override
// with VITE_FUNCTION_BASE_URL if the project/region ever changes.
const FUNCTION_BASE =
  (import.meta.env.VITE_FUNCTION_BASE_URL as string | undefined) ||
  "https://us-central1-ai-designer-b3ea6.cloudfunctions.net/api";

// Image-generation endpoints whose runtime can exceed Netlify's 26s proxy limit.
const LONG_RUNNING_PATHS = [
  "/api/content/generate-image",
  "/api/content/generate-composite",
  "/api/content/generate-asset",
  "/api/content/remix-graphic",
  "/api/content/extract-background",
  "/api/content/classify-references",
  // Invisible (SynthID) removal proxies to a GPU diffusion service (10–40s).
  "/api/content/remove-watermark",
  // Reel/video download streams the full MP4 back through the function.
  "/api/social/download",
  // Server-side ffmpeg branding — downloads, re-encodes, and returns an MP4.
  "/api/social/brand-video",
  // Creative Writer — multi-model AI calls routinely exceed 26s.
  "/api/creative/analyze",
  "/api/creative/roundtable/run",
  "/api/creative/craft",
  "/api/creative/extract-bible",
  "/api/creative/ingest-chapter",
  "/api/creative/narrate",
  "/api/creative/roundtable/finalize",
  "/api/creative/transform",
  "/api/creative/format-chapter",
  "/api/creative/title-chapter",
  "/api/creative/restructure",
  "/api/creative/edit-selection",
  "/api/creative/craft-plan",
];

/**
 * Resolve a request target. In production, long-running image endpoints are sent
 * straight to the Cloud Function (CORS is open) so they aren't killed by the 26s
 * Netlify proxy timeout. Dev is untouched: Vite proxies /api to the local
 * dev-server, which has no such limit.
 */
function resolveUrl(input: RequestInfo | URL): RequestInfo | URL {
  if (typeof input !== "string" || !import.meta.env.PROD) return input;
  const path = input.split("?")[0];
  return LONG_RUNNING_PATHS.includes(path) ? FUNCTION_BASE + input : input;
}

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
  return fetch(resolveUrl(input), { ...init, headers });
}
