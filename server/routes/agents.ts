import { Router } from "express";
import { eq } from "drizzle-orm";
import db, { schema } from "../db/index.js";
import { registry } from "../agents/registry.js";

const router = Router();

// GET /api/agents — List all agents with status
router.get("/", async (_req, res) => {
  try {
    const dbAgents = await db.select().from(schema.agents);
    const agentMap = new Map(dbAgents.map((a) => [a.id, a]));

    const result = registry.getAll().map((agent) => {
      const dbRow = agentMap.get(agent.id);
      return {
        id: agent.id,
        name: agent.name,
        enabled: dbRow?.enabled ?? true,
        role: dbRow?.role ?? "",
        schedule: agent.getSchedule(),
      };
    });

    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/agents/:id — Toggle enable/disable
router.patch("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { enabled } = req.body;

    if (typeof enabled !== "boolean") {
      return res.status(400).json({ error: "enabled must be a boolean" });
    }

    const agent = registry.get(id);
    if (!agent) {
      return res.status(404).json({ error: "Agent not found" });
    }

    await registry.setEnabled(id, enabled);
    res.json({ id, enabled });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
