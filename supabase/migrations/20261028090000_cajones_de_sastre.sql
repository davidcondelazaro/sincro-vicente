-- Cajones de sastre de MHD (David, 2026-10-28). Algunas subfamilias de MHD mezclan productos de tipos distintos: la
-- S2501 «Accesorios Informáticos y Videojuegos» trae armarios rack, alfombrillas, docks, cajas de disco… y con la
-- equivalencia de una a una todo acababa en «Armarios rack y accesorios de red». Ahora la categoría de Icecat del
-- producto puede mandar sobre la subfamilia (store_icecat_category_map): en toda la tienda si la fila no tiene
-- subfamilia (alfombrillas, docks, tóner…) o solo dentro de una subfamilia si la tiene (lo ambiguo, como «Tarjetas de
-- red»). En los cajones de sastre (`per_product`), una categoría que no está en la tabla, o no tener Icecat, deja el
-- producto en la familia de la subfamilia, en borrador y a revisión. Ver docs/IMPORTADOR_PRODUCTOS_MHD.md.
alter table public.store_mhd_subfamily_map add column per_product boolean not null default false;
comment on column public.store_mhd_subfamily_map.per_product is 'Cajón de sastre: la familia sale de store_icecat_category_map por producto; collection_handle queda de respaldo.';

create table public.store_icecat_category_map (
  id bigint generated always as identity primary key,
  icecat_category text not null,                    -- GeneralInfo.Category.Name.Value de Icecat, en español
  mhd_subfamily_code text,                          -- null: en toda la tienda; con valor: solo en esa subfamilia de MHD
  collection_handle text not null references public.store_collections (handle),
  note text,
  updated_at timestamptz not null default now()
);
create unique index store_icecat_category_map_key on public.store_icecat_category_map (icecat_category, coalesce(mhd_subfamily_code, ''));

alter table public.store_icecat_category_map enable row level security;
create policy "Sesión: todo" on public.store_icecat_category_map for all to authenticated using (true) with check (true);
grant select, insert, update, delete on table public.store_icecat_category_map to authenticated, service_role;
