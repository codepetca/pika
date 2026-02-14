-- Migration: World overlay foundation for issue #205
-- Extends pet gamification into a scheduled per-classroom world system.

-- ============================================================================
-- 1) Extend user_pets with world state fields
-- ============================================================================
alter table public.user_pets
  add column if not exists overlay_enabled boolean not null default true,
  add column if not exists streak_days integer not null default 0 check (streak_days >= 0),
  add column if not exists last_login_day date,
  add column if not exists season_start date,
  add column if not exists season_end date,
  add column if not exists next_daily_spawn_at timestamptz,
  add column if not exists next_weekly_eval_at timestamptz,
  add column if not exists weekly_track_level integer not null default 0 check (weekly_track_level >= 0),
  add column if not exists weekly_track_points integer not null default 0 check (weekly_track_points >= 0);

-- ============================================================================
-- 2) Daily world events (scheduled care interactions)
-- ============================================================================
create table if not exists public.world_daily_events (
  id uuid primary key default gen_random_uuid(),
  pet_id uuid not null references public.user_pets (id) on delete cascade,
  event_day date not null,
  event_key text not null,
  status text not null check (status in ('claimable', 'claimed', 'expired')),
  claimable_until timestamptz not null,
  claimed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (pet_id, event_day)
);

create index if not exists idx_world_daily_events_pet_id on public.world_daily_events (pet_id);
create index if not exists idx_world_daily_events_status_day on public.world_daily_events (status, event_day);

-- ============================================================================
-- 3) Weekly world evaluation snapshots
-- ============================================================================
create table if not exists public.world_weekly_results (
  id uuid primary key default gen_random_uuid(),
  pet_id uuid not null references public.user_pets (id) on delete cascade,
  eval_week_start date not null,
  eval_week_end date not null,
  attendance_points integer not null default 0 check (attendance_points >= 0),
  assignment_points integer not null default 0 check (assignment_points >= 0),
  care_points integer not null default 0 check (care_points >= 0),
  earned_points integer not null default 0 check (earned_points >= 0),
  available_points integer not null default 0 check (available_points >= 0),
  weekly_pct numeric(5,4) not null default 0,
  tier text not null check (tier in ('baseline', 'nicer', 'special')),
  event_key text,
  bonus_xp integer not null default 0 check (bonus_xp >= 0),
  track_points_awarded integer not null default 0 check (track_points_awarded >= 0),
  details jsonb,
  created_at timestamptz not null default now(),
  unique (pet_id, eval_week_start)
);

create index if not exists idx_world_weekly_results_pet_id on public.world_weekly_results (pet_id);
create index if not exists idx_world_weekly_results_week on public.world_weekly_results (eval_week_start, eval_week_end);

-- ============================================================================
-- 4) Event catalog (daily + weekly selectable world events)
-- ============================================================================
create table if not exists public.world_event_catalog (
  key text primary key,
  tier text not null check (tier in ('baseline', 'nicer', 'special')),
  category text not null check (category in ('daily_care', 'weekly_episode')),
  era_min text not null default 'seed',
  title text not null,
  description text not null,
  modifiers jsonb not null default '{}'::jsonb,
  weight integer not null default 100 check (weight > 0),
  cooldown_weeks integer not null default 0 check (cooldown_weeks >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists idx_world_event_catalog_active on public.world_event_catalog (category, tier, active);

insert into public.world_event_catalog
  (key, tier, category, era_min, title, description, modifiers, weight, cooldown_weeks, active)
values
  ('daily_fill_water_bowl', 'baseline', 'daily_care', 'seed', 'Fill Water Bowl', 'Refresh Pika''s water bowl for the day.', '{"interaction":"fill_bowl"}', 100, 0, true),
  ('daily_tidy_mess', 'baseline', 'daily_care', 'seed', 'Tidy Tiny Mess', 'Clean up a tiny classroom mess from Pika.', '{"interaction":"clean_mess"}', 100, 0, true),
  ('daily_greet_pika', 'baseline', 'daily_care', 'seed', 'Morning Greeting', 'Say hello to Pika and start the day.', '{"interaction":"greet"}', 100, 0, true),

  ('wk_baseline_garden_tidy', 'baseline', 'weekly_episode', 'seed', 'Garden Tidy', 'Pika straightens up the tiny garden path.', '{"scene":"garden_tidy"}', 100, 1, true),
  ('wk_baseline_cozy_reading', 'baseline', 'weekly_episode', 'seed', 'Cozy Reading', 'Pika reads by the window with warm tea.', '{"scene":"cozy_reading"}', 100, 1, true),
  ('wk_baseline_morning_stretch', 'baseline', 'weekly_episode', 'seed', 'Morning Stretch', 'Pika starts the day with a cheerful stretch.', '{"scene":"morning_stretch"}', 100, 1, true),
  ('wk_baseline_window_watch', 'baseline', 'weekly_episode', 'seed', 'Window Watch', 'Pika watches the clouds drift by.', '{"scene":"window_watch"}', 100, 1, true),

  ('wk_nicer_lantern_evening', 'nicer', 'weekly_episode', 'garden', 'Lantern Evening', 'Pika lights a tiny lantern at dusk.', '{"scene":"lantern_evening","modifier":"rare_prop"}', 100, 1, true),
  ('wk_nicer_picnic_setup', 'nicer', 'weekly_episode', 'garden', 'Picnic Setup', 'Pika arranges a tiny picnic blanket.', '{"scene":"picnic_setup","modifier":"rare_prop"}', 100, 1, true),
  ('wk_nicer_rain_boots_day', 'nicer', 'weekly_episode', 'garden', 'Rain Boots Day', 'Pika splashes through puddles in tiny boots.', '{"scene":"rain_boots_day","modifier":"special_action"}', 100, 1, true),
  ('wk_nicer_library_corner', 'nicer', 'weekly_episode', 'garden', 'Library Corner', 'Pika finds a bright reading nook.', '{"scene":"library_corner","modifier":"rare_skin"}', 100, 1, true),

  ('wk_special_starlight_parade', 'special', 'weekly_episode', 'village', 'Starlight Parade', 'Pika leads a tiny lantern parade under stars.', '{"scene":"starlight_parade","modifier":"featured"}', 100, 2, true),
  ('wk_special_harvest_celebration', 'special', 'weekly_episode', 'village', 'Harvest Celebration', 'Pika hosts a cozy harvest celebration.', '{"scene":"harvest_celebration","modifier":"featured"}', 100, 2, true),
  ('wk_special_sky_bridge_visit', 'special', 'weekly_episode', 'observatory', 'Sky Bridge Visit', 'Pika crosses a glowing sky bridge.', '{"scene":"sky_bridge_visit","modifier":"featured"}', 100, 2, true),
  ('wk_special_founders_feast', 'special', 'weekly_episode', 'observatory', 'Founders'' Feast', 'Pika throws a festive classroom feast.', '{"scene":"founders_feast","modifier":"featured"}', 100, 2, true)
on conflict (key) do nothing;

-- ============================================================================
-- 5) Defense-in-depth RLS: service-role-only
-- ============================================================================
alter table public.world_daily_events enable row level security;
alter table public.world_weekly_results enable row level security;
alter table public.world_event_catalog enable row level security;

create policy "Service role only access for world_daily_events"
  on public.world_daily_events for all
  using (false);

create policy "Service role only access for world_weekly_results"
  on public.world_weekly_results for all
  using (false);

create policy "Service role only access for world_event_catalog"
  on public.world_event_catalog for all
  using (false);
