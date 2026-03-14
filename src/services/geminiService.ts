import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export async function generateAccountSuggestions(accountContext: string) {
  const prompt = `You are an expert AI Account Manager for a marketing agency.
Analyze the following client context and provide:
1. An overall customer relationship score (0-100) with a brief reason.
2. Suggested follow-ups or check-ins.
3. Potential upsell or cross-sell opportunities.
4. Drafted communication (email or message) ready to be copied and pasted to send to the client.

Client Context:
${accountContext}

Format your response in Markdown.`;

  const response = await ai.models.generateContent({
    model: "gemini-3.1-pro-preview",
    contents: prompt,
  });

  return response.text;
}

export async function chatWithAccountAgent(message: string, history: any[]) {
  const chat = ai.chats.create({
    model: "gemini-3.1-pro-preview",
    config: {
      systemInstruction: "You are an AI Account Manager for a marketing agency. Your goal is to help human agents keep customer information organized, suggest actions, and draft communications.",
    },
  });

  // Replay history if needed (simplified for now by just sending the latest message, 
  // but ideally we'd pass history. For this demo, we'll just send the message with context).
  const contextMessage = history.map(h => `${h.role}: ${h.content}`).join('\n') + `\nuser: ${message}`;

  const response = await chat.sendMessage({ message: contextMessage });
  return response.text;
}

export async function generateServicePlan(serviceName: string, description: string, extraInfo: string) {
  const prompt = `You are an expert AI Service Operations Manager for a marketing agency.
The user wants to add a new service to the agency's offerings.
Service Name: ${serviceName}
Description: ${description}
Extra Information: ${extraInfo}

Please build out the following in Markdown format:
1. A comprehensive Service Plan (deliverables, timeline).
2. Recommended Pricing Strategy (tiers or flat rate).
3. Standard Operating Procedure (SOP) outline.
4. Suggestions for upsells and cross-sells related to this service.
5. Recommended types of vendors or tools needed to deliver this service.
6. A brief training document outline for new employees.`;

  const response = await ai.models.generateContent({
    model: "gemini-3.1-pro-preview",
    contents: prompt,
  });

  return response.text;
}

export async function generateReport(accountName: string, services: string[], goals: string) {
  const prompt = `You are an expert AI Reporting Analyst for a marketing agency.
Generate a comprehensive, personalized performance report for a client.
Client Name: ${accountName}
Services Provided: ${services.join(", ")}
Client Goals: ${goals}

Since you don't have live data, simulate realistic metrics (e.g., social media growth, Google Analytics traffic, conversion rates) that align with a successful campaign for these services.
Include:
1. Executive Summary
2. Key Performance Indicators (KPIs)
3. Service-specific breakdowns
4. Insights and Recommendations for the next period.

Format in Markdown.`;

  const response = await ai.models.generateContent({
    model: "gemini-3.1-pro-preview",
    contents: prompt,
  });

  return response.text;
}

export async function analyzeFinancials(financialData: string) {
  const prompt = `You are an expert AI Financial Controller for a marketing agency.
Your goal is to ensure financial reports are clean and goal-oriented. Agencies often bend for clients, hurting growth. Keep us on track.

Analyze the following financial context/data and provide:
1. Overall financial health assessment.
2. Profitability analysis of current accounts/services.
3. Identification of "scope creep" or areas where the agency is bending too much.
4. Actionable recommendations to improve margins and agency growth.

Financial Context:
${financialData}

Format in Markdown.`;

  const response = await ai.models.generateContent({
    model: "gemini-3.1-pro-preview",
    contents: prompt,
  });

  return response.text;
}
