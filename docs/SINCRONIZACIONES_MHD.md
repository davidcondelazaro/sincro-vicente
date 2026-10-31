# Sincronizaciones periódicas con MHD (diseño, 2026-10-26)

Diseño acordado con David para mantener la tienda al día una vez terminado el masivo del catálogo. **En marcha desde el 2026-10-29** (vuelta cada 30 minutos; ver «Vuelta encadenada» abajo). Sustituye a las sincronizaciones preliminares (la de SQL Server de `ESTADO_SINCRONIZACION_SQL_SHOPIFY.md` y la importación diaria completa de `IMPORTACION_CATALOGO_MHD.md`).

## Qué se hace y cada cuánto

**Se lee siempre todo y la comparación la hacemos nosotros** (David, 2026-10-26: «no quiero que dependamos de que nos digan que se ha modificado»). No se usan los filtros por fecha. Cada producto guarda sus huellas (precio, stock, contenido, fotos y entrega); se calculan las nuevas y se actúa sobre las que cambian. Si una lectura falla, la siguiente lo recoge todo.

| Cada | Lectura de MHD (medida el 2026-10-26) | Qué se hace |
| --- | --- | --- |
| 30 min (en marcha desde el 2026-10-29) | `/products` completo: ~31.500 productos, ~3½ min | **Vuelta encadenada:** conexiones → lectura del listado → precio y stock (los dos del listado) → agotados en MHD → (pendiente) altas y cambios. `/prices` y `/stocks` ya no se leen en cada vuelta: `/prices` coincide con el listado desde el 29-10 y `/stocks` sigue enseñando productos que MHD ya ha retirado. |
| 1 día (madrugada, hora de Madrid) | Nada de MHD: colecciones de Shopify con `custom.tipo_coleccion = promocion` | **Caducidad de promociones** (encargo de David, 2026-10-28, desde la sesión de promociones): las que tengan `custom.promo_fin` anterior a hoy se despublican de Tienda online y Shop, se crea la redirección `/collections/<handle>` → `/collections/promociones` (si no existe) y se quitan de `custom.subcategorias` de la colección «promociones», conservando el orden. Sin borrar nada; cada baja al registro. Con modo de simulación. Referencia: orden `caducar` de `theme-enterprise-vicente/tools/shopify/promociones.py`; procedimiento en `theme-enterprise-vicente/docs/promociones.md`. La primera vencerá el 1-12-2026 (Hisense lavado). |

El listado no permite pedir menos campos (probados 9 nombres de parámetro) y trae las dos descripciones largas: 2,7 de los 4 KB de media por producto; la ficha de detalle solo añade características (0,27 KB) y galería (0,31 KB). Lo que se descarga (~3,3 GB al día) no se guarda: cada producto tiene una sola fila con su última versión (todo el catálogo de MHD ocupa ~370 MB) y el histórico solo apunta los cambios.

Solo las altas y las modificaciones importantes piden la ficha de detalle (una petición por producto: con todo el catálogo, ~44 min), Icecat e IA. Peticiones a MHD enviadas el 2026-10-26 (fichas por lotes, gzip, elegir campos, bajas explícitas, qué cambia cada fecha…): si llegan, se simplifica. **Fichas por lotes: MHD dice que no** (2026-10-27, porque afecta a su sistema de producción), así que la ficha de detalle se sigue pidiendo de una en una y solo para altas y cambios.

## Decisiones

- **Altas:** se publican directamente en la tienda, sin borrador (David, 2026-10-26). La colocación se decide al subir, con el árbol nuevo de colecciones.
- **Bajas:** solo lo que lleva **30 días agotado en MHD** (ver «Agotados en MHD» abajo). Entonces se **archivan** (no a borrador) y se propone su redirección a la colección de su familia en el árbol nuevo. Archivar las separa de los borradores pendientes, conserva su historial y se deshace si MHD vuelve a traerlas.
- **Vuelta de un archivado** (David, 2026-10-27): si MHD vuelve a traer un producto que estaba archivado, se **reactiva** (activo, o borrador si tiene revisión pendiente o «Avisar a MHD»), conserva su URL y se **quita su redirección**: la de `/products/<handle>` se borra en Shopify y se descarta en la base de redirecciones. Ojo con las redirecciones cada vez que algo se reactive. Hecho en la subida (`shopify-draft.ts`, `releaseProductRedirects`).
- **Lo ya subido no se reescribe sin pedirlo** (David, 2026-10-30): la subida del importador pisa casi toda la ficha, también lo arreglado a mano en Shopify. Ninguna tanda vuelve a subir un producto que esté activo o en borrador, ni lo busca solo por código ni por EAN; si lo ve, lo descarta sin gastar IA. Solo se reescribe con la opción expresa «Reescribir también los ya subidos» de una tanda o con el aviso del botón de una prueba. Los **archivados sí pasan**, porque se reactivan (punto anterior). Las altas automáticas pasan a `upload: "nuevos"`, el mismo modo: se publican igual, porque el estado no depende del modo. Detalle en [IMPORTADOR_PRODUCTOS_MHD.md](IMPORTADOR_PRODUCTOS_MHD.md) › Lo ya subido.
- **Bajas también para lo que entró con la sincronización antigua** (SQL Server / Pladisel): el «ERP» y MHD son lo mismo (David, 2026-10-26). Sustituye a la decisión de esa mañana de archivar solo lo creado por el importador. El 26-10 había 440 productos activos de esa vía cuyo EAN MHD ya había dado de baja; se cruzan por EAN o por código.
- **Seguros** (una lectura incompleta de MHD parecería una baja masiva; ver «Agotados en MHD»): nada se toca solo porque falte en el listado, cada producto se confirma con su ficha de MHD, y hay **freno** (`absence_brake_pct`, 15 %).
- **Histórico:** una tabla con todo lo ocurrido a cada producto (alta, baja, cambio, qué se hizo y con qué resultado), **sin caducidad**. El registro del importador (`mhd_importer_events`) se borra a los 60 días; este no.
- **Correos:**
  - inmediato **solo con fallos graves**, también a david@aligeria.com: lectura de MHD fallida, freno de bajas, Anthropic sin saldo o con el tope de gasto alcanzado, Shopify rechazando la subida;
  - **resumen diario a las 9:00 (hora de España) a david@aligeria.com** (David, 2026-10-26), de las últimas 24 horas: altas, bajas y cambios; descartes con su motivo; lo que está en revisión; temas abiertos ya hablados.
  - **Contenido completo (David, 2026-10-29).** Hecho el 29-10 (`src/lib/email.ts`, `alerts.ts`, `daily-report.ts`, ruta `/api/informes/diario`): los avisos de precio y stock y del freno del importador, y en el resumen las lecturas, precio y stock, productos procesados, cola de revisión y avisos del día. El resto se añade con cada pieza:
    - **Avisos al momento** (uno por motivo cada hora): precio y stock parados o con errores; caída de la sincronización; freno del importador; sin conexión con MHD, Shopify, Icecat o Supabase; Anthropic sin saldo o con el tope alcanzado (y parar los procesos); freno de bajas; un proceso del encadenado atascado.
    - **Resumen, lo hecho:** cada proceso con **su tiempo y su número de productos** (lecturas, precio y stock, altas, bajas, cambios, marcas, promociones); altas, bajas y productos que vuelven; descartes con su motivo; promociones caducadas.
    - **Resumen, colecciones y redirecciones (ojo):** colecciones de categoría y de marca que se quedan vacías por las bajas (despublicadas, con redirección creada) y las que recuperan productos (republicadas, con la redirección quitada); redirecciones creadas y quitadas de productos (bajas y vueltas). Cada una con su origen y su destino, para revisarlas.
    - **Resumen, cosas raras y temas que revisar:** cola de revisión; cambios de precio de más del 30 %; cambios de marca, EAN o modelo (a revisión sin tocar); cambios de texto de MHD sin cambio de datos; opciones de entrega que desaparecen o suben mucho; avisos de ficha («Foto pequeña», «Cifras MHD frente a Icecat», «Avisar a MHD»); marcas nuevas, sin logotipo, despublicadas y que vuelven; proveedores con otra grafía de una marca existente.
    - **Enlaces** a utils para ver el detalle siempre que exista pantalla (proceso, producto, cola de revisión, redirecciones) y a la ficha del producto en Shopify.
  - **Durante la estabilización, cada hora** (David, 2026-10-29): el resumen sale cada hora con lo de esa hora (`/api/informes/diario?horas=1`) hasta que David diga que pasamos al diario de las 9:00.
  - **Servicio: Resend**, el mismo que usa chatbot-vicente para las incidencias desde el 2026-10-11 (ver su `docs/gestion-sincro-vicente.md`). `RESEND_API_KEY` puesta por David en Vercel (Production) el 2026-10-29, la misma de chatbot-vicente. Remitente `utils@mail.electronicavicente.com` (el del equipo en el chatbot) y destinatario david@aligeria.com, los dos en el código (`EMAIL_FROM_TEAM` y `ALERT_EMAILS` los cambian sin tocarlo). David dice que los correos del chatbot han dejado de salir: revisarlo al montarlo, porque comparten servicio.
- **Freno general** del importador (`mhd_importer_brake_check`) también para las altas: si fallan 10 de los últimos 20, se pausa.

## Tipos de modificación (por decidir uno a uno)

**Histórico de cambios (desde el 2026-10-30):** la lectura sobrescribe la fila de cada producto y las huellas solo dicen que algo cambió. La tabla `mhd_catalog_product_history` guarda, por producto que cambia, cada campo distinto con su valor antes y ahora (sin stock ni fechas), mediante un disparador sobre `mhd_catalog_products`. Si fallara, se pierde esa fila, nunca la lectura. **No se monta nada más de cambios de ficha hasta tener varios días de datos** (David, 2026-10-30): puede que solo merezca la pena automatizar los portes.

**Regla por encima de esta tabla (David, 2026-10-30):** «no queremos perder en las fichas la información que ya hay salvo casos excepcionales», porque desde Shopify se hacen arreglos a mano. Por eso los cambios de ficha:

- **Tocan solo el campo que cambió.** Nunca se rehace la ficha entera: `productSet`, que usa el importador, reescribe casi todo y no vale para esto.
- **No pisan lo arreglado a mano.** Antes de escribir se compara lo que hay en Shopify con lo que subimos (`mhd_importer_product_runs.result`). Si no coincide, alguien lo tocó: no se escribe y va a revisión.
- **Los filtros sí se podrían actualizar solos** (David, 2026-10-30), porque no son textos, siempre que no se hayan arreglado a mano. Ojo: salen de las características de la ficha de detalle, que el listado no trae, así que ni las huellas del listado ni `mhd_catalog_product_history` los ven; detectarlo exige leer esas fichas.
- **Respetan los productos bloqueados** (`store_product_locks`).
- **Los textos de una ficha ya publicada nunca se rehacen solos, solo se proponen** (David, 2026-10-30: «para no perder nada por error»), también en fichas sin tocar. Si un dato clave cambia, se propone el texto nuevo para revisar; mientras nadie lo revise, la ficha sigue como está. Si solo cambia la redacción de MHD, nada.

Propuesta inicial:

| Cambio | Acción |
| --- | --- |
| Precio, stock | Directo cada 30 min |
| Fotos (huella de imágenes) | Se rehace la galería entera con las reglas del alta (MHD, completar con Icecat si hay 3 o menos, sin repetidas, revisar y tratar) y se compara con la publicada foto a foto. Si sale igual, no se toca. Si cambia: se suben solo las nuevas, se quitan las que sobran y se reordena (`productReorderMedia`, sin volver a subir). Las fotos que se reconocen como la misma (huella del archivo o huella visual, aunque MHD la haya vuelto a comprimir) conservan su archivo en Shopify y la clasificación que ya tenían: solo se clasifican con IA las nuevas. Las que dejan de usarse se **borran también de Archivos de Shopify** (David, 2026-10-26, como el importador antiguo de SQL), solo si las subió el importador. Hace falta guardar por producto cada foto publicada: id del archivo en Shopify, huella, huella visual, tipo y posición. |
| Título o descripción (huella de contenido) | Se vuelve a pedir la ficha de detalle y se comparan las características y los datos clave (medidas, capacidad, clase energética, modelo…) con los usados al redactar. **Si cambió algún dato, se propone texto nuevo para revisar (ver la regla de arriba); si solo cambió la redacción de MHD, no**, y queda en el histórico y en el resumen diario (David, 2026-10-26: un cambio de texto puede esconder un cambio de datos). |
| Familia o subfamilia | **Se recoloca solo en el árbol nuevo** (David, 2026-10-26): metacampos de apartado, grupo y familia, colecciones y migas de pan. Se recalculan también los filtros (`filtro.*`), que dependen de la familia. La dirección del producto no cambia, así que no hace falta redirección. |
| Marca, EAN o modelo | **A revisión, sin tocar nada** (David, 2026-10-26): puede ser otro producto con el mismo código. Sale en el resumen diario. |
| Clase energética | **Todo lo que depende de ella** (David, 2026-10-26): la etiqueta energética (`custom.etiqueta_energetica`), la ficha de información del producto de la UE y el enlace a EPREL (`custom.documentos`, `custom.eprel`), el filtro de eficiencia y la etiqueta «Energética». Como es un dato clave, también se rehacen los textos (regla de los cambios de datos). Si la etiqueta nueva no casa con el modelo, a revisión. |
| Opciones de entrega | **Se actualizan solas, siempre** (David, 2026-10-26: «esta parte es importantísima»): portes, subida, instalación y retirada del viejo, con sus precios, al metacampo `custom.opciones_entrega`, sin IA. Se detectan en cada lectura del listado (cada hora), que trae los siete campos de portes y servicios. Hoy van dentro de la huella «precio» (`mhd_hash_parts`): conviene separarlos en una huella propia. Las escribe el paso «opciones-entrega» de la vuelta (ver [Opciones de entrega](#opciones-entrega)). Si un dato desaparece o su importe sube más de un 50 %, aviso. |

## Lo que cada subida avisa a la estructura de la tienda (acuerdo con la sesión del árbol, 2026-10-28)

David: «siempre hay que pensar en el importador para que todo lo nuevo vaya fino». La estructura (colecciones, menús, marcas, tema) no se crea sola con los productos:

- **Proveedores sin colección de marca:** el informe de cada subida los lista; con ellos se lanza `theme-enterprise-vicente/tools/shopify/marcas_nuevas.py`, que crea solo las que faltan.
- **Variantes nuevas de proveedor** (p. ej. «POLK AUDIO» frente a «polk»): el informe lista las que no estén en `theme-enterprise-vicente/snippets/marca-handle.liquid`, que traduce cada variante a su marca. El proveedor de los productos no se cambia (movería las colecciones de marca).
- **Marcas despublicadas que vuelven a tener productos:** el informe lista los proveedores con productos activos cuya colección de marca está despublicada (19 despublicadas el 2026-10-28 por no tener productos, sin borrar: `theme-enterprise-vicente/reference/marcas/marcas-despublicadas-2026-10-28.json`), para volver a publicarla; mientras tanto su URL redirige a `/pages/marcas`.
- **Familia nueva** (en `store_collections` o como destino nuevo en `store_icecat_category_map`): su colección de Shopify se crea con `tools/shopify/arbol_colecciones.py` (sesión del árbol).
- **Después de cambiar metacampos del árbol en bloque**, volver a guardar sin cambios la regla de las colecciones afectadas: Shopify no las recalcula solo.

## Precio de la tienda: el `pvp` del listado de productos (David, 2026-10-29)

El `pvp` del listado (`/products`) es **la tarifa de nuestra web**, la buena: MHD ya lo había cambiado ahí. `/prices` trae otra tarifa (la de la web de MHD) y no coincide en ~17.500 productos (combi Bosch KGN39VIEB: 647 € en el listado, 796 € en `/prices` y en su web); MHD tiene que cambiarla también. Hasta entonces, el precio sale del listado (subida del importador y sincronización) y el stock, de `/stocks`. La subida masiva usó el del listado, así que sus precios están bien. El 28-10 se probó a poner el de `/prices` en 5 productos y se deshizo el 29-10.

## Stock y pedidos: se fijan las unidades «en existencia» (David, 2026-10-29)

Shopify cuenta disponibles (se pueden vender), comprometidas (pedidos sin enviar) y en existencia (la suma). La sincronización y la subida del importador fijan **en existencia** (`on_hand`) al stock de MHD en «Almacén MHD», y Shopify resta lo comprometido. Así una unidad vendida que MHD aún no ha registrado no se vuelve a vender. Entre que MHD registra el pedido y se marca como enviado en Shopify, la web enseña una unidad de menos (el error seguro); al marcar el envío vuelve a cuadrar. Fijar las disponibles podría vender dos veces la misma unidad.


## Vuelta encadenada (en marcha desde el 2026-10-29)

Un solo reloj: pg_cron abre una vuelta cada 30 minutos (`mhd_sync_cycle_start`, tabla `mhd_sync_cycles`) y la base avisa a la app (`/api/sincronizaciones/vuelta`, `src/lib/mhd-importer/sync-cycle.ts`). Cada paso arranca al acabar el anterior y queda con su inicio, fin, cifras y error:

1. **Conexiones:** Shopify y MHD (si fallan, la vuelta se para y llega un aviso); Anthropic, Icecat y Garantía3 (aviso, pero precio y stock siguen); Resend (en rojo en Inicio). Garantía3 se comprueba siempre con el token de producción y un EAN inexistente, sin crear contratos.
2. **Lectura del listado de MHD** (~3½ min). Al acabar, la base llama al paso siguiente (disparador `mhd_sync_read_finished`).
3. **Precio y stock** a Shopify (solo lo que cambia).
4. **Agotados en MHD** (abajo).
5. **Altas** (abajo): lo nuevo, a la tanda «Altas automáticas».
6. **Avisos de tandas terminadas:** **apagados hasta nuevo aviso** (David, 2026-10-31: al momento, solo frenos y avisos graves; el resto, en el resumen diario). Se encienden con `job_notice_emails` = `true` en `store_settings` (`job-notices.ts`).
7. Pendiente: cambios de ficha.

Una sola vuelta a la vez; si una pasa de 25 minutos se da por atascada y se avisa. Se ve en utils › Catálogo › Sincronización con MHD (con el botón «Leer ahora y actualizar») y en Inicio. Pausa y frecuencia del resumen: Configuración. Resumen por correo a las 9:00 (el de cada hora se quitó el 2026-10-30).

## Agotados en MHD: desaparecer no es una baja (David, 2026-10-29)

MHD lo explica así: «si no tienen stock nosotros los descatalogamos y cuando vuelvan a tener stock los volvemos a poner con disponibilidad». Su listado cambia todos los días: el 29-10 desaparecieron 60 productos entre la mañana y las 13:30, y desde el 26-10 volvieron 1.195 productos antiguos que entonces no estaban. Además, **el listado por páginas no es del todo fiable**: si cambia mientras se lee, unas páginas se desplazan (en una lectura salieron 5 repetidos y otros tantos sin leer). Y `/stocks` va por detrás: sigue enseñando productos que la ficha de MHD ya da por inexistentes (404).

Por eso (`src/lib/mhd-importer/absences.ts`, paso «agotados» de la vuelta, tabla `mhd_missing_products`):

1. **Desaparece del listado:** se pregunta a MHD por su ficha. Solo si responde «no existe» (404) cuenta; si existe, la lectura se lo saltó y no se toca (queda contado como «saltado por la lectura»).
2. **Confirmado:** **stock 0** en «Almacén MHD» y, si se vendía sin stock (Balay, Bosch, Siemens, AEG, Electrolux y Zanussi en lavado, frío y cocción: `STORE_RULES.sellOutOfStock*`), **deja de venderse sin stock** mientras falte. **Sigue publicado**, con su dirección, precio y «Avísame cuando vuelva». Nada se archiva ni se redirige.
3. **Vuelve a venir:** precio y stock lo reponen en esa misma vuelta y se le devuelve «vender sin stock» si lo tenía. Sin reprocesar ni tocar redirecciones.
4. **30 días sin volver** (`absence_days`, en utils › Catálogo › Configuración): pasa a **pendiente de baja** (archivar y proponer redirección; esa parte está pendiente de montar).
5. **Freno:** si se calcula que faltan más del `absence_brake_pct` % de los activos de la tienda, no se toca nada y llega un aviso, repetido cada 12 horas mientras siga. El cálculo aplica a todos los candidatos la parte sin ficha de los comprobados (`estimateAbsent`), porque en una vuelta solo da tiempo a comprobar unos 500 (David, 2026-10-31). Antes contaba solo los confirmados: con un tope alto no saltaría nunca, y una vuelta cortada por tiempo aplicó 339 con el freno activo. La primera puesta al día (29-10, 14:12) se aplicó con el freno saltado, con el sí de David: **667 productos a stock 0** (4.739 unidades que MHD no podía servir), 12 de ellos dejaron de venderse sin stock; 2 los había saltado la lectura y no se tocaron.

6. **Ritmo con MHD** (desde el 30-10, tras la caída de esa mañana; informe en `docs/informe-mhd-2026-10-30/`): las fichas se piden **como mucho 5 por segundo**, 4 a la vez y en orden aleatorio. Antes iban 8 a la vez (unas 20 por segundo) y MHD rechazó con 429 casi un tercio de mil consultas.
   - **Si MHD falla en masa** (429, 5xx o sin respuesta): se para todo enseguida, se espera 10 s y se reintenta; si vuelve a fallar, 30 s y otro intento; a la tercera, se deja la ronda y llega un aviso (David: «pararía rápido y luego iría realizando ciertos reintentos»). Una ficha que falla por otra cosa se apunta y no para nada.
   - **Tope de tiempo:** 2 minutos de comprobaciones por vuelta, para que la vuelta quepa en sus 5 minutos.
   - Lo que no se llega a comprobar sigue siendo candidato y se mira en la vuelta siguiente (`unchecked`, `stoppedBy` en el paso de la vuelta).
   - Los candidatos y los que vuelven se leen por páginas: antes se cortaban en 1.000 (límite de filas de Supabase) y el 30-10 faltaban 1.454.

Sale en el resumen por correo («Agotados en MHD»: se agotan, vuelven, siguen agotados, pasan de 30 días y saltados por la lectura), en Inicio y en la tabla de vueltas de utils. A mano: `POST /api/sincronizaciones/agotados?simulacion=1` (o `?forzar=1`), con la cabecera de la clave.

## Altas (automáticas desde el 2026-10-29)

Un producto es alta si viene en el listado de MHD, no existe en Shopify con su código como SKU (en ningún estado), nunca lo ha procesado el importador, su familia tiene reglas y su subfamilia sitio en el árbol, no está bloqueado y no está ya en cola (`mhd_new_products`). También vuelven a entrar los descartados «Sin imagen» a los que MHD cambia las fotos. Fuera quedan los «Productos de Marketing» (6.742 el 29-10).

- **Primera tanda, a mano (29-10, 14:20 → 16:44):** 1.301 (106 de códigos nuevos y 1.195 antiguos que MHD volvió a poner a la venta). Resultado: 1.239 subidos (59 en borrador para revisar), 27 fichas bloqueadas por el revisor, 25 «Sin imagen» y 10 fallidos por la saturación de la base, reintentados. 8,55 $. Los 57 que estaban en la tienda de PrestaShop con otro SKU reutilizaron su producto archivado (se reactivan, sin duplicar).
- **Desde entonces, en cada vuelta** (`new-products.ts`): las altas se añaden a la tanda abierta «Altas automáticas» (o a una nueva) y se despierta al trabajador; si le falta la ficha de MHD, la pide él. **Freno:** más de `auto_altas_max` (300) en una vuelta → no se encola nada y llega un aviso. Se pausan con `auto_altas` en Configuración.
- **Tope del importador** (`importer_max_workers` 3 × `importer_max_concurrency` 4, en Configuración): ninguna tanda lo pasa. El 29-10, con la base en Micro, 12 trabajadores × 4 la dejaron sin conexiones 25 minutos; se subió la base a **Small** (David) y con 3 × 4 fue más rápido (12-13 productos por minuto) que con 12 × 4, sin errores.

## Relaciones de Icecat (preparada y apagada, 2026-10-30)

**No está en marcha.** Se hizo una carga puntual el 2026-10-30; David definirá las reglas del proceso antes de activarlo. La tarea `sincro-vicente-relaciones` está apagada y la ruta sin desplegar.

Diseño actual, fuera de la vuelta de 30 minutos: pg_cron llamaría cada día a las 4:45 UTC a `/api/sincronizaciones/relaciones` (`src/lib/mhd-importer/relations-sync.ts`). `mhd_relations_calc` calcula los metacampos de Search & Discovery con las fichas de Icecat guardadas y `mhd_shopify_relations` guarda lo último enviado. Se manda solo lo que cambia, en una operación masiva.

- **Complementarios:** `consumable`, `accessory` y `compatible` invertido (viene del accesorio al aparato), sin monitores y sin fundas o mochilas de otra talla. Prioridad: con stock, luego ese orden, luego XL o negro.
- **Relacionados:** `alternative` del mismo tipo de producto; en cables, adaptadores, pilas y baterías, además con el mismo conector o formato. Se dejan en `only manual` para que Shopify no los rellene.
- **Máximo 10 por lista.** Quedan fuera garantías, servicios y tarjeta regalo.
- **Lo puesto a mano no se pisa:** un metacampo que no está vacío ni coincide con lo último enviado se respeta.
- **Recetas por familia (2026-10-31):** en televisores, portátiles y monitores los complementarios salen primero de `complement-recipes.ts` y detrás va lo de Icecat, hasta 10. Un complemento por hueco, sin IA: filtro duro de compatibilidad, sin dato no hay sugerencia, stock mínimo de 5 para entrar, y nota de precio proporcionado (50), stock (30) y misma marca (20). Lee el stock de `mhd_shopify_price_stock` por `mhd_complements_source`, nunca de `mhd_catalog_products`. Lo ya sugerido se mantiene mientras siga compatible y tenga stock, para que las fichas no cambien cada día; si se agota o deja de encajar, entra el siguiente.
- **Estado (2026-10-31):** migración `mhd_complements_source` aplicada y punto de partida guardado en `mhd_shopify_relations` (843 fichas). El TCL 55C6K PRO no se guarda: sus 8 puestos son manuales. Simulación con el código real: 41 fichas por escribir, todas por la cola de Icecat, y 1 respetada a mano. Falta desplegar y encender `sincro-vicente-relaciones`.
- **Límites:** los archivados entran mientras sigan en `store_shopify_ids`; los antiguos que nunca estuvieron (137 con EAN) no. Un producto que se queda sin relaciones conserva las suyas. Los televisores no tienen enlaces en Icecat.

## Pendiente de decidir

- ~~El porcentaje del freno de bajas~~: 15 % (David, 2026-10-31; antes 2 %, que paraba con caídas normales de proveedor: lo máximo visto son unos 2.230, el 9 %), en Configuración.

## Tarifas de servicios

El tema ofrece cada servicio buscando la variante de su producto de Shopify con el
precio que da MHD en ese aparato. Si la variante no existe, el servicio no sale en
la ficha y no hay ningún error. El paso «tarifas-servicios» de la vuelta
(`service-tariffs.ts`) compara los importes del listado con esas variantes:

- Si falta alguna, manda un aviso con el importe, cuántos productos afecta, ejemplos
  y el SKU a crear. Una tarifa nueva avisa al momento; mientras siga faltando, se
  repite una vez al día. El resumen recoge los avisos enviados.
- Para resolverlo, crear en el producto de servicio la variante con ese precio
  exacto y ese SKU, sin seguimiento de stock y **sin requerir envío**. En subida e
  instalación no hay que tocar código: el tema busca por precio y la exportación a
  MHD reconoce el SKU. La retirada sí necesita un cambio en el tema, que hoy ofrece
  su primera variante sin mirar el precio.
- Lee el listado entero tras cada lectura, no los cambios ni la subida de fichas: un
  producto nuevo avisa en la misma vuelta que entra, antes de subirse.
- Si la comprobación falla, queda en el paso de la vuelta y no la para.

## Opciones de entrega

El paso «opciones-entrega» de la vuelta (`delivery-options-sync.ts`) lleva los siete
campos de portes y servicios de MHD al metacampo `custom.opciones_entrega` de cada
producto activo o en borrador, incluidos los ya publicados. Sin IA ni revisión.

- Compara con lo último registrado (`mhd_shopify_delivery_options`) y, antes de
  escribir, con lo que hay en Shopify. La primera pasada solo registra lo que coincide.
- Lo que no quepa en 60 s sigue en la vuelta siguiente.
- **Freno:** más de 500 productos cambiados de golpe no se envían y se avisa. Si el
  cambio es real, subir `delivery_options_max` en `store_settings`.
- Un valor puesto a mano en el metacampo se sobrescribe: manda MHD.
- **Pedidos ya pagados:** si cambian los portes antes de exportar, el pedido deja de
  cuadrar con lo cobrado y se bloquea con el motivo a la vista, hasta revisarlo.
