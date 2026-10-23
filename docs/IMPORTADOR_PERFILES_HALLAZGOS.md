# Perfiles de familia: hallazgos y dudas (2026-10-23)

Resultado de rehacer los perfiles de **130 familias de MHD** con subagentes de Claude Code (Opus 5.5, razonamiento alto), más los 3 ya revisados por David (G01 lavadoras, H01 frigoríficos, C10 preparación de alimentos). Cubren las 313 subfamilias con productos (fuera: S95 Productos de Marketing y S93 Servicios y Garantías). Están en la base local como **borrador** (`mhd_importer_family_profiles`, modelo «claude-opus-5-5 (Claude Code, razonamiento alto)»): 1.248 reglas y 205 dudas, cada una con su recomendación. Herramienta: `scripts/perfil-familia.mjs` (exportar la entrada del analista y validar/guardar un perfil).

## Cambios de código que piden los datos (por prioridad)

1. **Negaciones en el respaldo por texto.** Las descripciones de MHD dicen lo que el producto no tiene («sin grill», «no incluye convección», «X: No», «prescinde de…») y el respaldo con «contiene» marca la característica igualmente (6 de 15 microondas con convección falsa; monitores con pantalla táctil). Arreglo: ignorar coincidencias precedidas de «no/sin/ni/prescinde de» o seguidas de «: no», comparar por palabra entera («ipl» en «múltiples») y usar el texto solo si la fuente estructurada no tiene dato. Afecta también a G01, H01 y C10 (revisados).
2. **El modelo y la marca cuentan como «cifra sin respaldo».** `unsupportedNumbers` lee los números del modelo («DH 1655», «Televes 435501», «Gran Turismo 7», «010-02469-10»): bloquearía ~780 productos solo en S15/S28/S30. Arreglo: quitar marca, modelo y nombre comercial de Icecat del texto antes de comprobar, y no comprobar versiones de norma («USB 3.2», «HDMI 2.1»).
3. **Modelo de MHD que no sirve** (código interno «HO…», «VE10541245», ASIN, EAN, texto «TAPADERA 20 CM», cortado «PROTECTOR APPLE IPH», de otro producto en Fellowes). Arreglo: limpiar el modelo (quitar «(2 uds)», color en inglés…) y usar el modelo/nombre comercial de Icecat comprobado cuando el de MHD no lo sea; si no hay, a revisión. También para la dirección web (hoy usa `ref_proved`).
4. **Unidades y números.** Faltan km, GB, TB, MB/s, Mbps, Gbps, MP, mAh, DPI, ppp, VA/kVA, lm, bar, L/min, m³/h, m², hojas; coma de miles («1,600W», «4,000 lm», «5,000 tazas») leída como decimal; cifras pegadas («500GB», «10x»); Icecat da pantallas «39,6 cm (15.6")» y se coge el cm.
5. **La hoja de datos y los datos clave no respetan `min`/`max`** («2W» de MHD por 2000 W entra en la hoja; Icecat con medidas absurdas desplaza a MHD). Aplicar los límites de las reglas al construir la hoja y en `missingKeyData`; revisar la prioridad de Icecat en medidas (falla en fregaderos, modulares, hornos).
6. **Filtros de un solo valor con tramo vacío** («»): escriben «» y bloquean la regla siguiente (afecta a H01 alto/ancho). Tratar «» como «sin valor» en todos los metacampos.
7. **Características repetidas en MHD** (varios «Color», «Compatible»): `sourceValues` se queda con la última. Juntarlas.
8. **Cifras que solo están en el texto** (mueble de fregadero, longitud de cables, ml y páginas de consumibles, reacondicionados): extraer de `descripcion_ampliada` las cifras con unidad como fuente de respaldo de la hoja, y pasar a la hoja los valores de filtros calculados.
9. **Muestra del analista sesgada a lo barato** (`selectSample` coge el más barato por subfamilia y marca): repartir por precio y subfamilias grandes, y repasar los perfiles con una muestra nueva (sonido, TV, informática, cafeteras, redes).
10. **«(solo …)» en datos clave**: compara por prefijo de 5 letras y empareja mal («planc», «aspir»); hacerlo exacto. Los paréntesis sin «solo» no se exigen (C10 «Potencia (todas salvo…)» no se exige sin querer).
11. **Escala energética antigua** (A+++ a D en hornos, campanas, cocinas; A+ a F en termos y calentadores): el respaldo `letra_eficiencia` → «Nueva X» las clasifica mal.
12. **Fuente `icecat:categoria`** para nombrar, filtrar y descartar productos mal clasificados por MHD; la redacción tampoco recibe la categoría ni el título de Icecat.
13. **Tabla de marcas** (urgente): Icecat escribe «CATA», «JATA», «NOX» (Krom), «Sony Interactive Entertainment», «De'Longhi DeLonghi», «DCU Advance Tecnologic»; MHD pone marcas de otra empresa del grupo o equivocadas (Zanussi/Electrolux, «Marshall» en Savio, «Apple» en Emtec, Yashica como «UAG»).
14. **Pesos absurdos** (209 kg en un patinete, 85 kg en un descalcificador) llegan al peso de la variante en Shopify: poner límites.
15. Otros: `classifyInStore` ignora palabras de ≤3 letras; `productDistinction` toma un «Sí» como variante; el PVP de algunas muestras parece mal leído (revisar); `analystInput` no da tipos parecidos cuando la raíz no coincide (G20).

## Decisiones generales para David (valen para varias familias)

- **Valores nuevos de filtros** que se repiten: «2K» (750, 925, 905), escala común de autonomía en horas (auriculares, altavoces) y en minutos (aspiradores, limpiacristales), «Quad HD», «QHD», tipos de panel de TV (LED, QLED, Mini LED, OLED), plataformas de consola, tamaños de pila, colores nuevos («Cian», «Magenta», «Transparente», «Madera», combinados «Rojo y negro»…), capacidades nuevas (GB/TB, servicios, L/día…).
- **Qué no se importa o va a revisión:** reacondicionados sin datos (21), teclados en otros idiomas, maquetas «DUMMY», antenas WiFi en la familia de antenas de TV, unidades sueltas de aire acondicionado, productos de Salud sexual (2), productos con precio raro (protector de 184 €).
- **Productos mal clasificados por MHD** (muchos, en casi todas las familias S y en 115, 410, 510, L01, 905): se nombran por Icecat y se recolocan con el árbol nuevo de colecciones.
- **Compatibilidad en el título de accesorios** («para TV LG»): solo si los datos dan un único equipo.
- **Datos actuales de la tienda a corregir en el refresco:** 24 televisores con serie «QN90» que no lo son, 5 termos con «Nueva C», smartphones con «A/B» sin «Nueva», emisores con «N elementos» en potencia, 2 placas con «1 zonas».

## Dudas por familia

Cada perfil lleva sus dudas en `profile.questions` con una recomendación (205 en total). Se revisan por familia en Sincro («Importador de productos» → Familias). Resúmenes de cada grupo:

## I80, I85, I90, I60, I70 (fregaderos, grifos, cocinas, módulos, conjuntos)
Dudas: I80 ancho de mueble solo en texto (pasar valores de filtros calculados a la hoja); Tegranite→Fibra Sintética; Nova SIENA5043N manda el texto. I85 no rellenar filtro.tipo (estilo); caño bajo <20 cm; 10028311 FO 915 vs AUK 983 (fuera). I90 tipo de gas como filtro.tipo (sí); Meireles NAT vs Butano (a mano); no usar respaldo «Nueva X» en hornos/cocinas (escala antigua). I60 Beko HDCC MHD vitro vs Icecat inducción (manda MHD); no poner gas en título/tipo.

## G40, G20, G60, H40, H50 (lavavajillas, lavasecadoras, secadoras, congeladores, vinotecas)
Dudas: G40 «servicios» (no cubiertos); valores nuevos de servicios exactos. G20 clase del ciclo completo; valores nuevos secado «Menos de 5 kg»/«Más de 8 kg»; >10 kg → «Más de 10 kg». G60 Miele TWA 520 integrable erróneo (a mano). H40 arcones sin dato → «Cíclico» por subfamilia; rellenar capacidad con tramos de 100 L. H50 Encastrable=integrable; No reversible=libre.

## 405, 410, 445, 480, 490, 420, 455, 450, 409 (informática resto)
Dudas: 405 capacidades nuevas (aprobar); productos mal clasificados (cajas, SAS, red) → descartar/revisión por categoría Icecat; nombre comercial Icecat delante del código MHD. 410 pantallas nuevas 15/15,6/17"; nombrar por Icecat/descripcion_ampliada, revisión si no hay. 445 lectores SD vendidos como DNIe → «Lector de tarjetas de memoria» + revisión. 480 tipos nuevos Antivirus/Ofimática (solo si hay colección); importar solo antivirus y M365; modelos genéricos MHD rompen validación. 490 «Solar & Pilas» nuevo; nombre+código. 420 7,8", 16/32 GB nuevos. 455 modelos MHD de otro producto en Fellowes (manda Icecat); tipos de corte nuevos.

## B15, B10, B20, B95, B90, 705, 750, 790, 701, 760 (salud y domótica)
Dudas: B15 tipos de almohadilla (solo «Calientapiés» automático); ¿importar Salud Sexual (2 Satisfyer)? (sí, neutro, o excluir B1528). B10 «Oscilante»/«Sónico» en filtro.tecnologia (nuevos). B20 tensiómetros en Termómetro → a mano. 705 «Pulsera de actividad» y «Anillo inteligente» nuevos; no meter pulgadas en tamano_pantalla (es caja mm). 750 «2K» nuevo; Icecat primero en visión nocturna/WiFi/movimiento. 760 capacidad 1,6 vs 2 L → fuera del título.

## I01, I20, I10, I75 (hornos, placas, microondas, campanas)
Dudas: I01 «Catálisis» nuevo en filtro.limpieza; tecnologia=limpieza mientras tanto; «Grill» aunque lo tengan casi todos (ya en 160 hornos); «Integrable» fuera del título. I20 característica nueva «Portátil»; «1 fuego» (corregir 2 placas con «1 zonas»). I10 probar 4-5 integrables antes del masivo. I75 sacar lista real de «Tipo de Campana» de MHD; caudal Icecat primero.

## C01, C30, C20, C50, C05, C60, C65 (pequeño de cocina)
Dudas: C01 capacidad: tazas ≥3 o litros; molinillos en gramos (nuevos); potencias imposibles en italianas; Aluminio→Plata. C30 diámetro en filtro.ancho (¿valores 18-28 cm son de sartenes?); tipos de sartén (Sartén/Grill/Wok/Crepera). C20 tramos nuevos de capacidad; «Bambú» material. C50 ruedas en más especificaciones; colores comerciales→existentes. C05 CADR en filtro.potencia con tramos m³/h; botellas Brita a mano. C65 modelo MHD vs descripción.

## 201, 210, 215, 220, 230, 235, 240, 250, 260, 270 (sonido)
Dudas: 201 tipos nuevos «In-ear»/«Diadema»; escala de autonomía común (Menos de 6 h… Más de 40 h); MHD no fiable en cancelación de ruido (revisar gama >40 €). 210 potencia Icecat primero; revisar 5-10 de >100 €. 240 Icecat «Batería»→«Pilas». 260 «Quad HD» nuevo.

## S06, S50, S07, S90, S62, S33, S55, S65, S88 (accesorios pequeños 2)
Dudas: muchas de productos sueltos mal clasificados → revisión manual (EW1545, EW1517, Balay 3AV605XB, Conceptronic CIRO, Jata HTEN2375, Trust 23333, Logitech Spotlight, Neckar, Televés 212701, Youin MD0031, Vitrokitchen REG2830-1); marca de TV en mandos fuera del título; modelos MHD que son textos (Teka «DISPENSADOR DE JABON», Televés «CABLE COAX…», De'Longhi «SET DLSC500 500ML») → usar la referencia.

## A01, A20, A10, A40, B05, B01 (limpieza y cuidado)
Dudas: A01 escala común de autonomía (tramos de afeitadoras + «Menos de 20» y «61-89 minutos»), las 19 aspiradoras actuales pasan a tramos; vaporetas en bar; modelos «HO…» → modelo de Icecat comprobado. A20 potencia de planchas a W (vapor a más especificaciones); depósito nuevos tramos; probar centros de planchado. A10 bar nuevos. B05 «Luz pulsada», «Rotativa», «De láminas» nuevos; productos ajenos a revisión. B01 nombres de moldeadores; mal clasificados a revisión. Tienda: «EloxaPlus» vs «EloxalPlus».

## 101, 106, 105, 115, 107, 108, 109 (imagen)
Dudas: 101 filtro.tecnologia nuevos LED/QLED/Mini LED/OLED (aprobar); filtro.serie sin fuente, 24 «QN90» erróneos en la tienda; LG QNED81 QLED vs MiniLED (piloto). 106 «QHD» nuevo; IPS/VA/TN/OLED en tecnologia; landings de TV que filtran solo por tamaño podrían coger monitores; modelos internos Maxhub/Viewsonic → Icecat. 105 lúmenes con coma de miles; DLP/3LCD solo en título. 115 11 de 18 son antenas WiFi, no importarlas con esta familia. 107 nombre de modelo de Icecat (Amazon cortado). 109 revisar Meta a mano.

## S70, S09, S60, S03, S85, S69, S67, S10, S37, S75 (accesorios pequeños 1)
Dudas (todas con recomendación en el perfil): productos ajenos a la familia → tipo por Icecat + aviso + recolocar en el árbol nuevo (S70, S09: 39/54 genéricos, S10: mitad no es audio); marcas de MHD de otra empresa del grupo/erróneas (S60 Zanussi/Electrolux, Franke/Mepamsa; S03 Savio «Marshall»…) → Icecat; Icecat y MHD de productos distintos (S85 Leifheit, Bra); unidades de pack sin exigir (S69); S67 aparatos enteros y modelo repetido en dos fichas (10118781/10081876); S10 objetivo Sony 557 € a revisar; S37 balizas V16 con colección propia; S75 Alfa descrito como Alfa Laval.

## K90, K25, K45, K01, K50, K95, K71, K65, K42, K80, K15 (clima resto)
Dudas: K90 escala A+..F sin «Nueva» (corregir 5 con «Nueva C»); referencia como modelo + nombre comercial en descripción; «1800 W» nuevo. K25 tramos nuevos L/día. K45 «1800 W» nuevo; Svan SVCA01CH Icecat primero. K01 unidades interior/exterior sueltas: no publicar; tramos kW nuevos. K50 «Radiador de mica». K71 kits Engel sin datos (pedir a MHD). K80 Neckar 7724000174 → K90.

## 501, 510, M20, L01, L50 (gaming, muebles, herramientas)
Dudas: 501 plataformas nuevas en filtro.tipo (PS5, PS4, Switch, Switch 2); modelo de juego = código o nombre en mayúsculas → comprobar contra el nombre del juego; marcas «Sony Interactive Entertainment» → Sony, «Sin Marca» a mano. 510 21/27 son Arduino/Raspberry/robótica → separarlos en el árbol; modelo con marca y tipo dentro. M20 colores combinados nuevos («Rojo y negro»…); materiales «Polipiel», «Tela». L01 la familia casi no tiene herramientas (repartir en el árbol).

## K10, K35, K20, K40, K30, K55 (clima calor y aire)
Dudas: K10 tipos nuevos De pie/Sobremesa/Torre/Portátil; ventiladores de PC → informática. K40 emisores y calientacamas mezclados → a mano. K30 sin valores nuevos de tipo (llama azul, infrarrojos, braseros sin tipo). K55 vatios en toda la calefacción; pasar los 19 emisores con «N elementos» en potencia a vatios en el refresco.

## S15, S28, S30 (cables, consumibles, componentes)
Dudas: S15 tipos nuevos de conexión (HDMI, DisplayPort, USB-C…); longitud solo en descripción ampliada → extraerla por código; 497 modelos numéricos (#36). S28 colores nuevos «Cian», «Magenta»; ~50 Dayma con marca de la impresora (regla Dayma si «M-»); no crear filtro original/compatible; ml y páginas solo en descripción → extraer por código y añadir «Rendimiento». S30 subfamilias muy mal asignadas (7/15) → tipo por categoría Icecat; sin filtros nuevos de socket/formato; códigos internos → modelo de Icecat.

## 301, 380, 650, 640, 610 (telefonía y movilidad)
Dudas: 301 reacondicionados (21) fuera del masivo hasta extraer datos de la descripción; batería por centenas 2.000-7.500 mAh y «1 TB» nuevos; color en título solo en smartphones. 380 alcance Icecat primero. 650 «Z?MO® XT3» → modelo de Icecat si trae «?»; localizadores mezclados. 640 recolocar. 610 autonomía km en filtro.autonomia (nuevo).

## 901, 925, 910, 905, 990, 940 (fotografía)
Dudas: 901 MP nuevos en filtro.resolucion (redondeados abajo); réflex/sin espejo/analógicas sin tipo hasta el árbol; Yashica con marca «UAG»/«Sangean» (YAS- → Yashica). 925 sin colección en la tienda («Webcams»); «2K» decidir una vez (igual que 750). 910 «8K», «5,3K», «2,7K» nuevos; crear «Cámaras deportivas». 905 casi no hay videocámaras (NVR, IP, Maxhub) → videovigilancia en el árbol. 990 «10"» y «Madera» nuevos. 940 sin tipo en la tienda.

## 485, 435, 401, 408, 430, 460 (informática grande)
Dudas: 485 rehacer muestra (5-8 por subfamilia) y revisar; filtro «Tipo» no por ahora (o añadir icecat:categoria como fuente). 435 importar solo distribución española, resto al informe (regla de descarte en código). 401 valores nuevos de tipo/pantalla/RAM/capacidad; WUXGA→Full HD. 408 capacidades nuevas. 430 «Inyección de tinta»/«Láser»/«Térmica» en tecnologia; no impresoras a revisión. 460 VA por tramos, topología, autonomía nuevos; VA/kVA en unidades; baterías/ventilador/RTX a revisión.

## S25, S01, S40, S20, S32, S35 (accesorios medianos)
Dudas: compatibilidad «para <equipo>» en el título cuando hay un único equipo (S25, S40, S35); productos que no son de la familia → tipo Icecat y mover; modelo código interno (2 letras + 7-9 cifras, DSP…) → Icecat; tramos nivel sonoro <40 dB. S01 «VESA hasta 200x200»; filtros solo Icecat. S40 «Transparente» nuevo; pulgadas nuevas. S20 tamaños de pila nuevos (AA, AAA, C, D, 9V, Botón); mAh por tramos en filtro.autonomia. S32 filtro WiFi sin Icecat no. S35 modelos truncados (~37 JC) → Icecat o revisión; maquetas «DUMMY» no importar; protector Blackfire 184 € «Nintendo» no publicar.
