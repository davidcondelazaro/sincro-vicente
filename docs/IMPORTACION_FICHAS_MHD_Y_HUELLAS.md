# Fichas de detalle de MHD y huellas de cambios

Decidido con David el 2026-10-23. Migración `supabase/migrations/20261023160000_mhd_fichas_detalle_y_huellas.sql`,
función `supabase/functions/mhd-catalog-import` (paso `details`) y pantalla `/importar-datos-mhd`.

## Por qué

El listado `/products` de MHD (1.000 productos por página, unos 2 minutos el catálogo entero) **no trae** las
características, la lista de fotos ni, a veces, la etiqueta energética. Eso solo viene en la ficha de cada producto,
`/products/:codigo`, que es **una petición por producto**: unas 24.000. Las características de la ficha son los
filtros que MHD ha decidido para cada subfamilia, y de ellas salen nuestros filtros. Hay que tenerlas todas guardadas.

## Qué se guarda

- `mhd_catalog_product_details`: el **JSON entero** de la ficha de cada producto (`source_payload`), con la fecha de
  modificación de MHD, cuándo se leyó y el último error si no se pudo leer. Las fotos se guardan como enlaces, no se
  descargan.
- Fuera el merchandising (S95) y los servicios (S93), que no se importan.

## Huellas (para las actualizaciones por partes)

Cada huella es un sha256 de una parte del JSON. Va acompañada de la fecha en que cambió por última vez. Un producto
nuevo no cuenta como cambio. Así, al actualizar Shopify se rehace solo la parte que ha cambiado; por ejemplo, si solo
cambia el precio, no se vuelven a escribir los textos ni a subir las imágenes.

| Dónde | Huella | Qué incluye | Fecha de cambio |
| --- | --- | --- | --- |
| listado (`mhd_catalog_products`) | `hash_contenido` | todo menos precio, stock, imágenes y fechas de modificación | `contenido_cambiado_en` |
| listado | `hash_imagenes` | `imagen`, `img_ficha_eficiencia`, `img_eficiencia`, `fotos` | `imagenes_cambiadas_en` |
| listado | `hash_precio` | IVA, PVP, PVP anterior, triple neto, gastos de envío y servicios | `precio_cambiado_en` |
| listado | `hash_stock` | stock | `stock_cambiado_en` |
| ficha (`mhd_catalog_product_details`) | `hash_caracteristicas` | características y descripción | `caracteristicas_cambiadas_en` |
| ficha | `hash_fotos` | lista de fotos e imagen principal | `fotos_cambiadas_en` |
| ficha | `hash_ficha` | la ficha entera | — |

- Las huellas las calculan disparadores de la base cada vez que se guarda un JSON. Nadie las escribe a mano.
- La antigua `source_hash`, del JSON entero del listado, sigue igual. Como incluye el precio y el stock, casi todos los
  productos salen siempre como «modificados»: no sirve para decidir qué actualizar.
- La vista `mhd_catalog_product_changes` junta por producto todas las fechas de cambio. También dice si falta la
  ficha (`sin_ficha`) o si está desactualizada (`ficha_desactualizada`: su fecha de modificación no coincide con la
  del listado).

## Cómo se importan las fichas

Desde la pantalla *Importar datos de MHD*, con el mismo motor por tandas que el resto (servidor, sin el ordenador
encendido):

- **Fichas de detalle** (`details`): pide solo las que faltan o cuya fecha de modificación de MHD es distinta de la
  del listado. La primera vez son todas; después, muy pocas.
- **Todas las fichas** (`details_all`): las vuelve a pedir todas. Úsalo solo si se sospecha que MHD cambia fichas sin
  cambiar la fecha.
- **Completa**: lanza las fichas al final, después del listado, precios y stock. Así cada importación completa deja
  también las fichas al día.

Ritmo y límites:

- Tandas de 60 productos, 2 peticiones a la vez, como mucho 55 s por tanda (la reserva dura 90 s). Lo que no da tiempo
  a pedir pasa a la tanda siguiente.
- Cada ficha se reintenta 3 veces, con esperas, si MHD da error 5xx, 429 o no contesta. Un 404 («MHD no tiene la
  ficha») no se reintenta. Esos productos se cuentan aparte (`missing`), no salen como error y se vuelven a probar
  en la siguiente importación de fichas. En la prueba eran alrededor del 3 %: productos que están en el listado y de
  los que MHD no tiene ficha.
- Las fichas que fallan se apuntan con el motivo (`last_error`). No se repiten en la misma ejecución, pero sí en la
  siguiente.
- Si en una tanda no sale ninguna ficha, cuenta como tanda fallida: MHD está caído o saturado. Con tres seguidas, la
  importación se para.
- En la prueba local del 2026-10-23 salieron unas 7 fichas por segundo, es decir, menos de una hora para todo el
  catálogo.
- La descarga desde el ordenador (`scripts/descargar-fichas-mhd.mjs`) falló en más de la mitad de las fichas. Ese
  script queda solo para pruebas.

## Pendiente

- Usar la vista de cambios en el refresco de Shopify (textos, filtros, imágenes, precio y stock por separado).
- Comprobar con datos reales que MHD cambia `fecha_modificacion_producto` cuando cambia las características o las
  fotos. Si no, la importación de fichas habrá que lanzarla de vez en cuando con `details_all`.
