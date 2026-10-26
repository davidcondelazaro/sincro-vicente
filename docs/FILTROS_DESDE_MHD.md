# Filtros de la tienda a partir de las fichas de MHD: conclusiones

Análisis del 2026-10-23, con las 23.572 fichas descargadas (`mhd_catalog_product_details`), 312 subfamilias y 1.738 productos
que ya están en la tienda, cruzados por EAN. Mapa interactivo (privado): https://claude.ai/artifact/WG8HZxThr53hFbLVJDxrD4.
Decisión de partida (David): los filtros se deciden **solo a partir de MHD**; los productos actuales de Shopify no cuentan.

## 1. Dónde hay datos y dónde no

- **Hay características donde importa.** Lavado, frío, cocción, televisores y campanas las traen en el 100 % de las
  fichas. Informática, sonido, belleza, hogar y climatización, en más del 95 %.
- **No hay características** en 10.160 fichas (43 %). Casi todas son accesorios y consumibles (9.700 de 11.322), y además
  muebles y herramientas. Esos productos solo tendrán los filtros estándar: marca, precio, tipo de producto y
  disponibilidad.
- MHD no tiene ficha de 453 productos del listado. Tampoco tendrán filtros.

## 2. Las características de MHD son datos, no filtros listos

MHD enseña lo que tiene, pero no está normalizado para filtrar:

- **El mismo concepto con varios nombres, a veces en el mismo producto:** «Color» y «Color del producto» (microondas),
  «Capacidad» y «Capacidad interior», «Clase energética» (etiqueta antigua, A+) y «Nueva Clase Energética» (E) a la vez,
  «Bluethooth», «Tipo de  Montaje» con doble espacio.
- **El mismo valor escrito de varias formas:** «Sí», «Si» y «1»; «16GB», «16 GB» y «16Gb.»; «8Kg» frente al «8 kg» de la
  tienda.
- **Valores erróneos:** «CONFLICTO» (ancho de una lavadora), «0», «Información no disponible», «1,00 cm» como HDR de un
  televisor.
- **Medidas del embalaje mezcladas con las del producto** en el pequeño electrodoméstico: «Alto de la caja principal» o
  «Peso del envase completo».
- **Medidas exactas con muchísimos valores:** 43 profundidades distintas en lavadoras, 259 en soportes, 112 caudales
  de extracción en campanas. Sin tramos, se pasa del límite de 100 valores por filtro y colección, y además no sirven
  para elegir.

Por eso cada subfamilia necesita una **tabla de traducción**: campo de MHD → filtro, con la normalización del valor
y los tramos. Eso es lo que pasa a ser el perfil de familia, rehecho desde los campos de MHD (ahora los tenemos todos).
Se aplica sin IA producto a producto. La IA solo hace falta una vez por subfamilia, para proponer la tabla, y después
para los textos.

## 3. Los 21 filtros actuales frente a MHD

**Los filtros genéricos encajan bien.** En los productos que ya están en la tienda, MHD trae el dato para:

| Filtro | Productos que lo tienen hoy | De esos, con el dato en MHD |
| --- | --- | --- |
| Color | 1.041 | 1.006 |
| Ancho | 611 | 567 |
| Alto | 280 | 271 |
| Capacidad | 479 | 375 |
| Zonas / fuegos | 174 | 153 |
| Centrifugado | 63 | 63 |
| Tamaño de pantalla | 64 | 60 |
| Resolución | 33 | 33 |

- **«Tecnología»** también sale de MHD, pero con otros nombres según la familia: «No Frost» en frío, la propia
  subfamilia en placas, «Tipo de limpiador» en hornos. Se resuelve en la tabla de cada subfamilia.
- **Filtros débiles:**
  - **Serie:** MHD no la trae en ninguna subfamilia. Hoy son 53 productos con valores de PrestaShop («Efficient»,
    «Venu», «Philips Series 3.000»).
  - **Más especificaciones** no es débil: es el cajón de sastre pensado para los datos con cifra sin filtro propio
    (formato «Dato valor»). En cada colección solo salen los valores de sus productos, así que en lavavajillas enseña
    los tramos de ruido y en soportes, el VESA. Se mantiene (corrección del 2026-10-23, tras la pregunta de David).
  - **Autonomía:** MHD casi no la trae; solo unos 390 productos, de altavoces y depilación.

## 4. ¿Son pocos 21 filtros?

Menos de lo que parece. Un filtro de Search & Discovery solo aparece en una colección si sus productos tienen ese
dato. Así, un filtro genérico sirve para muchas familias con un significado distinto en cada una:

- **«Tipo»:** tipo de campana, de cafetera, de auricular o de soporte.
- **«Capacidad»:** kg en lavadoras, litros en frigoríficos, cubiertos en lavavajillas, tazas en cafeteras, GB en
  portátiles.
- **«Características»:** todas las funciones de sí o no de cada familia (No Frost, Integrable, Carga superior,
  Cancelación de ruido, Con vapor…).

En cada colección salen normalmente entre 6 y 10 filtros, que es lo cómodo para el cliente. El límite aprieta solo con
los conceptos que no caben en un filtro genérico. El nombre del filtro es el mismo en todas las colecciones, así que
tiene que ser genérico.

Lo que MHD trae mucho y hoy no tiene sitio:

| Concepto | Productos | Familias principales |
| --- | --- | --- |
| Nivel de ruido | 1.243 | frío, campanas, lavavajillas, aspiradores, lavadoras, altavoces, clima |
| Sistema operativo | 1.186 | portátiles y sobremesa, impresoras, televisores, móviles |
| Procesador | 873 | portátiles y sobremesa, tablets |
| Peso | 2.862 | soportes, portátiles, pequeño electrodoméstico (sirve poco como filtro) |

## 5. Propuesta

1. **Cambiar «Serie» por «Sistema operativo»** en Search & Discovery. El metacampo `serie` se queda para el
   comparador y el chatbot.
2. **«Nivel de ruido» va a «Más especificaciones»**, por tramos («Nivel sonoro de 44 dB a 50 dB»), como ya se hace
   en lavavajillas. Así lo tienen frío, campanas, lavadoras, aspiradores y clima sin gastar hueco. Solo merecería
   filtro propio si una misma colección necesitara a la vez el ruido y otros datos de «Más especificaciones».
3. **«Procesador»**, solo si la informática va a pesar en la tienda. Mientras tanto, va a «Más especificaciones».
   Si pesa, el hueco podría salir de «Autonomía» o de «Capacidad de secado».
4. **Tramos fijos por familia** para medidas, peso, ruido, potencia y caudal, respetando los formatos actuales. Las
   landings de SEO comparan el texto exacto (`55"`, `De 50" a 59"`, `8 kg`, `Nueva D`).
5. **«Características» como lista de funciones en positivo**, elegidas por subfamilia. WiFi, Bluetooth y NFC van a
   «Conectividad».
6. **Etiqueta energética:** manda «Nueva Clase Energética». La antigua «Clase energética» solo se usa si no hay otra.
7. **Siguiente paso:** rehacer la tabla de traducción de cada subfamilia desde los campos de MHD. Se empieza por
   lavado, frío, cocción, campanas y televisores. Se prueba con el banco de 41 productos y se comprueba que las landings
   siguen con productos.

## 6. Tablas de traducción rehechas (2026-10-23, noche)

David aprobó «Sistema operativo» en lugar de «Serie» y el ruido a «Más especificaciones». Se rehicieron desde MHD los
perfiles de lavado, frío, cocción, campanas y televisores. Están en la base local
(`mhd_importer_family_profiles`, borrador, modelo «claude-opus-5-5 (Claude Code, tablas desde MHD)»): G20, G40, G60,
H40, H50, I01, I10, I20, I60, I70, I75, I90 y 101. G01 y H01, revisadas por David, solo tienen propuesta (no
guardada; ver el área de trabajo de la sesión).

- **Herramienta:** `scripts/cobertura-perfil.mjs <familia> [perfil.json]`. Aplica el perfil a todos los productos con
  ficha, solo con MHD, y dice por filtro a cuántos llega y con qué valores, y qué campos de MHD no usa ninguna regla.
- **Comprobado en los 15 perfiles:**
  - ningún filtro pasa de 60 valores;
  - ninguno rellena `filtro.serie`;
  - `filtro.sistema_operativo` llega a los 122 televisores (webOS, VIDAA, Google TV, Tizen, Android TV, Sistema
    propio).
- **`filtro.sistema_operativo` creado en Shopify** (definición fijada, filtrable en el admin y condición de colección).
  **Cambiado en Search & Discovery el 2026-10-24** (a mano en el admin; la API no lo permite): eliminado el filtro
  «Serie» y añadido «Sistema operativo» al final de la lista. Aún no tiene valores: los tendrá cuando el importador
  rellene `filtro.sistema_operativo`. El metacampo `serie` sigue existiendo para el comparador y el chatbot.

**Cambios principales:**
- MHD primero donde mandaba Icecat (color, energía, caudal de campanas, ruido, Dolby Vision y Atmos).
- Muchas variantes de color de MHD recogidas.
- Medidas que MHD da en mm con «cm» leídas bien.
- Filtros nuevos:
  - `filtro.fondo` en frigoríficos y congeladores (99 %), con «Menos de 60 cm», «60 cm» y «Más de 60 cm»;
  - `filtro.potencia` en microondas y hornos de sobremesa;
  - en «Más especificaciones», «Capacidad de congelación», «Consumo de agua lavado y secado», «Zona grande» y
    «Gas butano o natural».
- En campanas, `filtro.potencia` es el caudal en m³/h (99 % desde MHD).
- En placas, el tipo (inducción, vitro, gas) va en `filtro.tipo` y el marco en `filtro.tecnologia`.

**Colecciones que se quedan sin productos o con muy pocos solo con MHD** (de las 79 que dependen de un valor exacto):
- «Frigoríficos americanos con dispensador de agua y hielo»: de 18 a 1, porque MHD no trae el hielo.
- «Frigoríficos con dispensador de agua»: de 10 a 5.
- «Vinotecas de menos de 10 botellas»: vacía; en MHD la más pequeña es de 20.
- «Lavavajillas negros»: vacía; los negros de MHD son integrables.
- «Microondas integrables de 30 cm de fondo»: unos 4; MHD los mide en 31-32 cm.
- «Televisores TCL de 40 pulgadas»: vacía, porque MHD no tiene ninguna.
- Fuera de estas familias, sin perfil rehecho todavía: termos de 50, 80 y 150 L, estufas de llama azul y grifos
  abatibles.

**Decisiones pendientes de David** (cada perfil las tiene también en `questions`):
1. **Valores nuevos:**
   - «Catálisis» en `filtro.limpieza` (9 hornos);
   - «Isla» en el tipo de campana (3);
   - «Carga superior» en características (lavadoras, 15);
   - «Nivel sonoro hasta 39 dB» (lavavajillas);
   - los datos nuevos de «Más especificaciones» citados arriba.
2. **Pirolítico + hidrolítico → «DualClean»** (20 hornos), o renombrarlo a algo genérico.
3. **«HomeOS U9» → VIDAA** (7 Hisense).
4. **Energía en lavasecadoras:** sale de «Clase energética secado», porque «Nueva Clase Energética» trae a veces la
   del lavado.
5. **Datos de MHD que no cuadran:**
   - Bosch SPS2HKI55E sale integrable y no lo es;
   - Corbero CSM320W y dos LG: secadoras con clase C en MHD y G o D en Icecat;
   - Haier HWS247GEH1: E en MHD, G en Icecat;
   - caudal de algunas campanas muy distinto del de Icecat (Bosch DWK91LT60: 1.007 frente a 441 m³/h);
   - «Campana integrada» de las placas no es fiable.

   Propuesta: MHD primero, revisar a mano en el piloto lo que difiera mucho de Icecat y avisar a MHD.
6. **Colecciones de la lista anterior:** quitarlas, cambiar su condición o rellenarlas a mano.
7. **Revisión de las propuestas de G01 y H01:**
   - G01: Carga superior y colores nuevos.
   - H01: tecnología No-Frost desde MHD (98 %), fondo nuevo y colores.
8. **Inverter:** si «EcoSilence» y «Direct Drive» cuentan como Inverter (G01 y G20).

Sin probar todavía: el banco de 41 productos (usa la IA para los textos) y el alta real en Shopify con estos perfiles.

## 7. Reglas generales para todas las familias (David, 2026-10-24)

1. **Si MHD e Icecat no cuadran, manda MHD.** Icecat solo entra si MHD no trae el dato o el valor es absurdo; para
   eso están los `min` y `max` de las reglas. A revisión a mano van:
   - cualquier diferencia en la **clase energética**;
   - las **cifras que difieran más de un 20 %**.

   Los colores con matiz («Acero inoxidable» frente a «Acero inoxidable y negro») y los redondeos (1400 frente a
   1350 rpm) no se revisan. En las muestras de las 15 familias rehechas difieren 45 de 165 productos, y solo unos
   8 de cada 100 irían a revisión. *Pendiente de código:* la cola de revisión de estas diferencias en el procesador.
2. **Los valores nuevos entran al aprobar el perfil de la familia.** No se aprueban uno a uno. Siempre salen de una
   lista cerrada de la tabla (filas o tramos) y con el formato de la tienda, nunca como texto libre de MHD. Las
   características van solo en positivo, y cada filtro tiene como mucho 100 valores. En las 15 familias rehechas son
   131 valores nuevos:
   - 56 en «Más especificaciones»;
   - 38 en «Características»;
   - 11 tramos de capacidad en frío;
   - 14 potencias, 6 sistemas operativos y 4 tecnologías de televisor.

   *Corrección decidida:* la potencia de hornillos y hornos de sobremesa (I90, I01) pasa a 3 o 4 tramos en lugar
   de cifras sueltas.
3. **Colecciones que se quedan vacías o casi: no se toca ninguna ahora.**
   - Se rescata el dato por texto donde se pueda; por ejemplo, el hielo de los frigoríficos americanos.
   - Se corrige el corte del fondo de los microondas integrables (MHD los mide en 31-32 cm). Cambiar la condición
     de la colección «Microondas integrables de 30 cm de fondo» en Shopify se pedirá aparte, cuando se haga.
   - Tras cada importación sale un **informe de colecciones con 0 o 1 producto**. Con él David decide cuáles se
     despublican; esas redirigen a su colección madre (`custom.categoria_padre`).

   *Pendiente de código:* ese informe.
4. **Nombres comerciales: término genérico en los filtros, el de la marca en el título y los textos.**
   - «EcoSilence» y «Direct Drive» cuentan como «Inverter».
   - «HomeOS» cuenta como «VIDAA».
   - Se respetan los valores que la tienda ya usa como filtro, aunque nacieran como nombre de marca («Aquálisis»,
     «DualClean»).
   - Se quedan tal cual los nombres por los que se busca y que no tienen equivalente genérico («Dolby Vision», «Dolby
     Atmos», «webOS», «Google TV», «Tizen»).
5. **Qué no se importa y qué va a revisión.**
   - **No se importan:**
     - maquetas («DUMMY», «MAQUETA»; 13);
     - unidades sueltas de aire acondicionado (unidad exterior o interior sola);
     - productos de salud sexual (2).
   - **Los reacondicionados sí se importan** (28), con «Reacondicionado» en el título. Los que no traen
     características se quedan sin filtros.
   - **Van a revisión:**
     - los productos sin precio o con precio 0;
     - los de precio de más de 5 veces, o de menos de la quinta parte, de la mediana de su subfamilia.

   *Pendiente de código:* las exclusiones y la revisión de precios en el procesador.
6. **Productos mal clasificados por MHD:** se nombran según la categoría de Icecat, no según la subfamilia de MHD, y
   van a la cola de revisión. Se recolocan con el árbol nuevo de colecciones.
7. **Compatibilidad en el título de los accesorios:** solo si los datos dan un único equipo o marca. Si es «Universal»
   o son varias marcas, va en la descripción.
8. **Datos actuales de la tienda que están mal** (series «QN90» falsas, termos con «Nueva C», «A/B» sin «Nueva», «1
   zonas»): los corrige el refresco con las tablas nuevas, sin tratarlos aparte.

## 8. Lavadoras y combis cerrados (2026-10-24)

G01 y H01 están guardados en la base local como **revisados**, con las reglas generales aplicadas.

- **G01 Lavadoras:**
  - Inverter desde «Tipo de motor», con EcoSilence y Direct Drive (93 %);
  - característica «Carga superior» (15);
  - color al 100 %;
  - «A-10%» pasa a «Nueva A»;
  - WiFi también por texto.
- **H01 Frigoríficos:**
  - tecnología No-Frost desde MHD (98 %);
  - fondo nuevo («Menos de 60 cm», «60 cm», «Más de 60 cm»);
  - colores nuevos;
  - hielo por texto;
  - **tipo de americano** en `filtro.tipo`, solo con lo que MHD dice claro: «Puerta francesa» (11), «4 puertas» (5) y
    «Side by side» (2). Los demás americanos se quedan sin tipo (decisión de David).

Copias de los perfiles anteriores en el área de trabajo de la sesión (`antes-revisado-G01.json`, `antes-revisado-H01.json`).
