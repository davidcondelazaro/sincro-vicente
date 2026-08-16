-- MHD devuelve el histórico completo de cada pedido en arr_estados.
-- Conservamos únicamente el último payload en mhd_order_exports, sin duplicarlo en filas locales.
drop table if exists public.mhd_order_status_history;
