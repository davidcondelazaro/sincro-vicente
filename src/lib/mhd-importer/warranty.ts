// Marca de ampliación de garantía de cada producto (custom.admite_garantia), decidida al importar (David, 2026-10-28):
// el tema y el chatbot solo la leen; el tema pone tramos, productos de garantía y precio mínimo. Criterio, el de
// Garantía3: todo lo eléctrico o electrónico (theme-enterprise-vicente/docs/garantias-por-familia.md). En este orden:
// 1. La primera regla de su familia en store_warranty_title_rules (por `position`) cuyo patrón casa con el título.
// 2. La casilla de su familia en store_collections (`warranty_eligible`).
// 3. Familia sin decidir (null): no se escribe la marca y el tema usa su lista de tipos; hay que decidirla en la tabla.
// Se leen una vez por hora. Cuando MHD mande su propio dato, pasa a ser la fuente y estas tablas quedan para corregir.
import type { SupabaseClient } from "@supabase/supabase-js";

type Rule = { pattern: RegExp; eligible: boolean };
let warrantyCache: { at: number; byFamily: Map<string, boolean | null>; rules: Map<string, Rule[]> } | null = null;

export async function warrantyEligible(db: SupabaseClient, family: string, title: string): Promise<{ eligible: boolean | null; reason: string }> {
  if (!warrantyCache || Date.now() - warrantyCache.at > 3_600_000) {
    const [{ data: families, error: familiesError }, { data: rows, error: rulesError }] = await Promise.all([
      db.from("store_collections").select("handle,warranty_eligible").eq("level", "familia"),
      db.from("store_warranty_title_rules").select("family_handle,pattern,eligible,position").order("position"),
    ]);
    if (familiesError) throw familiesError;
    if (rulesError) throw rulesError;
    const rules = new Map<string, Rule[]>();
    for (const row of rows as { family_handle: string; pattern: string; eligible: boolean }[]) {
      rules.set(row.family_handle, [...(rules.get(row.family_handle) ?? []), { pattern: new RegExp(row.pattern, "i"), eligible: row.eligible }]);
    }
    warrantyCache = { at: Date.now(), byFamily: new Map((families as { handle: string; warranty_eligible: boolean | null }[]).map((row) => [row.handle, row.warranty_eligible])), rules };
  }
  const rule = warrantyCache.rules.get(family)?.find((item) => item.pattern.test(title));
  if (rule) return { eligible: rule.eligible, reason: `regla por título (${rule.pattern.source})` };
  const eligible = warrantyCache.byFamily.get(family) ?? null;
  return { eligible, reason: eligible === null ? `familia «${family}» sin decidir en store_collections.warranty_eligible` : `familia «${family}»` };
}
