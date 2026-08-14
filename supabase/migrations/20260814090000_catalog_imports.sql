create extension if not exists pgmq;

create table public.catalog_import_runs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  entity_type text not null check (entity_type in ('manufacturers')),
  filters jsonb not null default '{}'::jsonb,
  status text not null default 'queued' check (status in ('queued', 'running', 'paused', 'stopped', 'completed', 'failed')),
  total_count integer not null default 0 check (total_count >= 0),
  processed_count integer not null default 0 check (processed_count >= 0),
  created_count integer not null default 0 check (created_count >= 0),
  updated_count integer not null default 0 check (updated_count >= 0),
  error_count integer not null default 0 check (error_count >= 0),
  cursor_entity_id text,
  queue_message_id bigint,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.catalog_import_events (
  id bigint generated always as identity primary key,
  run_id uuid not null references public.catalog_import_runs(id) on delete cascade,
  level text not null check (level in ('info', 'success', 'warning', 'error')),
  outcome text not null check (outcome in ('created', 'updated', 'error', 'status')),
  entity_type text not null check (entity_type in ('manufacturers')),
  source_entity_id text,
  source_entity_name text,
  shopify_resource_id text,
  message text not null,
  created_at timestamptz not null default now()
);

create index catalog_import_runs_owner_created_idx on public.catalog_import_runs(owner_id, created_at desc);
create index catalog_import_events_run_created_idx on public.catalog_import_events(run_id, created_at desc);
create unique index catalog_import_one_active_entity_per_owner
  on public.catalog_import_runs(owner_id, entity_type)
  where status in ('queued', 'running', 'paused');
create unique index catalog_import_queue_message_idx
  on public.catalog_import_runs(queue_message_id)
  where queue_message_id is not null;

alter table public.catalog_import_runs enable row level security;
alter table public.catalog_import_events enable row level security;

create policy "Users can read their catalog import runs"
  on public.catalog_import_runs for select to authenticated
  using ((select auth.uid()) = owner_id);
create policy "Users can read their catalog import events"
  on public.catalog_import_events for select to authenticated
  using (exists (
    select 1 from public.catalog_import_runs run
    where run.id = catalog_import_events.run_id
      and run.owner_id = (select auth.uid())
  ));

alter table public.catalog_import_runs replica identity full;
alter table public.catalog_import_events replica identity full;
alter publication supabase_realtime add table public.catalog_import_runs;
alter publication supabase_realtime add table public.catalog_import_events;

select pgmq.create('catalog_import_jobs');

create or replace function public.start_catalog_import(p_entity_type text, p_filters jsonb default '{}'::jsonb)
returns public.catalog_import_runs
language plpgsql
security definer
set search_path = pg_catalog, public, pgmq
as $$
declare
  v_owner_id uuid := (select auth.uid());
  v_filters jsonb := coalesce(p_filters, '{}'::jsonb);
  v_total integer;
  v_run public.catalog_import_runs;
  v_message_id bigint;
begin
  if v_owner_id is null then raise exception 'Necesitas iniciar sesión'; end if;
  if p_entity_type <> 'manufacturers' then raise exception 'Entidad no disponible'; end if;
  if jsonb_typeof(v_filters) <> 'object' then raise exception 'Filtros no válidos'; end if;

  select count(*) into v_total
  from public.source_manufacturers manufacturer
  where (coalesce((v_filters ->> 'onlyActive')::boolean, true) is false or manufacturer.active is true)
    and (nullif(v_filters ->> 'manufacturerId', '') is null or manufacturer.id = v_filters ->> 'manufacturerId')
    and (nullif(v_filters ->> 'name', '') is null or manufacturer.name ilike '%' || (v_filters ->> 'name') || '%');
  if v_total = 0 then raise exception 'No hay marcas para el criterio indicado'; end if;

  insert into public.catalog_import_runs (owner_id, entity_type, filters, total_count)
  values (v_owner_id, p_entity_type, v_filters, v_total)
  returning * into v_run;

  select * into v_message_id from pgmq.send('catalog_import_jobs', jsonb_build_object('run_id', v_run.id));
  update public.catalog_import_runs set queue_message_id = v_message_id where id = v_run.id returning * into v_run;
  return v_run;
end;
$$;

create or replace function public.read_catalog_import_message()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pgmq
as $$
declare v_message jsonb;
begin
  if coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role' then raise exception 'Acceso no autorizado'; end if;
  select to_jsonb(message_record) into v_message from pgmq.read('catalog_import_jobs', 300, 1) as message_record limit 1;
  return v_message;
end;
$$;

create or replace function public.archive_catalog_import_message(p_message_id bigint)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, pgmq
as $$
begin
  if coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role' then raise exception 'Acceso no autorizado'; end if;
  return pgmq.archive('catalog_import_jobs', p_message_id);
end;
$$;

create or replace function public.set_catalog_import_status(p_run_id uuid, p_status text)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public, pgmq
as $$
declare v_owner_id uuid; v_status text; v_message_id bigint; v_message text;
begin
  select owner_id, status, queue_message_id into v_owner_id, v_status, v_message_id
  from public.catalog_import_runs where id = p_run_id for update;
  if not found or v_owner_id <> (select auth.uid()) then raise exception 'Ejecución no autorizada'; end if;
  if p_status = 'paused' and v_status in ('queued', 'running') then
    update public.catalog_import_runs set status = 'paused', updated_at = now() where id = p_run_id;
    v_message := 'Importación pausada por el usuario.';
  elsif p_status = 'stopped' and v_status in ('queued', 'running', 'paused') then
    update public.catalog_import_runs set status = 'stopped', finished_at = now(), updated_at = now() where id = p_run_id;
    if v_message_id is not null then perform pgmq.archive('catalog_import_jobs', v_message_id); end if;
    v_message := 'Importación detenida por el usuario.';
  elsif p_status = 'queued' and v_status = 'paused' then
    update public.catalog_import_runs set status = 'queued', updated_at = now() where id = p_run_id;
    if v_message_id is not null then perform pgmq.set_vt('catalog_import_jobs', v_message_id, 0); end if;
    v_message := 'Importación reanudada por el usuario.';
  else
    raise exception 'Cambio de estado no permitido';
  end if;
  insert into public.catalog_import_events (run_id, level, outcome, entity_type, message)
  values (p_run_id, 'info', 'status', (select entity_type from public.catalog_import_runs where id = p_run_id), v_message);
  return p_status;
end;
$$;

revoke all on function public.start_catalog_import(text, jsonb) from public, anon;
grant execute on function public.start_catalog_import(text, jsonb) to authenticated;
revoke all on function public.read_catalog_import_message() from public, anon, authenticated;
grant execute on function public.read_catalog_import_message() to service_role;
revoke all on function public.archive_catalog_import_message(bigint) from public, anon, authenticated;
grant execute on function public.archive_catalog_import_message(bigint) to service_role;
revoke all on function public.set_catalog_import_status(uuid, text) from public, anon;
grant execute on function public.set_catalog_import_status(uuid, text) to authenticated;
