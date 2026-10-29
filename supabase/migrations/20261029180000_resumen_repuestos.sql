-- Resumen: «repuestos» solo los que estaban a 0 (no los que pasan de «sin dato» a tener stock, como en la primera
-- puesta al día del 2026-10-29, que contaba 22.596).
create or replace function public.mhd_sync_report(p_since timestamptz)
returns jsonb language sql stable security definer set search_path = public as $$
  with ev as (select kind, codigo, (detail ->> 'antes')::numeric antes, (detail ->> 'ahora')::numeric ahora
                from mhd_sync_events where sync = 'precio-stock' and kind in ('precio', 'stock') and created_at >= p_since),
  prices as (select * from ev where kind = 'precio'),
  stock as (select * from ev where kind = 'stock'),
  titled as (select e.*, p.title, p.product_id from ev e left join shopify_variants v on v.sku = e.codigo left join shopify_products p on p.product_id = v.product_id),
  madrid as (select (date_trunc('day', now() at time zone 'Europe/Madrid') at time zone 'Europe/Madrid') day_start,
                    (date_trunc('month', now() at time zone 'Europe/Madrid') at time zone 'Europe/Madrid') month_start)
  select jsonb_build_object(
    'prices', jsonb_build_object(
      'total', (select count(*) from prices),
      'up', (select count(*) from prices where ahora > antes),
      'down', (select count(*) from prices where ahora < antes),
      'big', (select count(*) from prices where antes > 0 and abs(ahora - antes) / antes > 0.3),
      'top', (select coalesce(jsonb_agg(x order by abs(x.pct) desc), '[]') from (select * from (select distinct on (codigo) codigo, title, product_id, antes, ahora, round(100 * (ahora - antes) / nullif(antes, 0)) pct
                from titled where kind = 'precio' and antes is not null order by codigo, abs(ahora - antes) / nullif(antes, 0) desc nulls last) d
                where d.pct is not null order by abs(d.pct) desc limit 15) x),
      'flips', (select coalesce(jsonb_agg(x), '[]') from (select e.codigo, max(p.title) title, max(p.product_id) product_id, count(*) n,
                  string_agg(e.antes::text || ' → ' || e.ahora::text, ' · ' order by e.created_at) path
                  from mhd_sync_events e0 cross join lateral (select e0.codigo, (e0.detail ->> 'antes')::numeric antes, (e0.detail ->> 'ahora')::numeric ahora, e0.created_at) e
                  left join shopify_variants v on v.sku = e.codigo left join shopify_products p on p.product_id = v.product_id
                  where e0.sync = 'precio-stock' and e0.kind = 'precio' and e0.created_at >= p_since
                  group by e.codigo having count(*) > 1 order by count(*) desc limit 10) x)),
    'stock', jsonb_build_object(
      'total', (select count(*) from stock),
      'out', (select count(*) from stock where ahora = 0 and coalesce(antes, 0) > 0),
      'back', (select count(*) from stock where antes = 0 and ahora > 0),
      'out_list', (select coalesce(jsonb_agg(x), '[]') from (select codigo, title, product_id, antes from titled where kind = 'stock' and ahora = 0 and coalesce(antes, 0) > 0 order by antes desc limit 10) x)),
    'importer', jsonb_build_object(
      'by_status', (select coalesce(jsonb_object_agg(status, n), '{}') from (select status, count(*) n from mhd_importer_job_items where finished_at >= p_since group by status) x),
      'reasons', (select coalesce(jsonb_agg(x), '[]') from (select status, left(coalesce(error, 'sin motivo'), 140) reason, count(*) n, (array_agg(codigo))[1:5] codigos
                    from mhd_importer_job_items where finished_at >= p_since and status in ('descartado', 'error') group by 1, 2 order by n desc limit 8) x),
      'open_jobs', (select coalesce(jsonb_agg(x), '[]') from (select j.id, j.title, j.status, j.paused_reason,
                      count(*) total, count(*) filter (where i.status in ('ok', 'descartado', 'error')) done, count(*) filter (where i.status = 'error') errors
                    from mhd_importer_jobs j join mhd_importer_job_items i on i.job_id = j.id
                    where j.status not in ('terminado', 'cancelado') group by j.id) x)),
    'ai_cost', jsonb_build_object(
      'period', (select coalesce(sum(cost_usd), 0) from mhd_importer_job_items where finished_at >= p_since),
      'today', (select coalesce(sum(cost_usd), 0) from mhd_importer_job_items, madrid where finished_at >= madrid.day_start),
      'month', (select coalesce(sum(cost_usd), 0) from mhd_importer_job_items, madrid where finished_at >= madrid.month_start)),
    'review', jsonb_build_object(
      'pending', (select count(*) from mhd_importer_review_queue where pending),
      'reasons', (select coalesce(jsonb_agg(x), '[]') from (select left(r.reason, 140) reason, count(*) n from mhd_importer_review_queue q, jsonb_array_elements_text(q.reasons) r(reason)
                    where q.pending group by 1 order by 2 desc limit 6) x)));
$$;
revoke execute on function public.mhd_sync_report(timestamptz) from public, anon;
grant execute on function public.mhd_sync_report(timestamptz) to authenticated, service_role;
