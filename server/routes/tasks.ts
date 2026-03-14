import { Router } from "express";
import { eq, desc } from "drizzle-orm";
import db, { schema } from "../db/index.js";
import { taskQueue } from "../queue/taskQueue.js";

const router = Router();

// GET /api/tasks — List tasks, optional filter by agent and type
router.get("/", async (req, res) => {
  try {
    const { agent, type, status } = req.query;
    let query = db.select().from(schema.tasks).orderBy(desc(schema.tasks.createdAt)).limit(100);

    // Drizzle doesn't chain .where easily, so we'll filter in JS for simplicity
    let results = await query;

    if (agent) results = results.filter((t) => t.agentId === agent);
    if (type) results = results.filter((t) => t.type === type);
    if (status) results = results.filter((t) => t.status === status);

    res.json(results);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/tasks — Create and enqueue a new task
router.post("/", async (req, res) => {
  try {
    const { agentId, type, input } = req.body;

    if (!agentId || !type) {
      return res.status(400).json({ error: "agentId and type are required" });
    }

    const taskId = await taskQueue.enqueue(agentId, type, input || {});
    res.status(201).json({ taskId });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
