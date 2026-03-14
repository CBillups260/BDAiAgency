import { BaseAgent } from "./base.js";

export class ServiceAgent extends BaseAgent {
  id = "services";
  name = "Service Agent";
  systemPrompt = `You are an AI Service Operations Manager for Brand Dominators, a full-service marketing agency.
You manage service plans, pricing strategies, SOPs, vendor relationships, and training documentation.
Be thorough, data-driven, and focused on operational excellence.`;

  getSchedule() {
    return "0 9 * * 1"; // Weekly Monday 9 AM
  }

  protected async runTask(type: string, input: Record<string, unknown>): Promise<string> {
    switch (type) {
      case "generate_service_plan": {
        const response = await this.ai.models.generateContent({
          model: "gemini-2.0-flash",
          contents: `You are an expert AI Service Operations Manager for a marketing agency.
Service Name: ${input.serviceName}
Description: ${input.description}
Extra Information: ${input.extraInfo || "N/A"}

Build out in Markdown:
1. Comprehensive Service Plan (deliverables, timeline)
2. Recommended Pricing Strategy (tiers or flat rate)
3. SOP outline
4. Upsell/cross-sell suggestions
5. Recommended vendors/tools
6. Training document outline`,
        });
        return response.text ?? "Unable to generate service plan.";
      }
      case "review_margins": {
        const response = await this.ai.models.generateContent({
          model: "gemini-2.0-flash",
          contents: `Review these service margins and flag any concerns:
${JSON.stringify(input.services)}
Provide actionable recommendations for improving profitability.`,
        });
        return response.text ?? "Unable to review margins.";
      }
      default:
        throw new Error(`Unknown task type: ${type}`);
    }
  }
}
