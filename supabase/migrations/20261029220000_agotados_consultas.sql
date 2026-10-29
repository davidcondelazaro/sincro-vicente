-- Consultas del paso «agotados» de la vuelta (2026-10-29).
-- Candidatos: productos de la tienda (activos o en borrador) con código de MHD que no vienen en la lectura dada y que
-- aún no están apuntados como desaparecidos.
create or replace function public.mhd_absence_candidates(p_run uuid)
returns table (codigo text, product_id text, variant_id text, inventory_item_id text, product_status text)
language sql stable security definer set search_path = public as $$
  select distinct on (c.codigo) c.codigo, v.product_id, v.variant_id, v.inventory_item_id, p.status
  from shopify_variants v
  join shopify_products p on p.product_id = v.product_id and p.status in ('ACTIVE', 'DRAFT')
  join mhd_catalog_products c on c.codigo = v.sku
  where c.last_seen_run_id is distinct from p_run
    and not exists (select 1 from mhd_missing_products m where m.codigo = c.codigo and m.returned_at is null and m.archived_at is null)
  order by c.codigo;
$$;
revoke execute on function public.mhd_absence_candidates(uuid) from public, anon, authenticated;
grant execute on function public.mhd_absence_candidates(uuid) to service_role;

-- Vueltas: apuntados como desaparecidos que vuelven a venir en la lectura dada.
create or replace function public.mhd_absence_returns(p_run uuid)
returns table (id bigint, codigo text, product_id text, variant_id text, policy_before text)
language sql stable security definer set search_path = public as $$
  select m.id, m.codigo, m.product_id, m.variant_id, m.policy_before
  from mhd_missing_products m join mhd_catalog_products c on c.codigo = m.codigo
  where m.returned_at is null and m.archived_at is null and c.last_seen_run_id = p_run;
$$;
revoke execute on function public.mhd_absence_returns(uuid) from public, anon, authenticated;
grant execute on function public.mhd_absence_returns(uuid) to service_role;
