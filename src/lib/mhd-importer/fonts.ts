// Tipos de letra para dibujar las etiquetas energéticas en SVG (2026-10-26). El SVG oficial de EPREL escribe sus
// textos con Calibri y Verdana; en Vercel no hay ningún tipo de letra instalado y cada letra salía como un cuadradito.
// Se llevan dentro del proyecto (carpeta fonts/) dos equivalentes libres: Carlito (mismas medidas que Calibri, OFL) y
// DejaVu Sans (en lugar de Verdana, licencia libre), y se le dice a la librería de imágenes que use solo esos.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const FAMILIES: [from: string, to: string, bold: boolean][] = [
  ["Calibri", "Carlito", false], ["Calibri-Bold", "Carlito", true], ["Carlito", "Carlito", false],
  ["Verdana", "DejaVu Sans", false], ["Verdana-Bold", "DejaVu Sans", true], ["Arial", "DejaVu Sans", false], ["Arial-Bold", "DejaVu Sans", true],
  ["Helvetica", "DejaVu Sans", false], ["sans-serif", "DejaVu Sans", false],
];

let ready = false;
// Se llama antes de dibujar un SVG; tiene que ir antes de que la librería cargue los tipos de letra por primera vez.
export function loadBundledFonts() {
  if (ready) return;
  ready = true;
  const dir = path.join(process.cwd(), "fonts");
  if (!fs.existsSync(dir)) return;
  const rules = FAMILIES.map(([from, to, bold]) => `<match target="pattern"><test name="family"><string>${from}</string></test><edit name="family" mode="assign" binding="strong"><string>${to}</string></edit>${bold ? '<edit name="weight" mode="assign"><const>bold</const></edit>' : ""}</match>`).join("");
  const config = `<?xml version="1.0"?><!DOCTYPE fontconfig SYSTEM "fonts.dtd"><fontconfig><dir>${dir}</dir><cachedir>${path.join(os.tmpdir(), "fontconfig")}</cachedir>${rules}</fontconfig>`;
  const file = path.join(os.tmpdir(), "sincro-fonts.conf");
  fs.writeFileSync(file, config);
  process.env.FONTCONFIG_FILE = file;
}
