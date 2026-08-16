alter table public.shopify_mhd_orders
  add column subtotal_amount numeric(12,2),
  add column discount_amount numeric(12,2) not null default 0,
  add column shipping_amount numeric(12,2) not null default 0;
