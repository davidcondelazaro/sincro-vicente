alter table public.price_stock_import_runs drop constraint if exists price_stock_import_runs_mode_check;
alter table public.price_stock_import_runs add constraint price_stock_import_runs_mode_check check (mode in ('changes', 'all', 'selective', 'partial'));

create or replace function public.next_price_stock_import_source_row(p_run_id uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public
as $$ declare v_run public.price_stock_import_runs; v_ids text[]; begin
  if coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role' then raise exception 'Acceso no autorizado'; end if;
  select * into v_run from public.price_stock_import_runs where id = p_run_id;
  if not found then return null; end if;
  v_ids := array(select jsonb_array_elements_text(coalesce(v_run.filters -> 'productIds', '[]'::jsonb)));
  if v_run.import_type = 'prices' then
    return (select jsonb_build_object('id', source.id, 'id_product', source.id_product, 'precio_tarifa', source.precio_tarifa, 'fecha_modif', source.fecha_modif, 'product_price', product.price, 'shopify_product_id', link.shopify_product_id, 'shopify_variant_id', link.shopify_variant_id)
      from public.source_prices source
      join public.source_products product on product.id = source.id_product and product.active is true
      join public.product_shopify_links link on link.source_sku = source.id_product and link.link_status = 'linked'
      where (v_run.cursor_source_id is null or source.id > v_run.cursor_source_id)
        and (v_run.mode <> 'selective' or source.id_product = any(v_ids))
        and (v_run.mode <> 'partial' or source.fecha_modif >= to_char((v_run.filters ->> 'changedSince')::timestamptz at time zone 'Europe/Madrid','YYYY-MM-DD HH24:MI:SS.MS'))
        and (v_run.mode <> 'changes' or source.shopify_synced is false)
      order by source.id limit 1);
  end if;
  return (select jsonb_build_object('id',source.id,'id_product',source.id_product,'quantity',source.quantity,'last_mod_date',source.last_mod_date,'available_for_order',product.available_for_order)
    from public.source_stock source join public.source_products product on product.id=source.id_product
    where (v_run.cursor_source_id is null or source.id > v_run.cursor_source_id)
      and (v_run.mode <> 'selective' or source.id_product = any(v_ids))
      and (v_run.mode <> 'partial' or source.last_mod_date >= to_char((v_run.filters ->> 'changedSince')::timestamptz at time zone 'Europe/Madrid','YYYY-MM-DD HH24:MI:SS.MS'))
    order by source.id limit 1);
end; $$;
