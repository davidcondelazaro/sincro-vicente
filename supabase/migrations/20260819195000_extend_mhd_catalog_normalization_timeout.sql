-- A full initial catalogue is over 100k raw records.  This single controlled
-- service-role normalizer needs more than the REST statement default.
alter function public.replace_mhd_catalog_from_run(uuid) set statement_timeout = '60s';
