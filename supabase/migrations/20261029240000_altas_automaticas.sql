-- Altas automáticas en la vuelta y tope del importador (David, 2026-10-29; docs/SINCRONIZACIONES_MHD.md › Altas).
insert into public.store_settings (key, value) values
  ('importer_max_workers', '3'),        -- ninguna tanda pasa de estos trabajadores (con la base Micro, 12 la tumbaron)
  ('importer_max_concurrency', '4'),    -- … ni de estos productos por trabajador
  ('auto_altas', 'true'),               -- la vuelta encola sola las altas
  ('auto_altas_max', '300')             -- freno: si en una vuelta salen más, no se encola nada y se avisa
on conflict (key) do nothing;

-- Altas de una lectura: vienen en el listado, no están en Shopify (ningún estado), su familia tiene reglas y su
-- subfamilia sitio en el árbol, no están bloqueadas ni ya en cola, y o bien nunca se han procesado («nuevo») o se
-- descartaron por no tener fotos y MHD les ha cambiado las fotos después («fotos nuevas»).
create or replace function public.mhd_new_products(p_run uuid)
returns table (codigo text, family_code text, motivo text)
language sql stable security definer set search_path = public as $$
  select c.codigo, c.cod_familia,
         case when last.status is null then 'nuevo' else 'fotos nuevas' end
  from mhd_catalog_products c
  left join lateral (select r.status, r.created_at, r.result ->> 'reason' reason from mhd_importer_product_runs r where r.codigo = c.codigo order by r.created_at desc limit 1) last on true
  where c.last_seen_run_id = p_run
    and not exists (select 1 from shopify_variants v where v.sku = c.codigo)
    and exists (select 1 from mhd_importer_family_profiles f where f.family_code = c.cod_familia)
    and exists (select 1 from store_mhd_subfamily_map m where m.mhd_subfamily_code = c.cod_subfamilia)
    and not exists (select 1 from store_product_locks l where l.codigo = c.codigo)
    and not exists (select 1 from mhd_importer_job_items i join mhd_importer_jobs j on j.id = i.job_id
                     where i.codigo = c.codigo and i.status in ('pendiente', 'en_curso') and j.status in ('en_cola', 'en_curso', 'pausado'))
    and (last.status is null
         or (last.status = 'discarded' and exists (select 1 from mhd_importer_job_items i where i.codigo = c.codigo and i.status = 'descartado' and i.error like 'Sin imagen%')
             and c.imagenes_cambiadas_en > last.created_at));
$$;
revoke execute on function public.mhd_new_products(uuid) from public, anon, authenticated;
grant execute on function public.mhd_new_products(uuid) to service_role;
