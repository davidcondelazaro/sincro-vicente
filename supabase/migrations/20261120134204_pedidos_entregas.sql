-- Entregas y recogidas (docs/PEDIDOS_MHD_FASE_1.md › Entregas y recogidas, 20-11-2026). Estado de cada seguimiento:
-- lo último que dijo la página del transportista, cuántas veces se ha mirado y lo hecho en Shopify (resultado).
create table public.mhd_order_deliveries (
  id uuid primary key default gen_random_uuid(),
  export_id uuid not null unique references public.mhd_order_exports(id) on delete cascade,
  order_name text not null,
  enviado_at timestamptz,                 -- «Enviado» de MHD (cuenta las 24 h y los 10 días)
  tracking_number text,
  carrier_code text,
  carrier_name text,
  carrier_url text,
  estado text,                            -- entregado, en_reparto, en_transito, en_preparacion, incidencia, desconocido
  estado_texto text,
  estado_fecha timestamptz,
  fuente text check (fuente in ('lectura','ia')),
  page_hash text,                         -- huella del texto: la IA solo se llama si cambia
  checks integer not null default 0,
  ai_calls integer not null default 0,
  last_checked_at timestamptz,
  resultado text check (resultado in ('entregado','listo_recoger','ya_hecho','revisar')), -- con resultado ya no se mira
  resultado_at timestamptz,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.mhd_order_deliveries enable row level security;
create policy "Sesión: leer entregas" on public.mhd_order_deliveries for select to authenticated using (true);

insert into public.store_settings (key, value) values ('pedidos_entrega_auto_activo', 'false') on conflict (key) do nothing;

-- Cada hora a los :20; el código solo actúa de 8 a 21 (Madrid) y con el interruptor encendido
select cron.unschedule(jobid) from cron.job where jobname = 'sincro-vicente-pedidos-entregas';
select cron.schedule('sincro-vicente-pedidos-entregas', '20 * * * *', $cmd$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'sincro_vicente_app_url') || '/api/mhd-orders/tarea?tipo=entregas',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-mhd-import-token', (select decrypted_secret from vault.decrypted_secrets where name = 'mhd_catalog_import_token')),
    body := '{}'::jsonb, timeout_milliseconds := 280000);
$cmd$);
