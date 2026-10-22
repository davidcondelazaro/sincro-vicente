alter table public.shopify_mhd_orders
add column shopify_fulfillment_payload jsonb;

comment on column public.shopify_mhd_orders.shopify_fulfillment_payload is
  'Último envío creado en Shopify desde Sincro Vicente: origen del seguimiento (mhd o manual), seguimiento enviado y fulfillments creados.';;
