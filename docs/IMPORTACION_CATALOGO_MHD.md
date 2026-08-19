# Importación del catálogo MHD

Este documento fija las decisiones previas a implementar la importación del
catálogo desde la API de MHD. Es una fase de preparación de datos: no crea,
actualiza, archiva ni descarga imágenes en Shopify.

## Alcance inicial

La aplicación contará con tres apartados diferenciados:

- **Importar de SQL Server**: nuevo nombre de la pantalla existente
  `Importar a Supabase`.
- **Importar de MHD**: inicia una lectura completa de la API MHD y permite
  consultar el progreso y el histórico de sus ejecuciones.
- **Importación de catálogo MHD**: visor de sólo lectura para los productos,
  categorías y marcas importados desde MHD.

Se conservará el histórico operativo de ejecuciones (inicio, fin, estado,
contadores, páginas y errores). No se conservará indefinidamente una copia
completa de cada respuesta de MHD: se mantendrá la última fotografía correcta
y las ejecuciones fallidas recientes que sean necesarias para diagnosticar una
incidencia.

El tamaño orientativo aportado en el fichero de tarifa no condiciona el modelo
ni se toma como contrato de campos. La API será la fuente de verdad de la
forma de los datos.

En la primera carga real, `/categories` devolvió 18 registros de nivel 1.
Aunque el campo del endpoint se denomina `cd_familia`, sus valores (`1`, `2`,
`S`, `C`…) coinciden con `cod_linea` de los productos, no con
`cod_familia`. Por ello el visor lo presenta como **Código de línea**. Las
135 familias y sus subfamilias llegan actualmente dentro de cada producto; la
API no ha entregado en este endpoint un árbol independiente para esos niveles.

### Consulta pendiente a MHD

Confirmar con el proveedor si existe un endpoint —o parámetros adicionales—
para obtener el árbol completo de **familias y subfamilias**. Actualmente
`/categories` sólo entrega las 18 líneas de nivel 1, pese al nombre
`cd_familia` de su identificador. También pedir que confirmen formalmente la
relación entre ese campo y `cod_linea` de los productos.

## Modelo de importación

No se reutilizarán las tablas `source_*` de SQL Server. Representan otro
origen y deberán poder compararse con el catálogo MHD sin mezclar datos.

El flujo será:

```text
API MHD paginada
  -> ejecución y filas intermedias de MHD
  -> validación de lectura completa
  -> fotografía final normalizada de MHD
```

Las tablas se crearán bajo nombres propios de MHD:

- `mhd_catalog_import_runs`: una ejecución, sus estados, páginas, contadores
  y el detalle del error si falla.
- `mhd_catalog_raw_rows`: filas recibidas, asociadas a una ejecución y a su
  entidad. Conserva el JSON original mientras sea necesario para normalizar,
  auditar y diagnosticar.
- `mhd_catalog_products`, `mhd_catalog_categories` y
  `mhd_catalog_brands`: fotografía consultable y normalizada del catálogo.
- `mhd_catalog_prices` y `mhd_catalog_stock`: reservadas desde el diseño para
  los endpoints específicos de precios y stock que MHD ha anunciado. En la
  primera carga se conservarán también los valores de precio y stock que vengan
  incorporados en el producto, sin asumir aún el contrato de dichos endpoints.

Las tablas finales conservarán el payload original además de los campos que se
normalicen. Esto permite incorporar nuevos campos de MHD sin perder la
información ni exigir una relectura completa del catálogo.

## Integridad de una carga paginada

Una ejecución crea primero sus filas intermedias. Solamente cuando se hayan
leído y validado todas las páginas de una entidad se actualizará la fotografía
final, dentro de una operación atómica.

Si una página falla, la respuesta no es válida o se detectan incoherencias
como identificadores duplicados inesperados, la ejecución quedará fallida y
la última fotografía final correcta seguirá disponible. Una importación
parcial no sustituye ni modifica el catálogo final.

La importación inicial será completa para establecer la línea base. En fases
posteriores se podrán solicitar candidatos por las fechas de modificación que
ofrezca MHD, sin convertir esas fechas en la única fuente de verdad.

## Detección de cambios

Se utilizará un enfoque híbrido:

- Las fechas de modificación de MHD servirán para seleccionar candidatos en
  importaciones incrementales futuras, reduciendo llamadas y datos transferidos.
- La aplicación calculará un hash del JSON completo de cada entidad, con una
  representación canónica, para decidir si el contenido recibido cambió de
  verdad.
- Una conciliación completa periódica comprobará diferencias que las fechas de
  MHD no reflejen y permitirá detectar ausencias.

El hash protege frente a cambios de campos no previstos, fechas que no se
actualicen correctamente y precisión insuficiente de las marcas de tiempo.

## Bajas por ausencia en MHD

MHD no proporciona actualmente un indicador fiable de baja. La aplicación
detectará las bajas comparando una lectura completa correcta con la fotografía
anterior.

Cada producto MHD tendrá al menos:

- `last_seen_at` y `last_seen_run_id`: última ejecución completa correcta en
  la que el producto se recibió.
- `presence_status`: `present` o `absent_in_mhd`.
- `absent_since` y `absence_detected_run_id`: primera ejecución completa que
  confirmó su ausencia.

Un producto sólo se marcará `absent_in_mhd` al completar y validar una carga
íntegra de productos. Una carga parcial o fallida no alterará nunca este
estado. Si el producto vuelve a recibirse, se marcará de nuevo como `present`
y se limpiarán los datos de ausencia.

Esta marca no producirá ninguna acción en Shopify durante esta fase. Más
adelante será el criterio explícito para preparar un proceso controlado de
archivado en Shopify, con su propia ejecución y trazabilidad.

## Fuera de alcance por ahora

- Descargar, modificar o sincronizar imágenes.
- Crear, actualizar o archivar productos en Shopify.
- Automatizar la importación mediante calendario.
- Confiar exclusivamente en fechas de modificación para decidir cambios.
- Aplicar bajas de MHD tras una ejecución incompleta.

## Próximos pasos de implementación

1. Crear las tablas y las reglas de acceso en Supabase.
2. Implementar el importador paginado de categorías, marcas y productos,
   reutilizando las credenciales MHD ya configuradas para los pedidos.
3. Añadir la pantalla **Importar de MHD** y su histórico de ejecuciones.
4. Añadir el visor **Importación de catálogo MHD**.
5. Ejecutar y validar una primera carga completa antes de diseñar los flujos
   incrementales de precio y stock.
