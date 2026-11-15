// Cambia en las descripciones de las garantías y de la colección «garantias» los PDF de la web de Garantía3 por nuestra
// copia en Shopify (docs/garantia3-reglamentos). 2026-11-15. Guarda antes una copia de lo que cambia.
import { writeFileSync } from "node:fs";
import { gql } from "./sh.mjs";
const CDN = "https://cdn.shopify.com/s/files/1/0994/3269/4092/files/";
const MAPA = {
  "https://www.garantia3.es/wp-content/uploads/2022/01/Reglamento-G3-2-anos_n.pdf": CDN + "garantia3-reglamento-2-anos-mas.pdf",
  "https://www.garantia3.es/wp-content/uploads/2026/01/Reglamento-G3-3-anos_2026.pdf": CDN + "garantia3-reglamento-3-anos-mas.pdf",
  "https://www.garantia3.es/wp-content/uploads/2021/09/Reglamento-G3-Combi.pdf": CDN + "garantia3-reglamento-combi.pdf",
  "https://www.garantia3.es/wp-content/uploads/2021/02/Reglamento-G3-Display.pdf": CDN + "garantia3-reglamento-display.pdf",
};
for (const url of Object.values(MAPA)) { const r = await fetch(url, { method: "HEAD" }); if (!r.ok) throw new Error(`${url}: ${r.status}`); }
const cambia = (html) => Object.entries(MAPA).reduce((h, [de, a]) => h.split(de).join(a), html);
const d = await gql(`{ products(first:30, query:"vendor:GARANTIA3"){ nodes{ id handle descriptionHtml } } collectionByHandle(handle:"garantias"){ id descriptionHtml } }`);
const antes = { productos: {}, coleccion: d.collectionByHandle.descriptionHtml };
for (const p of d.products.nodes) {
  const nuevo = cambia(p.descriptionHtml);
  if (nuevo === p.descriptionHtml) continue;
  antes.productos[p.handle] = p.descriptionHtml;
}
writeFileSync("../garantias-descripciones-antes-reglamentos-2026-11-15.json", JSON.stringify(antes, null, 1));
for (const p of d.products.nodes) {
  const nuevo = cambia(p.descriptionHtml);
  if (nuevo === p.descriptionHtml) continue;
  const r = await gql(`mutation($p:ProductUpdateInput!){ productUpdate(product:$p){ userErrors{ message } } }`, { p: { id: p.id, descriptionHtml: nuevo } });
  console.log(p.handle, JSON.stringify(r.productUpdate.userErrors));
}
const c = d.collectionByHandle;
const r = await gql(`mutation($c:CollectionInput!){ collectionUpdate(input:$c){ userErrors{ message } } }`, { c: { id: c.id, descriptionHtml: cambia(c.descriptionHtml) } });
console.log("colección garantias", JSON.stringify(r.collectionUpdate.userErrors));
