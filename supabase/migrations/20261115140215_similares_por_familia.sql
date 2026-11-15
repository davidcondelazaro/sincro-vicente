-- Similares por familia (David, 2026-11-15; docs/SINCRONIZACIONES_MHD.md): datos para calcular los relacionados de
-- Search & Discovery por reglas («lo más parecido a lo que está viendo»). Productos activos de las familias con regla,
-- precio y stock enviados a la tienda y los filtros de la última subida correcta del importador.
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
  where s.status = 'ACTIVE' and s.product_type in ('Lavadoras')
  order by s.product_id;
$$;
revoke execute on function public.mhd_similar_source() from public, anon, authenticated;
grant execute on function public.mhd_similar_source() to service_role;
