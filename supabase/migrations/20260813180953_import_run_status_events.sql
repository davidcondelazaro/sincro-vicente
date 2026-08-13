create or replace function public.set_customer_import_status(p_run_id uuid, p_status text)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public, pgmq
as $$
declare v_owner_id uuid; v_status text; v_message_id bigint; v_message text;
begin
  select owner_id, status, queue_message_id into v_owner_id, v_status, v_message_id
  from public.customer_import_runs where id = p_run_id for update;
  if not found or v_owner_id <> (select auth.uid()) then raise exception 'Ejecución no autorizada'; end if;
  if p_status = 'paused' and v_status in ('queued', 'running') then
    update public.customer_import_runs set status = 'paused', updated_at = now() where id = p_run_id;
    v_message := 'Importación pausada por el usuario.';
  elsif p_status = 'stopped' and v_status in ('queued', 'running', 'paused') then
    update public.customer_import_runs set status = 'stopped', finished_at = now(), updated_at = now() where id = p_run_id;
    if v_message_id is not null then perform pgmq.archive('customer_import_jobs', v_message_id); end if;
    v_message := 'Importación detenida por el usuario.';
  elsif p_status = 'queued' and v_status = 'paused' then
    update public.customer_import_runs set status = 'queued', updated_at = now() where id = p_run_id;
    if v_message_id is not null then perform pgmq.set_vt('customer_import_jobs', v_message_id, 0); end if;
    v_message := 'Importación reanudada por el usuario.';
  else
    raise exception 'Cambio de estado no permitido';
  end if;
  insert into public.customer_import_events (run_id, level, outcome, message)
  values (p_run_id, 'info', 'status', v_message);
  return p_status;
end;
$$;

revoke all on function public.set_customer_import_status(uuid, text) from public, anon;
grant execute on function public.set_customer_import_status(uuid, text) to authenticated;
