# Calibración de los jueces automáticos

_Generado por `scripts/calibrar-jueces.mjs` el 2026-10-26 (ejecución `9eceafc3-e40d-4acb-ab7a-a1775250b8ca`). Se puede repetir: los juicios quedan en `mhd_importer_judgements` con `purpose = 'calibracion'`._

## Cómo se mide

- Familias: G01 (Lavadoras), H01 (Frigoríficos, Neveras y Combis), las que David revisó a mano.
- Cada juez recibe el perfil **de antes** de la revisión, la cobertura de ese perfil en todo el catálogo de MHD de la familia, el vocabulario de filtros de la tienda y el reglamento **solo con las 6 reglas anteriores al 2026-10-24** (`regla:capacidad-lavado`, `regla:caracteristicas`, `regla:identidad-icecat`, `regla:marcas`, `regla:simplificar-filtros`, `regla:solo-mhd-icecat`). Las del 24-10 en adelante salieron en parte de esa misma revisión y darían la respuesta.
- Los cambios de David son el diff regla a regla entre el perfil de antes y el revisado (reglas añadidas, quitadas o con cambios en fuentes, tablas, tramos, método, formato, min, max o subfamilias). No cuentan los cambios solo en las notas ni en el orden, ni las dudas (`questions`).
- Una llamada barata (`claude-haiku-5-5`) empareja cada problema que señala un juez con los cambios de David a los que apunta (mismo problema y arreglo en la misma dirección).
- Jueces: **solo Claude** (`claude-opus-5-5`): no hay `OPENAI_API_KEY` en `.env.local`, así que es **un solo juez: sin consenso**. Las columnas de OpenAI y de «los dos» quedan pendientes.

## Resultado

| Familia | Cambios de David | Detectados por Claude | Propuestas de Claude (sin cambio que les corresponda) |
| --- | --- | --- | --- |
| G01 | 5 | 2 | 6 (4) |
| H01 | 15 | 5 | 10 (6) |
| **Total** | 20 | 7 | 16 (10) |

Coste de la calibración: 0.389 $.

### Pasadas del 2026-10-26 y conclusiones

_Sección escrita a mano: el script la sobrescribe si se vuelve a ejecutar._

| Pasada | Qué veía el juez | Detectados (de 20) | Propuestas (sin cambio de David) | Coste |
| --- | --- | --- | --- | --- |
| 1 | Cobertura como `cobertura-perfil.mjs`: valores que salen por filtro y campos de MHD sin usar | 2 (G01 0/5, H01 2/15) | 14 (12) | 0,393 $ |
| 2 | Además, `valores_sin_traducir`: por regla y fuente de MHD, los valores que llegan y no se traducen | 7 (G01 3/5, H01 4/15) | 18 (11) | 0,387 $ |
| 3 | Igual, contando también los valores que caen en un tramo vacío y sin duplicar fuentes que solo cambian de mayúsculas (la de esta página) | 7 (G01 2/5, H01 5/15) | 16 (10) | 0,389 $ |

- **Lo que más ayuda es enseñar al juez lo que no se traduce.** Sin esa lista no podía ver variantes de color, «A-10%», «Agua» en el dispensador o los tipos de display, que son la mitad de los arreglos de David.
- **Lo que sigue sin ver:**
  - las medidas de MHD en mm escritas como cm («1606cm», «540cm»), aunque ya aparecen en la lista;
  - los respaldos de texto nuevos (WiFi en lavadoras, No Frost en americanos);
  - el tipo de americano y los límites del ruido.

  Entre pasadas cambia lo que acierta (Carga superior en la 2, el fondo en mm en la 3): **el modelo no es determinista**. Por eso hacen falta los dos jueces y el consenso.
- **Inverter en lavadoras:** en las tres pasadas el juez propone quitar «Inverter» porque llega al 86 % de la familia y `regla:caracteristicas` dice «fuera las que tiene casi toda la familia». David hizo lo contrario: la amplió al 93 % con EcoSilence y Direct Drive (regla del 24-10, que el juez no veía). Conviene que el reglamento diga cuándo una característica muy común se queda, para que los jueces no la discutan en cada familia.
- **Propuestas sin cambio de David:** varias parecen problemas reales que siguen en los perfiles revisados y que alguien debería mirar:
  - H01, «Solo frigorífico» con «Capacidad congelador» < 1 en toda la familia (un «0» de MHD lo pondría en un combi);
  - H01, «mhd:Clase energética» como última fuente de la etiqueta (puede traer la escala antigua);
  - H01, filas de texto «ice maker» y «control electrónico» que pondrían características sin tenerlas.

  Aquí se cuentan como «falsos positivos», pero no lo son necesariamente.

## G01 · Lavadoras

### Cambios de David

| Id | Regla | Tipo | Qué cambió | Claude |
| --- | --- | --- | --- | --- |
| c1 | features.eficiencia_energ_tica | cambiada | table + «A-10%» → «Nueva A». Nota de David: MHD «Nueva Clase Energética» e Icecat (escala «De la A a la G») ya son la etiqueta actual. Ignorar lo que digan las descripciones (p. ej. Smeg «Clase E bajo la nueva normativa»). «A-10%» de MHD (un 10 % mejor que el límite de la A) → «Nueva A» (propuesta 2026-10-23). | sí |
| c2 | filtro.color | cambiada | table + «1» → «Integrable»; «Inox Antihuella» → «Acero inoxidable»; «Inox platinum» → «Acero inoxidable»; «Grafito Mate» → «Grafito». Nota de David: Primero se mira «Integrable»: si es «Sí» el color es «Integrable» (como en la colección Lavadoras Integrables); si es «No» no está en la tabla y se pasa a «Color». «Blanca» → «Blanco». Propuesta 2026-10-23: «1» = sí en «Integrable»; «Inox Antihuella»  | sí |
| c3 | filtro.conectividad (texto) | añadida | Regla nueva: contiene, fuentes texto:descripcion, tabla «home connect» → «WiFi»; «miele@home» → «WiFi»; «wifi» → «WiFi»; «wi-fi» → «WiFi»; «smartthinq» → «WiFi»; «thinq» → «WiFi»; «connectlife» → «WiFi»; «my aeg» → «WiFi»; «smartthings» → «WiFi». Nota de David: Propuesta 2026-10-23: respaldo de texto como en G20, G40 y G60 (el código descarta «WiFi: No» y «sin WiFi»). MHD «WiFi» solo da 17 lavador | no |
| c4 | filtro.caracteristicas · Inverter | cambiada | table + «ecosilence» → «Inverter»; «direct drive» → «Inverter». Nota de David: «Inverter», «Digital inverter» → Inverter. «Fiable», «Motor fiable», «Sin escobillas» → nada. Decide la primera fuente con dato. EcoSilence y Direct Drive cuentan como Inverter (regla general 4, David 2026-10-24). | no |
| c5 | filtro.caracteristicas · Carga superior | añadida | Regla nueva: tabla, fuentes mhd:Carga superior / icecat:Diseño/Tipo de carga, tabla «Sí» → «Carga superior»; «1» → «Carga superior»; «Carga superior» → «Carga superior»; «No» → «»; «0» → «»; «Carga frontal» → «». Nota de David: Propuesta 2026-10-23 (valor nuevo de característica): MHD «Carga superior» está en las 124 lavadoras (15 «Sí»). Es la misma distinción que ya da el tipo del título («Lavado | no |

### Propuestas de Claude (`claude-opus-5-5`, 0.155 $)

> El perfil está bien planteado: capacidad, centrifugado, clase energética y nivel sonoro cubren casi el 100 % con los formatos y tramos de la tienda. El fallo principal es «Inverter» como característica, porque lo tiene el 86 % de la familia y el reglamento lo excluye. También hay riesgo de falsos positivos en el respaldo de «Vapor» por texto, y faltan unas pocas filas en color y en clase energética.

| Id | Gravedad | Regla | Problema | Arreglo | Cambio de David |
| --- | --- | --- | --- | --- | --- |
| claude-1 | alta | #5 filtro.caracteristicas · Inverter | La característica «Inverter» llega al 86 % de la familia (107 de 124). El reglamento excluye las funciones que tiene casi toda la familia, porque no ayudan a elegir. | Quitar la regla 5 de filtro.caracteristicas. El motor Inverter puede seguir en la descripción corta y en los destacados, que ya lo recogen. | ninguno |
| claude-2 | media | #16 filtro.caracteristicas · Vapor (texto) | El respaldo de «Vapor» por texto lleva la característica al 50 % de la familia (62 productos), solo con descripciones. La fila genérica «vapor» casa con cualquier mención en textos comerciales de MHD (títulos con «/ Vapor», consejos, comparativas), así que hay riesgo de marcar lavadoras sin esa función. | Cambiar la fila genérica «vapor» por expresiones más concretas («funcion vapor», «programa vapor», «con vapor», «tratamiento vapor») y mantener «steam», «steamcare» e «ironassist». Revisar una muestra de los 62 antes de aplicarlo. | ninguno |
| claude-3 | media | #3 filtro.color | No se traducen tres valores de color de MHD: «Inox Antihuella» (3), «Grafito Mate» (1) e «Inox platinum» (1). Esos productos se quedan sin color aunque hay valores claros en la tienda. | Añadir a la tabla: «Inox Antihuella» → «Acero inoxidable» y «Grafito Mate» → «Grafito». «Inox platinum» → «Acero inoxidable» solo si el dueño lo acepta; si no, se deja vacío. | c2 |
| claude-4 | baja | #0 features.eficiencia_energ_tica | El valor de MHD «A-10%» (1 producto) no está en la tabla y ese producto se queda sin clase energética. Además, el título saldría con «clase » vacío o con «A-10%». | Añadir la fila «A-10%» → «Nueva A» y usar en el título solo la letra («clase A»). | c1 |
| claude-5 | baja | #6 filtro.caracteristicas · Fondo reducido | Con «CONFLICTO_MAPEADO» en la profundidad de MHD (3 productos) se pasa a Icecat, que da la medida en mm. Como en mm nunca baja de 50, esos productos no se pueden marcar como de fondo reducido aunque lo sean. | Añadir otra regla para «Fondo reducido» con fuente «icecat:Peso y dimensiones/Profundidad», en mm, con min 300 y max 900, y el tramo «Fondo reducido» hasta 500.1. | ninguno |
| claude-6 | baja | (general o regla que falta) | La plantilla del título fija «clase {Letra}» aunque falte la clase energética (1 producto sin ella), y daría un título terminado en «clase». Además, el ejemplo de meta título del integrable no sigue la plantilla (no lleva «de», «y» ni «– Clase»). | Si no hay clase energética, omitir «clase {Letra}» en el título y «– Clase {Letra}» en el meta título. Corregir el ejemplo: «Lavadora integrable Daewoo WMI712T1WU0ES de 7 kg y 1200 rpm – Clase D». | ninguno |

## H01 · Frigoríficos, Neveras y Combis

### Cambios de David

| Id | Regla | Tipo | Qué cambió | Claude |
| --- | --- | --- | --- | --- |
| c1 | filtro.alto | cambiada | ranges − [300, …) → «» · min: «» → «30» · max: «» → «299». Nota de David: MHD en cm («203cm», «81,8cm»). Fuera de 30-299 se pasa a la regla siguiente («5cm» del ancho partido de Midea, «540cm», «1606cm»). | no |
| c2 | filtro.alto #2 | cambiada | sources + mhd:Altura · min: «» → «300» · max: «» → «3000». Nota de David: MHD sin coma o en mm («540cm» = 54 cm, «1606cm» = 160,6 cm): de 300 en adelante se lee como mm. Después, Icecat (mm). | no |
| c3 | filtro.ancho | cambiada | ranges − [300, …) → «» · min: «» → «30» · max: «» → «299». Nota de David: MHD en cm («203cm», «81,8cm»). Fuera de 30-299 se pasa a la regla siguiente («5cm» del ancho partido de Midea, «540cm», «1606cm»). | no |
| c4 | filtro.ancho #2 | cambiada | sources + mhd:Ancho · min: «» → «300» · max: «» → «3000». Nota de David: MHD sin coma o en mm («540cm» = 54 cm, «1606cm» = 160,6 cm): de 300 en adelante se lee como mm. Después, Icecat (mm). | no |
| c5 | filtro.fondo | añadida | Regla nueva: tramos, fuentes mhd:Profundidad, tramos […, 58) → «Menos de 60 cm»; [58, 61) → «60 cm»; [61, …) → «Más de 60 cm», min 30 max 299. Nota de David: Fondo (MHD 99 %), con los valores que ya usa la tienda: «Menos de 60 cm», «60 cm» (58-60,9 cm) y «Más de 60 cm». Dice si cabe en el hueco de 60 cm de la cocina. Los «8cm» y «3cm» de algunos americanos (dato partido) se ignoran. | sí |
| c6 | filtro.fondo #2 | añadida | Regla nueva: tramos, fuentes mhd:Profundidad / icecat:Peso y dimensiones/Profundidad, tramos […, 580) → «Menos de 60 cm»; [580, 610) → «60 cm»; [610, …) → «Más de 60 cm», min 300 max 3000. Nota de David: MHD en mm (de 300 en adelante) y respaldo de Icecat (mm). | sí |
| c7 | filtro.color | cambiada | table + «0» → «»; «Dark Inox» → «Acero inoxidable oscuro»; «Acero Inox Oscuro» → «Acero inoxidable oscuro»; «Pearl Inox» → «Acero inoxidable»; «Inox Brillante» → «Acero inoxidable»; «Look Inox» → «Acero inoxidable»; «Inox Antihuella» → «Acero inoxidable»; «Inox antihuellas» → «Acero inoxidable»; «Acero Inox Antihuellas» → «Acero inoxidable»; «Acero Texturizado Antihuellas» → «Acero inoxidable»; «P | sí |
| c8 | filtro.tecnologia | cambiada | table + «0» → «Cíclico». Nota de David: MHD: «No Frost» (combis y 1 puerta; «No frost» en 2 puertas, el código no distingue mayúsculas) y, si no, «No Frost (frigo)». Sí/Si → No-Frost; No/0 → Cíclico (decisión 7). «Semi No Frost» no está en la tabla y pasa a «No Frost (frigo)». Los americanos no traen el campo: van al respaldo de texto. | no |
| c9 | filtro.tecnologia (texto) | añadida | Regla nueva: contiene, fuentes texto:descripcion, tabla «no frost» → «No-Frost»; «nofrost» → «No-Frost»; «no-frost» → «No-Frost»; «frost free» → «No-Frost»; «ciclico» → «Cíclico»; «cycle defrost» → «Cíclico»; «estatico» → «Cíclico». Nota de David: Respaldo de texto, sobre todo para los americanos (MHD no trae el campo, pero todos lo dicen: «NO FROST», «NOFROST», «Total No Frost»). No Frost va prim | no |
| c10 | filtro.caracteristicas · Dispensador de agua | cambiada | table + «Agua» → «Dispensador de agua». Nota de David: MHD «Dispensador agua» (96 % de los americanos): «Sí» y «Agua» = sí. «Colocación del dispensador» no vale: dice «Frontal» en modelos sin dispensador (Hyundai HAM17791). | sí |
| c11 | filtro.caracteristicas · Dispensador de agua y hielo (texto) | cambiada | table + «agua fresca e hielo» → «Dispensador de agua y hielo». Nota de David: MHD no trae el hielo en ningún campo: solo texto (LG GSLV70PZTD: «agua fresca e hielo al instante») e Icecat «Dispensador cubitos» en la regla de hielo. | no |
| c12 | filtro.caracteristicas · Display digital | cambiada | table + «Display interior» → «Display digital»; «Display en puerta» → «Display digital»; «LCD» → «Display digital»; «Display» → «Display digital»; «Display LED» → «Display digital»; «Display táctil» → «Display digital»; «Display LED táctil» → «Display digital»; «Sin LCD» → «»; «0» → «». Nota de David: MHD «Pantalla» (98 % en combis) trae «Sí» o el tipo de display («Display interior», «LCD», «Displ | sí |
| c13 | filtro.caracteristicas · Display digital (texto) | cambiada | table + «display puerta» → «Display digital»; «display interior» → «Display digital». Nota de David: Respaldo de texto (incluye el resumen de Icecat). | no |
| c14 | filtro.mas_especificaciones · Nivel sonoro | cambiada | min: «» → «20» · max: «» → «80». Nota de David: MHD «Nivel de ruido» (98 %): «35db», «39dB». Límites 20-80 dB para cortar errores. Tramos de la tienda; «hasta 39 dB» es nuevo porque casi todos los frigoríficos están por debajo de 40. | no |
| c15 | filtro.tipo | añadida | Regla nueva: tabla, fuentes mhd:Diseño de producto, tabla «Americano puerta Francesa» → «Puerta francesa»; «Americano 4 puertas» → «4 puertas»; «Side-by-Side» → «Side by side»; «Americano Side by Side» → «Side by side», subfamilias H0110. Nota de David: Decidido por David (2026-10-24): solo los valores claros; «Americano», «American door», «Multi door»… quedan sin tipo. | no |

### Propuestas de Claude (`claude-opus-5-5`, 0.231 $)

> El perfil está bien armado: capacidad, clase energética, alto, ancho y nivel sonoro llegan casi al 100 % con valores que la tienda ya usa. Los riesgos graves son dos: «Solo frigorífico» aplicado a toda la familia con los «0» de MHD, y la fuente de clase energética antigua traducida como escala nueva. Conviene además blindar el integrable frente a Icecat, completar las tablas de Pantalla y Color y añadir el filtro de fondo.

| Id | Gravedad | Regla | Problema | Arreglo | Cambio de David |
| --- | --- | --- | --- | --- | --- |
| claude-1 | alta | #20 filtro.caracteristicas · Solo frigorífico | «Solo frigorífico» se pone en toda la familia cuando la capacidad del congelador es menor de 1 L. MHD usa «0» como dato vacío en algunas marcas, como el «0» de No Frost en Midea. Un combi, un 2 puertas o un americano con ese «0» quedaría marcado por error como «Solo frigorífico». | Limitar «subfamilies» a H0120 (Frigoríficos 1 Puerta). Aplicar la misma limitación a la regla de texto 21. | ninguno |
| claude-2 | alta | #1 features.eficiencia_energ_tica | La última fuente, «mhd:Clase energética», puede traer la escala antigua. Su «A», «B», «C»… se traduciría a «Nueva A», «Nueva B»…, una clase energética que no toca. La cobertura ya llega al 100 % sin esa fuente. | Quitar «mhd:Clase energética» de las fuentes del índice 1. | ninguno |
| claude-3 | media | #6 filtro.color | Integrable: si MHD dice «No» en Integrable o Integrado (229 y 23 productos), el valor no está en la tabla y se pasa a «icecat:Diseño/Tipo de instalación». Si Icecat dice «Integrado» o «Empotrado» contra MHD, el producto saldría «Integrable». Contradice que manda MHD y pondría un valor grave. | Leer Icecat «Tipo de instalación» solo si MHD no trae Integrable ni Integrado. Si el método no lo permite, quitar esa fuente del filtro de color y dejar el integrable solo con MHD. | ninguno |
| claude-4 | media | #13 filtro.caracteristicas · Dispensador de agua y hielo (texto) | La fila «agua y hielo» es demasiado genérica y puede saltar en textos que no hablan de un dispensador. Además, el texto «dispensador de agua y hielo» también contiene «dispensador de agua», así que la regla 10 añade a la vez «Dispensador de agua». | Quitar las filas «agua y hielo» y «water and ice» del índice 13 y dejar solo las frases completas con «dispensador». | ninguno |
| claude-5 | media | #14 filtro.caracteristicas · Display digital | Hay 22 productos con valores de «mhd:Pantalla» sin traducir que indican display: «Display interior» (5), «Display en puerta» (3), «LCD» (2), «DISPLAY» (2), «Display LED», «Display táctil», «display», «Display LED táctil». | Añadir filas a «Display digital» para Display interior, Display en puerta, LCD, Display, Display LED, Display táctil y Display LED táctil. Añadir «Sin LCD» con valor vacío y dejar «Visor» sin traducir. | c12 |
| claude-6 | media | (general o regla que falta) | «mhd:profundidad» llega al 99 % de la familia y no se usa. El fondo es un dato clave para el encaje en el hueco, y la tienda ya tiene el filtro «filtro.fondo» con «Menos de 60 cm» y «Más de 60 cm». | Crear una regla de tramos para filtro.fondo con fuente «mhd:profundidad»: menos de 60 → «Menos de 60 cm»; de 60 a 300 → «Más de 60 cm»; 300 o más → vacío. Añadir un respaldo «icecat:Peso y dimensiones/Profundidad» en mm con los cortes 600 y 3000. | c5, c6 |
| claude-7 | baja | #6 filtro.color | Hay variantes de color de MHD sin traducir que corresponden a valores que la tienda ya usa: «Look Inox» (2), «Inox Antihuella», «Inox Brillante», «Pearl Inox», «Acero Texturizado Antihuellas», «Cristal negro» (3) y «Cristal blanco». | Añadir estas filas: Look Inox, Inox Antihuella, Inox Brillante, Pearl Inox y Acero Texturizado Antihuellas → «Acero inoxidable»; Cristal negro → «Negro»; Cristal blanco → «Blanco». «Dark Inox» y «Gris / plata» se dejan sin traducir por ambiguos. | c7 |
| claude-8 | baja | #21 filtro.caracteristicas · Solo frigorífico (texto) | El método «contiene» ignora las frases en negativo del tipo «sin X». Por eso las filas «sin congelador», «sin compartimento congelador» y «sin compartimento de congelación» pueden no casar nunca. | Comprobar cómo trata el código esas filas. Si las ignora, dejar solo «0 l de congelador» y «eliminando el espacio del congelador» y confiar en la regla estructurada 20. | ninguno |
| claude-9 | baja | #9 filtro.caracteristicas · Dispensador de agua | El valor «Agua» de «mhd:Dispensador agua» (1 producto) no se traduce. | Añadir la fila «Agua» → «Dispensador de agua». | c10 |
| claude-10 | baja | (general o regla que falta) | La plantilla del meta título pone «No Frost» antes de la capacidad y la del título después. Es un orden incoherente entre los dos. | Unificar el orden y usar el del título: tipo, marca, modelo, capacidad, No Frost y clase. | ninguno |

## Cómo leerlo

- «Detectados» mide la sensibilidad: de lo que David corrigió, cuánto habría visto el juez solo con el reglamento antiguo y los datos.
- Una propuesta «sin cambio que le corresponda» no es necesariamente un error del juez: puede ser algo que David no tocó y que sigue pendiente, o una mejora discutible. Las de gravedad alta merecen una mirada.
- Con dos familias y una sola pasada las cifras son orientativas; el modelo no es determinista.

Repetir:

```bash
node scripts/calibrar-jueces.mjs --antes <carpeta con antes-revisado-G01.json y antes-revisado-H01.json> G01,H01
```
