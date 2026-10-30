-- Espejo de la tienda retirado (David, 2026-10-30; docs/IDENTIFICADORES_SHOPIFY.md). Ningún código, función, vista ni
-- tarea lo usa: los identificadores viven en store_shopify_ids y lo demás se pregunta a Shopify. Sin cascade a propósito:
-- si algo dependiera de estas tablas, la migración fallaría en vez de llevárselo por delante.
drop table public.shopify_variants;
drop table public.shopify_products;
drop table public.shopify_collections;
drop table public.shopify_mirror_runs;
