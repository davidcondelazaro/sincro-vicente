-- Este trigger se aplica a todas las tablas source_*. Los dos campos de
-- imágenes sólo existen en source_products, por lo que se leen desde la
-- representación JSON del registro anterior para evitar referenciarlos en
-- categorías, precios, stock y el resto de entidades.
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
    case when tg_table_name = 'source_products' then to_jsonb(old) ->> 'fecha_modificacion_imagen' end,
    case when tg_table_name = 'source_products' then coalesce((to_jsonb(old) ->> 'images_sync_pending')::boolean, false) else false end
  )
  on conflict (entity, id) do update set
    source_hash = excluded.source_hash,
    shopify_synced = excluded.shopify_synced,
    image_modified = excluded.image_modified,
    images_sync_pending = excluded.images_sync_pending;

  return old;
end;
$$;
