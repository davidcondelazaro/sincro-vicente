-- Importación de pedidos históricos de PrestaShop a Shopify, con el mismo esquema que la de clientes:
-- una ejecución, su lista de pedidos, sus eventos y una cola pgmq que trabaja por tandas.
create table public.order_import_runs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  mode text not null check (mode in ('all', 'references', 'retry_errors')),
  parameters jsonb not null default '{}'::jsonb,
  status text not null default 'queued' check (status in ('queued', 'running', 'paused', 'stopped', 'completed', 'failed')),
  total_count integer not null default 0 check (total_count >= 0),
  processed_count integer not null default 0 check (processed_count >= 0),
  created_count integer not null default 0 check (created_count >= 0),
  existing_count integer not null default 0 check (existing_count >= 0),
  error_count integer not null default 0 check (error_count >= 0),
  warning_count integer not null default 0 check (warning_count >= 0),
  cursor_order_id bigint,
  queue_message_id bigint,
  consecutive_failures integer not null default 0 check (consecutive_failures >= 0),
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.order_import_queue (
  run_id uuid not null references public.order_import_runs(id) on delete cascade,
  prestashop_order_id bigint not null,
  primary key (run_id, prestashop_order_id)
);
create table public.order_import_events (
  id bigint generated always as identity primary key,
  run_id uuid not null references public.order_import_runs(id) on delete cascade,
  level text not null check (level in ('info', 'success', 'warning', 'error')),
  outcome text not null check (outcome in ('created', 'existing', 'error', 'status')),
  prestashop_order_id bigint,
  order_reference text,
  shopify_order_id text,
  message text not null,
  created_at timestamptz not null default now()
);
create index order_import_runs_owner_created_idx on public.order_import_runs(owner_id, created_at desc);
create index order_import_events_run_created_idx on public.order_import_events(run_id, created_at desc);
create unique index order_import_one_active_per_owner on public.order_import_runs (owner_id) where status in ('queued', 'running', 'paused');

alter table public.order_import_runs enable row level security;
alter table public.order_import_queue enable row level security;
alter table public.order_import_events enable row level security;
create policy "Users can read their order import runs" on public.order_import_runs for select to authenticated
  using ((select auth.uid()) = owner_id);
create policy "Users can create their order import runs" on public.order_import_runs for insert to authenticated
  with check ((select auth.uid()) = owner_id);
create policy "Users can fill their order import queue" on public.order_import_queue for insert to authenticated
  with check (exists (select 1 from public.order_import_runs run where run.id = order_import_queue.run_id and run.owner_id = (select auth.uid()) and run.status = 'queued' and run.queue_message_id is null));
create policy "Users can read their order import events" on public.order_import_events for select to authenticated
  using (exists (select 1 from public.order_import_runs run where run.id = order_import_events.run_id and run.owner_id = (select auth.uid())));
alter table public.order_import_runs replica identity full;
alter table public.order_import_events replica identity full;
alter publication supabase_realtime add table public.order_import_runs;
alter publication supabase_realtime add table public.order_import_events;

select pgmq.create('order_import_jobs');
create or replace function public.enqueue_order_import(p_run_id uuid)
returns bigint language plpgsql security definer set search_path = pg_catalog, public, pgmq as $$
declare v_owner_id uuid; v_status text; v_message_id bigint;
begin
  select owner_id, status, queue_message_id into v_owner_id, v_status, v_message_id from public.order_import_runs where id = p_run_id for update;
  if not found or v_owner_id <> (select auth.uid()) then raise exception 'Ejecución no autorizada'; end if;
  if v_status <> 'queued' then raise exception 'La ejecución no está en cola'; end if;
  if v_message_id is not null then return v_message_id; end if;
  select * into v_message_id from pgmq.send('order_import_jobs', jsonb_build_object('run_id', p_run_id));
  update public.order_import_runs set queue_message_id = v_message_id where id = p_run_id;
  return v_message_id;
end;
$$;
create or replace function public.read_order_import_message()
returns jsonb language plpgsql security definer set search_path = pg_catalog, public, pgmq as $$
declare v_message jsonb;
begin
  if coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role' then raise exception 'Acceso no autorizado'; end if;
  select to_jsonb(message_record) into v_message from pgmq.read('order_import_jobs', 300, 1) as message_record limit 1;
  return v_message;
end;
$$;
create or replace function public.archive_order_import_message(p_message_id bigint)
returns boolean language plpgsql security definer set search_path = pg_catalog, public, pgmq as $$
begin
  if coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role' then raise exception 'Acceso no autorizado'; end if;
  return pgmq.archive('order_import_jobs', p_message_id);
end;
$$;
create or replace function public.release_order_import_job(p_message_id bigint, p_delay_seconds integer default 0)
returns boolean language plpgsql security definer set search_path = pg_catalog, public, pgmq as $$
begin
  if coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role' then raise exception 'Acceso no autorizado'; end if;
  perform pgmq.set_vt('order_import_jobs', p_message_id, greatest(p_delay_seconds, 0));
  return true;
end;
$$;
create or replace function public.set_order_import_status(p_run_id uuid, p_status text)
returns text language plpgsql security definer set search_path = pg_catalog, public, pgmq as $$
declare v_owner_id uuid; v_status text; v_message_id bigint; v_message text;
begin
  select owner_id, status, queue_message_id into v_owner_id, v_status, v_message_id from public.order_import_runs where id = p_run_id for update;
  if not found or v_owner_id <> (select auth.uid()) then raise exception 'Ejecución no autorizada'; end if;
  if p_status = 'paused' and v_status in ('queued', 'running') then
    update public.order_import_runs set status = 'paused', updated_at = now() where id = p_run_id;
    v_message := 'Importación pausada por el usuario.';
  elsif p_status = 'stopped' and v_status in ('queued', 'running', 'paused') then
    update public.order_import_runs set status = 'stopped', finished_at = now(), updated_at = now() where id = p_run_id;
    if v_message_id is not null then perform pgmq.archive('order_import_jobs', v_message_id); end if;
    v_message := 'Importación detenida por el usuario.';
  elsif p_status = 'queued' and v_status = 'paused' then
    update public.order_import_runs set status = 'queued', updated_at = now() where id = p_run_id;
    if v_message_id is not null then perform pgmq.set_vt('order_import_jobs', v_message_id, 0); end if;
    v_message := 'Importación reanudada por el usuario.';
  else
    raise exception 'Cambio de estado no permitido';
  end if;
  insert into public.order_import_events (run_id, level, outcome, message) values (p_run_id, 'info', 'status', v_message);
  return p_status;
end;
$$;
revoke all on function public.enqueue_order_import(uuid) from public, anon;
grant execute on function public.enqueue_order_import(uuid) to authenticated;
revoke all on function public.set_order_import_status(uuid, text) from public, anon;
grant execute on function public.set_order_import_status(uuid, text) to authenticated;
revoke all on function public.read_order_import_message() from public, anon, authenticated;
revoke all on function public.archive_order_import_message(bigint) from public, anon, authenticated;
revoke all on function public.release_order_import_job(bigint, integer) from public, anon, authenticated;
grant execute on function public.read_order_import_message() to service_role;
grant execute on function public.archive_order_import_message(bigint) to service_role;
grant execute on function public.release_order_import_job(bigint, integer) to service_role;

-- Cada minuto: sin una ejecución en cola, la función responde vacía y no toca nada.
select cron.unschedule(jobid) from cron.job where jobname = 'sincro-vicente-order-import-worker';
select cron.schedule(
  'sincro-vicente-order-import-worker',
  '* * * * *',
  $$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'sincro_vicente_project_url') || '/functions/v1/sync-prestashop-orders',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'sincro_vicente_publishable_key')
      ),
      body := '{}'::jsonb
    );
  $$
);
