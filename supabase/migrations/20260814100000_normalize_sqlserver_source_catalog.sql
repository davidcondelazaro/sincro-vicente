-- Converts one completed SQL Server snapshot into the source_* tables in a
-- single transaction. The raw rows remain available as the latest technical
-- snapshot; if any statement fails, the previous usable catalogue remains.
create or replace function public.replace_source_catalog_from_sqlserver(p_run_id uuid)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_run public.source_sqlserver_import_runs%rowtype;
  v_batch_id uuid;
  v_counts jsonb := '{}'::jsonb;
  v_count integer;
begin
  select * into v_run
  from public.source_sqlserver_import_runs
  where id = p_run_id
  for update;

  if not found then
    raise exception 'No existe la ejecución SQL Server %', p_run_id;
  end if;

  insert into public.source_catalog_batches (source_type, source_name)
  values ('sqlserver', v_run.source_name)
  returning id into v_batch_id;

  if 'ELECTRONICA_VICENTE_B2C_Fabricantes' = any(v_run.table_names) then
    delete from public.source_manufacturers where source_batch_id is not null;
    insert into public.source_manufacturers (id, name, active, image, source_batch_id, loaded_at)
    select payload ->> 'id', coalesce(payload ->> 'Name', payload ->> 'name'),
      case lower(coalesce(payload ->> 'active', '')) when '1' then true when 'true' then true when '0' then false when 'false' then false else null end,
      coalesce(payload ->> 'Image', payload ->> 'image'), v_batch_id, loaded_at
    from public.source_sqlserver_rows
    where import_run_id = p_run_id and source_table = 'ELECTRONICA_VICENTE_B2C_Fabricantes';
    get diagnostics v_count = row_count;
    v_counts := v_counts || jsonb_build_object('manufacturers', v_count);
  end if;

  if 'ELECTRONICA_VICENTE_B2C_Categorias_Web' = any(v_run.table_names) then
    delete from public.source_categories where source_batch_id is not null;
    insert into public.source_categories (id, name, description, metadescription, link_rewrite, id_parent, active, position, source_batch_id, loaded_at)
    select payload ->> 'id', payload ->> 'name', payload ->> 'description', payload ->> 'metadescription', payload ->> 'link_rewrite', payload ->> 'id_parent',
      case lower(coalesce(payload ->> 'active', '')) when '1' then true when 'true' then true when '0' then false when 'false' then false else null end,
      nullif(payload ->> 'position', '')::integer, v_batch_id, loaded_at
    from (
      select distinct on (payload ->> 'id') payload, loaded_at
      from public.source_sqlserver_rows
      where import_run_id = p_run_id and source_table = 'ELECTRONICA_VICENTE_B2C_Categorias_Web'
      order by payload ->> 'id', row_number desc
    ) rows;
    get diagnostics v_count = row_count;
    v_counts := v_counts || jsonb_build_object('categories', v_count);
  end if;

  if 'ELECTRONICA_VICENTE_B2C_Caracteristicas' = any(v_run.table_names) then
    delete from public.source_features where source_batch_id is not null;
    insert into public.source_features (id, name, posicion, propuesta, source_batch_id, loaded_at)
    select payload ->> 'id', payload ->> 'name', nullif(payload ->> 'posicion', '')::integer, payload ->> 'propuesta', v_batch_id, loaded_at
    from public.source_sqlserver_rows
    where import_run_id = p_run_id and source_table = 'ELECTRONICA_VICENTE_B2C_Caracteristicas';
    get diagnostics v_count = row_count;
    v_counts := v_counts || jsonb_build_object('features', v_count);
  end if;

  if 'ELECTRONICA_VICENTE_B2C_CaracteristicasValores' = any(v_run.table_names) then
    delete from public.source_feature_values where source_batch_id is not null;
    insert into public.source_feature_values (id, id_feature, value, source_batch_id, loaded_at)
    select payload ->> 'id', nullif(payload ->> 'id_feature', ''), payload ->> 'Value', v_batch_id, loaded_at
    from public.source_sqlserver_rows
    where import_run_id = p_run_id and source_table = 'ELECTRONICA_VICENTE_B2C_CaracteristicasValores';
    get diagnostics v_count = row_count;
    v_counts := v_counts || jsonb_build_object('feature_values', v_count);
  end if;

  if 'ELECTRONICA_VICENTE_B2C_Productos' = any(v_run.table_names) then
    delete from public.source_products where source_batch_id is not null;
    insert into public.source_products (id, id_manufacturer, id_supplier, id_category_default, id_tax_rules_group, available_for_order, ean13, price, reference, supplier_reference, weight, active, on_sale, date_add, fecha_modificacion, name, description_short, description, images, overlay_energetica, state, available_now, available_later, meta_title, meta_description, link_rewrite, product_features, prioridad, dato_extra, available_date, minimal_quantity, online_only, additional_delivery_times, show_price, fecha_modificacion_imagen, estado_pladisel, visibility, redirect_type, source_batch_id, loaded_at)
    select payload ->> 'id', payload ->> 'id_manufacturer', nullif(payload ->> 'id_supplier', ''), payload ->> 'id_category_default', payload ->> 'id_tax_rules_group',
      case lower(coalesce(payload ->> 'available_for_order', '')) when '1' then true when 'true' then true when '0' then false when 'false' then false else null end,
      payload ->> 'ean13', nullif(payload ->> 'price', '')::numeric, payload ->> 'reference', payload ->> 'supplier_reference', nullif(payload ->> 'weight', '')::numeric,
      case lower(coalesce(payload ->> 'active', '')) when '1' then true when 'true' then true when '0' then false when 'false' then false else null end,
      case lower(coalesce(payload ->> 'on_sale', '')) when '1' then true when 'true' then true when '0' then false when 'false' then false else null end,
      payload ->> 'date_add', payload ->> 'fecha_modificacion', payload ->> 'name', payload ->> 'description_short', payload ->> 'description', payload ->> 'images',
      case lower(coalesce(payload ->> 'overlay_energetica', '')) when '1' then true when 'true' then true when '0' then false when 'false' then false else null end,
      nullif(payload ->> 'state', '')::integer, payload ->> 'available_now', payload ->> 'available_later', payload ->> 'meta_title', payload ->> 'meta_description', payload ->> 'link_rewrite', payload ->> 'product_features', nullif(coalesce(payload ->> 'Prioridad', payload ->> 'prioridad'), '')::integer, payload ->> 'dato_extra', payload ->> 'available_date', nullif(payload ->> 'minimal_quantity', '')::integer,
      case lower(coalesce(payload ->> 'online_only', '')) when '1' then true when 'true' then true when '0' then false when 'false' then false else null end,
      nullif(payload ->> 'additional_delivery_times', '')::integer,
      case lower(coalesce(payload ->> 'show_price', '')) when '1' then true when 'true' then true when '0' then false when 'false' then false else null end,
      payload ->> 'fecha_modificacion_imagen', payload ->> 'estado_pladisel', payload ->> 'visibility', payload ->> 'redirect_type', v_batch_id, loaded_at
    from (
      select distinct on (payload ->> 'id') payload, loaded_at
      from public.source_sqlserver_rows
      where import_run_id = p_run_id and source_table = 'ELECTRONICA_VICENTE_B2C_Productos'
      order by payload ->> 'id', row_number desc
    ) rows;
    get diagnostics v_count = row_count;
    v_counts := v_counts || jsonb_build_object('products', v_count);
  end if;

  if 'ELECTRONICA_VICENTE_B2C_Precios' = any(v_run.table_names) then
    delete from public.source_prices where source_batch_id is not null;
    insert into public.source_prices (id, id_group, id_product, id_cliente, price, fecha_modif, reduction_type, reduction_tax, from_quantity, precio_tarifa, reduction, desde, hasta, source_batch_id, loaded_at)
    select payload ->> 'id', payload ->> 'id_group', payload ->> 'id_product', payload ->> 'id_cliente', nullif(payload ->> 'price', '')::numeric, payload ->> 'fecha_modif', payload ->> 'reduction_type', nullif(payload ->> 'reduction_tax', '')::integer, nullif(payload ->> 'from_quantity', '')::integer, nullif(payload ->> 'Precio_tarifa', '')::numeric, nullif(payload ->> 'reduction', '')::numeric, payload ->> 'Desde', payload ->> 'Hasta', v_batch_id, loaded_at
    from public.source_sqlserver_rows
    where import_run_id = p_run_id and source_table = 'ELECTRONICA_VICENTE_B2C_Precios';
    get diagnostics v_count = row_count;
    v_counts := v_counts || jsonb_build_object('prices', v_count);
  end if;

  if 'ELECTRONICA_VICENTE_B2C_Producto_Relacionados' = any(v_run.table_names) then
    delete from public.source_related_products where source_batch_id is not null;
    insert into public.source_related_products (id, id_product, id_accesory_group, id_accesory, position, fecha_modificacion, source_batch_id, loaded_at)
    select payload ->> 'id', payload ->> 'id_product', nullif(payload ->> 'id_accesory_group', '')::integer, payload ->> 'id_accesory', payload ->> 'position', payload ->> 'fecha_modificacion', v_batch_id, loaded_at
    from (
      select distinct on (payload ->> 'id') payload, loaded_at
      from public.source_sqlserver_rows
      where import_run_id = p_run_id and source_table = 'ELECTRONICA_VICENTE_B2C_Producto_Relacionados'
      order by payload ->> 'id', row_number desc
    ) rows;
    get diagnostics v_count = row_count;
    v_counts := v_counts || jsonb_build_object('related_products', v_count);
  end if;

  if 'ELECTRONICA_VICENTE_B2C_Stocks' = any(v_run.table_names) then
    delete from public.source_stock where source_batch_id is not null;
    insert into public.source_stock (id, id_product, quantity, last_mod_date, source_batch_id, loaded_at)
    select payload ->> 'id', payload ->> 'id_product', nullif(payload ->> 'quantity', '')::integer, payload ->> 'last_mod_date', v_batch_id, loaded_at
    from public.source_sqlserver_rows
    where import_run_id = p_run_id and source_table = 'ELECTRONICA_VICENTE_B2C_Stocks';
    get diagnostics v_count = row_count;
    v_counts := v_counts || jsonb_build_object('stock', v_count);
  end if;

  update public.source_catalog_batches
  set status = 'completed', record_counts = v_counts, completed_at = now()
  where id = v_batch_id;

  return jsonb_build_object('batch_id', v_batch_id, 'record_counts', v_counts);
end;
$$;

revoke all on function public.replace_source_catalog_from_sqlserver(uuid) from public;
grant execute on function public.replace_source_catalog_from_sqlserver(uuid) to service_role;
