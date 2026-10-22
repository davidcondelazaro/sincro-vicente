update public.source_stock s
set shopify_synced = false
where exists (
  select 1
  from public.price_stock_import_events e
  where e.run_id = 'e730c9f4-2c3f-4a3c-9ede-03805f1968d3'::uuid
    and e.outcome = 'error'
    and e.source_row_id = s.id
);
;
