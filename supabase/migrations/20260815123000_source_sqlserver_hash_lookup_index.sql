-- La normalización localiza el hash crudo por tabla, ID de negocio y lote de
-- carga. Este índice evita una exploración completa por cada fila normalizada.
create index if not exists source_sqlserver_rows_hash_lookup_idx
  on public.source_sqlserver_rows (source_table, loaded_at, ((payload ->> 'id')), row_number desc);
