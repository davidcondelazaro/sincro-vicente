-- Las consultas de la base pasan del espejo de la tienda a los identificadores de cada extremo (store_shopify_ids,
-- 2026-10-29). Mismo resultado; ya no dependen de refrescar el espejo.
create or replace function public.mhd_price_stock_changes(p_run uuid, p_limit integer default 50000)
returns table (codigo text, product_id text, variant_id text, inventory_item_id text, price numeric, stock integer, sent_price numeric, sent_stock integer)
language sql stable security definer set search_path = public as $$
  select i.codigo, i.product_id, i.variant_id, i.inventory_item_id,
         round(c.pvp, 2), greatest(0, trunc(c.stock))::integer, s.price, s.stock
  from store_shopify_ids i
  join mhd_catalog_products c on c.codigo = i.codigo and c.last_seen_run_id = p_run
  left join mhd_shopify_price_stock s on s.codigo = i.codigo
  where c.pvp > 0 and i.inventory_item_id is not null and i.status in ('ACTIVE', 'DRAFT')
    and (s.codigo is null or s.price is distinct from round(c.pvp, 2) or s.stock is distinct from greatest(0, trunc(c.stock))::integer)
  limit p_limit;
$$;

create or replace function public.mhd_absence_candidates(p_run uuid)
returns table (codigo text, product_id text, variant_id text, inventory_item_id text, product_status text)
language sql stable security definer set search_path = public as $$
  select i.codigo, i.product_id, i.variant_id, i.inventory_item_id, i.status
  from store_shopify_ids i join mhd_catalog_products c on c.codigo = i.codigo
  where i.status in ('ACTIVE', 'DRAFT') and c.last_seen_run_id is distinct from p_run
    and not exists (select 1 from mhd_missing_products m where m.codigo = i.codigo and m.returned_at is null and m.archived_at is null)
  order by i.codigo;
$$;

create or replace function public.mhd_new_products(p_run uuid)
returns table (codigo text, family_code text, motivo text)
language sql stable security definer set search_path = public as $$
  select c.codigo, c.cod_familia,
         case when last.status is null then 'nuevo' else 'fotos nuevas' end
  from mhd_catalog_products c
  left join lateral (select r.status, r.created_at from mhd_importer_product_runs r where r.codigo = c.codigo order by r.created_at desc limit 1) last on true
  where c.last_seen_run_id = p_run
    and not exists (select 1 from store_shopify_ids i where i.codigo = c.codigo)
    and exists (select 1 from mhd_importer_family_profiles f where f.family_code = c.cod_familia)
    and exists (select 1 from store_mhd_subfamily_map m where m.mhd_subfamily_code = c.cod_subfamilia)
    and not exists (select 1 from store_product_locks l where l.codigo = c.codigo)
    and not exists (select 1 from mhd_importer_job_items i join mhd_importer_jobs j on j.id = i.job_id
                     where i.codigo = c.codigo and i.status in ('pendiente', 'en_curso') and j.status in ('en_cola', 'en_curso', 'pausado'))
    and (last.status is null
         or (last.status = 'discarded' and exists (select 1 from mhd_importer_job_items i where i.codigo = c.codigo and i.status = 'descartado' and i.error like 'Sin imagen%')
             and c.imagenes_cambiadas_en > last.created_at));
$$;

create or replace function public.mhd_catalog_overview()
returns jsonb language sql stable security definer set search_path = public as $$
  with run as (select id, last_activity_at from mhd_catalog_import_runs where status = 'completed' and entities @> array['products'] order by last_activity_at desc nulls last limit 1)
  select jsonb_build_object(
    'read_at', (select last_activity_at from run),
    'in_listing', (select count(*) from mhd_catalog_products c, run where c.last_seen_run_id = run.id),
    'not_in_store', (select count(*) from mhd_catalog_products c, run where c.last_seen_run_id = run.id and not exists (select 1 from store_shopify_ids i where i.codigo = c.codigo)),
    'active_missing', (select count(*) from store_shopify_ids i join mhd_catalog_products c on c.codigo = i.codigo, run where c.last_seen_run_id is distinct from run.id and i.status = 'ACTIVE'),
    'active', (select count(*) from store_shopify_ids where status = 'ACTIVE'),
    'draft', (select count(*) from store_shopify_ids where status = 'DRAFT'),
    'archived', (select count(*) from store_shopify_ids where status = 'ARCHIVED'));
$$;

create or replace function public.mhd_sync_report(p_since timestamptz)
returns jsonb language sql stable security definer set search_path = public as $$
  with ev as (select kind, codigo, (detail ->> 'antes')::numeric antes, (detail ->> 'ahora')::numeric ahora
                from mhd_sync_events where sync = 'precio-stock' and kind in ('precio', 'stock') and created_at >= p_since),
  prices as (select * from ev where kind = 'precio'),
  stock as (select * from ev where kind = 'stock'),
  titled as (select e.*, i.title, i.product_id from ev e left join store_shopify_ids i on i.codigo = e.codigo),
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
      'flips', (select coalesce(jsonb_agg(x), '[]') from (select e.codigo, max(i.title) title, max(i.product_id) product_id, count(*) n,
                  string_agg(e.antes::text || ' → ' || e.ahora::text, ' · ' order by e.created_at) path
                  from mhd_sync_events e0 cross join lateral (select e0.codigo, (e0.detail ->> 'antes')::numeric antes, (e0.detail ->> 'ahora')::numeric ahora, e0.created_at) e
                  left join store_shopify_ids i on i.codigo = e.codigo
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

create or replace function public.mhd_absence_report(p_since timestamptz)
returns jsonb language sql stable security definer set search_path = public as $$
  with days as (select coalesce((select (value #>> '{}')::int from store_settings where key = 'absence_days'), 30) n),
  ev as (select e.kind, e.codigo, e.detail, e.created_at, i.title, i.product_id
           from mhd_sync_events e left join store_shopify_ids i on i.codigo = e.codigo
          where e.sync = 'agotados' and e.created_at >= p_since),
  open as (select m.*, i.title from mhd_missing_products m left join store_shopify_ids i on i.codigo = m.codigo where m.returned_at is null and m.archived_at is null)
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
