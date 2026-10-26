-- El trabajador de los procesos (clave secreta, sin usuario) también lee el catálogo de MHD: las funciones de lectura
-- del importador aceptan la sesión de un usuario o el rol de servicio. Ver docs/IMPORTADOR_PRODUCTOS_MHD.md.

create or replace function public.mhd_importer_family_listing(p_family_code text) returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null and coalesce(auth.role(), '') <> 'service_role' then raise exception 'Necesitas iniciar sesión.'; end if;
  return coalesce((select jsonb_agg(mhd_importer_listing_row(p) order by p.codigo) from mhd_catalog_products p
    where p.cod_familia = p_family_code and p.presence_status is distinct from 'absent'), '[]'::jsonb);
end $$;

create or replace function public.mhd_importer_product(p_codigo text) returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null and coalesce(auth.role(), '') <> 'service_role' then raise exception 'Necesitas iniciar sesión.'; end if;
  return (select mhd_importer_listing_row(p) from mhd_catalog_products p where p.codigo = p_codigo or p.codigo_ean = p_codigo order by p.codigo limit 1);
end $$;

grant execute on function public.mhd_importer_family_listing(text), public.mhd_importer_product(text) to service_role;
