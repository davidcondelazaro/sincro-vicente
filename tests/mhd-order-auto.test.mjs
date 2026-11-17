import assert from "node:assert/strict";
import test from "node:test";
import { decidirEnvio, enHorarioLaboral, enviadoEnMhd, horaEnMadrid, listoParaExportarAuto } from "../src/lib/mhd-order-auto-rules.ts";

test("envío automático: solo con estado enviado y un único seguimiento", () => {
  const uno = [{ carrier_name: "TDN", tracking_number: "30500000099", carrier_url: "https://tdn.example/30500000099" }];
  assert.deepEqual(decidirEnvio(10, "Enviado", uno), { accion: "marcar", company: "TDN", number: "30500000099", url: "https://tdn.example/30500000099" });
  assert.equal(decidirEnvio(9, "Procesado", uno).accion, "esperar");
  assert.equal(decidirEnvio(13, "Cancelado", uno).accion, "esperar");
  assert.equal(decidirEnvio(12, "Finalizado", uno).accion, "marcar");
  assert.equal(decidirEnvio(10, "Enviado", []).accion, "revisar");
  assert.equal(decidirEnvio(10, "Enviado", [...uno, { tracking_number: "2" }]).accion, "revisar");
  assert.equal(decidirEnvio(10, "Enviado", [{ carrier_name: "X", tracking_number: "1", carrier_url: "tdn.es" }]).url, null);
  assert.equal(enviadoEnMhd(null, "En tránsito"), true);
});

test("exportación automática: corte, margen y estado previo", () => {
  const ahora = new Date("2026-11-17T12:00:00Z");
  const base = { elegible: true, creado: "2026-11-17T11:00:00Z", desde: "2026-11-17T10:00:00Z", margenMinutos: 30, ahora, estadoExportacion: null };
  assert.equal(listoParaExportarAuto(base), true);
  assert.equal(listoParaExportarAuto({ ...base, creado: "2026-11-17T11:45:00Z" }), false);
  assert.equal(listoParaExportarAuto({ ...base, creado: "2026-11-17T09:00:00Z" }), false);
  assert.equal(listoParaExportarAuto({ ...base, elegible: false }), false);
  assert.equal(listoParaExportarAuto({ ...base, desde: null }), false);
  assert.equal(listoParaExportarAuto({ ...base, estadoExportacion: "failed" }), true);
  assert.equal(listoParaExportarAuto({ ...base, estadoExportacion: "unknown" }), false);
});

test("horario de Madrid: hora del resumen y aviso de lunes a viernes de 9 a 20", () => {
  assert.equal(horaEnMadrid(new Date("2026-11-17T08:00:00Z")), 9); // invierno, UTC+1
  assert.equal(horaEnMadrid(new Date("2026-07-17T07:00:00Z")), 9); // verano, UTC+2
  assert.equal(enHorarioLaboral(new Date("2026-11-17T09:00:00Z")), true); // martes 10:00
  assert.equal(enHorarioLaboral(new Date("2026-11-17T19:30:00Z")), false); // martes 20:30
  assert.equal(enHorarioLaboral(new Date("2026-11-21T10:00:00Z")), false); // sábado
});
