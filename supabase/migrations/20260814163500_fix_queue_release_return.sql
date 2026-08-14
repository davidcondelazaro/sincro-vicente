create or replace function public.renew_price_stock_import_queue_message(p_import_type text, p_message_id bigint, p_visibility_timeout integer default 0)
returns boolean language plpgsql security definer set search_path = pg_catalog, public, pgmq
as $$ declare v_queue text; begin
  v_queue := case p_import_type when 'prices' then 'price_import_jobs' when 'stock' then 'stock_import_jobs' else null end;
  if v_queue is null then raise exception 'Tipo no válido'; end if;
  perform pgmq.set_vt(v_queue, p_message_id, greatest(0, least(p_visibility_timeout, 900)));
  return true;
end; $$;
