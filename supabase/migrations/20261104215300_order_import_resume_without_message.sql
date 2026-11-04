-- Reanudar una ejecución preparada en pausa (sin mensaje en la cola todavía) la encola; antes se quedaba en cola sin arrancar.
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
    if v_message_id is null then
      select * into v_message_id from pgmq.send('order_import_jobs', jsonb_build_object('run_id', p_run_id));
    else
      perform pgmq.set_vt('order_import_jobs', v_message_id, 0);
    end if;
    update public.order_import_runs set status = 'queued', queue_message_id = v_message_id, updated_at = now() where id = p_run_id;
    v_message := 'Importación reanudada por el usuario.';
  else
    raise exception 'Cambio de estado no permitido';
  end if;
  insert into public.order_import_events (run_id, level, outcome, message) values (p_run_id, 'info', 'status', v_message);
  return p_status;
end;
$$;
revoke all on function public.set_order_import_status(uuid, text) from public, anon;
grant execute on function public.set_order_import_status(uuid, text) to authenticated;
