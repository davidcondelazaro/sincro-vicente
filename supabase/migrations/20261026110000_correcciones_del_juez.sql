-- Correcciones de los perfiles hechas a partir del juicio (scripts/aplicar-juicio.mjs, 2026-10-26): cada corrección
-- se guarda en mhd_importer_judgements con purpose «correccion», con las operaciones aplicadas y el perfil anterior,
-- para poder ver qué cambió y deshacerlo.
alter table public.mhd_importer_judgements drop constraint if exists mhd_importer_judgements_purpose_check;
alter table public.mhd_importer_judgements add constraint mhd_importer_judgements_purpose_check check (purpose in ('juicio', 'calibracion', 'correccion'));
