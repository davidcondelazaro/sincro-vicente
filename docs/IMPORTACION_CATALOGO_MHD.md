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

## Bajas por ausencia en MHD (diseño inicial; hoy pendiente, ver «Bajas y reaparecidos: pendiente»)

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

## Tareas programadas desactivadas (2026-10-22)

Las seis tareas de `cron.job` de Supabase están **desactivadas, no borradas**
(`active = false`) desde el 2026-10-22:

| id | Tarea | Qué despertaba |
| --- | --- | --- |
| 1 | `sincro-vicente-customer-import-worker` | importación de clientes |
| 2 | `sincro-vicente-icecat-import-worker` | importación de Icecat |
| 3 | `sincro-vicente-priority-import-worker` | prioridades |
| 4 | `sincro-vicente-catalog-import-worker` | catálogo de SQL Server |
| 5 | `sincro-vicente-price-import-worker` | precios |
| 6 | `sincro-vicente-stock-import-worker` | stock |

**Por qué:** todas se lanzaban cada minuto (`* * * * *`) aunque sus colas
estuvieran vacías: 6 × 1.440 = **8.640 ejecuciones al día**, sin trabajo que
hacer (la última importación de clientes era del 13 de agosto). El historial de
esas ejecuciones (`cron.job_run_details`) ocupaba **684 MB** de una base de
datos de 1,3 GB; se borraron los registros de más de 7 días.

**Consecuencia:** si se lanza a mano una de esas importaciones antiguas (SQL
Server, precios, stock, Icecat, clientes) y se corta, ya no se reanuda sola
cada minuto. Para volver a activar una:

```sql
select cron.alter_job(job_id := 4, active := true);
```

La importación de MHD no usaba ninguna de estas tareas. Su rediseño (ver
[AUDITORIA_IMPORTACION_MHD.md](AUDITORIA_IMPORTACION_MHD.md)) no tendrá tareas
cada minuto: cada página encadena la siguiente.

## Motor de importación por páginas (fase 1, 2026-10-22)

Sustituye al bucle que corría dentro de una función de Vercel (se cortaba a
los ~5 min sin avisar y dejaba la ejecución «En curso»). Ver la auditoría en
[AUDITORIA_IMPORTACION_MHD.md](AUDITORIA_IMPORTACION_MHD.md).

### Cómo funciona

```text
Pantalla «Importar de MHD» ─► /api/mhd-catalog-import ─► mhd_import_start(kind)
   ▲                                                         │ pg_net
   │ mhd_import_status() cada 3 s                            ▼
   │                                  función de Supabase mhd-catalog-import
   │                                    1. mhd_import_claim: reserva la ejecución (90 s)
   │                                    2. pide UNA página a MHD (3 intentos)
   │                                    3. mhd_import_ingest_page: la vuelca a mhd_catalog_*,
   │                                       avanza el cursor y, por pg_net, pide la siguiente
   └──────────────────────────────────────────────────────────┘
```

- **Una página por llamada.** La función contesta enseguida y trabaja en segundo
  plano. La base de datos guarda el cursor (`entity_index`, `part`, `page`) en
  `mhd_catalog_import_runs.cursor`; si algo se corta, se sigue desde la última
  página buena.
- **Sin tareas cada minuto.** Mientras hay una importación en curso existe la
  tarea `mhd-catalog-import-vigilante` (cada 2 min): si no hay avance en 90 s y
  nadie tiene la reserva, relanza la página pendiente. Se crea al empezar y se
  borra al terminar, detener o fallar.
- **Una sola importación a la vez**, garantizado por el índice único
  `mhd_catalog_import_runs_one_active_idx` (estados `running` y `stopped`). Una
  detenida hay que reanudarla o descartarla antes de lanzar otra.
- **Errores:** cada página se intenta 3 veces seguidas; si falla, se reintenta la
  misma página otras 2 veces (a los 10 y 20 s). Al tercer fallo la ejecución
  queda «Con error» y se puede reanudar desde esa página. Cada página (buena o
  fallida) queda en `mhd_catalog_import_pages`.
- **Sin filas en bruto.** Cada página se escribe directamente en las tablas
  finales (`mhd_catalog_products`, `_categories`, `_brands`, `_prices`,
  `_stock`) con su huella `source_hash` y la marca `source_changed`. La tabla
  `mhd_catalog_raw_rows` y el volcado final `replace_mhd_catalog_from_run` se
  han retirado.
- **Credenciales:** la función usa `MHD_API_*` (secretos de Supabase). La base de
  datos la llama con la cabecera `x-mhd-import-token`, guardada en Vault
  (`mhd_catalog_import_token`, generada por la migración). La URL sale de
  `sincro_vicente_project_url`.

### Importaciones disponibles (todas manuales)

| Tipo | Qué lee | Tamaño de página |
| --- | --- | --- |
| Completa | categorías → marcas → productos → precios → stock | — |
| Categorías | `/categories?nivel=1`, `2` y `3` (18 + 157 + 476) | 1.000 |
| Marcas | `/brands` | 1.000 |
| Productos | `/products` | 1.000 |
| Precios | `/prices` (todos) | 5.000 |
| Stock | `/stocks` (todo) | 5.000 |

Cada tipo se lee entero: ninguna importación pide a MHD solo lo modificado
desde la anterior (su API no documenta ese filtro). Las fechas de modificación
(`fecha_modificacion_*`) se guardan, pero aún no se usan; servirán en la fase 2
para pedir solo las fichas de detalle de productos nuevos o modificados. Lo que
ha cambiado de verdad se ve en `source_changed` (huella del contenido).

El nivel 3 de categorías no trae su familia: se guarda en `cod_familia` como los
tres primeros caracteres del código (`H0101` → `H01`).

### Bajas y reaparecidos: pendiente (decidido 2026-10-22)

**La importación no marca bajas ni reaparecidos.** Se programó en la fase 1 y
se retiró el mismo día (migración `20261022140000_mhd_import_sin_bajas`):
mientras no se procese nada de este catálogo en Shopify no aportan nada.

Qué pasó: la primera importación de productos en producción comparó con la
última buena, la del 19 de agosto (32.372 productos). Hoy MHD tiene 30.649:
6.587 ya no estaban (una muestra de 8 daba 404 en MHD) y 4.864 eran nuevos. El
freno del 10 % impidió marcarlas. Por eso `mhd_catalog_products` conserva
filas de agosto que MHD ya no tiene; se distinguen por `last_seen_run_id` /
`last_seen_at` (no vistas en la última importación de productos).

Cuando se retome, el diseño propuesto era: solo una lectura completa de
productos que termine bien marca bajas (lo que estaba presente y no ha venido)
y guarda por ejecución la lista de bajas y reaparecidos; las parciales nunca.
Habría que decidir antes qué hacer con las filas antiguas (empezar de cero
desde una importación completa o marcarlas en bloque) y si el freno se
confirma a mano desde la pantalla.

### Pantalla

- % global (los totales aún no leídos se estiman con lo que hay en las tablas)
  y % por entidad.
- En la entidad en curso: página X de Y, registros/s y tiempo restante, medidos
  solo con esa entidad (desde la reanudación, si la hubo).
- Hora del último avance; aviso en rojo si pasa más de 1 minuto sin avanzar.
- Errores por página (entidad, página, intentos, mensaje).
- Botones Detener (al acabar la página en curso), Reanudar y Descartar.

### Desarrollo en local

`npx supabase start` (puertos 563xx, para no chocar con otros proyectos). En
local hay que apuntar la URL de Vault a Kong para que pg_net llegue a la
función, y desactivar las tareas cron antiguas que crean las migraciones:

```sql
select vault.update_secret((select id from vault.secrets where name = 'sincro_vicente_project_url'), 'http://supabase_kong_sincro-vicente:8000');
select cron.alter_job(jobid, active := false) from cron.job;
```

Las credenciales de MHD de la función van en `supabase/functions/.env` (ignorado
por git). Para la app contra Supabase local: configuración
`sincro-vicente-local` de `.claude/launch.json` (puerto 3101).

### Despliegue (2026-10-22)

En producción: migración `20261022100000_mhd_catalog_import_por_paginas`,
secretos `MHD_API_*` en Supabase, función `mhd-catalog-import` (sin verificación
JWT; la protege `x-mhd-import-token`) y app en Vercel. Comprobado que la base
de datos llega a la función (respuesta 202). Tiempos en local contra la API
real: completa ~4 min 30 s (productos 3 min 44 s, precios 21 s, stock 20 s,
marcas 2 s, categorías 2 s); solo productos 2 min 58 s. La primera completa
en producción queda pendiente de lanzarla a mano. Primera importación de
productos en producción (22-10, 12:52): 30.649 productos en 2 min 10 s, sin
errores.

**Primera importación completa en producción (22-10-2026, 14:56):** 2 min 52 s,
51 páginas, ninguna con error.

| Parte | Registros | Duración |
| --- | --- | --- |
| Categorías (3 niveles) | 651 | 3 s |
| Marcas | 2.058 | 3 s |
| Productos | 30.650 | 1 min 57 s |
| Precios | 30.650 | 24 s |
| Stock | 30.650 | 21 s |

Solo productos (14:35): 30.660 en 2 min 1 s.
