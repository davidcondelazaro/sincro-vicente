drop index if exists public.catalog_import_queue_message_idx;

create unique index catalog_import_queue_message_idx
  on public.catalog_import_runs(queue_name, queue_message_id)
  where queue_message_id is not null;
