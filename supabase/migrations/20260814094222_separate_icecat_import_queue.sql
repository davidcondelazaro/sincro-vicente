create extension if not exists pgmq;

select pgmq.create('icecat_import_jobs');

alter table public.catalog_import_runs
  add column if not exists queue_name text not null default 'catalog_import_jobs';

alter table public.catalog_import_runs
  add constraint catalog_import_runs_queue_name_check
  check (queue_name in ('catalog_import_jobs', 'icecat_import_jobs'));

create or replace function public.start_catalog_import(p_entity_type text, p_filters jsonb default '{}'::jsonb)
returns public.catalog_import_runs
language plpgsql
security definer
set search_path = pg_catalog, public, pgmq
as $$
declare
  v_owner_id uuid := (select auth.uid());
  v_filters jsonb := coalesce(p_filters, '{}'::jsonb);
  v_total integer;
  v_run public.catalog_import_runs;
  v_message_id bigint;
  v_queue_name text := case when p_entity_type = 'icecat' then 'icecat_import_jobs' else 'catalog_import_jobs' end;
begin
  if v_owner_id is null then raise exception 'Necesitas iniciar sesión'; end if;
  if p_entity_type not in ('manufacturers', 'categories', 'features', 'products', 'icecat') then raise exception 'Entidad no disponible'; end if;
  if jsonb_typeof(v_filters) <> 'object' then raise exception 'Filtros no válidos'; end if;

  if p_entity_type = 'manufacturers' then
    select count(*) into v_total from public.source_manufacturers x
    where (coalesce((v_filters ->> 'onlyActive')::boolean, true) is false or x.active is true)
      and (nullif(v_filters ->> 'manufacturerId', '') is null or x.id = v_filters ->> 'manufacturerId');
  elsif p_entity_type = 'categories' then
    select count(*) into v_total from public.source_categories x
    where nullif(v_filters ->> 'categoryId', '') is null or x.id = v_filters ->> 'categoryId';
  elsif p_entity_type = 'features' then
    select count(*) into v_total from public.source_features x
    where x.id not in ('10603','10604','10606','10607','10608','10609','10593','10454','10421','10419','10420','10530','10543','10428','PORTESGRATIS','DESCATALOGADO','OFERTA','SUPEROFERTA','PRECIOOCULTO','PRIORIDAD')
      and (nullif(v_filters ->> 'featureId', '') is null or x.id = v_filters ->> 'featureId');
  elsif p_entity_type = 'products' then
    select count(*) into v_total from public.source_products x
    where (coalesce((v_filters ->> 'onlyActive')::boolean, false) is false or x.active is true)
      and ((jsonb_typeof(v_filters -> 'productIds') = 'array' and x.id in (select jsonb_array_elements_text(v_filters -> 'productIds')))
        or (jsonb_typeof(v_filters -> 'productIds') <> 'array' and (nullif(v_filters ->> 'productId', '') is null or x.id = v_filters ->> 'productId')))
      and (nullif(v_filters ->> 'modifiedSince', '') is null or x.fecha_modificacion::timestamptz >= (v_filters ->> 'modifiedSince')::timestamptz);
  else
    if jsonb_typeof(v_filters -> 'productIds') = 'array' or jsonb_typeof(v_filters -> 'eans') = 'array' then
      select coalesce(jsonb_array_length(v_filters -> 'productIds'), 0) + coalesce(jsonb_array_length(v_filters -> 'eans'), 0) into v_total;
    else
      select count(*) into v_total from public.source_products x where nullif(trim(x.ean13), '') is not null;
    end if;
  end if;
  if v_total = 0 then
    if p_entity_type = 'icecat' then raise exception 'No hay productos con EAN para el criterio indicado';
    else raise exception 'No hay registros para el criterio indicado'; end if;
  end if;

  insert into public.catalog_import_runs(owner_id, entity_type, filters, total_count, queue_name)
  values (v_owner_id, p_entity_type, v_filters, v_total, v_queue_name)
  returning * into v_run;
  select * into v_message_id from pgmq.send(v_queue_name, jsonb_build_object('run_id', v_run.id));
  update public.catalog_import_runs set queue_message_id = v_message_id where id = v_run.id returning * into v_run;
  return v_run;
end;
$$;

create or replace function public.read_icecat_import_message()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pgmq
as $$
declare v_message jsonb;
begin
  if coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role' then raise exception 'Acceso no autorizado'; end if;
  select to_jsonb(message_record) into v_message from pgmq.read('icecat_import_jobs', 300, 1) as message_record limit 1;
  return v_message;
end;
$$;

create or replace function public.archive_icecat_import_message(p_message_id bigint)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, pgmq
as $$
begin
  if coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role' then raise exception 'Acceso no autorizado'; end if;
  return pgmq.archive('icecat_import_jobs', p_message_id);
end;
$$;

create or replace function public.set_catalog_import_status(p_run_id uuid, p_status text)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public, pgmq
as $$
declare v_owner_id uuid; v_status text; v_message_id bigint; v_queue_name text; v_message text;
begin
  select owner_id, status, queue_message_id, queue_name into v_owner_id, v_status, v_message_id, v_queue_name
  from public.catalog_import_runs where id = p_run_id for update;
  if not found or v_owner_id <> (select auth.uid()) then raise exception 'Ejecución no autorizada'; end if;
  if p_status = 'paused' and v_status in ('queued', 'running') then
    update public.catalog_import_runs set status = 'paused', updated_at = now() where id = p_run_id;
    v_message := 'Importación pausada por el usuario.';
  elsif p_status = 'stopped' and v_status in ('queued', 'running', 'paused') then
    update public.catalog_import_runs set status = 'stopped', finished_at = now(), updated_at = now() where id = p_run_id;
    if v_message_id is not null then perform pgmq.archive(v_queue_name, v_message_id); end if;
    v_message := 'Importación detenida por el usuario.';
  elsif p_status = 'queued' and v_status = 'paused' then
    update public.catalog_import_runs set status = 'queued', updated_at = now() where id = p_run_id;
    if v_message_id is not null then perform pgmq.set_vt(v_queue_name, v_message_id, 0); end if;
    v_message := 'Importación reanudada por el usuario.';
  else
    raise exception 'Cambio de estado no permitido';
  end if;
  insert into public.catalog_import_events (run_id, level, outcome, entity_type, message)
  values (p_run_id, 'info', 'status', (select entity_type from public.catalog_import_runs where id = p_run_id), v_message);
  return p_status;
end;
$$;

revoke all on function public.read_icecat_import_message() from public, anon, authenticated;
grant execute on function public.read_icecat_import_message() to service_role;
revoke all on function public.archive_icecat_import_message(bigint) from public, anon, authenticated;
grant execute on function public.archive_icecat_import_message(bigint) to service_role;
