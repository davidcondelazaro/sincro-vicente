-- Familias de Climatización que no encajaban en su grupo (David, 2026-10-28; propuesta en theme-enterprise-vicente,
-- docs/propuesta-mover-familias-2026-10-28.md):
-- - Jarras purificadoras y dispensadores de agua → Pequeño electro de cocina, detrás de Hervidores de agua.
-- - Programadores horarios → Accesorios y componentes, detrás de Regletas.
-- - Estaciones meteorológicas → Hogar inteligente y relojes, al final.
-- El importador lee de aquí el grupo y el apartado de cada producto; los productos ya subidos se corrigen en Shopify.

update public.store_collections set position = position + 2, updated_at = now()
where parent_handle = 'pequeno-electro-de-cocina' and position >= 2;
update public.store_collections set position = position + 1, updated_at = now()
where parent_handle = 'accesorios-y-componentes' and position >= 6;

update public.store_collections c
set parent_handle = n.parent_handle, apartado_handle = n.apartado_handle, position = n.position, updated_at = now()
from (values
  ('jarras-purificadoras-de-agua', 'pequeno-electro-de-cocina', 'pequeno-electro', 2),
  ('dispensadores-de-agua', 'pequeno-electro-de-cocina', 'pequeno-electro', 3),
  ('programadores-horarios', 'accesorios-y-componentes', 'tecnologia', 6),
  ('estaciones-meteorologicas', 'hogar-inteligente-y-relojes', 'tecnologia', 9)
) as n (handle, parent_handle, apartado_handle, position)
where c.handle = n.handle;
