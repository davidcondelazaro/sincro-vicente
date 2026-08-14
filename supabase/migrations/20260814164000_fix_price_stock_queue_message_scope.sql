drop index if exists public.price_stock_import_queue_message_idx;
create unique index price_stock_import_queue_message_idx
  on public.price_stock_import_runs(import_type, queue_message_id)
  where queue_message_id is not null;
