// Prepara, sin tocar Shopify, el arreglo de las fotos principales con recorte sobre negro (2026-10-31).
// Entrada: outputs/imagenes-negro-puro-revision.csv. Salida: outputs/fotos-negro-preparadas/ con cada foto nueva, un
// manifiesto y un montaje antes/después para revisar.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createJiti } from "jiti";
import sharp from "sharp";

const jiti = createJiti(import.meta.url, { alias: { "@": new URL("../src", import.meta.url).pathname } });
const { prepareImages, processImage } = await jiti.import("../src/lib/mhd-importer/images.ts");
const OUT = new URL("../outputs/fotos-negro-preparadas/", import.meta.url).pathname;
await mkdir(OUT, { recursive: true });
const KEEP = new Set(["10152109"]); // punto de acceso blanco: sobre blanco desaparece

const rows = (await readFile(new URL("../outputs/imagenes-negro-puro-revision.csv", import.meta.url), "utf8")).trim().split(/\r?\n/).slice(1).map((line) => {
  const [codigo, familia, posicion, vista, shopify, origen, sustitutas] = line.split(";");
  return { codigo, familia, posicion, vista, shopify, origen, sustitutas: sustitutas ? sustitutas.split(" ") : [] };
}).filter((row) => row.posicion === "0" && !KEEP.has(row.codigo));

// ¿Es la misma foto? Se compara el centro, porque los bordes son justo lo que cambia entre la negra y la blanca.
const centre = async (bytes) => {
  const { width, height } = await sharp(bytes).metadata();
  return sharp(bytes).flatten({ background: "#ffffff" }).extract({ left: Math.round(width * 0.2), top: Math.round(height * 0.2), width: Math.round(width * 0.6), height: Math.round(height * 0.6) }).greyscale().resize(32, 32, { fit: "fill" }).raw().toBuffer();
};
const sameCentre = async (a, b) => { const [x, y] = await Promise.all([centre(a), centre(b)]); let sum = 0; x.forEach((value, i) => { sum += Math.abs(value - y[i]); }); return sum / x.length < 14; };

const manifest = [];
for (const row of rows) {
  const entry = { ...row, arreglo: "sin arreglo", archivo: null, detalle: "" };
  manifest.push(entry);
  try {
    const { images: [source], errors } = await prepareImages([row.origen]);
    if (!source) { entry.detalle = errors.join(" "); continue; }
    if (!source.blackMatte) { entry.detalle = "En origen no se detecta recorte."; continue; }
    let file = null;
    const { images: twins } = await prepareImages(row.sustitutas);
    for (const twin of twins) {
      if (twin.blackMatte || twin.background !== "blanco" || Math.max(twin.width, twin.height) < 500 || !await sameCentre(source.bytes, twin.bytes)) continue;
      file = await processImage(twin.bytes, { kind: row.vista, background: "blanco", blackMatte: false });
      entry.arreglo = "foto blanca de MHD"; entry.detalle = twin.url; break;
    }
    if (!file) {
      const painted = await processImage(source.bytes, { kind: row.vista, background: source.background, blackMatte: true });
      if (painted.treatment.startsWith("negro a blanco")) { file = painted; entry.arreglo = "negro pintado de blanco"; }
    }
    if (!file) { entry.detalle = "Producto oscuro: se queda como está."; continue; }
    entry.archivo = `${row.codigo}.jpg`;
    await writeFile(`${OUT}${entry.archivo}`, file.bytes);
  } catch (caught) { entry.detalle = caught instanceof Error ? caught.message : String(caught); }
}
await writeFile(`${OUT}manifiesto.json`, JSON.stringify(manifest, null, 2));

const SIDE = 170; const GAP = 8; const COLUMNS = 4;
const fixed = manifest.filter((entry) => entry.archivo);
const tile = async (input) => sharp(input).resize(SIDE, SIDE, { fit: "contain", background: "#ff00cc" }).png().toBuffer();
const parts = (await Promise.all(fixed.map(async (entry, index) => {
  const before = Buffer.from(await (await fetch(`${entry.shopify}?width=340`)).arrayBuffer());
  const left = (index % COLUMNS) * (2 * SIDE + 3 * GAP); const top = Math.floor(index / COLUMNS) * (SIDE + GAP);
  return [{ input: await tile(before), left, top }, { input: await tile(`${OUT}${entry.archivo}`), left: left + SIDE + GAP, top }];
}))).flat();
if (parts.length) await sharp({ create: { width: COLUMNS * (2 * SIDE + 3 * GAP), height: Math.ceil(fixed.length / COLUMNS) * (SIDE + GAP), channels: 3, background: "#888888" } }).composite(parts).png().toFile(`${OUT}montaje-antes-despues.png`);
const count = {}; for (const entry of manifest) count[entry.arreglo] = (count[entry.arreglo] ?? 0) + 1;
console.log(count);
