import { setGlobalOptions } from "firebase-functions/v2";
import { onRequest } from "firebase-functions/v2/https";
import { createApp } from "./app.js";

setGlobalOptions({
  region: "us-central1",
  maxInstances: 10,
  memory: "512MiB",
  timeoutSeconds: 540,
});

const app = createApp();

/**
 * Single HTTPS function that handles all `/api/*` traffic.
 *
 * Firebase Hosting rewrites `**` → function `api`, so the public URL is the
 * Hosting URL and Express receives the full `/api/...` path. Cloud Functions
 * also exposes a direct URL at:
 *   https://<region>-<project>.cloudfunctions.net/api
 */
export const api = onRequest(app);
