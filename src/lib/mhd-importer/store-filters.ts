// Pieza del importador: vocabulario actual de los filtros de la tienda (metacampos `filtro.*` y la eficiencia),
// leído de Shopify en solo lectura. El analista lo usa para que los valores nuevos coincidan letra por letra con los
// que ya usan las colecciones y landings (comparan el texto literal). Ver docs/IMPORTADOR_PRODUCTOS_MHD.md.

export type ShopifyConfig = { storeUrl: string; accessToken: string; apiVersion?: string };
export type FilterDefinition = { key: string; name: string; type: string; description: string; collectionCondition: boolean; choices: string[] | null };
export type FilterVocabulary = {
  definitions: FilterDefinition[];
  // filtro → valor → nº de productos; y además por tipo de producto (la categoría actual de la tienda).
  values: Record<string, Record<string, number>>;
  byProductType: Record<string, Record<string, Record<string, number>>>;
  products: number; readAt: string;
};

export function shopifyConfigFromEnv(env: Record<string, string | undefined>): ShopifyConfig {
  if (!env.SHOPIFY_STORE_URL || !env.SHOPIFY_ACCESS_TOKEN) throw new Error("Faltan SHOPIFY_STORE_URL o SHOPIFY_ACCESS_TOKEN.");
  return { storeUrl: env.SHOPIFY_STORE_URL, accessToken: env.SHOPIFY_ACCESS_TOKEN };
}

export async function shopifyGraphql<T>(config: ShopifyConfig, query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const host = config.storeUrl.replace(/^https?:\/\//, "").replace(/\/$/, "");
  const response = await fetch(`https://${host}/admin/api/${config.apiVersion ?? "2026-07"}/graphql.json`, { method: "POST", headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": config.accessToken }, body: JSON.stringify({ query, variables }), signal: AbortSignal.timeout(60_000) });
  const body = await response.json().catch(() => null) as { data?: T; errors?: unknown } | null;
  if (!response.ok || !body?.data || body.errors) throw new Error(`Shopify respondió con error (HTTP ${response.status}): ${JSON.stringify(body?.errors ?? "").slice(0, 300)}`);
  return body.data;
}

const FILTER_KEYS = (definition: { namespace: string; key: string }) => definition.namespace === "filtro" || (definition.namespace === "features" && definition.key === "eficiencia_energ_tica");

export async function readFilterVocabulary(config: ShopifyConfig): Promise<FilterVocabulary> {
  type Definitions = { metafieldDefinitions: { nodes: { namespace: string; key: string; name: string; description: string | null; type: { name: string }; validations: { name: string; value: string }[]; capabilities: { smartCollectionCondition: { enabled: boolean } } }[] } };
  const defs = await shopifyGraphql<Definitions>(config, `{ metafieldDefinitions(first: 100, ownerType: PRODUCT) { nodes { namespace key name description type { name } validations { name value } capabilities { smartCollectionCondition { enabled } } } } }`);
  const definitions = defs.metafieldDefinitions.nodes.filter(FILTER_KEYS).map((definition) => {
    const choices = definition.validations.find((validation) => validation.name === "choices")?.value;
    return { key: `${definition.namespace}.${definition.key}`, name: definition.name, type: definition.type.name, description: definition.description ?? "", collectionCondition: definition.capabilities.smartCollectionCondition.enabled, choices: choices ? JSON.parse(choices) as string[] : null };
  }).sort((a, b) => a.key.localeCompare(b.key));
  type Page = { products: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: { productType: string; f: { nodes: { key: string; type: string; value: string }[] }; e: { value: string } | null }[] } };
  const values: FilterVocabulary["values"] = {}; const byProductType: FilterVocabulary["byProductType"] = {};
  let after: string | null = null; let products = 0;
  do {
    const page: Page = await shopifyGraphql<Page>(config, `query($after: String) { products(first: 250, after: $after) { pageInfo { hasNextPage endCursor } nodes { productType f: metafields(first: 40, namespace: "filtro") { nodes { key type value } } e: metafield(namespace: "features", key: "eficiencia_energ_tica") { value } } } }`, { after });
    for (const product of page.products.nodes) {
      products += 1;
      const fields = product.f.nodes.map((field) => ({ key: `filtro.${field.key}`, list: field.type.startsWith("list."), value: field.value }));
      if (product.e) fields.push({ key: "features.eficiencia_energ_tica", list: false, value: product.e.value });
      for (const field of fields) {
        const items = field.list ? JSON.parse(field.value) as string[] : [field.value];
        for (const item of items) {
          (values[field.key] ??= {})[item] = (values[field.key][item] ?? 0) + 1;
          const type = ((byProductType[product.productType || "(sin tipo)"] ??= {})[field.key] ??= {});
          type[item] = (type[item] ?? 0) + 1;
        }
      }
    }
    after = page.products.pageInfo.hasNextPage ? page.products.pageInfo.endCursor : null;
  } while (after);
  return { definitions, values, byProductType, products, readAt: new Date().toISOString() };
}
