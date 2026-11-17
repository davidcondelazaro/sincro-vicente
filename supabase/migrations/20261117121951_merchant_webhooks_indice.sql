-- Avisos de Shopify de inventario (src/app/api/shopify/webhooks/merchant): se casan por inventory_item_id.
create index if not exists store_shopify_ids_inventory_item on public.store_shopify_ids (inventory_item_id);
