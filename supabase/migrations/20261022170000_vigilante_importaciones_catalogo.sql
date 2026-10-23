-- Vigilante de las importaciones de catálogo antiguas (Icecat, prioridades, SQL Server).
--
-- Sus tareas de pg_cron (cada minuto) se desactivaron el 2026-10-22 porque se
-- lanzaban 8.640 veces al día con las colas vacías. El trabajador ya se vuelve a
-- llamar a sí mismo al agotar cada tramo de 45 s; la tarea de su cola queda como
-- vigilante: activa solo mientras haya una ejecución en cola o en curso, para
-- retomar una autollamada perdida o un reintento, y apagada el resto del tiempo.

create or replace function public.sync_catalog_import_watchdogs()
returns trigger
language plpgsql security definer set search_path = pg_catalog, public
as $$
declare
  v_job record;
  v_active boolean;
begin
  for v_job in
    select j.jobid, j.active, w.entity_types
    from (values
      ('sincro-vicente-icecat-import-worker', array['icecat']),
      ('sincro-vicente-priority-import-worker', array['priorities']),
      ('sincro-vicente-catalog-import-worker', array['manufacturers','categories','features','products'])
    ) as w(jobname, entity_types)
    join cron.job j on j.jobname = w.jobname
  loop
    select exists(
      select 1 from public.catalog_import_runs r
      where r.entity_type = any(v_job.entity_types) and r.status in ('queued','running')
    ) into v_active;
    if v_active is distinct from v_job.active then
      perform cron.alter_job(job_id := v_job.jobid, active := v_active);
    end if;
  end loop;
  return null;
end; $$;

revoke all on function public.sync_catalog_import_watchdogs() from public, anon, authenticated;

drop trigger if exists catalog_import_runs_watchdogs on public.catalog_import_runs;
create trigger catalog_import_runs_watchdogs
after insert or update of status or delete on public.catalog_import_runs
for each statement execute function public.sync_catalog_import_watchdogs();

-- Las tareas llamaban a las funciones solo con la clave publicable, que no es un
-- JWT: con verify_jwt activo (sync-icecat-imports) Supabase las rechazaría. Ahora
-- envían la clave anónima (JWT público) guardada en Vault como
-- `sincro_vicente_anon_jwt` (se crea aparte, no en esta migración).
select cron.alter_job(
  job_id := j.jobid,
  command := format($cmd$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'sincro_vicente_project_url') || '/functions/v1/%s',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'sincro_vicente_publishable_key'),
        'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'sincro_vicente_anon_jwt')
      ),
      body := '{}'::jsonb
    );
  $cmd$, w.function_name)
)
from (values
  ('sincro-vicente-icecat-import-worker', 'sync-icecat-imports'),
  ('sincro-vicente-priority-import-worker', 'sync-priority-imports'),
  ('sincro-vicente-catalog-import-worker', 'sync-catalog-imports')
) as w(jobname, function_name)
join cron.job j on j.jobname = w.jobname;
