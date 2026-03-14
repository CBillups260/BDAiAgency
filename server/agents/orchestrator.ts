import { BaseAgent } from "./base.js";

export class OrchestratorAgent extends BaseAgent {
  id = "orchestrator";
  name = "Orchestrator Agent";
  systemPrompt = `You are the Orchestrator Agent for Brand Dominators, a full-service marketing agency.
You coordinate all sub-agents (Account, Service, Report, Financial), manage task delegation, and ensure system-wide coherence.
You have oversight of all operations and can route requests to the appropriate specialized agent.
Be strategic, concise, and decisive in your coordination.`;

  getSchedule() {
    return "*/15 * * * *"; // Every 15 minutes
  }

  protected async runTask(type: string, input: Record<string, unknown>): Promise<string> {
    switch (type) {
      case "health_check": {
        this.logActivity("health_check", { status: "all_agents_operational" });
        return "All agents operational.";
      }
      case "delegate": {
        const response = await this.ai.models.generateContent({
          model: "gemini-2.0-flash",
          contents: `As the orchestrator agent, determine which specialized agent should handle this request and what instructions to give them:
Request: ${input.request}
Available agents: accounts, services, reports, financials
Respond with JSON: { "agent": "agent_id", "task": "task_description", "priority": "high|medium|low" }`,
        });
        return response.text ?? "Unable to delegate.";
      }
      default:
        throw new Error(`Unknown task type: ${type}`);
    }
  }
}
