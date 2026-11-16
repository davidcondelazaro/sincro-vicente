-- El vigilante del importador también sigue encendido mientras haya una tanda en pausa con hora de vuelta
-- (`options.resume_at`, tope de 200 vídeos por hora de Shopify). Sin esto se apagaba al pausarse la última tanda
-- activa y nadie la reanudaba a su hora (2026-11-16).
create or replace function public.sync_importer_watchdog()
returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_job bigint; v_active boolean; v_now boolean;
begin
  select jobid, active into v_job, v_now from cron.job where jobname = 'sincro-vicente-importador-vigilante';
  if v_job is null then return null; end if;
  select exists(
    select 1 from public.mhd_importer_jobs
     where status in ('en_cola', 'en_curso')
        or (status = 'pausado' and options ? 'resume_at')
  ) into v_active;
  if v_active is distinct from v_now then perform cron.alter_job(job_id := v_job, active := v_active); end if;
  return null;
end; $$;
revoke all on function public.sync_importer_watchdog() from public, anon, authenticated;

-- Encenderlo ya si hay alguna tanda esperando.
do $$
begin
  if exists (select 1 from public.mhd_importer_jobs where status = 'pausado' and options ? 'resume_at') then
    perform cron.alter_job(job_id := (select jobid from cron.job where jobname = 'sincro-vicente-importador-vigilante'), active := true);
  end if;
end $$;
