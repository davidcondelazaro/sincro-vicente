-- SQL Server contains both numeric and named feature identifiers (for example,
-- PORTESGRATIS). Preserve them faithfully instead of coercing them to integers.
alter table public.source_features
  alter column id type text using id::text;

alter table public.source_feature_values
  alter column id type text using id::text,
  alter column id_feature type text using id_feature::text;
