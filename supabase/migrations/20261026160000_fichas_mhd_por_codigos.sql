-- Fichas de MHD de una lista de códigos (2026-10-26). MHD no contesta a las fichas pedidas desde Vercel (HTTP 500;
-- desde Supabase y desde la oficina sí): el procesador las lee de mhd_catalog_product_details, que llena la función
-- mhd-catalog-import. Además de «details» (las que faltan) y «details_all» (todas), el tipo «details_codes» pide solo
-- las de una lista, p. ej. las de una tanda del importador, sin lanzar el catálogo entero. Ver
-- docs/IMPORTADOR_PRODUCTOS_MHD.md.

alter table public.mhd_catalog_import_runs add column codes text[];

alter table public.mhd_catalog_import_runs drop constraint if exists mhd_catalog_import_runs_kind_check;
alter table public.mhd_catalog_import_runs add constraint mhd_catalog_import_runs_kind_check
  check (kind in ('full', 'categories', 'brands', 'products', 'prices', 'stock', 'details', 'details_all', 'details_codes'));

-- Con lista de códigos: esos (aunque ya estén y no hayan cambiado), una vez por ejecución.
create or replace function public.mhd_import_detail_pending(p_run_id uuid)
returns table (codigo text) language sql stable security definer set search_path = public as $$
  select p.codigo
    from public.mhd_catalog_products p
    left join public.mhd_catalog_product_details d on d.codigo = p.codigo
    cross join (select kind, codes from public.mhd_catalog_import_runs where id = p_run_id) r
   where p.presence_status = 'present' and coalesce(p.cod_familia, '') not in ('S95', 'S93')
     and d.last_attempt_run_id is distinct from p_run_id
     and case when r.codes is not null then p.codigo = any(r.codes)
          else (d.codigo is null
                or (d.source_payload is null and not (d.last_error like '%(404)%' and d.fecha_modificacion_producto is not distinct from p.fecha_modificacion_producto))
                or d.fecha_modificacion_producto is distinct from p.fecha_modificacion_producto
                or r.kind = 'details_all') end
   order by p.codigo
$$;

-- Lanza la importación de las fichas de unos códigos (de MHD o EAN). Desde la web (con sesión) o desde el trabajador.
create or replace function public.mhd_import_start_codes(p_codes text[])
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_codes text[];
begin
  if (select auth.uid()) is null and coalesce(auth.role(), '') <> 'service_role' then raise exception 'Necesitas iniciar sesión'; end if;
  select array_agg(distinct p.codigo) into v_codes from public.mhd_catalog_products p where p.codigo = any(p_codes) or p.codigo_ean = any(p_codes);
  if v_codes is null then raise exception 'Ninguno de esos códigos está en el catálogo de MHD.'; end if;
  begin
    insert into public.mhd_catalog_import_runs (kind, entities, entity_progress, status, started_by, last_activity_at, codes)
    values ('details_codes', array['details'], jsonb_build_object('details', jsonb_build_object('estimated', cardinality(v_codes))), 'running', auth.uid(), now(), v_codes)
    returning id into v_id;
  exception when unique_violation then
    raise exception 'Ya hay una importación de MHD en curso o detenida: reanúdala o descártala antes de lanzar otra.';
  end;
  perform public.mhd_import_set_watchdog(true);
  perform public.mhd_import_kick(v_id);
  return v_id;
end; $$;

revoke all on function public.mhd_import_start_codes(text[]) from public, anon;
grant execute on function public.mhd_import_start_codes(text[]) to authenticated, service_role;
