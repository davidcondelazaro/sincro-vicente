-- Freno automático (David, 2026-10-26: «para todo»): si fallan muchos productos seguidos, sea cual sea el motivo, se
-- pausan las tandas con el motivo más repetido. Nace del tope de gasto de Anthropic, que nadie reconocía y dejó más de
-- mil productos en error en 15 minutos. Mira los últimos `p_window` productos terminados o fallados de la tanda (cada
-- intento fallido cuenta) y frena si fallaron `p_threshold` o más. Devuelve el motivo si ha frenado; si no, null.
create or replace function public.mhd_importer_brake_check(p_job uuid, p_window integer default 20, p_threshold integer default 10)
returns text language plpgsql security definer set search_path = public as $$
declare v_failed integer; v_total integer; v_top text; v_reason text;
begin
  with last as (
    select level, message from public.mhd_importer_events
     where job_id = p_job and step = 'Producto' and level in ('info', 'error')
     order by created_at desc limit p_window
  )
  select count(*) filter (where level = 'error'), count(*),
         (select regexp_replace(message, ' · se reintenta$', '') from last where level = 'error' group by 1 order by count(*) desc limit 1)
    into v_failed, v_total, v_top from last;
  if v_total < p_window or v_failed < p_threshold then return null; end if;
  v_reason := format('Freno automático: %s de los últimos %s productos han fallado. Motivo más repetido: %s', v_failed, v_total, left(coalesce(v_top, '?'), 300));
  perform public.mhd_importer_pause_all(v_reason);
  return v_reason;
end; $$;
revoke all on function public.mhd_importer_brake_check(uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.mhd_importer_brake_check(uuid, integer, integer) to service_role;
