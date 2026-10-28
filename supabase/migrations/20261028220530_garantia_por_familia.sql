-- Ampliación de garantía decidida en la importación (David, 2026-10-28). El importador escribe en cada producto
-- custom.admite_garantia (booleano) y el tema y el chatbot lo leen; el tema solo pone tramos, productos de garantía y
-- precio mínimo. Criterio: el de Garantía3, todo lo eléctrico o electrónico (ver
-- theme-enterprise-vicente/docs/garantias-por-familia.md). Orden de decisión para un producto:
--   1. store_warranty_title_rules: primera regla de su familia (por position) cuyo patrón casa con el título;
--   2. store_collections.warranty_eligible de su familia;
--   3. si la familia está sin decidir (null), no se escribe la marca y se avisa: el tema usa su lista de tipos.
alter table public.store_collections add column warranty_eligible boolean;
comment on column public.store_collections.warranty_eligible is 'Familia: admite ampliación de garantía (null = sin decidir). Ver store_warranty_title_rules para las excepciones.';

create table public.store_warranty_title_rules (
  id bigint generated always as identity primary key,
  family_handle text not null references public.store_collections (handle),
  pattern text not null,                     -- expresión regular de JavaScript, sin distinguir mayúsculas, sobre el título
  eligible boolean not null,
  position integer not null default 0,
  note text,
  created_at timestamptz not null default now()
);
create index store_warranty_title_rules_family on public.store_warranty_title_rules (family_handle, position);
alter table public.store_warranty_title_rules enable row level security;

update public.store_collections set warranty_eligible = true where level = 'familia';
update public.store_collections set warranty_eligible = false where level = 'familia' and handle in ('accesorios-de-audio', 'accesorios-de-climatizacion', 'accesorios-de-costura', 'accesorios-de-menaje', 'accesorios-de-ordenador', 'accesorios-para-afeitadoras', 'accesorios-para-aspiradores', 'accesorios-para-barbacoas', 'accesorios-para-cafeteras', 'accesorios-para-calderas', 'accesorios-para-calentadores', 'accesorios-para-camaras', 'accesorios-para-campanas', 'accesorios-para-depiladoras', 'accesorios-para-ebooks', 'accesorios-para-fregaderos-y-grifos', 'accesorios-para-frigorificos-y-congeladores', 'accesorios-para-gps-y-coche', 'accesorios-para-hornos', 'accesorios-para-impresoras', 'accesorios-para-lavadoras', 'accesorios-para-lavavajillas', 'accesorios-para-microondas', 'accesorios-para-placas', 'accesorios-para-planchas', 'accesorios-para-plotters', 'accesorios-para-purificadores', 'accesorios-para-radiadores-y-emisores', 'accesorios-para-robots-y-batidoras', 'accesorios-para-secadoras', 'accesorios-para-termos', 'accesorios-para-ventiladores', 'adaptadores', 'aire-libre', 'antenas-de-tv-fijas', 'antenas-parabolicas', 'armarios-rack-y-accesorios-de-red', 'barbacoas-de-gas', 'baterias-de-cocina', 'biberones', 'bolsas-para-aspiradores', 'bolsas-y-rollos-para-envasar-al-vacio', 'cabezales-y-accesorios-dentales', 'cables', 'cafes-e-infusiones', 'calderas-de-gas', 'calderas-mixtas', 'calentadores-de-gas', 'canapes', 'carros-de-la-compra', 'cartuchos-de-tinta', 'cestas-para-cubiertos', 'chupetes', 'cintas-para-impresora', 'cocinas-de-gas-y-electricas', 'colchones', 'complementos-de-cocina', 'correas-y-accesorios-para-smartwatch', 'cubreencimeras', 'discos-virgenes', 'fiambreras', 'filtros-de-agua', 'filtros-para-aspiradores', 'fregaderos', 'fundas-para-moviles', 'fundas-para-tablas-de-planchar', 'fundas-y-accesorios-para-tablets', 'fundas-y-maletines-para-portatiles', 'grifos-de-bano', 'grifos-de-cocina', 'herramientas-electricas', 'hornillos', 'hornos-de-gas', 'jarras-purificadoras-de-agua', 'limpieza-para-electronica', 'mesas-gaming', 'mochilas-para-portatiles', 'muebles-de-tv', 'ollas-cacerolas-y-cazos', 'packs-de-fregadero-y-grifo', 'pantallas-de-proyeccion', 'papel-fotografico', 'patas-de-canape-y-somieres', 'pilas', 'placas-de-gas', 'placas-polivalentes', 'planchas-de-asar-y-parrillas', 'prismaticos', 'productos-de-limpieza-para-electrodomesticos', 'protectores-de-pantalla', 'sartenes', 'sets-de-cocina', 'sets-para-bebe', 'sillas-gaming', 'software', 'soportes-de-tv-y-monitor', 'tablas-de-planchar', 'termos', 'termos-solares', 'teteras', 'tijeras-de-podar', 'toner', 'utensilios-de-cocina', 'vajilla-infantil', 'vasos-para-bebe', 'videojuegos', 'woks');
update public.store_collections set warranty_eligible = null where level = 'familia' and handle in ('grupos-solares', 'ambientadores', 'cuidado-del-pecho');

insert into public.store_warranty_title_rules (family_handle, pattern, eligible, position) values
  ('hornillos', 'eléctric|inducci|vitrocer', true, 0),
  ('cocinas-de-gas-y-electricas', 'horno eléctrico|vitrocer|inducci', true, 1),
  ('placas-polivalentes', 'vitrocer|inducci', true, 2),
  ('utensilios-de-cocina', 'eléctric', true, 3),
  ('herramientas-electricas', '^(Taladro|Destornillador|Grapadora|Alargador)', true, 4),
  ('accesorios-para-aspiradores', '^(Aspiradora|Aspirador |Hidrolimpiadora)|Deshumidificador', true, 5),
  ('accesorios-para-cafeteras', '^Espumador', true, 6),
  ('accesorios-para-robots-y-batidoras', '^Máquina de', true, 7),
  ('accesorios-para-camaras', '^(Batería|Cargador|Capturador)', true, 8),
  ('accesorios-de-audio', '^(Extensor|Transmisor|Reloj)', true, 9),
  ('discos-virgenes', 'SSD|^Disco ', true, 10),
  ('accesorios-para-gps-y-coche', '^Transmisor', true, 11),
  ('armarios-rack-y-accesorios-de-red', '^(Ventilador|Panel de ventilación)', true, 12),
  ('soportes-de-tv-y-monitor', 'motorizad|eléctric', true, 13),
  ('mesas-gaming', 'eléctric|elevable', true, 14),
  ('fundas-y-accesorios-para-tablets', '^(Cargador|Hub|Lápiz|Puntero|Aro de luz)|con teclado', true, 15),
  ('fundas-y-maletines-para-portatiles', 'con teclado', true, 16),
  ('fundas-para-moviles', 'con teclado', true, 17),
  ('accesorios-de-ordenador', '^(Base refrigeradora|Base de conexión)|carga inalámbrica|con hub', true, 18),
  ('accesorios-para-impresoras', '^Servidor de impresión', true, 19),
  ('cafeteras', '^(?!.*(\d+ ?W\b|eléctric|Alicia|EMKM?\d|Jata CFI)).*(italiana|émbolo|Bialetti)', false, 20),
  ('estufas', '\bgas\b', false, 21),
  ('paelleras', '^(?!.*eléctric)', false, 22),
  ('cajones-calientaplatos', '\bgas\b', false, 23),
  ('accesorios-para-proyectores', '^Soporte', false, 24),
  ('accesorios-para-antenas-de-tv', '^Cable', false, 25),
  ('fitness-y-salud', '^Tapones', false, 26);
