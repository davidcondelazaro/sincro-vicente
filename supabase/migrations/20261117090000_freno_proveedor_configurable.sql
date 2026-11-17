-- Freno del paso «proveedor» editable desde Configuración (David, 2026-11-17; docs/SINCRONIZACIONES_MHD.md › Proveedor).
-- El 17-11 frenó 715 cambios reales con el máximo de 300: se sube a 2.000.
insert into public.store_settings (key, value) values ('supplier_switch_max', '2000')
on conflict (key) do nothing; -- aplicado a mano en producción el 17-11 (2.000)

-- Aviso de cambios fuertes de portes (ya aplicados): apagado, se enciende en Configuración.
insert into public.store_settings (key, value) values ('delivery_changes_alert', 'false')
on conflict (key) do nothing;
