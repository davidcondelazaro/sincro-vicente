// Sube los reglamentos de docs/garantia3-reglamentos a Shopify (Archivos) y los pone en custom.documentos de cada garantía.
// 2026-11-15. Cover no tiene: su reglamento da 404 en la web de Garantía3.
import { readFileSync } from "node:fs";
import { gql } from "./sh.mjs";
const DIR = "/Users/dconde/Desarrollo/importacion-vicente/sincro-vicente/docs/garantia3-reglamentos/";
const PDF = [
  { archivo: "garantia3-reglamento-2-anos-mas.pdf", alt: "Reglamento de Garantía3 2 años más", prefijo: /^G3PDES/ },
  { archivo: "garantia3-reglamento-3-anos-mas.pdf", alt: "Reglamento de Garantía3 3 años más", prefijo: /^G3PD3ES/ },
  { archivo: "garantia3-reglamento-combi.pdf", alt: "Reglamento de Garantía3 Combi", prefijo: /^G3E12/ },
  { archivo: "garantia3-reglamento-display.pdf", alt: "Reglamento de Garantía3 Display", prefijo: /^G3DPDES/ },
];
const productos = (await gql(`{ products(first:30, query:"vendor:GARANTIA3"){ nodes{ id ref: metafield(namespace:"custom", key:"referencia"){value} doc: metafield(namespace:"custom", key:"documentos"){value} } } }`)).products.nodes;
for (const pdf of PDF) {
  const ya = (await gql(`query($q:String!){ files(first:5, query:$q){ nodes{ id fileStatus ... on GenericFile { url } } } }`, { q: `filename:${pdf.archivo}` })).files.nodes;
  let id = ya[0]?.id;
  if (!id) {
    const bytes = readFileSync(DIR + pdf.archivo);
    const st = (await gql(`mutation($i:[StagedUploadInput!]!){ stagedUploadsCreate(input:$i){ stagedTargets{ url resourceUrl parameters{ name value } } userErrors{ message } } }`, { i: [{ resource: "FILE", filename: pdf.archivo, mimeType: "application/pdf", httpMethod: "POST", fileSize: String(bytes.length) }] })).stagedUploadsCreate;
    const t = st.stagedTargets[0];
    const form = new FormData();
    for (const p of t.parameters) form.append(p.name, p.value);
    form.append("file", new Blob([bytes], { type: "application/pdf" }), pdf.archivo);
    const up = await fetch(t.url, { method: "POST", body: form });
    if (!up.ok) throw new Error(`subida ${pdf.archivo}: ${up.status}`);
    const fc = (await gql(`mutation($f:[FileCreateInput!]!){ fileCreate(files:$f){ files{ id } userErrors{ message } } }`, { f: [{ originalSource: t.resourceUrl, contentType: "FILE", filename: pdf.archivo, alt: pdf.alt }] })).fileCreate;
    if (fc.userErrors.length) throw new Error(JSON.stringify(fc.userErrors));
    id = fc.files[0].id;
  }
  let url = null;
  for (let i = 0; i < 20 && !url; i++) {
    const f = (await gql(`query($id:ID!){ node(id:$id){ ... on GenericFile { fileStatus url } } }`, { id })).node;
    if (f?.fileStatus === "READY") url = f.url; else await new Promise(r => setTimeout(r, 1500));
  }
  console.log(pdf.archivo, id, url);
  const destino = productos.filter(p => pdf.prefijo.test(p.ref?.value ?? ""));
  const sets = destino.map(p => ({ ownerId: p.id, namespace: "custom", key: "documentos", type: "list.file_reference", value: JSON.stringify([id]) }));
  const ocupados = destino.filter(p => p.doc?.value && p.doc.value !== "[]" && p.doc.value !== JSON.stringify([id]));
  if (ocupados.length) throw new Error("ya tenían documentos: " + ocupados.map(p => p.ref.value).join(" "));
  const r = (await gql(`mutation($m:[MetafieldsSetInput!]!){ metafieldsSet(metafields:$m){ metafields{ id } userErrors{ message } } }`, { m: sets })).metafieldsSet;
  console.log("  en", destino.map(p => p.ref.value).join(" "), JSON.stringify(r.userErrors));
}
