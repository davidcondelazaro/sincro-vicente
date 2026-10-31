-- Datos de las recetas de complementos (David, 2026-10-31; docs/SINCRONIZACIONES_MHD.md): productos activos de las
-- familias con receta, stock real de la tienda y características de Icecat de aparatos y soportes.
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
  pv as materialized (select ean, jsonb_object_agg(n, v) a from (select distinct on (ean, n) ean, n, v from f where n is not null) z group by 1)
  select p.pid, p.t, p.title, p.pvp, p.stock, p.marca, p.txt, pv.a from p left join pv using (ean) order by p.pid;
$$;
revoke execute on function public.mhd_complements_source() from public, anon, authenticated;
grant execute on function public.mhd_complements_source() to service_role;
