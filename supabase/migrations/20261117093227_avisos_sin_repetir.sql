-- Avisos sin repetir (2026-11-17: el freno del importador mandó el mismo aviso tres veces a las 14:03 del 16-11, porque
-- varios trabajadores lo comprobaban a la vez). Reserva atómica por motivo: si en el periodo de silencio ya hay un
-- aviso enviado o reservado, devuelve null; si no, deja una reserva y devuelve su id. Quien la consigue envía.
create or replace function public.mhd_alert_claim(p_key text, p_since timestamptz)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_id bigint;
begin
  perform pg_advisory_xact_lock(hashtext('aviso:' || p_key));
  if exists (select 1 from mhd_sync_events where sync = 'avisos' and created_at >= p_since
             and ((kind = 'correo' and detail @> jsonb_build_object('key', p_key, 'sent', true))
                  or (kind = 'reserva' and detail @> jsonb_build_object('key', p_key)))) then
    return null;
  end if;
  insert into mhd_sync_events (sync, kind, detail) values ('avisos', 'reserva', jsonb_build_object('key', p_key)) returning id into v_id;
  return v_id;
end $$;
revoke execute on function public.mhd_alert_claim(text, timestamptz) from public, anon, authenticated;
grant execute on function public.mhd_alert_claim(text, timestamptz) to service_role;
