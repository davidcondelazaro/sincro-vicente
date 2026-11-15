// Textos de las colecciones garantias, garantia3 y servicios (2026-11-14; 2026-11-15: garantías sueltas y reglamentos en Shopify). Guarda copia de lo anterior en ../garantias-colecciones-antes-2026-11-15.json
import fs from "node:fs";
import { gql } from "./sh.mjs";
const a = (u, t) => `<a href="${u}" target="_blank" rel="noopener">${t}</a>`;
const VIDEO = `<div style="position:relative;width:100%;max-width:720px;aspect-ratio:16/9;margin:0 0 1.5em;"><iframe src="https://www.youtube-nocookie.com/embed/MCKAVNxVoH4" title="Cómo activar tu Garantía3" style="position:absolute;inset:0;width:100%;height:100%;border:0;" allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerpolicy="strict-origin-when-cross-origin" loading="lazy" allowfullscreen></iframe></div>`;
const IMG = `<p><img src="https://cdn.shopify.com/s/files/1/0994/3269/4092/files/garantia3-como-funciona.png?v=1790958068" alt="Cómo funciona Garantía3: aviso del usuario por teléfono, email o formulario web, confirmación del servicio y activación de la reparación" width="600" height="608" loading="lazy" style="max-width:100%;height:auto;"></p>`;
const GARANTIAS = `<p>Todos los aparatos nuevos tienen <strong>3 años de garantía legal</strong>. Con Garantía3 puedes alargarla y proteger tu aparato frente a los accidentes, que la garantía no cubre. En la ficha de cada aparato te ofrecemos las que le corresponden por su tipo y por su precio.</p>
<h2>¿Qué tipo elijo?</h2>
<ul>
<li><strong>Ampliación de 2 o 3 años más:</strong> tu aparato queda cubierto hasta 5 o 6 años en total, con reparaciones ilimitadas. Topes de 250, 500, 1000, 2000 y 5000 € (este último, solo en la de 2 años).</li>
<li><strong>Cover:</strong> una reparación por daño accidental, como un golpe o una caída, durante los 12 meses siguientes a la compra. Topes de 250, 500, 1000 y 2000 €.</li>
<li><strong>Combi:</strong> las dos cosas en un solo contrato: una reparación por daño accidental el primer año y 2 años más de garantía, hasta 5 años en total. Topes de 250, 500, 1000 y 2000 €.</li>
<li><strong>Display:</strong> una reparación de la pantalla de tu móvil, tablet u ordenador durante 12 meses desde que la activas. Vale también para usados y reacondicionados.</li>
</ul>
<h2>¿Se pueden combinar?</h2>
<p>Sí: en cada aparato puedes elegir <strong>una ampliación</strong> (2 o 3 años más) y, además, <strong>una protección contra accidentes</strong> (Cover o Display). Combi ya incluye la ampliación y la protección, así que va sola.</p>
<h2>¿Qué es el tope?</h2>
<p>Es el coste máximo de cada reparación. Por ejemplo, con una ampliación de 2000 €, cada reparación queda cubierta hasta 2000 €. En Display, el importe indica el precio máximo del aparato y la reparación de la pantalla no te cuesta nada. En la ficha de cada aparato te ofrecemos el tope que le corresponde por su precio.</p>
<h2>Cómo se activan</h2>
<p>Cuando compras una garantía, te llega por correo el contrato de Garantía3 con los datos para activarla. Los plazos cambian según el tipo:</p>
<ul>
<li><strong>Ampliaciones de 2 y 3 años:</strong> en la web de Garantía3, dentro del primer año desde la compra del aparato.</li>
<li><strong>Cover y Combi:</strong> en la web de Garantía3, en los 7 días siguientes a la compra.</li>
<li><strong>Display:</strong> con la app Garantía3 desde el propio aparato, con la pantalla intacta.</li>
</ul>
<p>Si ya tienes el aparato, también puedes comprar la garantía sola: cada una indica para qué precio de aparato es.</p>
<p>Si no la activas a tiempo, no podrás usarla. En este vídeo te explicamos cómo activar una ampliación:</p>
${VIDEO}
${IMG}
<h2>Cómo pedir una reparación</h2>
<p>Contacta con Garantía3 con los datos de tu contrato: formulario en ${a("https://www.garantia3.es/", "garantia3.es")}, correo a <a href="mailto:asistencia@garantia3.es">asistencia@garantia3.es</a> o teléfono gratuito <a href="tel:+34900838033">900 838 033</a> (de lunes a viernes, de 10:00 a 17:00). Comprueban los datos y te indican los pasos para la reparación.</p>
<h2>Ventajas de Garantía3</h2>
<ul>
<li><strong>Sin franquicia</strong> en las reparaciones y sin adelantar dinero.</li>
<li>Es <strong>multicategoría</strong>: informática, telefonía, televisión, audio y vídeo, foto, electrodomésticos, aire acondicionado, fitness y bricolaje.</li>
<li>También pueden usarla los <strong>compradores profesionales</strong>.</li>
<li>Se <strong>activa online</strong> en pocos minutos.</li>
</ul>
<p>Garantía3 es una marca de BC Warranty Management S.A. En Electrónica Vicente te la vendemos y damos de alta tu contrato; las reparaciones las gestiona Garantía3.</p>
<h2>Reglamentos</h2>
<ul>
<li>${a("https://cdn.shopify.com/s/files/1/0994/3269/4092/files/garantia3-reglamento-2-anos-mas.pdf", "Ampliación de 2 años más")}</li>
<li>${a("https://cdn.shopify.com/s/files/1/0994/3269/4092/files/garantia3-reglamento-3-anos-mas.pdf", "Ampliación de 3 años más")}</li>
<li>${a("https://cdn.shopify.com/s/files/1/0994/3269/4092/files/garantia3-reglamento-combi.pdf", "Combi")}</li>
<li>${a("https://cdn.shopify.com/s/files/1/0994/3269/4092/files/garantia3-reglamento-display.pdf", "Display")}</li>
<li>${a("https://www.garantia3.es/extension-de-garantia-garantia3-cover/", "Cover (web de Garantía3)")}</li>
</ul>`;
const CAMBIOS = {
  garantias: { title: "Garantías y protección contra accidentes", descriptionHtml: GARANTIAS,
    seo: { title: "Ampliaciones de garantía y protección contra accidentes | Garantía3", description: "Amplía la garantía de tus aparatos hasta 5 o 6 años y protégelos de golpes, caídas y roturas de pantalla con Garantía3. Sin franquicia." } },
  garantia3: { descriptionHtml: `<p>Garantía3 amplía la garantía de tus aparatos hasta 5 o 6 años y los protege frente a accidentes y roturas de pantalla. Sin franquicia y con activación online. Consulta todos los tipos y cómo combinarlos en ${'<a href="/collections/garantias">garantías y protección contra accidentes</a>'}.</p>`,
    seo: { description: "Ampliaciones de garantía de 2 y 3 años, protección contra accidentes (Cover y Combi) y reparación de pantalla (Display) de Garantía3, sin franquicia." } },
  servicios: { descriptionHtml: `<p>Amplía la garantía de tu aparato hasta 5 o 6 años o protégelo de golpes, caídas y roturas de pantalla con ${'<a href="/collections/garantias">las garantías de Garantía3</a>'}. También puedes ${'<a href="/pages/sequra">pagar tu compra a plazos con seQura</a>'}. En la ficha de cada aparato verás además los servicios de entrega disponibles para él, como la subida a puerta o la retirada del usado.</p>`,
    seo: { title: "Servicios: garantías, protección contra accidentes y entrega", description: "Amplía la garantía de tu aparato hasta 5 o 6 años o protégelo de accidentes con Garantía3, y consulta en cada ficha los servicios de entrega." } },
};
const antes = {};
for (const [h, c] of Object.entries(CAMBIOS)) {
  const col = (await gql(`query($h:String!){ collectionByHandle(handle:$h){ id title descriptionHtml seo{ title description } } }`, { h })).collectionByHandle;
  antes[h] = col;
  const input = { id: col.id, ...c, seo: { title: c.seo.title ?? col.seo.title, description: c.seo.description } };
  const r = await gql(`mutation($i:CollectionInput!){ collectionUpdate(input:$i){ collection{ title } userErrors{ field message } } }`, { i: input });
  console.log(h, JSON.stringify(r.collectionUpdate.userErrors), r.collectionUpdate.collection?.title);
}
fs.writeFileSync("../garantias-colecciones-antes-2026-11-15.json", JSON.stringify(antes, null, 2));
