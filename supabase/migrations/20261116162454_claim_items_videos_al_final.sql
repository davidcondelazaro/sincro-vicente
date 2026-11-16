-- Las tandas «solo vídeos» (2026-11-16) van detrás de las demás: con el tope de Shopify de 200 vídeos por hora duran
-- horas, y las altas automáticas no pueden esperar a que acaben.
CREATE OR REPLACE FUNCTION public.mhd_importer_claim_items(p_limit integer, p_lease_seconds integer)
 RETURNS SETOF mhd_importer_job_items
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  update public.mhd_importer_job_items i set status = 'error', error = coalesce(i.error, 'Se cortó tres veces sin terminar.'), finished_at = now(), lease_until = null
   where i.status = 'en_curso' and i.lease_until < now() and i.attempts >= 3;
  update public.mhd_importer_jobs j set status = 'en_curso', started_at = coalesce(j.started_at, now())
   where j.status = 'en_cola' and exists (select 1 from public.mhd_importer_job_items i where i.job_id = j.id and i.status = 'pendiente');
  return query
  update public.mhd_importer_job_items i set status = 'en_curso', attempts = i.attempts + 1, lease_until = now() + make_interval(secs => p_lease_seconds), started_at = now(), step = null
   where i.id in (
     select x.id from public.mhd_importer_job_items x join public.mhd_importer_jobs j on j.id = x.job_id
      where j.status in ('en_cola', 'en_curso') and (x.status = 'pendiente' or (x.status = 'en_curso' and x.lease_until < now()))
        -- Mientras se importan fichas de MHD, los que aún no tienen la suya esperan (Vercel no puede pedirla a MHD).
        and (not exists (select 1 from public.mhd_catalog_import_runs r where r.status = 'running' and 'details' = any(r.entities))
             or exists (select 1 from public.mhd_catalog_product_details d where d.codigo = x.codigo and (d.source_payload is not null or d.last_error is not null)))
      order by (coalesce(j.options->>'upload', '') = 'videos'), j.created_at, x.family_code nulls last, x.id
      limit p_limit for update of x skip locked)
  returning i.*;
end; $function$;
