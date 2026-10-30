-- Altas de contratos de Garantía3 desde utils (David, 2026-10-30). Ver docs/GARANTIA3.md.
-- Una fila por unidad de garantía vendida. Los intentos no se borran: en PrestaShop un acierto pisaba el error anterior.
create table public.garantia3_contratos (
  id uuid primary key default gen_random_uuid(),
  shopify_order_id text not null,
  shopify_order_name text not null,
  shopify_line_id text not null,
  unidad integer not null default 1 check (unidad > 0),
  order_created_at timestamptz,
  sku text not null,
  ean13 text not null,
  sku_aparato text,
  nombre text,
  apellidos text,
  email text,
  telefono text,
  fecha_inicio timestamptz,
  origen_fecha text,
  fecha_prevista timestamptz,
  estado text not null default 'espera' check (estado in ('espera','lista','enviando','creado','error','dudoso','bloqueado','anulacion_pendiente','anulado')),
  motivo text,
  modo text not null default 'test' check (modo in ('test','produccion')),
  contrato text,
  pin text,
  fecha_alta timestamptz,
  ultimo_aviso text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (shopify_line_id, unidad)
);
create index garantia3_contratos_estado on public.garantia3_contratos (estado, fecha_prevista);

create table public.garantia3_intentos (
  id bigint generated always as identity primary key,
  contrato_id uuid not null references public.garantia3_contratos(id) on delete cascade,
  modo text not null,
  http_status integer,
  resultado text not null,
  respuesta text,
  created_at timestamptz not null default now()
);
create index garantia3_intentos_contrato on public.garantia3_intentos (contrato_id, created_at desc);

create table public.garantia3_vueltas (
  id bigint generated always as identity primary key,
  origen text not null,
  modo text not null,
  inicio timestamptz not null default now(),
  fin timestamptz,
  resumen jsonb
);

alter table public.garantia3_contratos enable row level security;
alter table public.garantia3_intentos enable row level security;
alter table public.garantia3_vueltas enable row level security;
create policy "Sesión: todo" on public.garantia3_contratos for all to authenticated using (true) with check (true);
create policy "Sesión: todo" on public.garantia3_intentos for all to authenticated using (true) with check (true);
create policy "Sesión: todo" on public.garantia3_vueltas for all to authenticated using (true) with check (true);
grant select, insert, update, delete on table public.garantia3_contratos, public.garantia3_intentos, public.garantia3_vueltas to authenticated, service_role;

insert into public.store_settings (key, value) values
  ('garantia3_modo', '"test"'),                -- test: recorrido completo sin llamar a Garantía3
  ('garantia3_dias', '14'),                    -- días de espera desde Enviado de MHD
  ('garantia3_desde', '"2026-10-30"'),         -- los pedidos anteriores se ignoran
  ('garantia3_emails_incidencias', '[]'),
  ('garantia3_emails_resumen', '[]')
on conflict (key) do nothing;

-- Una vuelta al día, un resumen el día 1 y una comprobación aparte de que la vuelta ha corrido.
select cron.schedule('sincro-vicente-garantia3-vuelta', '0 9 * * *', $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'sincro_vicente_app_url') || '/api/garantia3/tarea?tipo=vuelta',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-mhd-import-token', (select decrypted_secret from vault.decrypted_secrets where name = 'mhd_catalog_import_token')),
    body := '{}'::jsonb, timeout_milliseconds := 280000);
$$);
select cron.schedule('sincro-vicente-garantia3-mensual', '0 8 1 * *', $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'sincro_vicente_app_url') || '/api/garantia3/tarea?tipo=mensual',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-mhd-import-token', (select decrypted_secret from vault.decrypted_secrets where name = 'mhd_catalog_import_token')),
    body := '{}'::jsonb, timeout_milliseconds := 60000);
$$);
select cron.schedule('sincro-vicente-garantia3-vigilante', '0 17 * * *', $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'sincro_vicente_app_url') || '/api/garantia3/tarea?tipo=vigilante',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-mhd-import-token', (select decrypted_secret from vault.decrypted_secrets where name = 'mhd_catalog_import_token')),
    body := '{}'::jsonb, timeout_milliseconds := 60000);
$$);
