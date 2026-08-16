create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

alter table public.source_sqlserver_rows add column if not exists row_hash text;

create or replace function public.source_row_hash(p_payload jsonb)
returns text language sql immutable set search_path = pg_catalog, extensions
as $$ select encode(extensions.digest(convert_to(p_payload::text, 'UTF8'), 'sha256'), 'hex') $$;

create or replace function public.set_source_sqlserver_row_hash()
returns trigger language plpgsql set search_path = public
as $$ begin new.row_hash := public.source_row_hash(new.payload); return new; end; $$;

drop trigger if exists source_sqlserver_rows_hash on public.source_sqlserver_rows;
create trigger source_sqlserver_rows_hash
before insert or update of payload on public.source_sqlserver_rows
for each row execute function public.set_source_sqlserver_row_hash();

update public.source_sqlserver_rows set row_hash = public.source_row_hash(payload) where row_hash is null;

do $$
declare v_table text;
begin
  foreach v_table in array array['source_manufacturers','source_categories','source_features','source_feature_values','source_products','source_prices','source_related_products','source_stock'] loop
    execute format('alter table public.%I add column if not exists source_hash text', v_table);
    execute format('alter table public.%I add column if not exists source_changed boolean not null default false', v_table);
    execute format('alter table public.%I add column if not exists shopify_synced boolean not null default true', v_table);
  end loop;
end $$;

update public.source_manufacturers target set source_hash = incoming.row_hash
from (select distinct on (payload ->> 'id') payload ->> 'id' as id, row_hash from public.source_sqlserver_rows where source_table = 'ELECTRONICA_VICENTE_B2C_Fabricantes' order by payload ->> 'id', row_number desc) incoming where target.id = incoming.id;
update public.source_categories target set source_hash = incoming.row_hash
from (select distinct on (payload ->> 'id') payload ->> 'id' as id, row_hash from public.source_sqlserver_rows where source_table = 'ELECTRONICA_VICENTE_B2C_Categorias_Web' order by payload ->> 'id', row_number desc) incoming where target.id = incoming.id;
update public.source_features target set source_hash = incoming.row_hash
from (select distinct on (payload ->> 'id') payload ->> 'id' as id, row_hash from public.source_sqlserver_rows where source_table = 'ELECTRONICA_VICENTE_B2C_Caracteristicas' order by payload ->> 'id', row_number desc) incoming where target.id::text = incoming.id;
update public.source_feature_values target set source_hash = incoming.row_hash
from (select distinct on (payload ->> 'id') payload ->> 'id' as id, row_hash from public.source_sqlserver_rows where source_table = 'ELECTRONICA_VICENTE_B2C_CaracteristicasValores' order by payload ->> 'id', row_number desc) incoming where target.id::text = incoming.id;
update public.source_products target set source_hash = incoming.row_hash
from (select distinct on (payload ->> 'id') payload ->> 'id' as id, row_hash from public.source_sqlserver_rows where source_table = 'ELECTRONICA_VICENTE_B2C_Productos' order by payload ->> 'id', row_number desc) incoming where target.id = incoming.id;
update public.source_prices target set source_hash = incoming.row_hash
from (select distinct on (payload ->> 'id') payload ->> 'id' as id, row_hash from public.source_sqlserver_rows where source_table = 'ELECTRONICA_VICENTE_B2C_Precios' order by payload ->> 'id', row_number desc) incoming where target.id = incoming.id;
update public.source_related_products target set source_hash = incoming.row_hash
from (select distinct on (payload ->> 'id') payload ->> 'id' as id, row_hash from public.source_sqlserver_rows where source_table = 'ELECTRONICA_VICENTE_B2C_Producto_Relacionados' order by payload ->> 'id', row_number desc) incoming where target.id = incoming.id;
update public.source_stock target set source_hash = incoming.row_hash
from (select distinct on (payload ->> 'id') payload ->> 'id' as id, row_hash from public.source_sqlserver_rows where source_table = 'ELECTRONICA_VICENTE_B2C_Stocks' order by payload ->> 'id', row_number desc) incoming where target.id = incoming.id;

update public.source_manufacturers set source_changed = false, shopify_synced = true;
update public.source_categories set source_changed = false, shopify_synced = true;
update public.source_features set source_changed = false, shopify_synced = true;
update public.source_feature_values set source_changed = false, shopify_synced = true;
update public.source_products set source_changed = false, shopify_synced = true;
update public.source_prices set source_changed = false, shopify_synced = true;
update public.source_related_products set source_changed = false, shopify_synced = true;
update public.source_stock set source_changed = false, shopify_synced = true;
