import assert from "node:assert/strict";
import test from "node:test";
import { APELLIDOS_EMPRESA, datosFiscalesMhd, nifDelPedido, pareceNif } from "../src/lib/mhd-order-fiscal.ts";

const persona = { firstName: "Ana", lastName: "García López" };
const campo = (value, key = "TAX_CREDENTIAL_ES") => ({ localizedFields: { nodes: [{ key, value }] } });

test("reconoce DNI, NIE, CIF y NIF portugués, y no nombres de empresa", () => {
  for (const valor of ["12345678Z", "12.345.678-z", "X1234567L", "B12345678", "ESB12345678", "123456789"]) assert.ok(pareceNif(valor), valor);
  for (const valor of ["Instituto Detailing - THOD", "Talleres Pérez S.L.", "", null, "1234"]) assert.ok(!pareceNif(valor), String(valor));
});

test("el NIF sale del campo fiscal del pago, de España o de Portugal", () => {
  assert.equal(nifDelPedido(campo(" b12345678 ")), "B12345678");
  assert.equal(nifDelPedido(campo("123456789", "TAX_CREDENTIAL_PT")), "123456789");
  assert.equal(nifDelPedido({ localizedFields: { nodes: [{ key: "SHIPPING_CREDENTIAL_BR", value: "x" }] } }), null);
});

test("sin campo fiscal, vale el DNI escrito en «Empresa» (pedidos antiguos); una empresa de verdad no", () => {
  assert.equal(nifDelPedido({ billingAddress: { company: "12345678z" } }), "12345678Z");
  assert.equal(nifDelPedido({ shippingAddress: { company: "X1234567L" } }), "X1234567L");
  assert.equal(nifDelPedido({ billingAddress: { company: "Talleres Pérez S.L." } }), null);
  // el campo fiscal manda sobre «Empresa»
  assert.equal(nifDelPedido({ ...campo("B12345678"), billingAddress: { company: "12345678Z" } }), "B12345678");
});

test("particular con NIF: va en facturación, no en envío, sin observaciones", () => {
  const datos = datosFiscalesMhd({ ...campo("12345678Z"), billingAddress: persona, shippingAddress: persona }, { facturacionExportable: true });
  assert.deepEqual(datos, { nif: "12345678Z", nifEnvio: null, facturacion: null, observaciones: null });
});

test("sin facturación exportable, el NIF va en el envío para no perderlo", () => {
  const datos = datosFiscalesMhd({ ...campo("12345678Z"), shippingAddress: persona }, { facturacionExportable: false });
  assert.equal(datos.nifEnvio, "12345678Z");
});

test("empresa de facturación con NIF: de nombre, apellidos vacíos y el contacto a observaciones", () => {
  const empresa = { ...persona, company: "Talleres Pérez S.L." };
  const datos = datosFiscalesMhd({ ...campo("B12345678"), billingAddress: empresa, shippingAddress: empresa }, { facturacionExportable: true });
  assert.deepEqual(datos.facturacion, { nombre: "Talleres Pérez S.L.", apellidos: APELLIDOS_EMPRESA });
  // Shopify copia el envío en la facturación: la misma empresa no se repite
  assert.equal(datos.observaciones, "Facturar a: Talleres Pérez S.L. (NIF B12345678). Contacto: Ana García López.");
});

test("empresa de facturación sin NIF: solo a observaciones, la factura sigue a nombre de la persona", () => {
  const datos = datosFiscalesMhd({ billingAddress: { ...persona, company: "Talleres Pérez S.L." } }, { facturacionExportable: true });
  assert.equal(datos.facturacion, null);
  assert.equal(datos.observaciones, "Empresa en la dirección de facturación: Talleres Pérez S.L. (sin NIF).");
});

test("empresa solo en la dirección de envío: a observaciones", () => {
  const datos = datosFiscalesMhd({ ...campo("12345678Z"), billingAddress: persona, shippingAddress: { ...persona, company: "Oficinas Norte" } }, { facturacionExportable: true });
  assert.equal(datos.facturacion, null);
  assert.equal(datos.observaciones, "Empresa en la dirección de envío: Oficinas Norte.");
});

test("empresas distintas en envío y facturación: las dos constan", () => {
  const datos = datosFiscalesMhd({ ...campo("B12345678"), billingAddress: { ...persona, company: "Talleres Pérez S.L." }, shippingAddress: { ...persona, company: "Nave 3" } }, { facturacionExportable: true });
  assert.equal(datos.observaciones, "Facturar a: Talleres Pérez S.L. (NIF B12345678). Contacto: Ana García López.\nEmpresa en la dirección de envío: Nave 3.");
});

test("en la recogida no se repite la empresa como empresa de envío", () => {
  const datos = datosFiscalesMhd({ billingAddress: persona, shippingAddress: { company: "Oficinas Norte" } }, { facturacionExportable: true, recogida: true });
  assert.equal(datos.observaciones, null);
});

test("el DNI escrito en «Empresa» no se trata como empresa", () => {
  const datos = datosFiscalesMhd({ billingAddress: { ...persona, company: "12345678Z" }, shippingAddress: { ...persona, company: "12345678Z" } }, { facturacionExportable: true });
  assert.deepEqual(datos, { nif: "12345678Z", nifEnvio: null, facturacion: null, observaciones: null });
});
