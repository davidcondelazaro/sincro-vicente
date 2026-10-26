-- Registro de decisiones del importador de productos MHD (2026-10-26). Cada regla general y cada duda de los perfiles
-- queda con su pregunta, la recomendación, la decisión, quién la tomó y por qué. Sirve para no volver a preguntar lo
-- mismo, para que los jueces automáticos apliquen las reglas y para calibrarlos con las decisiones de David.
-- Ver docs/DECISIONES_IMPORTADOR.md.
create table public.mhd_importer_decisions (
  key text primary key,                          -- «regla:mhd-manda», «duda:G20:139»…
  kind text not null check (kind in ('regla', 'duda')),
  scope text not null,                           -- «catalogo» o el código de la familia
  question text not null,
  recommendation text,                           -- la del borrador (dudas)
  route text check (route in ('regla', 'jueces', 'codigo', 'producto', 'negocio')), -- quién la resuelve (dudas)
  status text not null default 'abierta' check (status in ('abierta', 'cerrada')),
  decision text,
  reason text,
  rule_key text references public.mhd_importer_decisions (key),   -- regla que la resuelve
  contradicts_draft boolean not null default false,               -- la decisión va contra la recomendación del borrador
  decided_by text,                               -- «David», «regla», «jueces»…
  decided_at timestamptz,
  created_at timestamptz not null default now()
);
create index mhd_importer_decisions_scope_idx on public.mhd_importer_decisions (scope, status);

alter table public.mhd_importer_decisions enable row level security;
create policy "Sesión: todo" on public.mhd_importer_decisions for all to authenticated using (true) with check (true);
grant select, insert, update, delete on table public.mhd_importer_decisions to authenticated, service_role;
