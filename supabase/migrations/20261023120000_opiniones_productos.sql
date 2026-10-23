-- Opiniones de producto que ya tenemos (Trusted Shops / eTrusted, exportadas el 2026-10-23), para que el importador las
-- tenga en cuenta: resumen de Elvi y metacampo de opiniones del producto. Ver docs/IMPORTADOR_PRODUCTOS_MHD.md.
-- Sin datos personales: ni nombre ni correo del cliente ni número de pedido. Se casan por EAN (el SKU que traen es el
-- de la web antigua y cambia al código de MHD).
create table public.store_product_reviews (
  review_id text primary key,                    -- id de Trusted Shops
  source text not null default 'trusted_shops',
  reviewed_at timestamptz,
  rating smallint not null check (rating between 1 and 5),
  title text,
  body text,
  reply text,
  replied_at timestamptz,
  status text not null,                          -- APPROVED, MODERATION, REJECTED
  gtin text,                                     -- EAN tal como viene; se compara sin ceros a la izquierda
  old_sku text,
  product_name text,
  product_url text,
  imported_at timestamptz not null default now()
);
create index store_product_reviews_gtin_idx on public.store_product_reviews ((ltrim(gtin, '0')));
alter table public.store_product_reviews enable row level security;
create policy "Sesión: todo" on public.store_product_reviews for all to authenticated using (true) with check (true);
grant select, insert, update, delete on table public.store_product_reviews to authenticated, service_role;
