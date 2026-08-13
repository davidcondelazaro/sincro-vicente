# Sincro Vicente

Prueba técnica de consulta de clientes entre PrestaShop y Shopify.

La aplicación es de sólo lectura: recibe un ID de cliente de PrestaShop, consulta la misma base MySQL que el sincronizador Python existente y busca al cliente por email en Shopify Admin GraphQL API `2026-07`.

## Variables de entorno

Copiar `.env.example` a `.env.local` y completar las variables. No incluyas `.env.local` ni credenciales en Git.

- `MYSQL_*`: conexión de sólo lectura a PrestaShop.
- `SHOPIFY_STORE_URL` y `SHOPIFY_ACCESS_TOKEN`: acceso a Shopify con el alcance `read_customers`.

En Vercel, configura las mismas variables como variables de entorno cifradas. El navegador nunca recibe los secretos.

## Desarrollo

```bash
npm install
npm run dev
```

Abre `http://localhost:3000` e introduce un ID de cliente de PrestaShop.
