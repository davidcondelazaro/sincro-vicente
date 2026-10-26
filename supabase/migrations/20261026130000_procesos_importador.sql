-- Procesos del importador de productos MHD en producción (2026-10-26): una tanda (familias, el banco o una lista de
-- códigos) se encola y la procesa el trabajador de Vercel (/api/importador-productos/trabajos/trabajador), sin
-- depender del ordenador de nadie. Cada paso de cada producto queda en el registro con su duración, para verlo en
-- directo en la pantalla «Procesos». Ver docs/IMPORTADOR_PRODUCTOS_MHD.md.

create table public.mhd_importer_jobs (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  status text not null default 'en_cola' check (status in ('en_cola', 'en_curso', 'pausado', 'terminado', 'cancelado')),
  options jsonb not null default '{}'::jsonb,       -- { families, codes, bench, concurrency }
  created_by text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);

create table public.mhd_importer_job_items (
  id bigint generated always as identity primary key,
  job_id uuid not null references public.mhd_importer_jobs (id) on delete cascade,
  codigo text not null,
  family_code text,
  status text not null default 'pendiente' check (status in ('pendiente', 'en_curso', 'ok', 'descartado', 'error')),
  step text,                                       -- paso en curso
  attempts integer not null default 0,
  lease_until timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  duration_ms integer,
  cost_usd numeric(10, 4),
  run_id uuid references public.mhd_importer_product_runs (id) on delete set null,
  error text,
  unique (job_id, codigo)
);
create index mhd_importer_job_items_queue_idx on public.mhd_importer_job_items (job_id, status, id);

create table public.mhd_importer_events (
  id bigint generated always as identity primary key,
  job_id uuid references public.mhd_importer_jobs (id) on delete cascade,
  item_id bigint references public.mhd_importer_job_items (id) on delete cascade,
  codigo text,
  level text not null check (level in ('info', 'decision', 'aviso', 'error', 'revision')),
  step text not null,
  message text not null,
  duration_ms integer,
  data jsonb,
  created_at timestamptz not null default now()
);
create index mhd_importer_events_job_idx on public.mhd_importer_events (job_id, id desc);
create index mhd_importer_events_item_idx on public.mhd_importer_events (item_id, id);

-- Turno del trabajador: solo trabaja una llamada a la vez (la que tiene el turno); si se corta, el turno caduca y la
-- siguiente llamada (la autollamada o el vigilante) lo retoma.
create table public.mhd_importer_worker (
  id boolean primary key default true check (id),
  lease_token uuid,
  lease_until timestamptz,
  heartbeat_at timestamptz
);
insert into public.mhd_importer_worker (id) values (true);

create or replace function public.mhd_importer_worker_acquire(p_seconds integer)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_token uuid := gen_random_uuid();
begin
  update public.mhd_importer_worker set lease_token = v_token, lease_until = now() + make_interval(secs => p_seconds), heartbeat_at = now()
   where id and (lease_until is null or lease_until < now());
  return case when found then v_token end;
end; $$;

create or replace function public.mhd_importer_worker_release(p_token uuid)
returns void language sql security definer set search_path = public as $$
  update public.mhd_importer_worker set lease_token = null, lease_until = null where id and lease_token = p_token;
$$;

-- Reserva productos para el trabajador: los pendientes (y los en curso con la reserva caducada, p. ej. tras un corte)
-- de las tandas en cola o en curso, por orden de llegada. Tras 3 intentos fallidos, error.
create or replace function public.mhd_importer_claim_items(p_limit integer, p_lease_seconds integer)
returns setof public.mhd_importer_job_items language plpgsql security definer set search_path = public as $$
begin
  update public.mhd_importer_job_items i set status = 'error', error = coalesce(i.error, 'Se cortó tres veces sin terminar.'), finished_at = now(), lease_until = null
   where i.status = 'en_curso' and i.lease_until < now() and i.attempts >= 3;
  update public.mhd_importer_jobs j set status = 'en_curso', started_at = coalesce(j.started_at, now())
   where j.status = 'en_cola' and exists (select 1 from public.mhd_importer_job_items i where i.job_id = j.id and i.status = 'pendiente');
  return query
  update public.mhd_importer_job_items i set status = 'en_curso', attempts = i.attempts + 1, lease_until = now() + make_interval(secs => p_lease_seconds), started_at = now(), step = null
   where i.id in (
     select x.id from public.mhd_importer_job_items x join public.mhd_importer_jobs j on j.id = x.job_id
      where j.status in ('en_cola', 'en_curso') and (x.status = 'pendiente' or (x.status = 'en_curso' and x.lease_until < now()))
      order by j.created_at, x.id
      limit p_limit for update of x skip locked)
  returning i.*;
end; $$;

-- Cierra las tandas sin nada pendiente.
create or replace function public.mhd_importer_finish_jobs()
returns void language sql security definer set search_path = public as $$
  update public.mhd_importer_jobs j set status = 'terminado', finished_at = now()
   where j.status in ('en_cola', 'en_curso') and not exists (select 1 from public.mhd_importer_job_items i where i.job_id = j.id and i.status in ('pendiente', 'en_curso'));
$$;

revoke all on function public.mhd_importer_worker_acquire(integer), public.mhd_importer_worker_release(uuid), public.mhd_importer_claim_items(integer, integer), public.mhd_importer_finish_jobs() from public, anon, authenticated;
grant execute on function public.mhd_importer_worker_acquire(integer), public.mhd_importer_worker_release(uuid), public.mhd_importer_claim_items(integer, integer), public.mhd_importer_finish_jobs() to service_role;

-- Avance de cada tanda para la pantalla.
create or replace view public.mhd_importer_job_progress with (security_invoker = true) as
select j.*,
       count(i.id) as total,
       count(i.id) filter (where i.status = 'pendiente') as pendientes,
       count(i.id) filter (where i.status = 'en_curso') as en_curso,
       count(i.id) filter (where i.status = 'ok') as ok,
       count(i.id) filter (where i.status = 'descartado') as descartados,
       count(i.id) filter (where i.status = 'error') as errores,
       round(avg(i.duration_ms) filter (where i.status in ('ok', 'descartado'))) as duracion_media_ms,
       coalesce(sum(i.cost_usd), 0) as coste_usd,
       max(greatest(i.started_at, i.finished_at)) as ultima_actividad
  from public.mhd_importer_jobs j
  left join public.mhd_importer_job_items i on i.job_id = j.id
 group by j.id;

-- Tiempo medio de cada paso por tanda.
create or replace view public.mhd_importer_step_stats with (security_invoker = true) as
select job_id, step, count(*) as veces, round(avg(duration_ms)) as media_ms, max(duration_ms) as max_ms,
       count(*) filter (where level = 'error') as errores
  from public.mhd_importer_events
 where duration_ms is not null
 group by job_id, step;

alter table public.mhd_importer_jobs enable row level security;
alter table public.mhd_importer_job_items enable row level security;
alter table public.mhd_importer_events enable row level security;
alter table public.mhd_importer_worker enable row level security;
create policy "Sesión: todo" on public.mhd_importer_jobs for all to authenticated using (true) with check (true);
create policy "Sesión: todo" on public.mhd_importer_job_items for all to authenticated using (true) with check (true);
create policy "Sesión: leer" on public.mhd_importer_events for select to authenticated using (true);
create policy "Sesión: leer" on public.mhd_importer_worker for select to authenticated using (true);
grant select, insert, update, delete on table public.mhd_importer_jobs, public.mhd_importer_job_items to authenticated, service_role;
grant select on table public.mhd_importer_events, public.mhd_importer_worker to authenticated;
grant select, insert, update, delete on table public.mhd_importer_events, public.mhd_importer_worker to service_role;
grant select on public.mhd_importer_job_progress, public.mhd_importer_step_stats to authenticated, service_role;

-- Vigilante: mientras haya una tanda en cola o en curso, pg_cron llama al trabajador cada minuto (si ya está
-- trabajando, la llamada no hace nada: no hay turno libre). Apagado el resto del tiempo, como los vigilantes de las
-- importaciones del catálogo. La dirección de la app se guarda en Vault como `sincro_vicente_app_url` (aparte).
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') and exists (select 1 from pg_extension where extname = 'pg_net') then
    perform cron.schedule('sincro-vicente-importador-vigilante', '* * * * *', $cmd$
      select net.http_post(
        url := (select decrypted_secret from vault.decrypted_secrets where name = 'sincro_vicente_app_url') || '/api/importador-productos/trabajos/trabajador',
        headers := jsonb_build_object('Content-Type', 'application/json'),
        body := '{}'::jsonb,
        timeout_milliseconds := 10000
      );
    $cmd$);
    perform cron.alter_job(job_id := (select jobid from cron.job where jobname = 'sincro-vicente-importador-vigilante'), active := false);
  end if;
end $$;

create or replace function public.sync_importer_watchdog()
returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_job bigint; v_active boolean; v_now boolean;
begin
  select jobid, active into v_job, v_now from cron.job where jobname = 'sincro-vicente-importador-vigilante';
  if v_job is null then return null; end if;
  select exists(select 1 from public.mhd_importer_jobs where status in ('en_cola', 'en_curso')) into v_active;
  if v_active is distinct from v_now then perform cron.alter_job(job_id := v_job, active := v_active); end if;
  return null;
end; $$;
revoke all on function public.sync_importer_watchdog() from public, anon, authenticated;
create trigger mhd_importer_jobs_watchdog after insert or update of status or delete on public.mhd_importer_jobs
for each statement execute function public.sync_importer_watchdog();
