alter table public.mhd_order_exports
add column mhd_status_payload jsonb;

comment on column public.mhd_order_exports.mhd_status_payload is
  'Último bloque de estados devuelto por MHD; no replica el histórico en filas locales.';
