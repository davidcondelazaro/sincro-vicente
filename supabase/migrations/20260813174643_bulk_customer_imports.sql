create extension if not exists pgmq;

create table public.customer_import_runs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  mode text not null check (mode in ('id', 'from_date', 'latest')),
  parameters jsonb not null,
  status text not null default 'queued' check (status in ('queued', 'running', 'paused', 'stopped', 'completed', 'failed')),
  total_count integer not null default 0 check (total_count >= 0),
  processed_count integer not null default 0 check (processed_count >= 0),
  created_count integer not null default 0 check (created_count >= 0),
  existing_count integer not null default 0 check (existing_count >= 0),
  error_count integer not null default 0 check (error_count >= 0),
  cursor_customer_id bigint,
  queue_message_id bigint,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.customer_import_events (
  id bigint generated always as identity primary key,
  run_id uuid not null references public.customer_import_runs(id) on delete cascade,
  level text not null check (level in ('info', 'success', 'warning', 'error')),
  outcome text not null check (outcome in ('created', 'existing', 'error', 'status')),
  prestashop_customer_id bigint,
  customer_email text,
  shopify_customer_id text,
  message text not null,
  created_at timestamptz not null default now()
);

create index customer_import_runs_owner_created_idx on public.customer_import_runs(owner_id, created_at desc);
create index customer_import_events_run_created_idx on public.customer_import_events(run_id, created_at desc);

alter table public.customer_import_runs enable row level security;
alter table public.customer_import_events enable row level security;

create policy "Users can read their import runs"
  on public.customer_import_runs for select to authenticated
  using ((select auth.uid()) = owner_id);

create policy "Users can read their import events"
  on public.customer_import_events for select to authenticated
  using (exists (
    select 1 from public.customer_import_runs run
    where run.id = customer_import_events.run_id
      and run.owner_id = (select auth.uid())
  ));

alter table public.customer_import_runs replica identity full;
alter table public.customer_import_events replica identity full;
alter publication supabase_realtime add table public.customer_import_runs;
alter publication supabase_realtime add table public.customer_import_events;

select pgmq.create('customer_import_jobs');

create or replace function public.enqueue_customer_import(p_run_id uuid)
returns bigint
language plpgsql
security definer
set search_path = public, pgmq
as $$
declare
  message_id bigint;
begin
  select * into message_id
  from pgmq.send('customer_import_jobs', jsonb_build_object('run_id', p_run_id));
  return message_id;
end;
$$;

create or replace function public.claim_customer_import_job()
returns table(message_id bigint, run_id uuid)
language sql
security definer
set search_path = public, pgmq
as $$
  select message.msg_id, (message.message ->> 'run_id')::uuid
  from pgmq.read('customer_import_jobs', 180, 1) as message;
$$;

create or replace function public.release_customer_import_job(p_message_id bigint, p_delay_seconds integer default 0)
returns boolean
language plpgsql
security definer
set search_path = public, pgmq
as $$
begin
  perform pgmq.set_vt('customer_import_jobs', p_message_id, greatest(p_delay_seconds, 0));
  return true;
end;
$$;

create or replace function public.archive_customer_import_job(p_message_id bigint)
returns boolean
language sql
security definer
set search_path = public, pgmq
as $$
  select pgmq.archive('customer_import_jobs', p_message_id);
$$;

revoke all on function public.enqueue_customer_import(uuid) from public, anon, authenticated;
revoke all on function public.claim_customer_import_job() from public, anon, authenticated;
revoke all on function public.release_customer_import_job(bigint, integer) from public, anon, authenticated;
revoke all on function public.archive_customer_import_job(bigint) from public, anon, authenticated;
grant execute on function public.enqueue_customer_import(uuid) to service_role;
grant execute on function public.claim_customer_import_job() to service_role;
grant execute on function public.release_customer_import_job(bigint, integer) to service_role;
grant execute on function public.archive_customer_import_job(bigint) to service_role;
