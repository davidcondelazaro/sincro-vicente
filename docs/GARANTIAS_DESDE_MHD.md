# Garantías a partir de MHD

Decidido con David el 2026-11-14. Sustituye el criterio actual (familias y reglas por título en el conector, tramo por
precio × 0,729 en el tema). Los contratos con Garantía3 no cambian de dueño: los seguimos pidiendo nosotros desde utils
(`docs/GARANTIA3.md`).

## Qué manda MHD

- **Excel `productos_con_garantia.xls`** (correo de MHD, 2026-11-14): 4.271 aparatos (`sku` = código MHD, `ean` = EAN del
  propio aparato). Un EAN por SKU, sin repetidos. No dice qué garantía lleva cada uno.
- **Bloque `garantia3` en la ficha** (`/products/:codigo`): la lista de garantías de cada aparato, con código MHD,
  `ref_proved` (referencia de Garantía3), EAN, título, descripciones, imagen, `pvp`, `triple_neto` y `es_garantia: true`.
  **No viene en el listado** (`/products`), ni filtrando por EAN.
- La API y la web de MHD solo publican artículos con existencias: las garantías sueltas no salen en el listado (salvo
  las dos físicas G3CES250 y G3CES500, que tienen stock) y `/products/:codigo` de una garantía da 404.

Descarga del 2026-11-14 (ritmo pactado: 4 a la vez, 5/s; ~10 min):

| Archivo en `outputs/` | Qué es |
|---|---|
| `mhd-garantias-por-producto-2026-11-14.json` | Ficha resumida de los 4.271 con su bloque `garantia3` (93 dan 404: sin stock hoy) |
| `mhd-garantias-por-producto-2026-11-14.csv` | 12.618 parejas aparato–garantía |
| `mhd-garantias-distintas-2026-11-14.csv` / `.json` | Las 22 garantías distintas, con todos sus datos |
| `mhd-garantias-tramos-revision-2026-11-14.csv` | 663 parejas cuyo tramo no cuadra con el PVP actual |
| `garantia3-tarifa-2023-10.csv` | Tarifa de Garantía3 (octubre de 2023): hojas físico, virtual y WEBSHOP |

La base (`mhd_catalog_product_details`) **no** tiene el bloque: la última lectura completa de fichas es del 26-10 y las
vueltas de cada 30 minutos solo leen el listado.

## Las 22 garantías

Todas son de la hoja **WEBSHOP** de la tarifa de Garantía3 (la de venta online, la misma que nuestras 9). MHD asigna
todas las de esa hoja salvo las dos Casa Nueva (cubren 3 o 4 aparatos a la vez). Las **físicas** (G3CES…, las dos que MHD
vende sueltas en su web) y las **virtuales** (G2VES…, G3V3ES…, G3CVES…) se descartan.

| Tipo | Referencias (código MHD) | Tramos: PVP del aparato con IVA |
|---|---|---|
| +2 años | G3PDES250 (10040604), 500 (10040586), 1000 (10040587), 2000 (10040588), 5000 (10040589) | hasta 350, 650, 1.250, 2.750, 7.000 € |
| +3 años | G3PD3ES250 (10040613), 500 (10040614), 1000 (10040611), 2000 (10040612) | hasta 350, 650, 1.250, 2.750 € |
| Cover (daño accidental 12 meses) | G3CPDES250 (10040590), 500 (10040591), 1000 (10040592), 2000 (10040633) | hasta 350, 700, 1.400, 2.800 € |
| Combi (2 años + 1 de daño accidental) | G3E120250 (10052432), G3E120500 (10040607), G3E121000 (10052433), G3E1212000 (10052434) | hasta 250, 500, 1.000, 2.000 € |
| Display (solo pantalla) | G3DPDES150 (10040600), 250 (10040628), 500 (10040601), 1000 (10040602), 1500 (10040603) | hasta 150, 250, 500, 1.000, 1.500 € |

Nuestras 9 de hoy (+2 y +3) están todas entre las 22, con el mismo EAN: se modifican, no se archivan. Hay que crear 13.

Combinaciones por aparato según MHD: solo +2 (133); +2 y +3 (1.848); +2, +3 y Cover (152); +2, +3, Cover y Combi (1.877);
las cinco (163); +2 y Cover (5). Va por familia.

## Decisiones (David, 2026-11-14)

1. **Contratos:** los pedimos nosotros desde utils, como ahora. **A MHD se exporta cada garantía como un producto más**
   del pedido; MHD no da de alta contratos.
2. **SKU = código de MHD** (10040586…), porque va en el pedido a MHD. **Código de barras = EAN de Garantía3**, que es lo
   que se manda a Garantía3. Utils sacará el EAN del producto de Shopify: fuera la tabla `GARANTIA3_EANS`.
3. **Precios:** los de la **tarifa que manda MHD** (`Tarifas_16112026_091240.csv`, 2026-11-16), no el `pvp` del bloque
   `garantia3` de las fichas, que no cuadra con ella. Aplicados el 2026-11-16 (ver registro).
4. **Se venden las que asigna MHD**, solo a los aparatos que él dice. El resto de productos se limpia. En la ficha de
   cada aparato solo se ofrecen esas; además, cada garantía se puede comprar suelta (David, 2026-11-15; ver «Pendiente»).
5. **Tramo:** lo sigue calculando **el tema** con el precio de venta actual, ahora con los **tramos oficiales de
   Garantía3** de cada tipo (tabla de arriba), no con × 0,729. De MHD se toma qué aparatos y qué tipos; su tramo no
   (un 5,3 % de las parejas no cuadra con el PVP actual, casi todas en el borde: precio cambiado después).
6. **Precio mínimo del aparato: 60 €** (ajuste del tema `garantia_precio_minimo`). MHD asigna incluso a una moka de 5 €;
   quedan fuera 428.
7. **Reacondicionados: siempre fuera.** MHD asigna garantía a 32 (iPhone y portátiles «REAC.»).
8. **Aparatos sin ficha** (93 hoy, sin stock): sin garantía hasta que se pueda leer su bloque.
9. **Combinaciones:** dos grupos. Una **ampliación** (+2 o +3) y, aparte, una **protección** (Cover o Display). La
   **Combi** es un paquete que sustituye a las dos y excluye a todas. La web de MHD no sirve de guía: cinco casillas
   sueltas sin exclusiones.
10. **Textos:** nuestro estilo para las 22 (tipo, tope y duración en el título; descripción corta propia a partir de la de
    MHD y la tarifa). Los títulos deben seguir diciendo «Garantía»: helpdesk reconoce así las líneas de Garantía3
    (`hasGarantia3`).

## Dónde se guarda

- **Shopify:** metacampo de producto nuevo con los **tipos** que lleva cada aparato (p. ej. `custom.garantias_tipos`,
  lista: `ampliacion_2`, `ampliacion_3`, `cover`, `combi`, `display`). Lista vacía = sin garantía. Sustituye a
  `custom.admite_garantia`. No se guarda el tramo: lo calcula el tema.
- **Conector:** el bloque `garantia3` tal como lo manda MHD, en `mhd_catalog_product_details.source_payload`.

## Cambios en los datos de MHD

- **Altas:** ya se pide su ficha → llegan con su bloque.
- **Tipos:** cambian poco. Relectura de fichas de los aparatos con garantía (~4.300, de noche, ~15 min al ritmo pactado)
  como red de seguridad, semanal.
- **Precio:** no hace falta releer nada: el tramo sale del precio en el tema.
- **Pedir a MHD:** el bloque (o al menos los códigos) en el listado, o que actualicen `fecha_modificacion_producto` cuando
  cambie.

## Orden de trabajo

1. **Productos de garantía en Shopify:** corregir las 9 (SKU de MHD, precio, título) y crear las 13 (colección
   `garantias`, sin envío ni stock, `custom.apartado`/`custom.familia`, consejo de Elvi). No se ven mientras ningún
   aparato las ofrezca.
2. **Metacampo nuevo** y **carga a mano** con la descarga del 2026-11-14 (sin reacondicionados ni lo que no venga de MHD).
3. **Tema** (`theme-enterprise-vicente`, `snippets/garantia-calculo.liquid` y compañía): leer los tipos, tramos oficiales
   por tipo, dos grupos y Combi, mínimo 60 €. Copia del mínimo en el chatbot (`STORE.warranty.minPrice`).
4. **Utils:** EAN desde el código de barras del producto (fuera `GARANTIA3_EANS`), reconocer las 22; exportar las
   garantías a MHD como una línea más (`src/lib/mhd-order-lines.ts` hoy las excluye). Probar con un pedido de prueba que
   MHD acepta esos códigos (un SKU que no reconoce da 201 con el pedido vacío).
5. **Conector:** fuera familias y reglas por título (`warranty.ts`, `store_collections.warranty_eligible`,
   `store_warranty_title_rules`, pantalla `/tienda/garantias`); el importador escribe el metacampo nuevo desde la ficha y
   la relectura semanal.
6. **Al final:** borrar `custom.admite_garantia` y limpiar el resto de productos. Antes no: es lo que hoy hace que la tienda
   ofrezca garantías.

## Condiciones de los tipos nuevos (web de Garantía3, 2026-11-14)

Estudio previo más completo (2026-10-30), con reglamentos, venta ligada o independiente y dudas de referencias:
`theme-enterprise-vicente/docs/garantia3-otras-lineas.md`. Allí consta además que la API pide `promocode` para Display y
no admite activación automática, y que la Cover exige comprarse en la misma fecha que el aparato.

- **Cover:** una única reparación por daño accidental durante 12 meses desde la compra; si no se puede reparar, reintegro
  del precio con un 30 % de depreciación. El tope es el coste máximo de esa reparación. **Activación en los 7 primeros
  días desde la compra.**
- **Combi:** una única reparación por daño accidental en los 12 meses desde la compra y, tras la garantía legal, 2 años
  más de garantía del fabricante sin límite de reparaciones (sustitución si no compensa). **Activación en los 7 primeros
  días desde la compra.**
- **Display:** una única reparación de pantalla por daño accidental durante 12 meses **desde la activación**, renovable.
  Se activa **solo con la app de Garantía3 desde el propio aparato**, con la pantalla intacta (perfil, datos del
  dispositivo, IMEI y foto de la pantalla). Vale también para usados y reacondicionados.
- **Choque con utils:** utils pide el contrato `garantia3_dias` (14) días después de que MHD marque el pedido como
  Enviado. Con Cover y Combi el cliente tiene 7 días desde la compra para activar: el contrato le llegaría tarde. Hay que
  pedir esos dos en el momento (o confirmar con Garantía3 desde cuándo cuentan los 7 días) antes de venderlos.
  Confirmado en el reglamento de Combi (`Reglamento-G3-Combi.pdf`, web de Garantía3): «debe ser activada por el Usuario
  dentro de 7 días desde la fecha de adquisición del producto». El reglamento no dice nada de anulaciones; utils ya tiene
  los estados `anulacion_pendiente` y `anulado` para un contrato creado cuya garantía se devuelve.

## Lo que dependía de los SKU y títulos (2026-11-14)

**Al día (2026-11-15):** el tema busca por `custom.referencia` y utils por proveedor y código de barras, así que ya no
dependen del SKU. Solo queda el chatbot. Lo de abajo es cómo estaba el 2026-11-14.

`garantia3_modo` está en **producción**. Cambiar el SKU de las 9 a su código de MHD rompía a la vez:

- **Tema:** `garantia-calculo.liquid` busca las variantes por SKU `G3PDES{tope}` / `G3PD3ES{tope}`: dejaría de ofrecerlas.
- **Utils:** `GARANTIA3_EANS` va por SKU: dejaría de pedir contratos.
- **Chatbot** (`chatbot-vicente/src/agent/tools.ts`): no usa SKU, pero saca tope y años del título con
  `/m[aá]ximo …(€) … hasta N años/` y filtra por estado ACTIVE. Los títulos de +2 y +3 deben mantener ese patrón; los de
  los tipos nuevos no deben encajar en él (si no, el chatbot los ofrecería como +2/+3). Usa también
  `custom.admite_garantia` y `minPrice` (60): entra en el paso 3.

Por eso el SKU y el precio de las 9 se cambian **en el mismo paso** que el tema, utils y el chatbot. Las 13 nuevas se
crearon en borrador y se activaron el mismo día (la tienda aún no está en producción): el tema y el chatbot no las ofrecen
mientras no se haga ese paso.

## Pendiente de terceros

Los correos completos, listos para enviar, están en
[GARANTIAS_PREGUNTAS_MHD_GARANTIA3.md](GARANTIAS_PREGUNTAS_MHD_GARANTIA3.md). Esto es el origen de cada duda.

- **MHD:** bloque en el listado o fecha de modificación; títulos de las Combi en el bloque `garantia3` (las cuatro dicen «Maximal 250»;
  el ERP está bien, solo informativo); que acepten las garantías en el pedido aunque no tengan existencias.
- **Garantía3, la principal:** si un contrato dado de alta **se anula y se abona siempre** cuando el pedido se cancela o
  el cliente desiste (hoy se pide por correo a `info@bcwm.es`; la API no tiene anulación). Si es que sí: **alta inmediata
  en todas** (un solo flujo, fuera la espera de 14 días). Si no: alta inmediata en Cover y Combi y espera en +2 y +3.
- **Garantía3:** que nuestro token admita los EAN de Cover, Combi y Display (si no, la API da 404 y utils avisa; no hay
  entorno de pruebas: el primer contrato es real); tarifa actualizada (la que tenemos es de 2023); el reglamento de
  Cover (el PDF de su web da 404; los de 2 años, 3 años 2026, Combi y Display sí están).
- **Garantía3, fichas:** las tarjetas de Combi y Display de cada tope en buena resolución (MHD y su web solo tienen
  imágenes de unos 230 px, y no de todos los topes). En **Display**, qué es el importe: el reglamento dice que la pantalla
  se repara sin coste y la web habla de «5 tipos según el coste del aparato», no de un tope de reparación. Hasta saberlo,
  la ficha dice «para aparatos de hasta X €» y el título conserva «Máximo X €», como la tarjeta. En **Cover**, el importe
  de gastos si el daño no está cubierto (sin reglamento no se pone cifra).

## Pendiente (estado al 2026-11-15)

Lo hecho está en «Registro de cambios hechos».

**Hecho:**
- Las 22 garantías, con precios, textos, imágenes, reglamentos y orden en las colecciones.
- Metacampo de tipos cargado.
- Tema publicado y con commit (`b845100` y `7836b8e`).
- Utils desplegado (`0172dfe`).

**Garantías compradas sueltas (David, 2026-11-15): se siguen vendiendo también como producto independiente**, sin
aparato, porque se pueden activar después para aparatos comprados en otra tienda. Se mantiene el botón de compra en sus
fichas y en sus tarjetas. Según los reglamentos:
- **+2 y +3:** se activan «dentro del primer año de vida del bien … desde su fecha de adquisición». Sirven para un aparato
  de menos de 1 año, comprado aquí o fuera.
- **Combi:** 7 días desde la compra del aparato.
- **Cover:** su web dice que se compra en la misma fecha que el aparato (sin reglamento para confirmarlo).
- **Display:** 12 meses desde que se activa en la app; no depende de la fecha de compra.

Lo que falta para que funcione:
- **Utils: arreglado el 2026-11-15, en local, sin desplegar** (ver el último punto de esta lista).
- **Textos: hechos el 2026-11-15** (ver registro). Las +2/+3 y Combi dicen que se pueden comprar solas y que el plazo
  cuenta desde la compra del aparato; la colección `garantias` lo dice en una frase.
- **Pregunta a Garantía3** (G16 en el documento de preguntas): condiciones de una garantía comprada después y para un
  aparato de otra tienda.
- **Exportación a MHD: cambiada el 2026-11-15, en local, sin desplegar.** Antes se saltaba las garantías anidadas y
  mandaba las sueltas como si fueran un aparato. Ahora `buildMhdProductLines` (`src/lib/mhd-order-lines.ts`) reconoce
  las garantías por proveedor `GARANTIA3` (o SKU antiguo, traducido a su código de MHD) y las manda todas como un
  producto más, sin portes, una vez por código con la suma de unidades, detrás del primer aparato que la lleva y las
  sueltas al final. Pruebas: 6 casos nuevos en `tests/mhd-order-lines.test.mjs`; simulado con #1004 (dos +3 de 250 € en
  aparatos distintos → una línea 10040613 ×2) y #1007. `docs/PEDIDOS_MHD_FASE_1.md` al día.
- **Proceso de Garantía3 con una garantía suelta: arreglado el 2026-11-15, en local, sin desplegar.** Antes la fila
  se quedaba en espera para siempre (sin «Enviado» de MHD ni recogida no había fecha de inicio) y, si empezaba, se
  bloqueaba por «no está ligada a un aparato». Además, con un contrato ya creado, la vigilancia de reembolsos habría
  pedido anularlo por «Aparato reembolsado». Ahora (`src/lib/garantia3.ts` y `garantia3-vuelta.ts`):
  - sin aparato en el pedido, la espera cuenta desde el pago (primer cobro hecho en Shopify, `fechaPago`), también si
    el pedido lleva otros aparatos;
  - `datoQueFalta` ya no exige aparato y `motivoParaNoPedir` solo mira la garantía;
  - Cover, Combi y Display siguen bloqueadas con aviso para pedirlas a mano.

  Pruebas nuevas en `tests/garantia3.test.mjs` (108 en total, todas bien). Probado `fechaPago` con 10 pedidos reales:
  en #1004, pagado por transferencia, cuenta desde el pago (4 días después del pedido). Hoy no hay ningún pedido con
  una garantía suelta. `docs/GARANTIA3.md` al día.

1. **Commits del 2026-11-15:**
   - Tema: `b845100` y `7836b8e` en la rama `codex/actualizacion-enterprise-230`, **sin subir al remoto** (la rama va
     5 commits por delante; los otros 3 son de otra sesión).
   - sincro-vicente: `8830944` (este documento, reglamentos y scripts), subido a main y desplegado.
2. **Pruebas tuyas en la tienda:**
   - el carrito con una ampliación y una protección juntas, y luego Combi;
   - el «Leer más» y el reglamento de las ventanas.
3. **Utils:** la vuelta del 2026-11-15 (10:00, ya con el código nuevo) terminó sin fallos y sin filas nuevas, así que el
   filtro nuevo no da error; que encuentre las líneas falta verlo con el primer pedido real. Cover, Combi y Display se
   piden a mano en el portal de Garantía3: el correo de aviso hay que atenderlo enseguida, porque el cliente tiene 7 días.
   Hoy no hay ninguna fila.
4. **Chatbot: cambiado y desplegado el 2026-11-15 (`d1fad53`)** (`chatbot-vicente/src/agent/garantias.ts`, ver su
   `docs/garantias.md`). Lee `custom.garantias_tipos` en vez de `custom.admite_garantia`, usa los tramos oficiales del
   tema (fuera la regla × 0,729), conoce las 22 garantías por `custom.referencia`, las quita todas de las búsquedas
   (antes Cover, Combi y Display salían como productos normales), aplica las combinaciones (una ampliación y una
   protección; Combi sola) y las vende sueltas. Probadas las herramientas con datos reales; las pruebas con el modelo
   no se pudieron pasar porque la cuenta de OpenAI del chatbot se ha quedado sin crédito, **también en producción**.
5. **Conector, el importador de MHD:**
   - escribir `custom.garantias_tipos` desde la ficha, con relectura semanal;
   - quitar las familias y las reglas por título;
   - dejar de escribir `custom.admite_garantia`;
   - **excluir las 22 garantías**: si las vuelve a procesar, les borra el reglamento y la descripción, y además están
     las bajas por ausencia y los precios (les pondría el `pvp` del bloque en lugar del de la tarifa). Hoy no corren riesgo (comprobado el 2026-11-15): ninguna está en
     `store_shopify_ids`, que solo rellena el importador al escribir. La 10040607 (Combi 500) sigue en
     `mhd_catalog_products` como presente con stock 1, aunque no se ve desde el 2026-08-19;
   - excluir siempre los reacondicionados al escribir los tipos, como en la carga a mano.
6. **Hecho el 2026-11-15: SKU de las 9 al código de MHD** (ver registro). Las 22 llevan ya el código de MHD, y las 9 la
   línea «Para aparatos de hasta X €» desde el 2026-11-15.
7. **Limpieza:** borrar la definición de `custom.admite_garantia` con sus valores, en una sola operación. Antes tienen
   que estar cambiados el chatbot y el importador.
8. **Preguntas a terceros:** los dos correos listos para enviar están en
   [GARANTIAS_PREGUNTAS_MHD_GARANTIA3.md](GARANTIAS_PREGUNTAS_MHD_GARANTIA3.md), con lo que cambia según cada respuesta.
   Resumen:
   - **A Garantía3:**
     - anulación al cancelar o desistir, que es la principal;
     - que el token admita Cover, Combi y Display;
     - plazo y `promocode` de Display;
     - reglamento de Cover;
     - tramos y significado del importe de Display;
     - tarjetas de Combi y Display;
   - **A MHD:**
     - títulos de las Combi en el bloque `garantia3` (solo informativo);
     - aceptar las garantías sin existencias;
     - bloque de garantías en el listado.
9. **Pendiente tras las respuestas:**
   - alta automática de Cover, Combi y Display en utils;
   - (la exportación de las garantías a MHD ya está hecha en local: falta desplegarla con David).
10. **Tu revisión:** tono de los textos y tarjetas de Combi y Display.
11. **Helpdesk:** comprobar que entiende los tipos nuevos (Cover y Combi caducan a los 7 días, Display se activa en la
    app) y los estados de anulación.
12. **Documentación de otros proyectos:** `docs/PEDIDOS_MHD_FASE_1.md` (dice que las garantías no se envían a MHD) y
    `garantia-3-calculo-y-asignacion.md` del tema (criterio antiguo × 0,729).

## Registro de cambios hechos

Lo que ya se ha tocado en la tienda, por fecha. Copias y scripts en `outputs/` (`garantias-scripts/`,
`garantias-imagenes/`).

**2026-11-14**
- **13 garantías nuevas creadas en borrador** (Cover ×4, Combi ×4, Display ×5): SKU = código de MHD, código de barras = EAN
  de Garantía3, precio de MHD, sin envío ni stock, etiquetas `Garantías` y `Servicios`, metacampos `custom.referencia`,
  `descripcion_corta`, `apartado` = servicios, `familia` = garantias, `consejo_elvi`. Publicadas en Tienda online y Shop
  (no se ven mientras estén en borrador). Lista en `outputs/garantias-creadas-2026-11-14.json`.
- **Etiqueta «Novedad» quitada a las 13.** La pone Shopify Flow a todo producto nuevo; si se crean más garantías, hay que
  quitarla otra vez.
- **Imágenes de las 13.** Cover: tarjeta oficial de MHD de cada tope. Combi y Display: tarjetas montadas por nosotros a
  partir de la de Cover, porque MHD y Garantía3 solo tienen versiones de ~230 px. Colores como en las oficiales: Combi con
  la paleta de las ampliaciones (250 verde, 500 rojo, 1000 azul claro, 2000 naranja); Display con la de Cover (250 verde
  lima, 500 magenta, 1000 morado) más 150 € naranja y 1.500 € morado oscuro, que no existen en Cover. Sustituir si Garantía3 manda las oficiales
  (`garantias-scripts/tarjetas.py` las regenera).
- **Textos de las 13** repasados contra la web y los reglamentos oficiales (Display sin «tope de reparación», sin
  «derrames», sin cifra de gastos en Cover).
- **Textos nuevos en las 9 que están a la venta** (descripción, meta descripción, descripción corta y consejo de Elvi), a
  partir de los reglamentos de 2 años y de 3 años (2026-01). Título, handle, SKU y precio sin tocar. Copia de lo anterior en
  `outputs/garantias-9-textos-antes-2026-11-14.json`. En el cambio coordinado se vuelven a aplicar con
  `textos9.mjs --escribir --con-tramo`, que añade «Para aparatos de hasta X €» con los tramos oficiales.

- **Las 13 activadas** (David: la tienda aún no está en producción). Siguen sin ofrecerse en las fichas de los aparatos:
  el tema busca por SKU `G3PDES…`/`G3PD3ES…` y el chatbot no las reconoce por el título. Si alguien comprara una suelta,
  utils no pediría contrato (no está en `GARANTIA3_EANS`) y avisaría.
- **Orden manual** en las colecciones `garantia3`, `garantias` y `servicios`: ampliación de 2 años, de 3 años, Cover,
  Display y Combi al final, cada grupo de menor a mayor tope; en `servicios`, los tres servicios propios archivados al
  final. Combi pasó al final el mismo día (David: primero las piezas sueltas y luego el paquete que las junta); el tema
  sigue el mismo orden en la ficha, la ventana y el carrito.
  Ojo: las colecciones son automáticas con orden manual; una garantía nueva entra al final y hay que recolocarla.
- **Inventario:** las 22 van sin seguimiento de stock y sin envío, así que siempre se pueden vender (`available`). Las 9
  antiguas conservan una cantidad residual (~999.000) de antes de quitar el seguimiento; no se usa.

- **Precios de MHD en las 9** (G3PD3ES1000 a 69,90 €): suben entre un 15 y un 18 %. No dependía del cambio coordinado:
  el tema, utils y el chatbot no usan el precio para encontrarlas. Anteriores en
  `outputs/garantias-9-precios-antes-2026-11-14.json`.
- **Textos completos de las 22** con `garantias-scripts/textos-garantias.mjs` (sustituye a `corrige13.mjs` y
  `textos9.mjs`): qué es, qué cubre, qué no cubre, para qué aparatos, cómo se activa, cómo pedir una reparación, con qué se
  combina, quién la presta y reglamento. Las 9 ampliaciones, aún sin la línea del tramo (`--con-tramo` en el cambio
  coordinado). Las reglas de combinación que citan son las de la decisión 9, que el tema aún no aplica.
- **Colecciones:** `garantias` pasa a llamarse «Garantías y protección contra accidentes» (antes «Ampliaciones de
  garantía»; mismo handle), con descripción nueva que explica los cuatro tipos, cómo se combinan, el tope, plazos de
  activación, cómo reclamar y reglamentos (se conservan el vídeo y la imagen). `garantia3` y `servicios`, descripción y
  SEO al día. Copia de lo anterior en `outputs/garantias-colecciones-antes-2026-11-14.json`.

- **Paso 2 hecho: metacampo `custom.garantias_tipos`** (lista de texto con opciones `ampliacion_2`, `ampliacion_3`,
  `combi`, `cover`, `display`; lectura pública en la tienda) creado y **cargado en 3.929 aparatos** desde la descarga del
  2026-11-14, cruzando el código de MHD con el SKU de Shopify (operación masiva de todos los productos). Fuera: 29
  reacondicionados («REAC.» o «reacondicionado» en el título de Shopify o de MHD), 220 que no están en la tienda y 93 sin
  ficha. No se filtra por precio: el mínimo de 60 € lo aplica el tema (401 de los cargados cuestan menos). Combinaciones:
  +2 +3 Combi Cover 1.764; +2 +3 1.752; +2 +3 Cover 149; solo +2 131; las cinco 128; +2 Cover 5. Lista en
  `outputs/garantias-tipos-carga-2026-11-14.csv`. Nadie lo lee todavía: la tienda sigue con `custom.admite_garantia`.
- **13.118 productos** tienen hoy `custom.admite_garantia` = sí y MHD no les asigna garantía (se les quitará en el paso
  6): `outputs/garantias-pierden-2026-11-14.csv`.

- **Paso 3, tema (en local, sin subir ni commitear; rama `codex/actualizacion-enterprise-230` del tema).**
  - **Cálculo:** `garantia-calculo` lee `custom.garantias_tipos`, aplica los tramos oficiales de cada tipo, busca cada
    garantía por `custom.referencia` y devuelve «id|tipo|céntimos|tope». El mínimo de 60 € se mantiene.
  - **Archivos nuevos:**
    - `garantia-etiqueta`: textos y grupo de cada tipo.
    - `garantia-tipos-info`: una ventana de condiciones por tipo. Solo lo que ayuda a elegir y el reglamento; sin
      contacto ni cómo reclamar (David).
  - **Dónde se elige**, con el (i) de cada opción y la regla de combinaciones:
    - ficha (`product-garantia`);
    - ventana «Completa tu compra» (`product-form.js`), que también usan la compra rápida, las tarjetas, el comparador,
      el producto destacado y el chatbot (`garantia-opciones`);
    - carrito (`cart-garantia`, `cart-items.js` y las ventanas en `cart-items`).
  - **Textos:** cabeceras «Garantía y protección», ajustes del tema y los dos textos de la portada (`templates/index.json`:
    el bloque de servicios y la ventaja «Garantía oficial de 3 años»).
  - **Especificación:** `docs/garantias.md`, apartado «Cambio del 14-11-2026».
  - **Probado en `theme dev`** con la cámara Kodak 26803 (315 €, cinco tipos):
    - salen las cinco con su tope (250, 250, Combi 500, Cover 250, Display 500);
    - las combinaciones se comportan bien en la ficha y en la ventana;
    - el (i) abre su ventana sin marcar la casilla, y en la ventana se piden bajo demanda.
  - **Sin probar:** el carrito, por la verificación anti-robots de Shopify en `/cart`.

- **Paso 4, utils: reconocimiento de las garantías (en local, sin desplegar ni commitear).** Garantía3 está en modo
  **producción** (desde el 2026-10-30, 14 días) y sin filas todavía.
  - **Qué cambia:**
    - La consulta de pedidos (`mhd-order-sync.ts`) guarda también el proveedor y el código de barras de cada línea.
    - Una línea es de Garantía3 si su proveedor es `GARANTIA3` o su SKU es de los antiguos.
    - El EAN sale del código de barras, con `GARANTIA3_EANS` de respaldo.
  - **Qué se pide solo:**
    - +2 y +3 siguen igual: espera de 14 días y alta automática, también cuando su SKU pase a ser el de MHD.
    - **Cover, Combi y Display** (y cualquier garantía sin código de barras) crean la fila **bloqueada** con aviso
      inmediato, para pedir el contrato a mano. Decidido por prudencia: David no llegó a elegir otra opción.
  - **Pruebas:**
    - `tests/garantia3.test.mjs`, con 3 casos nuevos: 11 de 11 bien. `tsc` sin errores.
    - Contra Shopify, solo lectura: la consulta ampliada devuelve proveedor y EAN en los pedidos de prueba #1004 y #1007.
    - En la base de datos, el filtro nuevo coge las mismas 4 líneas que el antiguo.

- **2026-11-15: tema publicado.**
  - **Copia de seguridad:** «Copia producción 2026-11-15 antes de garantías MHD» (tema 210696438092).
  - **Comprobado antes:** los 10 archivos que ya existían estaban publicados igual que en git, así que solo se suben mis
    cambios.
  - **Subidos con `--only`** al tema publicado 203606098252, 12 archivos:
    - snippets: `garantia-calculo`, `garantia-etiqueta` (nuevo), `garantia-tipos-info` (nuevo), `garantia-data`,
      `product-garantia`, `cart-garantia` y `cart-items`;
    - la sección `garantia-info`;
    - `product-form.js` y `cart-items.js`;
    - `settings_schema.json` y `templates/index.json`.
  - **Comprobado después:** se vuelven a descargar y coinciden con los locales.
  - **Commit `b845100`** en la rama `codex/actualizacion-enterprise-230` del tema, sin subir al remoto. Lleva
    esos 12 archivos y `docs/garantias.md`.
  - Desde aquí la tienda ya no usa `custom.admite_garantia`.

- **2026-11-15: reglamentos propios y «Leer más»** (David).
  - **Reglamentos:** los 4 PDF oficiales que existen (+2, +3, Combi y Display) están guardados en
    `docs/garantia3-reglamentos/`, subidos a Shopify › Archivos con el mismo nombre y puestos en `custom.documentos` de sus
    18 garantías. Salen en la ficha, en «Documentos».
  - **Enlaces:** las 18 descripciones y la de la colección `garantias` enlazan nuestra copia en lugar de la web de
    Garantía3. Copia de antes en `outputs/garantias-descripciones-antes-reglamentos-2026-11-15.json`; también
    `textos-garantias.mjs` usa ya nuestra copia.
  - **Cover:** sin reglamento, porque su PDF da 404 en la web de Garantía3.
  - **Tema:** en las ventanas de cada tipo, «Leer más sobre esta garantía» abre en ventana nueva la ficha de la garantía de
    ese aparato, y «Reglamento (PDF)» va a nuestra copia. Publicado tras comprobar que lo publicado era igual que el commit
    `b845100`; vuelto a descargar y coincide. **Sin commit en el tema.**
  - **Ojo, conector:** gestiona `custom.documentos` de lo que importa de MHD. Si llega a tocar las garantías, que tienen
    código de MHD, podría quitarles el reglamento. Excluirlas, junto con las bajas por ausencia y los precios (paso 5).

- **2026-11-15: comprobado que los tramos se interpretan bien** (pregunta de David).
  - **Las fuentes coinciden:**
    - La tarifa WEBSHOP pone Combi «Maximal 500 … Hasta 500 €», Cover «tope 500 … Hasta 700 €» y +2 «tope 500 …
      Hasta 650 €».
    - MHD describe la Combi como «MAXIMAL 500 … PARA PVP HASTA 500 €».
    - El reglamento de Combi dice que el tope es el coste máximo de cada reparación y que, si no se puede reparar, la
      sustituye por una igual con el tope como límite.
  - **Por qué Combi pide un tramo más alto:** tiene que cubrir el valor entero del aparato. +2 y Cover aceptan un aparato
    algo más caro que su tope, pero si no se puede reparar devuelven el precio con depreciación: Cover un 30 % y +2 un
    10 % por año.
  - **Corrección:** el 2026-11-15 se dijo que Combi salía más cara que +2 y Cover «con la misma cobertura», y no es así.
    Ejemplo, lavadora de 518 €: Combi de 1.000 € cuesta 132,95 €; +2 de 500 € y Cover de 500 € cuestan 106,33 €. Combi
    cubre reparaciones de hasta 1.000 € y, si no se puede reparar, da un aparato igual. Las otras dos cubren hasta 500 € y
    devuelven el precio depreciado. Por eso no se oculta Combi.
  - **Qué depende de verdad de la tarifa de 2023-10:**
    - **Tramos de +2, +3, Cover y Combi:** salen de la tarifa, pero los confirma la descripción actual de MHD
      (2026-11-14), que pone «PARA PVP HASTA …» en cada una con los mismos importes.
    - **Tramos de Display:** solo los da la tarifa. MHD no indica «hasta», solo el tope.
    - **Precio de la G3PD3ES1000:** 69,90 €, el de la tarifa, porque MHD la tiene a 45,42 € por error.
    - **Precios del resto y EAN:** son los de MHD, no los de la tarifa.

- **2026-11-15: SKU de las 9 al código de MHD** (David), con `garantias-scripts/sku9.mjs`: G3PDES250 → 10040604,
  500 → 10040586, 1000 → 10040587, 2000 → 10040588, 5000 → 10040589; G3PD3ES250 → 10040613, 500 → 10040614,
  1000 → 10040611, 2000 → 10040612. Antes se comprobó que cada una tenía su EAN y que ningún otro producto usaba esos
  códigos. Nada dependía ya del SKU: el tema busca por `custom.referencia`, utils por proveedor y código de barras, y
  el chatbot y helpdesk por el título. Copia de antes en `outputs/garantias-9-sku-antes-2026-11-15.json`. Comprobado
  después: las 22 activas, a la venta y con código de MHD.
- **2026-11-15, MHD (David):** aceptan las garantías en el pedido aunque estén sin existencias, y también un pedido
  con solo una garantía (es un producto que se vende así).
- **2026-11-15, facturación (David):** Garantía3 factura cada mes a MHD todas las garantías vendidas, y MHD nos
  factura la línea de garantía del pedido. No hay doble cobro: las altas las seguimos haciendo nosotros por la API.
- **2026-11-15, formato del pedido a MHD (David, lo acordado con MHD):** sin vínculos entre líneas. Van los aparatos y
  sus extras en orden, y cada garantía distinta **una sola vez, con la suma de sus unidades**.
- **2026-11-15, textos para la compra suelta** (David: breves y sin hablar de otras tiendas), con
  `textos-garantias.mjs --escribir --con-tramo` y `colecciones.mjs`:
  - +2/+3: «Añádela al carrito con el aparato o, si ya lo tienes, sola» y «Actívala … dentro del primer año desde la
    compra del aparato»; las 9 llevan ya «Este tope es para aparatos de hasta X €».
  - Combi: «Añádela con el aparato o sola en los 7 días siguientes a comprarlo» y plazo «en los 7 días siguientes a la
    compra del aparato».
  - Cover y Display, sin cambios.
  - Colección `garantias`: «Si ya tienes el aparato, también puedes comprar la garantía sola: cada una indica para qué
    precio de aparato es» y el plazo de las ampliaciones igual que en las fichas. Los enlaces a los reglamentos del
    script pasan a nuestra copia en Shopify, como ya estaban publicados.
  - Antes se comprobó que los scripts reproducían lo publicado. Copias: `outputs/garantias-textos-antes-sueltas-2026-11-15.json`
    y `outputs/garantias-colecciones-antes-2026-11-15.json`.
- **2026-11-16: precios de la tarifa de MHD** (David: «aplica los precios», sin copia). MHD manda la tarifa con los
  precios a publicar (`Tarifas_16112026_091240.csv`). 21 de las 22 cambian; la G3PD3ES1000 ya estaba a 69,90 €.
  Ahora: +2 34,90 / 41,90 / 54,90 / 73,90 / 113,90; +3 42,90 / 52,90 / 69,90 / 95,90; Cover 37,90 / 62,90 / 87,90 /
  112,90; Display 24,90 / 35,90 / 46,90 / 57,90 / 79,90; Combi 69,90 / 97,90 / 131,90 / 169,90. Comprobado: las 22
  cuadran y ninguna descripción lleva precios. La tarifa trae también Casa Nueva para 3 y 4 electrodomésticos
  (10040624 y 10040625): por ahora no se crean (David). La tarifa confirma la G3PD3ES1000 a 69,90 € y los títulos de
  las Combi: lo raro solo está en el bloque `garantia3` de las fichas. Se quita esa pregunta del correo a MHD.

## Qué tiene que saber cada proyecto

Para cuando toque cada paso. Hecho ya (2026-11-15): todo lo del tema y, en utils, el reconocimiento por proveedor y
código de barras. Lo demás sigue pendiente (ver «Pendiente»).

- **Tema (`theme-enterprise-vicente`):** las garantías se buscarán por los **tipos** del metacampo nuevo, no por SKU
  `G3PDES…`/`G3PD3ES…` (los SKU pasan a ser códigos de MHD). Tramos oficiales por tipo, no × 0,729. Dos grupos
  (ampliación +2/+3; protección Cover/Display) y Combi, que excluye a todo. Mínimo 60 €, reacondicionados fuera. Display
  se puede vender también suelto. Actualizar `docs/garantias.md` y `garantia-3-calculo-y-asignacion.md`. La portada
  (`templates/index.json`) tiene un bloque titulado «Ampliaciones de garantía»: revisar con el nombre nuevo de la
  colección.
- **Utils (este proyecto):** EAN desde el código de barras de la variante (fuera `GARANTIA3_EANS`); reconocer las 22;
  exportar las garantías a MHD como una línea más (`src/lib/mhd-order-lines.ts`, y corregir `docs/PEDIDOS_MHD_FASE_1.md`,
  que dice que no se envían); alta inmediata en Cover y Combi (o en todas, según responda Garantía3); Display necesita
  `promocode`. Excluir las garantías de las bajas por ausencia y de la sincronización de precios (riesgo con 10040607, que
  está obsoleta en `mhd_catalog_products`). Actualizar `docs/GARANTIA3.md`.
  Puntos concretos vistos el 2026-11-14: `src/lib/garantia3-vuelta.ts` (`crearFilas`) busca las líneas con
  `.like("sku", "G3PD%")`, que deja de encontrar nada cuando el SKU sea el código de MHD; `filasDePedido` saca el EAN de
  `GARANTIA3_EANS[sku]`. Hay que guardar con cada línea el código de barras de la variante (y, mejor, el tipo de producto)
  en la consulta de pedidos de `src/lib/mhd-order-sync.ts`, que hoy no lo pide, y reconocer las garantías por
  `productType` = «Garantías» o por un EAN 8033509…, con la tabla como respaldo durante la transición.
- **Conector / importador:** fuera familias y reglas por título; escribir el metacampo de tipos desde la ficha; relectura
  semanal de fichas con garantía.
- **Chatbot (`chatbot-vicente`):** hoy saca tope y años del título (`/m[aá]ximo … hasta N años/`), usa
  `custom.admite_garantia` y `minPrice` = 60. Tiene que pasar a leer los tipos y conocer Cover, Combi y Display. Revisar
  también los textos que hablan de «Ampliaciones de garantía» (`src/config/store.ts`, `src/agent/prompt.ts`). Los títulos
  de las 13 están hechos para que su patrón actual no los confunda con +2/+3.
- **Helpdesk:** reconoce las líneas de Garantía3 por `service && /garant/i.test(title)` y muestra los contratos de
  `/api/admin/v1/garantia3`. Los 22 títulos llevan «Garantía», así que sigue funcionando; revisar que entiende los tipos
  nuevos (Cover y Combi caducan a los 7 días; Display se activa en la app) y los estados de anulación.
- **MHD:** recibirá las garantías en los pedidos con su código; falta confirmar que las acepta sin stock.

