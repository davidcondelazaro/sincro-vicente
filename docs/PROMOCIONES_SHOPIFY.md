# Productos de promociones en Shopify

## Regla de identificación

Un producto es una promoción cuando su categoría por defecto de origen es `V346`.
La categoría se llama **Promociones** y procede de `source_products.id_category_default`.

## Comportamiento al sincronizar

Para un producto activo de la categoría `V346`, `sync-catalog-imports`:

- lo crea o actualiza normalmente en Shopify;
- asigna `templateSuffix: "promociones"`, que corresponde a la plantilla del tema `product.promociones.*`;
- conserva el estado `ACTIVE` mientras el producto esté activo en origen;
- se publica con el mismo flujo general que el resto de productos.

La comparación con Shopify incluye la plantilla de tema. Por ello, un producto de promociones que aún no tenga la plantilla `promociones` se actualiza aunque el resto de datos no haya cambiado.

Los productos que no pertenecen a `V346` conservan el comportamiento general: se publican tras su creación o actualización.

## Etiquetas

La etiqueta derivada de la categoría es `Promociones` (plural y con mayúscula). No existe una regla independiente que añada `Promocion` en singular.

## Cola de sincronización

La migración `20260815171345_assign_promotion_product_template.sql` marca como pendientes sólo los productos activos de la categoría `V346`:

```sql
update public.source_products
set shopify_synced = false
where active is true
  and id_category_default = 'V346';
```

No modifica `product_shopify_links`, que conserva los identificadores persistentes de Shopify. En una ejecución de productos con el modo **Solo cambios y altas**, los registros con `shopify_synced = false` entran en la cola.

Los productos inactivos no se fuerzan a `ACTIVE` ni se incluyen por esta migración.

## Despliegue aplicado el 15 de agosto de 2026

- Migración aplicada en Supabase: productos activos `V346` marcados pendientes.
- Registros pendientes resultantes: 4.
- Edge Function desplegada: `sync-catalog-imports`, versión 42.
- Primera ejecución: `37a323b0-b35a-4a6c-9cd4-5da3da4a7c80`.
- `PROMO892`: actualizado y plantilla asignada.
  - `PROMO918`, `PROMO919` y `PROMO920`: no completaron porque no se pudo descargar ninguna imagen desde el origen. La comprobación posterior confirmó que el proxy de imágenes usado por el sincronizador devuelve `404` para las tres rutas; no es un problema del límite de 25 MB. Siguen requiriendo corregir o restaurar sus imágenes de origen antes de reintentarlos.

## Archivos implicados

- `supabase/functions/sync-catalog-imports/index.ts`: asignación y verificación de la plantilla.
- `supabase/migrations/20260815171345_assign_promotion_product_template.sql`: marcado inicial de pendientes.
