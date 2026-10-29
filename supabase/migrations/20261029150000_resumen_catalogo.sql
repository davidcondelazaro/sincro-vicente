-- Estado del catálogo para el resumen por correo e Inicio (2026-10-29): la última lectura del listado de MHD frente a
-- la tienda (espejo de Shopify). Solo cuenta; no decide altas ni bajas (eso lo hará la vuelta, con sus seguros).
create or replace function public.mhd_catalog_overview()
returns jsonb language sql stable security definer set search_path = public as $$
  with run as (select id, last_activity_at from mhd_catalog_import_runs where status = 'completed' and entities @> array['products'] order by last_activity_at desc nulls last limit 1),
  shop as (select v.sku, p.status from shopify_variants v join shopify_products p on p.product_id = v.product_id)
  select jsonb_build_object(
    'read_at', (select last_activity_at from run),
    'in_listing', (select count(*) from mhd_catalog_products c, run where c.last_seen_run_id = run.id),
    'not_in_store', (select count(*) from mhd_catalog_products c, run where c.last_seen_run_id = run.id and not exists (select 1 from shop where shop.sku = c.codigo)),
    'active_missing', (select count(*) from shop join mhd_catalog_products c on c.codigo = shop.sku, run where c.last_seen_run_id is distinct from run.id and shop.status = 'ACTIVE'),
    'active', (select count(*) from shop where status = 'ACTIVE'),
    'draft', (select count(*) from shop where status = 'DRAFT'),
    'archived', (select count(*) from shop where status = 'ARCHIVED'));
$$;
revoke execute on function public.mhd_catalog_overview() from public, anon;
grant execute on function public.mhd_catalog_overview() to authenticated, service_role;
