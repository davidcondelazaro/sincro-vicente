-- Un aviso de portes pendiente no pierde su turno si luego llega otro (stock, importador) del mismo producto.
create or replace function public.merchant_encolar(p_codigo text, p_motivo text) returns void
language sql security definer set search_path = public as $$
  insert into merchant_cola (codigo, motivo) values (p_codigo, p_motivo)
  on conflict (codigo) do update set motivo = case when merchant_cola.motivo = 'portes' then 'portes' else excluded.motivo end, encolado_at = now(), siguiente_at = now();
$$;
