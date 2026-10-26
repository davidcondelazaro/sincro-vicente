-- Espejo de la tienda de Shopify (David, 2026-10-26): copia local de productos, variantes y colecciones, para que
-- ninguna sincronización ni importación tenga que preguntar a Shopify producto a producto «¿existe?, ¿qué SKU o EAN
-- tiene?, ¿qué dirección usa?, ¿qué tipo y etiquetas?». Se llena con una consulta masiva de Shopify (bulk operation,
-- una sola petición para toda la tienda) y cada subida de un producto actualiza su fila. Pensado para todas las
-- sincronizaciones (importador de MHD, precios y stock, etc.); de momento lo usa el importador de MHD.
-- Ver docs/ESPEJO_TIENDA_SHOPIFY.md.

create table public.shopify_products (
  product_id text primary key,                    -- gid://shopify/Product/…
  handle text not null,
  status text,
  title text,
  vendor text,
  product_type text,
  tags text[] not null default '{}',
  category_id text,
  category_name text,
  shopify_created_at timestamptz,
  shopify_updated_at timestamptz,
  synced_at timestamptz not null default now()
);
-- La dirección es única en Shopify, pero no en el espejo: entre dos refrescos puede haber pasado de un producto a otro.
create index shopify_products_handle_idx on public.shopify_products (handle);
create index shopify_products_vendor_idx on public.shopify_products (vendor);

create table public.shopify_variants (
  variant_id text primary key,                    -- gid://shopify/ProductVariant/…
  product_id text not null references public.shopify_products (product_id) on delete cascade,
  sku text,
  barcode text,                                   -- EAN
  price numeric(12, 2),
  compare_at_price numeric(12, 2),
  inventory_policy text,
  inventory_item_id text,
  synced_at timestamptz not null default now()
);
create index shopify_variants_product_idx on public.shopify_variants (product_id);
create index shopify_variants_sku_idx on public.shopify_variants (sku) where sku is not null and sku <> '';
create index shopify_variants_barcode_idx on public.shopify_variants (barcode) where barcode is not null and barcode <> '';

create table public.shopify_collections (
  collection_id text primary key,
  handle text not null,
  title text,
  rules jsonb,                                    -- reglas de las automáticas: [{ column, relation, condition }]; null = manual
  disjunctive boolean,
  synced_at timestamptz not null default now()
);

-- Cada refresco del espejo. Solo uno a la vez (los que llevan más de 15 min «en curso» se dan por caídos).
create table public.shopify_mirror_runs (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'running' check (status in ('running', 'done', 'error')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  bulk_operation_id text,
  products integer,
  variants integer,
  collections integer,
  error text
);
create unique index shopify_mirror_runs_one_running_idx on public.shopify_mirror_runs ((true)) where status = 'running';

-- Direcciones (handle) que el importador ya ha dado a un producto aunque aún no esté en Shopify: dos productos de la
-- misma tanda no pueden quedarse la misma.
create table public.mhd_importer_handles (
  handle text primary key,
  codigo text not null,
  created_at timestamptz not null default now()
);
create index mhd_importer_handles_codigo_idx on public.mhd_importer_handles (codigo);

alter table public.shopify_products enable row level security;
alter table public.shopify_variants enable row level security;
alter table public.shopify_collections enable row level security;
alter table public.shopify_mirror_runs enable row level security;
alter table public.mhd_importer_handles enable row level security;
create policy "Sesión: leer" on public.shopify_products for select to authenticated using (true);
create policy "Sesión: leer" on public.shopify_variants for select to authenticated using (true);
create policy "Sesión: leer" on public.shopify_collections for select to authenticated using (true);
create policy "Sesión: leer" on public.shopify_mirror_runs for select to authenticated using (true);
create policy "Sesión: todo" on public.mhd_importer_handles for all to authenticated using (true) with check (true);
grant select on table public.shopify_products, public.shopify_variants, public.shopify_collections, public.shopify_mirror_runs to authenticated;
grant select, insert, update, delete on table public.mhd_importer_handles to authenticated;
grant select, insert, update, delete on table public.shopify_products, public.shopify_variants, public.shopify_collections, public.shopify_mirror_runs, public.mhd_importer_handles to service_role;

-- Varios trabajadores a la vez (2026-10-26): el turno único pasa a ser una fila por puesto. Cada tanda dice cuántos
-- trabajadores usa (options.workers) y cuántos productos procesa cada uno a la vez (options.concurrency).
create table public.mhd_importer_worker_slots (
  slot integer primary key,
  lease_token uuid,
  lease_until timestamptz,
  heartbeat_at timestamptz
);
insert into public.mhd_importer_worker_slots (slot) select generate_series(1, 6);
alter table public.mhd_importer_worker_slots enable row level security;
create policy "Sesión: leer" on public.mhd_importer_worker_slots for select to authenticated using (true);
grant select on table public.mhd_importer_worker_slots to authenticated;
grant select, insert, update, delete on table public.mhd_importer_worker_slots to service_role;

create or replace function public.mhd_importer_slot_acquire(p_seconds integer, p_max integer)
returns table (slot integer, token uuid) language plpgsql security definer set search_path = public as $$
declare v_slot integer; v_token uuid := gen_random_uuid();
begin
  select s.slot into v_slot from public.mhd_importer_worker_slots s
   where s.slot <= p_max and (s.lease_until is null or s.lease_until < now())
   order by s.slot limit 1 for update skip locked;
  if v_slot is null then return; end if;
  update public.mhd_importer_worker_slots s set lease_token = v_token, lease_until = now() + make_interval(secs => p_seconds), heartbeat_at = now() where s.slot = v_slot;
  return query select v_slot, v_token;
end; $$;

create or replace function public.mhd_importer_slot_heartbeat(p_slot integer, p_token uuid, p_seconds integer)
returns void language sql security definer set search_path = public as $$
  update public.mhd_importer_worker_slots set heartbeat_at = now(), lease_until = now() + make_interval(secs => p_seconds) where slot = p_slot and lease_token = p_token;
$$;

create or replace function public.mhd_importer_slot_release(p_slot integer, p_token uuid)
returns void language sql security definer set search_path = public as $$
  update public.mhd_importer_worker_slots set lease_token = null, lease_until = null where slot = p_slot and lease_token = p_token;
$$;

-- Reserva por familias (para aprovechar la caché de la redacción, que va por perfil de familia).
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
        -- Mientras se importan fichas de MHD, los que aún no tienen la suya esperan (Vercel no puede pedirla a MHD).
        and (not exists (select 1 from public.mhd_catalog_import_runs r where r.status = 'running' and 'details' = any(r.entities))
             or exists (select 1 from public.mhd_catalog_product_details d where d.codigo = x.codigo and (d.source_payload is not null or d.last_error is not null)))
      order by j.created_at, x.family_code nulls last, x.id
      limit p_limit for update of x skip locked)
  returning i.*;
end; $$;

revoke all on function public.mhd_importer_slot_acquire(integer, integer), public.mhd_importer_slot_heartbeat(integer, uuid, integer), public.mhd_importer_slot_release(integer, uuid) from public, anon, authenticated;
grant execute on function public.mhd_importer_slot_acquire(integer, integer), public.mhd_importer_slot_heartbeat(integer, uuid, integer), public.mhd_importer_slot_release(integer, uuid) to service_role;

drop function public.mhd_importer_worker_acquire(integer);
drop function public.mhd_importer_worker_release(uuid);
drop table public.mhd_importer_worker;
