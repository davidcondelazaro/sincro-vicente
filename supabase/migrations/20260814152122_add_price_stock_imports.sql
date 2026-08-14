create extension if not exists pgmq;
create extension if not exists pg_cron;
create extension if not exists pg_net;

create table public.price_stock_import_runs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  import_type text not null check (import_type in ('prices', 'stock')),
  mode text not null check (mode in ('all', 'selective', 'partial')),
  filters jsonb not null default '{}'::jsonb,
  status text not null default 'queued' check (status in ('queued', 'running', 'paused', 'stopped', 'completed', 'failed')),
  total_count integer not null default 0 check (total_count >= 0),
  processed_count integer not null default 0 check (processed_count >= 0),
  updated_count integer not null default 0 check (updated_count >= 0),
  unchanged_count integer not null default 0 check (unchanged_count >= 0),
  warning_count integer not null default 0 check (warning_count >= 0),
  error_count integer not null default 0 check (error_count >= 0),
  cursor_source_id text,
  queue_message_id bigint,
  worker_token uuid,
  heartbeat_at timestamptz,
  current_source_id text,
  current_product_id text,
  current_operation text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.price_stock_import_events (
  id bigint generated always as identity primary key,
  run_id uuid not null references public.price_stock_import_runs(id) on delete cascade,
  level text not null check (level in ('info', 'success', 'warning', 'error')),
  outcome text not null check (outcome in ('updated', 'unchanged', 'error', 'status')),
  source_row_id text,
  product_id text,
  shopify_product_id text,
  shopify_variant_id text,
  message text not null,
  details jsonb,
  created_at timestamptz not null default now()
);

create index price_stock_import_runs_owner_created_idx on public.price_stock_import_runs(owner_id, created_at desc);
create index price_stock_import_runs_type_completed_idx on public.price_stock_import_runs(import_type, status, started_at desc);
create index price_stock_import_events_run_created_idx on public.price_stock_import_events(run_id, id);
create unique index price_stock_import_one_active_per_owner_type
  on public.price_stock_import_runs(owner_id, import_type)
  where status in ('queued', 'running', 'paused');
create unique index price_stock_import_queue_message_idx
  on public.price_stock_import_runs(queue_message_id)
  where queue_message_id is not null;

alter table public.price_stock_import_runs enable row level security;
alter table public.price_stock_import_events enable row level security;

create policy "Users can read their price and stock runs"
  on public.price_stock_import_runs for select to authenticated
  using ((select auth.uid()) = owner_id);
create policy "Users can read their price and stock events"
  on public.price_stock_import_events for select to authenticated
  using (exists (select 1 from public.price_stock_import_runs run where run.id = price_stock_import_events.run_id and run.owner_id = (select auth.uid())));

alter table public.price_stock_import_runs replica identity full;
alter table public.price_stock_import_events replica identity full;
alter publication supabase_realtime add table public.price_stock_import_runs;
alter publication supabase_realtime add table public.price_stock_import_events;

select pgmq.create('price_import_jobs');
select pgmq.create('stock_import_jobs');

create or replace function public.start_price_stock_import(p_import_type text, p_mode text, p_filters jsonb default '{}'::jsonb)
returns public.price_stock_import_runs
language plpgsql security definer
set search_path = pg_catalog, public, pgmq
as $$
declare
  v_owner_id uuid := (select auth.uid());
  v_filters jsonb := coalesce(p_filters, '{}'::jsonb);
  v_since timestamptz;
  v_total integer;
  v_run public.price_stock_import_runs;
  v_message_id bigint;
  v_ids text[];
  v_queue text;
begin
  if v_owner_id is null then raise exception 'Necesitas iniciar sesión'; end if;
  if p_import_type not in ('prices', 'stock') then raise exception 'Tipo de importación no válido'; end if;
  if p_mode not in ('all', 'selective', 'partial') then raise exception 'Modo de importación no válido'; end if;
  if jsonb_typeof(v_filters) <> 'object' then raise exception 'Filtros no válidos'; end if;
  v_ids := array(select jsonb_array_elements_text(coalesce(v_filters -> 'productIds', '[]'::jsonb)));
  if p_mode = 'selective' and coalesce(array_length(v_ids, 1), 0) = 0 then raise exception 'Indica al menos un ID de producto'; end if;
  if p_mode = 'partial' then
    select started_at into v_since from public.price_stock_import_runs
    where import_type = p_import_type and mode in ('all', 'partial') and status = 'completed' and started_at is not null
    order by started_at desc limit 1;
    if v_since is null then raise exception 'Antes de una actualización parcial debes finalizar una importación completa o parcial de %.', case when p_import_type = 'prices' then 'precios' else 'stock' end; end if;
    v_filters := v_filters || jsonb_build_object('changedSince', v_since);
  end if;
  if p_import_type = 'prices' then
    select count(*) into v_total from public.source_prices source join public.source_products product on product.id = source.id_product
    where (p_mode <> 'selective' or source.id_product = any(v_ids))
      and (p_mode <> 'partial' or source.fecha_modif >= to_char(v_since at time zone 'Europe/Madrid', 'YYYY-MM-DD HH24:MI:SS.MS'));
    v_queue := 'price_import_jobs';
  else
    select count(*) into v_total from public.source_stock source join public.source_products product on product.id = source.id_product
    where (p_mode <> 'selective' or source.id_product = any(v_ids))
      and (p_mode <> 'partial' or source.last_mod_date >= to_char(v_since at time zone 'Europe/Madrid', 'YYYY-MM-DD HH24:MI:SS.MS'));
    v_queue := 'stock_import_jobs';
  end if;
  if v_total = 0 then raise exception 'No hay registros válidos para el criterio indicado'; end if;
  insert into public.price_stock_import_runs(owner_id, import_type, mode, filters, total_count)
  values (v_owner_id, p_import_type, p_mode, v_filters, v_total) returning * into v_run;
  select * into v_message_id from pgmq.send(v_queue, jsonb_build_object('run_id', v_run.id));
  update public.price_stock_import_runs set queue_message_id = v_message_id where id = v_run.id returning * into v_run;
  return v_run;
end;
$$;

create or replace function public.read_price_stock_import_message(p_import_type text)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public, pgmq
as $$ declare v_message jsonb; v_queue text; begin
  if coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role' then raise exception 'Acceso no autorizado'; end if;
  v_queue := case p_import_type when 'prices' then 'price_import_jobs' when 'stock' then 'stock_import_jobs' else null end;
  if v_queue is null then raise exception 'Tipo de importación no válido'; end if;
  select to_jsonb(message_record) into v_message from pgmq.read(v_queue, 300, 1) as message_record limit 1;
  return v_message;
end; $$;

create or replace function public.archive_price_stock_import_message(p_import_type text, p_message_id bigint)
returns boolean language plpgsql security definer set search_path = pg_catalog, public, pgmq
as $$ declare v_queue text; begin
  if coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role' then raise exception 'Acceso no autorizado'; end if;
  v_queue := case p_import_type when 'prices' then 'price_import_jobs' when 'stock' then 'stock_import_jobs' else null end;
  if v_queue is null then raise exception 'Tipo no válido'; end if;
  return pgmq.archive(v_queue, p_message_id);
end; $$;

create or replace function public.set_price_stock_import_status(p_run_id uuid, p_status text)
returns text language plpgsql security definer set search_path = pg_catalog, public, pgmq
as $$ declare v_owner uuid; v_status text; v_type text; v_message bigint; v_queue text; v_text text; begin
  select owner_id,status,import_type,queue_message_id into v_owner,v_status,v_type,v_message from public.price_stock_import_runs where id=p_run_id for update;
  if not found or v_owner <> (select auth.uid()) then raise exception 'Ejecución no autorizada'; end if;
  v_queue := case v_type when 'prices' then 'price_import_jobs' else 'stock_import_jobs' end;
  if p_status = 'paused' and v_status in ('queued','running') then update public.price_stock_import_runs set status='paused',updated_at=now() where id=p_run_id; v_text := 'Importación pausada por el usuario.';
  elsif p_status = 'stopped' and v_status in ('queued','running','paused') then update public.price_stock_import_runs set status='stopped',finished_at=now(),updated_at=now() where id=p_run_id; if v_message is not null then perform pgmq.archive(v_queue,v_message); end if; v_text := 'Importación detenida por el usuario.';
  elsif p_status = 'queued' and v_status = 'paused' then update public.price_stock_import_runs set status='queued',updated_at=now() where id=p_run_id; if v_message is not null then perform pgmq.set_vt(v_queue,v_message,0); end if; v_text := 'Importación reanudada por el usuario.';
  else raise exception 'Cambio de estado no permitido'; end if;
  insert into public.price_stock_import_events(run_id,level,outcome,message) values(p_run_id,'info','status',v_text);
  return p_status;
end; $$;

create or replace function public.claim_price_stock_import_worker(p_run_id uuid, p_worker_token uuid)
returns boolean language plpgsql security definer set search_path = pg_catalog, public
as $$ begin
  if coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role' then raise exception 'Acceso no autorizado'; end if;
  update public.price_stock_import_runs set status='running',worker_token=p_worker_token,heartbeat_at=now(),started_at=coalesce(started_at,now()),updated_at=now()
  where id=p_run_id and status in ('queued','running') and (worker_token is null or worker_token=p_worker_token or heartbeat_at is null or heartbeat_at < now()-interval '2 minutes');
  return found;
end; $$;

create or replace function public.heartbeat_price_stock_import_worker(p_run_id uuid,p_worker_token uuid,p_source_id text default null,p_product_id text default null,p_operation text default null)
returns boolean language plpgsql security definer set search_path = pg_catalog, public
as $$ begin
  if coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role' then raise exception 'Acceso no autorizado'; end if;
  update public.price_stock_import_runs set heartbeat_at=now(),current_source_id=p_source_id,current_product_id=p_product_id,current_operation=p_operation,updated_at=now() where id=p_run_id and worker_token=p_worker_token and status='running'; return found;
end; $$;

create or replace function public.next_price_stock_import_source_row(p_run_id uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public
as $$ declare v_run public.price_stock_import_runs; v_ids text[]; begin
  if coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role' then raise exception 'Acceso no autorizado'; end if;
  select * into v_run from public.price_stock_import_runs where id = p_run_id;
  if not found then return null; end if;
  v_ids := array(select jsonb_array_elements_text(coalesce(v_run.filters -> 'productIds', '[]'::jsonb)));
  if v_run.import_type = 'prices' then
    return (select jsonb_build_object('id',source.id,'id_product',source.id_product,'precio_tarifa',source.precio_tarifa,'fecha_modif',source.fecha_modif,'product_price',product.price)
      from public.source_prices source join public.source_products product on product.id=source.id_product
      where (v_run.cursor_source_id is null or source.id > v_run.cursor_source_id)
        and (v_run.mode <> 'selective' or source.id_product = any(v_ids))
        and (v_run.mode <> 'partial' or source.fecha_modif >= to_char((v_run.filters ->> 'changedSince')::timestamptz at time zone 'Europe/Madrid','YYYY-MM-DD HH24:MI:SS.MS'))
      order by source.id limit 1);
  end if;
  return (select jsonb_build_object('id',source.id,'id_product',source.id_product,'quantity',source.quantity,'last_mod_date',source.last_mod_date,'available_for_order',product.available_for_order)
    from public.source_stock source join public.source_products product on product.id=source.id_product
    where (v_run.cursor_source_id is null or source.id > v_run.cursor_source_id)
      and (v_run.mode <> 'selective' or source.id_product = any(v_ids))
      and (v_run.mode <> 'partial' or source.last_mod_date >= to_char((v_run.filters ->> 'changedSince')::timestamptz at time zone 'Europe/Madrid','YYYY-MM-DD HH24:MI:SS.MS'))
    order by source.id limit 1);
end; $$;

create or replace function public.release_price_stock_import_worker(p_run_id uuid,p_worker_token uuid)
returns boolean language plpgsql security definer set search_path = pg_catalog, public
as $$ begin
  if coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role' then raise exception 'Acceso no autorizado'; end if;
  update public.price_stock_import_runs set worker_token=null,heartbeat_at=null,current_source_id=null,current_product_id=null,current_operation=null,updated_at=now() where id=p_run_id and worker_token=p_worker_token; return found;
end; $$;

revoke all on function public.start_price_stock_import(text,text,jsonb) from public,anon;
grant execute on function public.start_price_stock_import(text,text,jsonb) to authenticated;
revoke all on function public.read_price_stock_import_message(text),public.archive_price_stock_import_message(text,bigint),public.claim_price_stock_import_worker(uuid,uuid),public.heartbeat_price_stock_import_worker(uuid,uuid,text,text,text),public.next_price_stock_import_source_row(uuid),public.release_price_stock_import_worker(uuid,uuid) from public,anon,authenticated;
grant execute on function public.read_price_stock_import_message(text),public.archive_price_stock_import_message(text,bigint),public.claim_price_stock_import_worker(uuid,uuid),public.heartbeat_price_stock_import_worker(uuid,uuid,text,text,text),public.next_price_stock_import_source_row(uuid),public.release_price_stock_import_worker(uuid,uuid) to service_role;
revoke all on function public.set_price_stock_import_status(uuid,text) from public,anon;
grant execute on function public.set_price_stock_import_status(uuid,text) to authenticated;

select cron.schedule('sincro-vicente-price-import-worker','* * * * *',$$select net.http_post(url := (select decrypted_secret from vault.decrypted_secrets where name='sincro_vicente_project_url') || '/functions/v1/sync-price-stock-imports',headers := jsonb_build_object('Content-Type','application/json','apikey',(select decrypted_secret from vault.decrypted_secrets where name='sincro_vicente_publishable_key')),body := '{"importType":"prices"}'::jsonb);$$);
select cron.schedule('sincro-vicente-stock-import-worker','* * * * *',$$select net.http_post(url := (select decrypted_secret from vault.decrypted_secrets where name='sincro_vicente_project_url') || '/functions/v1/sync-price-stock-imports',headers := jsonb_build_object('Content-Type','application/json','apikey',(select decrypted_secret from vault.decrypted_secrets where name='sincro_vicente_publishable_key')),body := '{"importType":"stock"}'::jsonb);$$);
