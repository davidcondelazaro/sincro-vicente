// Recortes sobre negro de MHD (2026-10-31): se reconocen, ceden ante la misma foto sobre blanco y las fotos de marca
// sobre negro se quedan como están.
import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
import sharp from "sharp";

const jiti = createJiti(import.meta.url, { alias: { "@": new URL("../src", import.meta.url).pathname } });
const { hasBlackMatte, orderImages, processImage, whitenBlackMatte } = await jiti.import("../src/lib/mhd-importer/images.ts");

const scene = async (background, product) => new Uint8Array(await sharp({ create: { width: 600, height: 800, channels: 3, background } })
  .composite([{ input: await sharp({ create: { width: 400, height: 600, channels: 3, background: product } }).png().toBuffer(), left: 100, top: 100 }]).png().toBuffer());
const photo = (fields) => ({ url: "u", contentType: "image/jpeg", width: 1000, height: 1000, hash: "h", background: "blanco", source: "mhd", blackMatte: false, kind: "frontal", quality: "buena", duplicateOf: null, description: "", isMhdMain: false, ...fields });

test("negro de recorte: se reconoce el negro puro y no el fondo oscuro de estudio", async () => {
  assert.equal(await hasBlackMatte(await scene("#000000", "#e8e8e8")), true);
  assert.equal(await hasBlackMatte(await scene("#101014", "#e8e8e8")), false);
  assert.equal(await hasBlackMatte(await scene("#ffffff", "#e8e8e8")), false);
});

test("negro de recorte: la foto sobre blanco gana aunque tenga menos resolución", () => {
  const matte = photo({ url: "negra", width: 1817, height: 2000, background: "otro", blackMatte: true });
  const white = photo({ url: "blanca", width: 931, height: 1024, duplicateOf: 0 });
  const { keep, dropped } = orderImages([matte, white]);
  assert.deepEqual(keep.map((image) => image.url), ["blanca"]);
  assert.deepEqual(dropped.map((image) => image.url), ["negra"]);
});

test("foto de marca sobre negro: se queda la de más resolución, como hasta ahora", () => {
  const studio = photo({ url: "estudio", width: 1817, height: 2000, background: "negro" });
  const white = photo({ url: "blanca", width: 931, height: 1024, duplicateOf: 0 });
  assert.deepEqual(orderImages([studio, white]).keep.map((image) => image.url), ["estudio"]);
});

test("recorte sin foto blanca: el producto claro pasa a blanco y el oscuro se queda", async () => {
  const light = await processImage(await scene("#000000", "#e8e8e8"), { kind: "frontal", background: "otro", blackMatte: true });
  assert.equal(light.treatment, "negro a blanco, recortada y encuadrada");
  assert.equal(light.width, light.height);
  const corner = await sharp(light.bytes).extract({ left: 2, top: 2, width: 1, height: 1 }).raw().toBuffer();
  assert.ok(corner[0] > 245);
  assert.equal(await whitenBlackMatte(await scene("#000000", "#303030")), null);
  const dark = await processImage(await scene("#000000", "#303030"), { kind: "frontal", background: "negro", blackMatte: true });
  assert.equal(dark.treatment, "como viene");
});
