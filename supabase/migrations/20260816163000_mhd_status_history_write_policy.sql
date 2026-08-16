create policy "Owners manage their MHD status history" on public.mhd_order_status_history
for all to authenticated
using (exists (
  select 1
  from public.mhd_order_exports e
  join public.shopify_mhd_orders o on o.id = e.order_id
  where e.id = export_id and o.owner_id = (select auth.uid())
))
with check (exists (
  select 1
  from public.mhd_order_exports e
  join public.shopify_mhd_orders o on o.id = e.order_id
  where e.id = export_id and o.owner_id = (select auth.uid())
));
