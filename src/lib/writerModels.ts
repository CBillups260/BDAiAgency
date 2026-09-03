/**
 * Chat-model catalog for the Creative Writer (Novel Nexus, character cast, and
 * Crafter). Mirrors modelCatalog.ts: each `id` is the EXACT OpenRouter model id
 * sent to the backend, which passes it straight through — adding a model is one
 * entry here, no backend changes.
 *
 * Two tiers:
 *  - `nexus`     → strong reasoning/prose models for the Nexus + Crafter.
 *  - `character` → roleplay-strong models for the Writers' Room cast.
 */

export type WriterModelTier = "nexus" | "character";

export const WRITER_BEST_FOR = {
  reasoning: "Deep reasoning",
  prose: "Beautiful prose",
  roleplay: "Roleplay & voice",
  uncensored: "Unfiltered drama",
  fast: "Fast",
  budget: "Low cost",
} as const;
export type WriterBestForTag = keyof typeof WRITER_BEST_FOR;

export interface WriterModel {
  /** Exact OpenRouter model id (passed through to the API). */
  id: string;
  name: string;
  provider: string;
  tier: WriterModelTier;
  bestFor: WriterBestForTag[];
  /** Rough relative cost (1 cheap … 4 premium), shown as dots. */
  cost: 1 | 2 | 3 | 4;
  featured?: boolean;
}

export const WRITER_MODELS: WriterModel[] = [
  // ── Nexus / Crafter tier — showrunner-grade reasoning ──
  // Kimi K3's 1M context lets the Nexus hold a whole manuscript at once, which
  // is why it's the default. It IS a reasoning model — see REASONING_MODELS.
  { id: "moonshotai/kimi-k3", name: "Kimi K3", provider: "Moonshot AI", tier: "nexus", bestFor: ["reasoning", "prose"], cost: 3, featured: true },
  { id: "anthropic/claude-sonnet-4.5", name: "Claude Sonnet 4.5", provider: "Anthropic", tier: "nexus", bestFor: ["reasoning", "prose"], cost: 3, featured: true },
  { id: "anthropic/claude-opus-4.5", name: "Claude Opus 4.5", provider: "Anthropic", tier: "nexus", bestFor: ["reasoning", "prose"], cost: 4 },
  { id: "openai/gpt-5.2", name: "GPT-5.2", provider: "OpenAI", tier: "nexus", bestFor: ["reasoning"], cost: 3 },
  { id: "google/gemini-2.5-pro", name: "Gemini 2.5 Pro", provider: "Google", tier: "nexus", bestFor: ["reasoning", "fast"], cost: 2 },
  { id: "deepseek/deepseek-r1", name: "DeepSeek R1", provider: "DeepSeek", tier: "nexus", bestFor: ["reasoning", "budget"], cost: 1 },

  // ── Character tier — cast actors with strong voice ──
  { id: "nousresearch/hermes-3-llama-3.1-70b", name: "Hermes 3 70B", provider: "Nous Research", tier: "character", bestFor: ["roleplay", "budget"], cost: 1, featured: true },
  { id: "nousresearch/hermes-3-llama-3.1-405b", name: "Hermes 3 405B", provider: "Nous Research", tier: "character", bestFor: ["roleplay", "prose"], cost: 2 },
  { id: "nousresearch/hermes-4-70b", name: "Hermes 4 70B", provider: "Nous Research", tier: "character", bestFor: ["roleplay"], cost: 2 },
  { id: "nousresearch/hermes-4-405b", name: "Hermes 4 405B", provider: "Nous Research", tier: "character", bestFor: ["roleplay", "prose"], cost: 3 },
  { id: "meta-llama/llama-3.3-70b-instruct", name: "Llama 3.3 70B", provider: "Meta", tier: "character", bestFor: ["roleplay", "budget"], cost: 1 },
  { id: "mistralai/mixtral-8x22b-instruct", name: "Mixtral 8x22B", provider: "Mistral", tier: "character", bestFor: ["roleplay", "fast"], cost: 2 },
  { id: "gryphe/mythomax-l2-13b", name: "MythoMax 13B", provider: "Gryphe", tier: "character", bestFor: ["roleplay", "uncensored", "budget"], cost: 1 },
  { id: "qwen/qwen-2.5-72b-instruct", name: "Qwen 2.5 72B", provider: "Qwen", tier: "character", bestFor: ["roleplay", "budget"], cost: 1 },
  { id: "anthropic/claude-sonnet-4.5", name: "Claude Sonnet 4.5 (as actor)", provider: "Anthropic", tier: "character", bestFor: ["prose", "roleplay"], cost: 3 },
];

export const DEFAULT_NEXUS_MODEL_ID = "moonshotai/kimi-k3";
export const DEFAULT_CHARACTER_MODEL_ID = "nousresearch/hermes-3-llama-3.1-70b";

export function writerModelsByTier(tier: WriterModelTier): WriterModel[] {
  return WRITER_MODELS.filter((m) => m.tier === tier);
}

export function writerModelName(id: string): string {
  return WRITER_MODELS.find((m) => m.id === id)?.name ?? id;
}
