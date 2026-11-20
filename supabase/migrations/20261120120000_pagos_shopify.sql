-- Avisos de pagos de Shopify Payments (src/lib/shopify-payouts.ts, src/app/api/pagos-shopify). David, 2026-11-20.
-- Destinatarios: Para contabilidad@, en copia David e info@.
insert into public.store_settings (key, value, updated_by) values
  ('pagos_shopify_emails', '{"para": ["contabilidad@mihogardigital.es"], "copia": ["david@aligeria.com", "info@mihogardigital.es"]}'::jsonb, 'migración 20261120120000')
on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = now();

-- Cada día a las 10:00 de Madrid. pg_cron va en UTC, así que se llama a las 8:00 y a las 9:00 UTC con `?programada=1`
-- y la ruta solo actúa en la que cae a las 10 de Madrid (9:00 UTC en invierno, 8:00 UTC en verano).
select cron.schedule('sincro-vicente-pagos-shopify', '0 8,9 * * *', $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'sincro_vicente_app_url') || '/api/pagos-shopify?programada=1',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-mhd-import-token', (select decrypted_secret from vault.decrypted_secrets where name = 'mhd_catalog_import_token')),
    body := '{}'::jsonb, timeout_milliseconds := 120000);
$$);
