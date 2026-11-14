-- Pedidos cancelados en MHD que se cancelan en Shopify, sin reembolso y con aviso al cliente
-- (docs/PEDIDOS_MHD_FASE_1.md › Cancelados en MHD). Apagado hasta que David lo active. Al activarlo,
-- cancelar_en_shopify_desde es el corte: solo cuentan las cancelaciones de MHD a partir de esa fecha.
insert into public.store_settings (key, value) values
  ('cancelar_en_shopify_activo', 'false'),
  ('cancelar_en_shopify_desde', 'null')
on conflict (key) do nothing;
