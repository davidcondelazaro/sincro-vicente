-- La comparación de todo el catálogo tardaba 7,5 s por llamada y superaba el límite de 8 s: pasa a hacerse por tramos de códigos.
drop function public.mhd_delivery_options_changes(uuid, integer);

create function public.mhd_delivery_options_changes(p_run uuid, p_codigos text[])
returns table (codigo text, product_id text, options jsonb, sent jsonb)
language sql stable security definer set search_path = public as $$
  select i.codigo, i.product_id, public.mhd_delivery_options(c.source_payload), s.options
  from store_shopify_ids i
  join mhd_catalog_products c on c.codigo = i.codigo and c.last_seen_run_id = p_run
  left join mhd_shopify_delivery_options s on s.codigo = i.codigo
  where i.codigo = any(p_codigos) and i.status in ('ACTIVE', 'DRAFT') and s.options is distinct from public.mhd_delivery_options(c.source_payload);
$$;
revoke execute on function public.mhd_delivery_options_changes(uuid, text[]) from public, anon, authenticated;
grant execute on function public.mhd_delivery_options_changes(uuid, text[]) to service_role;
