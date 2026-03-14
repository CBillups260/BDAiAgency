import { Router } from "express";
import { desc } from "drizzle-orm";
import db, { schema } from "../db/index.js";
import { sse } from "../sse/emitter.js";

const router = Router();

// GET /api/activity/stream — SSE real-time event stream
router.get("/stream", (req, res) => {
  sse.addClient(res);
});

// GET /api/activity/recent — Last N activity items
router.get("/recent", async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);

    const activities = await db
      .select()
      .from(schema.activityLog)
      .orderBy(desc(schema.activityLog.createdAt))
      .limit(limit);

    res.json(activities);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
