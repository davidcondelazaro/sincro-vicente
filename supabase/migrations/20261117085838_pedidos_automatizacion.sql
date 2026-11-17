-- Automatización de pedidos (docs/PEDIDOS_MHD_FASE_1.md › Automatización de pedidos, 17-11-2026).
-- Interruptores y ajustes en utils › Configuración › Pedidos MHD. La exportación y el envío automáticos, apagados.
insert into public.store_settings (key, value) values
  ('pedidos_exportar_auto_activo', 'false'),
  ('pedidos_exportar_auto_desde', 'null'),        -- corte: solo pedidos creados después (se pone al encender)
  ('pedidos_exportar_margen_minutos', '30'),      -- espera desde el pago antes de exportar
  ('pedidos_envio_auto_activo', 'false'),         -- marcar en Shopify los que MHD da por enviados
  ('pedidos_aviso_sin_exportar_horas', '2'),      -- aviso de pagados sin exportar (lunes a viernes, 9 a 20 h)
  ('pedidos_informe_hora', '9'),                  -- hora (Madrid) del resumen diario de pedidos
  ('pedidos_informe_emails', coalesce((select value from public.store_settings where key = 'report_emails'), '["david@aligeria.com"]')),
  ('pedidos_avisos_emails', coalesce((select value from public.store_settings where key = 'alert_emails'), '["david@aligeria.com"]'))
on conflict (key) do nothing;

-- Los botones de Pedidos MHD (con sesión) también apuntan lo que hacen, para el resumen
create policy "Sesión: registrar pedidos" on public.mhd_sync_events for insert to authenticated with check (sync = 'pedidos');

-- Tareas: pedidos cada 15 min, estados cada 30 (desfasados) y resumen cada hora (solo sale a la hora elegida)
do $$
declare v_tipo text; v_cron text;
begin
  for v_tipo, v_cron in values ('pedidos', '*/15 * * * *'), ('estados', '7,37 * * * *'), ('resumen', '0 * * * *') loop
    perform cron.unschedule(jobid) from cron.job where jobname = 'sincro-vicente-pedidos-' || v_tipo;
    perform cron.schedule('sincro-vicente-pedidos-' || v_tipo, v_cron, format($cmd$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'sincro_vicente_app_url') || '/api/mhd-orders/tarea?tipo=%s',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-mhd-import-token', (select decrypted_secret from vault.decrypted_secrets where name = 'mhd_catalog_import_token')),
    body := '{}'::jsonb, timeout_milliseconds := 280000);
$cmd$, v_tipo));
  end loop;
end $$;
update public.store_settings set value = '"2026-11-14T00:00:00Z"' where key = 'factura_correo_desde' and value = 'null'::jsonb;
