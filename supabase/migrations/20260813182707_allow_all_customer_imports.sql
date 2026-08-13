alter table public.customer_import_runs
  drop constraint customer_import_runs_mode_check;

alter table public.customer_import_runs
  add constraint customer_import_runs_mode_check
  check (mode in ('id', 'from_date', 'latest', 'all'));
