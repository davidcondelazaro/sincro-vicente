-- Pedidos que se dejan fuera a propósito (cliente borrado en PrestaShop): ni creados ni error.
alter table public.order_import_events drop constraint order_import_events_outcome_check;
alter table public.order_import_events add constraint order_import_events_outcome_check check (outcome = any (array['created', 'existing', 'error', 'skipped', 'status']));
