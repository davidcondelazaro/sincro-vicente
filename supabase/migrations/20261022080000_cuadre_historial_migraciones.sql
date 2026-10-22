-- Cuadre del historial de migraciones (2026-10-22).
--
-- Producción ya tiene todo esto: se aplicó en agosto fuera del historial de
-- migraciones. Esta migración solo sirve para que una base nueva (local o de
-- pruebas) creada desde las migraciones quede igual que producción. En
-- producción se marca como aplicada con `supabase migration repair`, sin
-- ejecutarla. Es idempotente.

-- Antes en 20260814170000_price_queue_successor_messages.sql (nunca registrada).
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

-- Entidades admitidas en las importaciones de SQL Server, tal como están en producción.
alter table public.catalog_import_events drop constraint if exists catalog_import_events_entity_type_check;
alter table public.catalog_import_events add constraint catalog_import_events_entity_type_check
  check (entity_type = any (array['manufacturers','categories','features','products','priorities','icecat']));
alter table public.catalog_import_runs drop constraint if exists catalog_import_runs_entity_type_check;
alter table public.catalog_import_runs add constraint catalog_import_runs_entity_type_check
  check (entity_type = any (array['manufacturers','categories','features','products','priorities','icecat']));
