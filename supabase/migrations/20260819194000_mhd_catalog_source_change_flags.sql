-- Hashes are the definitive detector: dates from MHD remain useful as source
-- metadata, but a row is marked changed only when its canonical payload differs.
alter table public.mhd_catalog_products add column source_changed boolean not null default false;
alter table public.mhd_catalog_categories add column source_changed boolean not null default false;
alter table public.mhd_catalog_brands add column source_changed boolean not null default false;
alter table public.mhd_catalog_prices add column source_changed boolean not null default false;
alter table public.mhd_catalog_stock add column source_changed boolean not null default false;

create or replace function public.mark_mhd_catalog_source_changed()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  new.source_changed := old.source_hash is distinct from new.source_hash;
  return new;
end;
$$;

create trigger mhd_products_source_changed before update on public.mhd_catalog_products for each row execute function public.mark_mhd_catalog_source_changed();
create trigger mhd_categories_source_changed before update on public.mhd_catalog_categories for each row execute function public.mark_mhd_catalog_source_changed();
create trigger mhd_brands_source_changed before update on public.mhd_catalog_brands for each row execute function public.mark_mhd_catalog_source_changed();
create trigger mhd_prices_source_changed before update on public.mhd_catalog_prices for each row execute function public.mark_mhd_catalog_source_changed();
create trigger mhd_stock_source_changed before update on public.mhd_catalog_stock for each row execute function public.mark_mhd_catalog_source_changed();
