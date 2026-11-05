# Importación de pedidos PrestaShop → Shopify

Decisiones tomadas con David el 4-11-2026, antes del primer simulacro. Todo el
análisis se ha hecho en solo lectura (usuario MySQL `lectura_vicente`, prefijo
`ev_`). No se ha escrito nada en PrestaShop ni en Shopify.

Antecedente: en 2024 ya se importaron pedidos con Matrixify (ejemplo
`PS-WSWYMZMTD-67710`). Ahora se hará por la Admin API (`orderCreate`) desde
local, sin pasar por la app hasta tenerlo claro.

## Orden de trabajo

1. **Primero, los clientes que faltan.** Antes de cualquier pedido.
2. Simulacro con un solo pedido de un cliente ya importado.
3. Importación completa de pedidos.

## Clientes que faltan

La importación del 31-10-2026 (`sync-prestashop-customers`, modo `all` con
`onlyWithValidOrders`) filtró por `ev_orders.valid = 1`. Esa marca no es fiable
en esta tienda (ver «Estados»): quedaron fuera unos 34.100 clientes con pedidos
vendidos y entraron unos 1.067 sin ningún pedido de los grupos a importar
(estos se dejan como están; decisión aplazada).

Decisión: no recorrer otra vez a todos descartando los ya importados, sino
calcular antes la lista exacta de pendientes y procesar solo esa:

1. **Ya importados**: los `prestashop_customer_id` de `customer_import_events`
   con resultado `created` o `existing`.
2. **Ya en Shopify por otra vía**: emails de todos los clientes de Shopify,
   sacados con una exportación masiva (bulk operation), no consulta a consulta.
3. **Pendientes** = clientes de PrestaShop con algún pedido de los grupos a
   importar, agrupados por email, menos (1) y menos (2). Estimación: ~34.000.
4. El importador gana un modo nuevo que recorre esa lista guardada en Supabase
   (como hoy hace `retry_errors` con los errores de otra ejecución).

Se mantiene la comprobación por email antes de crear cada cliente, por si
alguien se registra en Shopify mientras corre el proceso.

Primero se calcula el punto 3 en local y se enseñan los números; después se
toca el importador.

**Hecho el 4-11-2026.** Calculado con todos los emails de Shopify (exportación
masiva, 44.636): 83.194 emails de PrestaShop con pedidos de los grupos a
importar, de los que faltaban 45.916 (no 34.000: la estimación inicial se quedó
corta). 8 sin ninguna cuenta activa se quedan fuera. Modo nuevo `list` del
importador (tabla `customer_import_queue`); prueba con 5 clientes y ejecución
«Clientes que faltaron» (`41cd2530-…`) con 45.903, unas 13-14 h. El metacampo
`historico_de_prestashop` cuenta ahora los pedidos cobrados y no cancelados
según el historial, no la marca `valid`.

## Qué pedidos se importan

Ninguna casilla de PrestaShop dice de forma fiable si un pedido fue una venta.
Se clasifica cada pedido por su estado actual y por su historial
(`ev_order_history`): «cobrado» = pasó alguna vez por 2, 3, 4, 5, 9, 11, 22,
24, 27, 29 o 32; «enviado» = pasó por 4, 5 o 27.

| Grupo | Pedidos | Se importa | En Shopify |
|---|---|---|---|
| Enviado (cobrado y enviado) | 81.584 | Sí | Pagado · Enviado |
| Cobrado sin enviar | 138 | Sí (decidido el 4-11) | Pagado · Enviado · etiqueta `PrestaShop-estado-sin-cerrar` |
| Reembolso parcial (estado 18) | 1.755 | Sí | Reembolsado parcialmente · Enviado |
| Reembolsado total (estado 7) | 14.381 | Sí | Reembolsado |
| Cancelado tras cobrar (6 o 25) | 3.005 | No | — |
| Cancelado sin cobrar | 7.156 | No | — |
| Nunca cobrado | 9 | No | — |

En Shopify solo se usan sus estados propios (pagado, reembolsado, enviado,
cancelado); nada de «Solicitar opinión». Todos los pedidos importados quedan
cerrados y archivados.

**Los 138 cobrados sin enviar**: 124 son de 2025-2026, casi todos en «Pago
realizado». En Vicente no debería haber pedidos abiertos. Decisión de David
(4-11): se importan como pagados y enviados, con la etiqueta
`PrestaShop-estado-sin-cerrar` para poder localizarlos.

## Estados de PrestaShop mal configurados

- 27 «Solicitar opinión»: posterior al envío pero no es válido, pagado ni
  enviado (y está oculto). Quitó la marca `valid` a ~35.000 pedidos vendidos.
  3.631 pedidos pasaron de «Pago realizado» directamente a este estado.
- 18 «Reembolso parcial» (de `ps_checkout`, usado a mano): ni válido ni pagado.
- 5 «Entregado»: sin la casilla de entregado (casi sin uso).
- 29 «CETELEM – Crédito financiado»: válido pero no pagado.
- 26 «Redsys – Esperando confirmación»: pagado pero no válido (sin uso).
- Ningún estado genera factura; «Enviado» no envía email.
- «Enviado → Enviado» se repite 104.715 veces (probablemente un registro por
  bulto o seguimiento): cuidado con no crear envíos duplicados.

## Campos del pedido en Shopify

- **Número**: `name` admite cualquier texto. Formato de Matrixify:
  `PS-<referencia>-<id_order>`.
- **ID de origen**: `sourceIdentifier` = `id_order` de PrestaShop.
- **Canal**: no se crea otra app. El canal saldrá con el nombre de la app que
  importa; el origen se marca con la etiqueta `PrestaShop`.
- **Líneas**: si el producto no existe en la tienda, línea sin `variantId` con
  título, SKU, precio, IVA y cantidad. Pendiente de decidir si se enlaza con la
  variante cuando el SKU coincida.

## Cliente y direcciones del pedido

- El pedido se asocia al cliente buscándolo por email (`customerByIdentifier`)
  y con `toAssociate`, que no modifica su ficha.
- Las direcciones de envío y facturación (`id_address_delivery`,
  `id_address_invoice`) se copian en el pedido con el mismo formato que la
  importación de clientes. El pedido guarda su propia copia; no enlaza con la
  libreta del cliente, así que no hace falta el ID de la dirección.
- **Por comprobar en el simulacro**: si Shopify añade las direcciones del
  pedido a la libreta del cliente. Si lo hace, se comparan antes con la misma
  regla del importador de clientes (calle, piso, ciudad, CP, país).

## Mensajes del pedido

Hay dos sistemas que se solapan: `ev_message` (antiguo) y
`ev_customer_thread` + `ev_customer_message`. El comentario del pedido está en
los dos (26.424 coincidencias) y se toma una sola vez.

| Tipo | Cómo se reconoce | Destino |
|---|---|---|
| Mensaje original del pedido | Privado, sin empleado, grabado en los 2 minutos siguientes al pedido | Nota del pedido |
| Enviado después al cliente | Empleado y público; o el automático de seguimiento | Metacampo de historial |
| Nota interna | Empleado y privado | Metacampo de historial |
| Ruido de módulos | «Se ha informado a SeQura…», bloque HTML «Detalles Pedido» | Se descarta |

La API no permite escribir comentarios en la cronología del pedido.

Según David, los mensajes originales sin empleado los graban ellos (pedidos
creados desde el back office). Falta ver si se distinguen de los de clientes
en la web.

## Mapeo acordado (4-11-2026)

- **Número**: `name` = `PS-` + referencia de PrestaShop (`4-` + `id_order`),
  p. ej. `PS-4-5108088`. `sourceIdentifier` = `id_order` (campo técnico).
- **Fecha**: `processedAt` = `date_add` del pedido, convertida de hora de
  Madrid a UTC.
- **Líneas**: título, SKU (`product_reference`), cantidad y precio final
  pagado (las rebajas de catálogo no son descuento). El IVA no está guardado
  por línea (`tax_rate` = 0 en todas): se calcula de precio con y sin IVA.
  EAN en el título de variante de la línea («EAN 4242005481958», se ve bajo el
  título); no en el premium ni en códigos internos `9999999…`. El envío
  premium va siempre en la última línea.
- **Premium**: aquí es una línea de producto «Servicio Premium» (no el
  embalaje regalo de otros proyectos). Entra como «Envío premium», SKU
  `PREMIUM`, con su cantidad y precio.
- **Sin IVA**: 216 pedidos a Portugal (casi todos con NIF) y 40 «Pedido
  gratuito»: sin impuestos, como en PrestaShop.
- **Descuentos**: `ev_order_cart_rule`, con su nombre literal. La API solo
  admite un descuento por pedido: con varios cupones, uno solo con los nombres
  unidos por « + » y el importe total; desglose en el metacampo.
- **Portes**: líneas de envío con su IVA; forma de envío siempre la misma.
- **Nota del pedido**: solo el mensaje original. El resto, en el metacampo
  `prestashop.historial` (texto de varias líneas, orden cronológico), con las
  fechas reales de cada cambio de estado y quién lo hizo.
- **Seguimiento**: además, en el envío de Shopify (número y transportista).
- **Forma de pago**: como nombre del pago (gateway). Metacampos
  `prestashop.estado` y `prestashop.forma_pago`. Etiquetas: solo `PrestaShop`
  (y las de casos especiales). ID de transacción como código de autorización.
- **Entregas parciales** (campo del checkout `kb_order_field`, id 1): se
  fusiona con el atributo de Shopify «Enviar todo junto: Sí» cuando el cliente
  no aceptó entregas parciales.
- **Archivado**: todos los pedidos se crean cerrados (`closedAt`).
- **Sin avisos al cliente**: `sendReceipt` y `sendFulfillmentReceipt` a
  false, `notifyCustomer` a false, inventario sin tocar, reembolsos dentro del
  propio pedido. Revisar antes apps y automatizaciones que reaccionen a
  pedidos.

## Reembolsos (regla aprobada)

Fuentes: `ev_redsys_refund` (17.173 devoluciones correctas, en euros, con
fecha) y los pagos negativos de `ev_order_payment`. Los pagos negativos de
tarjeta suelen repetir la devolución de Redsys.

Importe devuelto = Redsys + pagos negativos que no sean de tarjeta (si no hay
Redsys, todos los negativos), con el total del pedido como máximo.
0 → Pagado; total → Reembolsado; parte → Reembolsado parcialmente.

| Grupo PrestaShop | Pagado | Reemb. parcial | Reembolsado |
|---|---|---|---|
| Enviado (81.722) | 79.016 | 2.237 | 493 |
| Reembolso parcial (1.755) | 26 | 1.438 | 291 |
| Reembolsado total (14.399) | — | 126 | 11.656 + 2.617 |

- 2.617 «Reembolsado» sin importe registrado: Reembolsado por el total, con
  «importe no registrado en PrestaShop» en el metacampo.
- 26 «Reembolso parcial» sin importe: Pagado, con nota en el metacampo.
- ~530 pedidos con más devuelto que su total (compras divididas en varios
  pedidos con un único pago): se limita al total del pedido, con nota.

**Corrección aprobada el 4-11-2026 (líneas anuladas tras pagar).** Cuando se
anulaba una línea después de cobrar, PrestaShop la borraba del pedido, rebajaba
el total y anotaba la devolución (p. ej. `4-5104855`: cobrados 1.688 €, total
1.283 €, devueltos 405 € por un horno anulado). Esa devolución no es un
reembolso del pedido que queda. Regla: lo cobrado por encima del total
(`ev_order_payment` positivos − total) se descuenta primero de las
devoluciones; solo el resto es reembolso en Shopify. Lo descontado queda en el
historial. Afecta a 2.975 pedidos. Resultado recalculado:

| Grupo PrestaShop | Pagado | Reemb. parcial | Reembolsado |
|---|---|---|---|
| Enviado (81.746) | 81.136 | 544 | 66 |
| Reembolso parcial (1.755) | 598 | 1.139 | 18 |
| Reembolsado total (14.399) | — | 101 | 11.633 + 2.665 sin importe |

## Pedidos de prueba

`4-5101813` (2 cupones, premium, mensajes, seguimiento), `4-5104424`
(Portugal sin IVA), `4-5104855` (reembolso en pedido «Enviado»), `4-5108036`
(premium de pago). Se crea uno, se revisa y se prueba a borrarlo
(`orderDelete`) antes de los demás.

## Resultado del primer pedido de prueba (4-11-2026)

`PS-4-5101813` creado con `scripts/preparar-pedido-prestashop.mjs` +
`scripts/crear-pedido-prestashop.mjs`. Comprobado:

- Shopify **no añade** las direcciones del pedido a la ficha del cliente.
- Los pedidos importados **se pueden borrar** con `orderDelete` (probado).
- El premium debe requerir envío; si no, el pedido queda «Parcialmente
  preparado». El impuesto se llama solo «IVA» (Shopify añade el %).
- El texto «(0.0 kg: artículos…)» de los portes lo añade Shopify siempre (también
  con Matrixify). Los pesos de PrestaShop no son reales: no se envían.
- **Avisos al personal**: cada pedido creado dispara el aviso de «pedido nuevo»
  (email y app). Antes de la importación completa hay que desactivarlos.
- Definiciones de metacampos `prestashop.estado`, `prestashop.forma_pago`
  (filtrables) y `prestashop.historial`, fijadas en la ficha del pedido.

## Seguimiento

`ev_order_carrier.tracking_number` está vacío en los 108.086 pedidos. El
seguimiento solo existe dentro del HTML del mensaje automático («Enviado por»,
«Código/Número de seguimiento», enlace «Seguimiento»). Pendiente de comprobar
si se extrae bien en todos y llevarlo al envío del pedido en Shopify.

## Importación desde la app (preparada el 4-11-2026, sin lanzar)

Utils → Pladisel (antiguo) → **Importación de pedidos** (`/importacion-pedidos`).
Mismo esquema que la de clientes: tablas `order_import_runs`,
`order_import_queue` y `order_import_events`, cola pgmq `order_import_jobs`,
cron cada minuto y Edge Function `sync-prestashop-orders` en tandas de 110 s.

- Las reglas de este documento viven en
  `supabase/functions/_shared/pedido-prestashop.ts`, que usan a la vez la
  función y el script `scripts/preparar-pedido-prestashop.mjs`.
- Alcances: pedidos concretos (hasta 200 referencias), todos (cobrados y no
  cancelados, incluidos los 138 cobrados sin enviar, que entran como enviados
  con la etiqueta `PrestaShop-estado-sin-cerrar`) y reintento de errores.
- Por cada pedido: si ya hay uno con ese nombre en Shopify se salta; si el
  cliente no existe, queda como error para reintentarlo; `orderCreate` nunca
  se repite a ciegas (si se pierde la respuesta, el siguiente intento lo busca
  por nombre).
- «Todos los pedidos» pide confirmación y recuerda apagar antes los avisos al
  personal.

**Lanzamiento (4-11-2026, noche).** David desactivó los avisos al personal
(destinatarios de «Notificaciones para empleados») y pidió que la importación
de pedidos arrancase sola al acabar la de clientes. Ejecución «Todos los
pedidos» `ac6f8449-…` preparada en pausa con 97.886 pedidos; el cron
`sincro-vicente-start-orders-after-customers` (cada 5 min,
`start_order_import_after_customers`) la encola cuando la de clientes
`41cd2530-…` queda completada y se borra a sí mismo. Al terminar hay que
reactivar los avisos al personal.

**Qué pasó esa noche y cómo se corrigió (5-11-2026).** La ejecución arrancó a
las 23:25 y siguió hasta las 07:33, cuando la pausamos. Hubo dos problemas:

1. *Límite de Shopify.* La tienda está en plan Development y ahí `orderCreate`
   solo admite 5 pedidos por minuto; el resto responde «Too many attempts» sin
   crear el pedido. El trabajador lo trataba como error del pedido: 23.468
   errores, que en realidad son pedidos pendientes. En un plan de pago no hay
   tope de pedidos por minuto, solo el límite general de la API (100 puntos/s
   en Basic; una mutación ≈ 10 puntos).
2. *Dos trabajadores a la vez.* Reanudar y pausar a mano dejó un mensaje vivo
   en la cola y el arranque automático añadió otro. Los dos recorrieron los
   mismos pedidos; la búsqueda por nombre de Shopify tarda unos segundos en
   ver un pedido nuevo y se crearon **504 pedidos duplicados** (lista en
   `outputs/pedidos-duplicados-a-borrar.csv`; se conserva la primera copia).

Correcciones (migración `20261105074030_order_import_single_worker`):

- Un solo trabajador por ejecución: `claim_order_import_run` reclama la
  ejecución durante 240 s; un mensaje que no la consigue y no es el suyo se
  descarta como duplicado.
- Reanudar y el arranque automático reutilizan el mensaje si sigue en la cola.
- En tienda de desarrollo o en prueba, un `orderCreate` cada 12,5 s; ante
  «Too many attempts» se espera 20 s y se repite el mismo pedido, sin marcarlo
  como error.
- Antes de crear, se mira también nuestro registro (`order_import_events`): si
  el pedido ya se creó en cualquier ejecución, cuenta como existente.
