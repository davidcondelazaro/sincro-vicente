// Cambia el SKU de las 9 garantías antiguas (+2 y +3) al código de MHD (2026-11-15, David).
// Sin --escribir solo comprueba. Guarda copia de antes en outputs/garantias-9-sku-antes-2026-11-15.json.
import fs from "node:fs";
import { gql } from "./sh.mjs";
const MAPA = { G3PDES250: ["10040604", "8033509880271"], G3PDES500: ["10040586", "8033509880394"], G3PDES1000: ["10040587", "8033509880400"],
  G3PDES2000: ["10040588", "8033509880417"], G3PDES5000: ["10040589", "8033509880424"], G3PD3ES250: ["10040613", "8033509887652"],
  G3PD3ES500: ["10040614", "8033509887669"], G3PD3ES1000: ["10040611", "8033509887676"], G3PD3ES2000: ["10040612", "8033509887683"] };
const escribir = process.argv.includes("--escribir");
const d = await gql(`{ products(first: 30, query: "vendor:GARANTIA3") { nodes { id title metafield(namespace:"custom",key:"referencia"){ value } variants(first:5){ nodes { id sku barcode } } } } }`);
const antes = []; const cambios = []; let mal = 0;
for (const p of d.products.nodes) {
  const ref = p.metafield?.value; if (!MAPA[ref]) continue;
  const [codigo, ean] = MAPA[ref]; const v = p.variants.nodes;
  if (v.length !== 1) { console.log("✗ varias variantes", ref); mal++; continue; }
  if (v[0].barcode !== ean) { console.log("✗ EAN distinto", ref, v[0].barcode, ean); mal++; continue; }
  const ocupado = await gql(`query($q:String!){ productVariants(first:5, query:$q){ nodes { id sku product { title vendor } } } }`, { q: `sku:${codigo}` });
  const otros = ocupado.productVariants.nodes.filter((n) => n.id !== v[0].id && n.sku === codigo);
  if (otros.length) { console.log("✗ código ya usado", codigo, otros.map((o) => o.product.title)); mal++; continue; }
  antes.push({ ref, product_id: p.id, variant_id: v[0].id, sku: v[0].sku, barcode: v[0].barcode, title: p.title });
  cambios.push({ ref, productId: p.id, variantId: v[0].id, de: v[0].sku, a: codigo });
}
console.log(`${cambios.length} para cambiar, ${mal} con problemas`); for (const c of cambios) console.log(`  ${c.ref}: ${c.de} → ${c.a}`);
if (!escribir || mal || cambios.length !== 9) process.exit(0);
fs.writeFileSync("/Users/dconde/Desarrollo/importacion-vicente/sincro-vicente/outputs/garantias-9-sku-antes-2026-11-15.json", JSON.stringify(antes, null, 2));
for (const c of cambios) {
  const r = await gql(`mutation($p:ID!,$v:[ProductVariantsBulkInput!]!){ productVariantsBulkUpdate(productId:$p, variants:$v){ productVariants { sku } userErrors { field message } } }`,
    { p: c.productId, v: [{ id: c.variantId, inventoryItem: { sku: c.a } }] });
  const e = r.productVariantsBulkUpdate.userErrors; console.log(e.length ? `✗ ${c.ref} ${JSON.stringify(e)}` : `✓ ${c.ref} → ${r.productVariantsBulkUpdate.productVariants[0].sku}`);
}
