import fs from "node:fs";
import { gql } from "./sh.mjs";
const dir = new URL("./imgs/", import.meta.url).pathname;
const mapa = { "10052432":"garantia3-combi-250.jpg","10040607":"garantia3-combi-500.jpg","10052433":"garantia3-combi-1000.jpg","10052434":"garantia3-combi-2000.jpg","10040600":"garantia3-display-150.jpg","10040628":"garantia3-display-250.jpg","10040601":"garantia3-display-500.jpg","10040602":"garantia3-display-1000.jpg","10040603":"garantia3-display-1500.jpg" };
for (const [sku, file] of Object.entries(mapa)) {
  const pr = await gql(`query($q:String!){ productVariants(first:1, query:$q){ nodes{ product{ id title media(first:5){ nodes{ id } } } } } }`, { q: `sku:${sku}` });
  const p = pr.productVariants.nodes[0].product;
  if (p.media.nodes.length) { console.log("ya tiene imagen, salto", sku); continue; }
  const buf = fs.readFileSync(dir + file);
  const st = await gql(`mutation($i:[StagedUploadInput!]!){ stagedUploadsCreate(input:$i){ stagedTargets{ url resourceUrl parameters{ name value } } userErrors{ message } } }`, { i: [{ filename: file, mimeType: "image/jpeg", resource: "IMAGE", httpMethod: "POST", fileSize: String(buf.length) }] });
  const t = st.stagedUploadsCreate.stagedTargets[0];
  const fd = new FormData(); for (const x of t.parameters) fd.append(x.name, x.value); fd.append("file", new Blob([buf], { type: "image/jpeg" }), file);
  const up = await fetch(t.url, { method: "POST", body: fd }); if (!up.ok) throw new Error("subida " + up.status + " " + await up.text());
  const r = await gql(`mutation($p:ProductUpdateInput!,$m:[CreateMediaInput!]){ productUpdate(product:$p, media:$m){ product{ media(first:5){ nodes{ status } } } userErrors{ field message } } }`, { p: { id: p.id }, m: [{ originalSource: t.resourceUrl, mediaContentType: "IMAGE", alt: p.title }] });
  console.log(sku, file, JSON.stringify(r.productUpdate.userErrors), r.productUpdate.product?.media.nodes.map(n=>n.status).join(","));
}
