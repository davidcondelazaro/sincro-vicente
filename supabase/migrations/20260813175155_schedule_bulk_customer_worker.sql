create unique index customer_import_one_active_per_owner
  on public.customer_import_runs (owner_id)
  where status in ('queued', 'running', 'paused');

create unique index customer_import_queue_message_idx
  on public.customer_import_runs (queue_message_id)
  where queue_message_id is not null;

create or replace function public.enqueue_customer_import(p_run_id uuid)
returns bigint
language plpgsql
security definer
set search_path = pg_catalog, public, pgmq
as $$
declare
  v_owner_id uuid;
  v_status text;
  v_message_id bigint;
begin
  select owner_id, status, queue_message_id into v_owner_id, v_status, v_message_id
  from public.customer_import_runs where id = p_run_id for update;
  if not found or v_owner_id <> (select auth.uid()) then raise exception 'Ejecución no autorizada'; end if;
  if v_status <> 'queued' then raise exception 'La ejecución no está en cola'; end if;
  if v_message_id is not null then return v_message_id; end if;
  select * into v_message_id from pgmq.send('customer_import_jobs', jsonb_build_object('run_id', p_run_id));
  update public.customer_import_runs set queue_message_id = v_message_id where id = p_run_id;
  return v_message_id;
end;
$$;

create or replace function public.read_customer_import_message()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pgmq
as $$
declare v_message jsonb;
begin
  if coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role' then raise exception 'Acceso no autorizado'; end if;
  select to_jsonb(message_record) into v_message from pgmq.read('customer_import_jobs', 300, 1) as message_record limit 1;
  return v_message;
end;
$$;

create or replace function public.archive_customer_import_message(p_message_id bigint)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, pgmq
as $$
begin
  if coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role' then raise exception 'Acceso no autorizado'; end if;
  return pgmq.archive('customer_import_jobs', p_message_id);
end;
$$;

create or replace function public.set_customer_import_status(p_run_id uuid, p_status text)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public, pgmq
as $$
declare v_owner_id uuid; v_status text; v_message_id bigint;
begin
  select owner_id, status, queue_message_id into v_owner_id, v_status, v_message_id from public.customer_import_runs where id = p_run_id for update;
  if not found or v_owner_id <> (select auth.uid()) then raise exception 'Ejecución no autorizada'; end if;
  if p_status = 'paused' and v_status in ('queued', 'running') then
    update public.customer_import_runs set status = 'paused', updated_at = now() where id = p_run_id;
  elsif p_status = 'stopped' and v_status in ('queued', 'running', 'paused') then
    update public.customer_import_runs set status = 'stopped', finished_at = now(), updated_at = now() where id = p_run_id;
  elsif p_status = 'queued' and v_status = 'paused' then
    update public.customer_import_runs set status = 'queued', updated_at = now() where id = p_run_id;
    if v_message_id is not null then perform pgmq.set_vt('customer_import_jobs', v_message_id, 0); end if;
  else
    raise exception 'Cambio de estado no permitido';
  end if;
  return p_status;
end;
$$;

revoke all on function public.enqueue_customer_import(uuid) from public, anon;
grant execute on function public.enqueue_customer_import(uuid) to authenticated;
revoke all on function public.read_customer_import_message() from public, anon, authenticated;
grant execute on function public.read_customer_import_message() to service_role;
revoke all on function public.archive_customer_import_message(bigint) from public, anon, authenticated;
grant execute on function public.archive_customer_import_message(bigint) to service_role;
revoke all on function public.set_customer_import_status(uuid, text) from public, anon;
grant execute on function public.set_customer_import_status(uuid, text) to authenticated;

create policy "Users can create their import runs"
  on public.customer_import_runs for insert to authenticated
  with check ((select auth.uid()) = owner_id);
