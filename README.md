# Sincro Vicente

Prueba técnica de consulta de clientes entre PrestaShop y Shopify.

La aplicación es de sólo lectura: recibe un ID de cliente de PrestaShop, consulta la misma base MySQL que el sincronizador Python existente y busca al cliente por email en Shopify Admin GraphQL API `2026-07`.

## Variables de entorno

Copiar `.env.example` a `.env.local` y completar las variables. No incluyas `.env.local` ni credenciales en Git.

- `MYSQL_*`: conexión de sólo lectura a PrestaShop.
- `SHOPIFY_STORE_URL` y `SHOPIFY_ACCESS_TOKEN`: acceso a Shopify con el alcance `read_customers`.

En Vercel, configura las mismas variables como variables de entorno cifradas. El navegador nunca recibe los secretos.

## Desarrollo local

El modo habitual de trabajo es local. La app de tu Mac usa el mismo proyecto de Supabase que la versión publicada, por lo que la sesión y el usuario son los mismos. Shopify y MySQL siguen siendo los servicios remotos reales.

Para obtener el esqueleto de configuración y los valores no secretos de Vercel:

```bash
npx vercel env pull .env.local --environment production
```

Vercel protege las claves marcadas como sensibles y las escribe como `[SENSITIVE]` al descargarlas. En la primera configuración local, reemplaza los valores `MYSQL_*` y `SHOPIFY_*` por los del `.env` del sincronizador original, conservados sólo en tu Mac. La URL y clave pública de Supabase se pueden obtener del proyecto de Supabase. Después, conserva `.env.local`: no vuelvas a descargarlo completo salvo que vayas a restaurar esas claves sensibles.

`.env.local` queda excluido de Git y contiene las claves de MySQL, Shopify y Supabase. Vercel conserva otra copia para la aplicación publicada.

```bash
npm install
npm run dev
```

Abre `http://localhost:3100` e inicia sesión con tu cuenta de siempre. Después podrás consultar o crear clientes igual que en producción, sin publicar cada cambio.
La creación individual requiere una sesión autenticada. Nunca incluyas claves de Shopify o MySQL en Git.
