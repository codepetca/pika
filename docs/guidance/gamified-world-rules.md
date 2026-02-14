# Gamified World Rulebook (MVP)

This file is the authoritative product rule list for the gamified world.
Implementation should mirror these rules in `src/lib/world-rules.ts` using stable rule IDs.

All date/day boundaries use `America/Toronto`.

---

## Global Cadence Defaults (MVP)

- Daily world event spawn time: `05:00` Toronto local time.
- Weekly world evaluation time: Friday in Toronto local time.
- Daily claim policy: hybrid same-day claim window (expires at Toronto midnight).
- Cadence automation is global (no teacher configuration required).
- Weekly attendance uses ratio scoring (`x/y`) instead of attendance streak scoring.
- Weekly episode tiers:
  - `baseline`: standard event
  - `nicer`: upgraded event (one premium modifier)
  - `special`: featured event (multiple premium modifiers)

---

## Approved V1 Scoring Constants (2026-02-14)

Weekly bucket maximums:

- attendance ratio bucket: `4`
- on-time submissions bucket: `3`
- daily care consistency bucket: `3`

Attendance ratio thresholds (`x/y`):

- `>= 0.90` -> `4`
- `>= 0.75` -> `3`
- `>= 0.50` -> `2`
- `>= 0.25` -> `1`
- else -> `0`

On-time submissions scoring:

- `+1` per on-time submission
- cap `3` per weekly window

Daily care consistency thresholds (`claimed_days / eligible_days`):

- `>= 0.85` -> `3`
- `>= 0.60` -> `2`
- `>= 0.30` -> `1`
- else -> `0`

Tier thresholds (on `weekly_pct = earned_points / available_points`):

- `baseline`: `< 0.40`
- `nicer`: `>= 0.40` and `< 0.75`
- `special`: `>= 0.75`

Special-tier guard:

- `special` requires at least `2` enabled opportunity buckets.

Base XP matrix:

- `attendance.present` -> `+5 XP`
- `assignment.submitted_on_time` -> `+8 XP`
- `assignment.submitted_late` -> `+2 XP`
- `daily care claimed` -> `+3 XP`

Weekly tier bonus XP:

- `baseline` -> `+5 XP`
- `nicer` -> `+12 XP`
- `special` -> `+20 XP`

Weekly track points:

- `baseline` -> `+0`
- `nicer` -> `+1`
- `special` -> `+2`

Track level advancement:

- every `4` accumulated weekly track points -> `weekly_track_level +1`

---

## Rule Format

- `rule_id`: stable identifier
- `scope`: per-student-per-classroom unless specified
- `trigger`: event that evaluates the rule
- `condition`: required state
- `effect`: world update and rewards
- `idempotency`: duplicate-event prevention strategy

---

## Rules

### `RW_DAILY_EVENT_SPAWN_0500_TORONTO`

- scope: student + classroom world
- trigger: scheduler tick
- condition:
  - world is within season window (`season_start`/`season_end`, if set)
  - no daily event already spawned for current Toronto day
- effect:
  - create one daily care event from rotation (for example `fill_water_bowl`, `tidy_mess`, `greet_pika`)
  - mark event as claimable until Toronto midnight
- idempotency: key includes `learner_world_id`, `event_day`, `daily_spawn`

### `RW_DAILY_EVENT_CLAIM_HYBRID`

- scope: student + classroom world
- trigger: eligible student login / app open
- condition:
  - claimable daily event exists for current Toronto day
  - event not already claimed
- effect:
  - mark daily event claimed
  - apply associated reward/state change
- idempotency: key includes active daily event ID + `claim`

### `RW_DAILY_EVENT_EXPIRE_AT_MIDNIGHT`

- scope: student + classroom world
- trigger: scheduler tick / lazy expiry check
- condition:
  - claimable daily event exists
  - Toronto date has rolled past event day
- effect:
  - mark event expired and unclaimable
- idempotency: key includes active daily event ID + `expire`

### `RW_WEEKLY_EVAL_FRIDAY`

- scope: student + classroom world
- trigger: Friday scheduler run (Toronto)
- condition:
  - evaluation not already run for the current evaluation week
  - world in season window
- effect:
  - aggregate achievements since last weekly eval
  - compute attendance ratio bucket from class-day opportunity (`x/y`)
  - compute assignment bucket from on-time submissions (disabled if no due assignments in window)
  - compute daily care consistency bucket
  - assign weekly tier (`baseline` | `nicer` | `special`)
  - emit weekly episode and optional track advancement
- idempotency: key includes `learner_world_id`, `eval_week_start`, `weekly_eval`

### `RW_WEEKLY_TIER_ASSIGNMENT`

- scope: student + classroom world
- trigger: weekly evaluation
- condition: weekly score computed after opportunity normalization
- effect:
  - assign `baseline` / `nicer` / `special` tier using approved V1 threshold table
  - enforce special-tier guard (requires >= 2 enabled buckets)
  - persist weekly score components and resolved tier
- idempotency: tied to weekly evaluation key

### `RW_WEEKLY_EVENT_PICK_FROM_CATALOG`

- scope: student + classroom world
- trigger: weekly tier assigned
- condition:
  - event catalog contains active rows for resolved tier
  - event satisfies current world era and cooldown constraints
- effect:
  - select one event using weighted random from allowed catalog rows
  - store selected `event_key` in weekly result
- idempotency: tied to weekly evaluation key

### `RW_WEEKLY_ATTENDANCE_RATIO_BUCKET`

- scope: student + classroom world
- trigger: weekly evaluation
- condition: class-day opportunities exist in the window
- effect:
  - compute `x = attended_days`, `y = scheduled_class_days`
  - assign points from `x/y` ratio using global thresholds
- idempotency: tied to weekly evaluation key

### `RW_WEEKLY_ATTENDANCE_NO_OPPORTUNITY`

- scope: student + classroom world
- trigger: weekly evaluation
- condition: `y = 0` scheduled class days in window
- effect: disable attendance bucket for this weekly score calculation
- idempotency: tied to weekly evaluation key

### `RW_WEEKLY_ASSIGNMENT_NO_OPPORTUNITY`

- scope: student + classroom world
- trigger: weekly evaluation
- condition: `due_assignments = 0` in window
- effect: disable assignment bucket for this weekly score calculation
- idempotency: tied to weekly evaluation key

### `RW_LOGIN_STREAK_INCREMENT`

- scope: student + classroom world
- trigger: successful student login (`auth.login`)
- condition: first qualifying login event for current Toronto day
- effect: increment `streak_days` by 1
- idempotency: key includes `user_id`, `classroom_id`, `event_day`, `auth.login`

### `RW_LOGIN_STREAK_RESET_STRICT`

- scope: student + classroom world
- trigger: successful student login (`auth.login`)
- condition: previous streak day is not exactly yesterday (Toronto date)
- effect: reset streak to 1 for current day (strict reset, no grace)
- idempotency: same daily login key as streak increment logic

### `RW_UNLOCK_PIKA_AT_3_DAY_STREAK`

- scope: student + classroom world
- trigger: streak update
- condition: `streak_days >= 3` and `pika_unlocked = false`
- effect: set `pika_unlocked = true`; insert unlock event
- idempotency: unique unlock key `companion:pika`

### `RW_ATTENDANCE_PRESENT_REWARD`

- scope: student + classroom world
- trigger: attendance present event (`attendance.present`)
- condition: first present credit for the classroom on that Toronto day
- effect: grant `+5 XP` and world vitality increment
- idempotency: key includes `user_id`, `classroom_id`, `event_day`, `attendance.present`

### `RW_ASSIGNMENT_SUBMIT_ON_TIME_REWARD`

- scope: student + classroom world
- trigger: assignment submit event (`assignment.submitted_on_time`)
- condition: submission timestamp <= assignment due timestamp
- effect: grant `+8 XP` and progression points
- idempotency: key includes `assignment_id`, `student_id`, `submitted_on_time`

### `RW_ASSIGNMENT_SUBMIT_LATE_REWARD`

- scope: student + classroom world
- trigger: assignment submit event (`assignment.submitted_late`)
- condition: submission timestamp > assignment due timestamp
- effect: grant `+2 XP`
- idempotency: key includes `assignment_id`, `student_id`, `submitted_late`

### `RW_COURSE_PROGRESS_MILESTONE_UNLOCK`

- scope: student + classroom world
- trigger: course progress recompute (`course.progress_milestone`)
- condition: milestone threshold crossed (for example 25/50/75/100%)
- effect: unlock world era asset(s)
- idempotency: key includes `milestone`, `classroom_id`, `student_id`

### `RW_OVERLAY_TOGGLE`

- scope: student preference within classroom world
- trigger: user toggles overlay control
- condition: explicit user action
- effect: set `overlay_enabled` true/false
- idempotency: latest-write wins

### `RW_MISCHIEF_EVENT_CREATE`

- scope: student + classroom world
- trigger: world tick or post-reward event
- condition:
  - overlay enabled
  - no active mischief currently displayed
  - student not actively typing in high-focus editor
- effect: spawn one lightweight care interaction (for example, Pika sit-on-ui or tiny mess)
- idempotency: one active mischief per world at a time

### `RW_MISCHIEF_EVENT_RESOLVE`

- scope: student + classroom world
- trigger: click/tap interaction (`world.interaction_resolve`)
- condition: active mischief exists
- effect: clear event immediately; optional tiny positive feedback
- idempotency: keyed by active mischief ID

### `RW_DAILY_CARE_CLAIM_REWARD`

- scope: student + classroom world
- trigger: successful daily care claim
- condition: claim is valid and within same-day claim window
- effect: grant `+3 XP`
- idempotency: keyed by daily event claim ID

### `RW_WEEKLY_TRACK_ADVANCE`

- scope: student + classroom world
- trigger: weekly evaluation result
- condition: accumulated weekly track points reach or exceed `4`
- effect:
  - increment `weekly_track_level` by 1 for each full 4 points
  - decrement/rollover track-point buffer accordingly
  - unlock associated premium event variant(s)
- idempotency: key includes `learner_world_id`, `eval_week_start`, `track_advance`

### `RW_WEEKLY_BONUS_XP_AWARD`

- scope: student + classroom world
- trigger: weekly tier finalized
- condition: weekly evaluation successfully completed
- effect:
  - award tier bonus XP (`baseline +5`, `nicer +12`, `special +20`)
- idempotency: key includes `learner_world_id`, `eval_week_start`, `weekly_bonus_xp`

---

## Non-Negotiable UX Constraints

- Interactions must be dismissible in one click/tap.
- Interactions must not block saving/submitting work.
- No negative grading or XP loss from missed care interactions.
- Teacher views do not show live overlay interactions by default.
