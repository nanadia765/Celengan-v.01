-- Jalankan seluruh file ini di Supabase Dashboard -> SQL Editor -> New query -> Run

create extension if not exists "pgcrypto";

create table if not exists public.user_state (
  user_id uuid references auth.users(id) on delete cascade primary key,
  balance integer not null default 0,
  goal_name text not null default '',
  goal_target integer not null default 0,
  streak integer not null default 0,
  allowance integer not null default 0,
  alloc_tabung integer not null default 0,
  alloc_jajan integer not null default 0,
  alloc_sedekah integer not null default 0,
  proj_target integer not null default 0,
  proj_weekly integer not null default 0,
  proj_daily integer not null default 0,
  goal_photo text,
  profile_photo text,
  goal_items jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.user_state add column if not exists goal_photo text;
alter table public.user_state add column if not exists profile_photo text;
alter table public.user_state add column if not exists goal_items jsonb not null default '[]'::jsonb;
alter table public.user_state alter column balance set default 0;
alter table public.user_state alter column goal_name set default '';
alter table public.user_state alter column goal_target set default 0;
alter table public.user_state alter column streak set default 0;
alter table public.user_state alter column allowance set default 0;
alter table public.user_state alter column alloc_tabung set default 0;
alter table public.user_state alter column alloc_jajan set default 0;
alter table public.user_state alter column alloc_sedekah set default 0;
alter table public.user_state alter column proj_target set default 0;
alter table public.user_state alter column proj_weekly set default 0;
alter table public.user_state alter column proj_daily set default 0;

create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  username text not null check (username ~ '^[a-z0-9_]{3,20}$'),
  profile_photo text,
  created_at timestamptz not null default now()
);

alter table public.profiles add column if not exists profile_photo text;

create unique index if not exists profiles_username_lower_unique
  on public.profiles (lower(username));

create table if not exists public.friend_requests (
  id uuid primary key default gen_random_uuid(),
  from_user uuid not null references auth.users(id) on delete cascade,
  to_user uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  created_at timestamptz not null default now(),
  constraint friend_requests_not_self check (from_user <> to_user)
);

create unique index if not exists friend_requests_one_active_pair
  on public.friend_requests (least(from_user, to_user), greatest(from_user, to_user))
  where status in ('pending', 'accepted');

create or replace function public.prevent_friend_request_identity_change()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.id is distinct from old.id
    or new.from_user is distinct from old.from_user
    or new.to_user is distinct from old.to_user
    or new.created_at is distinct from old.created_at then
    raise exception 'Friend request participants and identity cannot be changed';
  end if;
  return new;
end;
$$;

drop trigger if exists friend_request_identity_immutable on public.friend_requests;
create trigger friend_request_identity_immutable
  before update on public.friend_requests
  for each row execute function public.prevent_friend_request_identity_change();

alter table public.profiles enable row level security;
alter table public.friend_requests enable row level security;

drop policy if exists "Authenticated users can search usernames" on public.profiles;
drop policy if exists "Users can view connected profiles" on public.profiles;
create policy "Users can view connected profiles"
  on public.profiles for select to authenticated
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.friend_requests request
      where request.status in ('pending', 'accepted')
        and ((request.from_user = auth.uid() and request.to_user = profiles.user_id)
          or (request.to_user = auth.uid() and request.from_user = profiles.user_id))
    )
  );

drop policy if exists "Users manage their own profile" on public.profiles;
create policy "Users manage their own profile"
  on public.profiles for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create or replace function public.search_profiles(search_term text)
returns table (user_id uuid, username text)
language sql
stable
security definer
set search_path = public
as $$
  select profile.user_id, profile.username
  from public.profiles profile
  where auth.uid() is not null
    and profile.user_id <> auth.uid()
    and length(trim(search_term)) >= 3
    and profile.username ilike '%' || trim(search_term) || '%'
  limit 12;
$$;

revoke all on function public.search_profiles(text) from public;
grant execute on function public.search_profiles(text) to authenticated;

drop policy if exists "Participants can view friend requests" on public.friend_requests;
create policy "Participants can view friend requests"
  on public.friend_requests for select to authenticated
  using (auth.uid() = from_user or auth.uid() = to_user);

drop policy if exists "Users can send friend requests" on public.friend_requests;
create policy "Users can send friend requests"
  on public.friend_requests for insert to authenticated
  with check (auth.uid() = from_user and status = 'pending');

drop policy if exists "Recipients can respond to friend requests" on public.friend_requests;
create policy "Recipients can respond to friend requests"
  on public.friend_requests for update to authenticated
  using (auth.uid() = to_user and status = 'pending')
  with check (auth.uid() = to_user and status in ('accepted', 'declined'));

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

drop policy if exists "Users manage their own state" on public.user_state;
create policy "Users manage their own state"
  on public.user_state for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users manage their own transactions" on public.transactions;
create policy "Users manage their own transactions"
  on public.transactions for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
