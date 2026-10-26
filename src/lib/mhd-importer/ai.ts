// Modelos y coste de las llamadas de IA del importador. Precios en dólares por millón de tokens (2026-10).
import type Anthropic from "@anthropic-ai/sdk";

// Llamadas largas del procesador por partes (2026-10-26): sin respuesta por partes, algunas peticiones se cortaban a los
// 32 s justos («Request timed out», en rachas de 3 o 4 a la vez) mientras la IA aún pensaba. Con el stream la conexión
// recibe datos todo el rato; el resultado es el mismo mensaje completo.
export function createStreamed(client: Anthropic, params: Parameters<Anthropic["messages"]["stream"]>[0]) {
  return client.messages.stream(params).finalMessage();
}

export const ANALYST_MODEL = "claude-opus-5-5";   // analista: una vez por familia
export const PROCESSOR_MODEL = "claude-haiku-5-5"; // procesador: una vez por producto
// Elvi aparte (prueba del 2026-10-26): con un modelo de más razonamiento, una vez redactada la ficha.
export const ELVI_MODELS = { haiku: "claude-haiku-5-5", sonnet: "claude-sonnet-5-5" } as const;
export const JUDGE_MODEL = "claude-opus-5-5";      // juez Claude: una vez por familia (ver judges.ts)
export const MATCHER_MODEL = "claude-haiku-5-5";   // calibración de los jueces: empareja propuestas y cambios de David
// El juez OpenAI usa el modelo de OPENAI_JUDGE_MODEL. Su precio no está aquí (no lo conocemos con seguridad): para
// esos modelos costUsd devuelve null y los scripts lo dicen. Si se añade, la clave es el nombre exacto del modelo que
// devuelve la API, con los mismos campos (cacheRead = entrada en caché; cacheWrite = 0 en OpenAI).

const PRICES: Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number }> = {
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  // Haiku 5.5 hasta 100K tokens de entrada (por encima, 0,50 / 2,50).
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
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
