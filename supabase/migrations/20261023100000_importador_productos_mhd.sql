-- Importador de productos MHD a Shopify (piloto, 2026-10-23).
-- Ver docs/IMPORTADOR_PRODUCTOS_MHD.md: un analista (modelo grande) fija un perfil por familia de MHD y un
-- procesador (modelo pequeño) monta cada producto con ese perfil. Todo se lanza a mano desde la web.

-- Copia de lo leído de MHD (ficha de detalle) y de Icecat, para no repetir consultas al repetir pruebas.
create table public.mhd_importer_source_cache (
  source text not null check (source in ('mhd_detail', 'icecat', 'shopify_filters')),
  source_key text not null,
  http_status integer not null,
  payload jsonb,
  fetched_at timestamptz not null default now(),
  primary key (source, source_key)
);

-- Perfil de cada familia de MHD (cod_familia): reglas que usa el procesador.
create table public.mhd_importer_family_profiles (
  family_code text primary key,
  family_name text not null,
  status text not null default 'draft' check (status in ('draft', 'reviewed')),
  profile jsonb,
  analysis_input jsonb,
  model text,
  usage jsonb,
  cost_usd numeric(10, 4),
  analyzed_at timestamptz,
  reviewed_at timestamptz,
  reviewed_by text,
  updated_at timestamptz not null default now()
);

-- Cada producto procesado: la ficha montada, las comprobaciones y el coste.
create table public.mhd_importer_product_runs (
  id uuid primary key default gen_random_uuid(),
  codigo text not null,
  family_code text,
  status text not null check (status in ('ok', 'discarded', 'error')),
  discard_reason text,
  result jsonb,
  warnings jsonb not null default '[]'::jsonb,
  model text,
  usage jsonb,
  cost_usd numeric(10, 4),
  shopify_product_id text,
  created_by text,
  created_at timestamptz not null default now()
);
create index mhd_importer_product_runs_codigo_idx on public.mhd_importer_product_runs (codigo, created_at desc);

-- La web es interna: cualquier usuario con sesión puede leer y escribir.
alter table public.mhd_importer_source_cache enable row level security;
alter table public.mhd_importer_family_profiles enable row level security;
alter table public.mhd_importer_product_runs enable row level security;
create policy "Sesión: todo" on public.mhd_importer_source_cache for all to authenticated using (true) with check (true);
create policy "Sesión: todo" on public.mhd_importer_family_profiles for all to authenticated using (true) with check (true);
create policy "Sesión: todo" on public.mhd_importer_product_runs for all to authenticated using (true) with check (true);
grant select, insert, update, delete on table public.mhd_importer_source_cache, public.mhd_importer_family_profiles, public.mhd_importer_product_runs to authenticated, service_role;

-- Lectura del catálogo MHD para el importador. Las tablas mhd_catalog_* solo las lee service_role: estas funciones
-- dan acceso de lectura a quien tiene sesión, y solo a lo que el importador necesita.
create or replace function public.mhd_importer_listing_row(p mhd_catalog_products) returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'codigo', p.codigo, 'codigo_ean', p.codigo_ean, 'ref_proved', p.ref_proved, 'titulo', p.titulo, 'nombre_marca', p.nombre_marca,
    'cod_familia', p.cod_familia, 'nombre_familia', p.nombre_familia, 'cod_subfamilia', p.cod_subfamilia, 'nombre_subfamilia', p.nombre_subfamilia,
    'pvp', p.pvp, 'pvp_antes', p.pvp_antes, 'triple_neto', p.triple_neto, 'iva', p.iva, 'stock', p.stock, 'descripcion_ampliada', p.descripcion_ampliada,
    'descripcion', p.source_payload->>'descripcion', 'imagen', p.source_payload->>'imagen', 'letra_eficiencia', p.source_payload->>'letra_eficiencia',
    'img_eficiencia', p.source_payload->>'img_eficiencia', 'img_ficha_eficiencia', p.source_payload->>'img_ficha_eficiencia', 'presence_status', p.presence_status,
    'cod_linea', p.cod_linea,
    -- Portes y servicios de MHD para particulares, tal cual (custom.opciones_entrega).
    'opciones_entrega', jsonb_build_object(
      'gastos_envio_peninsula_particulares', p.source_payload->'gastos_envio_peninsula_particulares', 'gastos_envio_baleares_particulares', p.source_payload->'gastos_envio_baleares_particulares',
      'gastos_envio_portugal_baremo_1_particulares', p.source_payload->'gastos_envio_portugal_baremo_1_particulares', 'gastos_envio_portugal_baremo_2_particulares', p.source_payload->'gastos_envio_portugal_baremo_2_particulares',
      'subida_puerta_particulares', p.source_payload->'subida_puerta_particulares', 'retirada_usado_particulares', p.source_payload->'retirada_usado_particulares',
      'instalacion_particulares', p.source_payload->'instalacion_particulares'))
$$;

create or replace function public.mhd_importer_families() returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Necesitas iniciar sesión.'; end if;
  return coalesce((
    select jsonb_agg(row_to_json(f) order by f.cod_linea, f.family_code) from (
      select p.cod_familia as family_code, max(p.nombre_familia) as family_name, max(p.cod_linea) as cod_linea, max(p.source_payload->>'nombre_linea') as line_name,
        count(*) as products, count(*) filter (where coalesce(p.source_payload->>'imagen', '') <> '') as with_image,
        count(distinct p.cod_subfamilia) as subfamilies,
        max(pr.status) as profile_status, max(pr.analyzed_at) as analyzed_at, max(pr.reviewed_at) as reviewed_at
      from mhd_catalog_products p left join mhd_importer_family_profiles pr on pr.family_code = p.cod_familia
      where p.presence_status is distinct from 'absent' and p.cod_familia is not null
      group by p.cod_familia) f), '[]'::jsonb);
end $$;

create or replace function public.mhd_importer_family_listing(p_family_code text) returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Necesitas iniciar sesión.'; end if;
  return coalesce((select jsonb_agg(mhd_importer_listing_row(p) order by p.codigo) from mhd_catalog_products p
    where p.cod_familia = p_family_code and p.presence_status is distinct from 'absent'), '[]'::jsonb);
end $$;

create or replace function public.mhd_importer_product(p_codigo text) returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Necesitas iniciar sesión.'; end if;
  return (select mhd_importer_listing_row(p) from mhd_catalog_products p where p.codigo = p_codigo or p.codigo_ean = p_codigo order by p.codigo limit 1);
end $$;

revoke execute on function public.mhd_importer_families(), public.mhd_importer_family_listing(text), public.mhd_importer_product(text) from public, anon;
grant execute on function public.mhd_importer_families(), public.mhd_importer_family_listing(text), public.mhd_importer_product(text) to authenticated;

-- Árbol de MHD (línea › familia › subfamilia) con productos y estado del perfil de cada familia, para la web.
create or replace function public.mhd_importer_tree() returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Necesitas iniciar sesión.'; end if;
  return coalesce((
    with counts as (
      select cod_subfamilia, count(*) as products, count(*) filter (where coalesce(source_payload->>'imagen', '') <> '') as with_image
      from mhd_catalog_products where presence_status is distinct from 'absent' group by cod_subfamilia
    ), subs as (
      select c.cod_familia, jsonb_agg(jsonb_build_object('code', c.cd_familia, 'name', c.nombre, 'products', coalesce(n.products, 0), 'with_image', coalesce(n.with_image, 0)) order by c.cd_familia) as items,
        sum(coalesce(n.products, 0)) as products, sum(coalesce(n.with_image, 0)) as with_image
      from mhd_catalog_categories c left join counts n on n.cod_subfamilia = c.cd_familia where c.nivel = 3 group by c.cod_familia
    ), fams as (
      select f.cod_linea, jsonb_agg(jsonb_build_object('code', f.cd_familia, 'name', f.nombre, 'products', coalesce(s.products, 0), 'with_image', coalesce(s.with_image, 0),
        'profile_status', p.status, 'analyzed_at', p.analyzed_at, 'subfamilies', coalesce(s.items, '[]'::jsonb)) order by f.cd_familia) as items,
        sum(coalesce(s.products, 0)) as products
      from mhd_catalog_categories f left join subs s on s.cod_familia = f.cd_familia left join mhd_importer_family_profiles p on p.family_code = f.cd_familia
      where f.nivel = 2 group by f.cod_linea
    )
    select jsonb_agg(jsonb_build_object('code', l.cd_familia, 'name', l.nombre, 'products', coalesce(fams.products, 0), 'families', coalesce(fams.items, '[]'::jsonb)) order by l.orden nulls last, l.cd_familia)
    from mhd_catalog_categories l left join fams on fams.cod_linea = l.cd_familia where l.nivel = 1), '[]'::jsonb);
end $$;
revoke execute on function public.mhd_importer_tree() from public, anon;
grant execute on function public.mhd_importer_tree() to authenticated;

-- Fotos ya tratadas y etiqueta energética de cada prueba de producto, tal como se subirían a Shopify.
create table public.mhd_importer_media (
  id uuid primary key default gen_random_uuid(),
  run_id uuid references public.mhd_importer_product_runs (id) on delete cascade,
  role text not null check (role in ('image', 'energy_label', 'video')),
  position integer not null default 0,
  filename text not null,
  content_type text not null,
  width integer,
  height integer,
  bytes bytea not null,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index mhd_importer_media_run_idx on public.mhd_importer_media (run_id, role, position);
alter table public.mhd_importer_media enable row level security;
create policy "Sesión: todo" on public.mhd_importer_media for all to authenticated using (true) with check (true);
grant select, insert, update, delete on table public.mhd_importer_media to authenticated, service_role;

-- Archivos ya subidos a Shopify, por huella (SHA-1) del contenido: un mismo vídeo de marca que llega en varios
-- productos se sube una sola vez y se enlaza desde todos (decidido 2026-10-23).
create table public.mhd_importer_shopify_files (
  hash text primary key,
  shopify_file_id text not null,
  filename text not null,
  kind text not null,
  source_url text,
  created_at timestamptz not null default now()
);
alter table public.mhd_importer_shopify_files enable row level security;
create policy "Sesión: todo" on public.mhd_importer_shopify_files for all to authenticated using (true) with check (true);
grant select, insert, update, delete on table public.mhd_importer_shopify_files to authenticated, service_role;
