-- Histórico de lo que cambia en el listado de MHD (David, 2026-10-30; docs/SINCRONIZACIONES_MHD.md). La lectura sobrescribe
-- la fila de cada producto y las huellas solo dicen que algo cambió: esto guarda qué campo y su valor antes y ahora.
-- Solo los campos distintos de los productos que cambian. El stock va aparte (mhd_sync_events) y no entra.
create table public.mhd_catalog_product_history (
  id bigint generated always as identity primary key,
  codigo text not null,
  changed_at timestamptz not null default now(),
  run_id uuid,
  changes jsonb not null
);
create index mhd_catalog_product_history_codigo on public.mhd_catalog_product_history (codigo);
create index mhd_catalog_product_history_changed_at on public.mhd_catalog_product_history (changed_at);
alter table public.mhd_catalog_product_history enable row level security;
revoke all on table public.mhd_catalog_product_history from public, anon, authenticated;
grant select, insert on table public.mhd_catalog_product_history to service_role;

-- Si esto fallara, se pierde esa fila del histórico, nunca la lectura de MHD.
create function public.mhd_keep_product_history() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_changes jsonb;
begin
  select jsonb_object_agg(k.key, jsonb_build_object('antes', old.source_payload -> k.key, 'ahora', new.source_payload -> k.key))
  into v_changes
  from (select jsonb_object_keys(old.source_payload) as key union select jsonb_object_keys(new.source_payload)) k
  where k.key not in ('stock', 'fecha_modificacion_producto', 'fecha_modificacion_precio', 'fecha_modificacion_stock')
    and (old.source_payload -> k.key) is distinct from (new.source_payload -> k.key);
  if v_changes is not null then
    insert into public.mhd_catalog_product_history (codigo, run_id, changes) values (new.codigo, new.last_seen_run_id, v_changes);
  end if;
  return null;
exception when others then
  raise warning 'Histórico de MHD, %: %', new.codigo, sqlerrm;
  return null;
end; $$;
revoke all on function public.mhd_keep_product_history() from public, anon, authenticated;

create trigger mhd_catalog_products_history after update of source_payload on public.mhd_catalog_products
for each row when (old.hash_contenido is distinct from new.hash_contenido or old.hash_imagenes is distinct from new.hash_imagenes or old.hash_precio is distinct from new.hash_precio)
execute function public.mhd_keep_product_history();
