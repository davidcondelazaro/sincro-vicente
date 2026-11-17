-- Gasto de IA completo para el resumen (David, 2026-11-17: «¿por qué no sale todo lo que nos hemos gastado en IA?»).
-- Antes solo contaba las tandas del importador (mhd_importer_job_items). Ahora suma todo lo que queda registrado:
-- cada procesado de producto (tandas y pruebas sueltas), los perfiles de familia y los jueces, con el total acumulado.
create or replace function public.mhd_ai_cost(p_since timestamptz)
returns jsonb language sql stable security definer set search_path = public as $$
  with madrid as (
    select (date_trunc('day', now() at time zone 'Europe/Madrid') at time zone 'Europe/Madrid') day_start,
           (date_trunc('month', now() at time zone 'Europe/Madrid') at time zone 'Europe/Madrid') month_start),
  costs as (
    select 'productos' origen, created_at at_, coalesce(cost_usd, 0) usd from mhd_importer_product_runs
    union all select 'familias', analyzed_at, coalesce(cost_usd, 0) from mhd_importer_family_profiles where analyzed_at is not null
    union all select 'jueces', created_at, coalesce(cost_usd, 0) from mhd_importer_judgements)
  select jsonb_build_object(
    'period', coalesce(sum(usd) filter (where at_ >= p_since), 0),
    'today', coalesce(sum(usd) filter (where at_ >= madrid.day_start), 0),
    'month', coalesce(sum(usd) filter (where at_ >= madrid.month_start), 0),
    'total', coalesce(sum(usd), 0),
    'since', min(at_),
    'by_origin', (select jsonb_object_agg(origen, round(total::numeric, 2)) from (select origen, sum(usd) total from costs group by origen) o))
  from costs, madrid group by madrid.day_start, madrid.month_start;
$$;
revoke execute on function public.mhd_ai_cost(timestamptz) from public, anon, authenticated;
grant execute on function public.mhd_ai_cost(timestamptz) to service_role;
