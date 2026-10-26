-- Base de redirecciones de la web vieja a la tienda nueva (David, 2026-10-26). Una fila por URL vieja con su clave (a qué
-- apunta: producto, colección, categoría vieja, marca, página…); el destino final se calcula después desde la clave, con
-- el árbol nuevo de colecciones y las direcciones nuevas de los productos, para que nunca haya cadenas. Fuentes, por
-- orden de autoridad: las redirecciones ya cargadas en Shopify, el inventario de la web vieja y Search Console.
create table public.store_redirects (
  id bigint generated always as identity primary key,
  origin text not null unique,                -- ruta vieja, sin dominio ni barra final («/lavadoras/lavadora-bosch-123.html»)
  sources text[] not null default '{}',       -- shopify, inventario, search_console
  current_target text,                        -- destino de hoy (Shopify o inventario), solo como referencia
  key_type text not null check (key_type in ('producto', 'producto_viejo', 'coleccion', 'categoria_vieja', 'marca', 'pagina', 'blog', 'otro')),
  key_value text,                             -- id de Shopify, handle actual, tramo de la URL vieja…
  shopify_product_id text,
  clicks_16m integer not null default 0,
  impressions_16m integer not null default 0,
  target text,                                -- destino final (se calcula después)
  status text not null default 'propuesta' check (status in ('propuesta', 'revisada', 'cargada', 'descartada')),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index store_redirects_key on public.store_redirects (key_type, key_value);
create index store_redirects_clicks on public.store_redirects (clicks_16m desc);
alter table public.store_redirects enable row level security;
create policy "Sesión: leer" on public.store_redirects for select to authenticated using (true);
grant select on table public.store_redirects to authenticated;
grant select, insert, update, delete on table public.store_redirects to service_role;
