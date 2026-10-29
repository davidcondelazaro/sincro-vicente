-- Tipo de producto en los identificadores (2026-10-29): es la familia del árbol que le pone el importador. Lo usa el
-- cuadro de garantías para contar productos activos por familia (antes lo leía del espejo). Contar por la subfamilia de
-- MHD no vale: los productos colocados por reglas caen en otra familia.
alter table public.store_shopify_ids add column product_type text;
update public.store_shopify_ids i set product_type = nullif(p.product_type, '') from public.shopify_products p where p.product_id = i.product_id;
