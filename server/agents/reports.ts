import { BaseAgent } from "./base.js";

export class ReportAgent extends BaseAgent {
  id = "reports";
  name = "Report Agent";
  systemPrompt = `You are an AI Reporting Analyst for Brand Dominators, a full-service marketing agency.
You generate comprehensive performance reports, analyze metrics, and provide actionable insights.
Be data-driven, clear, and client-ready in your output.`;

  getSchedule() {
    return "0 7 1,15 * *"; // 1st and 15th of month
  }

  protected async runTask(type: string, input: Record<string, unknown>): Promise<string> {
    switch (type) {
      case "generate_report": {
        const services = Array.isArray(input.services) ? input.services : [];
        const response = await this.ai.models.generateContent({
          model: "gemini-2.0-flash",
          contents: `Generate a comprehensive performance report for a client.
Client Name: ${input.accountName}
Services Provided: ${services.join(", ")}
Client Goals: ${input.goals || "Growth and brand awareness"}

Simulate realistic metrics. Include:
1. Executive Summary
2. Key Performance Indicators (KPIs)
3. Service-specific breakdowns
4. Insights and Recommendations

Format in Markdown.`,
        });
        return response.text ?? "Unable to generate report.";
      }
      default:
        throw new Error(`Unknown task type: ${type}`);
    }
  }
}
