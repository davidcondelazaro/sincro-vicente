-- Arranca una importación de pedidos preparada en pausa cuando termina una de clientes (para dejarla lanzada de noche).
-- La programa un cron propio que se borra a sí mismo en cuanto la arranca o si ya no tiene sentido.
create or replace function public.start_order_import_after_customers(p_customer_run_id uuid, p_order_run_id uuid, p_job_name text)
returns text language plpgsql security definer set search_path = pg_catalog, public, pgmq as $$
declare v_customer_status text; v_order_status text; v_message_id bigint;
begin
  select status into v_customer_status from public.customer_import_runs where id = p_customer_run_id;
  select status into v_order_status from public.order_import_runs where id = p_order_run_id for update;
  -- Si alguien la arrancó, la detuvo o la borró a mano, el disparador ya no hace nada.
  if v_order_status is distinct from 'paused' then perform cron.unschedule(p_job_name); return 'sin efecto'; end if;
  if v_customer_status is distinct from 'completed' then return 'esperando'; end if;
  select * into v_message_id from pgmq.send('order_import_jobs', jsonb_build_object('run_id', p_order_run_id));
  update public.order_import_runs set status = 'queued', queue_message_id = v_message_id, updated_at = now() where id = p_order_run_id;
  insert into public.order_import_events (run_id, level, outcome, message)
  values (p_order_run_id, 'info', 'status', 'Arranque automático: la importación de clientes ha terminado.');
  perform cron.unschedule(p_job_name);
  return 'arrancada';
end;
$$;
revoke all on function public.start_order_import_after_customers(uuid, uuid, text) from public, anon, authenticated;
