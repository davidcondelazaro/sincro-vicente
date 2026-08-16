alter table public.price_stock_import_runs drop constraint if exists price_stock_import_runs_mode_check;
alter table public.price_stock_import_runs add constraint price_stock_import_runs_mode_check check (mode in ('changes', 'all', 'selective', 'partial'));

create or replace function public.start_price_stock_import(p_import_type text, p_mode text, p_filters jsonb default '{}'::jsonb)
returns public.price_stock_import_runs
language plpgsql security definer set search_path = pg_catalog, public, pgmq
as $$
declare v_owner_id uuid := (select auth.uid()); v_filters jsonb := coalesce(p_filters, '{}'::jsonb); v_since timestamptz; v_total integer; v_run public.price_stock_import_runs; v_message_id bigint; v_ids text[]; v_queue text;
begin
  if v_owner_id is null then raise exception 'Necesitas iniciar sesión'; end if;
  if p_import_type not in ('prices','stock') then raise exception 'Tipo de importación no válido'; end if;
  if p_mode not in ('changes','all','selective','partial') then raise exception 'Modo de importación no válido'; end if;
  v_ids := array(select jsonb_array_elements_text(coalesce(v_filters->'productIds','[]'::jsonb)));
  if p_mode='selective' and coalesce(array_length(v_ids,1),0)=0 then raise exception 'Indica al menos un ID de producto'; end if;
  if p_mode='partial' then
    select started_at into v_since from public.price_stock_import_runs where import_type=p_import_type and mode in ('all','partial') and status='completed' order by started_at desc limit 1;
    if v_since is null then raise exception 'Antes de una actualización parcial debes finalizar una completa o parcial'; end if;
    v_filters := v_filters || jsonb_build_object('changedSince',v_since);
  end if;
  if p_import_type='prices' then
    select count(*) into v_total from public.source_prices s join public.source_products p on p.id=s.id_product and p.active is true join public.product_shopify_links l on l.source_sku=s.id_product and l.link_status='linked' where (p_mode<>'changes' or s.shopify_synced is false) and (p_mode<>'selective' or s.id_product=any(v_ids)) and (p_mode<>'partial' or s.fecha_modif>=to_char(v_since at time zone 'Europe/Madrid','YYYY-MM-DD HH24:MI:SS.MS'));
    v_queue := 'price_import_jobs';
  else
    select count(*) into v_total from public.source_stock s join public.source_products p on p.id=s.id_product and p.active is true join public.product_shopify_links l on l.source_sku=s.id_product and l.link_status='linked' and l.shopify_inventory_item_id is not null where (p_mode<>'changes' or s.shopify_synced is false) and (p_mode<>'selective' or s.id_product=any(v_ids)) and (p_mode<>'partial' or s.last_mod_date>=to_char(v_since at time zone 'Europe/Madrid','YYYY-MM-DD HH24:MI:SS.MS'));
    v_queue := 'stock_import_jobs';
  end if;
  if v_total=0 then raise exception 'No hay registros válidos para el criterio indicado'; end if;
  insert into public.price_stock_import_runs(owner_id,import_type,mode,filters,total_count) values(v_owner_id,p_import_type,p_mode,v_filters,v_total) returning * into v_run;
  select * into v_message_id from pgmq.send(v_queue,jsonb_build_object('run_id',v_run.id));
  update public.price_stock_import_runs set queue_message_id=v_message_id where id=v_run.id returning * into v_run;
  return v_run;
end; $$;

create or replace function public.next_price_stock_import_source_row(p_run_id uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public
as $$ declare v_run public.price_stock_import_runs; v_ids text[]; begin
  if coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role' then raise exception 'Acceso no autorizado'; end if;
  select * into v_run from public.price_stock_import_runs where id = p_run_id; if not found then return null; end if;
  v_ids := array(select jsonb_array_elements_text(coalesce(v_run.filters -> 'productIds', '[]'::jsonb)));
  if v_run.import_type = 'prices' then
    return (select jsonb_build_object('id',source.id,'id_product',source.id_product,'precio_tarifa',source.precio_tarifa,'fecha_modif',source.fecha_modif,'product_price',product.price,'shopify_product_id',link.shopify_product_id,'shopify_variant_id',link.shopify_variant_id)
      from public.source_prices source join public.source_products product on product.id=source.id_product and product.active is true join public.product_shopify_links link on link.source_sku=source.id_product and link.link_status='linked'
      where (v_run.cursor_source_id is null or source.id>v_run.cursor_source_id) and (v_run.mode<>'selective' or source.id_product=any(v_ids)) and (v_run.mode<>'partial' or source.fecha_modif>=to_char((v_run.filters->>'changedSince')::timestamptz at time zone 'Europe/Madrid','YYYY-MM-DD HH24:MI:SS.MS')) and (v_run.mode<>'changes' or source.shopify_synced is false) order by source.id limit 1);
  end if;
  return (select jsonb_build_object('id',source.id,'id_product',source.id_product,'quantity',source.quantity,'last_mod_date',source.last_mod_date,'available_for_order',product.available_for_order,'shopify_product_id',link.shopify_product_id,'shopify_variant_id',link.shopify_variant_id,'shopify_inventory_item_id',link.shopify_inventory_item_id)
    from public.source_stock source join public.source_products product on product.id=source.id_product and product.active is true join public.product_shopify_links link on link.source_sku=source.id_product and link.link_status='linked' and link.shopify_inventory_item_id is not null
    where (v_run.cursor_source_id is null or source.id>v_run.cursor_source_id) and (v_run.mode<>'selective' or source.id_product=any(v_ids)) and (v_run.mode<>'partial' or source.last_mod_date>=to_char((v_run.filters->>'changedSince')::timestamptz at time zone 'Europe/Madrid','YYYY-MM-DD HH24:MI:SS.MS')) and (v_run.mode<>'changes' or source.shopify_synced is false) order by source.id limit 1);
end; $$;
