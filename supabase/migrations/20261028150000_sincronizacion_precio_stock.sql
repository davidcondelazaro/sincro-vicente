-- Sincronización de precio y stock con Shopify (David, 2026-10-28; diseño en docs/SINCRONIZACIONES_MHD.md).
-- Cada 30 minutos Supabase lee /prices y /stocks de MHD (mhd_catalog_prices y mhd_catalog_stock) y la app manda a
-- Shopify solo lo que ha cambiado respecto a lo último enviado, que se guarda aquí. El precio bueno es el de /prices
-- (el de la web de MHD); el `pvp` del listado no coincide en ~17.500 productos.

-- Último precio y stock enviados a Shopify por producto (lo escriben la sincronización y la subida del importador).
create table public.mhd_shopify_price_stock (
  codigo text primary key,                          -- código de MHD (= SKU en Shopify)
  product_id text not null,
  variant_id text not null,
  inventory_item_id text not null,
  price numeric,
  stock integer,
  sent_at timestamptz not null default now()
);

-- Histórico de las sincronizaciones, sin caducidad: cada cambio enviado, cada vuelta y cada freno o fallo.
create table public.mhd_sync_events (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  sync text not null,                               -- 'precio-stock', 'listado', 'promociones'…
  kind text not null,                               -- 'precio', 'stock', 'vuelta', 'freno', 'error'
  codigo text,
  detail jsonb not null default '{}'::jsonb
);
create index mhd_sync_events_created on public.mhd_sync_events (created_at desc);
create index mhd_sync_events_codigo on public.mhd_sync_events (codigo, created_at desc);

alter table public.mhd_shopify_price_stock enable row level security;
alter table public.mhd_sync_events enable row level security;
create policy "Sesión: leer" on public.mhd_shopify_price_stock for select to authenticated using (true);
create policy "Sesión: leer" on public.mhd_sync_events for select to authenticated using (true);
grant select on table public.mhd_shopify_price_stock, public.mhd_sync_events to authenticated;
grant select, insert, update, delete on table public.mhd_shopify_price_stock, public.mhd_sync_events to service_role;

-- Productos subidos a Shopify cuyo precio o stock de la última lectura de MHD difiere de lo enviado. Solo los que
-- están en esa lectura: uno que falta no se toca aquí (eso lo deciden las bajas, con dos lecturas seguidas).
create or replace function public.mhd_price_stock_changes(p_run uuid, p_limit integer default 50000)
returns table (codigo text, product_id text, variant_id text, inventory_item_id text, price numeric, stock integer, sent_price numeric, sent_stock integer)
language sql stable security definer set search_path = public as $$
  with uploaded as (
    select distinct on (r.codigo) r.codigo, r.shopify_product_id
    from mhd_importer_product_runs r where r.status = 'ok' and r.shopify_product_id is not null
    order by r.codigo, r.created_at desc)
  select u.codigo, v.product_id, v.variant_id, v.inventory_item_id,
         round(pr.pvp, 2), greatest(0, trunc(st.stock))::integer, s.price, s.stock
  from uploaded u
  join shopify_variants v on v.sku = u.codigo and v.product_id = u.shopify_product_id
  join mhd_catalog_prices pr on pr.codigo = u.codigo and pr.last_seen_run_id = p_run
  join mhd_catalog_stock st on st.codigo = u.codigo and st.last_seen_run_id = p_run
  left join mhd_shopify_price_stock s on s.codigo = u.codigo
  where pr.pvp > 0 and v.inventory_item_id is not null
    and (s.codigo is null or s.price is distinct from round(pr.pvp, 2) or s.stock is distinct from greatest(0, trunc(st.stock))::integer)
  limit p_limit;
$$;
revoke execute on function public.mhd_price_stock_changes(uuid, integer) from public, anon, authenticated;
grant execute on function public.mhd_price_stock_changes(uuid, integer) to service_role;

-- Lectura de MHD lanzada por la tarea programada (sin sesión de usuario). Igual que mhd_import_start, pero con las
-- entidades que se pidan (p. ej. precios y stock juntos) y solo para el rol de servicio y pg_cron.
create or replace function public.mhd_import_start_scheduled(p_kind text, p_entities text[])
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  begin
    insert into public.mhd_catalog_import_runs (kind, entities, entity_progress, status, started_by, last_activity_at)
    select p_kind, p_entities, jsonb_object_agg(e, jsonb_build_object('estimated', 0)), 'running', null, now()
      from unnest(p_entities) e
    returning id into v_id;
  exception when unique_violation then
    return null;                                    -- ya hay una lectura en curso: esta vuelta se salta
  end;
  perform public.mhd_import_set_watchdog(true);
  perform public.mhd_import_kick(v_id);
  return v_id;
end; $$;
revoke execute on function public.mhd_import_start_scheduled(text, text[]) from public, anon, authenticated;
grant execute on function public.mhd_import_start_scheduled(text, text[]) to service_role;
