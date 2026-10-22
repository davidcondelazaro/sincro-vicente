-- Importación de MHD por páginas (fase 1, 2026-10-22).
--
-- Sustituye al bucle que corría dentro de una función de Vercel. Ahora la
-- función de Supabase `mhd-catalog-import` procesa una página por llamada y la
-- base de datos guarda dónde va (entidad, parte, página) y encadena la
-- siguiente con pg_net. Ver docs/IMPORTACION_CATALOGO_MHD.md.

-- Ejecuciones -------------------------------------------------------------

alter table public.mhd_catalog_import_runs drop constraint if exists mhd_catalog_import_runs_status_check;
alter table public.mhd_catalog_import_runs add constraint mhd_catalog_import_runs_status_check
  check (status in ('running', 'stopped', 'completed', 'failed', 'discarded'));

alter table public.mhd_catalog_import_runs
  add column kind text not null default 'full' check (kind in ('full', 'categories', 'brands', 'products', 'prices', 'stock')),
  add column entities text[] not null default array['categories', 'brands', 'products', 'prices', 'stock'],
  -- Dónde va: índice en `entities`, parte (nivel de categoría) y página de MHD.
  add column cursor jsonb not null default '{"entity_index": 0, "part": 0, "page": 1, "failures": 0}'::jsonb,
  -- Por entidad: done, total, estimated, pages, part_done, part_total, started_at, completed_at.
  add column entity_progress jsonb not null default '{}'::jsonb,
  add column last_activity_at timestamptz,
  add column lease_token uuid,
  add column lease_until timestamptz,
  add column stop_requested boolean not null default false,
  add column absences_applied boolean not null default false,
  add column started_by uuid;

-- Una sola importación activa (en curso o detenida a la espera de reanudar).
create unique index mhd_catalog_import_runs_one_active_idx
  on public.mhd_catalog_import_runs ((true)) where status in ('running', 'stopped');

-- Páginas procesadas (y fallidas) de cada ejecución.
create table public.mhd_catalog_import_pages (
  id bigint generated always as identity primary key,
  run_id uuid not null references public.mhd_catalog_import_runs(id) on delete cascade,
  entity text not null,
  part integer not null default 0,
  page integer not null,
  attempts integer not null default 1,
  records integer,
  duration_ms integer,
  ok boolean not null,
  error text,
  created_at timestamptz not null default now()
);
create index mhd_catalog_import_pages_run_idx on public.mhd_catalog_import_pages(run_id, created_at);

-- Bajas y reaparecidos detectados en cada ejecución.
create table public.mhd_catalog_presence_changes (
  run_id uuid not null references public.mhd_catalog_import_runs(id) on delete cascade,
  codigo text not null,
  change text not null check (change in ('baja', 'reaparece')),
  titulo text,
  nombre_marca text,
  detected_at timestamptz not null default now(),
  primary key (run_id, codigo)
);

alter table public.mhd_catalog_import_pages enable row level security;
alter table public.mhd_catalog_presence_changes enable row level security;
revoke all on table public.mhd_catalog_import_pages, public.mhd_catalog_presence_changes from anon, authenticated;
grant select, insert, update, delete on table public.mhd_catalog_import_pages, public.mhd_catalog_presence_changes to service_role;

-- El motor antiguo: filas en bruto y volcado de golpe al final. Ya no se usan.
drop trigger if exists mhd_catalog_keep_latest_raw_after_completion on public.mhd_catalog_import_runs;
drop function if exists public.keep_latest_mhd_catalog_raw_rows();
drop function if exists public.replace_mhd_catalog_from_run(uuid);
drop table if exists public.mhd_catalog_raw_rows;

-- Clave con la que la base de datos llama a la función (generada aquí, nadie la ve).
do $$ begin
  if not exists (select 1 from vault.secrets where name = 'mhd_catalog_import_token') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'mhd_catalog_import_token', 'Cabecera x-mhd-import-token de la función mhd-catalog-import');
  end if;
end $$;

-- Utilidades internas -------------------------------------------------------

create or replace function public.mhd_import_parts(p_entity text)
returns integer language sql immutable set search_path = public as $$
  select case p_entity when 'categories' then 3 else 1 end
$$;

create or replace function public.mhd_import_kick(p_run_id uuid)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  perform net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'sincro_vicente_project_url') || '/functions/v1/mhd-catalog-import',
    body := jsonb_build_object('run_id', p_run_id),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-mhd-import-token', (select decrypted_secret from vault.decrypted_secrets where name = 'mhd_catalog_import_token')
    ),
    timeout_milliseconds := 10000
  );
end; $$;

-- Vigilante: solo existe mientras hay una importación en curso.
create or replace function public.mhd_import_set_watchdog(p_active boolean)
returns void language plpgsql security definer set search_path = public, cron as $$
begin
  if p_active and not exists (select 1 from cron.job where jobname = 'mhd-catalog-import-vigilante') then
    perform cron.schedule('mhd-catalog-import-vigilante', '*/2 * * * *', 'select public.mhd_import_watchdog()');
  elsif not p_active and exists (select 1 from cron.job where jobname = 'mhd-catalog-import-vigilante') then
    perform cron.unschedule('mhd-catalog-import-vigilante');
  end if;
end; $$;

create or replace function public.mhd_import_watchdog()
returns void language plpgsql security definer set search_path = public as $$
declare v_run public.mhd_catalog_import_runs%rowtype;
begin
  select * into v_run from public.mhd_catalog_import_runs where status = 'running';
  if not found then perform public.mhd_import_set_watchdog(false); return; end if;
  if (v_run.lease_until is null or v_run.lease_until < now())
     and coalesce(v_run.last_activity_at, v_run.started_at) < now() - interval '90 seconds' then
    perform public.mhd_import_kick(v_run.id);
  end if;
end; $$;

-- Fin de la ejecución, bien o mal: suelta la reserva y quita el vigilante.
create or replace function public.mhd_import_finish(p_run_id uuid, p_status text, p_error text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.mhd_catalog_import_runs
     set status = p_status, error_message = p_error, lease_token = null, lease_until = null,
         completed_at = case when p_status in ('completed', 'failed', 'discarded') then now() else completed_at end,
         last_activity_at = now()
   where id = p_run_id;
  if not exists (select 1 from public.mhd_catalog_import_runs where status = 'running') then
    perform public.mhd_import_set_watchdog(false);
  end if;
end; $$;

-- Bajas: solo tras leer todos los productos bien. Lo que estaba presente y no ha
-- venido en esta ejecución pasa a baja.
create or replace function public.mhd_import_apply_absences(p_run_id uuid, p_expected integer)
returns text language plpgsql security definer set search_path = public as $$
declare v_seen integer; v_present integer; v_absent integer;
begin
  select count(*) into v_seen from public.mhd_catalog_products where last_seen_run_id = p_run_id;
  if v_seen <> p_expected then
    return format('MHD declaró %s productos, pero llegaron %s distintos (¿cambió el catálogo durante la lectura?). No se marcan bajas.', p_expected, v_seen);
  end if;
  select count(*) filter (where presence_status = 'present'),
         count(*) filter (where presence_status = 'present' and last_seen_run_id <> p_run_id)
    into v_present, v_absent from public.mhd_catalog_products;
  if v_absent > greatest(200, v_present / 10) then
    return format('Saldrían %s bajas de %s productos (más del 10 %%). No se marcan por precaución: revisar MHD.', v_absent, v_present);
  end if;
  insert into public.mhd_catalog_presence_changes (run_id, codigo, change, titulo, nombre_marca)
  select p_run_id, codigo, 'baja', titulo, nombre_marca from public.mhd_catalog_products
   where presence_status = 'present' and last_seen_run_id <> p_run_id
  on conflict (run_id, codigo) do nothing;
  update public.mhd_catalog_products
     set presence_status = 'absent_in_mhd', absent_since = now(), absence_detected_run_id = p_run_id
   where presence_status = 'present' and last_seen_run_id <> p_run_id;
  update public.mhd_catalog_import_runs set absences_applied = true where id = p_run_id;
  return null;
end; $$;

-- Volcado de una página a la tabla final de su entidad.
create or replace function public.mhd_import_upsert_rows(p_run_id uuid, p_entity text, p_rows jsonb)
returns integer language plpgsql security definer set search_path = public, extensions as $$
declare v_now timestamptz := now(); v_count integer;
begin
  if p_entity = 'products' then
    insert into public.mhd_catalog_presence_changes (run_id, codigo, change, titulo, nombre_marca)
    select p_run_id, p.codigo, 'reaparece', p.titulo, p.nombre_marca
      from jsonb_array_elements(p_rows) r join public.mhd_catalog_products p on p.codigo = r->>'codigo'
     where p.presence_status = 'absent_in_mhd'
    on conflict (run_id, codigo) do nothing;

    insert into public.mhd_catalog_products (codigo,codigo_ean,ref_proved,titulo,descripcion_ampliada,cd_marca,nombre_marca,cod_linea,nombre_linea,cod_familia,nombre_familia,cod_subfamilia,nombre_subfamilia,friendly_url,iva,pvp,pvp_antes,triple_neto,stock,fecha_modificacion_producto,fecha_modificacion_precio,fecha_modificacion_stock,source_hash,source_payload,last_seen_at,last_seen_run_id,presence_status,absent_since,absence_detected_run_id,loaded_at)
    select r->>'codigo', r->>'codigo_ean', r->>'ref_proved', r->>'titulo', r->>'descripcion_ampliada', r->>'cd_marca', r->>'nombre_marca', r->>'cod_linea', r->>'nombre_linea', r->>'cod_familia', r->>'nombre_familia', r->>'cod_subfamilia', r->>'nombre_subfamilia', r->>'friendly_url', nullif(r->>'iva','')::numeric, nullif(r->>'pvp','')::numeric, nullif(r->>'pvp_antes','')::numeric, nullif(r->>'triple_neto','')::numeric, nullif(r->>'stock','')::numeric, r->>'fecha_modificacion_producto', r->>'fecha_modificacion_precio', r->>'fecha_modificacion_stock', encode(digest(r::text,'sha256'),'hex'), r, v_now, p_run_id, 'present', null, null, v_now
      from jsonb_array_elements(p_rows) r
    on conflict (codigo) do update set codigo_ean=excluded.codigo_ean,ref_proved=excluded.ref_proved,titulo=excluded.titulo,descripcion_ampliada=excluded.descripcion_ampliada,cd_marca=excluded.cd_marca,nombre_marca=excluded.nombre_marca,cod_linea=excluded.cod_linea,nombre_linea=excluded.nombre_linea,cod_familia=excluded.cod_familia,nombre_familia=excluded.nombre_familia,cod_subfamilia=excluded.cod_subfamilia,nombre_subfamilia=excluded.nombre_subfamilia,friendly_url=excluded.friendly_url,iva=excluded.iva,pvp=excluded.pvp,pvp_antes=excluded.pvp_antes,triple_neto=excluded.triple_neto,stock=excluded.stock,fecha_modificacion_producto=excluded.fecha_modificacion_producto,fecha_modificacion_precio=excluded.fecha_modificacion_precio,fecha_modificacion_stock=excluded.fecha_modificacion_stock,source_hash=excluded.source_hash,source_payload=excluded.source_payload,last_seen_at=excluded.last_seen_at,last_seen_run_id=excluded.last_seen_run_id,presence_status='present',absent_since=null,absence_detected_run_id=null,loaded_at=excluded.loaded_at;
  elsif p_entity = 'categories' then
    insert into public.mhd_catalog_categories (cd_familia,nombre,nivel,activo,visible,cod_linea,cod_familia,friendly_url,breadcrumb,orden,source_hash,source_payload,last_seen_at,last_seen_run_id,loaded_at)
    select r->>'cd_familia', r->>'nombre', nullif(r->>'nivel','')::integer, (r->>'activo')::boolean, (r->>'visible')::boolean, r->>'cod_linea',
           -- El nivel 3 no trae su familia: son los tres primeros caracteres (H0101 → H01).
           coalesce(r->>'cod_familia', case when r->>'nivel' = '3' then left(r->>'cd_familia', 3) end),
           r->>'friendly_url', r->>'breadcrumb', nullif(r->>'orden','')::integer, encode(digest(r::text,'sha256'),'hex'), r, v_now, p_run_id, v_now
      from jsonb_array_elements(p_rows) r
    on conflict (cd_familia) do update set nombre=excluded.nombre,nivel=excluded.nivel,activo=excluded.activo,visible=excluded.visible,cod_linea=excluded.cod_linea,cod_familia=excluded.cod_familia,friendly_url=excluded.friendly_url,breadcrumb=excluded.breadcrumb,orden=excluded.orden,source_hash=excluded.source_hash,source_payload=excluded.source_payload,last_seen_at=excluded.last_seen_at,last_seen_run_id=excluded.last_seen_run_id,loaded_at=excluded.loaded_at;
  elsif p_entity = 'brands' then
    insert into public.mhd_catalog_brands (cd_marca,nombre,activo,validada,source_hash,source_payload,last_seen_at,last_seen_run_id,loaded_at)
    select r->>'cd_marca', r->>'nombre', (r->>'activo')::boolean, (r->>'validada')::boolean, encode(digest(r::text,'sha256'),'hex'), r, v_now, p_run_id, v_now
      from jsonb_array_elements(p_rows) r
    on conflict (cd_marca) do update set nombre=excluded.nombre,activo=excluded.activo,validada=excluded.validada,source_hash=excluded.source_hash,source_payload=excluded.source_payload,last_seen_at=excluded.last_seen_at,last_seen_run_id=excluded.last_seen_run_id,loaded_at=excluded.loaded_at;
  elsif p_entity = 'prices' then
    insert into public.mhd_catalog_prices (codigo,iva,pvp,pvp_antes,triple_neto,fecha_modificacion_precio,source_hash,source_payload,last_seen_at,last_seen_run_id,loaded_at)
    select r->>'codigo', nullif(r->>'iva','')::numeric, nullif(r->>'pvp','')::numeric, nullif(r->>'pvp_antes','')::numeric, nullif(r->>'triple_neto','')::numeric, r->>'fecha_modificacion_precio', encode(digest(r::text,'sha256'),'hex'), r, v_now, p_run_id, v_now
      from jsonb_array_elements(p_rows) r
    on conflict (codigo) do update set iva=excluded.iva,pvp=excluded.pvp,pvp_antes=excluded.pvp_antes,triple_neto=excluded.triple_neto,fecha_modificacion_precio=excluded.fecha_modificacion_precio,source_hash=excluded.source_hash,source_payload=excluded.source_payload,last_seen_at=excluded.last_seen_at,last_seen_run_id=excluded.last_seen_run_id,loaded_at=excluded.loaded_at;
  elsif p_entity = 'stock' then
    insert into public.mhd_catalog_stock (codigo,stock,fecha_modificacion_stock,source_hash,source_payload,last_seen_at,last_seen_run_id,loaded_at)
    select r->>'codigo', nullif(r->>'stock','')::numeric, r->>'fecha_modificacion_stock', encode(digest(r::text,'sha256'),'hex'), r, v_now, p_run_id, v_now
      from jsonb_array_elements(p_rows) r
    on conflict (codigo) do update set stock=excluded.stock,fecha_modificacion_stock=excluded.fecha_modificacion_stock,source_hash=excluded.source_hash,source_payload=excluded.source_payload,last_seen_at=excluded.last_seen_at,last_seen_run_id=excluded.last_seen_run_id,loaded_at=excluded.loaded_at;
  else
    raise exception 'Entidad MHD no válida: %', p_entity;
  end if;
  get diagnostics v_count = row_count;
  return v_count;
end; $$;

-- Llamadas de la función mhd-catalog-import (solo service_role) ---------------

create or replace function public.mhd_import_token_valid(p_token text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(p_token = (select decrypted_secret from vault.decrypted_secrets where name = 'mhd_catalog_import_token'), false)
$$;

-- Reserva la ejecución para procesar la página siguiente. Devuelve null si no
-- hay nada que hacer (otra llamada la tiene reservada, o está detenida/acabada).
create or replace function public.mhd_import_claim(p_run_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_run public.mhd_catalog_import_runs%rowtype; v_entity text;
begin
  select * into v_run from public.mhd_catalog_import_runs where id = p_run_id for update;
  if not found or v_run.status <> 'running' then return null; end if;
  if v_run.lease_until is not null and v_run.lease_until > now() then return null; end if;
  if v_run.stop_requested then perform public.mhd_import_finish(p_run_id, 'stopped'); return null; end if;
  v_entity := v_run.entities[(v_run.cursor->>'entity_index')::integer + 1];
  update public.mhd_catalog_import_runs
     set lease_token = gen_random_uuid(), lease_until = now() + interval '90 seconds', last_activity_at = now(),
         progress = jsonb_build_object('phase', 'reading', 'entity', v_entity),
         entity_progress = case when entity_progress ? v_entity and entity_progress->v_entity ? 'started_at' then entity_progress
                                else jsonb_set(entity_progress, array[v_entity], coalesce(entity_progress->v_entity, '{}'::jsonb) || jsonb_build_object('started_at', now())) end
   where id = p_run_id returning * into v_run;
  return jsonb_build_object('lease_token', v_run.lease_token, 'entity', v_entity,
    'part', (v_run.cursor->>'part')::integer, 'page', (v_run.cursor->>'page')::integer,
    'failures', coalesce((v_run.cursor->>'failures')::integer, 0));
end; $$;

-- Guarda una página leída de MHD, avanza el cursor y encadena la siguiente.
create or replace function public.mhd_import_ingest_page(
  p_run_id uuid, p_lease_token uuid, p_entity text, p_part integer, p_page integer,
  p_total integer, p_rows jsonb, p_attempts integer, p_duration_ms integer)
returns jsonb language plpgsql security definer set search_path = public set statement_timeout = '120s' as $$
declare
  v_run public.mhd_catalog_import_runs%rowtype; v_n integer := jsonb_array_length(p_rows);
  v_prog jsonb; v_part_done integer; v_cursor jsonb; v_entity_index integer; v_done integer; v_total integer;
  v_error text; v_finished_entity boolean := false;
begin
  select * into v_run from public.mhd_catalog_import_runs where id = p_run_id for update;
  if not found or v_run.status <> 'running' or v_run.lease_token is distinct from p_lease_token then
    return jsonb_build_object('next', 'none', 'reason', 'reserva perdida');
  end if;

  perform public.mhd_import_upsert_rows(p_run_id, p_entity, p_rows);
  insert into public.mhd_catalog_import_pages (run_id, entity, part, page, attempts, records, duration_ms, ok)
  values (p_run_id, p_entity, p_part, p_page, p_attempts, v_n, p_duration_ms, true);

  v_prog := coalesce(v_run.entity_progress->p_entity, '{}'::jsonb);
  v_part_done := coalesce((v_prog->'part_done'->>p_part::text)::integer, 0) + v_n;
  v_prog := v_prog
    || jsonb_build_object('part_done', coalesce(v_prog->'part_done', '{}'::jsonb) || jsonb_build_object(p_part::text, v_part_done))
    || jsonb_build_object('part_total', coalesce(v_prog->'part_total', '{}'::jsonb) || jsonb_build_object(p_part::text, p_total))
    || jsonb_build_object('pages', coalesce((v_prog->>'pages')::integer, 0) + 1);
  select coalesce(sum(value::integer), 0) into v_done from jsonb_each_text(v_prog->'part_done');
  select coalesce(sum(value::integer), 0) into v_total from jsonb_each_text(v_prog->'part_total');
  v_prog := v_prog || jsonb_build_object('done', v_done, 'total', v_total);

  v_entity_index := (v_run.cursor->>'entity_index')::integer;
  if v_n = 0 or v_part_done >= p_total then
    if p_part + 1 < public.mhd_import_parts(p_entity) then
      v_cursor := jsonb_build_object('entity_index', v_entity_index, 'part', p_part + 1, 'page', 1, 'failures', 0);
    else
      v_finished_entity := true;
      v_prog := v_prog || jsonb_build_object('completed_at', now());
      v_cursor := jsonb_build_object('entity_index', v_entity_index + 1, 'part', 0, 'page', 1, 'failures', 0);
    end if;
  else
    v_cursor := jsonb_build_object('entity_index', v_entity_index, 'part', p_part, 'page', p_page + 1, 'failures', 0);
  end if;

  update public.mhd_catalog_import_runs
     set cursor = v_cursor, entity_progress = jsonb_set(entity_progress, array[p_entity], v_prog),
         record_counts = record_counts || jsonb_build_object(p_entity, v_done),
         last_activity_at = now(), lease_token = null, lease_until = null
   where id = p_run_id;

  if v_finished_entity and p_entity = 'products' then
    v_error := public.mhd_import_apply_absences(p_run_id, v_total);
    if v_error is not null then
      perform public.mhd_import_finish(p_run_id, 'failed', v_error);
      return jsonb_build_object('next', 'none', 'reason', v_error);
    end if;
  end if;

  if v_entity_index + 1 >= array_length(v_run.entities, 1) and v_finished_entity then
    update public.mhd_catalog_import_runs set progress = jsonb_build_object('phase', 'completed') where id = p_run_id;
    perform public.mhd_import_finish(p_run_id, 'completed');
    return jsonb_build_object('next', 'none', 'reason', 'completada');
  end if;
  if v_run.stop_requested then
    perform public.mhd_import_finish(p_run_id, 'stopped');
    return jsonb_build_object('next', 'none', 'reason', 'detenida');
  end if;
  perform public.mhd_import_kick(p_run_id);
  return jsonb_build_object('next', 'continue');
end; $$;

-- Una página no se ha podido leer tras sus reintentos. Se reintenta la misma
-- página hasta 3 veces (cada vez con 3 intentos); después la ejecución falla.
create or replace function public.mhd_import_page_failed(
  p_run_id uuid, p_lease_token uuid, p_entity text, p_part integer, p_page integer,
  p_attempts integer, p_duration_ms integer, p_error text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_run public.mhd_catalog_import_runs%rowtype; v_failures integer;
begin
  select * into v_run from public.mhd_catalog_import_runs where id = p_run_id for update;
  if not found or v_run.status <> 'running' or v_run.lease_token is distinct from p_lease_token then
    return jsonb_build_object('next', 'none', 'reason', 'reserva perdida');
  end if;
  insert into public.mhd_catalog_import_pages (run_id, entity, part, page, attempts, duration_ms, ok, error)
  values (p_run_id, p_entity, p_part, p_page, p_attempts, p_duration_ms, false, left(p_error, 2000));
  v_failures := coalesce((v_run.cursor->>'failures')::integer, 0) + 1;
  update public.mhd_catalog_import_runs
     set cursor = cursor || jsonb_build_object('failures', v_failures), last_activity_at = now(), lease_token = null, lease_until = null
   where id = p_run_id;
  if v_failures >= 3 then
    perform public.mhd_import_finish(p_run_id, 'failed', format('%s, página %s: %s', p_entity, p_page, left(p_error, 500)));
    return jsonb_build_object('next', 'none', 'reason', 'fallida');
  end if;
  if v_run.stop_requested then
    perform public.mhd_import_finish(p_run_id, 'stopped');
    return jsonb_build_object('next', 'none', 'reason', 'detenida');
  end if;
  perform public.mhd_import_kick(p_run_id);
  return jsonb_build_object('next', 'retry', 'failures', v_failures);
end; $$;

-- Llamadas de la pantalla (usuario con sesión) -------------------------------

create or replace function public.mhd_import_start(p_kind text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_entities text[]; v_estimated jsonb;
begin
  if (select auth.uid()) is null then raise exception 'Necesitas iniciar sesión'; end if;
  v_entities := case p_kind
    when 'full' then array['categories', 'brands', 'products', 'prices', 'stock']
    when 'categories' then array['categories'] when 'brands' then array['brands']
    when 'products' then array['products'] when 'prices' then array['prices'] when 'stock' then array['stock'] end;
  if v_entities is null then raise exception 'Tipo de importación no válido'; end if;
  -- Estimación del total de cada entidad hasta que MHD diga el suyo.
  v_estimated := jsonb_build_object(
    'categories', jsonb_build_object('estimated', (select count(*) from public.mhd_catalog_categories)),
    'brands', jsonb_build_object('estimated', (select count(*) from public.mhd_catalog_brands)),
    'products', jsonb_build_object('estimated', (select count(*) from public.mhd_catalog_products where presence_status = 'present')),
    'prices', jsonb_build_object('estimated', (select count(*) from public.mhd_catalog_prices)),
    'stock', jsonb_build_object('estimated', (select count(*) from public.mhd_catalog_stock)));
  begin
    insert into public.mhd_catalog_import_runs (kind, entities, entity_progress, status, started_by, last_activity_at)
    select p_kind, v_entities, jsonb_object_agg(e, v_estimated->e), 'running', auth.uid(), now()
      from unnest(v_entities) e
    returning id into v_id;
  exception when unique_violation then
    raise exception 'Ya hay una importación de MHD en curso o detenida: reanúdala o descártala antes de lanzar otra.';
  end;
  perform public.mhd_import_set_watchdog(true);
  perform public.mhd_import_kick(v_id);
  return v_id;
end; $$;

create or replace function public.mhd_import_stop(p_run_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if (select auth.uid()) is null then raise exception 'Necesitas iniciar sesión'; end if;
  update public.mhd_catalog_import_runs set stop_requested = true where id = p_run_id and status = 'running';
  -- Si no hay ninguna página en marcha, se detiene ya; si la hay, al acabarla.
  if exists (select 1 from public.mhd_catalog_import_runs where id = p_run_id and status = 'running' and (lease_until is null or lease_until < now())) then
    perform public.mhd_import_finish(p_run_id, 'stopped');
  end if;
end; $$;

create or replace function public.mhd_import_resume(p_run_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if (select auth.uid()) is null then raise exception 'Necesitas iniciar sesión'; end if;
  begin
    -- rate_from / rate_done: el ritmo de la pantalla se mide desde la reanudación.
    update public.mhd_catalog_import_runs
       set status = 'running', stop_requested = false, error_message = null, completed_at = null,
           cursor = cursor || jsonb_build_object('failures', 0), last_activity_at = now(), lease_token = null, lease_until = null,
           entity_progress = jsonb_set(entity_progress, array[entities[(cursor->>'entity_index')::integer + 1]],
             coalesce(entity_progress->entities[(cursor->>'entity_index')::integer + 1], '{}'::jsonb)
             || jsonb_build_object('rate_from', now(), 'rate_done', coalesce((entity_progress->entities[(cursor->>'entity_index')::integer + 1]->>'done')::integer, 0)))
     where id = p_run_id and status in ('stopped', 'failed');
  exception when unique_violation then
    raise exception 'Ya hay otra importación de MHD en curso o detenida.';
  end;
  if not found then raise exception 'Solo se puede reanudar una importación detenida o fallida.'; end if;
  perform public.mhd_import_set_watchdog(true);
  perform public.mhd_import_kick(p_run_id);
end; $$;

create or replace function public.mhd_import_discard(p_run_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if (select auth.uid()) is null then raise exception 'Necesitas iniciar sesión'; end if;
  if not exists (select 1 from public.mhd_catalog_import_runs where id = p_run_id and status = 'stopped') then
    raise exception 'Solo se puede descartar una importación detenida.';
  end if;
  perform public.mhd_import_finish(p_run_id, 'discarded', 'Descartada a mano.');
end; $$;

-- Estado para la pantalla: últimas ejecuciones con sus páginas fallidas y el
-- recuento de bajas y reaparecidos.
create or replace function public.mhd_import_status(p_limit integer default 20)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if (select auth.uid()) is null then raise exception 'Necesitas iniciar sesión'; end if;
  return jsonb_build_object('now', now(), 'runs', coalesce((
    select jsonb_agg(to_jsonb(r) - 'lease_token' || jsonb_build_object(
      'page_errors', (select coalesce(jsonb_agg(jsonb_build_object('entity', p.entity, 'part', p.part, 'page', p.page, 'attempts', p.attempts, 'error', p.error, 'at', p.created_at) order by p.created_at desc), '[]'::jsonb)
                        from (select * from public.mhd_catalog_import_pages p where p.run_id = r.id and not p.ok order by p.created_at desc limit 20) p),
      'removed', (select count(*) from public.mhd_catalog_presence_changes c where c.run_id = r.id and c.change = 'baja'),
      'reappeared', (select count(*) from public.mhd_catalog_presence_changes c where c.run_id = r.id and c.change = 'reaparece')
    ) order by r.started_at desc)
    from (select * from public.mhd_catalog_import_runs order by started_at desc limit p_limit) r), '[]'::jsonb));
end; $$;

create or replace function public.mhd_import_presence_changes(p_run_id uuid)
returns table (codigo text, change text, titulo text, nombre_marca text, detected_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if (select auth.uid()) is null then raise exception 'Necesitas iniciar sesión'; end if;
  return query select c.codigo, c.change, c.titulo, c.nombre_marca, c.detected_at
    from public.mhd_catalog_presence_changes c where c.run_id = p_run_id order by c.change, c.codigo;
end; $$;

-- Permisos ----------------------------------------------------------------

revoke all on function
  public.mhd_import_parts(text), public.mhd_import_kick(uuid), public.mhd_import_set_watchdog(boolean),
  public.mhd_import_watchdog(), public.mhd_import_finish(uuid, text, text),
  public.mhd_import_apply_absences(uuid, integer), public.mhd_import_upsert_rows(uuid, text, jsonb),
  public.mhd_import_token_valid(text), public.mhd_import_claim(uuid),
  public.mhd_import_ingest_page(uuid, uuid, text, integer, integer, integer, jsonb, integer, integer),
  public.mhd_import_page_failed(uuid, uuid, text, integer, integer, integer, integer, text),
  public.mhd_import_start(text), public.mhd_import_stop(uuid), public.mhd_import_resume(uuid),
  public.mhd_import_discard(uuid), public.mhd_import_status(integer), public.mhd_import_presence_changes(uuid)
from public, anon, authenticated;

grant execute on function
  public.mhd_import_token_valid(text), public.mhd_import_claim(uuid),
  public.mhd_import_ingest_page(uuid, uuid, text, integer, integer, integer, jsonb, integer, integer),
  public.mhd_import_page_failed(uuid, uuid, text, integer, integer, integer, integer, text)
to service_role;

grant execute on function
  public.mhd_import_start(text), public.mhd_import_stop(uuid), public.mhd_import_resume(uuid),
  public.mhd_import_discard(uuid), public.mhd_import_status(integer), public.mhd_import_presence_changes(uuid)
to authenticated;
