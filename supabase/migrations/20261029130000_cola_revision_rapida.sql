-- Cola de revisión rápida (2026-10-29): contarla tardaba 30 s porque la vista abría el resultado completo de los 23.000
-- productos para mirar si tenían motivos de revisión. Ahora parte de un índice parcial con solo las pruebas con
-- motivos y se queda con las que son la última prueba buena de su producto. Mismas columnas y mismo resultado.
create index if not exists mhd_importer_product_runs_review
  on public.mhd_importer_product_runs (codigo, created_at desc)
  where status = 'ok' and jsonb_array_length(coalesce(result -> 'review_reasons', '[]'::jsonb)) > 0;

create or replace view public.mhd_importer_review_queue with (security_invoker = true) as
  with latest as (
    select r.id, r.codigo, r.family_code, r.created_at, r.result
      from mhd_importer_product_runs r
     where r.status = 'ok' and jsonb_array_length(coalesce(r.result -> 'review_reasons', '[]'::jsonb)) > 0
       and not exists (select 1 from mhd_importer_product_runs n where n.codigo = r.codigo and n.status = 'ok' and n.created_at > r.created_at))
  select l.codigo, l.family_code, f.family_name, l.id as run_id, l.created_at as run_at,
         l.result -> 'content' ->> 'title' as title, l.result ->> 'ean' as ean,
         l.result -> 'review_reasons' as reasons, md5((l.result -> 'review_reasons')::text) as reasons_hash,
         i.status as decision, i.note, i.reviewer, i.updated_at as decided_at,
         (i.codigo is null or i.reasons_hash <> md5((l.result -> 'review_reasons')::text)) as pending
    from latest l
    left join mhd_importer_family_profiles f on f.family_code = l.family_code
    left join mhd_importer_review_items i on i.codigo = l.codigo;
