alter table public.price_stock_import_runs drop constraint if exists price_stock_import_runs_mode_check;
alter table public.price_stock_import_runs add constraint price_stock_import_runs_mode_check check (mode in ('changes','all','selective','partial'));
create or replace function public.start_price_stock_import(p_import_type text, p_mode text, p_filters jsonb default '{}'::jsonb)
returns public.price_stock_import_runs language plpgsql security definer set search_path = pg_catalog, public, pgmq as $$
declare v_owner_id uuid := (select auth.uid()); v_filters jsonb := coalesce(p_filters, '{}'::jsonb); v_since timestamptz; v_total integer; v_run public.price_stock_import_runs; v_message_id bigint; v_ids text[]; v_queue text;
begin
 if v_owner_id is null then raise exception 'Necesitas iniciar sesión'; end if;
 if p_import_type not in ('prices','stock') then raise exception 'Tipo de importación no válido'; end if;
 if p_mode not in ('changes','all','selective','partial') or (p_mode='changes' and p_import_type <> 'prices') then raise exception 'Modo de importación no válido'; end if;
 v_filters := coalesce(p_filters,'{}'::jsonb); v_ids := array(select jsonb_array_elements_text(coalesce(v_filters->'productIds','[]'::jsonb)));
 if p_mode='selective' and coalesce(array_length(v_ids,1),0)=0 then raise exception 'Indica al menos un ID de producto'; end if;
 if p_mode='partial' then select started_at into v_since from public.price_stock_import_runs where import_type=p_import_type and mode in ('all','partial') and status='completed' order by started_at desc limit 1; if v_since is null then raise exception 'Antes de una actualización parcial debes finalizar una completa o parcial'; end if; v_filters:=v_filters||jsonb_build_object('changedSince',v_since); end if;
 if p_import_type='prices' then
   select count(*) into v_total from public.source_prices s join public.source_products p on p.id=s.id_product and p.active is true join public.product_shopify_links l on l.source_sku=s.id_product and l.link_status='linked' where (p_mode<>'changes' or s.shopify_synced is false) and (p_mode<>'selective' or s.id_product=any(v_ids)) and (p_mode<>'partial' or s.fecha_modif>=to_char(v_since at time zone 'Europe/Madrid','YYYY-MM-DD HH24:MI:SS.MS')); v_queue:='price_import_jobs';
 else
   select count(*) into v_total from public.source_stock s join public.source_products p on p.id=s.id_product and p.active is true join public.product_shopify_links l on l.source_sku=s.id_product and l.link_status='linked' where (p_mode<>'selective' or s.id_product=any(v_ids)) and (p_mode<>'partial' or s.last_mod_date>=to_char(v_since at time zone 'Europe/Madrid','YYYY-MM-DD HH24:MI:SS.MS')); v_queue:='stock_import_jobs';
 end if;
 if v_total=0 then raise exception 'No hay registros válidos para el criterio indicado'; end if;
 insert into public.price_stock_import_runs(owner_id,import_type,mode,filters,total_count) values(v_owner_id,p_import_type,p_mode,v_filters,v_total) returning * into v_run;
 select * into v_message_id from pgmq.send(v_queue,jsonb_build_object('run_id',v_run.id)); update public.price_stock_import_runs set queue_message_id=v_message_id where id=v_run.id returning * into v_run; return v_run;
end; $$;;
