alter table public.catalog_import_runs
  drop constraint catalog_import_runs_entity_type_check,
  add constraint catalog_import_runs_entity_type_check check (entity_type in ('manufacturers', 'categories'));

alter table public.catalog_import_events
  drop constraint catalog_import_events_entity_type_check,
  add constraint catalog_import_events_entity_type_check check (entity_type in ('manufacturers', 'categories'));

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
begin
  if v_owner_id is null then raise exception 'Necesitas iniciar sesión'; end if;
  if p_entity_type not in ('manufacturers', 'categories') then raise exception 'Entidad no disponible'; end if;
  if jsonb_typeof(v_filters) <> 'object' then raise exception 'Filtros no válidos'; end if;

  if p_entity_type = 'manufacturers' then
    select count(*) into v_total
    from public.source_manufacturers manufacturer
    where (coalesce((v_filters ->> 'onlyActive')::boolean, true) is false or manufacturer.active is true)
      and (nullif(v_filters ->> 'manufacturerId', '') is null or manufacturer.id = v_filters ->> 'manufacturerId')
      and (nullif(v_filters ->> 'name', '') is null or manufacturer.name ilike '%' || (v_filters ->> 'name') || '%');
  else
    select count(*) into v_total
    from public.source_categories category
    where (nullif(v_filters ->> 'categoryId', '') is null or category.id = v_filters ->> 'categoryId')
      and (nullif(v_filters ->> 'name', '') is null or category.name ilike '%' || (v_filters ->> 'name') || '%');
  end if;

  if v_total = 0 then raise exception 'No hay registros para el criterio indicado'; end if;
  insert into public.catalog_import_runs (owner_id, entity_type, filters, total_count)
  values (v_owner_id, p_entity_type, v_filters, v_total)
  returning * into v_run;
  select * into v_message_id from pgmq.send('catalog_import_jobs', jsonb_build_object('run_id', v_run.id));
  update public.catalog_import_runs set queue_message_id = v_message_id where id = v_run.id returning * into v_run;
  return v_run;
end;
$$;
