// Textos de las 22 garantías de Garantía3 en Shopify (descripción, meta descripción, descripción corta y consejo de Elvi).
// Fuentes: web de Garantía3 y reglamentos oficiales (2 años, 3 años 2026-01, Combi, Display; el de Cover da 404).
//   node textos-garantias.mjs                       → enseña un ejemplo de cada tipo, no toca Shopify
//   node textos-garantias.mjs --escribir            → aplica a las 22 (las 9 ampliaciones sin la línea del tramo)
//   node textos-garantias.mjs --escribir --con-tramo → igual, con «Para aparatos de hasta X €» también en las 9
//                                                      (cuando el tema use los tramos oficiales)
import { gql } from "./sh.mjs";
const ESCRIBIR = process.argv.includes("--escribir");
const CON_TRAMO = process.argv.includes("--con-tramo");
const eur = n => n.toLocaleString("es-ES");

// [referencia Garantía3, tipo, años (ampliación), tope, PVP máximo del aparato según la tarifa oficial]
const GARANTIAS = [
  ["G3PDES250","ampliacion",2,250,350],["G3PDES500","ampliacion",2,500,650],["G3PDES1000","ampliacion",2,1000,1250],
  ["G3PDES2000","ampliacion",2,2000,2750],["G3PDES5000","ampliacion",2,5000,7000],
  ["G3PD3ES250","ampliacion",3,250,350],["G3PD3ES500","ampliacion",3,500,650],["G3PD3ES1000","ampliacion",3,1000,1250],
  ["G3PD3ES2000","ampliacion",3,2000,2750],
  ["G3E120250","combi",2,250,250],["G3E120500","combi",2,500,500],["G3E121000","combi",2,1000,1000],["G3E1212000","combi",2,2000,2000],
  ["G3CPDES250","cover",0,250,350],["G3CPDES500","cover",0,500,700],["G3CPDES1000","cover",0,1000,1400],["G3CPDES2000","cover",0,2000,2800],
  ["G3DPDES150","display",0,150,150],["G3DPDES250","display",0,250,250],["G3DPDES500","display",0,500,500],
  ["G3DPDES1000","display",0,1000,1000],["G3DPDES1500","display",0,1500,1500],
];

const REG = {
  2: "https://cdn.shopify.com/s/files/1/0994/3269/4092/files/garantia3-reglamento-2-anos-mas.pdf",
  3: "https://cdn.shopify.com/s/files/1/0994/3269/4092/files/garantia3-reglamento-3-anos-mas.pdf",
  combi: "https://cdn.shopify.com/s/files/1/0994/3269/4092/files/garantia3-reglamento-combi.pdf",
  display: "https://cdn.shopify.com/s/files/1/0994/3269/4092/files/garantia3-reglamento-display.pdf",
  cover: "https://www.garantia3.es/extension-de-garantia-garantia3-cover/",
};
const enlace = (url, texto) => `<a href="${url}" target="_blank" rel="noopener">${texto}</a>`;
const CATEGORIAS = "informática, telefonía, televisión, audio y vídeo, foto, electrodomésticos, aire acondicionado, fitness y bricolaje";
const RECLAMAR = (cuando, datos = "los datos de tu contrato") => `<h3>Cómo pedir una reparación</h3>
<p>${cuando}, contacta con Garantía3 con ${datos}:</p>
<ul>
<li>Formulario en ${enlace("https://www.garantia3.es/", "garantia3.es")}.</li>
<li>Correo a <a href="mailto:asistencia@garantia3.es">asistencia@garantia3.es</a>.</li>
<li>Teléfono gratuito <a href="tel:+34900838033">900 838 033</a>, de lunes a viernes, de 10:00 a 17:00.</li>
</ul>
<p>Su servicio de atención al cliente comprueba los datos y te indica los pasos para la reparación.</p>`;
const QUIEN = `<p>Garantía3 es una marca de BC Warranty Management S.A. En Electrónica Vicente te la vendemos y damos de alta tu contrato; las reparaciones las gestiona Garantía3.</p>`;
const NO_ACCIDENTE = "defectos que cubre la garantía legal, accesorios, daños estéticos que no afectan al funcionamiento, daños intencionados o por culpa del usuario, software, corrosión u oxidación, uso contrario a las instrucciones del fabricante, consumibles y desgaste";

function textos(tipo, anos, tope, hasta, conTramo) {
  const T = `${eur(tope)} €`, H = `${eur(hasta)} €`;
  if (tipo === "ampliacion") {
    const total = 3 + anos, meses = total * 12;
    return {
      corta: `Amplía ${anos} años la garantía de tu aparato, hasta ${total} años en total: reparaciones sin límite de hasta ${T} cada una y sin franquicia.`,
      seoD: `Amplía la garantía de tu aparato hasta ${total} años con Garantía3: reparaciones ilimitadas de hasta ${T} cada una y sin franquicia.${conTramo ? ` Para aparatos de hasta ${H}.` : ""}`,
      elvi: `Tu aparato tiene que durarte muchos años, y una avería fuera de garantía sale cara. Con esta ampliación estás cubierto hasta los ${total} años: reparaciones ilimitadas de hasta ${T} cada una y sin franquicia. Acuérdate de activarla durante el primer año.`,
      html: `<h3>¿Qué es?</h3>
<p>Los aparatos nuevos tienen <strong>3 años de garantía legal</strong>. Si la avería llega después, la reparación corre de tu cuenta. Con esta ampliación de Garantía3 tu aparato sigue cubierto <strong>${anos} años más</strong>, desde el día siguiente a que acabe la garantía legal: <strong>hasta ${total} años en total</strong> (como mucho, ${meses} meses desde la compra).</p>
<h3>Qué cubre</h3>
<ul>
<li>Las mismas averías que la garantía del fabricante, en los mismos términos de su certificado de garantía.</li>
<li><strong>Reparaciones ilimitadas</strong> durante la ampliación, con un <strong>máximo de ${T} por reparación</strong>.</li>
<li>Sin franquicia y sin adelantar dinero.</li>
<li>Si el aparato no se puede reparar, Garantía3 lo sustituye o te reintegra el precio de compra, con una depreciación del 10 % por cada año de vida del aparato.</li>
<li>Mientras dura la garantía legal, Garantía3 te asesora gratis para que la uses bien.</li>
</ul>
<h3>Qué no cubre</h3>
<p>Las averías que excluye la garantía del fabricante, las causadas por mal uso y el desgaste normal de las piezas. Si la avería es de este tipo, Garantía3 te avisa y te da un presupuesto antes de repararla.</p>
<h3>Para qué aparatos</h3>
<p>Aparatos eléctricos y electrónicos: ${CATEGORIAS}.${conTramo ? ` Este tope es para aparatos de <strong>hasta ${H}</strong>.` : ""} En la ficha de cada aparato te ofrecemos el tope que le corresponde por su precio.</p>
<p>Si compras como profesional, la ampliación empieza al acabar la garantía del fabricante, que suele ser de 1 año.</p>
<h3>Cómo se activa</h3>
<ol>
<li>Añade la ampliación al carrito junto con el aparato.</li>
<li>Te llegará por correo el contrato de Garantía3 con los datos para activarla.</li>
<li>Actívala en la web de Garantía3 <strong>dentro de los 12 meses siguientes a la compra</strong>. Si no la activas a tiempo, no podrás usarla.</li>
</ol>
${RECLAMAR("Cuando el aparato falle, ya fuera de la garantía legal")}
<h3>Con qué se combina</h3>
<p>En la misma compra puedes añadir una protección contra accidentes: Garantía3 Cover o, en móviles, tablets y ordenadores, Garantía3 Display. No se combina con Garantía3 Combi, que ya incluye 2 años de ampliación.</p>
${QUIEN}
<p>Consulta el ${enlace(REG[anos], `reglamento de Garantía3 ${anos} años más`)}.</p>`,
    };
  }
  if (tipo === "cover") return {
    corta: `Protege tu aparato frente a golpes y caídas durante 12 meses desde la compra: una reparación por daño accidental de hasta ${T}. Hay que activarla en los 7 días siguientes a la compra.`,
    seoD: `Una reparación por daño accidental durante 12 meses desde la compra, hasta ${T}. Para aparatos de hasta ${H}. Se activa en 7 días.`,
    elvi: `Un golpe o una caída no los cubre la garantía del fabricante. Con Cover tienes una reparación por daño accidental de hasta ${T} durante el primer año. Acuérdate de activarla en los 7 días siguientes a la compra.`,
    html: `<h3>¿Qué es?</h3>
<p>La garantía del fabricante cubre las averías, pero no los accidentes. Garantía3 Cover protege tu aparato frente a <strong>daños accidentales</strong>, como un golpe o una caída: te da <strong>una reparación</strong> durante los <strong>12 meses siguientes a la compra</strong>.</p>
<h3>Qué cubre</h3>
<ul>
<li><strong>Una única reparación por daño accidental</strong> en los 12 meses siguientes a la compra.</li>
<li><strong>Máximo ${T}</strong> como coste de esa reparación.</li>
<li>Sin franquicia.</li>
<li>Si el aparato no se puede reparar, Garantía3 te reintegra el precio de compra con una depreciación del 30 %.</li>
</ul>
<h3>Qué no cubre</h3>
<p>Solo cubre daños accidentales. Las averías normales siguen cubiertas por la garantía legal de 3 años y, para después, puedes añadir una ampliación de garantía.</p>
<h3>Para qué aparatos</h3>
<p>Aparatos eléctricos y electrónicos: ${CATEGORIAS}. Este tope es para aparatos de <strong>hasta ${H}</strong>; en la ficha de cada aparato te ofrecemos el que le corresponde por su precio. También vale para compradores profesionales.</p>
<h3>Cómo se activa</h3>
<ol>
<li>Añade Cover al carrito junto con el aparato: tiene que comprarse en la misma fecha.</li>
<li>Te llegará por correo el contrato de Garantía3 con los datos para activarla.</li>
<li>Actívala en la web de Garantía3 <strong>en los 7 días siguientes a la compra</strong>. Pasado ese plazo ya no se puede activar.</li>
</ol>
${RECLAMAR("Si tu aparato sufre un accidente")}
<h3>Con qué se combina</h3>
<p>Puedes añadir en la misma compra una ampliación de garantía de 2 o 3 años más. No se combina con Garantía3 Display ni con Garantía3 Combi, que ya incluye la protección contra accidentes.</p>
${QUIEN}
<p>Más información en la ${enlace(REG.cover, "web de Garantía3 Cover")}.</p>`,
  };
  if (tipo === "combi") return {
    corta: `Garantía hasta 5 años en total y, además, una reparación por daño accidental durante los 12 primeros meses. Máximo ${T} por reparación. Hay que activarla en los 7 días siguientes a la compra.`,
    seoD: `2 años más de garantía tras los 3 legales y una reparación por daño accidental el primer año. Máximo ${T} por reparación, para aparatos de hasta ${H}.`,
    elvi: `Es la más completa: te cubre los accidentes del primer año y alarga la garantía hasta los 5 años, con reparaciones de hasta ${T}. Acuérdate de activarla en los 7 días siguientes a la compra.`,
    html: `<h3>¿Qué es?</h3>
<p>Garantía3 Combi junta en un solo contrato las dos protecciones: <strong>accidentes durante el primer año</strong> y <strong>2 años más de garantía</strong> cuando acaba la legal. Tu aparato queda cubierto <strong>hasta 5 años en total</strong>.</p>
<h3>Qué cubre</h3>
<ul>
<li><strong>12 primeros meses desde la compra:</strong> una única reparación por daño accidental (un golpe, una caída…).</li>
<li><strong>Después de los 3 años de garantía legal:</strong> 2 años más de garantía del fabricante, con <strong>reparaciones ilimitadas</strong>.</li>
<li><strong>Máximo ${T} por reparación</strong>, tanto en el accidente como en cada reparación de la ampliación.</li>
<li>Sin franquicia.</li>
<li>Si el aparato no se puede reparar, en el accidente o en la ampliación, Garantía3 lo sustituye por uno igual o, si no lo hay, por otro de características similares, aunque sea de otra marca, con el tope como límite.</li>
</ul>
<h3>Qué no cubre</h3>
<ul>
<li>En la parte de accidentes, lo que no es daño accidental: ${NO_ACCIDENTE}.</li>
<li>En la ampliación, las averías que excluye la garantía del fabricante y el desgaste normal de las piezas.</li>
<li>Si el daño no está cubierto, Garantía3 te devuelve el aparato sin reparar y puede cobrar 40 € de gastos logísticos.</li>
</ul>
<h3>Para qué aparatos</h3>
<p>Aparatos eléctricos y electrónicos: ${CATEGORIAS}. Este tope es para aparatos de <strong>hasta ${H}</strong>; en la ficha de cada aparato te ofrecemos el que le corresponde por su precio. También vale para compradores profesionales.</p>
<h3>Cómo se activa</h3>
<ol>
<li>Añade Combi al carrito junto con el aparato.</li>
<li>Te llegará por correo el contrato de Garantía3 con los datos para activarla.</li>
<li>Actívala en la web de Garantía3 <strong>en los 7 días siguientes a la compra</strong>. Pasado ese plazo ya no se puede activar.</li>
</ol>
${RECLAMAR("Si tu aparato sufre un accidente o se avería")}
<h3>Con qué se combina</h3>
<p>Con ninguna otra: Combi ya incluye la ampliación de garantía y la protección contra accidentes.</p>
${QUIEN}
<p>Consulta el ${enlace(REG.combi, "reglamento de Garantía3 Combi")}.</p>`,
  };
  return {
    corta: `Una reparación de la pantalla por daño accidental durante 12 meses desde que la activas, sin coste para ti. Para móviles, tablets y ordenadores de hasta ${H}. Se activa con la app de Garantía3 desde el propio aparato.`,
    seoD: `Una reparación de pantalla por daño accidental durante 12 meses desde la activación. Para aparatos de hasta ${H}. Se activa con la app de Garantía3.`,
    elvi: `La pantalla es lo que más se rompe y lo más caro de arreglar. Con Display tienes una reparación de pantalla durante 12 meses. Actívala con la app de Garantía3 en cuanto lo saques de la caja, con la pantalla intacta.`,
    html: `<h3>¿Qué es?</h3>
<p>Garantía3 Display protege la <strong>pantalla</strong> de tu móvil, tablet u ordenador frente a daños accidentales: te da <strong>una reparación de pantalla</strong> durante <strong>12 meses desde que la activas</strong>.</p>
<h3>Qué cubre</h3>
<ul>
<li><strong>Una única reparación de la pantalla por daño accidental</strong>.</li>
<li><strong>Sin coste para ti</strong>: sin franquicia.</li>
<li>Dura 12 meses desde la activación o hasta que se haga esa reparación. Según Garantía3, se puede renovar repitiendo la activación en la app.</li>
<li>Vale para aparatos nuevos, usados y reacondicionados.</li>
</ul>
<h3>Qué no cubre</h3>
<p>Lo que no es daño accidental: ${NO_ACCIDENTE}. Si el daño no está cubierto, Garantía3 te devuelve el aparato sin reparar y puede cobrar 25 € de gastos de entrega.</p>
<h3>Para qué aparatos</h3>
<p>Aparatos con pantalla de informática y telefonía de <strong>hasta ${H}</strong>. En la ficha de cada aparato te ofrecemos la que le corresponde por su precio.</p>
<h3>Cómo se activa</h3>
<ol>
<li>Te llegará por correo de Garantía3 la información para activarla.</li>
<li>Descarga la app Garantía3 (Google Play, App Store o AppGallery) <strong>en el propio aparato</strong> que quieres proteger.</li>
<li>Crea tu perfil, introduce los datos del aparato y su IMEI y haz la foto de la pantalla que te pide la app. La pantalla tiene que estar <strong>intacta y funcionando</strong>.</li>
</ol>
<p>La protección empieza al activarla, así que conviene hacerlo en cuanto saques el aparato de la caja.</p>
${RECLAMAR("Si se te rompe la pantalla", "tus datos y los del aparato que registraste al activarla")}
<h3>Con qué se combina</h3>
<p>Puedes añadir en la misma compra una ampliación de garantía de 2 o 3 años más. No se combina con Garantía3 Cover ni con Garantía3 Combi.</p>
${QUIEN}
<p>Consulta el ${enlace(REG.display, "reglamento de Garantía3 Display")}.</p>`,
  };
}

const d = await gql(`{ products(first:50, query:"vendor:GARANTIA3"){ nodes{ id title seo{ title } metafield(namespace:"custom", key:"referencia"){ value } } } }`);
const porRef = Object.fromEntries(d.products.nodes.map(p => [p.metafield?.value, p]));
for (const [ref, tipo, anos, tope, hasta] of GARANTIAS) {
  const p = porRef[ref]; if (!p) throw new Error("No encuentro " + ref);
  const t = textos(tipo, anos, tope, hasta, tipo !== "ampliacion" || CON_TRAMO);
  if (!ESCRIBIR) { if (["G3PDES250","G3E120250","G3CPDES250","G3DPDES150"].includes(ref)) console.log(`\n######## ${ref} · ${p.title}\n${t.corta}\n${t.seoD}\n${t.elvi}\n${t.html}`); continue; }
  const u = await gql(`mutation($p:ProductUpdateInput!){ productUpdate(product:$p){ userErrors{ field message } } }`, { p: { id: p.id, descriptionHtml: t.html, seo: { title: p.seo.title, description: t.seoD } } });
  const m = await gql(`mutation($m:[MetafieldsSetInput!]!){ metafieldsSet(metafields:$m){ userErrors{ field message } } }`, { m: [
    { ownerId: p.id, namespace: "custom", key: "descripcion_corta", type: "multi_line_text_field", value: t.corta },
    { ownerId: p.id, namespace: "custom", key: "consejo_elvi", type: "multi_line_text_field", value: t.elvi } ] });
  const e = [...u.productUpdate.userErrors, ...m.metafieldsSet.userErrors];
  console.log(e.length ? "ERROR " + JSON.stringify(e) : "ok", ref, p.title.slice(0, 70));
}
