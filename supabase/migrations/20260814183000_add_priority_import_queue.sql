-- La ordenación de colecciones tiene su propia cola para no bloquear
-- importaciones de catálogo ni de Icecat.
create extension if not exists pgmq;
select pgmq.create('priority_import_jobs');

alter table public.catalog_import_runs
  drop constraint if exists catalog_import_runs_entity_type_check,
  add constraint catalog_import_runs_entity_type_check check (entity_type in ('manufacturers', 'categories', 'features', 'products', 'priorities', 'icecat'));

alter table public.catalog_import_events
  drop constraint if exists catalog_import_events_entity_type_check,
  add constraint catalog_import_events_entity_type_check check (entity_type in ('manufacturers', 'categories', 'features', 'products', 'priorities', 'icecat'));

alter table public.catalog_import_runs
  drop constraint if exists catalog_import_runs_queue_name_check,
  add constraint catalog_import_runs_queue_name_check check (queue_name in ('catalog_import_jobs', 'priority_import_jobs', 'icecat_import_jobs'));

create or replace function public.start_catalog_import(p_entity_type text, p_filters jsonb default '{}'::jsonb)
returns public.catalog_import_runs
language plpgsql security definer
set search_path = pg_catalog, public, pgmq
as $$
declare
  v_owner_id uuid := (select auth.uid());
  v_filters jsonb := coalesce(p_filters, '{}'::jsonb);
  v_total integer;
  v_run public.catalog_import_runs;
  v_message_id bigint;
  v_queue_name text := case
    when p_entity_type = 'icecat' then 'icecat_import_jobs'
    when p_entity_type = 'priorities' then 'priority_import_jobs'
    else 'catalog_import_jobs'
  end;
begin
  if v_owner_id is null then raise exception 'Necesitas iniciar sesión'; end if;
  if p_entity_type not in ('manufacturers', 'categories', 'features', 'products', 'priorities', 'icecat') then raise exception 'Entidad no disponible'; end if;
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
  elsif p_entity_type = 'priorities' then
    -- El worker obtiene el número real de colecciones desde Shopify antes de empezar.
    v_total := 1;
  else
    if jsonb_typeof(v_filters -> 'productIds') = 'array' or jsonb_typeof(v_filters -> 'eans') = 'array' then
      select coalesce(jsonb_array_length(v_filters -> 'productIds'), 0) + coalesce(jsonb_array_length(v_filters -> 'eans'), 0) into v_total;
    else
      select count(*) into v_total from public.source_products x where nullif(trim(x.ean13), '') is not null;
    end if;
  end if;
  if v_total = 0 and p_entity_type <> 'priorities' then
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

create or replace function public.read_priority_import_message()
returns jsonb language plpgsql security definer
set search_path = pg_catalog, public, pgmq
as $$
declare v_message jsonb;
begin
  if coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role' then raise exception 'Acceso no autorizado'; end if;
  select to_jsonb(message_record) into v_message from pgmq.read('priority_import_jobs', 300, 1) as message_record limit 1;
  return v_message;
end;
$$;

create or replace function public.archive_priority_import_message(p_message_id bigint)
returns boolean language plpgsql security definer
set search_path = pg_catalog, public, pgmq
as $$
begin
  if coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role' then raise exception 'Acceso no autorizado'; end if;
  return pgmq.archive('priority_import_jobs', p_message_id);
end;
$$;

revoke all on function public.read_priority_import_message() from public, anon, authenticated;
grant execute on function public.read_priority_import_message() to service_role;
revoke all on function public.archive_priority_import_message(bigint) from public, anon, authenticated;
grant execute on function public.archive_priority_import_message(bigint) to service_role;
