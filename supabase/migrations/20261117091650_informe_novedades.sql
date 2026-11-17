-- Informe diario: marcas, familias y subfamilias nuevas de MHD y lo que no puede entrar en la tienda (David, 2026-11-17).
-- mhd_report_known guarda cuándo se vio cada una por primera vez; lo que ya existía se siembra con fecha antigua para
-- que no salga como nuevo.
create table if not exists public.mhd_report_known (
  kind text not null check (kind in ('marca', 'familia', 'subfamilia')),
  code text not null,
  name text,
  first_seen_at timestamptz not null default now(),
  primary key (kind, code)
);
alter table public.mhd_report_known enable row level security;
create policy "mhd_report_known lectura" on public.mhd_report_known for select to authenticated using (true);

insert into public.mhd_report_known (kind, code, name, first_seen_at)
select distinct on (kind, code) kind, code, name, timestamptz '2000-01-01' from (
  select 'marca' kind, upper(trim(nombre_marca)) code, trim(nombre_marca) name from public.mhd_catalog_products where nullif(trim(nombre_marca), '') is not null
  union all select 'familia', cod_familia, nombre_familia from public.mhd_catalog_products where cod_familia is not null
  union all select 'subfamilia', cod_subfamilia, nombre_subfamilia from public.mhd_catalog_products where cod_subfamilia is not null
) x order by kind, code
on conflict do nothing;

-- Familias de MHD que se dejan fuera a propósito (no salen como bloqueadas en el informe).
insert into public.store_settings (key, value) values ('report_ignored_families', '["S95", "S93"]') on conflict (key) do nothing;

create or replace function public.mhd_report_novelties(p_since timestamptz)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_run uuid;
  v_ignored text[];
  v_result jsonb;
begin
  select last_seen_run_id into v_run from mhd_catalog_products where last_seen_run_id is not null order by last_seen_at desc nulls last limit 1;
  select coalesce(array(select jsonb_array_elements_text(value)), '{}') into v_ignored from store_settings where key = 'report_ignored_families';
  v_ignored := coalesce(v_ignored, '{}');

  -- Lo que aparece por primera vez en el listado
  insert into mhd_report_known (kind, code, name)
  select distinct on (kind, code) kind, code, name from (
    select 'marca' kind, upper(trim(nombre_marca)) code, trim(nombre_marca) name from mhd_catalog_products where last_seen_run_id = v_run and nullif(trim(nombre_marca), '') is not null
    union all select 'familia', cod_familia, nombre_familia from mhd_catalog_products where last_seen_run_id = v_run and cod_familia is not null
    union all select 'subfamilia', cod_subfamilia, nombre_subfamilia from mhd_catalog_products where last_seen_run_id = v_run and cod_subfamilia is not null
  ) x order by kind, code
  on conflict do nothing;

  with listing as (select * from mhd_catalog_products where last_seen_run_id = v_run),
  in_store as (select codigo from store_shopify_ids where status in ('ACTIVE', 'DRAFT'))
  select jsonb_build_object(
    'marcas', coalesce((select jsonb_agg(jsonb_build_object('name', k.name, 'first_seen_at', k.first_seen_at, 'productos', (select count(*) from listing l where upper(trim(l.nombre_marca)) = k.code), 'en_tienda', (select count(*) from listing l join in_store s using (codigo) where upper(trim(l.nombre_marca)) = k.code)) order by k.name) from mhd_report_known k where k.kind = 'marca' and k.first_seen_at >= p_since), '[]'),
    'familias', coalesce((select jsonb_agg(jsonb_build_object('code', k.code, 'name', k.name, 'first_seen_at', k.first_seen_at, 'productos', (select count(*) from listing l where l.cod_familia = k.code), 'con_reglas', exists (select 1 from mhd_importer_family_profiles f where f.family_code = k.code)) order by k.name) from mhd_report_known k where k.kind = 'familia' and k.first_seen_at >= p_since), '[]'),
    'subfamilias', coalesce((select jsonb_agg(jsonb_build_object('code', k.code, 'name', k.name, 'first_seen_at', k.first_seen_at, 'productos', (select count(*) from listing l where l.cod_subfamilia = k.code), 'colocada', exists (select 1 from store_mhd_subfamily_map m where m.mhd_subfamily_code = k.code)) order by k.name) from mhd_report_known k where k.kind = 'subfamilia' and k.first_seen_at >= p_since), '[]'),
    -- No pueden entrar: su familia no tiene reglas o su subfamilia no tiene sitio en el árbol de la tienda
    'bloqueadas', coalesce((select jsonb_agg(b order by (b ->> 'productos')::int desc) from (
      select jsonb_build_object('familia', max(l.nombre_familia), 'subfamilia', max(l.nombre_subfamilia), 'code', l.cod_subfamilia,
        'motivo', case when not exists (select 1 from mhd_importer_family_profiles f where f.family_code = l.cod_familia) then 'familia sin reglas' else 'subfamilia sin sitio en la tienda' end,
        'productos', count(*)) b
      from listing l
      where not exists (select 1 from store_shopify_ids s where s.codigo = l.codigo)
        and not (l.cod_familia = any (v_ignored))
        and (not exists (select 1 from mhd_importer_family_profiles f where f.family_code = l.cod_familia)
             or not exists (select 1 from store_mhd_subfamily_map m where m.mhd_subfamily_code = l.cod_subfamilia))
      group by l.cod_familia, l.cod_subfamilia) z), '[]')
  ) into v_result;
  return v_result;
end $$;
revoke execute on function public.mhd_report_novelties(timestamptz) from public, anon, authenticated;
grant execute on function public.mhd_report_novelties(timestamptz) to service_role;
