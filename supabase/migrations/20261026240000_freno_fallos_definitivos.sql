-- Freno automático (2026-10-26, segunda versión): solo cuentan los productos que fallan del todo, no los intentos que se
-- reintentan («· se reintenta»), y se miran los últimos 30 (frena con 15). La primera versión (10 de 20 contando
-- reintentos) paró el masivo por rachas sueltas de cortes de la IA y de Supabase con el resto saliendo bien.
create or replace function public.mhd_importer_brake_check(p_job uuid, p_window integer default 30, p_threshold integer default 15)
returns text language plpgsql security definer set search_path = public as $$
declare v_failed integer; v_total integer; v_top text; v_reason text; v_since timestamptz;
begin
  select coalesce((options->>'resumed_at')::timestamptz, '-infinity') into v_since from public.mhd_importer_jobs where id = p_job;
  with last as (
    select level, message from public.mhd_importer_events
     where job_id = p_job and step = 'Producto' and level in ('info', 'error') and created_at > v_since
       and message not like '% · se reintenta'
     order by created_at desc limit p_window
  )
  select count(*) filter (where level = 'error'), count(*),
         (select message from last where level = 'error' group by 1 order by count(*) desc limit 1)
    into v_failed, v_total, v_top from last;
  if v_total < p_window or v_failed < p_threshold then return null; end if;
  v_reason := format('Freno automático: %s de los últimos %s productos han fallado del todo. Motivo más repetido: %s', v_failed, v_total, left(coalesce(v_top, '?'), 300));
  perform public.mhd_importer_pause_all(v_reason);
  return v_reason;
end; $$;
