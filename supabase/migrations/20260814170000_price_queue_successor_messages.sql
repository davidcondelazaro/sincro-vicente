create or replace function public.enqueue_next_price_stock_import_message(p_import_type text, p_run_id uuid, p_message_id bigint)
returns bigint language plpgsql security definer set search_path = pg_catalog, public, pgmq
as $$ declare v_queue text; v_next_message_id bigint; begin
  if coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role' then raise exception 'Acceso no autorizado'; end if;
  v_queue := case p_import_type when 'prices' then 'price_import_jobs' when 'stock' then 'stock_import_jobs' else null end;
  if v_queue is null then raise exception 'Tipo no válido'; end if;
  select * into v_next_message_id from pgmq.send(v_queue, jsonb_build_object('run_id', p_run_id));
  update public.price_stock_import_runs set queue_message_id = v_next_message_id, status = 'queued', updated_at = now() where id = p_run_id;
  perform pgmq.archive(v_queue, p_message_id);
  return v_next_message_id;
end; $$;
revoke all on function public.enqueue_next_price_stock_import_message(text,uuid,bigint) from public,anon,authenticated;
grant execute on function public.enqueue_next_price_stock_import_message(text,uuid,bigint) to service_role;
