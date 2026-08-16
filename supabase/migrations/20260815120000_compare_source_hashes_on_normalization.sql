create or replace function public.capture_source_hash_previous()
returns trigger language plpgsql set search_path = public, pg_temp
as $$
begin
  execute 'create temporary table if not exists source_hash_previous (entity text not null, id text not null, source_hash text, shopify_synced boolean not null, primary key (entity, id)) on commit drop';
  insert into pg_temp.source_hash_previous (entity, id, source_hash, shopify_synced)
  values (tg_table_name, old.id::text, old.source_hash, old.shopify_synced)
  on conflict (entity, id) do update set source_hash = excluded.source_hash, shopify_synced = excluded.shopify_synced;
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
begin
  if new.source_hash is null and v_source_table is not null then
    select row_hash into new.source_hash from public.source_sqlserver_rows
    where source_table = v_source_table and payload ->> 'id' = new.id::text and loaded_at = new.loaded_at
    order by row_number desc limit 1;
  end if;
  if new.source_hash is null or to_regclass('pg_temp.source_hash_previous') is null then return new; end if;
  select source_hash, shopify_synced into v_previous_hash, v_previous_synced
  from pg_temp.source_hash_previous where entity = tg_table_name and id = new.id::text;
  new.source_changed := v_previous_hash is distinct from new.source_hash;
  new.shopify_synced := case when new.source_changed then false else coalesce(v_previous_synced, true) end;
  return new;
end;
$$;

do $$
declare v_table text;
begin
  foreach v_table in array array['source_manufacturers','source_categories','source_features','source_feature_values','source_products','source_prices','source_related_products','source_stock'] loop
    execute format('drop trigger if exists %I on public.%I', v_table || '_capture_hash', v_table);
    execute format('drop trigger if exists %I on public.%I', v_table || '_apply_hash', v_table);
    execute format('create trigger %I before delete on public.%I for each row execute function public.capture_source_hash_previous()', v_table || '_capture_hash', v_table);
    execute format('create trigger %I before insert on public.%I for each row execute function public.apply_source_hash_change_state()', v_table || '_apply_hash', v_table);
  end loop;
end $$;
