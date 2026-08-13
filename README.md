# Sincro Vicente

Aplicación privada para consultar e importar clientes de PrestaShop a Shopify.

La importación individual recibe un ID de cliente de PrestaShop, consulta la misma base MySQL que el sincronizador Python existente y busca al cliente por email en Shopify Admin GraphQL API `2026-07`. La importación masiva sólo toma clientes activos con, al menos, un pedido válido.

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

Abre `http://localhost:3100` e inicia sesión con tu cuenta de siempre. Después podrás consultar o crear clientes igual que en producción, sin publicar cada cambio.
La creación individual y el arranque de importaciones masivas requieren una sesión autenticada. Nunca incluyas claves de Shopify o MySQL en Git.
