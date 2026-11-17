// Pruebas de lo que se manda a Google Merchant Center (src/lib/merchant/esperado.ts), 2026-11-17.
import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { alias: { "@": new URL("../src", import.meta.url).pathname } });
const { plazoEnDias, esperado, huella, entradaProducto, realDeMerchant, offerId, nombreProducto } = await jiti.import("../src/lib/merchant/esperado.ts");

const producto = (cambios = {}) => ({
  productId: "gid://shopify/Product/16238223196492", variantId: "gid://shopify/ProductVariant/59594416685388", codigo: "123", activo: true,
  opciones: { gastos_envio_peninsula_particulares: "7.99", gastos_envio_baleares_particulares: "36.99", gastos_envio_portugal_baremo_1_particulares: "10.03", gastos_envio_portugal_baremo_2_particulares: 12.41 },
  opcionesMhd: null, conStock: "Recíbelo en 3/4 días laborables", sinStock: "Recíbelo en 15 días laborables", stock: 5, eprel: null, ...cambios,
});

test("plazos: como el marcado del tema", () => {
  assert.deepEqual(plazoEnDias("Recíbelo en 3/4 días laborables"), [3, 4]);
  assert.deepEqual(plazoEnDias("Entrega en 72/96 horas"), [3, 4]);
  assert.deepEqual(plazoEnDias("En 3 semanas"), [15, 15]);
  assert.deepEqual(plazoEnDias("En 6/8 días."), [6, 8]);
  assert.deepEqual(plazoEnDias("Recíbelo en 15 días laborables"), [15, 15]);
  assert.equal(plazoEnDias("Consultar"), null);
  assert.equal(plazoEnDias(null), null);
});

test("porte: península en España y baremo 2 en Portugal", () => {
  assert.equal(esperado(producto(), "ES").porte, "7.99");
  assert.equal(esperado(producto(), "PT").porte, "12.41");
  assert.equal(esperado(producto(), "ES").origen, "metacampo");
});

test("plazo: con stock o sin stock (venta sin stock de BSH y Electrolux)", () => {
  assert.deepEqual(esperado(producto(), "ES").transito, [3, 4]);
  assert.deepEqual(esperado(producto({ stock: 0 }), "ES").transito, [15, 15]);
  assert.notEqual(huella(esperado(producto(), "ES")), huella(esperado(producto({ stock: 0 }), "ES")));
});

test("sin metacampo: último porte conocido de MHD; sin ninguno, nada", () => {
  const mhd = { gastos_envio_peninsula_particulares: "9.90", gastos_envio_portugal_baremo_2_particulares: null };
  assert.equal(esperado(producto({ opciones: null, opcionesMhd: mhd }), "ES").porte, "9.90");
  assert.equal(esperado(producto({ opciones: null, opcionesMhd: mhd }), "ES").origen, "ultimo-mhd");
  assert.equal(esperado(producto({ opciones: null, opcionesMhd: mhd }), "PT").porte, null);
  assert.equal(huella(esperado(producto({ opciones: null }), "ES")), null);
  // Con metacampo manda el metacampo aunque la zona venga vacía: no se rellena con MHD.
  assert.equal(esperado(producto({ opciones: { gastos_envio_peninsula_particulares: null }, opcionesMhd: mhd }), "ES").porte, null);
});

test("envío gratis (0) sí se manda; nunca un 0 inventado", () => {
  assert.equal(esperado(producto({ opciones: { gastos_envio_peninsula_particulares: 0 } }), "ES").porte, "0.00");
  assert.ok(huella(esperado(producto({ opciones: { gastos_envio_peninsula_particulares: 0 } }), "ES")));
});

test("entrada: solo el país de la fuente, con plazos y EPREL", () => {
  const oferta = offerId("gid://shopify/Product/16238223196492", "gid://shopify/ProductVariant/59594416685388");
  assert.equal(oferta, "shopify_ZZ_16238223196492_59594416685388");
  assert.equal(nombreProducto("PT", oferta), "es~EUR_103610450252~shopify_ZZ_16238223196492_59594416685388");
  const entrada = entradaProducto(oferta, "ES", esperado(producto({ eprel: " 1234567 " }), "ES"));
  assert.equal(entrada.feedLabel, "EUR_102307004748");
  assert.deepEqual(entrada.productAttributes.shipping, [{ country: "ES", price: { amountMicros: "7990000", currencyCode: "EUR" }, minHandlingTime: "0", maxHandlingTime: "0", minTransitTime: "3", maxTransitTime: "4" }]);
  assert.deepEqual(entrada.productAttributes.certifications, [{ certificationAuthority: "EC", certificationName: "EPREL", certificationCode: "1234567" }]);
  assert.equal(entradaProducto(oferta, "ES", esperado(producto(), "ES")).productAttributes.certifications, undefined);
});

test("lo que aplica Merchant Center se compara con lo esperado", () => {
  const datos = esperado(producto({ eprel: "1234567" }), "PT");
  const real = realDeMerchant({ productAttributes: { ...entradaProducto("x", "PT", datos).productAttributes, shipping: [{ country: "ES", price: { amountMicros: "1" } }, ...entradaProducto("x", "PT", datos).productAttributes.shipping] } }, "PT");
  assert.equal(huella(real), huella(datos));
  assert.equal(huella(realDeMerchant({}, "ES")), null);
});
