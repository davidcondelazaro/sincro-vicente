alter table public.catalog_import_events
  drop constraint if exists catalog_import_events_outcome_check;

alter table public.catalog_import_events
  add constraint catalog_import_events_outcome_check
  check (outcome in ('created', 'updated', 'unchanged', 'unpublished', 'error', 'status'));
