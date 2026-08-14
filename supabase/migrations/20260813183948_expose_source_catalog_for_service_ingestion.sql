alter table catalog.source_batches set schema public;
alter table catalog.products set schema public;
alter table catalog.categories set schema public;
alter table catalog.manufacturers set schema public;
alter table catalog.features set schema public;
alter table catalog.feature_values set schema public;
alter table catalog.stock set schema public;
alter table catalog.prices set schema public;
alter table catalog.related_products set schema public;
alter table catalog.category_metadata set schema public;
alter table catalog.manufacturer_metadata set schema public;

alter table public.source_batches rename to source_catalog_batches;
alter table public.products rename to source_products;
alter table public.categories rename to source_categories;
alter table public.manufacturers rename to source_manufacturers;
alter table public.features rename to source_features;
alter table public.feature_values rename to source_feature_values;
alter table public.stock rename to source_stock;
alter table public.prices rename to source_prices;
alter table public.related_products rename to source_related_products;
alter table public.category_metadata rename to source_category_metadata;
alter table public.manufacturer_metadata rename to source_manufacturer_metadata;

alter table public.source_catalog_batches enable row level security;
alter table public.source_products enable row level security;
alter table public.source_categories enable row level security;
alter table public.source_manufacturers enable row level security;
alter table public.source_features enable row level security;
alter table public.source_feature_values enable row level security;
alter table public.source_stock enable row level security;
alter table public.source_prices enable row level security;
alter table public.source_related_products enable row level security;
alter table public.source_category_metadata enable row level security;
alter table public.source_manufacturer_metadata enable row level security;

revoke all on table public.source_catalog_batches, public.source_products, public.source_categories,
  public.source_manufacturers, public.source_features, public.source_feature_values, public.source_stock,
  public.source_prices, public.source_related_products, public.source_category_metadata,
  public.source_manufacturer_metadata from anon, authenticated;
grant select, insert, update, delete on table public.source_catalog_batches, public.source_products,
  public.source_categories, public.source_manufacturers, public.source_features, public.source_feature_values,
  public.source_stock, public.source_prices, public.source_related_products, public.source_category_metadata,
  public.source_manufacturer_metadata to service_role;
