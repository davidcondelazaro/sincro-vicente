# Preguntas para MHD y Garantía3 (garantías)

Preparado el 2026-11-15 tras repasar toda la conversación del cambio de garantías (`docs/GARANTIAS_DESDE_MHD.md`).
Cada correo va ordenado por importancia: las primeras preguntas bloquean trabajo; las últimas son de detalle. Sin
enviar: los manda David.

Ya respondido por David (2026-11-15), fuera del correo: MHD acepta las garantías en el pedido aunque no tengan
existencias, también un pedido con solo una garantía. Facturación: Garantía3 factura cada mes a MHD todas
las garantías vendidas y MHD nos factura la línea del pedido; no hay doble cobro.

Al final, qué cambia en nuestro lado según cada respuesta (M = MHD, G = Garantía3, con su número).

---

## Correo a MHD

**Asunto:** Garantías Garantía3 en los pedidos y relación aparato–garantía

Hola:

Ya tenemos en la tienda las 22 garantías de Garantía3 que asignáis a vuestros aparatos (bloque `garantia3` de la ficha
de cada producto), con vuestro código como SKU, y os las enviaremos en los pedidos como una línea más, también cuando el cliente compra
solo la garantía. Nos quedan estas dudas:

1. **Cambios en la relación.** El bloque `garantia3` solo viene en la ficha de cada producto, no en el listado. Para
   enterarnos de los cambios sin pedir miles de fichas, ¿podéis incluirlo en el listado, aunque sea solo con los códigos
   de las garantías? Si no, ¿actualizáis `fecha_modificacion_producto` cuando cambia el bloque? ¿Avisáis cuando añadís o
   quitáis garantías a una familia?
2. **Aparatos sin ficha.** De los 4.271 aparatos de vuestro Excel `productos_con_garantia.xls`, 93 no tienen ficha en la
   API porque hoy no tienen existencias. ¿Nos podéis mandar el Excel con una columna más con los códigos de garantía de
   cada aparato? Así cubriríamos también esos 93.
3. **Para vuestra información, títulos de Combi:** en el bloque `garantia3` de las fichas, las cuatro Combi (250, 500,
   1.000 y 2.000 €) llevan el mismo título, «Garantía3 COMBI - Maximal 250 …». En vuestro ERP el título está bien. No
   nos afecta.
4. **Para vuestra información, tramos:** en unos 400 aparatos (663 parejas aparato–garantía) el tramo asignado no cuadra
   con el PVP actual del aparato. Casi todos están en el límite: parece calculado con un precio anterior. En otras 16
   parejas el aparato supera el tramo máximo de esa garantía. Nosotros calculamos el tramo con el precio actual, así que
   no nos afecta, pero os lo comentamos. Si queréis la lista, os la pasamos.
5. **Reacondicionados:** asignáis +2 y +3 años a 32 reacondicionados (iPhone y portátiles «REAC.»). Garantía3 tiene una
   línea propia para reacondicionados. ¿Es correcto? Nosotros, de momento, no les ofrecemos garantía.

Gracias.

---

## Correo a Garantía3 (Manuel Agudo)

**Asunto:** Altas por API: anulaciones, Cover, Combi y Display

Hola, Manuel:

Ya vendemos en la tienda online, además de las ampliaciones de 2 y 3 años que damos de alta por vuestra API, las
líneas Cover, Combi y Display de la tarifa WEBSHOP. Antes de automatizar sus altas necesitamos aclarar lo siguiente:

1. **Anulaciones (la más importante).** Si un pedido se cancela o el cliente desiste en los 14 días que marca la ley,
   ¿anuláis y abonáis siempre el contrato ya dado de alta? ¿Hasta cuándo se puede pedir, y vale aunque el cliente lo haya
   activado? Hoy lo pedimos por correo a info@bcwm.es con el número de transacción: ¿es el procedimiento correcto? ¿Hay
   o habrá anulación por API? De esto depende que demos de alta todas las garantías en el momento de la compra o que
   esperemos a que pase el plazo de desistimiento.
2. **Token y EAN nuevos.** ¿Nuestro token admite los EAN de Cover, Combi y Display?
   - Cover: 8033509885191, 8033509885207, 8033509885214, 8033509885276.
   - Combi: 8033509887454, 8033509887461, 8033509887478, 8033509887485.
   - Display: 8033509887003, 8033509887010, 8033509887027, 8033509887034, 8033509887041.

   Como no hay entorno de pruebas, ¿cómo hacemos la primera alta de cada tipo y su abono?
3. **Plazo de 7 días de Cover y Combi.** El reglamento de Combi dice «dentro de 7 días desde la fecha de adquisición del
   producto». ¿Cuenta desde la fecha del pedido, desde la entrega o desde que os llega el alta? Si damos el alta el
   mismo día del pago, ¿llega a tiempo el correo al cliente? ¿Qué pasa si no la activa en ese plazo?
4. **Activación automática por API.** ¿Se puede usar en Cover y Combi, y en las ampliaciones, para que el cliente no
   tenga que activarla? ¿Cómo se llaman los campos en la API (categoría, marca, modelo, precio, IMEI o número de serie)
   y cuál es la lista de categorías? En la documentación de la API no lo encontramos.
   Aceptamos con gusto la videollamada que nos ofrecisteis para verlo.
5. **Correo al cliente.** Nos dijisteis que el correo sale cuando el contrato está activo. Sin activación automática,
   ¿quién manda al cliente el contrato y las instrucciones para activarlo tras el alta, y en cuánto tiempo? ¿Enviáis
   recordatorios si no lo activa?
6. **Altas tras un corte.** Si la conexión se corta durante un alta, ¿cómo sabemos si el contrato llegó a crearse, para
   no darlo de alta dos veces?
7. **Display.**
   - El `promocode`: ¿es uno por contrato o uno fijo de la tienda? ¿Lo devuelve la API al dar el alta?
   - ¿Qué recibe el cliente y cómo llega a la app para activarla?
   - El importe (150, 250, 500, 1.000 y 1.500 €): ¿es el precio máximo del aparato o el coste máximo de la reparación?
     El reglamento dice que la pantalla se repara sin coste. Nosotros usamos los tramos de la tarifa de 2023: ¿siguen
     vigentes?
8. **Cover.**
   - El reglamento no se puede descargar: el enlace de vuestra web da error 404. ¿Nos lo podéis enviar?
   - ¿Cuánto paga el cliente de gastos si el daño no está cubierto?
   - ¿Tiene que comprarse siempre el mismo día que el aparato?
9. **Reglamento de 2 años más.** El que tenemos es de 2022 (el de 3 años es de enero de 2026). ¿Hay una versión más
   reciente?
10. **Tarifa.** La última que tenemos es de octubre de 2023. ¿Nos mandáis la vigente, con los tramos y los PVP
    recomendados?
11. **Línea.** Usamos la tarifa WEBSHOP para la tienda online, también en Cover, Combi y Display. ¿Es la adecuada, o nos
    convendría la «virtual»?
12. **Reacondicionados.** MHD asigna +2 y +3 años a algunos reacondicionados. ¿Valen para ellos o hay que usar vuestra
    línea para reacondicionados? De momento no les ofrecemos ninguna.
13. **Portugal.** Si el cliente es de Portugal, ¿valen las mismas garantías y la misma alta?
14. **Imágenes.** ¿Tenéis las tarjetas oficiales de Combi y Display de cada importe en buena resolución? Solo hemos
    encontrado versiones de unos 230 píxeles.
15. **Garantías compradas después.** También las vendemos sueltas, sin el aparato, para quien ya lo tiene (comprado con
    nosotros o en otra tienda). ¿Qué condiciones hay? Por ejemplo: ¿la +2 y la +3 valen siempre que el aparato tenga menos
    de 1 año?, ¿Cover y Combi solo el mismo día o en los 7 días siguientes a la compra del aparato?, ¿el cliente tiene que
    presentar la factura del aparato al activarla?

Gracias.

---

## Qué cambia según las respuestas

| Respuesta | Qué hacemos |
|---|---|
| Bloque en el listado o fecha de modificación (M1) | El importador lo lee en cada vuelta; si no, relectura semanal de ~4.300 fichas |
| Garantía3 anula y abona siempre (G1) | Alta inmediata en todas: un solo flujo, fuera la espera de 14 días |
| No siempre (G1) | Alta inmediata solo en Cover y Combi; espera de 14 días en +2 y +3 |
| Token admite los EAN (G2) y plazo claro (G3) | Alta automática de Cover y Combi en utils, que hoy se bloquean con aviso |
| Activación automática posible (G4) | Mandar los datos del aparato y quitar el paso de activar del cliente |
| Correo al cliente (G5) | Ajustar lo que prometen las fichas («te llegará el contrato por correo…») |
| `promocode` y entrega de Display (G7) | Alta automática de Display y texto de su ficha |
| Tramos o importe de Display distintos (G7) | Cambiar `garantia-calculo.liquid` y los textos de Display |
| Reglamento de Cover (G8) o nuevo de 2 años (G9) | Subirlos a Shopify › Archivos y a `docs/garantia3-reglamentos/` |
| Condiciones de las garantías compradas después (G15) | Ajustar los textos de las fichas y, si hace falta, limitar Cover y Combi sueltas |
| Tarifa nueva (G10) | Revisar los tramos del tema y los precios |
