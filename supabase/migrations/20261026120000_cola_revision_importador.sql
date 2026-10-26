-- Cola de revisión a mano del importador de productos MHD (2026-10-26). Los motivos salen del procesador
-- (`result.review_reasons` de cada prueba en mhd_importer_product_runs: clase energética distinta, cifras que difieren,
-- precio raro, modelo o marca dudosos y las reglas `review` del perfil); aquí se guarda lo que decide quien revisa.
-- `reasons_hash` es la huella de los motivos revisados: si una prueba nueva trae otros motivos, vuelve a estar pendiente.
-- Ver docs/IMPORTADOR_PRODUCTOS_MHD.md.
create table public.mhd_importer_review_items (
  codigo text primary key,                       -- código de MHD
  status text not null check (status in ('resuelto', 'no_importar', 'avisar_mhd')),
  note text,
  reasons_hash text not null,
  run_id uuid references public.mhd_importer_product_runs (id) on delete set null,
  reviewer text,
  updated_at timestamptz not null default now()
);

alter table public.mhd_importer_review_items enable row level security;
create policy "Sesión: todo" on public.mhd_importer_review_items for all to authenticated using (true) with check (true);
grant select, insert, update, delete on table public.mhd_importer_review_items to authenticated, service_role;

-- La cola: la última prueba correcta de cada producto que trae motivos de revisión, con lo decidido. Pendiente si no hay
-- decisión o si la decisión se tomó sobre otros motivos.
create or replace view public.mhd_importer_review_queue with (security_invoker = true) as
with latest as (
  select distinct on (r.codigo) r.id, r.codigo, r.family_code, r.created_at, r.result
    from public.mhd_importer_product_runs r
   where r.status = 'ok'
   order by r.codigo, r.created_at desc
)
select l.codigo, l.family_code, f.family_name, l.id as run_id, l.created_at as run_at,
       l.result->'content'->>'title' as title, l.result->>'ean' as ean,
       l.result->'review_reasons' as reasons, md5((l.result->'review_reasons')::text) as reasons_hash,
       i.status as decision, i.note, i.reviewer, i.updated_at as decided_at,
       (i.codigo is null or i.reasons_hash <> md5((l.result->'review_reasons')::text)) as pending
  from latest l
  left join public.mhd_importer_family_profiles f on f.family_code = l.family_code
  left join public.mhd_importer_review_items i on i.codigo = l.codigo
 where jsonb_array_length(coalesce(l.result->'review_reasons', '[]'::jsonb)) > 0;
grant select on public.mhd_importer_review_queue to authenticated, service_role;
