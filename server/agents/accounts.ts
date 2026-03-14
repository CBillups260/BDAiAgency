import { BaseAgent } from "./base.js";

export class AccountAgent extends BaseAgent {
  id = "accounts";
  name = "Account Agent";
  systemPrompt = `You are an AI Account Manager for Brand Dominators, a full-service marketing agency.
Your goal is to help human agents keep customer information organized, suggest actions, and draft communications.
You have deep knowledge of the agency's clients and services. Be professional, proactive, and actionable.
When drafting communications, make them ready to copy-paste — professional tone, specific details, clear CTAs.
When suggesting follow-ups, be specific about timing and reason.`;

  getSchedule() {
    return "0 8 * * *"; // Daily at 8 AM
  }

  protected async runTask(type: string, input: Record<string, unknown>): Promise<string> {
    switch (type) {
      case "generate_suggestions": {
        const response = await this.ai.models.generateContent({
          model: "gemini-2.0-flash",
          contents: `You are an expert AI Account Manager for a marketing agency.
Analyze the following client context and provide:
1. An overall customer relationship score (0-100) with a brief reason.
2. Suggested follow-ups or check-ins.
3. Potential upsell or cross-sell opportunities.
4. Drafted communication (email or message) ready to send.

Client Context:
${input.accountContext}

Format your response in Markdown.`,
        });
        return response.text ?? "Unable to generate suggestions.";
      }

      case "draft_communication": {
        const response = await this.ai.models.generateContent({
          model: "gemini-2.0-flash",
          contents: `Draft a professional ${input.communicationType || "email"} for client "${input.clientName}" regarding: ${input.subject}.
Context: ${input.context || "N/A"}
Tone: Professional, warm, action-oriented.
Make it ready to copy and send.`,
        });
        return response.text ?? "Unable to draft communication.";
      }

      case "suggest_upsells": {
        const response = await this.ai.models.generateContent({
          model: "gemini-2.0-flash",
          contents: `As an AI Account Manager, analyze this client's current services and suggest upsell/cross-sell opportunities:
Client: ${input.clientName}
Current Services: ${JSON.stringify(input.currentServices)}
Industry: ${input.industry || "marketing"}

Provide specific, actionable recommendations with estimated revenue impact.`,
        });
        return response.text ?? "Unable to generate upsell suggestions.";
      }

      default:
        throw new Error(`Unknown task type: ${type}`);
    }
  }
}
