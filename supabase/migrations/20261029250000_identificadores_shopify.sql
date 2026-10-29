-- Identificadores de cada extremo (David, 2026-10-29: «en cualquier conector ERP-tienda tener el ID de cada extremo
-- siempre ha sumado»). Sustituye al espejo de la tienda (docs/ESPEJO_TIENDA_SHOPIFY.md): una fila por código de MHD con
-- su producto, variante y artículo de inventario en Shopify, la dirección y el EAN, y el estado y el título que les
-- pone el importador. La escribe quien escribe en Shopify (la subida, el archivado de duplicados); no se refresca.
-- Lo puntual (si un alta ya existe por EAN, si una dirección está libre) se pregunta a Shopify en el momento.
create table public.store_shopify_ids (
  codigo text primary key,                         -- código de MHD = SKU en Shopify
  product_id text not null,
  variant_id text not null,
  inventory_item_id text,
  handle text,
  ean text,
  status text,                                     -- ACTIVE, DRAFT o ARCHIVED, según lo último que hicimos nosotros
  title text,
  updated_at timestamptz not null default now()
);
create index store_shopify_ids_product on public.store_shopify_ids (product_id);
create index store_shopify_ids_ean on public.store_shopify_ids (ean);
create index store_shopify_ids_handle on public.store_shopify_ids (handle);
alter table public.store_shopify_ids enable row level security;
create policy "Sesión: leer" on public.store_shopify_ids for select to authenticated using (true);
grant select on table public.store_shopify_ids to authenticated;
grant select, insert, update, delete on table public.store_shopify_ids to service_role;

-- Carga inicial desde el espejo (refrescado el 29-10 a las 16:41 y al día con cada subida): los productos cuyo SKU es
-- un código de MHD. Con SKU repetido, el activo; si no, el borrador; y entre iguales, el más reciente.
insert into public.store_shopify_ids (codigo, product_id, variant_id, inventory_item_id, handle, ean, status, title)
select distinct on (v.sku) v.sku, v.product_id, v.variant_id, v.inventory_item_id, p.handle, v.barcode, p.status, p.title
from shopify_variants v join shopify_products p on p.product_id = v.product_id
where exists (select 1 from mhd_catalog_products c where c.codigo = v.sku)
order by v.sku, case p.status when 'ACTIVE' then 0 when 'DRAFT' then 1 else 2 end, p.shopify_created_at desc;
