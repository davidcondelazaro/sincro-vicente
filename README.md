# Sincro Vicente

Aplicación privada para consultar e importar clientes de PrestaShop a Shopify.

La importación masiva toma únicamente clientes activos con, al menos, un pedido válido. Puede abarcar desde una fecha, los últimos N o todos los clientes.

## Importaciones masivas

La cola vive en Supabase, usando `pgmq`, igual que ACX. Al iniciar una ejecución, la aplicación calcula el total, guarda la ejecución y encola un mensaje. La Edge Function `sync-prestashop-customers` lee la cola, importa de forma asíncrona, persiste contadores y eventos, y permite pausar, reanudar o detener el trabajo.

La Edge Function se invoca inmediatamente al iniciar o reanudar, y Supabase Cron la despierta además cada minuto. Por ello la importación continúa aunque cierres el navegador o cierres sesión. La interfaz recibe cambios en tiempo real mediante Supabase Realtime, con sondeo de respaldo mientras una ejecución está activa.

Cada ejecución conserva sus parámetros, contadores, duración, estado final y todos sus eventos. Durante la ejecución se muestra el tiempo transcurrido, una estimación del tiempo restante y el promedio reciente por cliente. Desde **Ejecuciones** se puede abrir cualquier proceso histórico, revisar su registro completo y volver al listado. El registro en directo puede plegarse. **Pausar** mantiene la cola y su cursor para reanudar; **Detener** archiva el mensaje pendiente y finaliza esa ejecución.

Las fechas y horas de la aplicación se muestran en formato español y con zona horaria `Europe/Madrid`. El criterio **Desde una fecha** comienza a las 00:00 de la fecha seleccionada en Madrid y termina en el momento actual de Madrid, incluso cuando la aplicación se ejecuta en Vercel.

## Variables de entorno

Copiar `.env.example` a `.env.local` y completar las variables. No incluyas `.env.local` ni credenciales en Git.

- `MYSQL_*`: conexión de sólo lectura a PrestaShop.
- `SHOPIFY_STORE_URL` y `SHOPIFY_ACCESS_TOKEN`: acceso a Shopify con los alcances de clientes de lectura y escritura.

En Vercel, configura las mismas variables como variables de entorno cifradas. El navegador nunca recibe los secretos.

## Desarrollo local

El modo habitual de trabajo es local. La app de tu Mac usa el mismo proyecto de Supabase que la versión publicada, por lo que la sesión y el usuario son los mismos. Shopify y MySQL siguen siendo los servicios remotos reales.

### Entornos y publicación

Supabase es un único entorno compartido: **desarrollo y producción son el mismo proyecto**. Por tanto, una migración de `supabase/migrations` o el despliegue de una Edge Function modifica directamente el entorno real; no se deben aplicar cambios experimentales ni asumir una base de datos de pruebas separada.

La interfaz Next.js sí se publica en Vercel mediante la integración con GitHub: la rama `main` es producción. El flujo acordado es validar localmente, revisar el conjunto de cambios, confirmar un único commit y subirlo a `origin/main`; Vercel construye y publica automáticamente ese commit. No se usa `vercel --prod` desde este ordenador salvo que se haya configurado expresamente una sesión autorizada de CLI.

Para obtener el esqueleto de configuración y los valores no secretos de Vercel:

```bash
npx vercel env pull .env.local --environment production
```

Vercel protege las claves marcadas como sensibles y las escribe como `[SENSITIVE]` al descargarlas. En la primera configuración local, reemplaza los valores `MYSQL_*` y `SHOPIFY_*` por los del `.env` del sincronizador original, conservados sólo en tu Mac. La URL y clave pública de Supabase se pueden obtener del proyecto de Supabase. Después, conserva `.env.local`: no vuelvas a descargarlo completo salvo que vayas a restaurar esas claves sensibles.

`.env.local` queda excluido de Git y contiene las claves de MySQL, Shopify y Supabase para desarrollo local. Vercel conserva las variables necesarias para la interfaz y las rutas web. Para el consumidor persistente, las claves de MySQL y Shopify están guardadas como secretos cifrados de Supabase y sólo la Edge Function puede leerlas; no se exponen al navegador ni se incluyen en Git.

```bash
npm install
npm run dev
```

Abre `http://localhost:3100` e inicia sesión con tu cuenta de siempre. Después podrás iniciar y seguir importaciones masivas igual que en producción, sin publicar cada cambio.
El arranque de importaciones masivas requiere una sesión autenticada. Nunca incluyas claves de Shopify o MySQL en Git.

## Importación del catálogo

La importación de catálogo parte siempre de las tablas `source_*` de Supabase. Es un proceso independiente de la copia inicial desde SQL Server: esa copia conserva el origen y su historial; esta cola utiliza esos datos para sincronizar Shopify.

Actualmente la pantalla permite seleccionar:

- **Marcas**: crea o conserva las colecciones inteligentes de marca y sus imágenes.
- **Categorías**: crea las colecciones que faltan y retira de los canales las categorías inactivas o dependientes de un padre inactivo, sin borrarlas.
- **Características**: crea sólo las definiciones abiertas que faltan. Mantiene las exclusiones históricas (`OFERTA`, `SUPEROFERTA`, `DESCATALOGADO`, `PRECIOOCULTO`, `PRIORIDAD` y las claves heredadas) porque esas claves se utilizan como datos de producto, no como definiciones de metafield.
- **Productos**: valida todas las relaciones necesarias antes de tocar Shopify: fabricante, categoría, características, valores, precio y stock en las altas. En productos existentes actualiza los datos propios del producto, pero deja precio y stock a sus sincronizadores específicos.

Cada ejecución se encola en `catalog_import_runs` y conserva sus eventos en `catalog_import_events`. La interfaz muestra progreso, tiempo transcurrido, estimación, contadores, filtros de historial y el registro detallado por entidad.

### Productos

Los productos se identifican primero por SKU (el ID de origen) y después por handle. El comportamiento previsto es:

- Activos: si las validaciones son correctas, se crean o actualizan y se publican. Si no hay cambios gestionados, se registra **Sin cambios**.
- En un alta se escriben también el precio y el stock iniciales. En una actualización no se envían ni precio, ni precio comparativo, ni cantidad de inventario, y esos campos tampoco intervienen en la decisión **Sin cambios**.
- Inactivos: si no existen en Shopify no se crean; si existen, se archivan.
- El filtro **Desde fecha de modificación** usa `source_products.fecha_modificacion` como filtro de selección.
- Si `fecha_modificacion_imagen` es igual o posterior a esa fecha, se activa automáticamente el reemplazo de imágenes para ese producto.
- El check **Forzar todas las imágenes** elimina los medios actuales y vuelve a cargarlos desde el origen. El registro indica cuántas había, cuántas se eliminaron y cuántas se importaron.
- Las etiquetas `Oferta`, `Energética`, `SuperOferta` y `Descatalogado` se gestionan desde los datos de producto; no se convierten en definiciones de características.

Al archivar un producto existente se prepara una redirección desde `/products/<handle>` a la colección de su categoría. Se reutiliza una redirección existente, se prueban primero la categoría directa y después sus padres, y al reactivar el producto se elimina la redirección asociada. Esta parte requiere el alcance de Shopify `write_online_store_navigation`.

### Despliegue y primera prueba

La migración de productos se aplica de forma aislada porque el historial remoto de migraciones no coincide uno a uno con los nombres locales. La Edge Function `sync-catalog-imports` debe desplegarse después de cada cambio del trabajador.

La primera prueba recomendada es por ID de producto, nunca masiva. Antes de ejecutarla se debe comprobar que el producto tiene fabricante, categoría, precio y stock, y revisar el registro de imágenes y validaciones al finalizar.

No se deben ejecutar pruebas masivas hasta verificar una creación, una actualización sin cambios, una actualización con imágenes y el archivado/reactivación de un producto.

## Importación Icecat

El menú **Importación Icecat** conserva el comportamiento del sincronizador Python histórico, pero utiliza una cola persistente independiente de la del catálogo, con los mismos controles y registro de ejecuciones. Obtiene la ficha en español por el EAN de la variante de Shopify y guarda el resultado en el metafield JSON `custom.icecat`: ID de Icecat, fecha de sincronización, puntos destacados y especificaciones filtradas.

Las listas opcionales de SKU o EAN se resuelven primero contra Shopify; no son IDs de Shopify. Sin filtros, se recorren todos los productos de Shopify con EAN que aún no tienen `custom.icecat`. Al marcar **Actualizar datos Icecat existentes**, se recorren todos los que tienen EAN y se reemplaza su información existente. Los productos sin EAN, sin presencia en Shopify o sin datos de Icecat quedan registrados como **Sin datos o cambios** y la cola continúa.

La clave de Icecat pertenece al trabajador de Supabase, no a la aplicación de Vercel. Antes de activar la función en producción hay que configurar `ICECAT_USERNAME`, `ICECAT_APP_KEY` y, opcionalmente, `ICECAT_LANGUAGE=es` como secretos de Supabase y desplegar `sync-icecat-imports` después de aplicar las migraciones de Icecat. En local, esos mismos valores se cargan para la Edge Function, sin incluirlos en Git.

## Estado de conexiones

La barra inferior forma parte del diseño global de la aplicación privada, por lo que aparece en cualquier pantalla interna, incluidos los historiales. No se muestra en las pantallas públicas de acceso o restablecimiento de contraseña.

Muestra MySQL PrestaShop, Shopify, SQL Pladisel, MHD e Icecat. Cada indicador se consulta desde `/api/health`, que comprueba directamente cada servicio; para Icecat se hace una petición ligera a su API con las credenciales de la aplicación. Las credenciales nunca llegan al navegador.

Para evitar carga innecesaria, al abrir la aplicación se realiza una comprobación, se reutiliza durante cinco minutos en el servidor y se refresca como máximo cada cinco minutos por pestaña. Al volver a una pestaña se actualiza sólo si la última comprobación tiene al menos un minuto. El botón **Comprobar ahora** fuerza una nueva comprobación. Si un indicador está en rojo, al situar el cursor sobre él se abre, hacia arriba, el detalle del error.
