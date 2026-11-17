-- Portes, plazos, zonas sin envío y etiqueta energética en Google Merchant Center por la Merchant API (David, 2026-11-17:
-- «no pueden quedar fisuras»). Encargo: theme-enterprise-vicente/docs/encargo-merchant-api-sincro.md. Código en
-- src/lib/merchant/. Un producto de MHD = una oferta por país (ES y PT), con id `shopify_ZZ_<producto>_<variante>`.
--
-- Tres piezas:
-- 1. merchant_ofertas: lo que hay de verdad en Merchant Center (lo sube la app Google & YouTube de Shopify, solo lo
--    publicado en el canal). Se llena con la conciliación diaria y con las comprobaciones del trabajador.
-- 2. merchant_enviado: lo último mandado a la fuente complementaria de cada país y al inventario regional.
-- 3. merchant_cola: productos pendientes de revisar. La llenan disparadores en las tablas que ya escriben las
--    sincronizaciones (portes, stock y estado), así que ningún camino del código se puede olvidar de avisar.

create table public.merchant_ofertas (
  offer_id text not null,
  pais text not null check (pais in ('ES', 'PT')),
  codigo text,                                      -- SKU que manda la app (= código de MHD)
  huella_real text,                                 -- portes, plazos y certificación que aplica Merchant Center
  real jsonb,                                       -- lo mismo, legible, para auditar
  visto_at timestamptz not null default now(),
  primary key (offer_id, pais)
);
create index merchant_ofertas_codigo on public.merchant_ofertas (codigo);

create table public.merchant_enviado (
  offer_id text not null,
  pais text not null check (pais in ('ES', 'PT')),
  codigo text not null,
  datos jsonb,                                      -- porte, plazos, eprel y de dónde sale el porte
  huella text,                                      -- de `datos`: solo se manda lo que cambia
  enviado_at timestamptz,
  regional_at timestamptz,                          -- último inventario regional `out_of_stock` (caduca a los 14 días)
  borrado_at timestamptz,                           -- quitado de la complementaria (borrador o ya no está)
  reenvios integer not null default 0,              -- veces que se ha mandado de nuevo porque Merchant Center no lo refleja
  primary key (offer_id, pais)
);
create index merchant_enviado_codigo on public.merchant_enviado (codigo);

create table public.merchant_cola (
  codigo text primary key,
  motivo text not null,
  encolado_at timestamptz not null default now(),
  siguiente_at timestamptz not null default now(),  -- esperas crecientes cuando la oferta aún no está en Merchant Center
  intentos integer not null default 0,
  ultimo_error text,
  en_curso_at timestamptz                           -- lo ha cogido un trabajador (se suelta solo a los 10 minutos)
);
create index merchant_cola_siguiente on public.merchant_cola (siguiente_at);

alter table public.merchant_ofertas enable row level security;
alter table public.merchant_enviado enable row level security;
alter table public.merchant_cola enable row level security;
create policy "Sesión: leer" on public.merchant_ofertas for select to authenticated using (true);
create policy "Sesión: leer" on public.merchant_enviado for select to authenticated using (true);
create policy "Sesión: leer" on public.merchant_cola for select to authenticated using (true);
grant select on table public.merchant_ofertas, public.merchant_enviado, public.merchant_cola to authenticated;
grant select, insert, update, delete on table public.merchant_ofertas, public.merchant_enviado, public.merchant_cola to service_role;

-- Encolar: un aviso nuevo adelanta el producto aunque estuviera esperando, pero no borra sus intentos.
create or replace function public.merchant_encolar(p_codigo text, p_motivo text) returns void
language sql security definer set search_path = public as $$
  insert into merchant_cola (codigo, motivo) values (p_codigo, p_motivo)
  on conflict (codigo) do update set motivo = excluded.motivo, encolado_at = now(), siguiente_at = now();
$$;

create or replace function public.merchant_disparador() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_table_name = 'store_shopify_ids' then
    if tg_op = 'INSERT' or old.status is distinct from new.status then perform merchant_encolar(new.codigo, 'estado ' || coalesce(new.status, '—')); end if;
  elsif tg_table_name = 'mhd_shopify_delivery_options' then
    if tg_op = 'INSERT' or old.options is distinct from new.options then perform merchant_encolar(new.codigo, 'portes'); end if;
  elsif tg_table_name = 'mhd_shopify_price_stock' then
    -- Solo cuando pasa de tener stock a no tenerlo o al revés: cambia el plazo (con stock / sin stock).
    if tg_op = 'INSERT' or (coalesce(old.stock, 0) > 0) <> (coalesce(new.stock, 0) > 0) then perform merchant_encolar(new.codigo, 'stock'); end if;
  end if;
  return null;
end $$;

create trigger merchant_cola_estado after insert or update of status on public.store_shopify_ids for each row execute function public.merchant_disparador();
create trigger merchant_cola_portes after insert or update of options on public.mhd_shopify_delivery_options for each row execute function public.merchant_disparador();
create trigger merchant_cola_stock after insert or update of stock on public.mhd_shopify_price_stock for each row execute function public.merchant_disparador();

-- Coger trabajo: los que tocan, sin pisar a otro trabajador.
create or replace function public.merchant_cola_coger(p_limite integer) returns setof public.merchant_cola
language sql security definer set search_path = public as $$
  update merchant_cola c set en_curso_at = now()
  where c.codigo in (
    select codigo from merchant_cola
    where siguiente_at <= now() and (en_curso_at is null or en_curso_at < now() - interval '10 minutes')
    order by siguiente_at limit p_limite for update skip locked)
  returning c.*;
$$;

-- Conciliación: todo lo publicado y todo lo que tenemos mandado, a la cola sin adelantar lo que ya está esperando.
create or replace function public.merchant_encolar_todo() returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  insert into merchant_cola (codigo, motivo, siguiente_at)
  select codigo, 'conciliación', now() from (
    select codigo from store_shopify_ids where status = 'ACTIVE'
    union select codigo from merchant_enviado where borrado_at is null
    union select codigo from merchant_ofertas where codigo is not null) t
  on conflict (codigo) do update set motivo = case when merchant_cola.intentos > 0 then merchant_cola.motivo else 'conciliación' end;
  get diagnostics n = row_count;
  return n;
end $$;

revoke execute on function public.merchant_encolar(text, text), public.merchant_cola_coger(integer), public.merchant_encolar_todo() from public, anon, authenticated;
grant execute on function public.merchant_encolar(text, text), public.merchant_cola_coger(integer), public.merchant_encolar_todo() to service_role;

-- Configuración. Apagado hasta que David dé el visto bueno; `merchant_solo_codigos` limita las pruebas a unos pocos.
insert into public.store_settings (key, value) values
  ('merchant_activo', 'false'::jsonb),
  ('merchant_solo_codigos', '[]'::jsonb),
  ('merchant_fuentes', '{}'::jsonb)
on conflict (key) do nothing;
