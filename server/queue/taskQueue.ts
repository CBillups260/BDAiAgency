import { eq } from "drizzle-orm";
import db, { schema } from "../db/index.js";
import { registry } from "../agents/registry.js";
import { sse } from "../sse/emitter.js";
import { v4 as uuid } from "uuid";

interface QueuedTask {
  id: string;
  agentId: string;
  type: string;
  input: Record<string, unknown>;
}

class TaskQueue {
  private queue: QueuedTask[] = [];
  private processing = false;

  async enqueue(agentId: string, type: string, input: Record<string, unknown>): Promise<string> {
    const id = uuid();

    await db.insert(schema.tasks).values({
      id,
      agentId,
      type,
      status: "pending",
      input: input as any,
    });

    this.queue.push({ id, agentId, type, input });
    sse.broadcast("task_update", { taskId: id, agentId, status: "pending", type });

    this.process();
    return id;
  }

  private async process() {
    if (this.processing) return;
    this.processing = true;

    while (this.queue.length > 0) {
      const task = this.queue.shift()!;
      const agent = registry.get(task.agentId);

      if (!agent) {
        await db.update(schema.tasks)
          .set({ status: "failed", output: { error: "Agent not found" } as any, updatedAt: new Date().toISOString() })
          .where(eq(schema.tasks.id, task.id));
        continue;
      }

      const enabled = await registry.isEnabled(task.agentId);
      if (!enabled) {
        await db.update(schema.tasks)
          .set({ status: "failed", output: { error: "Agent disabled" } as any, updatedAt: new Date().toISOString() })
          .where(eq(schema.tasks.id, task.id));
        continue;
      }

      try {
        await db.update(schema.tasks)
          .set({ status: "running", updatedAt: new Date().toISOString() })
          .where(eq(schema.tasks.id, task.id));

        sse.broadcast("task_update", { taskId: task.id, agentId: task.agentId, status: "running", type: task.type });
        sse.broadcast("agent_status", { agentId: task.agentId, currentTask: `Running: ${task.type}` });

        const result = await agent.executeTask({ type: task.type, input: task.input });

        // executeTask already handles updating the DB record
      } catch (err: any) {
        // executeTask already handles the failure case
        console.error(`Task ${task.id} failed:`, err.message);
      }
    }

    this.processing = false;
  }

  // Restore pending tasks from DB on startup
  async restore() {
    const pendingTasks = await db
      .select()
      .from(schema.tasks)
      .where(eq(schema.tasks.status, "pending"));

    for (const task of pendingTasks) {
      this.queue.push({
        id: task.id,
        agentId: task.agentId,
        type: task.type,
        input: (task.input as Record<string, unknown>) || {},
      });
    }

    if (this.queue.length > 0) {
      console.log(`Restored ${this.queue.length} pending tasks`);
      this.process();
    }
  }
}

export const taskQueue = new TaskQueue();
