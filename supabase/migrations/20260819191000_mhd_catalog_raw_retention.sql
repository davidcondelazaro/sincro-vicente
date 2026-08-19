create or replace function public.keep_latest_mhd_catalog_raw_rows()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.status = 'completed' and old.status <> 'completed' then
    delete from public.mhd_catalog_raw_rows raw
    using public.mhd_catalog_import_runs runs
    where raw.import_run_id = runs.id and runs.status = 'completed' and runs.id <> new.id;
  end if;
  return new;
end; $$;
revoke all on function public.keep_latest_mhd_catalog_raw_rows() from public;
create trigger mhd_catalog_keep_latest_raw_after_completion
after update of status on public.mhd_catalog_import_runs
for each row execute function public.keep_latest_mhd_catalog_raw_rows();
