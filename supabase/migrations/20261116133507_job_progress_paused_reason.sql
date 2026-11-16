-- La pantalla de procesos pinta en rojo el motivo de la pausa (freno, tope de vídeos por hora de Shopify), pero la vista
-- no lo traía: se añade al final (2026-11-16).
create or replace view public.mhd_importer_job_progress with (security_invoker = true) as
 SELECT j.id,
    j.title,
    j.status,
    j.options,
    j.created_by,
    j.created_at,
    j.started_at,
    j.finished_at,
    count(i.id) AS total,
    count(i.id) FILTER (WHERE i.status = 'pendiente'::text) AS pendientes,
    count(i.id) FILTER (WHERE i.status = 'en_curso'::text) AS en_curso,
    count(i.id) FILTER (WHERE i.status = 'ok'::text) AS ok,
    count(i.id) FILTER (WHERE i.status = 'descartado'::text) AS descartados,
    count(i.id) FILTER (WHERE i.status = 'error'::text) AS errores,
    round(avg(i.duration_ms) FILTER (WHERE i.status = ANY (ARRAY['ok'::text, 'descartado'::text]))) AS duracion_media_ms,
    COALESCE(sum(i.cost_usd), 0::numeric) AS coste_usd,
    max(GREATEST(i.started_at, i.finished_at)) AS ultima_actividad,
    j.paused_reason
   FROM mhd_importer_jobs j
     LEFT JOIN mhd_importer_job_items i ON i.job_id = j.id
  GROUP BY j.id;
