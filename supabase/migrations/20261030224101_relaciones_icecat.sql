-- Relaciones de Icecat en los metacampos de Search & Discovery (David, 2026-10-30; docs/SINCRONIZACIONES_MHD.md).
-- Reglas revisadas con muestras: complementarios = consumable, accessory y compatible invertido, sin monitores y sin
-- fundas o mochilas de otra talla; relacionados = alternative del mismo tipo y con el mismo conector o formato. Máximo 10.
create table public.mhd_shopify_relations (
  product_id text primary key,
  complementary jsonb not null default '[]',
  related jsonb not null default '[]',
  sent_at timestamptz not null default now()
);
alter table public.mhd_shopify_relations enable row level security;
create policy "Sesión: leer" on public.mhd_shopify_relations for select to authenticated using (true);
grant select on table public.mhd_shopify_relations to authenticated;
grant select, insert, update, delete on table public.mhd_shopify_relations to service_role;

create or replace function public.mhd_relations_calc()
returns table (product_id text, complementary jsonb, related jsonb)
language sql stable security definer set search_path = public set statement_timeout = '120s' as $$
  with tienda as materialized (select s.ean, s.product_id pid, s.title, coalesce(nullif(s.product_type,''),'(sin tipo)') pt, coalesce(c.stock,0)>0 hay from store_shopify_ids s left join mhd_catalog_products c on c.codigo=s.codigo where s.ean is not null and s.ean<>'' and s.title !~* '(garant[ií]a|ampliaci[oó]n|tarjeta regalo|instalaci[oó]n|subida a puerta)'),
  fichas as materialized (select c.source_key ean, c.payload->'data'->'GeneralInfo'->>'IcecatId' icecat_id, c.payload->'data'->'ProductRelated' rel from mhd_importer_source_cache c join tienda t on t.ean=c.source_key where c.source='icecat' and c.payload->'data' ? 'GeneralInfo'),
  idx as materialized (select distinct on (icecat_id) icecat_id, ean from fichas where icecat_id is not null),
  enl as materialized (select case when r->>'RelationTypeCode'='compatible' then i.ean else f.ean end o, case when r->>'RelationTypeCode'='compatible' then f.ean else i.ean end d, r->>'RelationTypeCode' tipo from fichas f, jsonb_array_elements(case when jsonb_typeof(f.rel)='array' then f.rel else '[]' end) r join idx i on i.icecat_id=r->>'IcecatID' where i.ean<>f.ean and r->>'RelationTypeCode' in ('accessory','compatible','consumable','alternative')),
  base as materialized (select e.tipo, e.o, e.d, a.pid pid_o, b.pid pid_d, a.title ta, b.title tb, a.pt pa, b.pt pb, b.hay,
   replace((regexp_match(a.title,'(\d+(?:[.,]\d+)?)"'))[1],',','.')::numeric pul_a, replace((regexp_match(b.title,'(\d+(?:[.,]\d+)?)"'))[1],',','.')::numeric pul_b,
   (select string_agg(distinct lower(m[1]),',') from regexp_matches(a.title,'(hdmi|displayport|mini displayport|lightning|usb-c|usb c|usb-a|usb a|usb 2\.0 a|rj-?45|cat\s?\d[a-z]?|vga|dvi|\yaaa\y|\yaa\y|\y9 ?v\y|cr\d{4}|lr\d+)','gi') m) con_a,
   (select string_agg(distinct lower(m[1]),',') from regexp_matches(b.title,'(hdmi|displayport|mini displayport|lightning|usb-c|usb c|usb-a|usb a|usb 2\.0 a|rj-?45|cat\s?\d[a-z]?|vga|dvi|\yaaa\y|\yaa\y|\y9 ?v\y|cr\d{4}|lr\d+)','gi') m) con_b
   from enl e join tienda a on a.ean=e.o join tienda b on b.ean=e.d),
  comp0 as (select o,d,min(case tipo when 'consumable' then 1 when 'accessory' then 2 else 3 end) pri, min(pb) pb, min(pa) pa, bool_or(hay) hay, min(tb) tb, min(ta) ta, min(pid_o) pid_o, min(pid_d) pid_d, min(pul_a) pul_a, min(pul_b) pul_b from base where tipo<>'alternative' group by 1,2),
  comp2 as (select *, row_number() over (partition by o order by hay desc, pri, (tb ~* '\yXL\y|negro') desc, d) k from comp0 where pb<>'Monitores' and not coalesce(pb ~* 'funda|mochila' and (pul_b<pul_a-0.5 or pul_b>pul_a+1.5),false)),
  rel0 as (select distinct o,d,pa,pb,con_a,con_b,hay,tb,ta,pid_o,pid_d from base where tipo='alternative'),
  rel2 as (select *, row_number() over (partition by o order by hay desc, d) k from rel0 where pa=pb and not (pa ~* 'cable|adaptador|pila|accesorios para impresoras|bater' and coalesce(con_a,'')<>coalesce(con_b,''))),
  lista as (
      select pid_o, 'c' m, jsonb_agg(pid_d order by k) ids from comp2 where k<=10 group by 1
      union all select pid_o, 'r', jsonb_agg(pid_d order by k) from rel2 where k<=10 group by 1)
    select pid_o, coalesce(jsonb_agg(ids) filter (where m='c') -> 0, '[]'::jsonb), coalesce(jsonb_agg(ids) filter (where m='r') -> 0, '[]'::jsonb)
    from lista group by 1 order by 1;
$$;
revoke execute on function public.mhd_relations_calc() from public, anon, authenticated;
grant execute on function public.mhd_relations_calc() to service_role;

-- Punto de partida: la carga puntual del 2026-10-30 ya está en Shopify.
insert into public.mhd_shopify_relations (product_id, complementary, related) select * from public.mhd_relations_calc();

-- Preparada pero apagada (David, 2026-10-30): las reglas del proceso están por definir. Cuando se activen: una vez al día.
select cron.schedule('sincro-vicente-relaciones', '45 4 * * *', $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'sincro_vicente_app_url') || '/api/sincronizaciones/relaciones',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-mhd-import-token', (select decrypted_secret from vault.decrypted_secrets where name = 'mhd_catalog_import_token')),
    body := '{}'::jsonb, timeout_milliseconds := 60000);
$$);
select cron.alter_job((select jobid from cron.job where jobname = 'sincro-vicente-relaciones'), active := false);
