create table public.mhd_catalog_import_runs (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'running' check (status in ('running', 'completed', 'failed')),
  record_counts jsonb not null default '{}'::jsonb,
  progress jsonb not null default '{}'::jsonb,
  error_message text,
  started_at timestamptz not null default now(),
  completed_at timestamptz
);

create table public.mhd_catalog_raw_rows (
  import_run_id uuid not null references public.mhd_catalog_import_runs(id) on delete cascade,
  entity_type text not null check (entity_type in ('products', 'categories', 'brands', 'prices', 'stock')),
  source_id text not null,
  payload jsonb not null,
  loaded_at timestamptz not null default now(),
  primary key (import_run_id, entity_type, source_id)
);
create index mhd_catalog_raw_rows_run_entity_idx on public.mhd_catalog_raw_rows(import_run_id, entity_type);

create table public.mhd_catalog_products (
  codigo text primary key,
  codigo_ean text, ref_proved text, titulo text, descripcion_ampliada text,
  cd_marca text, nombre_marca text, cod_linea text, nombre_linea text,
  cod_familia text, nombre_familia text, cod_subfamilia text, nombre_subfamilia text,
  friendly_url text, iva numeric, pvp numeric, pvp_antes numeric, triple_neto numeric, stock numeric,
  fecha_modificacion_producto text, fecha_modificacion_precio text, fecha_modificacion_stock text,
  source_hash text not null, source_payload jsonb not null,
  last_seen_at timestamptz not null, last_seen_run_id uuid not null references public.mhd_catalog_import_runs(id),
  presence_status text not null default 'present' check (presence_status in ('present', 'absent_in_mhd')),
  absent_since timestamptz, absence_detected_run_id uuid references public.mhd_catalog_import_runs(id),
  loaded_at timestamptz not null default now()
);
create index mhd_catalog_products_presence_idx on public.mhd_catalog_products(presence_status);
create index mhd_catalog_products_brand_idx on public.mhd_catalog_products(cd_marca);
create index mhd_catalog_products_family_idx on public.mhd_catalog_products(cod_familia);

create table public.mhd_catalog_categories (
  cd_familia text primary key, nombre text, nivel integer, activo boolean, visible boolean,
  cod_linea text, cod_familia text, friendly_url text, breadcrumb text, orden integer,
  source_hash text not null, source_payload jsonb not null,
  last_seen_at timestamptz not null, last_seen_run_id uuid not null references public.mhd_catalog_import_runs(id),
  loaded_at timestamptz not null default now()
);
create table public.mhd_catalog_brands (
  cd_marca text primary key, nombre text, activo boolean, validada boolean,
  source_hash text not null, source_payload jsonb not null,
  last_seen_at timestamptz not null, last_seen_run_id uuid not null references public.mhd_catalog_import_runs(id),
  loaded_at timestamptz not null default now()
);
create table public.mhd_catalog_prices (
  codigo text primary key, iva numeric, pvp numeric, pvp_antes numeric, triple_neto numeric,
  fecha_modificacion_precio text, source_hash text not null, source_payload jsonb not null,
  last_seen_at timestamptz not null, last_seen_run_id uuid not null references public.mhd_catalog_import_runs(id),
  loaded_at timestamptz not null default now()
);
create table public.mhd_catalog_stock (
  codigo text primary key, stock numeric, fecha_modificacion_stock text,
  source_hash text not null, source_payload jsonb not null,
  last_seen_at timestamptz not null, last_seen_run_id uuid not null references public.mhd_catalog_import_runs(id),
  loaded_at timestamptz not null default now()
);

alter table public.mhd_catalog_import_runs enable row level security;
alter table public.mhd_catalog_raw_rows enable row level security;
alter table public.mhd_catalog_products enable row level security;
alter table public.mhd_catalog_categories enable row level security;
alter table public.mhd_catalog_brands enable row level security;
alter table public.mhd_catalog_prices enable row level security;
alter table public.mhd_catalog_stock enable row level security;
revoke all on table public.mhd_catalog_import_runs, public.mhd_catalog_raw_rows, public.mhd_catalog_products, public.mhd_catalog_categories, public.mhd_catalog_brands, public.mhd_catalog_prices, public.mhd_catalog_stock from anon, authenticated;
grant select, insert, update, delete on table public.mhd_catalog_import_runs, public.mhd_catalog_raw_rows, public.mhd_catalog_products, public.mhd_catalog_categories, public.mhd_catalog_brands, public.mhd_catalog_prices, public.mhd_catalog_stock to service_role;

create or replace function public.replace_mhd_catalog_from_run(p_run_id uuid)
returns jsonb language plpgsql set search_path = public as $$
declare v_run public.mhd_catalog_import_runs%rowtype; v_now timestamptz := now(); v_counts jsonb := '{}'::jsonb; v_count integer;
begin
  select * into v_run from public.mhd_catalog_import_runs where id = p_run_id for update;
  if not found or v_run.status <> 'running' then raise exception 'Ejecución MHD no válida'; end if;

  insert into public.mhd_catalog_products (codigo,codigo_ean,ref_proved,titulo,descripcion_ampliada,cd_marca,nombre_marca,cod_linea,nombre_linea,cod_familia,nombre_familia,cod_subfamilia,nombre_subfamilia,friendly_url,iva,pvp,pvp_antes,triple_neto,stock,fecha_modificacion_producto,fecha_modificacion_precio,fecha_modificacion_stock,source_hash,source_payload,last_seen_at,last_seen_run_id,presence_status,absent_since,absence_detected_run_id,loaded_at)
  select payload->>'codigo', payload->>'codigo_ean', payload->>'ref_proved', payload->>'titulo', payload->>'descripcion_ampliada', payload->>'cd_marca', payload->>'nombre_marca', payload->>'cod_linea', payload->>'nombre_linea', payload->>'cod_familia', payload->>'nombre_familia', payload->>'cod_subfamilia', payload->>'nombre_subfamilia', payload->>'friendly_url', nullif(payload->>'iva','')::numeric, nullif(payload->>'pvp','')::numeric, nullif(payload->>'pvp_antes','')::numeric, nullif(payload->>'triple_neto','')::numeric, nullif(payload->>'stock','')::numeric, payload->>'fecha_modificacion_producto', payload->>'fecha_modificacion_precio', payload->>'fecha_modificacion_stock', encode(digest(payload::text,'sha256'),'hex'), payload, v_now, p_run_id, 'present', null, null, v_now from public.mhd_catalog_raw_rows where import_run_id=p_run_id and entity_type='products'
  on conflict (codigo) do update set codigo_ean=excluded.codigo_ean,ref_proved=excluded.ref_proved,titulo=excluded.titulo,descripcion_ampliada=excluded.descripcion_ampliada,cd_marca=excluded.cd_marca,nombre_marca=excluded.nombre_marca,cod_linea=excluded.cod_linea,nombre_linea=excluded.nombre_linea,cod_familia=excluded.cod_familia,nombre_familia=excluded.nombre_familia,cod_subfamilia=excluded.cod_subfamilia,nombre_subfamilia=excluded.nombre_subfamilia,friendly_url=excluded.friendly_url,iva=excluded.iva,pvp=excluded.pvp,pvp_antes=excluded.pvp_antes,triple_neto=excluded.triple_neto,stock=excluded.stock,fecha_modificacion_producto=excluded.fecha_modificacion_producto,fecha_modificacion_precio=excluded.fecha_modificacion_precio,fecha_modificacion_stock=excluded.fecha_modificacion_stock,source_hash=excluded.source_hash,source_payload=excluded.source_payload,last_seen_at=excluded.last_seen_at,last_seen_run_id=excluded.last_seen_run_id,presence_status='present',absent_since=null,absence_detected_run_id=null,loaded_at=excluded.loaded_at;
  get diagnostics v_count = row_count; v_counts := v_counts || jsonb_build_object('products',v_count);
  update public.mhd_catalog_products set presence_status='absent_in_mhd', absent_since=coalesce(absent_since,v_now), absence_detected_run_id=coalesce(absence_detected_run_id,p_run_id) where last_seen_run_id <> p_run_id and presence_status='present';

  insert into public.mhd_catalog_categories (cd_familia,nombre,nivel,activo,visible,cod_linea,cod_familia,friendly_url,breadcrumb,orden,source_hash,source_payload,last_seen_at,last_seen_run_id,loaded_at)
  select payload->>'cd_familia',payload->>'nombre',nullif(payload->>'nivel','')::integer,(payload->>'activo')::boolean,(payload->>'visible')::boolean,payload->>'cod_linea',payload->>'cod_familia',payload->>'friendly_url',payload->>'breadcrumb',nullif(payload->>'orden','')::integer,encode(digest(payload::text,'sha256'),'hex'),payload,v_now,p_run_id,v_now from public.mhd_catalog_raw_rows where import_run_id=p_run_id and entity_type='categories'
  on conflict (cd_familia) do update set nombre=excluded.nombre,nivel=excluded.nivel,activo=excluded.activo,visible=excluded.visible,cod_linea=excluded.cod_linea,cod_familia=excluded.cod_familia,friendly_url=excluded.friendly_url,breadcrumb=excluded.breadcrumb,orden=excluded.orden,source_hash=excluded.source_hash,source_payload=excluded.source_payload,last_seen_at=excluded.last_seen_at,last_seen_run_id=excluded.last_seen_run_id,loaded_at=excluded.loaded_at;
  get diagnostics v_count = row_count; v_counts := v_counts || jsonb_build_object('categories',v_count);

  insert into public.mhd_catalog_brands (cd_marca,nombre,activo,validada,source_hash,source_payload,last_seen_at,last_seen_run_id,loaded_at)
  select payload->>'cd_marca',payload->>'nombre',(payload->>'activo')::boolean,(payload->>'validada')::boolean,encode(digest(payload::text,'sha256'),'hex'),payload,v_now,p_run_id,v_now from public.mhd_catalog_raw_rows where import_run_id=p_run_id and entity_type='brands'
  on conflict (cd_marca) do update set nombre=excluded.nombre,activo=excluded.activo,validada=excluded.validada,source_hash=excluded.source_hash,source_payload=excluded.source_payload,last_seen_at=excluded.last_seen_at,last_seen_run_id=excluded.last_seen_run_id,loaded_at=excluded.loaded_at;
  get diagnostics v_count = row_count; v_counts := v_counts || jsonb_build_object('brands',v_count);

  insert into public.mhd_catalog_prices (codigo,iva,pvp,pvp_antes,triple_neto,fecha_modificacion_precio,source_hash,source_payload,last_seen_at,last_seen_run_id,loaded_at)
  select payload->>'codigo',nullif(payload->>'iva','')::numeric,nullif(payload->>'pvp','')::numeric,nullif(payload->>'pvp_antes','')::numeric,nullif(payload->>'triple_neto','')::numeric,payload->>'fecha_modificacion_precio',encode(digest(payload::text,'sha256'),'hex'),payload,v_now,p_run_id,v_now from public.mhd_catalog_raw_rows where import_run_id=p_run_id and entity_type='prices'
  on conflict (codigo) do update set iva=excluded.iva,pvp=excluded.pvp,pvp_antes=excluded.pvp_antes,triple_neto=excluded.triple_neto,fecha_modificacion_precio=excluded.fecha_modificacion_precio,source_hash=excluded.source_hash,source_payload=excluded.source_payload,last_seen_at=excluded.last_seen_at,last_seen_run_id=excluded.last_seen_run_id,loaded_at=excluded.loaded_at;
  get diagnostics v_count = row_count; v_counts := v_counts || jsonb_build_object('prices',v_count);

  insert into public.mhd_catalog_stock (codigo,stock,fecha_modificacion_stock,source_hash,source_payload,last_seen_at,last_seen_run_id,loaded_at)
  select payload->>'codigo',nullif(payload->>'stock','')::numeric,payload->>'fecha_modificacion_stock',encode(digest(payload::text,'sha256'),'hex'),payload,v_now,p_run_id,v_now from public.mhd_catalog_raw_rows where import_run_id=p_run_id and entity_type='stock'
  on conflict (codigo) do update set stock=excluded.stock,fecha_modificacion_stock=excluded.fecha_modificacion_stock,source_hash=excluded.source_hash,source_payload=excluded.source_payload,last_seen_at=excluded.last_seen_at,last_seen_run_id=excluded.last_seen_run_id,loaded_at=excluded.loaded_at;
  get diagnostics v_count = row_count; v_counts := v_counts || jsonb_build_object('stock',v_count);

  update public.mhd_catalog_import_runs set status='completed',record_counts=v_counts,progress=progress || jsonb_build_object('phase','completed'),completed_at=v_now,error_message=null where id=p_run_id;
  return v_counts;
end; $$;
revoke all on function public.replace_mhd_catalog_from_run(uuid) from public;
grant execute on function public.replace_mhd_catalog_from_run(uuid) to service_role;
alter function public.replace_mhd_catalog_from_run(uuid) set search_path = public, extensions;
