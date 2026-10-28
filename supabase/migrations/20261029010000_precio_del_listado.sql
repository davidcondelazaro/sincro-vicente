-- El precio de la tienda es el `pvp` del listado de productos de MHD (David, 2026-10-29): es la tarifa de nuestra web.
-- El de /prices es otra tarifa (la de la web de MHD), que MHD tiene que cambiar. La sincronización compara ese precio y el
-- stock de /stocks con lo último enviado. Precio: del listado leído en las últimas 3 horas; stock: de la lectura dada.
create or replace function public.mhd_price_stock_changes(p_run uuid, p_limit integer default 50000)
returns table (codigo text, product_id text, variant_id text, inventory_item_id text, price numeric, stock integer, sent_price numeric, sent_stock integer)
language sql stable security definer set search_path = public as $$
  with uploaded as (
    select distinct on (r.codigo) r.codigo, r.shopify_product_id
    from mhd_importer_product_runs r where r.status = 'ok' and r.shopify_product_id is not null
    order by r.codigo, r.created_at desc)
  select u.codigo, v.product_id, v.variant_id, v.inventory_item_id,
         round(c.pvp, 2), greatest(0, trunc(st.stock))::integer, s.price, s.stock
  from uploaded u
  join shopify_variants v on v.sku = u.codigo and v.product_id = u.shopify_product_id
  join mhd_catalog_products c on c.codigo = u.codigo and c.last_seen_at > now() - interval '3 hours'
  join mhd_catalog_stock st on st.codigo = u.codigo and st.last_seen_run_id = p_run
  left join mhd_shopify_price_stock s on s.codigo = u.codigo
  where c.pvp > 0 and v.inventory_item_id is not null
    and (s.codigo is null or s.price is distinct from round(c.pvp, 2) or s.stock is distinct from greatest(0, trunc(st.stock))::integer)
  limit p_limit;
$$;
