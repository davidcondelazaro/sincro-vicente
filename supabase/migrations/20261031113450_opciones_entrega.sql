-- Opciones de entrega (portes y servicios de MHD) en el metacampo custom.opciones_entrega de cada producto publicado
-- (David, 2026-10-26: «se actualizan solas, siempre»; docs/SINCRONIZACIONES_MHD.md › Opciones de entrega).
create table public.mhd_shopify_delivery_options (
  codigo text primary key,                          -- código de MHD (= SKU en Shopify)
  product_id text not null,
  options jsonb not null,                           -- lo último que consta en Shopify
  sent_at timestamptz not null default now()
);
alter table public.mhd_shopify_delivery_options enable row level security;
create policy "Sesión: leer" on public.mhd_shopify_delivery_options for select to authenticated using (true);
grant select on table public.mhd_shopify_delivery_options to authenticated;
grant select, insert, update, delete on table public.mhd_shopify_delivery_options to service_role;

create or replace function public.mhd_delivery_options(p jsonb) returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'gastos_envio_peninsula_particulares', p->'gastos_envio_peninsula_particulares', 'gastos_envio_baleares_particulares', p->'gastos_envio_baleares_particulares',
    'gastos_envio_portugal_baremo_1_particulares', p->'gastos_envio_portugal_baremo_1_particulares', 'gastos_envio_portugal_baremo_2_particulares', p->'gastos_envio_portugal_baremo_2_particulares',
    'subida_puerta_particulares', p->'subida_puerta_particulares', 'retirada_usado_particulares', p->'retirada_usado_particulares',
    'instalacion_particulares', p->'instalacion_particulares')
$$;

-- Productos publicados cuyas opciones en esa lectura difieren de lo que consta. `sent` nulo: aún sin comprobar.
create or replace function public.mhd_delivery_options_changes(p_run uuid, p_limit integer default 50000)
returns table (codigo text, product_id text, options jsonb, sent jsonb)
language sql stable security definer set search_path = public as $$
  select i.codigo, i.product_id, public.mhd_delivery_options(c.source_payload), s.options
  from store_shopify_ids i
  join mhd_catalog_products c on c.codigo = i.codigo and c.last_seen_run_id = p_run
  left join mhd_shopify_delivery_options s on s.codigo = i.codigo
  where i.status in ('ACTIVE', 'DRAFT') and s.options is distinct from public.mhd_delivery_options(c.source_payload)
  order by s.options is null, i.codigo
  limit p_limit;
$$;
revoke execute on function public.mhd_delivery_options_changes(uuid, integer) from public, anon, authenticated;
grant execute on function public.mhd_delivery_options_changes(uuid, integer) to service_role;
