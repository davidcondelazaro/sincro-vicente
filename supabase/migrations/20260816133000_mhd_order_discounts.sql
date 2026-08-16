alter table public.shopify_mhd_orders
  add column discount_codes text[] not null default '{}',
  add column discount_summary text,
  add column discount_applications jsonb not null default '[]'::jsonb;
