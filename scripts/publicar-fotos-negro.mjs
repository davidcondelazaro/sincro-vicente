// Sustituye en Shopify la foto principal de los productos preparados por preparar-fotos-negro.mjs (2026-10-31). Cambia
// el archivo de la foto y conserva su sitio en la galería y su texto alternativo; lo demás del producto no se toca.
// Antes guarda el original en outputs/fotos-negro-preparadas/copia/. Uso: node scripts/publicar-fotos-negro.mjs [codigo]
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";

const OUT = new URL("../outputs/fotos-negro-preparadas/", import.meta.url).pathname;
await mkdir(`${OUT}copia`, { recursive: true });
for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) { const match = line.match(/^(SHOPIFY_[A-Z_]+)=(.*)$/); if (match) process.env[match[1]] = match[2].replace(/^["']|["']$/g, ""); }
const store = process.env.SHOPIFY_STORE_URL.replace(/^https?:\/\//, "").replace(/\/$/, "");
const graphql = async (query, variables) => {
  const response = await fetch(`https://${store}/admin/api/2026-07/graphql.json`, { method: "POST", headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": process.env.SHOPIFY_ACCESS_TOKEN }, body: JSON.stringify({ query, variables }), signal: AbortSignal.timeout(60_000) });
  const body = await response.json();
  if (!response.ok || body.errors) throw new Error(JSON.stringify(body.errors ?? response.status));
  return body.data;
};
const firstMedia = async (id) => (await graphql(`query($id: ID!) { product(id: $id) { media(first: 1) { nodes { ... on MediaImage { id fileStatus alt image { url width height } } } } } }`, { id })).product.media.nodes[0];

const only = process.argv[2];
const manifest = JSON.parse(await readFile(`${OUT}manifiesto.json`, "utf8")).filter((entry) => entry.archivo && (!only || entry.codigo === only));
const logPath = `${OUT}publicadas.json`;
const log = existsSync(logPath) ? JSON.parse(await readFile(logPath, "utf8")) : {};
for (const entry of manifest) {
  if (log[entry.codigo]?.estado === "publicada") continue;
  try {
    const media = await firstMedia(entry.pid);
    const name = decodeURIComponent(entry.shopify.split("/").pop());
    if (!media?.image?.url.includes(name.replace(/\.jpg$/, ""))) throw new Error(`La primera foto no es la esperada: ${media?.image?.url}`);
    const original = await fetch(media.image.url);
    if (!original.ok) throw new Error(`Sin copia del original (HTTP ${original.status}).`);
    await writeFile(`${OUT}copia/${entry.codigo}-${name}`, Buffer.from(await original.arrayBuffer()));
    const bytes = await readFile(`${OUT}${entry.archivo}`);
    const staged = await graphql(`mutation($input: [StagedUploadInput!]!) { stagedUploadsCreate(input: $input) { stagedTargets { url resourceUrl parameters { name value } } userErrors { message } } }`, { input: [{ filename: name, mimeType: "image/jpeg", resource: "IMAGE", httpMethod: "POST", fileSize: String(bytes.byteLength) }] });
    if (staged.stagedUploadsCreate.userErrors.length) throw new Error(JSON.stringify(staged.stagedUploadsCreate.userErrors));
    const target = staged.stagedUploadsCreate.stagedTargets[0]; const form = new FormData();
    for (const parameter of target.parameters) form.append(parameter.name, parameter.value);
    form.append("file", new Blob([bytes], { type: "image/jpeg" }), name);
    const uploaded = await fetch(target.url, { method: "POST", body: form, signal: AbortSignal.timeout(120_000) });
    if (!uploaded.ok) throw new Error(`Subida HTTP ${uploaded.status}.`);
    const updated = await graphql(`mutation($files: [FileUpdateInput!]!) { fileUpdate(files: $files) { files { id } userErrors { code message } } }`, { files: [{ id: media.id, originalSource: target.resourceUrl }] });
    if (updated.fileUpdate.userErrors.length) throw new Error(JSON.stringify(updated.fileUpdate.userErrors));
    let after = null;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      await new Promise((resolve) => { setTimeout(resolve, 2000); });
      after = await firstMedia(entry.pid);
      if (after?.fileStatus === "READY" && after.image?.url && after.image.url !== media.image.url) break;
      if (after?.fileStatus === "FAILED") throw new Error("Shopify marcó el archivo como fallido.");
    }
    log[entry.codigo] = { estado: after?.fileStatus === "READY" ? "publicada" : "sin confirmar", antes: media.image.url, despues: after?.image?.url, mediaId: media.id, ancho: after?.image?.width, alto: after?.image?.height, alt: after?.alt };
  } catch (caught) { log[entry.codigo] = { estado: "error", detalle: caught instanceof Error ? caught.message : String(caught) }; }
  await writeFile(logPath, JSON.stringify(log, null, 2));
  console.log(entry.codigo, log[entry.codigo].estado, log[entry.codigo].despues ?? log[entry.codigo].detalle ?? "");
}
