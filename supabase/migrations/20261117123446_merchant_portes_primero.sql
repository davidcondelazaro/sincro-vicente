-- Google Merchant: los cambios de portes pasan los primeros de la cola (David, 2026-11-17: es donde hay que estar
-- «verdaderamente anclado»). Detrás, stock y altas del importador; la conciliación, la última.
create or replace function public.merchant_cola_coger(p_limite integer) returns setof public.merchant_cola
language sql security definer set search_path = public as $$
  update merchant_cola c set en_curso_at = now()
  where c.codigo in (
    select codigo from merchant_cola
    where siguiente_at <= now() and (en_curso_at is null or en_curso_at < now() - interval '10 minutes')
    order by case when motivo = 'portes' then 0 when motivo = 'conciliación' then 2 else 1 end, siguiente_at
    limit p_limite for update skip locked)
  returning c.*;
$$;
-- La conciliación no quita la prioridad a un aviso de portes que ya esté esperando.
create or replace function public.merchant_encolar_todo() returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  insert into merchant_cola (codigo, motivo, siguiente_at)
  select codigo, 'conciliación', now() from (
    select codigo from store_shopify_ids where status = 'ACTIVE'
    union select codigo from merchant_enviado where borrado_at is null
    union select codigo from merchant_ofertas where codigo is not null) t
  on conflict (codigo) do nothing;
  get diagnostics n = row_count;
  return n;
end $$;
