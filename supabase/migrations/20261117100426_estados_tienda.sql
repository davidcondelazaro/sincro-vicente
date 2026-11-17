-- Estados de la tienda cada noche (David, 2026-11-17; src/lib/mhd-importer/store-status-sync.ts). Con los productos que
-- Shopify tiene en borrador y archivados, el resto de store_shopify_ids pasa a activo. Devuelve los cambios por tipo.
create or replace function public.mhd_store_status_refresh(p_draft text[], p_archived text[], p_dry_run boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_changes jsonb; v_totals jsonb; v_changed int;
begin
  drop table if exists _estado;
  create temp table _estado on commit drop as
    select s.codigo, s.status antes,
           case when s.product_id = any (p_archived) then 'ARCHIVED' when s.product_id = any (p_draft) then 'DRAFT' else 'ACTIVE' end ahora
    from store_shopify_ids s where s.product_id is not null;
  select coalesce(jsonb_object_agg(cambio, n), '{}') into v_changes
    from (select coalesce(antes, '—') || ' → ' || ahora cambio, count(*) n from _estado where antes is distinct from ahora group by 1) x;
  select count(*) into v_changed from _estado where antes is distinct from ahora;
  if not p_dry_run then
    update store_shopify_ids s set status = e.ahora, updated_at = now() from _estado e where e.codigo = s.codigo and e.antes is distinct from e.ahora;
  end if;
  select jsonb_object_agg(ahora, n) into v_totals from (select ahora, count(*) n from _estado group by 1) y;
  return jsonb_build_object('changes', v_changes, 'totals', v_totals, 'changed', v_changed);
end $$;
revoke execute on function public.mhd_store_status_refresh(text[], text[], boolean) from public, anon, authenticated;
grant execute on function public.mhd_store_status_refresh(text[], text[], boolean) to service_role;

-- Borradores de la tienda con su motivo, para el resumen.
create or replace function public.mhd_draft_breakdown()
returns jsonb language sql stable security definer set search_path = public as $$
  with d as (
    select s.codigo, s.title, s.product_id,
      case
        when c.nombre_familia ilike '%reacondicionad%' or c.nombre_subfamilia ilike '%reacondicionad%' or s.title ilike '%reacondicionad%' then 'reacondicionado (se queda en borrador por regla)'
        when i.status = 'avisar_mhd' then 'avisar a MHD (esperando respuesta)'
        when exists (select 1 from mhd_importer_review_queue q where q.codigo = s.codigo and q.pending) then 'pendiente en la cola de revisión'
        when i.status = 'no_importar' then 'marcado «No importar»'
        when c.codigo is null then 'ya no está en el catálogo de MHD'
        when c.pvp is null or c.pvp <= 1 then 'sin precio en MHD'
        else 'sin motivo conocido' end motivo
    from store_shopify_ids s
    left join mhd_catalog_products c using (codigo)
    left join mhd_importer_review_items i using (codigo)
    where s.status = 'DRAFT')
  select jsonb_build_object('total', (select count(*) from d),
    'motivos', coalesce((select jsonb_agg(jsonb_build_object('motivo', motivo, 'n', n, 'ejemplos', to_jsonb(ejemplos[1:10])) order by n desc) from (
      select motivo, count(*) n, array_agg(jsonb_build_object('codigo', codigo, 'title', title, 'product_id', product_id) order by codigo) ejemplos from d group by motivo) m), '[]'));
$$;
revoke execute on function public.mhd_draft_breakdown() from public, anon, authenticated;
grant execute on function public.mhd_draft_breakdown() to service_role;
