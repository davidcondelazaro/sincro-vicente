-- Productos: modo incremental/forzado y candidatos de alta.
create or replace function public.start_catalog_import(p_entity_type text, p_filters jsonb default '{}'::jsonb)
returns public.catalog_import_runs
language plpgsql security definer set search_path = pg_catalog, public, pgmq
as $$
declare
  v_owner_id uuid := (select auth.uid());
  v_filters jsonb := coalesce(p_filters, '{}'::jsonb);
  v_total integer;
  v_run public.catalog_import_runs;
  v_message_id bigint;
  v_queue_name text := case when p_entity_type='icecat' then 'icecat_import_jobs' when p_entity_type='priorities' then 'priority_import_jobs' else 'catalog_import_jobs' end;
  v_product_mode text;
begin
  if v_owner_id is null then raise exception 'Necesitas iniciar sesión'; end if;
  if p_entity_type not in ('manufacturers','categories','features','products','priorities','icecat') then raise exception 'Entidad no disponible'; end if;
  if jsonb_typeof(v_filters) <> 'object' then raise exception 'Filtros no válidos'; end if;
  if p_entity_type='products' then
    v_product_mode := coalesce(nullif(v_filters->>'productSyncMode',''),'changes');
    if v_product_mode not in ('changes','all') then raise exception 'El modo de productos no es válido'; end if;
    v_filters := v_filters || jsonb_build_object('productSyncMode',v_product_mode,'onlyActive',true);
  end if;
  if p_entity_type='manufacturers' then
    select count(*) into v_total from public.source_manufacturers x where (coalesce((v_filters->>'onlyActive')::boolean,true) is false or x.active is true) and (nullif(v_filters->>'manufacturerId','') is null or x.id=v_filters->>'manufacturerId');
  elsif p_entity_type='categories' then
    select count(*) into v_total from public.source_categories x where nullif(v_filters->>'categoryId','') is null or x.id=v_filters->>'categoryId';
  elsif p_entity_type='features' then
    select count(*) into v_total from public.source_features x where x.id not in ('10603','10604','10606','10607','10608','10609','10593','10454','10421','10419','10420','10530','10543','10428','PORTESGRATIS','DESCATALOGADO','OFERTA','SUPEROFERTA','PRECIOOCULTO','PRIORIDAD','ALTOBULTO','ANCHOBULTO','LARGOBULTO','VOLUMEN','PESOBRUTO','ALTO','ANCHO','LARGO','PESONETO') and (nullif(v_filters->>'featureId','') is null or x.id=v_filters->>'featureId');
  elsif p_entity_type='products' then
    select count(*) into v_total from public.source_products x left join public.product_shopify_links l on l.source_sku=x.id
      where x.active is true and (v_product_mode='all' or x.shopify_synced is false or l.source_sku is null or l.link_status <> 'linked')
        and ((jsonb_typeof(v_filters->'productIds')='array' and x.id in (select jsonb_array_elements_text(v_filters->'productIds'))) or (coalesce(jsonb_typeof(v_filters->'productIds'),'')<>'array' and (nullif(v_filters->>'productId','') is null or x.id=v_filters->>'productId')))
        and (nullif(v_filters->>'modifiedSince','') is null or x.fecha_modificacion::date >= (v_filters->>'modifiedSince')::date);
  elsif p_entity_type='priorities' then v_total := 1;
  else
    if jsonb_typeof(v_filters->'productIds')='array' or jsonb_typeof(v_filters->'eans')='array' then select coalesce(jsonb_array_length(v_filters->'productIds'),0)+coalesce(jsonb_array_length(v_filters->'eans'),0) into v_total;
    else select count(*) into v_total from public.source_products x where nullif(trim(x.ean13),'') is not null; end if;
  end if;
  if v_total=0 and p_entity_type<>'priorities' then raise exception 'No hay registros para el criterio indicado'; end if;
  insert into public.catalog_import_runs(owner_id,entity_type,filters,total_count,queue_name) values(v_owner_id,p_entity_type,v_filters,v_total,v_queue_name) returning * into v_run;
  select * into v_message_id from pgmq.send(v_queue_name,jsonb_build_object('run_id',v_run.id));
  update public.catalog_import_runs set queue_message_id=v_message_id where id=v_run.id returning * into v_run;
  return v_run;
end; $$;
