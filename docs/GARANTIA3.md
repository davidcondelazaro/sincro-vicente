# Altas de Garantía3 desde utils

Diseño acordado con David el 2026-10-30. Programado en modo test: reglas en `src/lib/garantia3.ts`, vuelta en `src/lib/garantia3-vuelta.ts`, pantalla en `/tienda/contratos-garantia3` y migración `20261030100000_garantia3.sql`. Sustituye, solo para la web de Vicente en Shopify, a los scripts PHP de Pladisel (copia en `theme-enterprise-vicente/reference/garantia3/`). Ziwwie sigue con esos scripts.

## Qué resuelve

La tienda ya vende las 9 ampliaciones de garantía como líneas del pedido, anidadas bajo su aparato, pero nadie pide el contrato. Utils lo pedirá a Garantía3, guardará contrato y PIN y avisará de cualquier anomalía. El lado de la tienda (ficha, carrito, cálculo del tramo) está en `theme-enterprise-vicente/docs/garantias.md`.

Lo histórico de PrestaShop queda fuera (decidido por David): no se revisa ni se migra.

## Flujo

Se apoya en el módulo de pedidos a MHD (`docs/PEDIDOS_MHD_FASE_1.md`), que ya trae los pedidos de Shopify y sus estados de MHD. No hay una lectura paralela de pedidos.

1. Tarea diaria: reutiliza «Actualizar desde MHD» sobre los pedidos exportados que lleven garantía.
2. Toma las líneas de garantía de `shopify_mhd_orders` y `shopify_mhd_order_lines`, en pedidos creados desde `garantia3_desde`, y crea una fila por unidad.
3. Cada fila espera `garantia3_dias` días desde la fecha del estado **Enviado** de MHD (id 10, en `mhd_order_exports.mhd_status_payload`; decidido por David).
4. Antes de llamar, vuelve a leer ese pedido en Shopify: la sincronización solo trae pedidos pagados y sin enviar, así que la copia local no refleja reembolsos posteriores. Si ya no procede, la fila se bloquea con su motivo.
5. Marca la fila como `enviando` y llama al proxy. Si el proceso se cae en ese punto, la fila queda dudosa y no se repite.
6. Guarda la respuesta en utils. No se escribe nada en Shopify.
7. Garantía3 manda al cliente el contrato y las instrucciones. El cliente activa después.

Con 14 días desde el envío, en PrestaShop acabaron reembolsados 7 de 353 contratos: por eso se mantiene ese criterio.

### Comprobaciones antes de llamar

- Pedido no cancelado y pagado, ni en Shopify ni en MHD (estado Cancelado, id 13).
- Quedan unidades vivas de la garantía y de su aparato (`currentQuantity`). Se mira línea a línea: un reembolso parcial de otro artículo no bloquea la garantía, al contrario que en PrestaShop.
- La línea tiene `lineItemGroup` y su EAN es uno de los 9.
- Hay nombre, apellidos, email y teléfono.
- Modo producción. En modo test no se llama a Garantía3.

## Ajustes del apartado

En `store_settings`, editables desde la pantalla de Garantía3:

| Clave | Valor | Inicial |
|---|---|---|
| `garantia3_modo` | `test` o `produccion` | `test` |
| `garantia3_dias` | Días de espera desde Enviado | 14 |
| `garantia3_emails_incidencias` | Correos de incidencias, propios del apartado | Ninguno: hay que rellenarlos |
| `garantia3_emails_resumen` | Correos de resúmenes, propios del apartado. Quien los recibe resuelve dudosos y anulaciones y revisa el cuadre mensual | Ninguno: hay que rellenarlos |
| `garantia3_desde` | Fecha de arranque: los pedidos anteriores se ignoran | Fecha de salida |

En **test** se hace todo el recorrido con una respuesta simulada y las filas quedan marcadas como prueba. Las filas de prueba no cuentan como contrato: al pasar a producción se procesan de nuevo. Si Garantía3 da un entorno de pruebas, se valora usarlo.

«Enviar pedido de prueba» (solo en test) crea un pedido con datos inventados (`#PRUEBA-…`, `cliente.prueba@example.com`), sin Shopify ni clientes, y hace la parte final del recorrido con respuesta simulada. Estas filas se borran al pasar a producción: nunca se piden de verdad.

## Datos

Tabla `garantia3_contratos`, una fila por unidad, con clave única (`shopify_line_id`, `unidad`), RLS y acceso con sesión:

- Pedido: id, nombre, línea, SKU y EAN de la garantía, SKU del aparato.
- Cliente: nombre, apellidos, email y teléfono normalizado.
- Plazo: fecha de Enviado y fecha prevista.
- Resultado: estado, motivo, modo, número de contrato (`transaction`) y PIN.

Tabla `garantia3_intentos`: cada llamada con su fecha, código HTTP y respuesta. En PrestaShop un acierto borraba el error anterior, así que el corte de febrero de 2026 no dejó rastro.

Estados: `espera`, `lista`, `enviando`, `creado`, `error`, `dudoso`, `bloqueado`, `anulacion_pendiente`, `anulado`.

## Llamada a Garantía3

Por el proxy `pladisel/proxy-garantia3.php`, que sale por la IP autorizada `93.189.94.124` y guarda el token de Garantía3. Vercel solo conoce `GARANTIA3_PROXY_URL` y `GARANTIA3_PROXY_TOKEN`.

Se envía `ean13`, `name`, `lastname`, `email`, `phone` y `note` con el número de pedido. Respuesta real en los 353 contratos: `{"data":[{"transaction":"…","pin":"…"}],"code":200,"message":"OK"}`. Solo se considera creado si hay `data[0].transaction` y `message` es `OK`. Una respuesta 200 sin esos datos es dudosa.

| Respuesta | Qué se hace |
|---|---|
| 200 válida | `creado` |
| 401 | `error`, aviso y se para la tanda. Repetir es seguro: no se creó nada |
| 404 | `error` y aviso: EAN no autorizado |
| 400 | `dudoso` y aviso: la documentación no aclara si es repetible |
| 503 `no_enviado` | `error`: se repite en la siguiente vuelta |
| 504 `resultado_desconocido` o cualquier otra | `dudoso` y aviso. **No se repite**: la API no evita duplicados y cada contrato se paga |

Un `dudoso` solo se resuelve a mano en pantalla, tras mirarlo en el portal.

### Datos del cliente

- Nombre y apellidos de la dirección de facturación y, si falta, de la de envío.
- Teléfono: PrestaShop añadía 34 o 351 sin mirar el número y dejó unos 30 de 353 con doble prefijo, espacios o paréntesis. Aquí se limpia y se deja un único prefijo.
- Sin teléfono: `bloqueado` y aviso.
- Venta a profesional: `name` = `-`, empresa en `lastname` y `#PRO#` delante en `note`. El campo Empresa de Shopify guarda el NIF, así que falta decidir de dónde sale el nombre.

## Correos

Decidido por David el 2026-10-30. Sin correo por contrato. Todos con `sendEmail` de `src/lib/email.ts` y el prefijo habitual.

| Correo | Lista | Cuándo |
|---|---|---|
| Incidencia | `garantia3_emails_incidencias` | Al momento |
| Resumen del día | `garantia3_emails_resumen` | Solo los días con actividad: contratos creados, bloqueados, próximos a pedirse y pedidos con garantía sin exportar a MHD |
| Resumen mensual | `garantia3_emails_resumen` | El día 1: totales del mes y CSV para cuadrar con la factura de Garantía3 |

Al cliente no se le envía nada: solo lo que mande Garantía3. Los recordatorios de activación se dejan en su mano; falta confirmar que los envían.

### Incidencias

Un aviso por incidencia, con `idempotencyKey`, para no repetirlo en cada vuelta:

- Error de token o IP (401): urgente. Es lo que pasó en febrero de 2026.
- Resultado dudoso.
- EAN no autorizado o respuesta no reconocida.
- Falta un dato del cliente o no se puede ligar la garantía a su aparato.
- Devolución o cancelación de una garantía con contrato ya creado.
- La tarea diaria no ha corrido: una comprobación aparte avisa si pasan 48 horas sin vuelta. Los scripts antiguos dejaron de llamar sin que nadie avisara.

## Pantalla

En Tienda, junto a Garantías (`/tienda/garantias`):

- Ajustes y prueba de conexión (`?comprobar=1` del proxy).
- Listado filtrable por estado, con enlace al pedido.
- Acciones: reintentar un `error`, resolver un `dudoso`, procesar ya un pedido y marcar una anulación.
- Exportación CSV para cuadrar con las facturas.

Devoluciones: mientras no haya vía por API, la fila pasa a `anulacion_pendiente` y la pantalla prepara el correo a `info@bcwm.es`, como el listado antiguo.

## Tareas programadas

`pg_cron` llama una vez al día a una ruta protegida con `x-mhd-import-token`, como `/api/informes/diario`. Con unas 15 unidades en lo que va de 2026 no hace falta más frecuencia.

Hoy «Traer pedidos» y «Actualizar desde MHD» exigen sesión y el botón manual. Su lógica debe pasar a funciones comunes para que las use también la tarea, sin duplicarla.

## Pendiente de Garantía3

Correo enviado por David el 2026-10-30. Falta su respuesta sobre:

- Bajo qué cliente se compran y facturan los contratos.
- API vigente, token de producción y si se mantiene la IP.
- Entorno y token de pruebas.
- Vigencia de los 9 EAN con la cuenta nueva.
- Acceso al portal Webshop.
- Anulaciones, duplicados y uso de `note` en este modo.
- Envío del contrato al cliente y plazo de activación.
- Si Garantía3 envía recordatorios de activación. No iba en el correo: hay que preguntárselo.
- Reglamento de 3 años, reacondicionados y Portugal.

## Sin resolver en utils

- Recogida en tienda: la cuenta empieza cuando el pedido se da por entregado (decidido por David). Falta comprobar con un pedido real de dónde sale esa fecha en Shopify.
- Pedidos no exportados a MHD: hoy la exportación es manual y dejará de serlo (David, 2026-10-30), así que no llevan aviso, solo aparecen en el resumen.
- MHD no dice qué lleva cada envío: con varios envíos, cuenta el primer Enviado del pedido.
- Texto al cliente: comprobar que la web y los correos explican que el contrato llega unos días después del envío y que hay que activarlo.
