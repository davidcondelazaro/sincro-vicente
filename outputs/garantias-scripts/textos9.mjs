// node textos9.mjs            → escribe la propuesta en outputs/ (no toca Shopify)
// node textos9.mjs --escribir              → aplica los textos a las 9 sin la línea del tramo (aplicado el 2026-11-14)
// node textos9.mjs --escribir --con-tramo  → los aplica con «Para aparatos de hasta X €» (en el cambio coordinado)
import fs from "node:fs";
import { gql } from "./sh.mjs";
const ESCRIBIR = process.argv.includes("--escribir");
const CON_TRAMO = process.argv.includes("--con-tramo");
const eur = n => n.toLocaleString("es-ES");
const REG = { 2: "https://www.garantia3.es/wp-content/uploads/2022/01/Reglamento-G3-2-anos_n.pdf", 3: "https://www.garantia3.es/wp-content/uploads/2026/01/Reglamento-G3-3-anos_2026.pdf" };
// [referencia actual (SKU de hoy), años más, tope, PVP máximo del aparato según la tarifa oficial]
const NUEVE = [
  ["G3PDES250",2,250,350],["G3PDES500",2,500,650],["G3PDES1000",2,1000,1250],["G3PDES2000",2,2000,2750],["G3PDES5000",2,5000,7000],
  ["G3PD3ES250",3,250,350],["G3PD3ES500",3,500,650],["G3PD3ES1000",3,1000,1250],["G3PD3ES2000",3,2000,2750],
];
function textos(anos, tope, hasta) {
  const T = `${eur(tope)} €`, H = `${eur(hasta)} €`, total = 3 + anos, meses = total * 12;
  return {
    corta: `Amplía ${anos} años la garantía de tu aparato, hasta ${total} años en total: reparaciones sin límite de hasta ${T} cada una y sin franquicia.`,
    seoD: `Amplía la garantía de tu aparato hasta ${total} años con Garantía3: reparaciones ilimitadas de hasta ${T} cada una y sin franquicia.${CON_TRAMO ? ` Para aparatos de hasta ${H}.` : ""}`,
    elvi: `Tu aparato tiene que durarte muchos años, y una avería fuera de garantía sale cara. Con esta ampliación estás cubierto hasta los ${total} años: reparaciones ilimitadas de hasta ${T} cada una y sin franquicia. Acuérdate de activarla durante el primer año.`,
    html: `<p><strong>¿Qué es la ampliación de Garantía3?</strong></p>
<p>Los aparatos nuevos tienen <strong>3 años de garantía legal</strong>. Si la avería llega después, la reparación corre de tu cuenta. Esta ampliación de Garantía3 alarga la garantía del fabricante <strong>${anos} años más</strong> desde que acaba la legal: <strong>hasta ${total} años en total</strong> (como mucho, ${meses} meses desde la compra).</p>
<ul>
<li><strong>Reparaciones ilimitadas</strong> durante la ampliación, con un <strong>máximo de ${T}</strong> por reparación.</li>
<li>Si el aparato no se puede reparar, Garantía3 lo sustituye o te reintegra el precio de compra, con una depreciación del 10 % por cada año de vida del aparato.</li>
<li>Sin franquicia.</li>
<li>Cubre lo mismo que la garantía del fabricante. No entran las averías que esta excluye, el mal uso ni el desgaste normal de las piezas.</li>
<li>Mientras dura la garantía legal, Garantía3 te asesora gratis para usarla bien.</li>
${CON_TRAMO ? `<li>Para aparatos de hasta ${H}.</li>\n` : ""}</ul>
<p>Si compras como profesional, la ampliación empieza al acabar la garantía del fabricante, que suele ser de 1 año.</p>
<p><strong>Activación</strong></p>
<p>Recibirás por correo el contrato de Garantía3. <strong>Actívalo en su web durante el primer año</strong> desde la compra: si no lo activas a tiempo, no podrás usar la ampliación.</p>
<p>Consulta el <a href="${REG[anos]}" target="_blank" rel="noopener">reglamento de Garantía3 de ${anos} años</a>.</p>`,
  };
}
if (!ESCRIBIR) {
  let md = `# Textos nuevos de las 9 ampliaciones (propuesta, 2026-11-14)\n\nSe aplican en el cambio coordinado (SKU de MHD, precios de MHD, tema, utils y chatbot), porque la línea «Para aparatos de hasta…» usa los tramos oficiales que todavía no aplica el tema. Título, handle y título SEO no cambian. Fuente: reglamentos oficiales de 2 años y de 3 años (versión 2026-01).\n\nAplicar: \`node textos9.mjs --escribir\` (scratchpad de la sesión).\n`;
  for (const [ref, anos, tope, hasta] of NUEVE) { const t = textos(anos, tope, hasta);
    md += `\n## ${ref} · ${anos} años más · máximo ${eur(tope)} € · aparatos hasta ${eur(hasta)} €\n\n**Descripción corta:** ${t.corta}\n\n**Meta descripción:** ${t.seoD}\n\n**Consejo de Elvi:** ${t.elvi}\n\n**Descripción:**\n\n${t.html}\n`; }
  fs.writeFileSync("/Users/dconde/Desarrollo/importacion-vicente/sincro-vicente/outputs/garantias-textos-9-propuesta-2026-11-14.md", md);
  console.log("propuesta escrita"); process.exit(0);
}
for (const [ref, anos, tope, hasta] of NUEVE) { const t = textos(anos, tope, hasta);
  const pr = await gql(`query($q:String!){ products(first:2, query:$q){ nodes{ id title seo{ title } metafield(namespace:"custom", key:"referencia"){ value } } } }`, { q: `vendor:GARANTIA3 AND status:active AND title:*${tope}* AND title:*${3+anos}*` });
  const p = pr.products.nodes.find(n => n.metafield?.value === ref); if (!p) throw new Error("No encuentro " + ref);
  const u = await gql(`mutation($p:ProductUpdateInput!){ productUpdate(product:$p){ userErrors{ field message } } }`, { p: { id: p.id, descriptionHtml: t.html, seo: { title: p.seo.title, description: t.seoD } } });
  const m = await gql(`mutation($m:[MetafieldsSetInput!]!){ metafieldsSet(metafields:$m){ userErrors{ field message } } }`, { m: [
    { ownerId: p.id, namespace: "custom", key: "descripcion_corta", type: "multi_line_text_field", value: t.corta },
    { ownerId: p.id, namespace: "custom", key: "consejo_elvi", type: "multi_line_text_field", value: t.elvi } ] });
  const e = [...u.productUpdate.userErrors, ...m.metafieldsSet.userErrors]; console.log(e.length ? "ERROR " + JSON.stringify(e) : "ok", ref, p.title);
}
