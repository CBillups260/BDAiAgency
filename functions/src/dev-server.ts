/**
 * Local dev entry point. Run with `npm run dev` from the `functions/` dir
 * (or via the root `npm run dev:server` script).
 *
 * This loads `.env` from the repo root and the `functions/` dir, then starts
 * the Express app on localhost:3001 — matching the Vite proxy in vite.config.ts.
 */
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");
dotenv.config({ path: path.join(repoRoot, ".env") });
dotenv.config({ path: path.join(repoRoot, ".env.local") });
dotenv.config({ path: path.join(here, "..", ".env") });

if (!process.env.ALLOW_UNAUTHENTICATED) {
  process.env.ALLOW_UNAUTHENTICATED = "true";
}

process.on("unhandledRejection", (reason) => {
  console.error("[dev-server] unhandledRejection:", reason);
});
process.on("uncaughtException", (err) => {
  console.error("[dev-server] uncaughtException:", err);
});

const { createApp } = await import("./app.js");
const app = createApp();

const PORT = parseInt(process.env.SERVER_PORT || "3001", 10);
app.listen(PORT, () => {
  console.log(`Dev API server: http://localhost:${PORT}/api/health`);
  console.log("Auth bypass: ALLOW_UNAUTHENTICATED=true");
});
