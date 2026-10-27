// Categoría del catálogo estándar de Shopify (Shopify Product Taxonomy) de cada familia del árbol nuevo, por el handle
// de su colección (David, 2026-10-27: una por familia, no por producto). La usan Shop, Google y Meta para saber qué es
// el producto; no cambia nada en la web. Propuesta revisada en theme-enterprise-vicente/docs/categorias-shopify.xlsx.
export const SHOPIFY_CATEGORY_BY_FAMILY: Record<string, string> = {
  "abrelatas-electricos": "gid://shopify/TaxonomyCategory/hg-11-8-9", // Abrelatas
  "accesorios-de-audio": "gid://shopify/TaxonomyCategory/el-2-1", // Accesorios de audio
  "accesorios-de-costura": "gid://shopify/TaxonomyCategory/ae-2-1-3", // Accesorios para herramientas de manualidades
  "accesorios-de-menaje": "gid://shopify/TaxonomyCategory/hg-11-2-5", // Accesorios para cocinar
  "accesorios-de-movilidad-urbana": "gid://shopify/TaxonomyCategory/sg-4-4-1", // Accesorios para bicicletas
  "accesorios-de-salud-y-bienestar": "gid://shopify/TaxonomyCategory/hb-3", // Cuidado personal
  "accesorios-para-afeitadoras": "gid://shopify/TaxonomyCategory/hb-3-14-3", // Accesorios para afeitadoras eléctricas
  "accesorios-para-aire-acondicionado": "gid://shopify/TaxonomyCategory/hg-8-1", // Accesorios para el aire acondicionado
  "accesorios-para-antenas-de-tv": "gid://shopify/TaxonomyCategory/el-7-2", // Accesorios para antenas
  "accesorios-para-aspiradores": "gid://shopify/TaxonomyCategory/hg-8-11", // Accesorios para aspiradoras
  "accesorios-para-cafeteras": "gid://shopify/TaxonomyCategory/hg-11-6-2", // Accesorios para cafeteras
  "accesorios-para-calentadores": "gid://shopify/TaxonomyCategory/hg-8-12", // Accesorios para calentadores de agua
  "accesorios-para-camaras": "gid://shopify/TaxonomyCategory/co-1", // Accesorios ópticos y de cámara
  "accesorios-para-campanas": "gid://shopify/TaxonomyCategory/hg-11-6-23", // Accesorios para campana de cocina
  "accesorios-para-consolas": "gid://shopify/TaxonomyCategory/el-18", // Accesorios para videoconsolas
  "accesorios-para-depiladoras": "gid://shopify/TaxonomyCategory/hb-3", // Cuidado personal
  "accesorios-para-ebooks": "gid://shopify/TaxonomyCategory/el-7-8-4-1", // Accesorios para lectores de libros electrónicos
  "accesorios-para-fregaderos-y-grifos": "gid://shopify/TaxonomyCategory/ha-10-2-7", // Accesorios de lavabo
  "accesorios-para-frigorificos-y-congeladores": "gid://shopify/TaxonomyCategory/hg-11-6-24", // Accesorios de frigorífico
  "accesorios-para-gps-y-coche": "gid://shopify/TaxonomyCategory/vp-1-6-4-2", // Bengalas para emergencia para carretera
  "accesorios-para-hidrolimpiadoras": "gid://shopify/TaxonomyCategory/hg-12-4-8", // Accesorios para limpiadoras a presión
  "accesorios-para-hornos": "gid://shopify/TaxonomyCategory/hg-11-6-3", // Accesorios para placas de cocción, hornos y cocinas de gas
  "accesorios-para-impresoras": "gid://shopify/TaxonomyCategory/el-13-3", // Accesorios para máquinas de fax, impresoras y fotocopiadoras
  "accesorios-para-lavadoras": "gid://shopify/TaxonomyCategory/hg-8-9-4", // Accesorios para lavadoras y secadoras
  "accesorios-para-lavavajillas": "gid://shopify/TaxonomyCategory/hg-11-6-6", // Accesorios y piezas de lavavajillas
  "accesorios-para-microondas": "gid://shopify/TaxonomyCategory/hg-11-6-18", // Accesorios para microondas
  "accesorios-para-moviles": "gid://shopify/TaxonomyCategory/el-4-8-4", // Accesorios para teléfonos móviles y inteligentes
  "accesorios-para-placas": "gid://shopify/TaxonomyCategory/hg-11-6-3", // Accesorios para placas de cocción, hornos y cocinas de gas
  "accesorios-para-planchas": "gid://shopify/TaxonomyCategory/hg-8-9-2", // Accesorios para plancha
  "accesorios-para-plotters": "gid://shopify/TaxonomyCategory/el-13-3", // Accesorios para máquinas de fax, impresoras y fotocopiadoras
  "accesorios-para-proyectores": "gid://shopify/TaxonomyCategory/el-17-5-3", // Accesorios para proyectores
  "accesorios-para-robots-y-batidoras": "gid://shopify/TaxonomyCategory/hg-11-6-11", // Accesorios para procesadores de alimentos
  "accesorios-para-secadoras": "gid://shopify/TaxonomyCategory/hg-8-9-4", // Accesorios para lavadoras y secadoras
  "accesorios-para-tv": "gid://shopify/TaxonomyCategory/el-17-5-5", // Accesorios y piezas para televisores
  "adaptadores": "gid://shopify/TaxonomyCategory/el-7-1", // Adaptadores
  "adaptadores-bluetooth": "gid://shopify/TaxonomyCategory/el-12-6-1", // Adaptadores de red Bluetooth
  "adaptadores-plc": "gid://shopify/TaxonomyCategory/el-12-6-3", // Adaptadores de red por línea eléctrica
  "afeitadoras": "gid://shopify/TaxonomyCategory/hb-3-14-4", // Máquinas de afeitar eléctricas
  "aire-acondicionado": "gid://shopify/TaxonomyCategory/hg-9-1-1", // Sistemas de aire acondicionado
  "aire-libre": "gid://shopify/TaxonomyCategory/hg-18", // Piscina y spa
  "almohadillas-electricas": "gid://shopify/TaxonomyCategory/hb-1-8-5-2", // Bolsas de calor
  "altavoces": "gid://shopify/TaxonomyCategory/el-2-2-10", // Altavoces
  "altavoces-inteligentes": "gid://shopify/TaxonomyCategory/el-2-2-10-5", // Altavoces inteligentes
  "amasadoras": "gid://shopify/TaxonomyCategory/hg-11-7-17-2", // Mezcladoras de alimentos
  "amplificadores": "gid://shopify/TaxonomyCategory/el-2-2-2", // Amplificadores de sonido
  "anillos-inteligentes": "gid://shopify/TaxonomyCategory/hb-1-4-1", // Monitores de actividad
  "antenas-de-tv-fijas": "gid://shopify/TaxonomyCategory/el-7-3-6", // Antenas de TV
  "antenas-de-tv-portatiles": "gid://shopify/TaxonomyCategory/el-7-3-6", // Antenas de TV
  "antenas-parabolicas": "gid://shopify/TaxonomyCategory/el-17-3-3", // Antenas satelitales
  "antenas-y-adaptadores-wifi": "gid://shopify/TaxonomyCategory/el-12-6-4", // Tarjetas y adaptadores de red Wi-Fi
  "arcones-congeladores": "gid://shopify/TaxonomyCategory/hg-11-7-20-1", // Congeladores horizontales
  "armarios-rack-y-accesorios-de-red": "gid://shopify/TaxonomyCategory/el-7", // Accesorios electrónicos
  "arroceras": "gid://shopify/TaxonomyCategory/hg-11-7-14-3", // Arroceras
  "aspiradores": "gid://shopify/TaxonomyCategory/hg-9-10", // Aspiradoras
  "auriculares": "gid://shopify/TaxonomyCategory/el-2-2-7", // Auriculares y auriculares con micrófono
  "barras-de-sonido": "gid://shopify/TaxonomyCategory/el-2-2-10-6", // Barras de sonido
  "basculas": "gid://shopify/TaxonomyCategory/hb-1-4-5", // Básculas de peso corporal
  "baterias-de-cocina": "gid://shopify/TaxonomyCategory/hg-11-2-3-2", // Batería de cocina
  "baterias-externas-powerbank": "gid://shopify/TaxonomyCategory/el-7-15-5-1", // Baterías externas
  "batidoras": "gid://shopify/TaxonomyCategory/hg-11-7-17", // Batidoras y licuadoras
  "bicicletas-electricas": "gid://shopify/TaxonomyCategory/sg-2-4-2-2", // Bicicletas estáticas
  "bolsas-para-aspiradores": "gid://shopify/TaxonomyCategory/hg-8-11-21", // Bolsas para el polvo
  "bolsas-y-rollos-para-envasar-al-vacio": "gid://shopify/TaxonomyCategory/hg-11-6-28", // Accesorios de envasado al vacío
  "braseros-electricos": "gid://shopify/TaxonomyCategory/hg-9-1-12", // Calentadores de ambiente
  "cabezales-y-accesorios-dentales": "gid://shopify/TaxonomyCategory/hb-3-12-16", // Accesorios para cepillos de dientes
  "cables": "gid://shopify/TaxonomyCategory/el-7-7", // Cables
  "cafes-e-infusiones": "gid://shopify/TaxonomyCategory/fb-1", // Bebidas
  "cafeteras": "gid://shopify/TaxonomyCategory/hg-11-7-4", // Cafeteras
  "cajas-de-ordenador": "gid://shopify/TaxonomyCategory/el-7-9-8", // Cajas para computadoras y servidores
  "cajas-para-discos-duros": "gid://shopify/TaxonomyCategory/el-7-9-14-2-3", // Soportes y carcasas para discos duros
  "cajones-calientaplatos": "gid://shopify/TaxonomyCategory/hg-11-7-19-7", // Cajones calentadores
  "calculadoras": "gid://shopify/TaxonomyCategory/os-10-2", // Calculadoras
  "calderas-de-gas": "gid://shopify/TaxonomyCategory/hg-9-1-7-1", // Calderas
  "calefactores-electricos": "gid://shopify/TaxonomyCategory/hg-9-1-12", // Calentadores de ambiente
  "calentadores-de-gas": "gid://shopify/TaxonomyCategory/hg-9-12", // Calentadores de agua
  "calientacamas": "gid://shopify/TaxonomyCategory/hg-15-1-4-1", // Mantas eléctricas
  "calientaleches": "gid://shopify/TaxonomyCategory/hg-11-7-32", // Máquinas de hacer espuma de leche
  "calientapies": "gid://shopify/TaxonomyCategory/hb-1-8-5-2", // Bolsas de calor
  "camaras-de-fotos": "gid://shopify/TaxonomyCategory/co-2", // Cámaras
  "camaras-deportivas": "gid://shopify/TaxonomyCategory/co-2-7", // Cámaras de vídeo
  "campanas-extractoras": "gid://shopify/TaxonomyCategory/hg-11-7-39", // Extractores
  "captadores-solares": "gid://shopify/TaxonomyCategory/ha-11-23", // Paneles solares
  "cargadores": "gid://shopify/TaxonomyCategory/el-7-15-5", // Cargadores y adaptadores de alimentación
  "carros-de-la-compra": "gid://shopify/TaxonomyCategory/lb-11", // Bolsas para compra
  "cartuchos-de-tinta": "gid://shopify/TaxonomyCategory/el-13-3-1-7", // Cartuchos de tinta y tóner
  "centros-de-planchado-y-planchas-verticales": "gid://shopify/TaxonomyCategory/hg-9-8", // Electrodomésticos para cuidado de la ropa
  "cepillos-de-dientes-electricos": "gid://shopify/TaxonomyCategory/hb-3-12-17-1", // Cepillos de dientes eléctricos
  "cintas-para-impresora": "gid://shopify/TaxonomyCategory/el-13-3-1", // Consumibles para impresoras
  "climatizadores-evaporativos": "gid://shopify/TaxonomyCategory/hg-9-1-5", // Enfriadores por evaporación
  "coccion-al-vapor-y-a-baja-temperatura": "gid://shopify/TaxonomyCategory/hg-11-7-14", // Ollas de vapor para alimentos
  "cocinas-de-gas-y-electricas": "gid://shopify/TaxonomyCategory/hg-11-7-40", // Cocinas
  "comederos-y-bebederos-para-mascotas": "gid://shopify/TaxonomyCategory/ap-2-14-1", // Alimentadores automáticos
  "congeladores-verticales": "gid://shopify/TaxonomyCategory/hg-11-7-20-3", // Congeladores verticales
  "conjuntos-de-horno-y-placa": "gid://shopify/TaxonomyCategory/hg-11-7-35", // Hornos
  "consolas": "gid://shopify/TaxonomyCategory/el-19", // Videoconsolas
  "contadores-y-detectores-de-billetes": "gid://shopify/TaxonomyCategory/bi-22-4-4", // Contadores de billetes y monedas
  "convectores": "gid://shopify/TaxonomyCategory/hg-9-1-12", // Calentadores de ambiente
  "correas-y-accesorios-para-smartwatch": "gid://shopify/TaxonomyCategory/aa-6-10", // Accesorios para reloj
  "cortafiambres": "gid://shopify/TaxonomyCategory/hg-11-7-8", // Cortadoras de fiambres
  "cortapelos": "gid://shopify/TaxonomyCategory/hb-3-14-6", // Recortadores y cortadores de pelo
  "cuchillos-electricos": "gid://shopify/TaxonomyCategory/hg-11-8-25", // Cuchillos eléctricos
  "cuecehuevos": "gid://shopify/TaxonomyCategory/hg-11-7-14-1", // Cocedores de huevos
  "depiladoras": "gid://shopify/TaxonomyCategory/hb-3-14-7", // Depilación
  "deshumidificadores": "gid://shopify/TaxonomyCategory/hg-9-1-3", // Deshumidificadores
  "despertadores": "gid://shopify/TaxonomyCategory/hg-3-17-1", // Despertadores
  "destructoras-de-papel": "gid://shopify/TaxonomyCategory/os-10-6", // Trituradoras de papel
  "discos-duros-externos": "gid://shopify/TaxonomyCategory/el-7-9-14", // Dispositivos de almacenamiento
  "discos-duros-internos-y-ssd": "gid://shopify/TaxonomyCategory/el-7-9-14", // Dispositivos de almacenamiento
  "discos-virgenes": "gid://shopify/TaxonomyCategory/el-7-5", // Soportes multimedia vírgenes
  "dispensadores-de-agua": "gid://shopify/TaxonomyCategory/hg-11-7-49", // Dispensadores enfriadores de agua
  "disqueteras": "gid://shopify/TaxonomyCategory/el-7-9-14-6", // Unidades de disco óptico
  "distribuidores-hdmi": "gid://shopify/TaxonomyCategory/el-7-4-2", // Divisores y conmutadores HDMI
  "dosificadores-de-jabon": "gid://shopify/TaxonomyCategory/hg-1-15", // Dispensadores de jabón y loción
  "ebooks": "gid://shopify/TaxonomyCategory/el-6-4-2", // Lectores de libros electrónicos
  "emisores-termicos": "gid://shopify/TaxonomyCategory/hg-9-1-8", // Radiadores
  "encendedores-electricos": "gid://shopify/TaxonomyCategory/ha-15-30", // Encendedores y cerillas
  "enchufes-inteligentes": "gid://shopify/TaxonomyCategory/ha-11-26", // Controles y sensores eléctricos
  "envasadoras-al-vacio": "gid://shopify/TaxonomyCategory/hg-11-7-48", // Envasados al vacío
  "equipos-de-musica": "gid://shopify/TaxonomyCategory/el-2-3-9", // Sistemas estéreo
  "escaneres": "gid://shopify/TaxonomyCategory/el-13-6", // Escáneres
  "espejos-de-bano": "gid://shopify/TaxonomyCategory/hb-3-2-5-1-6", // Espejos para maquillaje
  "espumadores-de-leche": "gid://shopify/TaxonomyCategory/hg-11-7-32", // Máquinas de hacer espuma de leche
  "estaciones-meteorologicas": "gid://shopify/TaxonomyCategory/ha-15-36-38", // Previsiones y estaciones meteorológicas
  "estufas": "gid://shopify/TaxonomyCategory/hg-9-1-12", // Calentadores de ambiente
  "exprimidores": "gid://shopify/TaxonomyCategory/hg-11-7-29", // Exprimidores
  "extractores-de-cocina-y-bano": "gid://shopify/TaxonomyCategory/hg-9-1-6-4", // Ventiladores extractores
  "fiambreras": "gid://shopify/TaxonomyCategory/hg-11-3-7", // Bolsas y contenedores para el almuerzo
  "filtros-de-agua": "gid://shopify/TaxonomyCategory/hg-11-7-50", // Filtros de agua
  "filtros-para-aspiradores": "gid://shopify/TaxonomyCategory/hg-8-11-29", // Filtros
  "fitness-y-salud": "gid://shopify/TaxonomyCategory/hb-1", // Cuidado de la salud
  "flashes": "gid://shopify/TaxonomyCategory/co-1-4-7", // Flashes de la cámara
  "fondues-y-fuentes-de-chocolate": "gid://shopify/TaxonomyCategory/hg-11-7-13", // Juegos para fondues
  "fregaderos": "gid://shopify/TaxonomyCategory/ha-10-3-5-2", // Fregaderos
  "freidoras": "gid://shopify/TaxonomyCategory/hg-11-7", // Electrodomésticos de cocina
  "frigorificos-americanos-y-side-by-side": "gid://shopify/TaxonomyCategory/hg-11-7-41", // Frigoríficos
  "frigorificos-combi": "gid://shopify/TaxonomyCategory/hg-11-7-41", // Frigoríficos
  "frigorificos-de-1-puerta": "gid://shopify/TaxonomyCategory/hg-11-7-41", // Frigoríficos
  "frigorificos-de-2-puertas": "gid://shopify/TaxonomyCategory/hg-11-7-41", // Frigoríficos
  "fuentes-de-alimentacion": "gid://shopify/TaxonomyCategory/el-7-9-3", // Fuentes de alimentación para computadoras
  "fundas-para-moviles": "gid://shopify/TaxonomyCategory/el-4-8-4-2", // Fundas para móviles
  "fundas-para-tablas-de-planchar": "gid://shopify/TaxonomyCategory/hg-10-9-12", // Fundas para tablas de planchar
  "fundas-y-accesorios-para-tablets": "gid://shopify/TaxonomyCategory/el-7-8-4-3", // Accesorios para tabletas
  "fundas-y-maletines-para-portatiles": "gid://shopify/TaxonomyCategory/lb-15", // Bolsos para computadora portátil
  "gafas-de-realidad-virtual": "gid://shopify/TaxonomyCategory/el-6-7", // Gafas inteligentes
  "gofreras-y-creperas": "gid://shopify/TaxonomyCategory/hg-11-7-46", // Tostadores y parrillas
  "grabadoras-de-cd-dvd-y-blu-ray": "gid://shopify/TaxonomyCategory/el-7-9-14-6", // Unidades de disco óptico
  "grabadoras-de-voz": "gid://shopify/TaxonomyCategory/el-2-3-11", // Grabadoras de voz
  "grabadoras-externas": "gid://shopify/TaxonomyCategory/el-7-9-14-6", // Unidades de disco óptico
  "grifos-de-bano": "gid://shopify/TaxonomyCategory/ha-10-3-3", // Grifos
  "grifos-de-cocina": "gid://shopify/TaxonomyCategory/ha-10-3-3-3", // Grifos para fregadero de cocina
  "heladeras": "gid://shopify/TaxonomyCategory/hg-11-7-26", // Heladeras
  "herramientas-electricas": "gid://shopify/TaxonomyCategory/ha-15", // Herramientas
  "hervidores-de-agua": "gid://shopify/TaxonomyCategory/hg-11-7-11", // Hervidores eléctricos
  "hidrolimpiadoras": "gid://shopify/TaxonomyCategory/hg-12-3-12", // Limpiadoras a presión
  "hidromasaje-de-pies": "gid://shopify/TaxonomyCategory/hb-3-11-8-1", // Masajeadores eléctricos
  "home-cinema": "gid://shopify/TaxonomyCategory/el-2-3-3", // Sistemas de cine en casa
  "hornillos": "gid://shopify/TaxonomyCategory/hg-11-7-38", // Cocinas de camping
  "hornos": "gid://shopify/TaxonomyCategory/hg-11-7-35", // Hornos
  "hornos-compactos": "gid://shopify/TaxonomyCategory/hg-11-7-35", // Hornos
  "hornos-de-sobremesa": "gid://shopify/TaxonomyCategory/hg-11-7-46-1", // Hornos tostadores
  "hornos-para-pizza": "gid://shopify/TaxonomyCategory/hg-11-7-46-4", // Aparatos para hacer pizza
  "hornos-polivalentes": "gid://shopify/TaxonomyCategory/hg-11-7-35", // Hornos
  "humidificadores": "gid://shopify/TaxonomyCategory/hg-9-1-9", // Humidificadores
  "iluminacion-inteligente": "gid://shopify/TaxonomyCategory/hg-13", // Iluminación
  "impresoras": "gid://shopify/TaxonomyCategory/el-13-4", // Impresoras, fotocopiadoras y faxes
  "irrigadores-dentales": "gid://shopify/TaxonomyCategory/hb-3-12-5", // Irrigadores dentales
  "jarras-purificadoras-de-agua": "gid://shopify/TaxonomyCategory/hg-11-7-50-4", // Jarras purificadoras de agua
  "joysticks": "gid://shopify/TaxonomyCategory/el-7-9-12-5", // Controladores de juegos
  "kits-solares": "gid://shopify/TaxonomyCategory/ha-11-22", // Kits de energía solar
  "lavadoras": "gid://shopify/TaxonomyCategory/hg-9-8-6", // Lavadoras
  "lavadoras-secadoras": "gid://shopify/TaxonomyCategory/hg-9-8-4-4", // Combinaciones de lavadora y secadora
  "lavavajillas": "gid://shopify/TaxonomyCategory/hg-11-7-9", // Lavavajillas
  "lectores-de-codigo-de-barras": "gid://shopify/TaxonomyCategory/el-7-9-12-1", // Lectores de códigos de barras
  "lectores-de-dni-electronico": "gid://shopify/TaxonomyCategory/el-7-9-12-3", // Lectores de tarjetas electrónicas
  "lectores-de-tarjetas": "gid://shopify/TaxonomyCategory/el-7-9-12-10", // Lectores de tarjetas de memoria
  "lentes-y-filtros-fotograficos": "gid://shopify/TaxonomyCategory/co-1-2-1", // Objetivos para cámaras
  "licuadoras": "gid://shopify/TaxonomyCategory/hg-11-7-29", // Exprimidores
  "limpiacristales": "gid://shopify/TaxonomyCategory/hg-9-10-4", // Aspiradoras portátiles
  "limpiadores-faciales": "gid://shopify/TaxonomyCategory/hb-3-2-5-3-8", // Cepillos y sistemas de limpieza de la piel
  "limpieza-para-electronica": "gid://shopify/TaxonomyCategory/el-7-10", // Limpiadores de dispositivos electrónicos
  "linternas": "gid://shopify/TaxonomyCategory/ha-15-16-1", // Linternas
  "localizadores-gps": "gid://shopify/TaxonomyCategory/el-10", // Localizadores GPS
  "mandos-a-distancia": "gid://shopify/TaxonomyCategory/el-7-16", // Mandos a distancia
  "manos-libres": "gid://shopify/TaxonomyCategory/el-2-2-7", // Auriculares y auriculares con micrófono
  "mantas-electricas": "gid://shopify/TaxonomyCategory/hg-15-1-4-1", // Mantas eléctricas
  "maquinas-de-coser": "gid://shopify/TaxonomyCategory/ae-2-1-4-16-4", // Máquinas de coser
  "maquinas-de-perritos-calientes": "gid://shopify/TaxonomyCategory/bi-8-11", // Máquinas de perritos calientes
  "marcos-digitales": "gid://shopify/TaxonomyCategory/hg-3-52-1", // Portarretratos digitales
  "masajeadores-anticeluliticos": "gid://shopify/TaxonomyCategory/hb-3-11-8-1", // Masajeadores eléctricos
  "matamosquitos-electricos": "gid://shopify/TaxonomyCategory/hg-10-11-2", // Trampas para control de plagas
  "megafonos": "gid://shopify/TaxonomyCategory/el-2-6-1", // Megáfonos y amplificadores de voz personales
  "memoria-ram": "gid://shopify/TaxonomyCategory/el-7-12-3", // Memoria RAM
  "memorias-usb": "gid://shopify/TaxonomyCategory/el-7-9-14-8", // Memorias USB
  "mesas-de-mezclas": "gid://shopify/TaxonomyCategory/el-2-2-3", // Mesas de mezclas
  "mesas-gaming": "gid://shopify/TaxonomyCategory/fr-12-1-8", // Escritorios para gaming
  "microfonos": "gid://shopify/TaxonomyCategory/el-2-2-8", // Micrófonos
  "microondas": "gid://shopify/TaxonomyCategory/hg-11-7-31", // Hornos microondas
  "microondas-integrables": "gid://shopify/TaxonomyCategory/hg-11-7-31", // Hornos microondas
  "mochilas-para-portatiles": "gid://shopify/TaxonomyCategory/lb-1-16", // Mochilas para computadora portátil
  "modulos-de-integracion": "gid://shopify/TaxonomyCategory/hg-11-7-5", // Placas de cocina
  "moldeadores-y-rizadores-de-pelo": "gid://shopify/TaxonomyCategory/hb-3-10-12", // Útiles de peluquería
  "molinillos-de-cafe": "gid://shopify/TaxonomyCategory/hg-11-6-2-6", // Molinillos de café
  "molinillos-electricos-de-sal-y-pimienta": "gid://shopify/TaxonomyCategory/hg-11-8-71", // Molinillos para especias
  "monitores": "gid://shopify/TaxonomyCategory/el-17-1", // Monitores de computadora
  "navegadores-gps": "gid://shopify/TaxonomyCategory/el-9-1", // Sistemas de navegación GPS automotriz
  "objetivos": "gid://shopify/TaxonomyCategory/co-1-2-1", // Objetivos para cámaras
  "ollas-cacerolas-y-cazos": "gid://shopify/TaxonomyCategory/hg-11-2-3", // Utensilios para cocinar
  "ordenadores-de-sobremesa": "gid://shopify/TaxonomyCategory/el-6", // Computadoras
  "packs-de-altavoces": "gid://shopify/TaxonomyCategory/el-2-2-10", // Altavoces
  "packs-de-fregadero-y-grifo": "gid://shopify/TaxonomyCategory/ha-10-3-5-2", // Fregaderos
  "packs-de-teclado-y-raton": "gid://shopify/TaxonomyCategory/el-7-9-12-15", // Juegos de teclado y ratón
  "paelleras": "gid://shopify/TaxonomyCategory/hg-11-2-3-9", // Paelleras
  "palomiteras-y-maquinas-de-algodon-de-azucar": "gid://shopify/TaxonomyCategory/hg-11-7", // Electrodomésticos de cocina
  "paneles-radiantes": "gid://shopify/TaxonomyCategory/hg-9-1-8", // Radiadores
  "panificadoras": "gid://shopify/TaxonomyCategory/hg-11-7-2", // Horno de pan
  "pantallas-de-proyeccion": "gid://shopify/TaxonomyCategory/el-17-5-3-3", // Pantallas para proyección
  "pantallas-tactiles": "gid://shopify/TaxonomyCategory/el-17-11", // Pantallas interactivas y pizarras
  "papel-fotografico": "gid://shopify/TaxonomyCategory/el-13-3-1-8", // Soportes y películas para impresora
  "patinetes-electricos": "gid://shopify/TaxonomyCategory/sg-4-15-1", // Patinetes eléctricos
  "pda": "gid://shopify/TaxonomyCategory/bi-22-4-2-3", // Capturadores de firma
  "picadoras": "gid://shopify/TaxonomyCategory/hg-11-7-54", // Procesadores de comida
  "picadoras-de-hielo": "gid://shopify/TaxonomyCategory/hg-11-7-27-1", // Trituradoras de hielo
  "pilas": "gid://shopify/TaxonomyCategory/el-7-15-1-4", // Baterías multiusos
  "placas-base": "gid://shopify/TaxonomyCategory/el-3-6-2-3", // Placas madre
  "placas-de-gas": "gid://shopify/TaxonomyCategory/hg-11-7-5", // Placas de cocina
  "placas-de-induccion": "gid://shopify/TaxonomyCategory/hg-11-7-5", // Placas de cocina
  "placas-polivalentes": "gid://shopify/TaxonomyCategory/hg-11-7-5", // Placas de cocina
  "placas-vitroceramicas": "gid://shopify/TaxonomyCategory/hg-11-7-5", // Placas de cocina
  "planchas-de-asar-y-grills-electricos": "gid://shopify/TaxonomyCategory/hg-11-7-10", // Planchas y parrillas eléctricas
  "planchas-de-asar-y-parrillas": "gid://shopify/TaxonomyCategory/hg-11-2-3-7", // Planchas
  "planchas-de-pelo": "gid://shopify/TaxonomyCategory/hb-3-10-12-7", // Planchas de pelo
  "planchas-de-ropa": "gid://shopify/TaxonomyCategory/hg-9-8-3-2", // Planchas
  "plotters": "gid://shopify/TaxonomyCategory/el-13-4", // Impresoras, fotocopiadoras y faxes
  "portatiles": "gid://shopify/TaxonomyCategory/el-6-6", // Computadoras portátiles
  "portatiles-reacondicionados": "gid://shopify/TaxonomyCategory/el-6-6", // Computadoras portátiles
  "prismaticos": "gid://shopify/TaxonomyCategory/co-3-1", // Prismáticos
  "procesadores": "gid://shopify/TaxonomyCategory/el-7-9-4", // CPU
  "productos-de-limpieza-para-electrodomesticos": "gid://shopify/TaxonomyCategory/el-7-10", // Limpiadores de dispositivos electrónicos
  "programadores-horarios": "gid://shopify/TaxonomyCategory/ha-11-26-2", // Interruptores temporizadores
  "protectores-de-pantalla": "gid://shopify/TaxonomyCategory/el-7-11-5", // Protectores de pantalla
  "proyectores": "gid://shopify/TaxonomyCategory/el-17-2-1", // Proyectores multimedia
  "pulseras-de-actividad": "gid://shopify/TaxonomyCategory/hb-1-4-1", // Monitores de actividad
  "punteros": "gid://shopify/TaxonomyCategory/el-7-8-10", // Lápices ópticos
  "purificadores-de-aire": "gid://shopify/TaxonomyCategory/hg-9-1-2", // Purificadores de aire
  "quitapelusas": "gid://shopify/TaxonomyCategory/hg-10-9-6", // Máquina de afeitar de tela
  "radiadores-de-aceite": "gid://shopify/TaxonomyCategory/hg-9-1-8", // Radiadores
  "radiodespertadores": "gid://shopify/TaxonomyCategory/el-2-3-7-1-1", // Radios despertadores
  "radios": "gid://shopify/TaxonomyCategory/el-2-3-7", // Radios
  "radios-cd-y-radiocasetes": "gid://shopify/TaxonomyCategory/el-2-3-1", // Equipos estéreo portátiles
  "radios-y-multimedia-para-coche": "gid://shopify/TaxonomyCategory/co-2-7-6", // Cámaras de vídeo para salpicaderos
  "ratones": "gid://shopify/TaxonomyCategory/el-7-9-12-11", // Ratones y trackballs
  "receptores-av": "gid://shopify/TaxonomyCategory/el-2-2-1", // Receptores de audio y vídeo
  "receptores-de-satelite": "gid://shopify/TaxonomyCategory/el-17-3-2", // Receptores satélite
  "receptores-tdt-y-satelite": "gid://shopify/TaxonomyCategory/el-17-3-2", // Receptores satélite
  "recortadoras-de-barba": "gid://shopify/TaxonomyCategory/hb-3-14-6", // Recortadores y cortadores de pelo
  "recortadoras-de-bikini": "gid://shopify/TaxonomyCategory/hb-3-14-6", // Recortadores y cortadores de pelo
  "recortadoras-de-nariz-y-orejas": "gid://shopify/TaxonomyCategory/hb-3-14-4-3-3", // Recortadoras de nariz y orejas
  "regletas": "gid://shopify/TaxonomyCategory/el-7-15-8", // Supresores de sobretensión y regletas
  "relojes-gps-deportivos": "gid://shopify/TaxonomyCategory/el-9-2", // Dispositivos de navegación GPS portátiles y de exterior
  "repetidores-y-sistemas-wifi-mesh": "gid://shopify/TaxonomyCategory/el-12", // Redes
  "reproductores-de-audio-hi-fi": "gid://shopify/TaxonomyCategory/el-2-3", // Reproducción y grabación de sonido
  "reproductores-de-dvd-y-blu-ray": "gid://shopify/TaxonomyCategory/el-17-8-2", // Reproductores DVD y Blu-ray
  "reproductores-mp3-y-mp4": "gid://shopify/TaxonomyCategory/el-2-3-2-3", // Reproductores de audio digital portátiles
  "robotica-educativa": "gid://shopify/TaxonomyCategory/tg-5-9-8", // Juguetes de aprendizaje de programación y robótica
  "robots-aspiradores": "gid://shopify/TaxonomyCategory/hg-9-10-5", // Aspiradoras robot
  "robots-de-cocina": "gid://shopify/TaxonomyCategory/hg-11-7", // Electrodomésticos de cocina
  "routers": "gid://shopify/TaxonomyCategory/el-12-1", // Puentes y enrutadores
  "sai": "gid://shopify/TaxonomyCategory/el-7-15-12", // Baterías auxiliares
  "salud-sexual": "gid://shopify/TaxonomyCategory/ma-1-4", // Juguetes y juegos eróticos
  "sandwicheras": "gid://shopify/TaxonomyCategory/hg-11-7-46-7", // Sandwicheras
  "sartenes": "gid://shopify/TaxonomyCategory/hg-11-2-3-13", // Sartenes para freír
  "secadoras": "gid://shopify/TaxonomyCategory/hg-9-8-1", // Secadoras
  "secadores-de-pelo": "gid://shopify/TaxonomyCategory/hb-3-10-12-6", // Secadores
  "senalizacion-para-coche": "gid://shopify/TaxonomyCategory/vp-1-6-4-2", // Bengalas para emergencia para carretera
  "sensores-y-cerraduras-inteligentes": "gid://shopify/TaxonomyCategory/hg-2", // Seguridad empresarial y del hogar
  "servidores-y-nas": "gid://shopify/TaxonomyCategory/el-7-9-14-5", // Sistemas de almacenamiento de red
  "sets-de-manicura-y-pedicura": "gid://shopify/TaxonomyCategory/hb-3-2-5-2-4", // Juegos de útiles para manicura
  "sillas-gaming": "gid://shopify/TaxonomyCategory/fr-7-7", // Sillones para videojuegos
  "sintonizadoras-de-tv-para-pc": "gid://shopify/TaxonomyCategory/el-7-9-10", // Tarjetas de expansión para computadoras
  "smartphones": "gid://shopify/TaxonomyCategory/el-4-8-5-2", // Teléfonos inteligentes
  "smartphones-reacondicionados": "gid://shopify/TaxonomyCategory/el-4-8-5-2", // Teléfonos inteligentes
  "smartwatches": "gid://shopify/TaxonomyCategory/aa-6-12", // Relojes inteligentes
  "software": "gid://shopify/TaxonomyCategory/so-1", // Software informático
  "soportes-de-tv-y-monitor": "gid://shopify/TaxonomyCategory/el-17-5-5-1", // Soportes para monitores y televisor
  "switches-y-hubs": "gid://shopify/TaxonomyCategory/el-12-3", // Concentradores y conmutadores
  "tablas-de-planchar": "gid://shopify/TaxonomyCategory/hg-10-9-14", // Tablas de planchar
  "tablets": "gid://shopify/TaxonomyCategory/el-6-8", // Tablets
  "tarjetas-de-memoria": "gid://shopify/TaxonomyCategory/el-7-12-2-1", // Tarjetas de memoria flash
  "tarjetas-de-red": "gid://shopify/TaxonomyCategory/el-12-6", // Adaptadores y tarjetas de red
  "tarjetas-de-sonido": "gid://shopify/TaxonomyCategory/el-7-9-10-1", // Tarjetas de audio
  "tarjetas-graficas": "gid://shopify/TaxonomyCategory/el-7-9-10-5", // Tarjetas de vídeo
  "teclados": "gid://shopify/TaxonomyCategory/el-7-9-12-8", // Teclados
  "telefonos-fijos": "gid://shopify/TaxonomyCategory/el-4-8-2", // Teléfonos fijos
  "telefonos-inalambricos": "gid://shopify/TaxonomyCategory/el-4-8-3", // Teléfonos inalámbricos
  "telefonos-voip": "gid://shopify/TaxonomyCategory/el-4-8-2-2", // Teléfonos VoIP
  "televisores": "gid://shopify/TaxonomyCategory/el-17-4", // Televisores
  "tensiometros": "gid://shopify/TaxonomyCategory/hb-1-4-3", // Monitores de presión sanguínea
  "termometros": "gid://shopify/TaxonomyCategory/hb-1-4-9", // Termómetros médicos
  "termos": "gid://shopify/TaxonomyCategory/hg-11-3-10", // Termos
  "termos-electricos": "gid://shopify/TaxonomyCategory/hg-9-12", // Calentadores de agua
  "termoventiladores": "gid://shopify/TaxonomyCategory/hg-9-1-12", // Calentadores de ambiente
  "teteras": "gid://shopify/TaxonomyCategory/hg-11-10-2-2", // Teteras
  "toalleros-de-bano": "gid://shopify/TaxonomyCategory/hg-1-21-5", // Calentadores de toallas
  "toalleros-electricos": "gid://shopify/TaxonomyCategory/hg-1-21-5", // Calentadores de toallas
  "tocadiscos": "gid://shopify/TaxonomyCategory/el-2-3-10", // Gramófonos y tocadiscos
  "toner": "gid://shopify/TaxonomyCategory/el-13-3-1-7", // Cartuchos de tinta y tóner
  "tostadoras": "gid://shopify/TaxonomyCategory/hg-11-7-46-8", // Tostadores
  "tpv": "gid://shopify/TaxonomyCategory/bi-22-4", // Administración de dinero
  "trituradores-de-residuos-para-fregadero": "gid://shopify/TaxonomyCategory/hg-11-7-22", // Trituradores de desechos
  "tv-box-y-sticks-de-tv": "gid://shopify/TaxonomyCategory/el-17-8-4", // Reproductores multimedia domésticos y de streaming
  "utensilios-de-cocina": "gid://shopify/TaxonomyCategory/hg-11-8", // Herramientas y utensilios de cocina
  "vaporetas": "gid://shopify/TaxonomyCategory/hg-9-3", // Limpiadores de vapor de alfombras y suelos
  "ventiladores": "gid://shopify/TaxonomyCategory/hg-9-1-6", // Ventiladores
  "ventiladores-y-refrigeracion-para-pc": "gid://shopify/TaxonomyCategory/el-7-9-7", // Piezas de refrigeración del sistema para computadoras
  "videocamaras": "gid://shopify/TaxonomyCategory/co-2-7", // Cámaras de vídeo
  "videojuegos": "gid://shopify/TaxonomyCategory/so-3-2", // Videojuegos físicos
  "videovigilancia": "gid://shopify/TaxonomyCategory/co-2-5", // Cámaras de vigilancia
  "videowalls": "gid://shopify/TaxonomyCategory/el-17-12", // Pantallas y kits de videowall
  "vigilabebes": "gid://shopify/TaxonomyCategory/bt-4-3", // Interfonos para bebés
  "vinotecas": "gid://shopify/TaxonomyCategory/hg-11-7-51", // Neveras para vino
  "volantes-gaming": "gid://shopify/TaxonomyCategory/el-7-9-12-5-1", // Volantes para juegos de carreras
  "walkie-talkies": "gid://shopify/TaxonomyCategory/el-4-4-4-2", // Radios bidireccionales portátiles
  "webcams": "gid://shopify/TaxonomyCategory/co-2-8", // Cámaras web
  "woks": "gid://shopify/TaxonomyCategory/hg-11-2-3-17", // Woks
  "yogurteras": "gid://shopify/TaxonomyCategory/hg-11-7-52", // Yogurteras
};
