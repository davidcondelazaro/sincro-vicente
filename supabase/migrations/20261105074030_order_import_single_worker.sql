-- Un solo trabajador por ejecución de pedidos.
-- La noche del 4-11 hubo dos mensajes en la cola para la misma ejecución (reanudar + arranque automático)
-- y dos trabajadores recorrieron los mismos pedidos a la vez: 504 pedidos duplicados en Shopify.
alter table public.order_import_runs
  add column if not exists worker_message_id bigint,
  add column if not exists worker_lease_until timestamptz;

-- El trabajador reclama la ejecución antes de tocar nada. Solo uno la tiene a la vez; si el que la tenía
-- murió, su reclamo caduca y la puede coger otro mensaje.
create or replace function public.claim_order_import_run(p_run_id uuid, p_message_id bigint, p_seconds integer)
returns boolean language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role' then raise exception 'Acceso no autorizado'; end if;
  update public.order_import_runs
     set worker_message_id = p_message_id, worker_lease_until = now() + make_interval(secs => p_seconds), queue_message_id = p_message_id
   where id = p_run_id
     and (worker_lease_until is null or worker_lease_until < now() or worker_message_id = p_message_id);
  return found;
end;
$$;

create or replace function public.release_order_import_run(p_run_id uuid, p_message_id bigint)
returns boolean language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role' then raise exception 'Acceso no autorizado'; end if;
  update public.order_import_runs set worker_lease_until = null where id = p_run_id and worker_message_id = p_message_id;
  return found;
end;
$$;

revoke all on function public.claim_order_import_run(uuid, bigint, integer) from public, anon, authenticated;
revoke all on function public.release_order_import_run(uuid, bigint) from public, anon, authenticated;
grant execute on function public.claim_order_import_run(uuid, bigint, integer) to service_role;
grant execute on function public.release_order_import_run(uuid, bigint) to service_role;

-- ¿Sigue en la cola el mensaje que tiene apuntado la ejecución?
create or replace function public.order_import_message_alive(p_message_id bigint)
returns boolean language sql security definer set search_path = pg_catalog, public, pgmq as $$
  select p_message_id is not null and exists (select 1 from pgmq.q_order_import_jobs where msg_id = p_message_id);
$$;
revoke all on function public.order_import_message_alive(bigint) from public, anon, authenticated;

-- Reanudar reutiliza el mensaje si sigue vivo; solo crea uno nuevo si ya no existe.
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
    if public.order_import_message_alive(v_message_id) then
      perform pgmq.set_vt('order_import_jobs', v_message_id, 0);
    else
      select * into v_message_id from pgmq.send('order_import_jobs', jsonb_build_object('run_id', p_run_id));
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

-- Lo mismo para el arranque automático tras los clientes.
create or replace function public.start_order_import_after_customers(p_customer_run_id uuid, p_order_run_id uuid, p_job_name text)
returns text language plpgsql security definer set search_path = pg_catalog, public, pgmq as $$
declare v_customer_status text; v_order_status text; v_message_id bigint;
begin
  select status into v_customer_status from public.customer_import_runs where id = p_customer_run_id;
  select status, queue_message_id into v_order_status, v_message_id from public.order_import_runs where id = p_order_run_id for update;
  if v_order_status is distinct from 'paused' then perform cron.unschedule(p_job_name); return 'sin efecto'; end if;
  if v_customer_status is distinct from 'completed' then return 'esperando'; end if;
  if public.order_import_message_alive(v_message_id) then
    perform pgmq.set_vt('order_import_jobs', v_message_id, 0);
  else
    select * into v_message_id from pgmq.send('order_import_jobs', jsonb_build_object('run_id', p_order_run_id));
  end if;
  update public.order_import_runs set status = 'queued', queue_message_id = v_message_id, updated_at = now() where id = p_order_run_id;
  insert into public.order_import_events (run_id, level, outcome, message)
  values (p_order_run_id, 'info', 'status', 'Arranque automático: la importación de clientes ha terminado.');
  perform cron.unschedule(p_job_name);
  return 'arrancada';
end;
$$;
revoke all on function public.start_order_import_after_customers(uuid, uuid, text) from public, anon, authenticated;
