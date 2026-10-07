/**
 * Thin OpenRouter chat client (OpenAI-compatible /chat/completions).
 *
 * Powers the Creative Writer feature: the Novel Nexus editor, the Writers' Room
 * character agents, and the Crafter all speak through this one function so any
 * OpenRouter model id works without backend changes (mirrors the open-catalog
 * approach of falImage.ts).
 */

import { fetch as undiciFetch, Agent } from "undici";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

// Node's built-in fetch enforces a 300s headers timeout — and a non-streaming
// completion only sends headers when the WHOLE generation is done, so any
// model call over ~5 minutes (Kimi K3 full-book analysis, playout cleanup)
// dies with UND_ERR_HEADERS_TIMEOUT. Use undici directly with a 10-min agent.
const longCallAgent = new Agent({
  headersTimeout: 600_000,
  bodyTimeout: 600_000,
});

/**
 * Models that emit hidden reasoning tokens BEFORE their answer. Those tokens
 * count against max_tokens, so a budget sized for the visible answer alone gets
 * truncated mid-JSON. Measured on kimi-k3: a trivial round-plan reply spent 198
 * of 271 completion tokens on reasoning (~73% overhead).
 *
 * max_tokens is a ceiling, not a spend — you're billed for tokens actually
 * generated — so granting generous headroom is effectively free insurance.
 */
const REASONING_MODEL_PATTERNS = [
  /kimi-k3/i,
  /kimi-k2-thinking/i,
  /deepseek-r1/i,
  /\bo[1-4]\b/i,
  /gpt-5/i,
  // Gemini 2.5+ think by default on OpenRouter (verified: reasoning tokens in usage).
  /gemini-2\.5/i,
  /gemini-3/i,
  /thinking/i,
  /reasoning/i,
];

export function isReasoningModel(model: string): boolean {
  return REASONING_MODEL_PATTERNS.some((p) => p.test(model));
}

/** Give reasoning models room to think without starving the visible answer. */
function budgetFor(model: string, maxTokens: number): number {
  return isReasoningModel(model)
    ? Math.max(maxTokens * 3, maxTokens + 2000)
    : maxTokens;
}

export interface OpenRouterMessage {
  role: "system" | "user" | "assistant";
  content: string;
  /** Speaker tag for multi-character transcripts (supported by the OpenAI schema). */
  name?: string;
}

export interface OpenRouterChatOptions {
  model: string;
  messages: OpenRouterMessage[];
  temperature?: number;
  maxTokens?: number;
  /**
   * Ask for a JSON object response. Only use for Nexus/Crafter-tier models —
   * many roleplay models ignore or reject response_format.
   */
  jsonMode?: boolean;
}

export interface OpenRouterChatResult {
  text: string;
  /** total_tokens from usage, 0 if the provider omitted it. */
  tokensUsed: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function openrouterChat(
  opts: OpenRouterChatOptions
): Promise<OpenRouterChatResult> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error(
      "OPENROUTER_API_KEY is not configured on the server. Add it to the functions env file."
    );
  }

  const body: Record<string, unknown> = {
    model: opts.model,
    messages: opts.messages,
    temperature: opts.temperature ?? 0.7,
    max_tokens: budgetFor(opts.model, opts.maxTokens ?? 1024),
  };
  if (opts.jsonMode) body.response_format = { type: "json_object" };

  let lastError = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await undiciFetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        // Attribution headers OpenRouter asks apps to send.
        "HTTP-Referer": "https://branddominators.com",
        "X-Title": "BDAiAgency Creative Writer",
      },
      body: JSON.stringify(body),
      dispatcher: longCallAgent,
    });

    if (res.ok) {
      const data: any = await res.json();
      // OpenRouter can 200 with an error payload for upstream provider failures.
      if (data?.error) {
        lastError = data.error.message || "OpenRouter provider error";
        if (attempt === 0) {
          await sleep(1500);
          continue;
        }
        throw new Error(`OpenRouter (${opts.model}): ${lastError}`);
      }
      const choice = data?.choices?.[0];
      const text: string = choice?.message?.content ?? "";
      const tokensUsed: number = data?.usage?.total_tokens ?? 0;
      // A reasoning model can burn its whole budget thinking and return nothing.
      // Surface that plainly instead of letting an empty string look like a
      // model that had nothing to say.
      if (!text.trim() && choice?.finish_reason === "length") {
        throw new Error(
          `OpenRouter (${opts.model}): ran out of tokens while reasoning and returned no answer. Raise maxTokens for this call.`
        );
      }
      return { text, tokensUsed };
    }

    const errBody = await res.text().catch(() => "");
    try {
      lastError = JSON.parse(errBody)?.error?.message || errBody || res.statusText;
    } catch {
      lastError = errBody || res.statusText;
    }
    // Retry once on rate limits / transient upstream errors.
    if ((res.status === 429 || res.status >= 500) && attempt === 0) {
      await sleep(2000);
      continue;
    }
    throw new Error(`OpenRouter ${res.status} (${opts.model}): ${lastError}`);
  }
  throw new Error(`OpenRouter (${opts.model}): ${lastError || "request failed"}`);
}

/** Extract the first JSON object from a model response (prose-wrapped JSON tolerated). */
export function extractJsonObject(text: string): any {
  if (!text) return {};
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return {};
  try {
    return JSON.parse(match[0]);
  } catch {
    return {};
  }
}

export function clip(s: unknown, max = 600): string {
  if (typeof s !== "string") return "";
  return s.length > max ? s.slice(0, max) : s;
}
