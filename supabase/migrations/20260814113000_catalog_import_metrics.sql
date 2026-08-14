alter table public.catalog_import_runs
  add column unchanged_count integer not null default 0 check (unchanged_count >= 0),
  add column unpublished_count integer not null default 0 check (unpublished_count >= 0);

update public.catalog_import_runs run
set
  unchanged_count = counts.unchanged_count,
  unpublished_count = counts.unpublished_count
from (
  select
    event.run_id,
    count(*) filter (where event.message like 'La colección ya existía y está activa:%' or event.message like 'Categoría inactiva (o con padre inactivo): no existe%')::integer as unchanged_count,
    count(*) filter (where event.message like 'Categoría inactiva (o con padre inactivo): retirada%')::integer as unpublished_count
  from public.catalog_import_events event
  group by event.run_id
) counts
where run.id = counts.run_id;
