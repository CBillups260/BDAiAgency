import type { Request, Response, NextFunction } from "express";
import { auth } from "./firebase-admin.js";

export interface AuthedRequest extends Request {
  uid?: string;
  email?: string | null;
}

/**
 * Verify Firebase ID token from `Authorization: Bearer <token>`.
 *
 * In development, set `ALLOW_UNAUTHENTICATED=true` to bypass.
 * OAuth callback routes (Gmail, Canva) opt out via `skipAuthPaths` in index.ts.
 */
export async function verifyFirebaseToken(
  req: AuthedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  if (process.env.ALLOW_UNAUTHENTICATED === "true") {
    next();
    return;
  }

  const header = req.headers.authorization || "";
  const match = header.match(/^Bearer (.+)$/i);
  if (!match) {
    res.status(401).json({ error: "Missing Authorization bearer token." });
    return;
  }

  try {
    const decoded = await auth.verifyIdToken(match[1]);
    req.uid = decoded.uid;
    req.email = decoded.email ?? null;
    next();
  } catch (err) {
    console.warn("ID token verification failed:", (err as Error)?.message);
    res.status(401).json({ error: "Invalid or expired auth token." });
  }
}
