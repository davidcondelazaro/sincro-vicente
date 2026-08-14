create table public.source_sqlserver_import_runs (
  id uuid primary key default gen_random_uuid(),
  source_name text not null,
  table_names text[] not null,
  status text not null default 'running' check (status in ('running', 'completed', 'failed')),
  active boolean not null default false,
  record_counts jsonb not null default '{}'::jsonb,
  error_message text,
  started_at timestamptz not null default now(),
  completed_at timestamptz
);

create table public.source_sqlserver_rows (
  import_run_id uuid not null references public.source_sqlserver_import_runs(id) on delete cascade,
  source_table text not null,
  row_number bigint not null,
  payload jsonb not null,
  loaded_at timestamptz not null default now(),
  primary key (import_run_id, source_table, row_number)
);

create index source_sqlserver_rows_table_idx
  on public.source_sqlserver_rows (import_run_id, source_table);

create index source_sqlserver_import_runs_active_idx
  on public.source_sqlserver_import_runs (active)
  where active;

alter table public.source_sqlserver_import_runs enable row level security;
alter table public.source_sqlserver_rows enable row level security;

revoke all on table public.source_sqlserver_import_runs, public.source_sqlserver_rows from anon, authenticated;
grant select, insert, update, delete on table public.source_sqlserver_import_runs, public.source_sqlserver_rows to service_role;
