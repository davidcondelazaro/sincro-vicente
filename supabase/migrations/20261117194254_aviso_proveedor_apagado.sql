-- Aviso de cambios de proveedor apagado (David, 2026-11-17): los cambios siguen en el resumen diario; el freno avisa igual.
insert into store_settings (key, value, updated_by, updated_at) values ('supplier_changes_alert', 'false'::jsonb, 'David (vía Claude)', now())
on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = now();
