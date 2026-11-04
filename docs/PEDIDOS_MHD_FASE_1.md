# Pedidos Shopify → MHD: fase 1

## Objetivo

Incorporar en Sincro Vicente un módulo independiente para revisar y exportar manualmente pedidos de Shopify a MHD, y para consultar después su estado en MHD.

## Decisiones acordadas

- Shopify se consumirá mediante la versión más reciente de su API con los permisos ya disponibles, sujetos a comprobación durante la implementación.
- El SKU de cada línea de Shopify corresponde al `codigo` de producto de MHD.
- El precio unitario enviado a MHD será el precio que figure en el pedido de Shopify, no una tarifa actual del catálogo. Se conservan separadamente subtotal de productos, descuentos, gastos de envío y total del pedido, junto con códigos y literales de promociones para auditoría futura.
- Los descuentos, portes y servicios adicionales se traducirán al formato que admita el endpoint `POST /orders` de MHD. La regla exacta se definirá después de revisar un pedido real de prueba y la documentación vigente de MHD.
- El operador seleccionará manualmente los pedidos a exportar en esta fase; no habrá exportación automática.
- La exportación debe guardar el identificador MHD, `id_transaccion` y cualquier otro identificador devuelto para cada pedido creado.
- Cada exportación enviará también `referencia_web` con la referencia comercial visible del pedido Shopify. MHD permite buscar pedidos por este campo.
- Se conservarán los intentos, respuestas y errores de exportación. En cada actualización de MHD se guardará la última respuesta de estados (`estado_cliente` y `arr_estados`) junto al pedido: MHD seguirá siendo la fuente de verdad y no se replicará un histórico de estados en registros propios.
- Las direcciones sólo se podrán exportar si país y provincia/distrito tienen una correspondencia válida con MHD. Se mantendrán mapeos para España y Portugal.
- Los estados se importarán desde MHD. Cuando MHD indique que un pedido se ha enviado, el flujo futuro actualizará Shopify en sentido inverso con el estado de envío y el número de seguimiento.

## Criterio inicial de elegibilidad

Un pedido podrá proponerse para exportación si:

1. Está pagado en Shopify.
2. No está cancelado.
3. No está ya enviado completamente en Shopify.
4. No tiene una exportación MHD correcta anterior.
5. Todas sus líneas tienen SKU y una dirección exportable a MHD.

Los pedidos no elegibles también se conservarán localmente, con el motivo de bloqueo visible.

## Controles imprescindibles

- Validar las líneas devueltas por MHD: `201` o `success=true` no bastan, porque MHD puede crear un pedido vacío si un SKU no existe.
- No reintentar automáticamente un envío cuyo resultado sea desconocido (por ejemplo, un corte de red tras enviar el `POST`). Podría duplicar un pedido en MHD.
- Antes de marcar un resultado como desconocido, consultar MHD por `referencia_web`; si existe un pedido, recuperar y guardar sus identificadores en lugar de volver a crearlo.
- Registrar el payload enviado y la respuesta recibida, con acceso limitado y datos personales minimizados en la interfaz.
- Mostrar separadamente el estado de Shopify y el último estado conocido de MHD.

## Observaciones y descuentos enviados a MHD

MHD no dispone de un campo estructurado equivalente a las promociones de
Shopify. Cada línea se enviará con su precio neto y los portes se enviarán por
separado. Para conservar la interpretación comercial del pedido, el campo
`observaciones` de MHD se compone así, omitiendo la línea que no tenga valor:

```text
Observaciones del pedido: [nota escrita en Shopify]
Detalle de los descuentos aplicados: [códigos, títulos o literales de Shopify]
```

### Aviso «Enviar todo junto» (desactivado)

**Desactivado el 17-10-2026 por decisión del usuario**, a la vez que se quitó el
interruptor del carrito en el theme. Hoy las observaciones llevan solo la nota
del cliente y los descuentos.

Qué hacía: si el pedido traía el atributo `Enviar todo junto` con valor `Sí`
(el carrito lo guardaba al marcar la casilla; en el admin se ve en «Detalles
adicionales»), añadía en línea aparte, justo después de la nota del cliente:

```text
El cliente pide que se envíen todos los artículos juntos.
```

La sincronización sigue leyendo `customAttributes` del pedido y guardándolo en
`source_payload`; las observaciones se recalculan en cada exportación a partir
de la nota original, así que el aviso no se duplica ni sustituye a la nota.

Para reactivarlo: volver a poner el interruptor en el theme y cambiar
`SHIP_TOGETHER_ENABLED` a `true` en `src/lib/mhd-order-notes.ts`; ajustar la
primera prueba de `tests/mhd-order-notes.test.mjs` (`npm test`).

## Correspondencias de provincias

Las correspondencias no se consultan en MHD durante cada exportación. Se
guardan en `mhd_order_province_mappings` y se resuelven por `país ISO + código
de provincia de Shopify`, obteniendo el identificador de provincia de MHD. Se
han cargado una vez las 52 provincias de España y las 20 regiones de Portugal.
Ceuta, Melilla, Canarias, Açores y Madeira permanecen registradas pero no se
pueden exportar porque MHD informa que no presta envío allí.

## Resultado de la exportación manual

Antes del envío se pide confirmación explícita. Cada llamada guarda una fila en
`mhd_order_exports` y un intento auditable en `mhd_order_export_attempts`, con
el payload, respuesta, HTTP y error si lo hubiera. Cuando MHD confirma el
pedido, la tarjeta muestra su número (`MHD #…`), la transacción y el estado.
Si la respuesta es ambigua o las líneas devueltas no coinciden, se marca como
resultado desconocido y se bloquea cualquier reintento automático para evitar
duplicados.

## Fuera de alcance por ahora

- Exportación automática.
- Cancelar o modificar en MHD un pedido que se cancele o cambie después en Shopify.
- Marcar automáticamente pedidos como enviados en Shopify.
- Automatizar acciones al recibir un estado de MHD.

## Pendiente para una fase futura

Si un pedido ya exportado se cancela o se modifica en Shopify, esta primera fase no transmitirá el cambio a MHD. Se debe definir con MHD si existe un mecanismo para cancelar o actualizar pedidos, y las reglas operativas para gestionar los casos ya procesados.

La actualización inversa hacia Shopify se diseñará cuando se conozcan y validen los estados MHD, el momento que representa realmente el envío y el formato de tracking disponible.

## Información por confirmar

- Esquema real de pedidos de Shopify y campos disponibles en un pedido de prueba.
- Documentación actual de estados MHD, incluyendo los valores y datos de seguimiento.
- Regla de conversión de descuentos, portes y servicios desde Shopify al payload MHD.
- Listado de países, provincias y distritos de MHD habilitados para España y Portugal.

## Hallazgo de documentación pública (2026-08-16)

La colección pública actual de MHD documenta `referencia_web` en `POST /orders` y como filtro exacto de `GET /orders`. Una respuesta de detalle también lo devuelve. Se usará como clave de reconciliación entre Shopify y MHD.

La documentación muestra estados de ejemplo `Registrado`, `Pagado`, `Pendiente de revisión` y `Cancelado`, dentro de `arr_estados`, con fecha. No documenta todavía un campo de transportista, número de seguimiento o un endpoint para actualizar estados; habrá que confirmarlo con MHD antes de diseñar la sincronización inversa de envío hacia Shopify.

## Hallazgo en el intercambio inicial con MHD (marzo-abril de 2026)

El correo de propuesta de MHD indica expresamente que, mediante API, se podrá
consultar de un pedido su **estado, factura y seguimiento**. También especifica
que el número de pedido web devuelto al dar de alta el pedido será la referencia
para consultar posteriormente seguimiento y facturas.

Es una señal relevante para la futura sincronización de envíos hacia Shopify.
Sin embargo, la respuesta actual de `GET /orders/:id` que hemos validado solo
incluye los estados y no expone todavía transportista, tracking, factura ni
detalle de expediciones. Antes de automatizar Shopify habrá que pedir a MHD:

- Endpoint y estructura exacta de seguimiento y factura.
- Transportista, número y URL de seguimiento.
- Tratamiento de envíos múltiples y la relación entre cada envío y sus líneas.
- Estado exacto que representa la expedición y si permite saber qué artículos
  han sido enviados.

## Evolución futura: app integrada en Shopify y reducción de datos locales

Cuando el circuito de exportación y consulta de estados esté consolidado, se
valorará trasladar este módulo a una app integrada en el administrador de
Shopify. En ese escenario, Shopify será la fuente operativa de los datos del
pedido: cliente, direcciones, campo Empresa/NIF, notas, descuentos, líneas,
SKU, cantidades, importes, portes, pago y estado de cumplimiento se leerán del
pedido de Shopify cuando se visualice o se vaya a exportar.

Supabase no deberá replicar el pedido completo. Conservará solamente la
información propia de la integración:

- La relación entre el pedido Shopify y el pedido/transacción de MHD.
- Correspondencias de países y provincias.
- Intentos de exportación, payload, respuesta y errores.
- La última respuesta de estados de MHD, incluido su `arr_estados` tal como se
  recibe.
- Una instantánea inmutable del pedido y del payload exactos enviados a MHD.

La instantánea de exportación es necesaria para auditoría: permite conocer qué
precio, dirección, observaciones y descuentos se transmitieron, incluso si el
pedido se modifica o cancela más adelante en Shopify. No se utilizará como
fuente habitual de visualización.

La futura actualización de envío en Shopify deberá crear o completar el
fulfillment correspondiente con transportista, tracking y URL. Solo se
implementará cuando MHD confirme de dónde obtiene esos datos y qué estado
representa exactamente la expedición.

## Respuesta de MHD (octubre de 2026)

MHD ha publicado la documentación en una URL nueva y ha resuelto la mayoría de
los puntos pendientes; el detalle está en [API_MHD.md](API_MHD.md):

- `GET /orders/:id` ya devuelve transportista, número y URL de seguimiento, y
  las facturas (`arr_facturas_info_full`, enlaces permanentes).
- La lista de estados está en `GET /order-states`. `Enviado` es el id 10.
- MHD no puede indicar qué productos van en cada envío si hay varios.
- Las cuatro propiedades de seguimiento se unificarán en una (avisarán).
- `precio` y `portes` de cada línea son **unitarios**. La exportación actual
  pone el total de portes en la primera línea, así que se multiplica si esa
  línea tiene más de una unidad. Hay que corregirlo.

### De dónde sale el porte por unidad

Desde el 9-10-2026 los portes de Shopify no son una tarifa fija: los calcula el
servicio de envío `src/app/api/shopify/portes/route.ts` (CarrierService),
documentado en `theme-enterprise-vicente/docs/opciones-entrega.md`:

- Cada aparato lleva el metacampo de producto `custom.opciones_entrega` (JSON
  con las mismas claves que MHD: `gastos_envio_peninsula_particulares`,
  `gastos_envio_baleares_particulares`,
  `gastos_envio_portugal_baremo_1_particulares`,
  `gastos_envio_portugal_baremo_2_particulares`, `subida_puerta_particulares`,
  `retirada_usado_particulares`, `instalacion_particulares`).
- La zona sale de la dirección de envío: península; Baleares (`PM` / CP 07);
  Portugal baremo 1 (CP 2200-2499 y 3000-4999) o baremo 2 (resto, salvo 9000+).
- Portes del pedido = suma de (porte del aparato en esa zona × cantidad).
  Aparato sin metacampo: 0 €.

Por tanto, el `portes` de cada línea en MHD es el valor de ese metacampo para
la zona del pedido, por unidad. El pedido de Shopify solo guarda el total de
envío, sin desglose, así que hay que leer el metacampo y comprobar que la suma
(porte × cantidad) coincide con el envío cobrado. Si no coincide (por ejemplo,
porque el metacampo ha cambiado desde la compra o hay un descuento en el
envío), no se exporta sin revisión. En la recogida en tienda los portes son 0.

### Servicios y garantías

Los servicios (`SUBIDA-*`, `RETIRADA`, `INSTALACION-*`) van como líneas anidadas
bajo su aparato (`lineItemGroup.variantSku`). En MHD no son productos: se
convierten en `subida`/`precio_subida`, `retirada`/`precio_retirada` e
`instalacion`/`precio_instalacion` de la línea del aparato, con el precio
unitario pagado (MHD lo multiplica por la cantidad).

- La tienda no permite separar servicios y unidades: un servicio lleva siempre
  las mismas unidades que su aparato. Si no coinciden, el pedido se bloquea.
- La instalación incluye la subida: si llegan las dos a la vez, se bloquea.
- Las garantías (y cualquier otra línea anidada que no sea un servicio) no son
  de MHD y no se envían.

Implementado en `src/lib/mhd-order-lines.ts`, que usan la sincronización (para
calcular la elegibilidad y mostrar el motivo de bloqueo), la exportación y el
servicio de portes (zonas). La comprobación de la respuesta de MHD solo compara
los aparatos enviados.

### Seguimiento y facturas en la actualización de estados (10-10-2026)

«Actualizar desde MHD» guarda en `mhd_order_exports.mhd_status_payload`:

- `respuesta_mhd`: **la respuesta completa** de `GET /orders/:id` tal como
  llega, para no perder ningún campo que MHD añada. Es la última consulta; no se
  guarda histórico.
- `estado_cliente`, `id_estado_cliente` y `arr_estados`.
- `seguimiento`: lista de `{ carrier_code, carrier_name, tracking_number,
  carrier_url, zip_code }`, juntando las cuatro propiedades de MHD sin repetir
  números (se prefiere el enlace de `arr_seguimiento_info`). Cuando MHD las
  unifique, solo cambia `trackingFrom` en `src/lib/mhd-order-status.ts`.
- `facturas`: lista de `{ url_factura, nombre_factura }` de
  `arr_facturas_info_full` (o del antiguo `arr_facturas_info`).

La tarjeta del pedido muestra el transportista y el número de seguimiento con
su enlace, y los enlaces a las facturas.

**Facturas en Shopify (4-11-2026).** Cada lectura del pedido en MHD (botón
«Actualizar desde MHD» y tarea diaria de Garantía3, las dos por
`refreshMhdStatuses` en `src/lib/mhd-order-sync.ts`) escribe las facturas en el
metacampo de pedido `mhd.facturas` («MHD · Facturas», tipo JSON) con
`metafieldsSet`, como lista `[{ "url": "…", "nombre": "…" }]`. De ahí las toman
el correo de envío (botón «Descargar factura»), Elvi y el helpdesk de Aligeria;
mostrarlas en la cuenta del cliente queda para una extensión de app.

- Solo se escribe si la lista cambia respecto a la última escrita, que se guarda
  en `mhd_status_payload.facturas_en_shopify`. No se lee el metacampo en
  Shopify (cero llamadas extra) y, si alguien lo corrige a mano, se respeta
  hasta que MHD cambie sus facturas.
- Si MHD no devuelve facturas no se toca el campo: no se borra lo que haya.
- Si Shopify falla, el error sale en la lista de errores de la actualización y
  se reintenta en la siguiente lectura.
- Requiere `write_orders` (concedido, comprobado el 4-11-2026).

El seguimiento sigue sin escribirse en Shopify desde aquí: va con «Marcar como
enviado».

**Factura en el correo de envío y correo de factura (4-11-2026).** Código en
`src/lib/mhd-invoices.ts`.

- «Marcar como enviado» vuelve a leer el pedido en MHD (si no responde, vale la
  última lectura) y, si ya hay facturas, las escribe en `mhd.facturas` **antes**
  de crear el fulfillment. La plantilla «Confirmación de envío» del tema las
  muestra («descargar factura», o todas con su nombre si son varias). Si la
  escritura falla, el envío se marca igual y la factura irá en su propio correo.
- `mhd_order_exports.facturas_cliente` guarda las facturas que el cliente ya ha
  recibido: `via: "envio"` las que estaban en el campo al marcar el envío con
  «Avisar al cliente»; `via: "correo"` las del correo de factura.
- **Correo de factura:** sale cuando hay una factura que el cliente no ha
  recibido, porque se marcó el envío sin avisar o porque llegó después. Se
  comprueba al marcar el envío y en cada «Actualizar desde MHD» o tarea diaria.
  Solo en pedidos cuyo envío se ha marcado desde sincro-vicente (antes, la
  factura irá en la confirmación de envío). Un botón «Descargar factura» por
  factura y «Ver mi pedido» (`statusPageUrl`). El diseño es el de las
  notificaciones de la tienda (cabecera, ayuda y pie, sin teléfono). Remitente
  `EMAIL_FROM_CUSTOMER` (por defecto `pedidos@mail.electronicavicente.com`) y
  respuestas a `soporte@electronicavicente.com`.
- **Interruptor:** `store_settings.factura_correo_activo` (apagado de serie) y
  `factura_correo_desde` (fecha ISO de corte). Sin fecha no se envía nada, y los
  pedidos exportados a MHD antes de esa fecha nunca reciben el correo. Los de
  PrestaShop no pasan por `mhd_order_exports` y tampoco.
- Límite: si el envío se marca en el admin de Shopify y no desde sincro-vicente,
  no hay correo de factura (no se sabe si el cliente fue avisado).
- Varias facturas: se envían todas las nuevas en un correo; qué hacer si MHD
  manda rectificativas se verá cuando ocurra (David, 4-11-2026).

### Marcar como enviado en Shopify (10-10-2026, en pruebas)

Formulario manual en la tarjeta del pedido (`POST /api/mhd-orders/fulfill`):

- Si MHD está en Enviado, En tránsito o Finalizado (ids 10, 11, 12) y ha dado
  seguimiento, el formulario sale relleno con sus datos; si no, vacío (sirve
  para pruebas o si MHD no da seguimiento). En los dos casos se puede corregir.
- **Transportista**: texto libre, cualquier agencia.
- **Números de seguimiento**: uno o varios, cada uno con su **enlace opcional**.
  Shopify empareja números y enlaces por posición, así que van en todos o en
  ninguno. Sin enlace, Shopify solo enlaza el seguimiento si reconoce el
  transportista; si no, muestra el nombre y el número.
- Los enlaces deben ser direcciones `http(s)` válidas.
- Se envía **todo el pedido** (MHD no indica qué productos van en cada envío),
  un fulfillment por ubicación con todos los números de seguimiento. La
  recogida en tienda no se toca.
- «Avisar al cliente por correo» viene desmarcado: con él marcado, Shopify manda
  su correo de envío.
- El resultado se guarda en `shopify_mhd_orders.shopify_fulfillment_payload`
  (seguimiento enviado, el que dio MHD y los fulfillments creados) y el pedido
  queda como `FULFILLED`.
- Requiere el permiso `write_merchant_managed_fulfillment_orders` en la app de
  Shopify.
