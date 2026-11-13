-- Proveedor de MHD en Shopify (David, 2026-11-13): MHD manda desde el 12-11-2026 `cd_proveedor` y `nombre_proveedor`
-- en cada producto. Van a los metacampos custom.proveedor_codigo y custom.proveedor_nombre, de los que colgarán reglas.
-- Los pone el importador al crear la ficha y los mantiene el paso «proveedor» de la vuelta (supplier-sync.ts;
-- docs/SINCRONIZACIONES_MHD.md › Proveedor).

-- Lo último que consta en Shopify de cada producto.
create table public.mhd_shopify_suppliers (
  codigo text primary key,                          -- código de MHD (= SKU en Shopify)
  product_id text not null,
  supplier jsonb not null,                          -- {"codigo": 26, "nombre": "DESYMAN"}
  sent_at timestamptz not null default now()
);
alter table public.mhd_shopify_suppliers enable row level security;
create policy "Sesión: leer" on public.mhd_shopify_suppliers for select to authenticated using (true);
grant select on table public.mhd_shopify_suppliers to authenticated;
grant select, insert, update, delete on table public.mhd_shopify_suppliers to service_role;

-- Proveedor de una ficha del listado, o null si no lo trae (no se borra lo que hubiera). El nombre, sin espacios
-- sobrantes: Taurus llega como « ELECTRODOMÉSTICOS TAURUS SL ».
create or replace function public.mhd_supplier(p jsonb) returns jsonb language sql immutable as $$
  select case when jsonb_typeof(p->'cd_proveedor') = 'number' and coalesce(btrim(p->>'nombre_proveedor'), '') <> ''
    then jsonb_build_object('codigo', (p->>'cd_proveedor')::integer, 'nombre', btrim(p->>'nombre_proveedor')) end
$$;

-- Productos publicados cuyo proveedor en esa lectura difiere de lo que consta. `sent` nulo: aún sin comprobar.
-- Por tramos de códigos, como las opciones de entrega (todo el catálogo de una vez pasa del límite de 8 s).
create or replace function public.mhd_supplier_changes(p_run uuid, p_codigos text[])
returns table (codigo text, product_id text, supplier jsonb, sent jsonb)
language sql stable security definer set search_path = public as $$
  select i.codigo, i.product_id, public.mhd_supplier(c.source_payload), s.supplier
  from store_shopify_ids i
  join mhd_catalog_products c on c.codigo = i.codigo and c.last_seen_run_id = p_run
  left join mhd_shopify_suppliers s on s.codigo = i.codigo
  where i.codigo = any(p_codigos) and i.status in ('ACTIVE', 'DRAFT') and public.mhd_supplier(c.source_payload) is not null
    and s.supplier is distinct from public.mhd_supplier(c.source_payload);
$$;
revoke execute on function public.mhd_supplier_changes(uuid, text[]) from public, anon, authenticated;
grant execute on function public.mhd_supplier_changes(uuid, text[]) to service_role;

-- El importador recibe el proveedor con el resto del listado.
create or replace function public.mhd_importer_listing_row(p mhd_catalog_products) returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'codigo', p.codigo, 'codigo_ean', p.codigo_ean, 'ref_proved', p.ref_proved, 'titulo', p.titulo, 'nombre_marca', p.nombre_marca,
    'cod_familia', p.cod_familia, 'nombre_familia', p.nombre_familia, 'cod_subfamilia', p.cod_subfamilia, 'nombre_subfamilia', p.nombre_subfamilia,
    'pvp', p.pvp, 'pvp_antes', p.pvp_antes, 'triple_neto', p.triple_neto, 'iva', p.iva, 'stock', p.stock, 'descripcion_ampliada', p.descripcion_ampliada,
    'descripcion', p.source_payload->>'descripcion', 'imagen', p.source_payload->>'imagen', 'letra_eficiencia', p.source_payload->>'letra_eficiencia',
    'img_eficiencia', p.source_payload->>'img_eficiencia', 'img_ficha_eficiencia', p.source_payload->>'img_ficha_eficiencia', 'presence_status', p.presence_status,
    'cod_linea', p.cod_linea,
    -- Portes y servicios de MHD para particulares, tal cual (custom.opciones_entrega).
    'opciones_entrega', jsonb_build_object(
      'gastos_envio_peninsula_particulares', p.source_payload->'gastos_envio_peninsula_particulares', 'gastos_envio_baleares_particulares', p.source_payload->'gastos_envio_baleares_particulares',
      'gastos_envio_portugal_baremo_1_particulares', p.source_payload->'gastos_envio_portugal_baremo_1_particulares', 'gastos_envio_portugal_baremo_2_particulares', p.source_payload->'gastos_envio_portugal_baremo_2_particulares',
      'subida_puerta_particulares', p.source_payload->'subida_puerta_particulares', 'retirada_usado_particulares', p.source_payload->'retirada_usado_particulares',
      'instalacion_particulares', p.source_payload->'instalacion_particulares'),
    -- Proveedor de MHD (custom.proveedor_codigo y custom.proveedor_nombre).
    'proveedor', public.mhd_supplier(p.source_payload))
$$;
