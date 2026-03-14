import { eq } from "drizzle-orm";
import db, { schema } from "../db/index.js";
import type { BaseAgent } from "./base.js";
import { OrchestratorAgent } from "./orchestrator.js";
import { AccountAgent } from "./accounts.js";
import { ServiceAgent } from "./services.js";
import { ReportAgent } from "./reports.js";
import { FinancialAgent } from "./financials.js";

class AgentRegistry {
  private agents: Map<string, BaseAgent> = new Map();

  constructor() {
    const allAgents: BaseAgent[] = [
      new OrchestratorAgent(),
      new AccountAgent(),
      new ServiceAgent(),
      new ReportAgent(),
      new FinancialAgent(),
    ];

    for (const agent of allAgents) {
      this.agents.set(agent.id, agent);
    }
  }

  get(id: string): BaseAgent | undefined {
    return this.agents.get(id);
  }

  getAll(): BaseAgent[] {
    return Array.from(this.agents.values());
  }

  async isEnabled(agentId: string): Promise<boolean> {
    const [row] = await db
      .select({ enabled: schema.agents.enabled })
      .from(schema.agents)
      .where(eq(schema.agents.id, agentId));
    return row?.enabled ?? true;
  }

  async setEnabled(agentId: string, enabled: boolean): Promise<void> {
    await db
      .update(schema.agents)
      .set({ enabled })
      .where(eq(schema.agents.id, agentId));

    const agent = this.agents.get(agentId);
    if (agent) {
      if (enabled) await agent.onEnable();
      else await agent.onDisable();
    }
  }
}

export const registry = new AgentRegistry();
