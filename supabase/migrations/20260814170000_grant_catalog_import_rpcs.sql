revoke all on function public.start_catalog_import(text, jsonb) from public, anon;
grant execute on function public.start_catalog_import(text, jsonb) to authenticated;

revoke all on function public.set_catalog_import_status(uuid, text) from public, anon;
grant execute on function public.set_catalog_import_status(uuid, text) to authenticated;
