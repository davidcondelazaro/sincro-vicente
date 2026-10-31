// Pruebas de las recetas de complementos: compatibilidad, stock y permanencia de lo ya sugerido (2026-10-31).
import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { alias: { "@": new URL("../src", import.meta.url).pathname } });
const { computeComplements, mergeComplements } = await jiti.import("../src/lib/mhd-importer/complement-recipes.ts");

const product = (pid, t, title, pvp, stock, a = {}) => ({ pid, t, title, pvp, stock, marca: null, txt: "", a });
const monitor = product("m", "Monitores", 'Monitor Test 27"', 200, 3, { "Diagonal de la pantalla": '68,6 cm (27")', "Interfaz de panel de montaje": "100 x 100 mm", "Peso (sin base)": "4 kg", "Número de puertos HDMI": "1" });
const arm = (pid, stock, a = {}) => product(pid, "Soportes de TV y monitor", "Brazo de escritorio para monitor", 30, stock, { "Tipo de montaje": "Abrazadera", "Compatibilidad con interfaz de montaje (max)": "100 x 100 mm", "Compatibilidad con interfaz de montaje (min)": "75 x 75 mm", "Capacidad máxima de peso": "9 kg", "Tamaño mínimo de pantalla": '33 cm (13")', "Tamaño máximo de pantalla": '81,3 cm (32")', ...a });
const slots = (rows, previous) => computeComplements(rows, previous).get("m");

test("recetas: elige el compatible con stock suficiente", () => {
  assert.deepEqual(slots([monitor, arm("a", 20), arm("b", 4)]), [{ slot: "Brazo de escritorio", pid: "a" }]);
});

test("recetas: sin dato no hay sugerencia", () => {
  const sinVesa = { ...monitor, a: { ...monitor.a, "Interfaz de panel de montaje": undefined } };
  assert.deepEqual(slots([sinVesa, arm("a", 20)]), []);
});

test("recetas: descarta lo que no aguanta el peso con margen", () => {
  assert.deepEqual(slots([monitor, arm("a", 20, { "Capacidad máxima de peso": "4 kg" })]), []);
});

test("recetas: lo ya sugerido se queda aunque otro puntúe más, y sale si se agota", () => {
  const rows = [monitor, arm("nuevo", 20), arm("viejo", 2)];
  assert.equal(slots(rows, new Map([["m", ["viejo"]]]))[0].pid, "viejo");
  assert.equal(slots([monitor, arm("nuevo", 20), arm("viejo", 0)], new Map([["m", ["viejo"]]]))[0].pid, "nuevo");
});

test("recetas: la receta va delante, sin repetir y hasta 10", () => {
  const icecat = ["a", ...Array.from({ length: 12 }, (_, i) => `i${i}`)];
  const merged = mergeComplements([{ slot: "x", pid: "a" }, { slot: "y", pid: "b" }], icecat);
  assert.equal(merged.length, 10);
  assert.deepEqual(merged.slice(0, 3), ["a", "b", "i0"]);
});
