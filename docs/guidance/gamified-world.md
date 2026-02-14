# Feature Guidance: Gamified Learning World Overlay

This document defines the target architecture for a gamified learning "world" in Pika.
It extends issue #205 from a pet-only tab into a persistent world overlay that runs across the student app.

---

## Vision

Create a calm, encouraging game layer that rewards real learning behavior:
- attendance/presence
- on-time assignment submission
- sustained consistency (streaks)
- progress through the course

The world is always present for students as an overlay and evolves over time, similar to a Tamagotchi-style ecosystem rather than a one-off reward screen.

---

## Product Principles

- Encourage consistency, not competition
- No public leaderboards or shaming mechanics
- Positive-only progression (no XP loss)
- Predictable, explainable rewards
- School-safe visuals and language
- Optional/low-distraction overlay controls

---

## Confirmed Decisions (2026-02-14)

1. **World scope**: one world per student per classroom (not global across all classes).
2. **Streak policy**: strict reset behavior (no grace window for MVP).
3. **Overlay behavior**: overlay is student-dismissible and supports interactive "care" actions (for example: clicking Pika, clearing small mess events) when enabled.
4. **Cadence model**: time-based scheduling first (daily + weekly cycles) to generalize across all courses.
5. **Daily schedule**: create daily world events at `05:00` in `America/Toronto`.
6. **Daily claim behavior**: hybrid; event is created on schedule and can be claimed on the student's next login that same Toronto day; unclaimed daily events expire at Toronto midnight.
7. **Weekly schedule**: weekly world evaluation runs on Friday (`America/Toronto`).
8. **Weekly attendance scoring**: use attendance ratio (`x/y`) in the evaluation window; do not use attendance streak as a weekly score signal.

---

## Core Experience Model

### 1) World Overlay (Student App-Wide)

- A lightweight overlay sits above student views (`/classrooms`, student dashboard, assignment flows).
- Overlay is non-blocking by default (`pointer-events: none`) and can enter interactive mode for care tasks.
- Student can disable/re-enable overlay at any time.
- Teacher views never render the overlay.

### 2) Game Loop

- Student performs real academic actions.
- App emits world events.
- World engine grants rewards and updates world state.
- Overlay reflects new state (progress, unlocks, animations).

### 3) Pika Companion Unlock

- Rule: when a student logs in on 3 consecutive days, unlock Pika companion.
- Pika can appear in the overlay world and idle/react to progress events.

---

## Lightweight Feasibility Constraints

Because world scope is per classroom, runtime must stay very light:

- Keep world state minimal (`learner_worlds` row + small unlock/event deltas).
- Use static or CSS-driven animations first; avoid heavy canvas/game loops for MVP.
- Gate active animation/mischief while student is typing in high-focus editors.
- Cap concurrent interactive objects (for example, max 1 active mischief event at a time).

---

## Reward Sources (MVP)

| Behavior | Event | Reward Type |
|---|---|---|
| Present/attendance complete | `attendance.present` | XP + world vitality |
| Assignment submitted on time | `assignment.submitted_on_time` | XP + building progress |
| Assignment submitted late | `assignment.submitted_late` | Smaller XP |
| Login streak day | `auth.login_streak_day` | Streak progress |
| 3-day login streak | `companion.pika_unlocked` | Companion unlock |
| Course milestone reached | `course.progress_milestone` | World biome/structure unlock |

---

## Cadence-First Model

For each classroom world (example: Feb->Jun course season), use fixed time windows:

- **Daily cadence** (05:00 Toronto): spawn one lightweight rotating care event.
- **Weekly cadence** (Friday Toronto): evaluate weekly achievements and emit a weekly world episode.
- **Season window**: only run cadence inside course season start/end.

Daily care rotation examples:
- fill water bowl
- tidy small mess
- greet/check-in with Pika

---

## World Interaction Layer (MVP)

In addition to XP events, the world can surface light interaction events:

- Pika can occasionally occupy UI space in overlay mode (for example, sit on a panel edge).
- Pika can create minor "mess" events that students clear with a simple click/tap.
- These events are dismissible and should never block core assignment/entry workflows.
- Interactions are motivational, not punitive: no grade impact, no XP loss.

---

## Weekly Episode Progression

Weekly episode quality is based on achievements since the previous Friday evaluation:

- baseline weekly event if no notable achievements
- nicer weekly event for mid-tier achievements
- special event for high-tier achievements

Candidate achievement signals:
- attendance ratio (`x/y`) where:
  - `x` = attended class days in window
  - `y` = scheduled class days in window
- submitted one or more assignments on time
- claimed daily care interactions across the week

High-tier weekly outcomes may advance a per-world event track (visual rarity/progression path).

---

## Event Tier Contract

`baseline` event:
- standard visual/animation variant
- common props only
- no rare unlock token

`nicer` event (upgraded):
- one premium modifier over baseline (rare skin OR rare prop OR special companion action)
- distinct event label and slightly richer presentation
- grants higher weekly track progress than baseline

`special` event:
- multiple premium modifiers (for example rare skin + rare prop + unique companion action)
- featured presentation treatment
- highest weekly track progress and optional unlock token

---

## Event Catalog Model

Drive event selection from data, not hardcoded UI logic.

Candidate table:

```sql
create table world_event_catalog (
  key text primary key,
  tier text not null check (tier in ('baseline', 'nicer', 'special')),
  category text not null check (category in ('daily_care', 'weekly_episode')),
  era_min text not null default 'seed',
  title text not null,
  description text not null,
  modifiers jsonb not null default '{}'::jsonb, -- props, animation tags, companion behavior
  weight integer not null default 100 check (weight > 0),
  cooldown_weeks integer not null default 0 check (cooldown_weeks >= 0),
  active boolean not null default true
);
```

MVP sample weekly episode catalog (12 entries):

- Baseline:
  - `wk_baseline_garden_tidy`
  - `wk_baseline_cozy_reading`
  - `wk_baseline_morning_stretch`
  - `wk_baseline_window_watch`
- Nicer:
  - `wk_nicer_lantern_evening`
  - `wk_nicer_picnic_setup`
  - `wk_nicer_rain_boots_day`
  - `wk_nicer_library_corner`
- Special:
  - `wk_special_starlight_parade`
  - `wk_special_harvest_celebration`
  - `wk_special_sky_bridge_visit`
  - `wk_special_founders_feast`

Selection policy:
- filter by weekly tier and era availability
- weighted random by `weight`
- apply cooldown to avoid short-term repeats

---

## Weekly Fairness Rules

- If `y = 0` scheduled class days in the window, attendance bucket is disabled for that week.
- If `due_assignments = 0` in the window, assignment bucket is disabled for that week.
- Weekly tiering should normalize to available opportunity buckets so students are never penalized for missing opportunities.

---

## Approved V1 Weekly Scoring Model (2026-02-14)

Weekly score buckets:

- Attendance ratio bucket: max `4` points
- On-time submissions bucket: max `3` points
- Daily care consistency bucket: max `3` points

Attendance ratio scoring (`x/y`):

- `x/y >= 0.90` -> `4`
- `x/y >= 0.75` -> `3`
- `x/y >= 0.50` -> `2`
- `x/y >= 0.25` -> `1`
- else -> `0`

On-time submissions scoring:

- `+1` per on-time submission
- capped at `3` points per week

Daily care consistency scoring (`claimed_days / eligible_days`):

- `>= 0.85` -> `3`
- `>= 0.60` -> `2`
- `>= 0.30` -> `1`
- else -> `0`

Normalization:

- `weekly_pct = earned_points / available_points`
- disabled buckets reduce `available_points` for that week

Weekly tier cutoffs:

- `baseline`: `weekly_pct < 0.40`
- `nicer`: `0.40 <= weekly_pct < 0.75`
- `special`: `weekly_pct >= 0.75`

Special-tier guard:

- `special` requires at least `2` enabled buckets in the week.

---

## Approved V1 Reward Matrix (2026-02-14)

Base XP events:

- `attendance.present` -> `+5 XP`
- `assignment.submitted_on_time` -> `+8 XP`
- `assignment.submitted_late` -> `+2 XP`
- `daily care claimed` -> `+3 XP`

Weekly tier bonus XP:

- `baseline` -> `+5 XP`
- `nicer` -> `+12 XP`
- `special` -> `+20 XP`

---

## Approved V1 Weekly Track Progression (2026-02-14)

Weekly track points:

- `baseline` -> `+0`
- `nicer` -> `+1`
- `special` -> `+2`

Track level advancement:

- every `4` track points advances `weekly_track_level` by `+1`

---

## World Progression

World progression should map to course progression, not raw grinding:

- **Course progress signal**: percentage of required work completed on time for the active course/classroom
- **World eras** (example): Seed -> Garden -> Village -> Observatory
- Each era unlocks background layers, decorations, and companion interactions

This keeps game state tied to learning outcomes.

---

## Technical Architecture

### Domain Layers

1. Event producers (existing API routes and server actions)
2. World engine (`src/lib/server/world-engine.ts`) with deterministic reducers
3. Persistence layer (world tables + idempotency)
4. Overlay delivery API (`GET /api/student/world`)
5. Client overlay runtime (`WorldOverlayProvider`)

### Event Producers (initial)

- `POST /api/auth/login` -> `auth.login`
- `POST /api/student/entries` -> `attendance.present` when applicable
- `POST /api/assignment-docs/[id]/submit` -> `assignment.submitted_on_time|late`
- Classroom/course stats recompute -> `course.progress_milestone`
- Overlay interaction events -> `world.interaction_*` (dismiss, clean, pet, etc.)

### World Engine Responsibilities

- Enforce reward rules and caps
- Maintain streaks
- Unlock companions and world assets
- Run scheduled daily/weekly evaluations
- Keep idempotency for retried requests
- Return diffs for UI celebrations (`newUnlocks`, `xpAwarded`, `worldLevelDelta`)

---

## Data Model (Proposed)

```sql
-- one world per student per classroom/course context
create table learner_worlds (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  classroom_id uuid not null references classrooms(id) on delete cascade,
  world_xp integer not null default 0 check (world_xp >= 0),
  world_level integer not null default 0 check (world_level >= 0),
  era_key text not null default 'seed',
  streak_days integer not null default 0 check (streak_days >= 0),
  pika_unlocked boolean not null default false,
  overlay_enabled boolean not null default true,
  season_start date,
  season_end date,
  next_daily_spawn_at timestamptz,
  next_weekly_eval_at timestamptz,
  weekly_track_level integer not null default 0 check (weekly_track_level >= 0),
  last_event_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, classroom_id)
);

create table world_events (
  id uuid primary key default gen_random_uuid(),
  learner_world_id uuid not null references learner_worlds(id) on delete cascade,
  event_type text not null,
  reward_xp integer not null default 0,
  reward_payload jsonb,
  event_day date not null,
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  unique (learner_world_id, idempotency_key)
);

create table world_unlocks (
  id uuid primary key default gen_random_uuid(),
  learner_world_id uuid not null references learner_worlds(id) on delete cascade,
  unlock_type text not null,   -- companion | structure | biome | decoration
  unlock_key text not null,
  unlocked_at timestamptz not null default now(),
  unique (learner_world_id, unlock_type, unlock_key)
);
```

Notes:
- Service-role access only (same pattern as existing pet tables).
- Use Toronto-local date boundaries for streak/day logic.
- Keep event log append-only for auditability and replay.
- Store all scheduled timestamps in UTC, derived from Toronto-local cadence rules.

---

## UI Integration

### App Integration

- Add `WorldOverlayProvider` in student shell layout.
- Fetch world snapshot once on app load and refresh after rewarding actions.
- Expose subtle toast/animation hooks for unlock moments.
- Add persistent student preference for overlay enable/disable.

### UX Guardrails

- Default to subtle animation and low visual noise.
- Offer quick controls: `Mute motion`, `Hide overlay`, `Show details`.
- Keep assignment/editor workflows readable (no overlap with text controls).
- If mischief appears over active work, provide one-click dismiss/resolve action.

---

## Rollout Plan

### Phase A: Event Foundation
- Introduce world schema + engine scaffolding
- Emit login/attendance/submission events
- Add idempotency and Toronto daily boundaries
- Add scheduled daily spawn + weekly evaluation jobs

### Phase B: Streak + Pika
- Implement 3-day streak unlock
- Render basic overlay with Pika idle behavior
- Add celebratory but brief unlock feedback
- Add first daily care rotation interaction (click Pika / clear mess / fill bowl)

### Phase C: Course-Driven World Growth
- Compute course milestones
- Unlock era transitions and world decorations
- Add world timeline/history panel

### Phase D: Polish
- Accessibility/motion preferences
- Performance optimization and caching
- Art pass and content tuning

---

## Testing Strategy

- Unit tests for reducers/streak logic/timezone boundaries
- Unit tests for cadence scheduler (05:00 daily + Friday weekly in Toronto, including DST changes)
- API tests for event emission and idempotency
- Integration tests for core journeys:
  - 3-day streak unlocks Pika exactly once
  - daily scheduled event can be claimed later same day and expires at Toronto midnight
  - Friday evaluation computes weekly tier from tracked achievements
  - on-time submission advances world state
  - late submission gives reduced reward
  - overlay off means no interaction rendering
  - active mischief can be resolved/dismissed in one click
- UI verification screenshots for student overlay states

---

## Rule Registry

Maintain all game rules in one place:

- Product rulebook: `docs/guidance/gamified-world-rules.md`
- Runtime constants (implementation target): `src/lib/world-rules.ts`

Rules should have stable IDs, idempotency keys, and Toronto-day semantics.

---

## Open Product Decisions

1. Mischief frequency/intensity limits during high-focus tasks
2. Teacher visibility: should teachers see a read-only world progress summary?
