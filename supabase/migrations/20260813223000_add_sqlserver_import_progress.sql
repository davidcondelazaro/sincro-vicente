alter table public.source_sqlserver_import_runs
  add column progress jsonb not null default '{}'::jsonb;
