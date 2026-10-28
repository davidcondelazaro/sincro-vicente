-- Datos de store_icecat_category_map (David, 2026-10-28). Categoría de Icecat → familia de la tienda.
-- Sin subfamilia: vale para toda la tienda. Con subfamilia: solo dentro de esa subfamilia de MHD.
-- Se carga después de la migración 20261028090000_cajones_de_sastre y de crear las familias nuevas
-- `accesorios-de-ordenador` y `bases-y-replicadores-de-puertos` (sesión del árbol).
insert into public.store_icecat_category_map (icecat_category, mhd_subfamily_code, collection_handle, note) values
-- En toda la tienda
('Alfombrillas para ratón', null, 'accesorios-de-ordenador', 'Familia nueva del 28-10'),
('Descansa muñecas', null, 'accesorios-de-ordenador', 'Familia nueva del 28-10'),
('Filtros para monitor', null, 'accesorios-de-ordenador', 'Familia nueva del 28-10'),
('Almohadillas de refrigeración para portátiles', null, 'accesorios-de-ordenador', 'Familia nueva del 28-10'),
('Soportes para ordenadores portátiles', null, 'accesorios-de-ordenador', 'Familia nueva del 28-10'),
('Soportes para CPU', null, 'accesorios-de-ordenador', 'Familia nueva del 28-10'),
('Cable antirrobo', null, 'accesorios-de-ordenador', 'Familia nueva del 28-10'),
('Bases para portátiles y replicadores de puertos', null, 'bases-y-replicadores-de-puertos', 'Familia nueva del 28-10'),
('Cartuchos de tóner', null, 'toner', 'MHD los mete en «Cartucho para Impresoras»'),
('Cámaras de vigilancia', null, 'videovigilancia', 'MHD las mete en «Seguridad Domótica»'),
-- Solo en el cajón de sastre S2501 «Accesorios Informáticos y Videojuegos»
('Armarios Rack', 'S2501', 'armarios-rack-y-accesorios-de-red', null),
('Accesorios para rack', 'S2501', 'armarios-rack-y-accesorios-de-red', null),
('Paneles de parcheo', 'S2501', 'armarios-rack-y-accesorios-de-red', null),
('Plataformas de infraestructura modular', 'S2501', 'armarios-rack-y-accesorios-de-red', null),
('Cajas para discos duros externos', 'S2501', 'cajas-para-discos-duros', null),
('Bases de conexión para discos duros', 'S2501', 'cajas-para-discos-duros', null),
('Fundas para discos duros externos', 'S2501', 'cajas-para-discos-duros', null),
('Sistemas de refrigeración para ordenadores', 'S2501', 'ventiladores-y-refrigeracion-para-pc', null),
('Disipador de calor', 'S2501', 'ventiladores-y-refrigeracion-para-pc', null),
('Accesorios y piezas de sistemas de refrigeración para ordenadores', 'S2501', 'ventiladores-y-refrigeracion-para-pc', null),
('Tarjetas de red', 'S2501', 'tarjetas-de-red', null),
('Módulos de red del transceptor', 'S2501', 'switches-y-hubs', null),
('Hubs de interfaz', 'S2501', 'switches-y-hubs', null),
('Tarjetas y adaptadores de interfaz', 'S2501', 'adaptadores', null),
('Adaptadores de cable de vídeo', 'S2501', 'adaptadores', null),
('Mandos y volantes', 'S2501', 'accesorios-para-consolas', null),
('Cargador de dispositivos móviles', 'S2501', 'cargadores', null),
('Adaptadores e inversores de corriente', 'S2501', 'cargadores', null),
('Cartuchos de tinta', 'S2501', 'cartuchos-de-tinta', null),
('Fotoconductores', 'S2501', 'accesorios-para-impresoras', null),
('Accesorios y piezas de recambio para impresoras/escáneres', 'S2501', 'accesorios-para-impresoras', null),
('Cables USB', 'S2501', 'cables', null),
('Soportes para monitores', 'S2501', 'soportes-de-tv-y-monitor', null),
('Paneles accesorios para ordenadores', 'S2501', 'accesorios-de-ordenador', null),
('Encimeras y mesas de trabajo', 'S2501', 'accesorios-de-ordenador', null),
('Piezas de ordenador', 'S2501', 'accesorios-de-ordenador', null),
('Accesorios y piezas de recambio para tabletas', 'S2501', 'fundas-y-accesorios-para-tablets', null),
-- Solo en S3505 «Accesorio para teléfonos y SmartPhones»
('Cables USB', 'S3505', 'cables', null),
('Baterías externas', 'S3505', 'baterias-externas-powerbank', null),
('Cargador de dispositivos móviles', 'S3505', 'cargadores', null);

update public.store_mhd_subfamily_map set per_product = true, updated_at = now() where mhd_subfamily_code = 'S2501';
