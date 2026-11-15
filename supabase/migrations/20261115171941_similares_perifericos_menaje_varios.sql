-- Similares por familia: periféricos, almacenamiento, menaje y varios (2026-11-15, publicados sin revisión previa por indicación
-- de David; muestra para revisar después).
create or replace function public.mhd_similar_source()
returns table (pid text, t text, title text, pvp numeric, stock numeric, marca text, f jsonb)
language sql stable security definer set search_path = public set statement_timeout = '120s' as $$
  select s.product_id, s.product_type, s.title, coalesce(ps.price, c.pvp)::numeric, coalesce(ps.stock, 0)::numeric, c.nombre_marca, r.result->'filters'
  from store_shopify_ids s
  join mhd_catalog_products c on c.codigo = s.codigo
  left join mhd_shopify_price_stock ps on ps.codigo = s.codigo
  left join lateral (
    select result from mhd_importer_product_runs
    where codigo = s.codigo and status = 'ok' and result ? 'filters'
    order by created_at desc limit 1
  ) r on true
  where s.status = 'ACTIVE' and s.product_type in ('Lavadoras', 'Frigoríficos combi', 'Lavavajillas', 'Hornos', 'Televisores', 'Secadoras', 'Campanas extractoras', 'Portátiles', 'Monitores', 'Ordenadores de sobremesa',
    'Placas de inducción', 'Placas de gas', 'Placas vitrocerámicas', 'Microondas', 'Microondas integrables', 'Frigoríficos de 1 puerta', 'Frigoríficos de 2 puertas', 'Frigoríficos americanos y side by side', 'Congeladores verticales', 'Arcones congeladores',
    'Impresoras', 'Auriculares', 'Smartwatches',
    'Cafeteras', 'Aspiradores', 'Freidoras', 'Planchas de ropa', 'Termos eléctricos', 'Altavoces', 'SAI', 'Discos duros externos', 'Discos duros internos y SSD',
    'Lavadoras secadoras', 'Hornos compactos', 'Hornos de sobremesa', 'Cocinas de gas y eléctricas', 'Fregaderos', 'Grifos de cocina', 'Vinotecas', 'Hornillos', 'Centros de planchado y planchas verticales',
    'Batidoras', 'Tostadoras', 'Hervidores de agua', 'Exprimidores', 'Sandwicheras', 'Planchas de asar y grills eléctricos', 'Picadoras', 'Robots de cocina', 'Licuadoras', 'Arroceras', 'Molinillos de café',
    'Cortapelos', 'Secadores de pelo', 'Afeitadoras', 'Depiladoras', 'Moldeadores y rizadores de pelo', 'Planchas de pelo', 'Cepillos de dientes eléctricos', 'Recortadoras de barba', 'Básculas',
    'Radiadores de aceite', 'Termoventiladores', 'Ventiladores', 'Calefactores eléctricos', 'Estufas', 'Emisores térmicos', 'Deshumidificadores', 'Convectores', 'Paneles radiantes', 'Aire acondicionado',
    'Humidificadores', 'Purificadores de aire', 'Robots aspiradores', 'Vaporetas', 'Almohadillas eléctricas', 'Mantas eléctricas', 'Calientacamas',
    'Proyectores', 'Barras de sonido', 'Webcams', 'Cámaras de fotos', 'Cámaras deportivas', 'Videocámaras', 'Smartphones', 'Smartphones reacondicionados', 'Consolas', 'Tocadiscos', 'Radios',
    'Radios CD y radiocasetes', 'Radiodespertadores', 'Equipos de música', 'Teléfonos inalámbricos', 'Teléfonos fijos', 'Pulseras de actividad', 'eBooks', 'TV Box y sticks de TV', 'Navegadores GPS', 'Micrófonos', 'Videovigilancia',
    'Tarjetas gráficas', 'Procesadores', 'Memoria RAM', 'Placas base', 'Fuentes de alimentación', 'Cajas de ordenador', 'Routers', 'Repetidores y sistemas wifi mesh',
    'Switches y hubs', 'Servidores y NAS', 'Tarjetas de red', 'Escáneres', 'TPV',
    'Ratones', 'Teclados', 'Packs de teclado y ratón', 'Sillas gaming', 'Mesas gaming', 'Volantes gaming', 'Joysticks', 'Memorias USB', 'Tarjetas de memoria', 'Pantallas táctiles',
    'Calculadoras', 'Destructoras de papel', 'Walkie-talkies', 'Reproductores MP3 y MP4', 'Sartenes', 'Ollas, cacerolas y cazos', 'Baterías de cocina', 'Paelleras', 'Termos',
    'Carros de la compra', 'Envasadoras al vacío', 'Gofreras y creperas', 'Cortafiambres', 'Quitapelusas', 'Tablas de planchar', 'Jarras purificadoras de agua')
  order by s.product_id;
$$;
