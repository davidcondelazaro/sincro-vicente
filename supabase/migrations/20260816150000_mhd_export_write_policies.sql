-- Las rutas de servidor trabajan con el usuario autenticado y necesitan
-- conservar cada intento sin exponer pedidos de otros usuarios.
create policy "Owners manage their MHD exports" on public.mhd_order_exports
for all to authenticated
using (exists (
  select 1 from public.shopify_mhd_orders o
  where o.id = order_id and o.owner_id = (select auth.uid())
))
with check (exists (
  select 1 from public.shopify_mhd_orders o
  where o.id = order_id and o.owner_id = (select auth.uid())
));

create policy "Owners manage their MHD export attempts" on public.mhd_order_export_attempts
for all to authenticated
using ((select auth.uid()) = owner_id)
with check ((select auth.uid()) = owner_id);
