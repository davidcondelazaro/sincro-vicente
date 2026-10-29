-- Productos bloqueados (David, 2026-10-29): fichas arregladas a mano en Shopify que el importador no debe volver a
-- procesar ni subir (ni las tandas, ni «Un producto», ni las altas y cambios automáticos). Precio y stock sí se siguen
-- sincronizando. Se gestionan en utils › Catálogo › Productos bloqueados.
create table public.store_product_locks (
  codigo text primary key,                       -- código de MHD (= SKU en Shopify)
  reason text not null,
  locked_by text,
  locked_at timestamptz not null default now()
);
alter table public.store_product_locks enable row level security;
create policy "Sesión: leer" on public.store_product_locks for select to authenticated using (true);
create policy "Sesión: escribir" on public.store_product_locks for insert to authenticated with check (true);
create policy "Sesión: quitar" on public.store_product_locks for delete to authenticated using (true);
grant select, insert, delete on table public.store_product_locks to authenticated;
grant select, insert, update, delete on table public.store_product_locks to service_role;

insert into public.store_product_locks (codigo, reason, locked_by) values
  ('10021168', 'Cápsulas Dolce Gusto Espresso: ficha corregida a mano en Shopify (MHD dice «café granulado»). No reprocesar hasta que MHD la arregle.', 'david@aligeria.com');
