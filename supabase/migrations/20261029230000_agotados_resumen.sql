-- Agotados en MHD para el resumen por correo e Inicio (2026-10-29): agotados y repuestos del periodo (con su título),
-- los que siguen fuera, los que pasan ya de los días acordados (pendientes de baja), los que están a punto (5 días o
-- menos) y los que la lectura se saltó (existían en MHD aunque no vinieran en el listado).
create or replace function public.mhd_absence_report(p_since timestamptz)
returns jsonb language sql stable security definer set search_path = public as $$
  with days as (select coalesce((select (value #>> '{}')::int from store_settings where key = 'absence_days'), 30) n),
  ev as (select e.kind, e.codigo, e.detail, e.created_at, p.title, p.product_id
           from mhd_sync_events e left join shopify_variants v on v.sku = e.codigo left join shopify_products p on p.product_id = v.product_id
          where e.sync = 'agotados' and e.created_at >= p_since),
  open as (select m.*, p.title from mhd_missing_products m left join shopify_products p on p.product_id = m.product_id where m.returned_at is null and m.archived_at is null)
  select jsonb_build_object(
    'days', (select n from days),
    'out', (select count(*) from ev where kind = 'agotado'),
    'out_selling', (select count(*) from ev where kind = 'agotado' and (detail ->> 'vendia_sin_stock')::boolean),
    'out_list', (select coalesce(jsonb_agg(x), '[]') from (select codigo, title, product_id from ev where kind = 'agotado' order by created_at desc limit 10) x),
    'back', (select count(*) from ev where kind = 'repuesto'),
    'back_list', (select coalesce(jsonb_agg(x), '[]') from (select codigo, title, product_id from ev where kind = 'repuesto' order by created_at desc limit 10) x),
    'open', (select count(*) from open),
    'due', (select count(*) from open, days where missing_since < now() - make_interval(days => days.n)),
    'near', (select count(*) from open, days where missing_since >= now() - make_interval(days => days.n) and missing_since < now() - make_interval(days => days.n - 5)),
    'due_list', (select coalesce(jsonb_agg(x), '[]') from (select codigo, title, product_id, missing_since from open, days where missing_since < now() - make_interval(days => days.n) order by missing_since limit 15) x),
    'skipped_by_read', (select coalesce(sum((s ->> 'skippedByRead')::int), 0) from mhd_sync_cycles c, jsonb_array_elements(c.steps) st, lateral (select st -> 'counts' s) z where c.started_at >= p_since and st ->> 'name' = 'agotados'));
$$;
revoke execute on function public.mhd_absence_report(timestamptz) from public, anon;
grant execute on function public.mhd_absence_report(timestamptz) to authenticated, service_role;
