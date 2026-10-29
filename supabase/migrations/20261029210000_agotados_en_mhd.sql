-- Productos que MHD deja de traer (David, 2026-10-29; MHD: «si no tienen stock nosotros los descatalogamos y cuando
-- vuelvan a tener stock los volvemos a poner»). Desaparecer del listado = agotado, no baja: stock 0 en Shopify (y sin
-- «vender sin stock» mientras falte), sigue publicado y, si vuelve, se repone. Solo pasa a baja tras `absence_days`
-- días sin volver. Antes de tocar nada se confirma con su ficha de MHD (404): el listado por páginas a veces se salta
-- productos. Un registro por producto mientras falta; al volver se cierra (returned_at).
create table public.mhd_missing_products (
  id bigint generated always as identity primary key,
  codigo text not null,
  product_id text not null,
  variant_id text not null,
  inventory_item_id text,
  missing_since timestamptz not null default now(),
  stock_before integer,
  policy_before text,                               -- 'CONTINUE' si se vendía sin stock (se le devuelve al volver)
  cycle_id uuid references public.mhd_sync_cycles(id),
  returned_at timestamptz,
  archived_at timestamptz
);
create unique index mhd_missing_products_open on public.mhd_missing_products (codigo) where returned_at is null and archived_at is null;
create index mhd_missing_products_since on public.mhd_missing_products (missing_since);
alter table public.mhd_missing_products enable row level security;
create policy "Sesión: leer" on public.mhd_missing_products for select to authenticated using (true);
grant select on table public.mhd_missing_products to authenticated;
grant select, insert, update, delete on table public.mhd_missing_products to service_role;

-- Ajustes nuevos en Configuración.
insert into public.store_settings (key, value) values
  ('absence_days', '30'),                           -- días agotado en MHD antes de pasar a baja
  ('absence_brake_pct', '2')                        -- si en una vuelta desaparece más de este % del catálogo, no se toca nada
on conflict (key) do nothing;
