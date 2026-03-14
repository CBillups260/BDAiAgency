import { GoogleGenAI } from "@google/genai";
import { v4 as uuid } from "uuid";
import db, { schema } from "../db/index.js";
import { eq } from "drizzle-orm";
import { sse } from "../sse/emitter.js";

export interface AgentTool {
  name: string;
  description: string;
  execute: (params: Record<string, unknown>) => Promise<unknown>;
}

export abstract class BaseAgent {
  abstract id: string;
  abstract name: string;
  abstract systemPrompt: string;

  private _ai: GoogleGenAI | null = null;

  protected get ai(): GoogleGenAI {
    if (!this._ai) {
      this._ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
    }
    return this._ai;
  }

  getTools(): AgentTool[] {
    return [];
  }

  getSchedule(): string | null {
    return null;
  }

  async onEnable(): Promise<void> {}
  async onDisable(): Promise<void> {}

  async chat(message: string, conversationId?: string): Promise<{ conversationId: string; response: string }> {
    // Create or reuse conversation
    if (!conversationId) {
      conversationId = uuid();
      await db.insert(schema.conversations).values({
        id: conversationId,
        agentId: this.id,
      });
    }

    // Save user message
    await db.insert(schema.messages).values({
      conversationId,
      role: "user",
      content: message,
    });

    // Get conversation history
    const history = await db
      .select()
      .from(schema.messages)
      .where(eq(schema.messages.conversationId, conversationId))
      .orderBy(schema.messages.createdAt);

    // Build context from history
    const contextMessage = history
      .map((m) => `${m.role}: ${m.content}`)
      .join("\n");

    // Log activity
    this.logActivity("chat_message", { message: message.slice(0, 100) });

    // Call Gemini
    const chat = this.ai.chats.create({
      model: "gemini-2.0-flash",
      config: {
        systemInstruction: this.systemPrompt,
      },
    });

    const response = await chat.sendMessage({ message: contextMessage });
    const responseText = response.text ?? "I'm sorry, I couldn't generate a response.";

    // Save assistant message
    await db.insert(schema.messages).values({
      conversationId,
      role: "assistant",
      content: responseText,
    });

    // Log activity
    this.logActivity("chat_response", { preview: responseText.slice(0, 100) });

    return { conversationId, response: responseText };
  }

  async executeTask(taskInput: { type: string; input: Record<string, unknown> }): Promise<string> {
    const taskId = uuid();

    await db.insert(schema.tasks).values({
      id: taskId,
      agentId: this.id,
      type: taskInput.type,
      status: "running",
      input: taskInput.input as any,
    });

    sse.broadcast("task_update", { taskId, agentId: this.id, status: "running", type: taskInput.type });
    this.logActivity("task_started", { taskId, type: taskInput.type });

    try {
      const result = await this.runTask(taskInput.type, taskInput.input);

      await db
        .update(schema.tasks)
        .set({
          status: "completed",
          output: { result } as any,
          completedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })
        .where(eq(schema.tasks.id, taskId));

      sse.broadcast("task_update", { taskId, agentId: this.id, status: "completed", type: taskInput.type });
      this.logActivity("task_completed", { taskId, type: taskInput.type });

      return result;
    } catch (err: any) {
      await db
        .update(schema.tasks)
        .set({
          status: "failed",
          output: { error: err.message } as any,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(schema.tasks.id, taskId));

      sse.broadcast("task_update", { taskId, agentId: this.id, status: "failed" });
      this.logActivity("task_failed", { taskId, error: err.message });

      throw err;
    }
  }

  protected abstract runTask(type: string, input: Record<string, unknown>): Promise<string>;

  protected logActivity(action: string, metadata?: Record<string, unknown>) {
    db.insert(schema.activityLog)
      .values({
        agentId: this.id,
        action,
        metadata: metadata as any,
      })
      .run();

    sse.broadcast("activity", {
      agentId: this.id,
      agentName: this.name,
      action,
      metadata,
      createdAt: new Date().toISOString(),
    });
  }
}
