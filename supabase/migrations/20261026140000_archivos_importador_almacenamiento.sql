-- Archivos de las pruebas del importador en el almacenamiento de Supabase (2026-10-26): cubo privado «importador»,
-- carpeta pruebas/<prueba>/. mhd_importer_media guarda la ruta (`storage_path`); `bytes` queda para las filas antiguas.
-- Ver src/lib/mhd-importer/media-store.ts.
alter table public.mhd_importer_media alter column bytes drop not null;
alter table public.mhd_importer_media add column storage_path text;
alter table public.mhd_importer_media add constraint mhd_importer_media_contenido check (bytes is not null or storage_path is not null);

insert into storage.buckets (id, name, public) values ('importador', 'importador', false) on conflict (id) do nothing;
create policy "Importador: sesión lee" on storage.objects for select to authenticated using (bucket_id = 'importador');
create policy "Importador: sesión escribe" on storage.objects for insert to authenticated with check (bucket_id = 'importador');
create policy "Importador: sesión actualiza" on storage.objects for update to authenticated using (bucket_id = 'importador');
