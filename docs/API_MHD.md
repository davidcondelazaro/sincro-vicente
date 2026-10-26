# API MHD (mihogardigital)

Referencia de la API de MHD tal como la usa Sincro Vicente. Recoge la
documentación oficial, las aclaraciones recibidas por correo y lo comprobado en
pruebas reales.

- Documentación oficial (actual): https://documenter.getpostman.com/view/58631152/2sBYB4Mmy9
  - El enlace anterior (`/view/98921/2sBXwjwDrW`) ya no existe (404).
- Copia descargada de la colección y scripts de prueba en
  `~/Desarrollo/Pruebas API MHD` (`postman_exports/`, `scripts/`, `docs/`).

## Acceso

| Variable | Valor |
| --- | --- |
| Base | `https://www.mihogardigital.es/api/v1/evicente` |
| Autenticación | HTTP Basic (`MHD_API_USER` / `MHD_API_PASS`) |
| Variables en la app | `MHD_API_URL`, `MHD_API_VERSION`, `MHD_API_SUB_PATH`, `MHD_API_USER`, `MHD_API_PASS` |

Los listados son paginados (`page` > 0, `pageSize` < 10000) y devuelven
`{ success, data, extra: { records, totalRecords, firstRecord, pageSize } }`.
Los errores devuelven `{ success: false, errors }`, donde `errors` puede ser un
texto o un array de textos. Las fechas son milisegundos epoch.

## Cambios desde una fecha (comprobado el 2026-10-26)

`/prices`, `/stocks` y `/products` aceptan su `fecha_modificacion_*` en milisegundos epoch y devuelven solo lo cambiado desde entonces. No está en la documentación oficial. Otros nombres (`desde`, `fecha_desde`…) no filtran. Prueba y script en `~/Desarrollo/Pruebas API MHD` (`docs/API_MHD_smoke_tests.md`, `scripts/prueba_filtros_fecha.py`).

Volumen el 2026-10-26 (30.961 códigos): precios 63/hora y 1.162/día; stock 517/hora y 3.964/día; productos 4/hora y 450/día. Una página de 10.000 precios tarda ~3 s: el listado completo de códigos se lee en ~9 s. Es la base de las sincronizaciones periódicas (`SINCRONIZACIONES_MHD.md`).

## Endpoints

| Área | Método | Ruta | Notas |
| --- | --- | --- | --- |
| Categorías | GET | `/categories`, `/categories/:cd_familia` | Filtros `nivel` (1 líneas, 2 familias, 3 subfamilias), `padre`, `activo`, `visible`. |
| Marcas | GET | `/brands`, `/brands/:cd_marca` | Filtros `nombre`, `activo`, `validada`. |
| Productos | GET | `/products`, `/products/:codigo` | Filtros `codigo_ean`, `cod_linea`, `cod_familia`, `cod_subfamilia`, `cd_marca`, `busqueda` y `fecha_modificacion_producto` (epoch ms: solo los modificados desde esa fecha). |
| Precios | GET | `/prices` | `codigo`, `pvp`, `pvp_antes`, `triple_neto`, `iva`, `fecha_modificacion_precio`. Filtro `fecha_modificacion_precio` (epoch ms): solo lo cambiado desde esa fecha. |
| Stocks | GET | `/stocks` | `codigo`, `stock`, `fecha_modificacion_stock`. Filtro `fecha_modificacion_stock` (epoch ms): solo lo cambiado desde esa fecha. |
| Países | GET | `/countries`, `/countries/:codigo` | Filtros `nombre`, `visible`, `envio`, `iso_2`. |
| Provincias | GET | `/provinces`, `/provinces/:id` | Filtros `id_pais`, `nombre`, `visible`. |
| Estados de pedido | GET | `/order-states`, `/order-states/:codigo` | Catálogo de estados (ver abajo). |
| Pedidos | GET | `/orders` | Obligatorio al menos uno de `id`, `id_transaccion`, `referencia_web`, `tkn`, `email`; sin ellos devuelve 400. |
| Pedidos | GET | `/orders/:id` | Detalle completo, con seguimiento y facturas. |
| Pedidos | POST | `/orders` | Alta de pedido. |

No existe ningún endpoint para cancelar o modificar un pedido ya creado.

## Productos

Campos relevantes del detalle de producto:

- Identificación: `codigo` (= SKU en Shopify), `ref_proved`, `codigo_ean`,
  `cd_marca`, `nombre_marca`.
- Categoría: `cod_linea` / `cod_familia` / `cod_subfamilia` con sus `nombre_*`
  y `friendly_url_*`.
- Textos:
  - `titulo`.
  - `descripcion`: **la descripción que MHD usa actualmente en su web**. Es la
    que debemos tomar. Añadida a petición nuestra (oct. 2026).
  - `descripcion_ampliada`: texto interno corto, en mayúsculas. No usar como
    descripción de cara al cliente.
  - `caracteristicas`: array `{ nombre, valor }`.
- Imágenes: `imagen` (principal) y `fotos` (array).
- Eficiencia energética (solo si MHD dispone de ella): `letra_eficiencia` e
  `img_eficiencia` (icono SVG).
- Precios (ver criterio más abajo): `pvp`, `pvp_antes`, `triple_neto`, `iva`.
- Servicios y portes de MHD para particulares:
  `gastos_envio_peninsula_particulares`, `gastos_envio_baleares_particulares`,
  `gastos_envio_portugal_baremo_1_particulares`,
  `gastos_envio_portugal_baremo_2_particulares`, `subida_puerta_particulares`,
  `retirada_usado_particulares`, `instalacion_particulares`.
- Otros: `stock`, `es_garantia`, `friendly_url`, y `fecha_modificacion_producto`,
  `fecha_modificacion_precio` y `fecha_modificacion_stock`.

### Criterio de precios (indicado por MHD)

- **`pvp`**: precio con IVA incluido con el que aparece el producto en
  mihogardigital.
- **`pvp_antes`**: según MHD se puede ignorar. Pendiente de confirmar con Fran.
- **`triple_neto`**: aproximadamente el precio de coste sin IVA. Sirve para
  construir un PVP propio si no se quiere usar el oficial. La decisión de qué
  precio usar en Shopify está pendiente de Fran.

## Pedidos

### Alta (`POST /orders`)

Obligatorios: `email`, `envio` y `productos`. Si no se envía `facturacion`, MHD
usa la dirección de envío. Otros campos: `referencia_web` (la usamos con el
número de pedido de Shopify, p. ej. `#1003`) y `observaciones`.

Direcciones (`envio` / `facturacion`): `nombre`, `apellidos`, `nif`,
`telefono`, `direccion`, `cp`, `localidad`, `id_provincia`, `provincia`,
`id_pais`.

Cada línea de `productos`: `codigo`, `cantidad`, `precio`, `portes`, `subida`,
`precio_subida`, `instalacion`, `precio_instalacion`, `retirada`,
`precio_retirada`. Si se marca un servicio, su precio es obligatorio.

**`precio` y `portes` son siempre unitarios**: MHD los multiplica por
`cantidad`. Confirmado por MHD y por la prueba de cantidad excesiva
(999999 uds. → `subtotal_portes` = 999999 × portes).

### Comportamientos comprobados en pruebas

- Un SKU inexistente devuelve `201` y `success=true`, pero crea un pedido
  **vacío** (`arr_productos=[]`, total 0). Hay que validar las líneas devueltas.
- Una dirección no válida (país sin envío, provincia incorrecta) devuelve `400`
  con un array `errors`.
- No hay límite de cantidad: 999999 unidades se aceptan.
- MHD no presta envío a Canarias, Ceuta, Melilla, Azores ni Madeira.

### Detalle (`GET /orders/:id`)

Además de cabecera, direcciones, importes (`subtotal_productos`,
`subtotal_servicios_adicionales`, `subtotal_portes`, `subtotal_bono`, `total`),
`arr_productos` y `arr_estados` (`{ estado, fecha }`), incluye:

- **Seguimiento**: `{ carrier_code, carrier_name, tracking_number, carrier_url, zip_code }`.
  Ahora mismo aparece en cuatro propiedades con el mismo contenido:
  `arr_seguimiento_info` (objeto), y `arr_tracking_info_erp`,
  `arr_tracking_info_erp_full` y `arr_tracking_info_manual` (arrays). **MHD va
  a unificarlas en una sola y avisará**; hasta entonces no hay que acoplarse a
  ninguna en concreto.
- **Facturas**: `arr_facturas_info_full`, array de
  `{ url_factura, nombre_factura }`. Sustituye a `arr_facturas_info`, que era un
  objeto. **Los enlaces son permanentes.**
- Si un pedido sale en varios envíos, **MHD no puede indicar qué productos y
  cantidades lleva cada uno**.
- En pedidos sin envío ni factura (p. ej. cancelados) esas propiedades no
  aparecen: deben tratarse como opcionales.

### Estados (`GET /order-states`)

| id | Estado | Visible al cliente | Significado |
| --- | --- | --- | --- |
| 1 | Registrado | sí | Pedido recibido |
| 2 | En espera de pago | no | Redirigido al método de pago |
| 3 | Pagado | sí | Pago notificado |
| 4 | Error en el pago | sí | Pago rechazado |
| 5 | Enviado al ERP | no | Enviado correctamente al ERP |
| 6 | Error en el envío al ERP | no | Error al enviarlo al ERP |
| 7 | Pendiente de revisión | sí | Pendiente de revisión |
| 8 | Revisado | sí | Revisado por un agente, pendiente de envío al ERP |
| 9 | Procesado | sí | Procesado, se procederá a su envío |
| 10 | Enviado | sí | Etiquetado y enviado |
| 11 | En tránsito | no | En manos del transportista |
| 12 | Finalizado | sí | Entregado o recogido por el cliente |
| 13 | Cancelado | sí | Cancelado y reembolsado |
| 14 | Pendiente de validación | sí | Pendiente de validación |
| 15 | Validación aceptada | sí | Validado |
| 16 | Validación cancelada | sí | Validación cancelada |

Recorrido típico observado: Registrado → Pagado → Pendiente de revisión →
Revisado → Procesado → Enviado.

## Pendiente

- Unificación de las propiedades de seguimiento (lo avisará MHD).
- Con Fran: qué precio usar en Shopify (`pvp` oficial o uno propio a partir de
  `triple_neto`) y si `pvp_antes` tiene alguna utilidad.
- Cancelar o modificar un pedido ya creado no es posible por API.
