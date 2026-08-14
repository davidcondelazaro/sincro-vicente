alter table public.catalog_import_events
  add column if not exists details jsonb;
