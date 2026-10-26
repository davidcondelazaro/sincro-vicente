# Incoherencias detectadas en los datos del catálogo de MHD

**Para:** equipo técnico y comercial de MHD (mihogardigital.es)
**De:** Electrónica Vicente
**Fecha:** 26 de octubre de 2026

## Alcance y forma de leer el informe

- **Origen de los datos:** su API, en dos llamadas:
  - el listado `/products`, descargado el 22-10-2026;
  - la ficha de cada producto, `/products/:codigo`, descargada el 23-10-2026.

  Puede que algo ya esté corregido después de esas fechas.
- **Productos revisados:** 24.024, es decir, todo el catálogo salvo la familia S93 (Servicios y Garantías) y la S95 (merchandising). De ellos, 23.572 tienen ficha y 13.412 traen características.
- **Cómo se identifica cada producto:**
  - **código MHD:** el campo `codigo`;
  - **EAN:** el campo `codigo_ean`;
  - **modelo:** el campo `ref_proved`.
- **Contrastes:** cuando un dato se compara con otra fuente, se indica cuál: «su propia descripción» (campos `descripcion` o `descripcion_ampliada`), «su web» o «la ficha del fabricante».
- **Lo que no hemos podido confirmar** va marcado como **«a comprobar»**.
- **Anexos:** cada apartado remite a un CSV (separado por comas, UTF-8) con la lista completa de productos. Están en la misma carpeta que este informe.

---

## 1. Resumen

| # | Incidencia | Productos afectados | Impacto | Prioridad |
|---|---|---|---|---|
| 1 | **Fotos:** el campo `imagen` del listado apunta a una ruta que no existe en la mitad de los casos (63 de 120 en una muestra). La foto sí está en `img/analyzed/mhd/`. | 1.156 productos solo tienen esa foto en la API. Por la muestra, unos 600 se quedan sin ninguna foto descargable. | Un producto sin foto no se puede publicar. | Alta |
| 2 | **Fichas sin fotos:** 2.044 fichas traen `fotos` vacío aunque su web sí muestra fotos. Otros 453 productos no tienen ficha (error 404). | 2.497. De ellos, 1.341 no tienen ninguna foto en la API. | Igual que el punto 1. | Alta |
| 3 | **Dominios autorizados en el CDN:** de los tres dominios autorizados para descargar fotos, dos se bloquean en la práctica. | Todas las descargas desde esos dos dominios. | Las fotos no se pueden descargar desde esos sistemas. | Alta |
| 4 | **Marca equivocada en el producto:** cartuchos Dayma con la marca de la impresora, productos FRITZ! como «Apple», Yashica como «UAG», Remington como «Philips»… | 118: 68 confirmados, 7 muy probables y 43 a comprobar. | Producto mal identificado; aparece en la marca que no es. | Alta |
| 5 | **Marcas duplicadas o mal escritas:** misma marca con varios códigos y nombres con espacio al final («Hisense »). | 38 grupos de códigos duplicados (8 con productos repartidos en dos códigos, 90 productos en el secundario). 68 marcas con espacio al final (607 productos). | Una misma marca aparece partida en dos. | Media |
| 6 | **Modelo (`ref_proved`) que no es el del fabricante:** códigos internos, textos truncados, números en notación científica, caracteres estropeados. | 179 seguros y 1.873 probables códigos internos de distribuidor. | El cliente no encuentra el producto por su modelo; los títulos salen con códigos. | Media |
| 7 | **Características:** nombres con erratas o duplicados, valores escritos de varias formas, valores erróneos, medidas en mm rotuladas como cm, coma de miles, decimales partidos en dos y dos clases energéticas contradictorias. | 1.086 valores erróneos en 889 productos. Además hay problemas de nombres y formatos en miles de fichas (apartado 7). | No se puede filtrar ni comparar con fiabilidad. | Media-alta |
| 8 | **Datos concretos erróneos:** integrables que no lo son, material, tipo de gas, modelo, descripción de otro producto, etiqueta energética de otro modelo… | 73 casos: 36 confirmados y 37 a comprobar. | Información falsa al cliente, con riesgo de devoluciones. | Alta |
| 9 | **Productos en una subfamilia que no les corresponde.** | 34 casos documentados en 33 familias, con 52 productos identificados. Además, subfamilias casi enteras: «Discos CD y Blu Ray» (S2825, 101 productos, sobre todo SSD y discos duros) y «Accesorios genéricos para Cámaras» (S0920). | Productos en categorías y filtros que no son los suyos. | Media |
| 10 | **EAN no válidos:** dígito de control incorrecto o prefijo de uso interno (20-29). | 125 | No casan con el producto real en buscadores ni comparadores. | Media |
| 11 | **Precios muy por encima del mercado.** Por ejemplo, una funda a 1.321 €, una memoria DDR5 de 16 GB a 505 € o cables USB a 189 €. | 8 (a comprobar) | Riesgo comercial. | Media |
| 12 | **`es_garantia` a `false`** en las propias extensiones de garantía. | 2 (todo el catálogo tiene `false`) | No se pueden distinguir los servicios de los productos. | Baja |

**Las tres peticiones más urgentes:**

1. **Corregir la ruta del campo `imagen`** para que apunte a `img/analyzed/mhd/<archivo>`. **Rellenar `fotos`** en las 2.044 fichas que lo tienen vacío y dar ficha a los 453 productos que devuelven 404.
2. **Revisar la autorización de los dominios** dados de alta el 02-10-2026.
3. **Corregir las marcas y modelos equivocados** del anexo 05 y del anexo 10.

---

## 2. Fotos: ruta del campo `imagen`

**Qué pasa:**

- El campo `imagen` del listado da URLs con la forma `https://cdn.mihogardigital.es/img/<archivo>`.
- En la mitad de los casos ese archivo no existe en el servidor: el almacenamiento (S3) responde **403**, que es lo que devuelve cuando falta el archivo.
- El mismo archivo sí está en `https://cdn.mihogardigital.es/img/analyzed/mhd/<archivo>`, que es la ruta que usa su web.

**Cifras:**

- **Muestra de 120 productos (26-10-2026):**
  - 57 se descargan bien en la ruta de la API;
  - 63 solo existen en `img/analyzed/mhd/`.
- **El problema de ruta no depende del dominio:** incluso con el dominio autorizado, esas 63 rutas fallan.
- **Productos que solo tienen esta foto en la API:** 1.156. Son 721 con ficha sin fotos y 435 sin ficha (apartado 3). Por la muestra, **unos 600** se quedan sin foto descargable (estimación).

**Ejemplo:**

| Código MHD | EAN | Modelo | Campo `imagen` (API) | Resultado | Ruta que funciona |
|---|---|---|---|---|---|
| 10144280 | 8806099121051 | TQ75QN73HAUXXC (Samsung) | `img/8806099121051_m002.webp` | 403 | `img/analyzed/mhd/8806099121051_m002.webp` (su web muestra 10 fotos, de `_m002` a `_v002`) |

**A comprobar:** el campo `fotos` de las fichas también trae enlaces con la ruta `img/<archivo>`, sin `analyzed/mhd`. Son 40.085 enlaces en 10.604 productos y no los hemos comprobado. Si les pasa lo mismo, el alcance es mayor.

**Qué pedimos:**

1. Que `imagen` (y, si es el caso, cada enlace de `fotos`) apunte a la ruta donde el archivo existe (`img/analyzed/mhd/`), o que el archivo se publique también en la ruta que da la API.
2. Que la API no devuelva enlaces a archivos que no existen.

---

## 3. Fichas sin fotos y productos sin ficha

**Qué pasa:**

- **Fichas sin fotos:** 2.044 fichas (`/products/:codigo`) no traen el campo `fotos` o lo traen vacío, aunque su web sí muestra fotos de esos productos.
- **Productos sin ficha:** 453 productos del listado no tienen ficha (la API responde «404»).

**Cifras (anexo 01):**

| Situación | Productos |
|---|---|
| Ficha sin `fotos`, pero con `imagen` en el listado | 721 |
| Ficha sin `fotos` y sin `imagen` | 1.323 |
| Sin ficha (404), con `imagen` en el listado | 435 |
| Sin ficha (404) y sin `imagen` | 18 |
| **Total sin ninguna foto en la API** | **1.341** |

Por líneas, las que más fichas sin fotos tienen son:

| Línea | Fichas sin fotos |
|---|---|
| Accesorios | 620 |
| Informática | 388 |
| Sonido | 265 |
| Hogar | 242 |
| Cocción | 123 |

**Comprobación en su web el 26-10-2026 (anexo 02).** La hemos hecho con una consulta normal a su buscador, que redirige a la ficha, y leyendo las fotos del HTML de la página.

| Código MHD | EAN | Modelo | `fotos` en la API | Fotos en su web |
|---|---|---|---|---|
| 10144280 | 8806099121051 | Samsung TQ75QN73HAUXXC | vacío | 10 (`img/analyzed/mhd/…_m002` a `_v002`) |
| 10084925 | 4002516867968 | Miele TWD 640 | vacío | 5 (`…_a001`, `_c001`, `_f001`, `_n`, `_r`) |
| 10026959 | 8436555982607 | Corbero CC900X | vacío | 1 (`…_a001`) |
| 10141743 | 8806096704479 | LG 86QNED86B6B.AEU | vacío (y `imagen` vacío) | ninguna, solo la etiqueta energética |
| 10083530 | 8445946023911 | Hyundai HQP19283NEDCW00 | vacío (y `imagen` vacío) | ninguna, solo la etiqueta energética |

En los tres primeros casos su web tiene fotos que la API no da. En los dos últimos tampoco hay fotos en su web: son productos sin fotos en origen.

**Qué pedimos:**

1. Rellenar `fotos` con las mismas fotos que muestra su web.
2. Dar ficha a los 453 productos que devuelven 404.
3. Para los productos sin ninguna foto, incluso en su web, conseguirla del fabricante o indicarnos que no la habrá.

---

## 4. Descarga de fotos: dominios autorizados

**Qué pasa:** el CDN de fotos filtra las descargas por el dominio de origen (cabecera `Referer`). Hay tres dominios autorizados:

- `electronicavicente.com`, el 28-09-2026;
- `electronica-vicente.myshopify.com` y `sincro-vicente.vercel.app`, el 02-10-2026 (confirmado por Diego Borrajo).

**Prueba del 26-10-2026, con las 63 fotos que existen en `img/analyzed/mhd/`:**

| Dominio de origen | Resultado |
|---|---|
| `electronicavicente.com` | Se descargan las 63 |
| `sincro-vicente.vercel.app` | Se bloquean 10 de 63 |
| `electronica-vicente.myshopify.com` | Se bloquean 10 de 63 |
| Dominio inventado o sin dominio | Se bloquean las mismas 10 de 63 |

Es decir, **los dos dominios del 02-10 se comportan como si no estuvieran autorizados**.

**Qué pedimos:**

1. Revisar que `electronica-vicente.myshopify.com` y `sincro-vicente.vercel.app` estén de verdad autorizados en el CDN.
2. Confirmarnos cuando esté hecho, para volver a probarlo.

---

## 5. Marcas

### 5.1. Marca equivocada en el producto (anexo 05)

**Qué pasa:** el campo de marca (`cd_marca` / `nombre_marca`) no corresponde al fabricante. Muchas veces el propio título de MHD nombra otra marca.

**Cifras:** 118 productos:

- 68 confirmados (el título, la descripción o el modelo dicen otra marca);
- 1 con el error en el título;
- 6 muy probables (el modelo y el prefijo del EAN son de otra marca);
- 43 a comprobar (marcas del mismo grupo o del distribuidor).

**Ejemplos confirmados:**

| Código MHD | EAN | Modelo | Marca actual | Marca correcta | Prueba |
|---|---|---|---|---|---|
| 10006656 y 49 más | 6986000014398… | M-LC121BK, M-T0712, M-CF530BK… | Brother (25), Epson (13), HP (12) | Dayma | El título y la descripción dicen «DAYMA» |
| 10151240, 10151241, 10151299, 10151300 | 4023125031281… | MESH SET 1700, REPEATER 1700, MESH SET 1600 | Apple | AVM (FRITZ!) | EAN de AVM (4023125…); son productos FRITZ! |
| 10008158, 10008172 | 4023125028854, 4023125029530 | FRITZ!REPEATER 600 / 6000 | Navman | AVM (FRITZ!) | El modelo y el EAN son de AVM |
| 10110424 a 10110429, 10110459 | 4582712710751… | YAS-DGC100-BK, YAS-DGM100-OW… | UAG (5), Sangean (1) | Yashica | Los modelos YAS- son de Yashica |
| 10068018 | 4008496941612 | S1A100 | Philips | Remington | Según la ficha del fabricante, la S1A100 es una plancha de pelo de Remington; el EAN también es de Remington |
| 10085110 | 5901986047988 | SAVPILOTRC13-SONY | Marshall | Savio | El título dice «SAVIO» |
| 10086253, 10086242 | 8720689036818, 8720689035217 | HX6062/87, HX6062/88 | Oral B | Philips | El título dice «PHILIPS» |
| 10000643 | 8716184076022 | URC1312 | Sony | One For All | El título dice «ONE FOR ALL» |
| 10085609 | 4977766718523 | DR241CL | Pantum | Brother | El título dice «BROTHER»; el EAN es de Brother |
| 10010708 | 0790069248153 | DEM-311GT | D-Link (correcta) | — | El título dice «CISCO»; su descripción ampliada dice «D-LINK» |

**Muy probables:**

| Código MHD | Modelo | Marca actual | Marca probable | Motivo |
|---|---|---|---|---|
| 10151107 | 90MB1BB0-M0EAY0 | Gigabyte | Asus | Referencia y EAN de Asus |
| 10086353 | WCA008KQ1MWH-B6 | Trust | Belkin | Modelo y EAN de Belkin |
| 10120927 | SHC5200M2/12 | Samsung | Philips | Modelo y EAN de Philips |
| 10106705 | U11 | Realme | Tenda | Modelo y EAN de Tenda |
| 10077627 | PROTECTOR LENTE APPLE IPH | Apple | UAG | EAN de UAG |
| 10013300 | HJGAN245-EU | Hyperx | HYPER | El título dice «HYPER» |

**A comprobar:** la marca no coincide con la del título. Puede ser una marca del mismo grupo o la del distribuidor:

| Marca actual | Marca del título | Productos |
|---|---|---|
| Approx | Keep Out | 19 |
| Youin | Engel | 9 |
| Nilox | Ewent o Equip | 7 |
| Nanocable | Tooq | 4 |
| One For All | Vogel's | 1 |
| Phasak | Lanberg | 1 |
| HYPER | Targus | 1 |
| Zanussi | AEG | 1 |

**Qué pedimos:**

1. Poner la marca del fabricante real en todos los productos del anexo 05.
2. En los compatibles, usar la marca del compatible (Dayma), no la de la impresora.

### 5.2. Misma marca con varios códigos o nombres (anexo 04)

**Qué pasa:**

- Hay 2.058 códigos de marca, de los que 535 tienen productos.
- Varias marcas existen dos o más veces con nombres distintos.
- En 8 casos los productos de una misma marca están repartidos entre dos códigos:

| Código principal | Productos | Código secundario | Productos |
|---|---|---|---|
| IP COM (2891) | 13 | IP - COM (4292) | 1 |
| StarTech (3015) | 205 | STARTECHCOM (4296) | 5 |
| Phoenix (3961) | 191 | PHOENIX TECHNOLOGIES (4284) | 27 |
| Unyka (2787) | 42 | Unykach (4254) | 33 |
| Fonestar (1540) | 59 | FONESTAR SISTEM (4300) | 1 |
| Western Digital (2782) | 43 | WESTERN DIGITAL WD (4287) | 2 |
| Dahua (2686) | 12 | Dahua Technology (3552) | 1 |
| Be Quiet! (2951) | 14 | Be (3070) | 20 |

- En Phoenix y Unyka, los productos del código principal ya se titulan «PHOENIX TECHNOLOGIES» y «UNYKACH».
- Otros 30 grupos repiten una marca con códigos sin productos: Tp-Link / TPLINK (×2), D-Link / DLINK (×2), «ASUS.», «LOGITECH.», «LENOVO.», Black & Decker / BLACK+DECKER / BLACKDECKER (×2), «zzBraun» (×4), «zzLG» (×4), Fritz / AVM… Conviene darlos de baja o desactivarlos.

**Qué pedimos:** un único código por marca. Los productos de los códigos secundarios deben pasar al principal.

### 5.3. Nombres de marca con espacios al final (anexo 03)

**Qué pasa:** 68 nombres de marca terminan en espacio. Por ejemplo, «Hisense », «Beurer », «Denver », «Elbe », «One For All », «Edesa », «Delonghi », «Fagor », «Remington »…

**Cifras:** 19 de esas marcas tienen productos, 607 en total.

**Qué pedimos:** quitar los espacios sobrantes en el maestro de marcas.

---

## 6. Modelo (`ref_proved`) que no es el del fabricante (anexo 10)

**Qué pasa:** en muchos productos el modelo es un código interno, un texto descriptivo o un dato estropeado. Con eso, el cliente no encuentra el producto por su referencia.

| Problema | Productos | Ejemplos (código MHD, modelo actual → modelo real si se conoce) |
|---|---|---|
| Número en notación científica (dato estropeado al pasar por una hoja de cálculo) | 8 | 10003389 Sharkoon «4,04495E+12»; 10010881 Silver «1,11935E+11» |
| Caracteres estropeados («?» en lugar de letras o símbolos) | 7 | 10113381 Garmin «F?NIX® 8 PRO» → fēnix 8 Pro; 10144155 «Z?MO® XT3» → zūmo XT3 |
| Código interno «HO» + cifras | 23 | 10072255 Gembird «HO0232210»; 10072292 Xiaomi «HO21253016» |
| Código interno «MGS» / «DSP» | 42 | «DSP0000017290» (Forever), «MGS0000009605» (Mercusys) |
| Texto descriptivo o truncado | 99 | 10118761 JC «PROTECTOR APPLE IPHONE 17»; 10077627 «PROTECTOR LENTE APPLE IPH»; Teka «DISPENSADOR DE JABON» (real: 115890012); De'Longhi «SET DLSC500 500ML» (real: DLSC500) |
| Probable código interno de distribuidor: dos letras de categoría y 7-9 cifras, con el mismo prefijo en varias marcas (CA, CN, TV, PT, CJ, FA, VE, EQ…) | 1.873 (a comprobar uno a uno; el patrón es claro) | 10121902 «VE10541245» (be quiet! Pure Loop 3); 10123247 «VE20356114» (NOX Hummer Pro Link); 10115147 Gigabyte «PB211541426»; 10150390 Maxhub «AV0458009»; 10137786 Meta «MD12556246» (Meta Quest 3) |
| Color añadido al final del modelo | 231 | «WALL 3325 BLANCO», «DC8200 PINK», «BCS200BK BLACK» |

**Prueba de que son códigos internos:** en varios productos su propia descripción usa el modelo real:

- 10077949 Equip, modelo «EQ606312»: la descripción habla del «Equip 133454»;
- 10060356 Equip, modelo «EQ133453»: la descripción dice «Modelo 133385».

**Qué pedimos:**

1. Que `ref_proved` sea siempre el modelo o la referencia del fabricante, tal como figura en el producto y en su documentación.
2. Si necesitan conservar su código interno, que vaya en otro campo.
3. Revisar los números en notación científica y los caracteres estropeados, que vienen de un fallo de exportación.

---

## 7. Características de la ficha

Las características (`caracteristicas`) son la base para filtrar y comparar productos, y hoy no están normalizadas. Las cifras siguientes son de las 13.412 fichas que traen características: 122.733 valores con 634 nombres distintos.

### 7.1. Nombres (anexo 06)

**Erratas y espacios:**

- «**Bluethooth**» en 808 productos, que conviven con «Bluetooth» (1.686).
- «**Tipo de  Montaje**», con doble espacio, en 850 productos, frente a «Tipo de montaje».

**El mismo nombre con distinta mayúscula:**

| Variantes | Productos |
|---|---|
| «Wifi» / «WiFi» | 2.418 |
| «Tamaño pantalla» / «Tamaño Pantalla» | 930 |
| «Ram» / «RAM» | 765 |
| «Clase energética» / «Clase Energética» | 676 |
| «Nº Hdmi» / «Nº HDMI» | 599 |
| «No frost» / «No Frost» | 272 |
| «zonas cocción» / «Zonas cocción» | 232 |

Hay 12 casos en total; todos están en el anexo 06.

**El mismo concepto con varios nombres:**

- **Color:** «Color», «Color del producto», «Color Cafeteras» y «Color de la carcasa». Suman 11.491 productos.
- **Clase energética:** «Clase energética», «Nueva Clase Energética» y «Clase de eficiencia de energía».
- **Capacidad:** «Capacidad», «Capacidad interior», «Capacidad (L)» y «Capacidad Total».

**Dos nombres para lo mismo en la misma ficha:**

| Pareja | Fichas | Con valores distintos |
|---|---|---|
| «Color» y «Color del producto» | 186 | 41 |
| «Clase energética» y «Nueva Clase Energética» | 432 | 21 (apartado 7.4) |
| «Capacidad» y «Capacidad interior» | 188 | 4 |

**Qué pedimos:** un nombre único por concepto, sin erratas ni dobles espacios y con las mismas mayúsculas en todo el catálogo.

### 7.2. Formatos de los valores (anexos 07 y 08)

- **Sí / No escrito de varias formas:**
  - «Si» sin tilde en 843 valores (677 productos);
  - «1» en lugar de «Sí» en características de sí o no;
  - también «sí», «SI», «SÍ» y «x».
  - 81 características mezclan formas. Por ejemplo, «Teclado numérico» usa «1», «Si» y «Sí», y «Montaje en rack» usa «Si», «SI», «Sí» y «SÍ».
- **Unidades pegadas o con distinta grafía:**

  | Unidad | Formas encontradas |
  |---|---|
  | Gigabytes | «16 GB» (1.073), «16GB» (715), «24Gb.» (61), «16gb» (56), «1000 Gb» (14), «16Gb» (10) |
  | Kilos | «8Kg» (3.502) frente a «8 kg» (52) |
  | Vatios | «2000W» (3.448) frente a «2000 W» (104) y «1,200w» (17) |

- **Medidas del embalaje mezcladas con las del producto (anexo 09):**
  - 599 fichas, sobre todo de pequeño electrodoméstico (132 batidoras, 88 tostadoras, 83 planchas, 53 freidoras), traen en la misma lista «Alto/Ancho/Largo de la caja principal», «Peso del envase completo» o «Altura paquete».
  - Esas medidas van sin unidad y con punto decimal («32.00»), mientras que las del producto llevan unidad y coma («32cm»).
  - 13 fichas solo traen las medidas de la caja.

**Qué pedimos:**

1. Un formato único: «Sí» / «No», número con espacio y unidad («16 GB», «8 kg», «2000 W») y coma decimal.
2. Las medidas del embalaje separadas de las del producto, o con un nombre que lo deje claro y con su unidad.

### 7.3. Valores erróneos (anexo 07)

| Problema | Valores | Productos | Ejemplo (código MHD, modelo, campo: valor actual → esperado) |
|---|---|---|---|
| Valor de error o de relleno | 62 | 47 | 10138752 Aspes AL7206AIDVB, Ancho y Profundidad: «CONFLICTO_MAPEADO» (también 10138754 AL6205AIDV, 10145484 AHE1300X y 10145486 Svan SL8204AIDV); 10089357 HP 99A91ET#ABE, Cámara: «Información no disponible»; 10106566 Ewent EW1582, Altura, Ancho y Profundidad: «undefined»; 10105992 CoolBox COO-SOP-MP01: «Registro no disponible» |
| Cero en medidas, peso, potencia o capacidad | 182 | 154 | 10000416 Tooq LP1070F-B, Peso: «0Kg»; 10122875 Svan SR185602ENFD, Capacidad congelador: «0L» |
| Medidas en mm rotuladas como cm | 30 | 17 | 10059292 Beko RDSA280K40WN, Altura: «1606cm» → 160,6 cm; 10142109 Corbero CLVM7725W, Ancho: «598cm» → 59,8 cm y Altura: «845cm» → 84,5 cm; 10066959 Edesa EZH-5011, Ancho: «1700cm» → 170 cm |
| Coma como separador de miles (en español se lee como decimal) | 762 | 629 | 10068912 Balay 3BC599AB, Máxima capacidad de extracción: «1,007 m³/h» → 1.007 m³/h; proyectores: «4,000» lúmenes, «20,000 Hours»; hornos de sobremesa: «1,800w» |
| Cifras recortadas | — | — | 10138904 Sony VPL-PHZ61/1, ANSI lúmenes: «6,4» (6.400 lm); 10138903 Sony VPL-PHZ51/1: «5,3» |
| Decimal partido en dos entradas (parece que la coma decimal se toma como separador de lista) | 25 | 24 | 10050656 Cata TFH 6430 X, Altura: «18» y «2cm» → 18,2 cm; 10083530 Hyundai HQP19283NEDCW00, Profundidad: «59» y «8cm» → 59,8 cm |
| Valor de otra característica | — | — | 10141736 LG 75MRGB87B6B.AEU, HDR: «1,00 cm»; 10074986 Miele KM 7667 FL, Campana integrada: «Con@ctivity para conexión automática» |
| Valores de plantilla que no cuadran | — | — | 10000414 Tooq LP1043F-B, Peso: «510Kg»; 10000442 Ewent EW1501: «560Kg»; 10078958 Khomo SELFIE STICK K07, Tipo Soporte: «TV» |

**Además, campos que fallan de forma sistemática en algunas familias.** Los hemos visto al revisar muestras de cada familia, contrastando con la ficha del fabricante o con su propia descripción. Solo listamos los campos que fallan en el 20 % de la muestra o más. Las proporciones son de esas muestras, no del catálogo entero.

| Familia | Característica | Fallos en la muestra | Ejemplos y detalle |
|---|---|---|---|
| Proyectores | «Óptica y Tiro Proyector» = «Auto Focus» | 32 de 62 sin autoenfoque | En la base, 33 de los 62 proyectores con ficha traen «Auto Focus» |
| Lavasecadoras | «Nueva Clase Energética» | 8 de 26 | Trae la clase del lavado, no la del ciclo completo («A», «B», «A-10%», «A / D») |
| Secadoras | Clase energética | 3 de 13 | 10023546 Corbero CSM320W (anexo 12) |
| Teclados | «Interruptor del teclado» = «Mecánico» | 20-23 % | Teclados de membrana o tijera marcados «Mecánico»: fundas Microsoft Surface (EP2-32025, EP2-32884, 8XB-00148, 8XB-00145, 8XB-00149, ZRA-00013), Logitech K120 (10041277) y K270 (10007230), K620 y Apple Magic Keyboard |
| Cafeteras | «Color Cafeteras» = «Acero Inoxidable» | 6 de 7 | 10016410 De'Longhi EC260.W, que es blanca; 10016782 Orbegozo KF 100, de aluminio |
| Micrófonos | «Bluetooth» en el título y la ficha | 2 de 9 | Sistemas UHF Fonestar SONAIR-2M (10095919) y SONAIR-2MP (10098377) titulados «Micrófono Inalámbrico Bluetooth» (a comprobar) |
| Minicadenas | Potencia | 3 de 11 | — |
| Altavoces | «Potencia» | Un tercio de la muestra | Mezcla la potencia total con la de cada altavoz |
| Altavoces | «Autonomía» | — | Un Aiwa con «7,4 h», que es el voltaje de la batería; unos Logitech Z207 sin batería con «2 h» |
| Altavoces | «Wifi» = «Sí» | 10 de 32 | Su descripción no menciona WiFi |
| Tocadiscos | «Funcionamiento» | 3 de 9 | 10068388 Aiwa VPX-1971 y 10069406 Muse MT-207PGR, «Manual»; 10151467 Lenco LS-100WD, «Semiautomático» (la ficha del fabricante dice automático) |
| Auriculares | «Noise Cancelling» = «Sí» | Sistemático | Modelos sin cancelación activa: 10114800 Dell WH125-DWW, unos Energy Sistem StreetMusic de 23 €; a comprobar 10084489 NGS ARTICAHUSH |
| Cámaras de vigilancia | «Wifi», «Visión nocturna», «Sensor de movimiento» = «Sí» | Sistemático | 10090783 Synology TC500, que es una cámara PoE con cable |
| Discos externos | Velocidad | 31 de unos 90 | — |
| Purificadores | Superficie | 3 de 10 | — |
| Purificadores y ventiladores | Nivel sonoro | 2 de 10 | «99dB», que parece un valor de plantilla. También aparece como «Nivel de ruido del ventilador (máx.)» en ventiladores y calefactores |
| Destructoras Fellowes | Modelo | 6 de 12 | Apartado 8 |
| Placas | «Campana integrada» | 6 de 11 | De 15 placas del catálogo con «Sí» o «1», solo 4 llevan de verdad extractor integrado (Balay 3EBC963ER, Cata AS 750 y AS 600, y Mepamsa INDU MAX). En las otras 11, incluidas 4 de gas, su descripción no menciona extractor (anexo 12) |
| Soportes | «Tamaño máximo de pantalla» y «Peso» | Sistemático | Valores de plantilla: 75" en un soporte de coche; 510-560 kg en soportes de pared |
| Televisores | «Tecnología de visualización TV» | — | Mini LED rotulado como QLED o LED (10144278 Samsung TQ55QN70HAUXXC, 10144282 TU100M90HUXXC, 10151977 Hisense 55U7S PRO, 10140234 Hisense 65E8S) y Micro RGB como LED (10144262 Samsung TMR55R85HAUXXC). En todos, su propia descripción dice Mini LED o Micro RGB |

**Qué pedimos:**

1. Corregir los valores del anexo 07.
2. No enviar una característica cuando no se conoce su valor, en lugar de «0», «-», «undefined» o «CONFLICTO_MAPEADO».
3. Revisar el origen de los campos citados en cada familia.

### 7.4. Clase energética (anexo 07)

- **Dos clases distintas en la misma ficha:** 21 productos traen «Clase energética» y «Nueva Clase Energética» con letras distintas:

  | Código MHD | Modelo | Clase energética | Nueva Clase Energética |
  |---|---|---|---|
  | 10046181 | Beko DVN05320W | A++ | E |
  | 10068849 | Bosch SMS4EKI06E | B | A |
  | 10068941 | Balay 3VS5011BA | A | D |
  | 10084832 | LG GBV3100APY | C | A |

  En la misma ficha conviven la escala antigua (A+++ a D) y la actual (A a G).
- **Valores no válidos en «Nueva Clase Energética»:** «A-10%» (2), «D/A» y «A / D».
- **«Clase energética»** usa la escala antigua (A+, A++) en 79 valores.
- **A comprobar con la etiqueta oficial:**
  - 10023546 Corbero CSM320W: C en MHD; la ficha del fabricante da otra clase;
  - 10140530 Haier HWS247GEH1: E en MHD y G según la ficha del fabricante.
- **Etiqueta energética de otro modelo:** en la lavadora Electrolux EW6F3924AL (10022912, EAN 7332543989324), el archivo enlazado en `img_ficha_eficiencia` es la etiqueta de la **EN6F5922FB** (EPREL 1335607), no la de la EW6F3924AL.

**Qué pedimos:**

1. Una sola característica de clase energética, con la escala vigente (A-G) donde aplique e indicando la escala cuando sea la antigua.
2. Revisar los 21 casos contradictorios.
3. Revisar la etiqueta de la EW6F3924AL.

---

## 8. Datos erróneos concretos por producto (anexo 12)

73 casos: 36 confirmados y 37 a comprobar. Los principales:

| Código MHD | EAN | Modelo | Campo | Valor actual | Valor correcto o esperado | Prueba | Estado |
|---|---|---|---|---|---|---|---|
| 10139276 | 4242005553679 | Bosch SPS2HKI55E | Integrable y título | Sí, «Lavavajillas Integrable» | Libre instalación | Su descripción ampliada: «LAVAVAJILLAS LIBRE INSTALACIÓN» | Confirmado |
| 10084955 | 4002516868637 | Miele TWA 520 | Integrable y título | Sí, «Secadora Integrable» | Libre instalación | Su descripción ampliada: «SECADORAS DE LIBRE INSTALACIÓN» | Confirmado |
| 10022912 | 7332543989324 | Electrolux EW6F3924AL | Etiqueta energética | Etiqueta de la EN6F5922FB | La de la EW6F3924AL | El archivo lleva otro modelo | Confirmado |
| 10057104 | 4242005307401 | Bosch DWK91LT60 | Máxima capacidad de extracción | 1007 m³/h | 441 m³/h según la ficha del fabricante | Diferencia de más del doble | A comprobar |
| 10060805 | 6935364072766 | TP-Link Tapo P100 (pack de 2) | Potencia | 2990 W | 2300 W (10 A a 230 V) | El mismo pack en 10152017 trae 2300 W | Confirmado |
| 10010693, 10010694, 10010696, 10010698, 10010699, 10010702 | 0043859642854… | Fellowes «POWERSHRED 60CS», «POWERSHRED LX85», «LX45» | Modelo, título y características | El de otro modelo | 60Cs, P-25S, M-7C, LX45, 12C y LX25 | Su descripción ampliada | Confirmado |
| 10108266 | 6942138936865 | Bestway «256370» | Modelo | 256370 | 57326 | Su descripción ampliada: «BESTWAY 57326 - PISCINA» | Confirmado |
| 10028115, 10028116 | 7612986162929, 7612986162912 | Mepamsa SQUARE 50.40 | Material | Acero inoxidable | Sintético | Su descripción ampliada: «ACABADO SINTETICO» | Confirmado |
| 10142979 | 8436558026131 | Nova SIENA5043N | Material | Acero inoxidable | Sintético | Su descripción ampliada: «FREGADERO SINTETICO» | Confirmado |
| 10083966 | 8435092434389 | Monix M240226 | Tipo y título | Olla a presión | Olla con tapa de vidrio | Su descripción ampliada | Confirmado |
| 10110115 | 8445946025861 | Svan SKM4501X | Tipo de gas | Natural | Butano | Su descripción ampliada: «COCINA MIXTA GAS BUTANO» | Confirmado |
| 10084086 | 5604409073518 | Meireles G1530DVW1NAT | Tipo de gas | Butano | Gas natural (sufijo NAT) | — | A comprobar |
| 10060677 | 4015867223260 | Conceptronic 2CONCIRO01W | Descripción | De un switch HDMI | Caja UV esterilizadora | Su descripción ampliada | Confirmado |
| 10060678 | 4015867223277 | Conceptronic 2CONCIRO01WC | Descripción | De un kit de teclado y ratón | Caja UV esterilizadora con cargador | Su descripción ampliada | Confirmado |
| 10055209 | 8436584384601 | Jata HTEN2375 | Descripción | De las bolsas de lavado HPLA5210 | Tendedero de aluminio | Su descripción ampliada | Confirmado |
| 10137542 | 0195951030715 | Apple «SMARTPHONE APPLE IPHONE» | Título, subfamilia o precio | «Funda…», 1.321 €, subfamilia de fundas | Coherente: funda a precio de funda, o iPhone con título y subfamilia de smartphone | Su descripción es de un iPhone 17E de 256 GB | Confirmado |
| 10060729 | 6940533542094 | Unyka TPVCAJON 56001 | Procesador y pantalla | «Intel Core i3», «17"» | Ninguno (cajón portamonedas) | — | Confirmado |
| 10092164, 10062458 | 0887930952858, 0887930959521 | Kodak 30952850, 30959521 | Descripción | De una cámara compacta | Pila | — | Confirmado |
| 10001271 | 8713439204421 | Trust 20442 | Potencia, canales y tipo | 600 W, 5.1, Home Cinema | Altavoces de PC 2.1 de 9 W según la ficha del fabricante | — | A comprobar |
| 10118781 / 10081876 | 8720689029094 / 8720689029070 | Philips CP0709086 | Modelo | El mismo modelo en dos códigos (45 € y 48 €) | Modelo correcto de cada uno o un solo código | — | A comprobar |
| 10083530 | 8445946023911 | Hyundai HQP19283NEDCW00 | Título | «puerta Francesa … 466L … 193cm» | Coherente con su web, que muestra «4 puertas 350l 192cm» y el modelo HAM19283NEDCW00 | — | A comprobar |
| 10028188 | 8434778004786 | Teka «DISPENSADOR DE JABON» | Modelo | DISPENSADOR DE JABON | 115890012 | Su descripción ampliada | Confirmado |
| 10039592 | 8436545137383 | Svan SVCA01CH | Potencia | 2000 W («Niveles de potencia: 3W») | 1500 W según la ficha del fabricante | — | A comprobar |
| 10139601 | 4573535358909 | Daikin ATXF35F | Título | «Sistema split…» | Indicar que es solo la unidad interior | Se vende la unidad interior suelta | A comprobar |
| 10139813 | 8432884645275 | Daitsu DS-12KTP-6 | Título | «Aire Acondicionado de Instalación…» | Indicar que es solo la unidad interior | Se vende la unidad interior suelta | A comprobar |
| 10109786 | 4069143129371 | Neckar 7724000174 | Subfamilia | Calentador a Gas | Termo eléctrico (su título dice «Eléctrica 2000W») | Anexo 13 | Confirmado |
| 10106011 / 10086799 | 4977766666961 / 6986000011861 | Brother TN230Y / Dayma M-LC3219M | Color | Negro | Amarillo / Magenta (sufijos Y y M) | No lo localizamos en los datos actuales de la API | A comprobar |

**Descripción ampliada con texto de plantilla:** 12 productos de Aspes y Svan (p. ej. 10145497 Svan SI2302, 10138781 Aspes AMW2701N) traen en `descripcion_ampliada` el texto «ESCRIBA AQUÍ SU DESCRIPCIÓN».

**Qué pedimos:** corregir los casos confirmados y revisar los marcados «a comprobar».

---

## 9. Productos en una subfamilia que no les corresponde (anexo 13)

**Qué pasa:** al revisar muestras de cada familia encontramos 34 casos en 33 familias en los que la subfamilia de MHD no corresponde al producto. El anexo 13 recoge los 52 productos identificados por modelo. Los más llamativos:

- **«Discos CD y Blu Ray» (S2825, 101 productos):** casi todo son SSD y discos duros (Seagate, Western Digital, Samsung, Kingston, Crucial, MSI, Adata…).
- **«Accesorios genéricos para Cámaras» (S0920):** la mayoría son divisores y conmutadores HDMI/VGA (Lanberg, Ewent, Aisens), carcasas Mobotix y películas Fujifilm.
- **«Videocámaras» (90501):** casi no hay videocámaras. Son grabadores NVR, cámaras IP (TP-Link, Ubiquiti), sistemas de videoconferencia (Maxhub) y cámaras Sony sin espejo.
- **«Disco Duro Portátil» (40501):**
  - cajas para discos: 10072099 Leotec LEM2EXT01 y 10007728 QNAP TR-002;
  - discos SAS de servidor: 10097861 Dell 161-BBQD y 10089831 Dell 345-BHVZ;
  - una tarjeta de red 10GbE: 10081813 Synology E10G22-T1-MINI.
- **«Lector Digital de DNI» (44510):** son lectores de tarjetas SD (10007946 Conceptronic BIAN02B, 10007944 Equip 245460, 10007939 Trust 24136); su propia descripción ampliada lo dice.
- **«Termómetro» (B2005):** tensiómetros Beurer BM23 (10141854) y BC27 (10141833).
- **«Calefactores eléctricos» (K4001):** radiadores de mica y de aceite, emisores, toalleros y calientacamas (7 productos).
- **«Ventilador de Aire» (K1001):** ventiladores y disipadores de PC (Cooler Master, be quiet!).
- **«Calentador a Gas» (K8001):** 10109786 Neckar 7724000174, que según su título es eléctrico de 2000 W.
- **«Accesorio para TV» (S0601):** elevadores de monitor, soportes para PC de HP, un mando de aire acondicionado y una estación de trabajo de pie (10001181 Ewent EW1545, 127 €).
- **Otros:**
  - «Accesorio para Audio e HiFi» (S1001): un objetivo Sony SELP18105G de 557 € (10001444);
  - «Cargador de Corriente» (S1520): un armario de carga para 30 portátiles de 1.700 € (10082889 Ewent EW1702);
  - «Accesorios para Aspirador» (S7001): una hidrolimpiadora completa Kärcher K3 (10139609).
- **Familias que mezclan productos muy distintos:** TPV (410), Herramientas eléctricas (L01, con pocas herramientas), Localizadores GPS (650) y Pulseras de actividad (705, con bandas pectorales Garmin HRM 600).

**Qué pedimos:** revisar la asignación de subfamilia de estos productos y, en especial, de las subfamilias S2825, S0920 y 90501.

---

## 10. EAN no válidos (anexo 11)

**Qué pasa:** 125 productos tienen un EAN que no es válido como código del fabricante:

- **104 con el dígito de control incorrecto.** Por ejemplo, 10059910 Equip EQ235324 (4016867154106) y 10057578 Solac FAST 2200 IONIC (8433466000625).
- **97 con prefijo 20-29.** Es un rango reservado al uso interno, no un código GS1 del fabricante. Son sobre todo protectores JC (66), con EAN «2900000…».

76 productos tienen los dos problemas. En la lista hay maquetas como 10147160 Samsung «DUMMY A27 MAQUETA» (2900000034802).

**Qué pedimos:** el EAN real del fabricante. Si un producto no lo tiene, que se indique.

---

## 11. Precios a comprobar (anexo 14)

**Qué pasa:** algunos PVP están muy por encima del precio habitual del producto. Pueden ser errores de carga.

| Código MHD | Modelo | PVP | Observación |
|---|---|---|---|
| 10137542 | Apple «SMARTPHONE APPLE IPHONE» | 1.321 € | Se vende como funda (apartado 8) |
| 10137881 | Kingston KF560C36BBE2-16 | 505 € | Memoria DDR5 de 16 GB |
| 10010642 | Samsung MZ-77E4T0B/EU | 2.156 € | SSD 870 EVO de 4 TB |
| 10077101, 10077099 | BlackFire USB-A a USB-C / microUSB | 189 € | Cables USB |
| 10077098 | BlackFire Switch | 164 € | Protector de pantalla |
| 10120277 | QNAP TS-H3087XU-RP-E2378-64G | 22.231 € | Servidor NAS (puede ser correcto) |

**Qué pedimos:** confirmar o corregir estos PVP.

---

## 12. Garantías: campo `es_garantia`

**Qué pasa:** el campo `es_garantia` está a `false` en todos los productos del catálogo. También en las dos extensiones de garantía:

- 10040581 G3CES250, «Extensión de garantía»;
- 10040582 G3CES500.

**Qué pedimos:** marcar `es_garantia = true` en los servicios de garantía para poder distinguirlos de los productos.

---

## 13. Resumen de lo marcado «a comprobar»

1. Los 40.085 enlaces de `fotos` con la ruta `img/<archivo>` (10.604 productos): no sabemos si les pasa lo mismo que al campo `imagen`.
2. La cifra de unos 600 productos sin foto descargable es una estimación hecha con la muestra de 120.
3. Los 1.873 modelos con forma de código interno de distribuidor: el patrón es claro, pero no los hemos revisado uno a uno.
4. Los 43 productos cuya marca no coincide con la del título: pueden ser marcas del mismo grupo o del distribuidor.
5. Los 37 casos marcados así en el anexo 12, entre ellos:
   - el caudal de la Bosch DWK91LT60;
   - las clases energéticas de Corbero CSM320W y Haier HWS247GEH1;
   - 11 placas con «Campana integrada»;
   - el gas de la Meireles G1530DVW1NAT;
   - el Trust 20442;
   - el Philips CP0709086 duplicado;
   - el título del Hyundai HQP19283NEDCW00 frente a su web;
   - la potencia del Svan SVCA01CH;
   - las unidades interiores sueltas Daikin ATXF35F y Daitsu DS-12KTP-6;
   - los Fonestar SONAIR y el NGS ARTICAHUSH;
   - el color «Negro» del Brother TN230Y y del Dayma M-LC3219M.
6. Los 8 precios del anexo 14.
7. El almacenamiento del Kindle Paperwhite, señalado en nuestra revisión: no hemos localizado el producto en los datos actuales de la API (solo aparece el Kindle 16 GB, 10109436).
8. Las proporciones de fallo por familia del apartado 7.3 salen de muestras. Las de minicadenas, discos externos y purificadores no las hemos vuelto a comprobar en la base.

---

## Anexos

| Archivo | Contenido | Filas |
|---|---|---|
| `anexo_01_fotos_fichas_sin_fotos.csv` | Fichas sin `fotos` y productos sin ficha, con su campo `imagen` | 2.497 |
| `anexo_02_fotos_comprobacion_en_su_web.csv` | Productos comprobados en su web el 26-10-2026 | 5 |
| `anexo_03_marcas_con_espacios.csv` | Nombres de marca con espacio al final y productos de cada una | 68 |
| `anexo_04_marcas_duplicadas.csv` | Grupos de códigos de marca para la misma marca | 85 (38 grupos) |
| `anexo_05_marcas_equivocadas.csv` | Productos con marca equivocada: marca actual, esperada, grado de certeza y motivo | 118 |
| `anexo_06_caracteristicas_nombres.csv` | Nombres de características con erratas, variantes o duplicados | 67 |
| `anexo_07_caracteristicas_valores_erroneos.csv` | Valores erróneos por producto: valor actual, problema y valor esperado | 1.086 |
| `anexo_08_caracteristicas_si_no.csv` | Características que escriben «Sí» de varias formas | 81 |
| `anexo_09_caracteristicas_embalaje.csv` | Fichas con medidas del embalaje mezcladas con las del producto | 599 |
| `anexo_10_modelos_ref_proved.csv` | Modelos que no son el del fabricante, por tipo de problema | 2.283 |
| `anexo_11_ean_no_validos.csv` | EAN con el dígito de control incorrecto o prefijo de uso interno | 125 |
| `anexo_12_datos_erroneos_por_producto.csv` | Datos erróneos concretos: campo, valor actual, valor correcto, prueba y estado | 73 |
| `anexo_13_subfamilias_mal_asignadas.csv` | Productos en una subfamilia que no les corresponde | 52 |
| `anexo_14_precios_a_comprobar.csv` | PVP a comprobar | 8 |

Quedamos a su disposición para revisar cualquiera de estos puntos y para volver a comprobarlos cuando estén corregidos.
