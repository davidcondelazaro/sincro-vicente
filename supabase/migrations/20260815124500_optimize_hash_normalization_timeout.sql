create or replace function public.capture_source_hash_previous()
returns trigger language plpgsql set search_path = public, pg_temp
as $$
begin
  if to_regclass('pg_temp.source_hash_previous') is null then
    execute 'create temporary table source_hash_previous (entity text not null, id text not null, source_hash text, shopify_synced boolean not null, primary key (entity, id)) on commit drop';
  end if;
  insert into pg_temp.source_hash_previous (entity, id, source_hash, shopify_synced)
  values (tg_table_name, old.id::text, old.source_hash, old.shopify_synced)
  on conflict (entity, id) do update set source_hash = excluded.source_hash, shopify_synced = excluded.shopify_synced;
  return old;
end;
$$;

alter function public.replace_source_catalog_from_sqlserver(uuid) set statement_timeout = '120s';
