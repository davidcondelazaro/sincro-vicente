// Pieza del importador: opiniones que ya tenemos de un producto (tabla store_product_reviews, de Trusted Shops), casadas
// por EAN, y el resumen de Elvi (decidido 2026-10-23, mientras no haya motor de opiniones elegido). Van al metacampo
// `custom.opiniones` (JSON) para que el tema las pinte en «Opiniones». Sin datos personales: no se guardan nombres.
import type Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { costUsd, PROCESSOR_MODEL } from "./ai";

export type StoreReview = { rating: number; title: string | null; body: string | null; reply: string | null; reviewed_at: string | null };
export type ReviewsSummary = { summary: string; liked: string[]; disliked: string[] };
export type ReviewsMetafield = {
  source: "trusted_shops"; count: number; average: number;
  summary: ReviewsSummary | null;                // solo con MIN_REVIEWS_FOR_SUMMARY opiniones con texto o más
  reviews: { rating: number; title: string | null; body: string | null; date: string | null; reply: string | null }[];
};

export const MIN_REVIEWS_FOR_SUMMARY = 3;
const withText = (review: StoreReview) => (review.body ?? "").trim().length >= 20;

export async function productReviews(db: SupabaseClient, ean: string | null) {
  if (!ean) return [];
  const { data, error } = await db.from("store_product_reviews").select("rating,title,body,reply,reviewed_at,gtin").eq("status", "APPROVED").in("gtin", [ean, ean.replace(/^0+/, ""), ean.padStart(13, "0"), ean.padStart(14, "0")]).order("reviewed_at", { ascending: false });
  if (error) throw new Error(`No se pudieron leer las opiniones (${error.message}).`);
  return (data ?? []) as StoreReview[];
}

const schema = { type: "object", additionalProperties: false, required: ["summary", "liked", "disliked"], properties: { summary: { type: "string" }, liked: { type: "array", items: { type: "string" } }, disliked: { type: "array", items: { type: "string" } } } };

export async function summarizeReviews(client: Anthropic, productTitle: string, reviews: StoreReview[]) {
  const texts = reviews.filter(withText);
  if (texts.length < MIN_REVIEWS_FOR_SUMMARY) return { summary: null, costUsd: 0 };
  const input = texts.map((review) => ({ nota: review.rating, titulo: review.title, texto: review.body }));
  const message = await client.messages.create({ model: PROCESSOR_MODEL, max_tokens: 1200, output_config: { effort: "low", format: { type: "json_schema", schema } }, messages: [{ role: "user", content: `Eres Elvi, de Electrónica Vicente. Resume, tuteando, lo que opinan los clientes que compraron «${productTitle}» en nuestra tienda.\nReglas: solo lo que dicen las opiniones (nada de datos técnicos ni de tu cosecha); en liked y disliked, solo lo que aparece en dos opiniones o más (si no hay nada así, la lista vacía); no culpes al producto de lo que no depende de él (transporte, montaje, la tienda); sin cifras inventadas; nunca nombres a clientes. summary: 1 o 2 frases para el cliente que mira la ficha, sobre el tono general de las opiniones; no hables de cuántas opiniones hay, de lo largas que son ni de estas reglas. liked y disliked: como mucho 4 puntos cortos cada una.\n\n${JSON.stringify(input)}` }] });
  const summary = JSON.parse(message.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("")) as ReviewsSummary;
  return { summary: { ...summary, liked: summary.liked.slice(0, 4), disliked: summary.disliked.slice(0, 4) }, costUsd: costUsd(PROCESSOR_MODEL, message.usage) ?? 0 };
}

export async function reviewsMetafield(db: SupabaseClient, client: Anthropic, ean: string | null, productTitle: string) {
  const reviews = await productReviews(db, ean);
  if (!reviews.length) return { metafield: null, costUsd: 0 };
  const { summary, costUsd: cost } = await summarizeReviews(client, productTitle, reviews);
  const average = Math.round((reviews.reduce((total, review) => total + review.rating, 0) / reviews.length) * 10) / 10;
  const metafield: ReviewsMetafield = { source: "trusted_shops", count: reviews.length, average, summary, reviews: reviews.map((review) => ({ rating: review.rating, title: review.title?.trim() === review.body?.trim() ? null : review.title, body: review.body, date: review.reviewed_at?.slice(0, 10) ?? null, reply: review.reply })) };
  return { metafield, costUsd: cost };
}
