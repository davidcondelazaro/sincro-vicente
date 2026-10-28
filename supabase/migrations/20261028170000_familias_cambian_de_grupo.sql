-- Familias que no encajaban en su grupo (David, 2026-10-28; propuesta en theme-enterprise-vicente,
-- docs/propuesta-mover-familias-2026-10-28.md). Salen de «Accesorios y componentes» (tecnología):
-- - Cafés e infusiones → Pequeño electro de cocina, detrás de Molinillos de café.
-- - Filtros de agua → Accesorios de pequeño electro, detrás de Accesorios para cafeteras.
-- - Filtros y bolsas para aspiradores → Accesorios de pequeño electro, detrás de Accesorios para aspiradores.
-- - Bolsas y rollos para envasar al vacío → Accesorios de pequeño electro, detrás de Accesorios para robots y batidoras.
-- - Accesorios para antenas de TV → Accesorios de televisión, detrás de Accesorios para TV.
-- El importador lee de aquí el grupo y el apartado de cada producto; los productos ya subidos se corrigen en Shopify.

create temporary table nuevo_orden (handle text primary key, parent_handle text, apartado_handle text, position integer) on commit drop;
insert into nuevo_orden values
  ('cafeteras', 'pequeno-electro-de-cocina', 'pequeno-electro', 0),
  ('hervidores-de-agua', 'pequeno-electro-de-cocina', 'pequeno-electro', 1),
  ('robots-de-cocina', 'pequeno-electro-de-cocina', 'pequeno-electro', 2),
  ('batidoras', 'pequeno-electro-de-cocina', 'pequeno-electro', 3),
  ('freidoras', 'pequeno-electro-de-cocina', 'pequeno-electro', 4),
  ('molinillos-de-cafe', 'pequeno-electro-de-cocina', 'pequeno-electro', 5),
  ('cafes-e-infusiones', 'pequeno-electro-de-cocina', 'pequeno-electro', 6),
  ('accesorios-para-cafeteras', 'accesorios-de-pequeno-electro', 'pequeno-electro', 0),
  ('filtros-de-agua', 'accesorios-de-pequeno-electro', 'pequeno-electro', 1),
  ('accesorios-para-depiladoras', 'accesorios-de-pequeno-electro', 'pequeno-electro', 2),
  ('accesorios-para-afeitadoras', 'accesorios-de-pequeno-electro', 'pequeno-electro', 3),
  ('cabezales-y-accesorios-dentales', 'accesorios-de-pequeno-electro', 'pequeno-electro', 4),
  ('accesorios-para-aspiradores', 'accesorios-de-pequeno-electro', 'pequeno-electro', 5),
  ('filtros-para-aspiradores', 'accesorios-de-pequeno-electro', 'pequeno-electro', 6),
  ('bolsas-para-aspiradores', 'accesorios-de-pequeno-electro', 'pequeno-electro', 7),
  ('accesorios-para-planchas', 'accesorios-de-pequeno-electro', 'pequeno-electro', 8),
  ('fundas-para-tablas-de-planchar', 'accesorios-de-pequeno-electro', 'pequeno-electro', 9),
  ('accesorios-para-hidrolimpiadoras', 'accesorios-de-pequeno-electro', 'pequeno-electro', 10),
  ('limpieza-para-electronica', 'accesorios-de-pequeno-electro', 'pequeno-electro', 11),
  ('accesorios-para-barbacoas', 'accesorios-de-pequeno-electro', 'pequeno-electro', 12),
  ('accesorios-para-robots-y-batidoras', 'accesorios-de-pequeno-electro', 'pequeno-electro', 13),
  ('bolsas-y-rollos-para-envasar-al-vacio', 'accesorios-de-pequeno-electro', 'pequeno-electro', 14),
  ('accesorios-de-menaje', 'accesorios-de-pequeno-electro', 'pequeno-electro', 15),
  ('accesorios-de-salud-y-bienestar', 'accesorios-de-pequeno-electro', 'pequeno-electro', 16),
  ('accesorios-de-costura', 'accesorios-de-pequeno-electro', 'pequeno-electro', 17),
  ('soportes-de-tv-y-monitor', 'accesorios-de-television', 'television', 0),
  ('mandos-a-distancia', 'accesorios-de-television', 'television', 1),
  ('accesorios-para-tv', 'accesorios-de-television', 'television', 2),
  ('accesorios-para-antenas-de-tv', 'accesorios-de-television', 'television', 3),
  ('accesorios-para-proyectores', 'accesorios-de-television', 'television', 4);

-- El resto de Pequeño electro de cocina baja un puesto para dejar sitio a Cafés e infusiones.
update public.store_collections set position = position + 1, updated_at = now()
where parent_handle = 'pequeno-electro-de-cocina' and position >= 6 and handle not in (select handle from nuevo_orden);

update public.store_collections c
set parent_handle = n.parent_handle, apartado_handle = n.apartado_handle, position = n.position, updated_at = now()
from nuevo_orden n
where c.handle = n.handle;
