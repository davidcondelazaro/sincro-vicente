-- Hasta 12 trabajadores a la vez (2026-10-26): medido con frigoríficos, cada trabajador va mejor con 4 productos que con 8
-- (con 8 se estorban y cada paso tarda más), así que para ir más rápido hacen falta más trabajadores, no más carga en cada uno.
insert into public.mhd_importer_worker_slots (slot) select generate_series(7, 12) on conflict (slot) do nothing;
