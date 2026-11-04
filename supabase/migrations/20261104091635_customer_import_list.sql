-- Modo «list»: la ejecución recorre una lista de clientes calculada antes (p. ej. los que faltaron por la marca valid).
create table public.customer_import_queue (
  run_id uuid not null references public.customer_import_runs(id) on delete cascade,
  prestashop_customer_id bigint not null,
  primary key (run_id, prestashop_customer_id)
);
alter table public.customer_import_queue enable row level security;
alter table public.customer_import_runs
  drop constraint customer_import_runs_mode_check;
alter table public.customer_import_runs
  add constraint customer_import_runs_mode_check
  check (mode in ('id', 'from_date', 'latest', 'all', 'retry_errors', 'list'));
