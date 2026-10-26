-- Sin saldo en Anthropic (David, 2026-10-26): Anthropic no da el saldo por API y David lo mira a mano. Si una llamada
-- contesta que no hay saldo, el trabajador pausa todas las tandas con el motivo (paused_reason) y el producto vuelve a
-- la cola sin gastar intento.

alter table public.mhd_importer_jobs add column paused_reason text;

-- Pausa todas las tandas activas con un motivo. Devuelve cuántas.
create or replace function public.mhd_importer_pause_all(p_reason text)
returns integer language sql security definer set search_path = public as $$
  with paused as (
    update public.mhd_importer_jobs set status = 'pausado', paused_reason = p_reason where status in ('en_cola', 'en_curso') returning 1
  ) select count(*)::integer from paused;
$$;
revoke all on function public.mhd_importer_pause_all(text) from public, anon, authenticated;
grant execute on function public.mhd_importer_pause_all(text) to service_role;
