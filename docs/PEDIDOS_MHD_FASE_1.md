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
