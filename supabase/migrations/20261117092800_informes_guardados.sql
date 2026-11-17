-- Cada resumen enviado queda guardado (indicadores y secciones) para compararlo con el anterior y ver la evolución en
-- la página Resumen de utils (David, 2026-11-17).
create table if not exists public.mhd_daily_reports (
  id uuid primary key default gen_random_uuid(),
  period_hours int not null,
  period_start timestamptz not null,
  period_end timestamptz not null,
  subject text not null,
  kpis jsonb not null default '[]',
  sections jsonb not null default '[]',
  created_at timestamptz not null default now()
);
create index if not exists mhd_daily_reports_end on public.mhd_daily_reports (period_hours, period_end desc);
alter table public.mhd_daily_reports enable row level security;
create policy "mhd_daily_reports lectura" on public.mhd_daily_reports for select to authenticated using (true);
