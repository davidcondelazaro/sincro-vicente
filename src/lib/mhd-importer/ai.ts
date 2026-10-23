// Modelos y coste de las llamadas de IA del importador. Precios en dólares por millón de tokens (2026-10).
import type Anthropic from "@anthropic-ai/sdk";

export const ANALYST_MODEL = "claude-opus-5-5";   // analista: una vez por familia
export const PROCESSOR_MODEL = "claude-haiku-5-5"; // procesador: una vez por producto

const PRICES: Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number }> = {
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  // Haiku 5.5 hasta 100K tokens de entrada (por encima, 0,50 / 2,50).
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
};

export type Usage = Pick<Anthropic.Usage, "input_tokens" | "output_tokens"> & { cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null };
export function costUsd(model: string, usage: Usage) {
  const price = PRICES[model];
  if (!price) return null;
  return (usage.input_tokens * price.input + usage.output_tokens * price.output + (usage.cache_read_input_tokens ?? 0) * price.cacheRead + (usage.cache_creation_input_tokens ?? 0) * price.cacheWrite) / 1_000_000;
}

export function anthropicKey(env: Record<string, string | undefined>) {
  const key = env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("Falta ANTHROPIC_API_KEY en el entorno (.env.local en local, secretos en producción).");
  return key;
}
