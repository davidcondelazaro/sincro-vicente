update public.source_products
set shopify_synced = false,
    source_changed = true,
    images_sync_pending = true
where id in ('010-01673-00','010-01674-00');;
