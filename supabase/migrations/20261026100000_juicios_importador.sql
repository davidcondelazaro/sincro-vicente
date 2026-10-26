-- Juicios de los jueces automáticos del importador (2026-10-26). Dos jueces independientes (Claude y OpenAI) revisan
-- cada perfil de familia y sus dudas abiertas con el reglamento (mhd_importer_decisions, kind = 'regla') y los datos de
-- MHD. Cada llamada deja una fila por duda («duda:G20:136») y una por el perfil («perfil:G20», con los problemas del
-- perfil, el uso de tokens y el coste de toda la llamada). Si los dos coinciden, la duda se cierra en el registro; si no,
-- la ve David. Ver src/lib/mhd-importer/judges.ts y scripts/juzgar-familias.mjs.
create table public.mhd_importer_judgements (
  id bigint generated always as identity primary key,
  run_id uuid not null,                          -- una ejecución del script (juntas, las llamadas de los dos jueces)
  purpose text not null default 'juicio' check (purpose in ('juicio', 'calibracion')),
  decision_key text not null,                    -- clave de la duda en mhd_importer_decisions o «perfil:<familia>»
  family_code text not null,
  judge text not null check (judge in ('claude', 'openai')),
  model text not null,
  verdict jsonb not null,                        -- duda: {verdict, decision, rules, confidence, reason}; perfil: {problemas, resumen}
  usage jsonb,                                   -- solo en la fila del perfil: tokens de toda la llamada
  cost_usd numeric(10,4),                        -- solo en la fila del perfil: coste de toda la llamada (null si no hay precio)
  created_at timestamptz not null default now()
);
create index mhd_importer_judgements_key_idx on public.mhd_importer_judgements (decision_key, created_at desc);
create index mhd_importer_judgements_family_idx on public.mhd_importer_judgements (family_code, created_at desc);

alter table public.mhd_importer_judgements enable row level security;
create policy "Sesión: todo" on public.mhd_importer_judgements for all to authenticated using (true) with check (true);
grant select, insert, update, delete on table public.mhd_importer_judgements to authenticated, service_role;
