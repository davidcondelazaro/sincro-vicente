-- Configuración de las sincronizaciones (David, 2026-10-29): lo que antes estaba fijo en el código y se cambia desde
-- utils › Catálogo › Configuración. Al guardar, la frecuencia del resumen y la pausa de las vueltas se aplican a pg_cron.
create table public.store_settings (
  key text primary key,
  value jsonb not null,
  updated_by text,
  updated_at timestamptz not null default now()
);
alter table public.store_settings enable row level security;
create policy "Sesión: leer" on public.store_settings for select to authenticated using (true);
create policy "Sesión: cambiar" on public.store_settings for update to authenticated using (true) with check (true);
grant select, update on table public.store_settings to authenticated;
grant select, insert, update, delete on table public.store_settings to service_role;

insert into public.store_settings (key, value) values
  ('alert_emails', '["david@aligeria.com"]'),     -- avisos graves al momento
  ('report_emails', '["david@aligeria.com"]'),    -- resúmenes
  ('report_frequency', '"hora"'),                 -- 'hora' (mientras se estabiliza) o 'diario' (9:00)
  ('sync_enabled', 'true');                       -- vueltas cada 30 minutos activas o en pausa

-- Lleva a pg_cron la frecuencia del resumen y la pausa de las vueltas.
create or replace function public.store_apply_schedule()
returns void language plpgsql security definer set search_path = public, cron as $$
declare v_freq text := (select value #>> '{}' from store_settings where key = 'report_frequency');
        v_sync boolean := (select (value #>> '{}')::boolean from store_settings where key = 'sync_enabled');
begin
  perform cron.alter_job(jobid, active := coalesce(v_sync, true)) from cron.job where jobname = 'sincro-vicente-vuelta';
  perform cron.alter_job(jobid, active := v_freq = 'hora') from cron.job where jobname = 'sincro-vicente-resumen-hora';
  perform cron.alter_job(jobid, active := v_freq = 'diario') from cron.job where jobname = 'sincro-vicente-resumen-diario';
end; $$;
revoke execute on function public.store_apply_schedule() from public, anon, authenticated;

create or replace function public.store_settings_changed()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.key in ('report_frequency', 'sync_enabled') then perform store_apply_schedule(); end if;
  return new;
end; $$;
create trigger store_settings_schedule after update on public.store_settings for each row execute function public.store_settings_changed();
