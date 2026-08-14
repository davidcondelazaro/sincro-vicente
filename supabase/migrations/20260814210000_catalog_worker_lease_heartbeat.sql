-- Evita que dos invocaciones procesen la misma ejecución y deja constancia
-- de qué entidad/operación estaba en curso cuando una llamada se atasca.
alter table public.catalog_import_runs
  add column if not exists worker_token uuid,
  add column if not exists heartbeat_at timestamptz,
  add column if not exists current_entity_id text,
  add column if not exists current_entity_name text,
  add column if not exists current_operation text;

create or replace function public.claim_catalog_import_worker(p_run_id uuid, p_worker_token uuid)
returns boolean
language plpgsql security definer
set search_path = pg_catalog, public
as $$
begin
  if coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role' then
    raise exception 'Acceso no autorizado';
  end if;
  update public.catalog_import_runs
  set status = 'running',
      worker_token = p_worker_token,
      heartbeat_at = now(),
      started_at = coalesce(started_at, now()),
      updated_at = now()
  where id = p_run_id
    and status in ('queued', 'running')
    and (worker_token is null or worker_token = p_worker_token or heartbeat_at is null or heartbeat_at < now() - interval '2 minutes');
  return found;
end;
$$;

create or replace function public.heartbeat_catalog_import_worker(
  p_run_id uuid,
  p_worker_token uuid,
  p_entity_id text default null,
  p_entity_name text default null,
  p_operation text default null
)
returns boolean
language plpgsql security definer
set search_path = pg_catalog, public
as $$
begin
  if coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role' then
    raise exception 'Acceso no autorizado';
  end if;
  update public.catalog_import_runs
  set heartbeat_at = now(),
      current_entity_id = p_entity_id,
      current_entity_name = p_entity_name,
      current_operation = p_operation,
      updated_at = now()
  where id = p_run_id and worker_token = p_worker_token and status = 'running';
  return found;
end;
$$;

create or replace function public.release_catalog_import_worker(p_run_id uuid, p_worker_token uuid)
returns boolean
language plpgsql security definer
set search_path = pg_catalog, public
as $$
begin
  if coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role' then
    raise exception 'Acceso no autorizado';
  end if;
  update public.catalog_import_runs
  set worker_token = null, heartbeat_at = null, current_entity_id = null,
      current_entity_name = null, current_operation = null, updated_at = now()
  where id = p_run_id and worker_token = p_worker_token;
  return found;
end;
$$;

create or replace function public.renew_import_queue_message(p_queue_name text, p_message_id bigint, p_visibility_timeout integer default 300)
returns boolean
language plpgsql security definer
set search_path = pg_catalog, public, pgmq
as $$
begin
  if coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role' then
    raise exception 'Acceso no autorizado';
  end if;
  if p_queue_name not in ('catalog_import_jobs', 'icecat_import_jobs', 'priority_import_jobs') then
    raise exception 'Cola no válida';
  end if;
  return pgmq.set_vt(p_queue_name, p_message_id, greatest(0, least(p_visibility_timeout, 900)));
end;
$$;

revoke all on function public.claim_catalog_import_worker(uuid, uuid) from public, anon, authenticated;
revoke all on function public.heartbeat_catalog_import_worker(uuid, uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.release_catalog_import_worker(uuid, uuid) from public, anon, authenticated;
revoke all on function public.renew_import_queue_message(text, bigint, integer) from public, anon, authenticated;
grant execute on function public.claim_catalog_import_worker(uuid, uuid) to service_role;
grant execute on function public.heartbeat_catalog_import_worker(uuid, uuid, text, text, text) to service_role;
grant execute on function public.release_catalog_import_worker(uuid, uuid) to service_role;
grant execute on function public.renew_import_queue_message(text, bigint, integer) to service_role;
