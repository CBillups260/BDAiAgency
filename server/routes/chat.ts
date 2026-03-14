import { Router } from "express";
import { eq, desc } from "drizzle-orm";
import db, { schema } from "../db/index.js";
import { registry } from "../agents/registry.js";

const router = Router();

// POST /api/chat/:agentId — Send message, get response
router.post("/:agentId", async (req, res) => {
  try {
    const { agentId } = req.params;
    const { message, conversationId } = req.body;

    if (!message || typeof message !== "string") {
      return res.status(400).json({ error: "message is required" });
    }

    const agent = registry.get(agentId);
    if (!agent) {
      return res.status(404).json({ error: "Agent not found" });
    }

    const enabled = await registry.isEnabled(agentId);
    if (!enabled) {
      return res.status(403).json({ error: "Agent is disabled" });
    }

    const result = await agent.chat(message, conversationId);
    res.json(result);
  } catch (err: any) {
    console.error("Chat error:", err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/chat/:agentId/history — Conversation history
router.get("/:agentId/history", async (req, res) => {
  try {
    const { agentId } = req.params;
    const { conversationId } = req.query;

    if (conversationId) {
      const msgs = await db
        .select()
        .from(schema.messages)
        .where(eq(schema.messages.conversationId, conversationId as string))
        .orderBy(schema.messages.createdAt);
      return res.json(msgs);
    }

    // Return most recent conversation for this agent
    const [conv] = await db
      .select()
      .from(schema.conversations)
      .where(eq(schema.conversations.agentId, agentId))
      .orderBy(desc(schema.conversations.createdAt))
      .limit(1);

    if (!conv) return res.json([]);

    const msgs = await db
      .select()
      .from(schema.messages)
      .where(eq(schema.messages.conversationId, conv.id))
      .orderBy(schema.messages.createdAt);

    res.json({ conversationId: conv.id, messages: msgs });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
