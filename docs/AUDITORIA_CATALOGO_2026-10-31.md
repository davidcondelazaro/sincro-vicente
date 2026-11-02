# Auditoría de catálogo: pendiente de revisar (31-10-2026)

Salió de comparar la documentación con el código. Lo de pedidos se trató aparte, en
[PEDIDOS_MHD_FASE_1.md](PEDIDOS_MHD_FASE_1.md). Estos casos no se han debatido: el
catálogo se lleva en otro chat. Salvo el 6, vienen de leer el código, sin datos reales.

6. **Altas que no llegan a la tienda.** Si falla la subida, el producto queda «ok», sin
   aviso ni reintento. El 31-10 había 41 productos activos en MHD fuera de la tienda.
   La mayoría, frenados por el revisor de datos tras los 3 intentos de redacción;
   unos pocos, fallos técnicos. Propuesta: estado propio, aviso, un reintento para los
   técnicos y los del revisor a la cola de revisión. Ver `jobs.ts`.
7. **Agotados cortados a medias.** Primero se escribe en Shopify y luego se guarda. Un
   corte podría perder «vender sin stock» o dejar un producto a 0 con stock en MHD.
   Mecanismo visto; no consta que haya pasado. Ver `absences.ts`.
8. **Archivados que MHD vuelve a traer.** La documentación dice que se reactivan y
   conservan su URL; nadie los encola y pueden cambiar de URL.
9. **«Está bien» en revisión.** Quita la etiqueta pero no publica el borrador. Falta
   confirmar si es lo que se quería.
10. **Stock en altas.** La subida prioriza `mhd_catalog_stock`, que ya no se actualiza.
    Se corrige solo en la vuelta siguiente.
11. **Avisos de ficha.** «Foto pequeña» y «Cifras» salieron de revisión para verse en el
    resumen, y el resumen no los lee.
12. **Marcas y promociones.** No hay aviso de marcas nuevas sin página, ni tarea de
    caducidad de promociones.

Pendientes declarados con riesgo real: reutilización de códigos por MHD, clase energética
desactualizada y productos con el mismo EAN y otro SKU.

## Cambios en el importador hechos desde el chat de pedidos, sin confirmar en git

- `delivery-options-sync.ts`: paso «opciones-entrega» de la vuelta. Necesita la migración
  `20261031100000_opciones_entrega.sql` antes de desplegar.
- `service-tariffs.ts`: paso «tarifas-servicios» de la vuelta.
- `sync-cycle.ts` y `price-stock-sync.ts`: enganche de esos pasos y `latestRead` exportada.
