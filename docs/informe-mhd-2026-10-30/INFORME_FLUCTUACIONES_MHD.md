# Productos que desaparecen y vuelven al listado de MHD

**Para:** equipo técnico y comercial de MHD (mihogardigital.es)
**De:** Electrónica Vicente
**Fecha:** 30 de octubre de 2026

## Alcance y forma de leer el informe

- **Origen de los datos:** su API.
  - El listado `/products`, que leemos completo cada 30 minutos desde el 29-10-2026 a las 12:39.
  - La ficha `/products/:codigo`, que consultamos para cada producto que deja de aparecer en el listado.
- **Periodo:** del 29-10-2026 a las 12:39 al 30-10-2026 a las 07:30, 37 lecturas completas del listado.
- **Horas:** hora peninsular española.
- **Cómo se identifica cada producto:** código MHD (`codigo`) y EAN (`codigo_ean`).
- **«Stock en la última lectura»:** el campo `stock` que traía el producto en la última lectura del listado en la que apareció.
- **Anexos:** CSV separados por comas, en UTF-8, en la misma carpeta que este informe.

**Qué hacemos nosotros cuando un producto deja de aparecer:** consultamos su ficha. Si la API responde «no existe» (404), lo dejamos sin stock en nuestra tienda hasta que vuelva. Por eso, cada producto que desaparece con stock real es una venta que perdemos mientras está fuera.

---

## 1. Resumen

| # | Incidencia | Productos afectados | Impacto | Prioridad |
|---|---|---|---|---|
| 1 | **Caída masiva del 30-10 entre las 06:00 y las 07:30.** El listado pasa de 31.641 a 30.269 productos. Desaparece casi toda la gama blanca y el pequeño electrodoméstico de varias marcas. | 1.454 productos, 1.336 de ellos con stock (18.508 unidades). Marcas enteras: Edesa, Corbero, Nova, Flama y Candy. | Casi un tercio de nuestra gama blanca se queda sin poder venderse. | Muy alta |
| 2 | **Productos con stock que salen y entran del listado a diario.** Algunos, varias veces en una misma noche. | En una noche normal, 197 salidas de productos que vendemos. 195 tenían stock en la lectura anterior. El caso extremo: 9 salidas en 15 horas, con 111 unidades. | El producto aparece y desaparece de la venta sin motivo aparente. | Alta |
| 3 | **El listado y la ficha no coinciden.** Productos que faltan en el listado siguen teniendo ficha, y la pierden más tarde. | 603 productos a las 06:30 del 30-10. Hasta 5 en una lectura normal. | No sabemos si un producto se ha dado de baja o si solo falta en una lectura. | Media |
| 4 | **Límite de peticiones (HTTP 429)** al comprobar las fichas de muchos productos seguidos. | 893 consultas rechazadas entre las 06:30 y las 07:30 del 30-10. | Productos sin poder comprobar. | Media |

**Lo que les pedimos:**

1. **Que nos expliquen la caída del 30-10** y si los productos van a volver.
2. **Que no saquen del listado los productos con stock.** Si un producto deja de estar disponible por un tiempo, que siga en el listado con `stock` a 0.
3. **Que nos digan por qué sale un producto:** un campo de estado o motivo en el listado, o una llamada de bajas con fecha y motivo.
4. **Que nos indiquen los límites de la API**, o una llamada para comprobar varios códigos a la vez.

---

## 2. Caída masiva del 30-10-2026 (anexos 01 y 03)

**Qué vimos:**

| Lectura | Productos en el listado |
|---|---|
| 06:00 | 31.641 |
| 06:30 | 30.266 |
| 07:00 | 30.303 |
| 07:30 | 30.269 |

En toda la noche anterior el listado se había movido entre 31.604 y 31.646 productos.

- **Productos desaparecidos:** 1.454 productos que estaban en el listado esa mañana no aparecen en la lectura de las 07:30.
  - Se fueron en tres tandas: 806 a las 06:30, 593 a las 07:00 y 55 a las 07:30.
- **No es falta de stock:** 1.336 de los 1.454 tenían stock en su última lectura, 18.508 unidades en total.
- **Su ficha también desaparece:** a las 07:00, 698 de los productos consultados respondían «no existe» (404).
- **Por línea**, desaparece entre el 16 % y el 31 % de cada línea de electrodoméstico. En el resto de líneas, lo habitual (≤ 4 %):

| Línea | Desaparecidos | Productos antes | % | Unidades de stock |
|---|---|---|---|---|
| Cocción | 337 | 1.091 | 30,9 % | 2.738 |
| Frío y Congelación | 115 | 389 | 29,6 % | 2.320 |
| Lavado y Secado | 97 | 346 | 28,0 % | 1.105 |
| Productos para el Hogar | 373 | 1.646 | 22,7 % | 3.294 |
| Climatización, Calefacción y Agua Sanitaria | 98 | 447 | 21,9 % | 1.990 |
| Belleza, salud y cuidado personal | 117 | 643 | 18,2 % | 1.446 |
| Electrodomésticos de Limpieza | 58 | 361 | 16,1 % | 360 |
| Accesorios, consumibles, Garantías y Servicios | 158 | 18.637 | 0,8 % | 2.639 |
| Informática | 46 | 5.023 | 0,9 % | 1.864 |

- **Por marca:**
  - **Desaparecen enteras:** Edesa (46 productos), Corbero (43), Nova (37), Flama (25) y Candy (14), además de otras más pequeñas.
  - **Casi enteras:** Haier (86 %), Ariete (78 %), Elbe (76 %), Electrolux (68 %), Bra (59 %), Beurer (58 %) y AEG (54 %).
  - **En cantidad:** Bra (109), Orbegozo (92), Teka (82), Jata (67) y Balay (59).
  - El detalle de las 112 marcas está en el anexo 03.

**Lo que parece:** por el volumen, la hora y las marcas, una caída o recarga del catálogo de uno o varios de sus proveedores, no bajas reales. A las 07:30 solo habían vuelto unos pocos.

**Preguntas:**

1. ¿Qué pasó entre las 06:00 y las 07:30 del 30-10? ¿Corresponde a algún proveedor concreto?
2. ¿Van a volver estos productos? ¿Cuándo?
3. ¿Puede repetirse? Si es una recarga que hacen a diario, ¿a qué hora y cuánto dura?

---

## 3. Productos con stock que salen y entran del listado (anexo 02)

Nos indicaron que retiran del listado los productos sin stock y los vuelven a poner cuando lo recuperan. En la práctica, también salen productos con stock, y muchos vuelven al poco tiempo.

**Una noche normal, del 29-10 a las 16:00 al 30-10 a las 06:00:**

- **197 salidas** de productos que tenemos a la venta.
- **195 tenían stock** en la lectura anterior.
- **130 no habían vuelto** a las 07:30 del 30-10. Los 67 que sí volvieron tardaron una mediana de unas 2 horas.

**Productos que salen y entran varias veces:**

| Código | Marca | Stock | Salidas en 15 horas |
|---|---|---|---|
| 10116627 | Mercusys | 111 | 9 |
| 10116624 | Mercusys | 202 | 6 |
| 10062842 | Conceptronic | 14 | 6 |
| 10071564 | TP-Link | 26–35 | 6 |
| 10006177 | HP | 1–3 | 4 |
| 10008407 | TP-Link | 4–5 | 4 |

Por ejemplo, el 10116627 sale a las 16:02, 17:02, 18:02, 19:02, 20:02, 21:02, 00:02, 02:03 y 04:02, y vuelve entre 30 minutos y 3,5 horas después cada vez, siempre con las mismas 111 unidades.

**Preguntas:**

1. ¿Por qué sale del listado un producto que tiene stock?
2. ¿Pueden dejarlo en el listado con `stock` a 0 mientras no esté disponible, en vez de quitarlo?
3. Si tiene que salir, ¿pueden indicarnos el motivo (sin stock, baja del proveedor, baja definitiva…)?

---

## 4. El listado y la ficha no coinciden

- **A las 06:30 del 30-10:**
  - 603 productos que faltaban en el listado seguían teniendo ficha (`/products/:codigo` los devolvía);
  - media hora después, 698 de los productos que consultamos ya respondían «no existe».
- **En una lectura normal**, hasta 5 productos faltan en el listado pero siguen teniendo ficha.

**Pregunta:** ¿el listado y la ficha se actualizan a la vez? ¿Puede una lectura completa del listado, página a página, saltarse productos si el catálogo cambia mientras se lee? Si es así, ¿hay una forma de leerlo estable (orden fijo o cursor)?

---

## 5. Límite de peticiones (HTTP 429)

- **Qué pasó:** al comprobar la ficha de unos mil productos seguidos a las 06:30, 07:00 y 07:30 del 30-10, la API rechazó 893 consultas con «HTTP 429».
- **Por nuestra parte:** vamos a espaciar las consultas.

**Preguntas:**

1. ¿Qué límite tiene la API: peticiones por segundo, por minuto, por día?
2. ¿Hay una llamada para consultar varios códigos a la vez, o una de productos dados de baja desde una fecha?

---

## Anexos

| Anexo | Contenido | Filas |
|---|---|---|
| `anexo_01_desaparecidos_30-10.csv` | Productos de la caída del 30-10: código, EAN, marca, línea, familia, stock en la última lectura y hora de la última lectura en la que aparecieron. | 1.454 |
| `anexo_02_desapariciones_29-30.csv` | Cada salida del listado de un producto que tenemos a la venta, del 29-10 a las 16:00 al 30-10 a las 06:00. Incluye código, EAN, marca, familia, stock en la última lectura, hora de salida, hora de vuelta (si volvió) y horas fuera. Un mismo producto aparece una vez por cada salida. | 197 |
| `anexo_03_resumen_marca_y_linea_30-10.csv` | Caída del 30-10 agrupada por marca y por línea: productos antes, desaparecidos, porcentaje y unidades de stock. | 126 |
