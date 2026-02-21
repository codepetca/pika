-- Migration: Add pet gamification system for Pika
-- Creates tables for user_pets, pet_unlocks, xp_events, and pet_rewards

-- ============================================================================
-- 1. Create user_pets table (one per student per classroom)
-- ============================================================================
create table if not exists public.user_pets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  classroom_id uuid not null references public.classrooms (id) on delete cascade,
  xp integer not null default 0,
  selected_image integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, classroom_id)
);

-- Indexes for user_pets
create index if not exists idx_user_pets_user_id on public.user_pets (user_id);
create index if not exists idx_user_pets_classroom_id on public.user_pets (classroom_id);

-- Updated_at trigger for user_pets
create or replace function public.update_user_pets_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists update_user_pets_updated_at on public.user_pets;
create trigger update_user_pets_updated_at
  before update on public.user_pets
  for each row
  execute function public.update_user_pets_updated_at();

-- ============================================================================
-- 2. Create pet_unlocks table (tracks unlocked images per pet)
-- ============================================================================
create table if not exists public.pet_unlocks (
  id uuid primary key default gen_random_uuid(),
  pet_id uuid not null references public.user_pets (id) on delete cascade,
  image_index integer not null check (image_index >= 0 and image_index <= 10),
  unlocked_at timestamptz not null default now(),
  unique (pet_id, image_index)
);

-- Index for pet_unlocks
create index if not exists idx_pet_unlocks_pet_id on public.pet_unlocks (pet_id);

-- ============================================================================
-- 3. Create xp_events table (audit log)
-- ============================================================================
create table if not exists public.xp_events (
  id uuid primary key default gen_random_uuid(),
  pet_id uuid not null references public.user_pets (id) on delete cascade,
  source text not null,
  xp_amount integer not null,
  metadata jsonb,
  created_at timestamptz not null default now()
);

-- Composite index for daily cap queries
create index if not exists idx_xp_events_pet_source_created
  on public.xp_events (pet_id, source, created_at);

-- ============================================================================
-- 4. Create pet_rewards table (future non-XP rewards)
-- ============================================================================
create table if not exists public.pet_rewards (
  id uuid primary key default gen_random_uuid(),
  pet_id uuid not null references public.user_pets (id) on delete cascade,
  reward_type text not null,
  reward_key text not null,
  metadata jsonb,
  granted_at timestamptz not null default now(),
  unique (pet_id, reward_type, reward_key)
);

-- Index for pet_rewards
create index if not exists idx_pet_rewards_pet_id on public.pet_rewards (pet_id);

-- ============================================================================
-- 5. RLS Policies
-- Defense-in-depth: The app uses service role client for all pet operations,
-- so these restrictive policies prevent any direct client access.
-- ============================================================================
alter table public.user_pets enable row level security;
alter table public.pet_unlocks enable row level security;
alter table public.xp_events enable row level security;
alter table public.pet_rewards enable row level security;

-- user_pets: service-role-only access
create policy "Service role only access for user_pets"
  on public.user_pets for all
  using (false);

-- pet_unlocks: service-role-only access
create policy "Service role only access for pet_unlocks"
  on public.pet_unlocks for all
  using (false);

-- xp_events: service-role-only access
create policy "Service role only access for xp_events"
  on public.xp_events for all
  using (false);

-- pet_rewards: service-role-only access
create policy "Service role only access for pet_rewards"
  on public.pet_rewards for all
  using (false);
