-- Familia elegida a mano para un producto concreto (David, 2026-10-28). Manda sobre todo lo demás en la colocación en
-- el árbol (store_icecat_category_map, recolocaciones y store_mhd_subfamily_map): para productos sueltos que no se
-- pueden colocar por regla, como los accesorios del cajón de sastre S2501 que no tienen Icecat.
create table public.store_product_family_overrides (
  codigo text primary key,                          -- código de MHD
  collection_handle text not null references public.store_collections (handle),
  note text,
  updated_at timestamptz not null default now()
);

alter table public.store_product_family_overrides enable row level security;
create policy "Sesión: todo" on public.store_product_family_overrides for all to authenticated using (true) with check (true);
grant select, insert, update, delete on table public.store_product_family_overrides to authenticated, service_role;
