-- Google Merchant (src/app/api/merchant, src/lib/merchant). La cola cada 10 minutos; de madrugada, la conciliación
-- (2:15 UTC) y la lectura de avisos de Google (2:45 UTC), antes del resumen de las 9:00. Sin `merchant_activo` las
-- rutas no mandan nada (los avisos sí se leen: solo es lectura).
select cron.schedule('sincro-vicente-merchant-cola', '*/10 * * * *', $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'sincro_vicente_app_url') || '/api/merchant?accion=cola',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-mhd-import-token', (select decrypted_secret from vault.decrypted_secrets where name = 'mhd_catalog_import_token')),
    body := '{}'::jsonb, timeout_milliseconds := 300000);
$$);
select cron.schedule('sincro-vicente-merchant-conciliar', '15 2 * * *', $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'sincro_vicente_app_url') || '/api/merchant?accion=conciliar',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-mhd-import-token', (select decrypted_secret from vault.decrypted_secrets where name = 'mhd_catalog_import_token')),
    body := '{}'::jsonb, timeout_milliseconds := 300000);
$$);
select cron.schedule('sincro-vicente-merchant-avisos', '45 2 * * *', $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'sincro_vicente_app_url') || '/api/merchant?accion=avisos',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-mhd-import-token', (select decrypted_secret from vault.decrypted_secrets where name = 'mhd_catalog_import_token')),
    body := '{}'::jsonb, timeout_milliseconds := 300000);
$$);
