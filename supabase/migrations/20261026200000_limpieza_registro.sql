-- Limpieza del registro de los procesos (David, 2026-10-26): los hechos de cada producto (mhd_importer_events) se
-- conservan 60 días; las tandas, sus productos y las pruebas no se borran. Cada noche a las 3:15 (UTC).
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('sincro-vicente-importador-limpieza-registro', '15 3 * * *', $cmd$
      delete from public.mhd_importer_events where created_at < now() - interval '60 days';
    $cmd$);
  end if;
end $$;
