-- Árbol nuevo de colecciones de la tienda (decidido con David el 2026-10-26, a partir de la Excel de Vicente). Es la fuente
-- de verdad para los metacampos de los productos (custom.apartado, custom.grupo, custom.familia = handle de su colección),
-- las colecciones automáticas, el menú, las migas de pan y las redirecciones de categoría. Copias de trabajo para revisar:
-- theme-enterprise-vicente/docs/arbol-colecciones-nombres-y-direcciones.xlsx y docs/arbol-colecciones-equivalencias.csv.
create table public.store_collections (
  handle text primary key,                    -- dirección de la colección (/collections/<handle>) y valor de su metacampo
  title text not null,                        -- nombre visible (menú y tarjeta)
  page_title text,                            -- título de la página si difiere («Pequeño electrodoméstico»)
  level text not null check (level in ('apartado', 'grupo', 'familia')),
  parent_handle text references public.store_collections (handle),
  apartado_handle text not null,
  in_menu boolean not null default false,     -- familia «mega» de la Excel, grupo con alguna destacada o apartado
  also_in text[] not null default '{}',       -- otros apartados o grupos desde los que también se ve (Monitores → Televisión)
  position integer not null default 0,        -- orden dentro de su padre (el de la Excel)
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index store_collections_parent on public.store_collections (parent_handle, position);

create table public.store_mhd_subfamily_map (
  mhd_subfamily_code text primary key,        -- cod_subfamilia de MHD: el emparejamiento va por el código, no por el nombre
  mhd_subfamily_name text not null,
  collection_handle text not null references public.store_collections (handle),
  warranty_eligible boolean,                  -- admite ampliación de garantía (pendiente de decidir; null = sin decidir)
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index store_mhd_subfamily_map_collection on public.store_mhd_subfamily_map (collection_handle);

create table public.store_collection_equivalences (
  current_handle text primary key,            -- colección de la tienda de hoy
  new_handle text not null,                   -- colección del árbol nuevo o página de marca a la que redirige
  level text not null check (level in ('familia', 'grupo', 'apartado', 'marca', 'misma')),
  confidence text not null check (confidence in ('alta', 'media', 'baja')),
  criterion text,
  products integer not null default 0,
  products_mhd integer not null default 0,
  clicks_16m integer not null default 0,
  status text not null default 'propuesta' check (status in ('propuesta', 'revisada')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.store_collections enable row level security;
alter table public.store_mhd_subfamily_map enable row level security;
alter table public.store_collection_equivalences enable row level security;
create policy "Sesión: leer" on public.store_collections for select to authenticated using (true);
create policy "Sesión: leer" on public.store_mhd_subfamily_map for select to authenticated using (true);
create policy "Sesión: leer" on public.store_collection_equivalences for select to authenticated using (true);
grant select on table public.store_collections, public.store_mhd_subfamily_map, public.store_collection_equivalences to authenticated;
grant select, insert, update, delete on table public.store_collections, public.store_mhd_subfamily_map, public.store_collection_equivalences to service_role;
