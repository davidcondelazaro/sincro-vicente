-- Similares por familia: impresoras, auriculares y relojes (2026-11-15, publicados sin revisión previa: David, «puedes publicar sin mi revisión»).
-- similar-recipes.ts hasta que David revise la muestra.
create or replace function public.mhd_similar_source()
returns table (pid text, t text, title text, pvp numeric, stock numeric, marca text, f jsonb)
language sql stable security definer set search_path = public set statement_timeout = '120s' as $$
  select s.product_id, s.product_type, s.title, coalesce(ps.price, c.pvp)::numeric, coalesce(ps.stock, 0)::numeric, c.nombre_marca, r.result->'filters'
  from store_shopify_ids s
  join mhd_catalog_products c on c.codigo = s.codigo
  left join mhd_shopify_price_stock ps on ps.codigo = s.codigo
  left join lateral (
    select result from mhd_importer_product_runs
    where codigo = s.codigo and status = 'ok' and result ? 'filters'
    order by created_at desc limit 1
  ) r on true
  where s.status = 'ACTIVE' and s.product_type in ('Lavadoras', 'Frigoríficos combi', 'Lavavajillas', 'Hornos', 'Televisores', 'Secadoras', 'Campanas extractoras', 'Portátiles', 'Monitores', 'Ordenadores de sobremesa',
    'Placas de inducción', 'Placas de gas', 'Placas vitrocerámicas', 'Microondas', 'Microondas integrables', 'Frigoríficos de 1 puerta', 'Frigoríficos de 2 puertas', 'Frigoríficos americanos y side by side', 'Congeladores verticales', 'Arcones congeladores',
    'Impresoras', 'Auriculares', 'Smartwatches')
  order by s.product_id;
$$;
