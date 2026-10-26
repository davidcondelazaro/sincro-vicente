-- Resumen de avisos por tanda (David, 2026-10-26): cuántos productos tienen cada tipo de aviso, decisión o error
-- (data.tipo, ver src/lib/mhd-importer/warning-kinds.ts), con algunos códigos de ejemplo. Base del informe final de
-- fallos y dudas.
create or replace view public.mhd_importer_job_warnings with (security_invoker = true) as
select job_id, data->>'tipo' as tipo, count(distinct codigo) as productos, count(*) as avisos,
       (array_agg(distinct codigo))[1:5] as ejemplos
  from public.mhd_importer_events
 where data ? 'tipo' and data->>'tipo' is not null
 group by job_id, data->>'tipo';
grant select on public.mhd_importer_job_warnings to authenticated, service_role;
create index if not exists mhd_importer_events_tipo_idx on public.mhd_importer_events (job_id, (data->>'tipo'));
