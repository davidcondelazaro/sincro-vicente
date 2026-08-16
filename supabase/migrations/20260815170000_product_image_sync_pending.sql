alter table public.source_products
  add column if not exists images_sync_pending boolean not null default false;

create or replace function public.capture_source_hash_previous()
returns trigger language plpgsql set search_path = public, pg_temp
as $$
begin
  if to_regclass('pg_temp.source_hash_previous') is null then
    execute 'create temporary table source_hash_previous (entity text not null, id text not null, source_hash text, shopify_synced boolean not null, image_modified text, images_sync_pending boolean not null default false, primary key (entity, id)) on commit drop';
  end if;
  insert into pg_temp.source_hash_previous (entity, id, source_hash, shopify_synced, image_modified, images_sync_pending)
  values (
    tg_table_name,
    old.id::text,
    old.source_hash,
    old.shopify_synced,
    case when tg_table_name = 'source_products' then old.fecha_modificacion_imagen::text end,
    case when tg_table_name = 'source_products' then old.images_sync_pending else false end
  )
  on conflict (entity, id) do update set
    source_hash = excluded.source_hash,
    shopify_synced = excluded.shopify_synced,
    image_modified = excluded.image_modified,
    images_sync_pending = excluded.images_sync_pending;
  return old;
end;
$$;

create or replace function public.apply_source_hash_change_state()
returns trigger language plpgsql set search_path = public, pg_temp
as $$
declare
  v_source_table text := case tg_table_name
    when 'source_manufacturers' then 'ELECTRONICA_VICENTE_B2C_Fabricantes'
    when 'source_categories' then 'ELECTRONICA_VICENTE_B2C_Categorias_Web'
    when 'source_features' then 'ELECTRONICA_VICENTE_B2C_Caracteristicas'
    when 'source_feature_values' then 'ELECTRONICA_VICENTE_B2C_CaracteristicasValores'
    when 'source_products' then 'ELECTRONICA_VICENTE_B2C_Productos'
    when 'source_prices' then 'ELECTRONICA_VICENTE_B2C_Precios'
    when 'source_related_products' then 'ELECTRONICA_VICENTE_B2C_Producto_Relacionados'
    when 'source_stock' then 'ELECTRONICA_VICENTE_B2C_Stocks'
  end;
  v_previous_hash text;
  v_previous_synced boolean;
  v_previous_image_modified text;
  v_previous_images_pending boolean;
begin
  if new.source_hash is null and v_source_table is not null then
    select row_hash into new.source_hash from public.source_sqlserver_rows
    where source_table = v_source_table and payload ->> 'id' = new.id::text and loaded_at = new.loaded_at
    order by row_number desc limit 1;
  end if;
  if new.source_hash is null or to_regclass('pg_temp.source_hash_previous') is null then return new; end if;
  select source_hash, shopify_synced, image_modified, images_sync_pending
    into v_previous_hash, v_previous_synced, v_previous_image_modified, v_previous_images_pending
  from pg_temp.source_hash_previous where entity = tg_table_name and id = new.id::text;
  new.source_changed := v_previous_hash is distinct from new.source_hash;
  new.shopify_synced := case when new.source_changed then false else coalesce(v_previous_synced, true) end;
  if tg_table_name = 'source_products' then
    new.images_sync_pending := case
      when v_previous_image_modified is distinct from new.fecha_modificacion_imagen::text then true
      else coalesce(v_previous_images_pending, false)
    end;
  end if;
  return new;
end;
$$;

update public.source_products set images_sync_pending = false;
