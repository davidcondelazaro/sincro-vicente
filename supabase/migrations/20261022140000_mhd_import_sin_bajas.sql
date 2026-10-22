-- Importación MHD sin bajas (2026-10-22).
--
-- Decisión de David: mientras no se procese nada de este catálogo en Shopify,
-- la importación no marca bajas ni reaparecidos; queda pendiente (ver
-- docs/IMPORTACION_CATALOGO_MHD.md). Se retiran la comparación al terminar los
-- productos, la tabla de bajas por ejecución y su consulta. Las columnas
-- presence_status / absent_since de mhd_catalog_products ya existían y se
-- conservan.

drop function if exists public.mhd_import_apply_absences(uuid, integer);
drop function if exists public.mhd_import_presence_changes(uuid);
drop table if exists public.mhd_catalog_presence_changes;
alter table public.mhd_catalog_import_runs drop column if exists absences_applied;

create or replace function public.mhd_import_upsert_rows(p_run_id uuid, p_entity text, p_rows jsonb)
returns integer language plpgsql security definer set search_path = public, extensions as $$
declare v_now timestamptz := now(); v_count integer;
begin
  if p_entity = 'products' then
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

create or replace function public.mhd_import_ingest_page(
  p_run_id uuid, p_lease_token uuid, p_entity text, p_part integer, p_page integer,
  p_total integer, p_rows jsonb, p_attempts integer, p_duration_ms integer)
returns jsonb language plpgsql security definer set search_path = public set statement_timeout = '120s' as $$
declare
  v_run public.mhd_catalog_import_runs%rowtype; v_n integer := jsonb_array_length(p_rows);
  v_prog jsonb; v_part_done integer; v_cursor jsonb; v_entity_index integer; v_done integer; v_total integer;
  v_finished_entity boolean := false;
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

create or replace function public.mhd_import_status(p_limit integer default 20)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if (select auth.uid()) is null then raise exception 'Necesitas iniciar sesión'; end if;
  return jsonb_build_object('now', now(), 'runs', coalesce((
    select jsonb_agg(to_jsonb(r) - 'lease_token' || jsonb_build_object(
      'page_errors', (select coalesce(jsonb_agg(jsonb_build_object('entity', p.entity, 'part', p.part, 'page', p.page, 'attempts', p.attempts, 'error', p.error, 'at', p.created_at) order by p.created_at desc), '[]'::jsonb)
                        from (select * from public.mhd_catalog_import_pages p where p.run_id = r.id and not p.ok order by p.created_at desc limit 20) p)
    ) order by r.started_at desc)
    from (select * from public.mhd_catalog_import_runs order by started_at desc limit p_limit) r), '[]'::jsonb));
end; $$;

revoke all on function public.mhd_import_upsert_rows(uuid, text, jsonb), public.mhd_import_status(integer),
  public.mhd_import_ingest_page(uuid, uuid, text, integer, integer, integer, jsonb, integer, integer)
from public, anon, authenticated;
grant execute on function public.mhd_import_ingest_page(uuid, uuid, text, integer, integer, integer, jsonb, integer, integer) to service_role;
grant execute on function public.mhd_import_status(integer) to authenticated;

-- La importación de productos del 22-10 (12:52) leyó todo bien; solo la paró
-- el freno de las bajas, que ya no existe.
update public.mhd_catalog_import_runs
   set status = 'completed', error_message = null, progress = jsonb_build_object('phase', 'completed')
 where status = 'failed' and error_message like 'Saldrían % bajas de % productos%';
