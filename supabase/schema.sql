-- Jalankan seluruh file ini di Supabase Dashboard -> SQL Editor -> New query -> Run

create extension if not exists "pgcrypto";

create table if not exists public.user_state (
  user_id uuid references auth.users(id) on delete cascade primary key,
  balance integer not null default 42000,
  goal_name text not null default 'Sepatu Roda Baru',
  goal_target integer not null default 75000,
  streak integer not null default 12,
  allowance integer not null default 20000,
  alloc_tabung integer not null default 50,
  alloc_jajan integer not null default 30,
  alloc_sedekah integer not null default 20,
  proj_target integer not null default 450000,
  proj_weekly integer not null default 50000,
  proj_daily integer not null default 5000,
  updated_at timestamptz not null default now()
);

create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  date_label text not null,
  description text not null,
  amount integer not null,
  type text not null check (type in ('in','out')),
  category text,
  created_at timestamptz not null default now()
);

alter table public.user_state enable row level security;
alter table public.transactions enable row level security;

create policy "Users manage their own state"
  on public.user_state for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users manage their own transactions"
  on public.transactions for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
