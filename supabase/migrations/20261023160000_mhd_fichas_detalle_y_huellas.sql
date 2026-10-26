-- Fichas de detalle de MHD y huellas de cambios (fase 2, decidido por David el 2026-10-23).
--
-- El listado /products no trae las características ni las fotos: solo vienen en la ficha de cada producto
-- (/products/:codigo). Aquí:
--   1. Se guarda el JSON entero de la ficha de cada producto (mhd_catalog_product_details).
--   2. Huellas separadas por partes, para saber QUÉ ha cambiado de un producto y actualizar en Shopify solo esa parte:
--      en el listado (mhd_catalog_products) contenido, imágenes, precio y stock; en la ficha, características y fotos.
--      Cada huella guarda cuándo cambió por última vez (*_cambiado_en).
--   3. Un tipo de importación nuevo, «details»: pide solo las fichas que faltan o cuya fecha de modificación de MHD ha
--      cambiado; «details_all» las pide todas. La importación completa añade las fichas al final.
-- Ver docs/IMPORTACION_FICHAS_MHD_Y_HUELLAS.md.

-- Huellas del listado -------------------------------------------------------------------------------------------------

alter table public.mhd_catalog_products
  add column hash_contenido text, add column contenido_cambiado_en timestamptz,
  add column hash_imagenes text, add column imagenes_cambiadas_en timestamptz,
  add column hash_precio text, add column precio_cambiado_en timestamptz,
  add column hash_stock text, add column stock_cambiado_en timestamptz;

-- Qué campos del JSON de MHD van en cada huella. El resto (título, descripciones, marca, árbol, EAN, modelo,
-- características…) es «contenido». La fecha de modificación del producto no cuenta: es un sello, no un dato.
create or replace function public.mhd_hash_parts(p jsonb)
returns jsonb language sql immutable set search_path = public, extensions as $$
  select jsonb_build_object(
    'precio', encode(digest((jsonb_build_object(
      'iva', p->'iva', 'pvp', p->'pvp', 'pvp_antes', p->'pvp_antes', 'triple_neto', p->'triple_neto',
      'gastos_envio_peninsula_particulares', p->'gastos_envio_peninsula_particulares', 'gastos_envio_baleares_particulares', p->'gastos_envio_baleares_particulares',
      'gastos_envio_portugal_baremo_1_particulares', p->'gastos_envio_portugal_baremo_1_particulares', 'gastos_envio_portugal_baremo_2_particulares', p->'gastos_envio_portugal_baremo_2_particulares',
      'subida_puerta_particulares', p->'subida_puerta_particulares', 'retirada_usado_particulares', p->'retirada_usado_particulares',
      'instalacion_particulares', p->'instalacion_particulares'))::text, 'sha256'), 'hex'),
    'stock', encode(digest((jsonb_build_object('stock', p->'stock'))::text, 'sha256'), 'hex'),
    'imagenes', encode(digest((jsonb_build_object('imagen', p->'imagen', 'img_ficha_eficiencia', p->'img_ficha_eficiencia', 'img_eficiencia', p->'img_eficiencia', 'fotos', p->'fotos'))::text, 'sha256'), 'hex'),
    'contenido', encode(digest((p - array['iva', 'pvp', 'pvp_antes', 'triple_neto', 'stock', 'imagen', 'img_ficha_eficiencia', 'img_eficiencia', 'fotos',
      'gastos_envio_peninsula_particulares', 'gastos_envio_baleares_particulares', 'gastos_envio_portugal_baremo_1_particulares', 'gastos_envio_portugal_baremo_2_particulares',
      'subida_puerta_particulares', 'retirada_usado_particulares', 'instalacion_particulares',
      'fecha_modificacion_producto', 'fecha_modificacion_precio', 'fecha_modificacion_stock'])::text, 'sha256'), 'hex'))
$$;

create or replace function public.mhd_catalog_products_hashes()
returns trigger language plpgsql set search_path = public as $$
declare h jsonb := public.mhd_hash_parts(new.source_payload);
begin
  new.hash_contenido := h->>'contenido'; new.hash_imagenes := h->>'imagenes'; new.hash_precio := h->>'precio'; new.hash_stock := h->>'stock';
  -- Solo se marca el cambio si había una huella anterior distinta (un producto nuevo no «cambia»).
  if tg_op = 'UPDATE' then
    if old.hash_contenido is not null and old.hash_contenido <> new.hash_contenido then new.contenido_cambiado_en := now(); end if;
    if old.hash_imagenes is not null and old.hash_imagenes <> new.hash_imagenes then new.imagenes_cambiadas_en := now(); end if;
    if old.hash_precio is not null and old.hash_precio <> new.hash_precio then new.precio_cambiado_en := now(); end if;
    if old.hash_stock is not null and old.hash_stock <> new.hash_stock then new.stock_cambiado_en := now(); end if;
  end if;
  return new;
end; $$;

create trigger mhd_catalog_products_hashes before insert or update of source_payload on public.mhd_catalog_products
  for each row execute function public.mhd_catalog_products_hashes();

-- Huellas de los productos que ya hay (sin marcar cambios).
update public.mhd_catalog_products set source_payload = source_payload;

-- Fichas de detalle ---------------------------------------------------------------------------------------------------

create table public.mhd_catalog_product_details (
  codigo text primary key,
  source_payload jsonb,                           -- JSON entero de /products/:codigo (null si nunca se pudo leer)
  fecha_modificacion_producto text,               -- la de la ficha, para saber cuándo hay que volver a pedirla
  hash_ficha text,                                -- de la ficha entera
  hash_caracteristicas text, caracteristicas_cambiadas_en timestamptz,  -- características y descripción
  hash_fotos text, fotos_cambiadas_en timestamptz,                      -- lista de enlaces de las fotos e imagen
  fetched_at timestamptz,
  last_seen_run_id uuid,
  last_attempt_run_id uuid,
  last_error text,
  last_error_at timestamptz
);

create or replace function public.mhd_catalog_product_details_hashes()
returns trigger language plpgsql set search_path = public, extensions as $$
declare v_car text; v_fotos text;
begin
  if new.source_payload is null then return new; end if;
  new.fecha_modificacion_producto := new.source_payload->>'fecha_modificacion_producto';
  new.hash_ficha := encode(digest(new.source_payload::text, 'sha256'), 'hex');
  v_car := encode(digest((jsonb_build_object('caracteristicas', new.source_payload->'caracteristicas', 'descripcion', new.source_payload->'descripcion'))::text, 'sha256'), 'hex');
  v_fotos := encode(digest((jsonb_build_object('fotos', new.source_payload->'fotos', 'imagen', new.source_payload->'imagen'))::text, 'sha256'), 'hex');
  if tg_op = 'UPDATE' then
    if old.hash_caracteristicas is not null and old.hash_caracteristicas <> v_car then new.caracteristicas_cambiadas_en := now(); end if;
    if old.hash_fotos is not null and old.hash_fotos <> v_fotos then new.fotos_cambiadas_en := now(); end if;
  end if;
  new.hash_caracteristicas := v_car; new.hash_fotos := v_fotos;
  return new;
end; $$;

create trigger mhd_catalog_product_details_hashes before insert or update of source_payload on public.mhd_catalog_product_details
  for each row execute function public.mhd_catalog_product_details_hashes();

alter table public.mhd_catalog_product_details enable row level security;
revoke all on table public.mhd_catalog_product_details from anon, authenticated;
grant select, insert, update, delete on table public.mhd_catalog_product_details to service_role;

-- Cambios por producto, para las actualizaciones por partes: qué ha cambiado y cuándo.
create or replace view public.mhd_catalog_product_changes with (security_invoker = true) as
  select p.codigo, p.presence_status,
         p.contenido_cambiado_en, p.imagenes_cambiadas_en, p.precio_cambiado_en, p.stock_cambiado_en,
         d.caracteristicas_cambiadas_en, d.fotos_cambiadas_en, d.fetched_at as ficha_leida_en,
         (d.codigo is null or d.source_payload is null) as sin_ficha,
         (d.fecha_modificacion_producto is distinct from p.fecha_modificacion_producto) as ficha_desactualizada
    from public.mhd_catalog_products p left join public.mhd_catalog_product_details d using (codigo);
revoke all on public.mhd_catalog_product_changes from anon, authenticated;
grant select on public.mhd_catalog_product_changes to service_role;

-- Importación de fichas en el motor por páginas -------------------------------------------------------------------------

alter table public.mhd_catalog_import_runs drop constraint if exists mhd_catalog_import_runs_kind_check;
alter table public.mhd_catalog_import_runs add constraint mhd_catalog_import_runs_kind_check
  check (kind in ('full', 'categories', 'brands', 'products', 'prices', 'stock', 'details', 'details_all'));

-- Fichas que faltan en una ejecución: las que no hay, las de fecha de modificación distinta a la del listado y, en
-- «details_all», todas las que esta ejecución aún no ha leído. No se repite en la misma ejecución una que ya falló.
-- Las que MHD no tiene (404) no se vuelven a pedir mientras no cambie su fecha de modificación en el listado: sin
-- ficha no hay características ni, por tanto, filtros (David, 2026-10-23).
-- Fuera el merchandising (S95) y los servicios (S93), que no se importan.
create or replace function public.mhd_import_detail_pending(p_run_id uuid)
returns table (codigo text) language sql stable security definer set search_path = public as $$
  select p.codigo
    from public.mhd_catalog_products p
    left join public.mhd_catalog_product_details d on d.codigo = p.codigo
    cross join (select kind from public.mhd_catalog_import_runs where id = p_run_id) r
   where p.presence_status = 'present' and coalesce(p.cod_familia, '') not in ('S95', 'S93')
     and d.last_attempt_run_id is distinct from p_run_id
     and (d.codigo is null
          or (d.source_payload is null and not (d.last_error like '%(404)%' and d.fecha_modificacion_producto is not distinct from p.fecha_modificacion_producto))
          or d.fecha_modificacion_producto is distinct from p.fecha_modificacion_producto
          or r.kind = 'details_all')
   order by p.codigo
$$;

-- Siguiente tanda de códigos para la función (con la reserva de la ejecución).
create or replace function public.mhd_import_detail_batch(p_run_id uuid, p_lease_token uuid, p_limit integer)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_run public.mhd_catalog_import_runs%rowtype; v_codes text[]; v_pending integer; v_prog jsonb;
begin
  select * into v_run from public.mhd_catalog_import_runs where id = p_run_id for update;
  if not found or v_run.status <> 'running' or v_run.lease_token is distinct from p_lease_token then return null; end if;
  select count(*) into v_pending from public.mhd_import_detail_pending(p_run_id);
  select array_agg(codigo) into v_codes from (select codigo from public.mhd_import_detail_pending(p_run_id) limit p_limit) x;
  -- Total de la ejecución: lo que ya lleva más lo que falta (se fija la primera vez).
  v_prog := coalesce(v_run.entity_progress->'details', '{}'::jsonb);
  if not v_prog ? 'total' or (v_prog->>'total')::integer < coalesce((v_prog->>'done')::integer, 0) + v_pending then
    v_prog := v_prog || jsonb_build_object('total', coalesce((v_prog->>'done')::integer, 0) + v_pending);
    update public.mhd_catalog_import_runs set entity_progress = jsonb_set(entity_progress, array['details'], v_prog) where id = p_run_id;
  end if;
  return jsonb_build_object('codes', coalesce(to_jsonb(v_codes), '[]'::jsonb), 'pending', v_pending);
end; $$;

-- Guarda una tanda de fichas (las leídas y las fallidas), avanza y encadena la siguiente.
create or replace function public.mhd_import_ingest_details(
  p_run_id uuid, p_lease_token uuid, p_rows jsonb, p_failed jsonb, p_duration_ms integer)
returns jsonb language plpgsql security definer set search_path = public set statement_timeout = '120s' as $$
declare
  v_run public.mhd_catalog_import_runs%rowtype; v_ok integer := jsonb_array_length(p_rows); v_ko integer := jsonb_array_length(p_failed);
  v_prog jsonb; v_pending integer; v_entity_index integer; v_now timestamptz := now(); v_missing integer;
begin
  select * into v_run from public.mhd_catalog_import_runs where id = p_run_id for update;
  if not found or v_run.status <> 'running' or v_run.lease_token is distinct from p_lease_token then
    return jsonb_build_object('next', 'none', 'reason', 'reserva perdida');
  end if;

  insert into public.mhd_catalog_product_details (codigo, source_payload, fetched_at, last_seen_run_id, last_attempt_run_id, last_error, last_error_at)
  select r->>'codigo', r, v_now, p_run_id, p_run_id, null, null from jsonb_array_elements(p_rows) r
  on conflict (codigo) do update set source_payload = excluded.source_payload, fetched_at = excluded.fetched_at,
    last_seen_run_id = excluded.last_seen_run_id, last_attempt_run_id = excluded.last_attempt_run_id, last_error = null, last_error_at = null;

  -- En las 404 se apunta la fecha de modificación del listado: hasta que cambie, no se vuelven a pedir.
  insert into public.mhd_catalog_product_details (codigo, fecha_modificacion_producto, last_attempt_run_id, last_error, last_error_at)
  select f->>'codigo', case when f->>'error' like '%(404)%' then p.fecha_modificacion_producto end, p_run_id, left(f->>'error', 500), v_now
    from jsonb_array_elements(p_failed) f left join public.mhd_catalog_products p on p.codigo = f->>'codigo'
  on conflict (codigo) do update set fecha_modificacion_producto = case when public.mhd_catalog_product_details.source_payload is null then excluded.fecha_modificacion_producto else public.mhd_catalog_product_details.fecha_modificacion_producto end,
    last_attempt_run_id = excluded.last_attempt_run_id, last_error = excluded.last_error, last_error_at = excluded.last_error_at;

  v_prog := coalesce(v_run.entity_progress->'details', '{}'::jsonb);
  v_prog := v_prog || jsonb_build_object('done', coalesce((v_prog->>'done')::integer, 0) + v_ok + v_ko,
                                         'failed', coalesce((v_prog->>'failed')::integer, 0) + v_ko,  -- incluye las 404
                                         'pages', coalesce((v_prog->>'pages')::integer, 0) + 1);
  -- Las que MHD no tiene (404) se cuentan aparte: no son un fallo de la tanda.
  v_missing := (select count(*) from jsonb_array_elements(p_failed) f where f->>'error' like '%(404)%');
  v_prog := v_prog || jsonb_build_object('missing', coalesce((v_prog->>'missing')::integer, 0) + v_missing);
  insert into public.mhd_catalog_import_pages (run_id, entity, part, page, attempts, records, duration_ms, ok, error)
  values (p_run_id, 'details', 0, (v_prog->>'pages')::integer, 1, v_ok, p_duration_ms, v_ko = v_missing,
          case when v_ko > v_missing then format('%s fichas sin leer: %s', v_ko - v_missing, left((select string_agg((f->>'codigo') || ' (' || (f->>'error') || ')', ', ') from jsonb_array_elements(p_failed) f where f->>'error' not like '%(404)%'), 1500)) end);

  select count(*) into v_pending from public.mhd_import_detail_pending(p_run_id);
  v_entity_index := (v_run.cursor->>'entity_index')::integer;
  if v_pending = 0 then
    v_prog := v_prog || jsonb_build_object('completed_at', v_now);
    update public.mhd_catalog_import_runs
       set cursor = jsonb_build_object('entity_index', v_entity_index + 1, 'part', 0, 'page', 1, 'failures', 0),
           entity_progress = jsonb_set(entity_progress, array['details'], v_prog),
           record_counts = record_counts || jsonb_build_object('details', (v_prog->>'done')::integer),
           last_activity_at = v_now, lease_token = null, lease_until = null
     where id = p_run_id;
    if v_entity_index + 1 >= array_length(v_run.entities, 1) then
      update public.mhd_catalog_import_runs set progress = jsonb_build_object('phase', 'completed') where id = p_run_id;
      perform public.mhd_import_finish(p_run_id, 'completed',
        nullif(concat_ws(' ',
          case when coalesce((v_prog->>'failed')::integer, 0) > coalesce((v_prog->>'missing')::integer, 0) then format('%s fichas no se pudieron leer (ver errores; se reintentan en la próxima importación de fichas).', (v_prog->>'failed')::integer - (v_prog->>'missing')::integer) end,
          case when coalesce((v_prog->>'missing')::integer, 0) > 0 then format('MHD no tiene ficha de %s productos del listado.', v_prog->>'missing') end), ''));
      return jsonb_build_object('next', 'none', 'reason', 'completada');
    end if;
  else
    update public.mhd_catalog_import_runs
       set cursor = cursor || jsonb_build_object('page', (v_prog->>'pages')::integer + 1, 'failures', 0),
           entity_progress = jsonb_set(entity_progress, array['details'], v_prog),
           record_counts = record_counts || jsonb_build_object('details', (v_prog->>'done')::integer),
           last_activity_at = v_now, lease_token = null, lease_until = null
     where id = p_run_id;
  end if;
  if v_run.stop_requested then
    perform public.mhd_import_finish(p_run_id, 'stopped');
    return jsonb_build_object('next', 'none', 'reason', 'detenida');
  end if;
  perform public.mhd_import_kick(p_run_id);
  return jsonb_build_object('next', 'continue', 'pending', v_pending);
end; $$;

-- Arranque: los tipos nuevos y la completa con fichas al final.
create or replace function public.mhd_import_start(p_kind text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_entities text[]; v_estimated jsonb;
begin
  if (select auth.uid()) is null then raise exception 'Necesitas iniciar sesión'; end if;
  v_entities := case p_kind
    when 'full' then array['categories', 'brands', 'products', 'prices', 'stock', 'details']
    when 'categories' then array['categories'] when 'brands' then array['brands']
    when 'products' then array['products'] when 'prices' then array['prices'] when 'stock' then array['stock']
    when 'details' then array['details'] when 'details_all' then array['details'] end;
  if v_entities is null then raise exception 'Tipo de importación no válido'; end if;
  v_estimated := jsonb_build_object(
    'categories', jsonb_build_object('estimated', (select count(*) from public.mhd_catalog_categories)),
    'brands', jsonb_build_object('estimated', (select count(*) from public.mhd_catalog_brands)),
    'products', jsonb_build_object('estimated', (select count(*) from public.mhd_catalog_products where presence_status = 'present')),
    'prices', jsonb_build_object('estimated', (select count(*) from public.mhd_catalog_prices)),
    'stock', jsonb_build_object('estimated', (select count(*) from public.mhd_catalog_stock)),
    'details', jsonb_build_object('estimated', (select count(*) from public.mhd_catalog_products where presence_status = 'present' and coalesce(cod_familia, '') not in ('S95', 'S93'))));
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

revoke all on function public.mhd_hash_parts(jsonb), public.mhd_import_detail_pending(uuid),
  public.mhd_import_detail_batch(uuid, uuid, integer), public.mhd_import_ingest_details(uuid, uuid, jsonb, jsonb, integer),
  public.mhd_import_start(text)
from public, anon, authenticated;
grant execute on function public.mhd_import_detail_batch(uuid, uuid, integer), public.mhd_import_ingest_details(uuid, uuid, jsonb, jsonb, integer) to service_role;
grant execute on function public.mhd_import_start(text) to authenticated;
