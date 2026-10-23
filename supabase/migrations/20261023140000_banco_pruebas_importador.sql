-- Banco de prueba del importador de productos MHD (decidido 2026-10-23): un conjunto fijo de productos de varias
-- familias que se vuelve a generar cada vez que cambian las reglas de redacción, y las revisiones de cada ficha (las
-- automáticas y las de David o Rubén). Sirve para medir cuántos errores quedan antes de pasar al masivo.
-- Ver docs/IMPORTADOR_PRODUCTOS_MHD.md.
create table public.mhd_importer_bench_items (
  codigo text primary key,                       -- código de MHD
  family_code text not null,
  reason text,                                   -- por qué está en el banco (p. ej. «sin Icecat», «Icecat de otro modelo»)
  added_at timestamptz not null default now()
);

create table public.mhd_importer_reviews (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.mhd_importer_product_runs (id) on delete cascade,
  reviewer text not null,                        -- correo de quien revisa
  verdict text not null check (verdict in ('bien', 'mal')),
  note text,                                     -- qué está mal y dónde
  created_at timestamptz not null default now()
);
create index mhd_importer_reviews_run_idx on public.mhd_importer_reviews (run_id);

alter table public.mhd_importer_bench_items enable row level security;
alter table public.mhd_importer_reviews enable row level security;
create policy "Sesión: todo" on public.mhd_importer_bench_items for all to authenticated using (true) with check (true);
create policy "Sesión: todo" on public.mhd_importer_reviews for all to authenticated using (true) with check (true);
grant select, insert, update, delete on table public.mhd_importer_bench_items, public.mhd_importer_reviews to authenticated, service_role;
