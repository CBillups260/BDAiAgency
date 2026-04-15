import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const EMBEDDING_MODEL = "gemini-embedding-exp-03-07";

export interface EmbeddingInput {
  text?: string;
  media?: { base64: string; mimeType: string };
}

export interface EmbeddingResult {
  values: number[];
  dimensions: number;
}

export async function generateEmbedding(
  input: EmbeddingInput,
): Promise<EmbeddingResult> {
  const parts: any[] = [];

  if (input.media) {
    parts.push({
      inlineData: { data: input.media.base64, mimeType: input.media.mimeType },
    });
  }

  if (input.text) {
    parts.push({ text: input.text });
  }

  if (parts.length === 0) {
    throw new Error("At least one of text or media is required.");
  }

  const response = await ai.models.embedContent({
    model: EMBEDDING_MODEL,
    contents: [{ role: "user", parts }],
  });

  const values = (response as any).embeddings?.[0]?.values
    ?? (response as any).embedding?.values
    ?? [];

  return { values, dimensions: values.length };
}

export async function generateEmbeddings(
  inputs: EmbeddingInput[],
): Promise<EmbeddingResult[]> {
  return Promise.all(inputs.map(generateEmbedding));
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) throw new Error("Vector dimension mismatch");
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  return denominator === 0 ? 0 : dotProduct / denominator;
}
