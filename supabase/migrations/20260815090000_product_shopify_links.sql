-- Relación técnica y persistente entre el SKU de Vicente y los identificadores
-- que Shopify exige para precio e inventario. No se vincula con source_products:
-- esa tabla se reemplaza en cada copia de SQL Server y este historial debe
-- sobrevivir a dichas sustituciones.
create table public.product_shopify_links (
  source_sku text primary key,
  link_status text not null check (link_status in ('linked', 'missing_in_shopify', 'ambiguous_in_shopify')),
  shopify_match_count integer not null default 0 check (shopify_match_count >= 0),
  shopify_product_id text unique,
  shopify_variant_id text unique,
  shopify_inventory_item_id text,
  shopify_handle text,
  shopify_status text,
  check (length(trim(source_sku)) > 0),
  check (
    (link_status = 'linked' and shopify_match_count = 1 and shopify_product_id is not null and shopify_variant_id is not null)
    or (link_status = 'missing_in_shopify' and shopify_match_count = 0 and shopify_product_id is null and shopify_variant_id is null)
    or (link_status = 'ambiguous_in_shopify' and shopify_match_count > 1 and shopify_product_id is null and shopify_variant_id is null)
  )
);

create index product_shopify_links_status_idx
  on public.product_shopify_links (link_status);

alter table public.product_shopify_links enable row level security;
revoke all on table public.product_shopify_links from anon, authenticated;
grant select, insert, update, delete on table public.product_shopify_links to service_role;
