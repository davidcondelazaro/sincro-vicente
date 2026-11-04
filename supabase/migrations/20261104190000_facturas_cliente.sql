-- Correo de factura al cliente (docs/PEDIDOS_MHD_FASE_1.md › Facturas en Shopify y correo de factura).
-- facturas_cliente: facturas de MHD que el cliente ya ha recibido, para no repetir: [{ url, via: envio | correo, at, resend_id? }].
alter table public.mhd_order_exports add column facturas_cliente jsonb not null default '[]'::jsonb;
comment on column public.mhd_order_exports.facturas_cliente is
  'Facturas de MHD ya recibidas por el cliente: en la Confirmación de envío de Shopify (via envio) o en el correo de factura de sincro-vicente (via correo).';

-- Apagado hasta que David lo active. Al activarlo, factura_correo_desde es el corte: los pedidos exportados a MHD antes
-- no reciben el correo (ni los de PrestaShop, que no pasan por mhd_order_exports).
insert into public.store_settings (key, value) values
  ('factura_correo_activo', 'false'),
  ('factura_correo_desde', 'null')
on conflict (key) do nothing;
