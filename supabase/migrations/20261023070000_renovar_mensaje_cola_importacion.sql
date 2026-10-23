-- pgmq.set_vt devuelve SETOF pgmq.message_record y la función hacía `return pgmq.set_vt(...)`
-- con tipo boolean: fallaba siempre, sin que el trabajador lo notara (no comprueba el error).
-- Consecuencias: el latido no prolongaba la reserva del mensaje y, al ceder el turno cada 45 s,
-- el mensaje no volvía a quedar visible hasta que caducaban los 300 s de la lectura.
create or replace function public.renew_import_queue_message(p_queue_name text, p_message_id bigint, p_visibility_timeout integer default 300)
returns boolean
language plpgsql security definer set search_path = pg_catalog, public, pgmq
as $$
begin
  if coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role' then
    raise exception 'Acceso no autorizado';
  end if;
  if p_queue_name not in ('catalog_import_jobs', 'icecat_import_jobs', 'priority_import_jobs') then
    raise exception 'Cola no válida';
  end if;
  perform pgmq.set_vt(p_queue_name, p_message_id, greatest(0, least(p_visibility_timeout, 900)));
  return found;
end;
$$;
