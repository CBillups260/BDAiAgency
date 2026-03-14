import { BaseAgent } from "./base.js";

export class FinancialAgent extends BaseAgent {
  id = "financials";
  name = "Financial Agent";
  systemPrompt = `You are an AI Financial Controller for Brand Dominators, a full-service marketing agency.
You ensure financial health, detect scope creep, analyze margins, and provide revenue forecasting.
Agencies often bend for clients, hurting growth — your job is to keep the agency on track.
Be direct, numbers-focused, and protective of agency profitability.`;

  getSchedule() {
    return "0 6 * * *"; // Daily at 6 AM
  }

  protected async runTask(type: string, input: Record<string, unknown>): Promise<string> {
    switch (type) {
      case "analyze_financials": {
        const response = await this.ai.models.generateContent({
          model: "gemini-2.0-flash",
          contents: `Analyze the following financial data and provide:
1. Overall financial health assessment
2. Profitability analysis of current accounts/services
3. Identification of scope creep areas
4. Actionable recommendations to improve margins

Financial Context:
${JSON.stringify(input.financialData)}

Format in Markdown.`,
        });
        return response.text ?? "Unable to analyze financials.";
      }
      case "scope_creep_scan": {
        const response = await this.ai.models.generateContent({
          model: "gemini-2.0-flash",
          contents: `Scan for scope creep across these accounts:
${JSON.stringify(input.accounts)}
Flag any areas where the agency is delivering more than contracted. Quantify the impact.`,
        });
        return response.text ?? "Unable to scan for scope creep.";
      }
      default:
        throw new Error(`Unknown task type: ${type}`);
    }
  }
}
