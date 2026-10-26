# Base de redirecciones (2026-10-26)

Una fila por URL de la web vieja (tabla `store_redirects` en Supabase de producción), con su clave: a qué apunta. El destino final (`target`) se calcula después desde la clave, con el árbol nuevo de colecciones y las direcciones nuevas de los productos, para que **nunca haya cadenas**. Se ve en utils: **Tienda › Redirecciones**.

## Fuentes (por orden de autoridad)

1. Las redirecciones ya cargadas en Shopify (6.369 el 26-10): ahí está el trabajo de colecciones, productos, marcas y páginas. Se leen de la tienda, solo lectura.
2. El inventario de la web vieja: `data/redirecciones/redirecciones-todas.csv` (6.157 filas).
3. Search Console por API, 16 meses: `data/redirecciones/api-paginas-16-meses-2026-10-26.csv` (16.401 URLs con clics e impresiones). Las URLs que solo están aquí son las que hoy no tienen redirección.
4. El mapa del sitio de la web vieja (sin actividad desde hace meses), solo como comprobación.

Copias de `theme-enterprise-vicente/reference/redirecciones/` (ver `data/redirecciones/LEEME.md`). La carga (`src/lib/redirects/load.ts`, botón «Volver a cargar las fuentes» o `POST /api/redirecciones { action: "cargar" }`) se puede repetir: actualiza fuentes, clave y clics, y no toca destino, estado ni lo revisado.

## Clave

| Tipo | Cuándo | Valor |
| --- | --- | --- |
| `producto` | El destino actual es `/products/…` | id de Shopify (no cambia al pisar el producto) |
| `producto_viejo` | Ficha de PrestaShop sin redirección («/categoria/nombre-123.html») | id de PrestaShop; la categoría vieja va en la nota |
| `coleccion` | Destino `/collections/…` | handle actual |
| `categoria_vieja` | URL de un tramo sin redirección | tramo de la URL |
| `marca` | `/marca/…` o tipo «marca» del inventario | handle de la marca |
| `pagina`, `blog`, `otro` | Resto | ruta |

## Reglas de destino (David, 2026-10-26; se calculan cuando esté cerrado el árbol)

- **Producto:** a su ficha **solo si sigue vivo** en la tienda nueva; si no, a su categoría (la de la URL vieja, traducida con `theme-enterprise-vicente/docs/arbol-colecciones-equivalencias.csv`). Nada de producto sustituto.
- **Colección o categoría:** a su equivalente por esa tabla (handle actual → handle nuevo); si no hay, a la más próxima del árbol (familia › grupo › apartado).
- **Marca:** a su página de marca; si no existe, a `/pages/marcas`.
- **Nunca** a la portada por defecto ni en cadena.
- Las bajas de MHD (archivar + redirigir) añaden su fila con la misma lógica (`SINCRONIZACIONES_MHD.md`).

Estados: propuesta → revisada → cargada (en Shopify), o descartada.
