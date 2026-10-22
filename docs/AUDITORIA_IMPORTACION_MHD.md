# Auditoría de la importación de MHD

_Copia de `theme-enterprise-vicente/docs/auditoria-importacion-mhd.md` (2026-10-22). Las rutas de código son de este repositorio. El plan de rehacerla está en [IMPORTACION_CATALOGO_MHD.md](IMPORTACION_CATALOGO_MHD.md)._

_2026-10-22. Revisión de solo lectura del código de sincro-vicente y de su base de datos en Supabase, con tiempos medidos contra la API de MHD. Es el paso previo a rehacer la importación._

**Conclusión:** la importación no es fiable tal como está. Corre dentro de una función de Vercel que se corta a los ~5 minutos sin avisar, no hay nada que la retome y la pantalla sigue marcando «En curso» indefinidamente. Además lee tres veces los mismos 30.000 productos, no trae las fotos ni las características (hace falta una llamada por producto) y solo guarda el primer nivel del árbol de categorías. Hay que rehacer el motor; las tablas finales y la idea de fondo (copiar, validar, normalizar, detectar cambios y bajas) sirven.

## Cómo funciona hoy

1. El navegador pide `POST /api/mhd-catalog-import` a la app de Vercel (`src/app/api/mhd-catalog-import/route.ts`).
2. Esa función crea la ejecución, **contesta enseguida y sigue trabajando en segundo plano** (`void copy(run.id)`).
3. Para cada entidad (categorías, marcas, productos, precios, stock), página a página de 1.000 registros:
    1. avisa del progreso a la función de Supabase `import-source-catalog`;
    2. pide la página a MHD;
    3. envía las 1.000 filas a esa misma función de Supabase, que las guarda en `mhd_catalog_raw_rows`.
4. Al final llama a `replace_mhd_catalog_from_run`, que en una sola operación (máximo 60 s) vuelca todo a las tablas finales `mhd_catalog_*`, marca cambios y bajas y da la ejecución por completada.
5. La pantalla (`src/app/importar-datos-mhd/page.tsx`) consulta el estado cada 5 segundos.

No usa colas ni tareas programadas: todo depende de que esa función de Vercel siga viva.

## Lo medido

| Prueba | Resultado |
| --- | --- |
| Página de 1.000 marcas en MHD | 0,4 s |
| Página de 1.000 productos en MHD | 4 s y **5,5 MB** |
| Ficha de detalle de un producto | 0,4 s |
| Importación completa del 19 de agosto | 5 min 12 s |
| Importación de hoy | cortada a los ~4,5 min (última fila 08:39:39), 6.000 productos guardados |
| Base de datos antes y después de limpiar | 1,3 GB → 239 MB |

## Problemas encontrados

### Graves

1. **El trabajo corre dentro de una función de Vercel.** Vercel corta sus funciones a los ~5 minutos (y el trabajo que sigue después de contestar no tiene garantía de terminar). En agosto la importación cupo por poco (5 min 12 s); hoy, con la base de datos lenta, no. El corte no deja error, ni registro, ni aviso.
2. **Una ejecución cortada se queda «En curso» para siempre** y, mientras haya una «en curso», la pantalla **desactiva el botón de importar**. Hoy hubo que marcarla como fallida a mano.
3. **Nada la retoma.** No hay cola ni reanudación: si falla una página o se corta la función, se pierde todo lo leído y hay que empezar de cero.
4. **El listado no trae fotos ni características.** `GET /products` trae título, descripciones, precio, stock y letra de eficiencia, pero no `fotos`, `caracteristicas` ni `img_eficiencia`: solo están en la ficha de cada producto. Para 30.000 productos son 30.000 llamadas (≈ 3 h y 20 min seguidas, o 20-40 min con 5-10 a la vez). Hoy la importación no las pide.

### Importantes

5. **Lee el catálogo tres veces.** Los productos ya traen `pvp`, `pvp_antes`, `iva` y `stock`, y aun así se leen después los 30.000 precios y los 30.000 stocks. En una importación completa sobran; sí tienen sentido para refrescar solo precios y stock.
6. **Mucho tráfico por página.** Cada página de productos (5,5 MB) va de MHD a Vercel y de Vercel a Supabase, más una llamada extra de progreso por página. El trabajo debería hacerse donde están los datos (Supabase), sin pasar por Vercel.
7. **Normalización de golpe al final.** Las 100.000 filas se vuelcan en una sola operación con 60 s de límite, recalculando la huella (`sha256`) de todas. Con más volumen o una base lenta, puede no caber; mejor volcar cada página según llega.
8. **Solo las 18 líneas del árbol.** `/categories` sin parámetros da el nivel 1; con `?nivel=2` y `?nivel=3` da las 157 familias y 476 subfamilias (probado en *Pruebas API MHD*). La subfamilia es justo el nivel con el que trabaja el árbol que propone Vicente.
9. **Las filas en bruto de ejecuciones fallidas no se borraban nunca** (el borrado solo se hacía al terminar bien). Se limpiaron a mano hoy; falta corregirlo en el código.
10. **La protección contra dos importaciones a la vez no sirve.** Es una lista en memoria de la función; en Vercel cada llamada puede ir a una instancia distinta. Hay que hacerlo en la base de datos.

### En la pantalla de progreso

11. **El tiempo restante está mal calculado:** divide el tiempo de toda la ejecución entre los registros de la entidad en curso, así que a partir de la segunda entidad la estimación sale inflada.
12. **No hay porcentaje global**, solo el de la entidad en curso.
13. **No muestra cuándo fue el último avance**, que es lo que delata una ejecución muerta; ni la fase de normalización final; ni errores por página.
14. **No hay botones de detener ni de reanudar**, ni estado «detenida».
15. **La ruta no escribe nada en los registros de Vercel**, así que ni siquiera hay rastro de lo que pasó.

### Lo que está bien y se conserva

- Tablas finales separadas por entidad (`mhd_catalog_products`, `_categories`, `_brands`, `_prices`, `_stock`) con el JSON original.
- Detección de cambios por huella del contenido (`source_changed`) y de bajas por ausencia (`presence_status`), solo tras una lectura completa.
- No sustituir el catálogo bueno hasta haber leído todo bien.
- Comprobaciones de totales, páginas vacías e identificadores repetidos.

## Propuesta

1. **Sacar el trabajo de Vercel.** Que lo haga una función de Supabase que procese **una página por llamada** y guarde dónde va (entidad, página) en la base de datos. Al terminar una página se llama a sí misma para la siguiente. Si se corta, se retoma desde la última página buena. Vercel solo lanza y muestra.
2. **Sin tareas cada minuto.** Si hace falta un despertador de respaldo, que solo exista mientras haya una ejecución activa.
3. **Lanzamiento por entidad:** categorías (los tres niveles), marcas, productos, fichas de detalle, precios y stock, cada uno con su botón y su historial, y una «importación completa» que los encadena. Precios y stock se pueden refrescar a menudo; productos y fichas, menos.
4. **Fichas de detalle solo de lo que cambia:** pedirlas para los productos nuevos o con cambios (huella o fecha de modificación), varias a la vez con un límite, y guardar fotos, características y etiqueta energética.
5. **Volcar cada página según llega** a las tablas finales, y marcar bajas solo al completar la entidad.
6. **Una sola ejecución a la vez por entidad**, garantizado en la base de datos.
7. **Pantalla fiel:** porcentaje global y por entidad, ritmo y tiempo restante de la entidad en curso, hora del último avance, aviso de «sin avances desde hace X min», errores por página y botones de detener y reanudar.
8. **Retención:** al terminar (bien o mal) borrar las filas en bruto; conservar solo el historial de ejecuciones y sus avisos.
9. **Registros:** cada paso deja una línea con entidad, página, tiempo y resultado.

## Otros hallazgos

- La «etiqueta energética» de MHD (`img_eficiencia`) es solo el icono de la letra (`icon-eficiencia-a.svg`), no la etiqueta oficial. La etiqueta y la ficha de producto de la UE habrá que sacarlas de EPREL o de Icecat.
- El 22 de octubre MHD tenía 30.576 productos (30.374 en mayo y 32.372 en agosto).
- La base de datos de sincro-vicente está en una organización personal; se va a pasar a un proyecto de la organización de pago de Aligeria.
