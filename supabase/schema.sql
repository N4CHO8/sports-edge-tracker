create extension if not exists pgcrypto;

create table if not exists public.refresh_runs (
  id uuid primary key default gen_random_uuid(),
  source text not null default 'manual',
  created_at timestamptz not null default now()
);

create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  source_event_id text not null,
  sport text not null check (sport in ('ufc', 'football', 'basketball')),
  league text,
  home_name text not null,
  away_name text not null,
  start_time timestamptz,
  status text not null default 'scheduled',
  source text not null default 'manual',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (sport, source, source_event_id)
);

create table if not exists public.odds_snapshots (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  source_event_id text not null,
  bookmaker text not null,
  market text not null,
  selection text not null,
  odds_decimal numeric(10, 3) not null check (odds_decimal > 1),
  captured_at timestamptz not null default now()
);

create index if not exists events_sport_start_time_idx
  on public.events (sport, start_time);

create index if not exists odds_snapshots_event_captured_idx
  on public.odds_snapshots (event_id, captured_at desc);

alter table public.refresh_runs enable row level security;
alter table public.events enable row level security;
alter table public.odds_snapshots enable row level security;

revoke all on table public.refresh_runs from anon, authenticated;
revoke all on table public.events from anon, authenticated;
revoke all on table public.odds_snapshots from anon, authenticated;

grant usage on schema public to service_role;
grant all on table public.refresh_runs to service_role;
grant all on table public.events to service_role;
grant all on table public.odds_snapshots to service_role;

grant usage, select on all sequences in schema public to service_role;
