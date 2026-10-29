-- Vueltas de sincronización encadenadas (David, 2026-10-29; diseño en docs/SINCRONIZACIONES_MHD.md). Un solo reloj:
-- cada 30 minutos pg_cron abre una vuelta (mhd_sync_cycle_start) y avisa a la app, que comprueba las conexiones y
-- lanza la lectura del listado de MHD. Al terminar la lectura, la base vuelve a avisar a la app (disparador) y esta
-- hace los pasos siguientes en orden. Cada paso queda en `steps` con su inicio, fin, cifras y error.

create table public.mhd_sync_cycles (
  id uuid primary key default gen_random_uuid(),
  trigger text not null default 'programada',        -- 'programada' o 'manual'
  status text not null default 'iniciando',          -- iniciando, leyendo, procesando, terminada, fallida, parada, atascada
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  read_run_id uuid references public.mhd_catalog_import_runs(id),
  steps jsonb not null default '[]'::jsonb,          -- [{ name, started_at, finished_at, status, counts, error }]
  error text
);
create index mhd_sync_cycles_started on public.mhd_sync_cycles (started_at desc);
create index mhd_sync_cycles_read on public.mhd_sync_cycles (read_run_id);
alter table public.mhd_sync_cycles enable row level security;
create policy "Sesión: leer" on public.mhd_sync_cycles for select to authenticated using (true);
grant select on table public.mhd_sync_cycles to authenticated;
grant select, insert, update, delete on table public.mhd_sync_cycles to service_role;

-- Aviso a la app para el paso que toca de una vuelta. Con la clave de las lecturas de MHD (Vault), que la ruta comprueba.
create or replace function public.mhd_sync_call(p_cycle uuid, p_step text)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  perform net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'sincro_vicente_app_url') || '/api/sincronizaciones/vuelta',
    body := jsonb_build_object('cycle', p_cycle, 'step', p_step),
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-mhd-import-token', (select decrypted_secret from vault.decrypted_secrets where name = 'mhd_catalog_import_token')),
    timeout_milliseconds := 10000);
end; $$;
revoke execute on function public.mhd_sync_call(uuid, text) from public, anon, authenticated;
grant execute on function public.mhd_sync_call(uuid, text) to service_role;

-- Abre una vuelta. Una sola a la vez: si la anterior lleva menos de 25 minutos sin acabar, esta se salta; si lleva
-- más, se da por atascada (la app avisa al abrir la siguiente).
create or replace function public.mhd_sync_cycle_start(p_trigger text default 'programada')
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if exists (select 1 from mhd_sync_cycles where status in ('iniciando', 'leyendo', 'procesando') and started_at > now() - interval '25 minutes') then
    return null;
  end if;
  update mhd_sync_cycles set status = 'atascada', finished_at = now(), error = coalesce(error, 'Sin terminar a los 25 minutos.')
   where status in ('iniciando', 'leyendo', 'procesando');
  insert into mhd_sync_cycles (trigger) values (p_trigger) returning id into v_id;
  perform mhd_sync_call(v_id, 'inicio');
  return v_id;
end; $$;
revoke execute on function public.mhd_sync_cycle_start(text) from public, anon;
grant execute on function public.mhd_sync_cycle_start(text) to authenticated, service_role;

-- Al terminar la lectura de una vuelta (bien o mal), la base avisa a la app para seguir.
create or replace function public.mhd_sync_on_read_finished()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_cycle uuid;
begin
  for v_cycle in select id from mhd_sync_cycles where read_run_id = new.id and status = 'leyendo' loop
    perform mhd_sync_call(v_cycle, 'continuar');
  end loop;
  return new;
end; $$;
create trigger mhd_sync_read_finished after update of status on public.mhd_catalog_import_runs
  for each row when (old.status = 'running' and new.status in ('completed', 'failed', 'discarded'))
  execute function public.mhd_sync_on_read_finished();

-- Precio y stock salen ahora los dos del listado (David, 2026-10-29): /prices coincide con el listado desde que MHD lo
-- corrigió y /stocks solo difiere en lo que cambia mientras se lee. Ambos de la lectura dada.
create or replace function public.mhd_price_stock_changes(p_run uuid, p_limit integer default 50000)
returns table (codigo text, product_id text, variant_id text, inventory_item_id text, price numeric, stock integer, sent_price numeric, sent_stock integer)
language sql stable security definer set search_path = public as $$
  with uploaded as (
    select distinct on (r.codigo) r.codigo, r.shopify_product_id
    from mhd_importer_product_runs r where r.status = 'ok' and r.shopify_product_id is not null
    order by r.codigo, r.created_at desc)
  select u.codigo, v.product_id, v.variant_id, v.inventory_item_id,
         round(c.pvp, 2), greatest(0, trunc(c.stock))::integer, s.price, s.stock
  from uploaded u
  join shopify_variants v on v.sku = u.codigo and v.product_id = u.shopify_product_id
  join mhd_catalog_products c on c.codigo = u.codigo and c.last_seen_run_id = p_run
  left join mhd_shopify_price_stock s on s.codigo = u.codigo
  where c.pvp > 0 and v.inventory_item_id is not null
    and (s.codigo is null or s.price is distinct from round(c.pvp, 2) or s.stock is distinct from greatest(0, trunc(c.stock))::integer)
  limit p_limit;
$$;
