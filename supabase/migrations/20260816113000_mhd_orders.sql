create table public.mhd_order_countries (
  id bigint generated always as identity primary key,
  iso_2 text not null unique,
  mhd_country_id integer not null unique,
  name text not null,
  shipping_enabled boolean not null default true,
  updated_at timestamptz not null default now()
);

create table public.mhd_order_province_mappings (
  id bigint generated always as identity primary key,
  country_iso_2 text not null references public.mhd_order_countries(iso_2),
  shopify_province_code text not null,
  shopify_province_name text not null,
  mhd_province_id integer not null,
  mhd_province_name text not null,
  active boolean not null default true,
  unique(country_iso_2, shopify_province_code)
);

create table public.shopify_mhd_orders (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  shopify_order_id text not null,
  shopify_order_name text not null,
  financial_status text not null,
  fulfillment_status text not null,
  cancelled_at timestamptz,
  email text,
  currency_code text,
  total_amount numeric(12,2),
  shipping_country_code text,
  shipping_province_code text,
  shipping_province_name text,
  eligibility_status text not null check (eligibility_status in ('eligible','blocked','exported','unknown')),
  eligibility_reason text,
  source_updated_at timestamptz not null,
  source_payload jsonb not null,
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_id, shopify_order_id)
);

create table public.shopify_mhd_order_lines (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.shopify_mhd_orders(id) on delete cascade,
  shopify_line_id text not null,
  sku text,
  title text not null,
  quantity integer not null check (quantity > 0),
  unit_price numeric(12,2) not null,
  line_payload jsonb not null,
  unique(order_id, shopify_line_id)
);

create table public.mhd_order_exports (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.shopify_mhd_orders(id) on delete cascade,
  status text not null check (status in ('ready','exporting','exported','failed','unknown')),
  mhd_order_id integer,
  mhd_transaction_id text,
  mhd_reference_web text not null,
  mhd_status text,
  mhd_status_updated_at timestamptz,
  last_checked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.mhd_order_export_attempts (
  id bigint generated always as identity primary key,
  export_id uuid not null references public.mhd_order_exports(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  request_payload jsonb,
  response_payload jsonb,
  http_status integer,
  outcome text not null check (outcome in ('success','failed','unknown')),
  error_message text,
  created_at timestamptz not null default now()
);

create table public.mhd_order_status_history (
  id bigint generated always as identity primary key,
  export_id uuid not null references public.mhd_order_exports(id) on delete cascade,
  status text not null,
  occurred_at timestamptz,
  source_payload jsonb,
  unique(export_id, status, occurred_at)
);

create index shopify_mhd_orders_owner_updated_idx on public.shopify_mhd_orders(owner_id, source_updated_at desc);
create index mhd_order_exports_status_idx on public.mhd_order_exports(status, updated_at desc);

alter table public.mhd_order_countries enable row level security;
alter table public.mhd_order_province_mappings enable row level security;
alter table public.shopify_mhd_orders enable row level security;
alter table public.shopify_mhd_order_lines enable row level security;
alter table public.mhd_order_exports enable row level security;
alter table public.mhd_order_export_attempts enable row level security;
alter table public.mhd_order_status_history enable row level security;

create policy "Authenticated users read MHD geography" on public.mhd_order_countries for select to authenticated using (true);
create policy "Authenticated users read MHD province mappings" on public.mhd_order_province_mappings for select to authenticated using (true);
create policy "Owners manage their Shopify MHD orders" on public.shopify_mhd_orders for all to authenticated using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
create policy "Owners manage their Shopify MHD lines" on public.shopify_mhd_order_lines for all to authenticated using (exists (select 1 from public.shopify_mhd_orders o where o.id = order_id and o.owner_id = (select auth.uid()))) with check (exists (select 1 from public.shopify_mhd_orders o where o.id = order_id and o.owner_id = (select auth.uid())));
create policy "Owners read their MHD exports" on public.mhd_order_exports for select to authenticated using (exists (select 1 from public.shopify_mhd_orders o where o.id = order_id and o.owner_id = (select auth.uid())));
create policy "Owners read their MHD export attempts" on public.mhd_order_export_attempts for select to authenticated using ((select auth.uid()) = owner_id);
create policy "Owners read their MHD status history" on public.mhd_order_status_history for select to authenticated using (exists (select 1 from public.mhd_order_exports e join public.shopify_mhd_orders o on o.id=e.order_id where e.id=export_id and o.owner_id=(select auth.uid())));

insert into public.mhd_order_countries (iso_2, mhd_country_id, name)
values ('ES', 724, 'España') on conflict (iso_2) do nothing;
