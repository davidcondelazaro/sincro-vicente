-- Google Merchant: todo lo que escribe el importador va a la cola (David, 2026-11-17: «está todo enganchado al
-- importador»). El importador guarda store_shopify_ids (rememberShopifyIds) cada vez que crea o actualiza un producto
-- con productSet: ficha, portes, EPREL y textos de disponibilidad. Antes solo saltaba al crear o al cambiar de estado.
-- Los webhooks de Shopify de la primera versión se han quitado: no hacen falta.
drop index if exists public.store_shopify_ids_inventory_item;
drop trigger if exists merchant_cola_estado on public.store_shopify_ids;
create trigger merchant_cola_estado after insert or update of status, updated_at on public.store_shopify_ids for each row execute function public.merchant_disparador();

create or replace function public.merchant_disparador() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_table_name = 'store_shopify_ids' then
    if tg_op = 'INSERT' then perform merchant_encolar(new.codigo, 'importador: alta');
    elsif old.status is distinct from new.status then perform merchant_encolar(new.codigo, 'estado ' || coalesce(new.status, '—'));
    elsif old.updated_at is distinct from new.updated_at then perform merchant_encolar(new.codigo, 'importador: actualizado');
    end if;
  elsif tg_table_name = 'mhd_shopify_delivery_options' then
    if tg_op = 'INSERT' or old.options is distinct from new.options then perform merchant_encolar(new.codigo, 'portes'); end if;
  elsif tg_table_name = 'mhd_shopify_price_stock' then
    if tg_op = 'INSERT' or (coalesce(old.stock, 0) > 0) <> (coalesce(new.stock, 0) > 0) then perform merchant_encolar(new.codigo, 'stock'); end if;
  end if;
  return null;
end $$;
