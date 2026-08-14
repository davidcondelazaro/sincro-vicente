create schema if not exists catalog;

create table catalog.source_batches (
  id uuid primary key default gen_random_uuid(),
  source_type text not null check (source_type in ('sqlite', 'sqlserver', 'csv')),
  source_name text not null,
  status text not null default 'running' check (status in ('running', 'completed', 'failed')),
  record_counts jsonb not null default '{}'::jsonb,
  error_message text,
  started_at timestamptz not null default now(),
  completed_at timestamptz
);

create table catalog.products (
  id text primary key, id_manufacturer text, id_supplier text, id_category_default text, id_tax_rules_group text,
  available_for_order boolean, ean13 text, price numeric, reference text, supplier_reference text, weight numeric,
  active boolean, on_sale boolean, date_add text, fecha_modificacion text, name text, description_short text, description text,
  images text, overlay_energetica boolean, state integer, available_now text, available_later text, meta_title text,
  meta_description text, link_rewrite text, product_features text, prioridad integer, dato_extra text, available_date text,
  minimal_quantity integer, online_only boolean, additional_delivery_times integer, show_price boolean,
  fecha_modificacion_imagen text, estado_pladisel text, visibility text, redirect_type text,
  source_batch_id uuid not null references catalog.source_batches(id), loaded_at timestamptz not null default now()
);

create table catalog.categories (
  id text primary key, name text, description text, metadescription text, link_rewrite text, id_parent text,
  active boolean, position integer, source_batch_id uuid not null references catalog.source_batches(id), loaded_at timestamptz not null default now()
);

create table catalog.manufacturers (
  id text primary key, name text, active boolean, image text, meta_title text, meta_description text, meta_keywords text,
  source_batch_id uuid not null references catalog.source_batches(id), loaded_at timestamptz not null default now()
);

create table catalog.features (
  id integer primary key, name text, posicion integer, propuesta text,
  source_batch_id uuid not null references catalog.source_batches(id), loaded_at timestamptz not null default now()
);

create table catalog.feature_values (
  id integer primary key, id_feature integer, value text,
  source_batch_id uuid not null references catalog.source_batches(id), loaded_at timestamptz not null default now()
);

create table catalog.stock (
  id text primary key, id_product text, quantity integer, last_mod_date text,
  source_batch_id uuid not null references catalog.source_batches(id), loaded_at timestamptz not null default now()
);

create table catalog.prices (
  id text primary key, id_group text, id_product text, id_cliente text, price numeric, fecha_modif text,
  reduction_type text, reduction_tax integer, from_quantity integer, precio_tarifa numeric, reduction numeric, desde text, hasta text,
  source_batch_id uuid not null references catalog.source_batches(id), loaded_at timestamptz not null default now()
);

create table catalog.related_products (
  id text primary key, id_product text, id_accesory_group integer, id_accesory text, position text, fecha_modificacion text,
  source_batch_id uuid not null references catalog.source_batches(id), loaded_at timestamptz not null default now()
);

create table catalog.category_metadata (
  id_category text primary key, category_name text, description text, meta_title text, meta_description text,
  source_batch_id uuid not null references catalog.source_batches(id), loaded_at timestamptz not null default now()
);

create table catalog.manufacturer_metadata (
  id_manufacturer text primary key, manufacturer_name text, active boolean, meta_title text, meta_description text, meta_keywords text,
  source_batch_id uuid not null references catalog.source_batches(id), loaded_at timestamptz not null default now()
);

create index products_category_idx on catalog.products (id_category_default);
create index products_manufacturer_idx on catalog.products (id_manufacturer);
create index stock_product_idx on catalog.stock (id_product);
create index prices_product_idx on catalog.prices (id_product);
create index related_products_product_idx on catalog.related_products (id_product);

revoke all on schema catalog from public, anon, authenticated;
grant usage on schema catalog to service_role;
revoke all on all tables in schema catalog from public, anon, authenticated;
grant select, insert, update, delete on all tables in schema catalog to service_role;
