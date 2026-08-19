-- pgcrypto is installed in Supabase's extensions schema.  The normalizer
-- calculates its content hashes inside this controlled search path.
alter function public.replace_mhd_catalog_from_run(uuid) set search_path = public, extensions;
alter function public.replace_mhd_catalog_from_run(uuid) set statement_timeout = '60s';
