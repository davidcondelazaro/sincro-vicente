-- Refresco nocturno de estados de la tienda (src/app/api/sincronizaciones/estados-tienda). 3:30 UTC = 4:30 en Madrid en
-- invierno, antes del resumen de las 9:00.
select cron.schedule('sincro-vicente-estados-tienda', '30 3 * * *', $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'sincro_vicente_app_url') || '/api/sincronizaciones/estados-tienda',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-mhd-import-token', (select decrypted_secret from vault.decrypted_secrets where name = 'mhd_catalog_import_token')),
    body := '{}'::jsonb, timeout_milliseconds := 120000);
$$);
