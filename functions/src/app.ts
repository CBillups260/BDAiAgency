import express, { type Request, type Response, type NextFunction } from "express";
import cors from "cors";

import { verifyFirebaseToken } from "./lib/auth.js";

import contentRoutes from "./routes/content.js";
import canvaRoutes from "./routes/canva.js";
import ghlRoutes from "./routes/ghl.js";
import servicesRoutes from "./routes/services.js";
import prospectingRoutes from "./routes/prospecting.js";
import socialRoutes from "./routes/social.js";

/**
 * Paths that are hit by an external OAuth provider's browser redirect and
 * therefore cannot carry a Firebase ID token. These bypass auth.
 */
const OPEN_PATHS: RegExp[] = [
  /^\/api\/health$/,
  /^\/api\/canva\/callback(?:\?.*)?$/,
  /^\/api\/prospecting\/gmail\/callback(?:\?.*)?$/,
  // image-proxy is hit by browser <img> tags, which cannot send Authorization
  // headers. The route itself enforces a server-side host allowlist.
  /^\/api\/content\/image-proxy(?:\?.*)?$/,
];

function maybeAuth(req: Request, res: Response, next: NextFunction): void {
  if (OPEN_PATHS.some((p) => p.test(req.path))) {
    next();
    return;
  }
  void verifyFirebaseToken(req, res, next);
}

export function createApp(): express.Express {
  const app = express();

  app.use(cors());
  app.use(express.json({ limit: "50mb" }));

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  app.use("/api", maybeAuth);

  app.use("/api/content", contentRoutes);
  app.use("/api/canva", canvaRoutes);
  app.use("/api/ghl", ghlRoutes);
  app.use("/api/services", servicesRoutes);
  app.use("/api/prospecting", prospectingRoutes);
  app.use("/api/social", socialRoutes);

  app.use(
    (
      err: any,
      _req: Request,
      res: Response,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      _next: NextFunction
    ) => {
      console.error("Unhandled error:", err?.message || err);
      const status =
        typeof err?.status === "number"
          ? err.status
          : typeof err?.statusCode === "number"
          ? err.statusCode
          : 500;
      res.status(status).json({ error: err?.message || "Something went wrong." });
    }
  );

  return app;
}
