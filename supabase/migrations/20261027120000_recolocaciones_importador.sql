-- Recolocaciones del importador de productos MHD (David, 2026-10-27). MHD tiene en una subfamilia equivocada unos 620
-- productos (disipadores en «Tarjeta gráfica», switches en «Accesorios informáticos», SSD en «Discos CD y Blu-ray»…).
-- Aquí se apunta la familia y subfamilia correctas de cada uno; el trabajador las usa en lugar de las de MHD (perfil de
-- la familia, filtros, título y colocación en el árbol nuevo). `source`: «datos» (la subfamilia en la que están casi
-- todos los productos con la misma categoría de Icecat), «ia» o «manual». Ver docs/IMPORTADOR_PRODUCTOS_MHD.md.
create table public.mhd_importer_subfamily_overrides (
  codigo text primary key,                       -- código de MHD
  cod_familia text not null,
  nombre_familia text,
  cod_subfamilia text not null,
  nombre_subfamilia text,
  mhd_cod_subfamilia text,                       -- la que tenía en MHD, para el informe
  source text not null check (source in ('datos', 'ia', 'manual')),
  note text,
  updated_at timestamptz not null default now()
);

alter table public.mhd_importer_subfamily_overrides enable row level security;
create policy "Sesión: todo" on public.mhd_importer_subfamily_overrides for all to authenticated using (true) with check (true);
grant select, insert, update, delete on table public.mhd_importer_subfamily_overrides to authenticated, service_role;
