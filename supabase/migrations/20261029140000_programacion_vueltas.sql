-- Programación de las sincronizaciones (David, 2026-10-29). pg_cron va en UTC.
--   · Vuelta cada 30 minutos (en punto y a la media): conexiones → lectura del listado → precio y stock → …
--   · Resumen por correo cada hora, a y 5, con lo de la última hora, mientras se estabiliza todo.
--   · Resumen diario a las 9:00 de Madrid (8:00 UTC en horario de invierno; 7:00 en verano): creado pero apagado hasta
--     que David diga que se pasa al diario (entonces se apaga el de cada hora).
select cron.schedule('sincro-vicente-vuelta', '*/30 * * * *', $$select public.mhd_sync_cycle_start('programada');$$);

select cron.schedule('sincro-vicente-resumen-hora', '5 * * * *', $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'sincro_vicente_app_url') || '/api/informes/diario?horas=1',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-mhd-import-token', (select decrypted_secret from vault.decrypted_secrets where name = 'mhd_catalog_import_token')),
    body := '{}'::jsonb, timeout_milliseconds := 60000);
$$);

select cron.schedule('sincro-vicente-resumen-diario', '0 8 * * *', $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'sincro_vicente_app_url') || '/api/informes/diario',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-mhd-import-token', (select decrypted_secret from vault.decrypted_secrets where name = 'mhd_catalog_import_token')),
    body := '{}'::jsonb, timeout_milliseconds := 60000);
$$);
select cron.alter_job((select jobid from cron.job where jobname = 'sincro-vicente-resumen-diario'), active := false);
