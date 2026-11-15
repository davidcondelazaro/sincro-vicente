-- Complementos de placas y cocinas con su menaje (2026-11-15, David: «sí, empieza por placas»). Placas, cocinas,
-- hornillos y módulos, y sartenes, ollas, baterías y paelleras: en estas familias `a` trae los filtros del importador
-- (las listas unidas por comas), no las características de Icecat.
create or replace function public.mhd_complements_source()
returns table (pid text, t text, title text, pvp numeric, stock numeric, marca text, txt text, a jsonb)
language sql stable security definer set search_path = public set statement_timeout = '120s' as $$
  with p as materialized (
    select s.ean, s.product_id pid, s.product_type t, s.title, coalesce(ps.stock, 0)::numeric stock, c.pvp::numeric pvp, c.nombre_marca marca, c.descripcion_ampliada txt
    from store_shopify_ids s join mhd_catalog_products c on c.codigo = s.codigo left join mhd_shopify_price_stock ps on ps.codigo = s.codigo
    where s.status = 'ACTIVE' and s.product_type in ('Televisores','Portátiles','Monitores','Soportes de TV y monitor','Barras de sonido','Cables','Regletas','Fundas y maletines para portátiles','Mochilas para portátiles','Ratones','Bases y replicadores de puertos','Packs de teclado y ratón','Limpieza para electrónica')
      and (s.product_type <> 'Cables' or s.title ~* 'hdmi|displayport')),
  f as materialized (
    select p.ean, ft->'Feature'->'Name'->>'Value' n, ft->>'PresentationValue' v
    from p join mhd_importer_source_cache c on c.source = 'icecat' and c.source_key = p.ean,
      jsonb_array_elements(case when jsonb_typeof(c.payload->'data'->'FeaturesGroups') = 'array' then c.payload->'data'->'FeaturesGroups' else '[]' end) g,
      jsonb_array_elements(case when jsonb_typeof(g->'Features') = 'array' then g->'Features' else '[]' end) ft),
  pv as materialized (select ean, jsonb_object_agg(n, v) a from (select distinct on (ean, n) ean, n, v from f where n is not null) z group by 1),
  cocina as (
    select s.product_id pid, s.product_type t, s.title, coalesce(ps.price, c.pvp)::numeric pvp, coalesce(ps.stock, 0)::numeric stock, c.nombre_marca marca, c.descripcion_ampliada txt,
      (select jsonb_object_agg(k, case when jsonb_typeof(v) = 'array' then to_jsonb((select string_agg(e, ', ') from jsonb_array_elements_text(v) e)) else to_jsonb(v #>> '{}') end)
       from jsonb_each(case when jsonb_typeof(r.result->'filters') = 'object' then r.result->'filters' else '{}' end) x(k, v)) a
    from store_shopify_ids s join mhd_catalog_products c on c.codigo = s.codigo left join mhd_shopify_price_stock ps on ps.codigo = s.codigo
    left join lateral (
      select result from mhd_importer_product_runs
      where codigo = s.codigo and status = 'ok' and result ? 'filters'
      order by created_at desc limit 1
    ) r on true
    where s.status = 'ACTIVE' and s.product_type in ('Placas de inducción','Placas vitrocerámicas','Placas de gas','Cocinas de gas y eléctricas','Hornillos','Módulos de integración',
      'Sartenes','Ollas, cacerolas y cazos','Baterías de cocina','Paelleras'))
  select * from (
    select p.pid, p.t, p.title, p.pvp, p.stock, p.marca, p.txt, pv.a from p left join pv using (ean)
    union all
    select pid, t, title, pvp, stock, marca, txt, a from cocina) z
  order by pid;
$$;
revoke execute on function public.mhd_complements_source() from public, anon, authenticated;
grant execute on function public.mhd_complements_source() to service_role;
