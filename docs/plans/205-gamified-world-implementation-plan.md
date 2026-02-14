# Issue 205 Implementation Plan - Gamified World Overlay

Last updated: 2026-02-14
Source of truth for execution sequencing for issue #205.

## Phase 0: Preconditions
- Use worktree: `/Users/stew/Repos/.worktrees/pika/issue/205-feat-pika-pet-gamification-system`
- Keep migrations additive only (`038+`), do not modify applied migrations.
- Preserve existing pet flows while introducing world engine incrementally.

## PR1: Data Foundation + Constants
- Add migration: `supabase/migrations/038_world_overlay_foundation.sql`
- Extend/normalize per-classroom world state and scheduling pointers.
- Add world tables: daily events, weekly evaluations, event catalog.
- Add rule constants modules:
  - `src/lib/world-rules.ts`
  - `src/lib/world-scoring.ts`
- Encode approved constants:
  - bucket maxima: attendance 4, on-time 3, daily care 3
  - tier cutoffs: `<0.40`, `0.40-<0.75`, `>=0.75`
  - special guard: requires >=2 enabled buckets
  - XP: present +5, on-time +8, late +2, daily care +3
  - weekly bonus XP: +5/+12/+20
  - weekly track points: +0/+1/+2, level up each 4 points

## PR2: World Engine (Server Domain)
- Implement `src/lib/server/world-engine.ts` with deterministic logic:
  - `getOrCreateWorld`
  - `spawnDailyEventIfDue`
  - `claimDailyEvent`
  - `expireDailyEvents`
  - `runWeeklyEvaluation`
  - `awardBaseXp`
- Enforce timezone: `America/Toronto`
- Enforce idempotency keys on all mutations.

## PR3: Event Wiring in Existing APIs
- Login route: streak/day claim hooks.
- Entries route: attendance reward hooks.
- Assignment submit route: on-time/late reward hooks.
- Keep existing endpoint contracts stable while returning world deltas where needed.

## PR4: Scheduler + Cron
- Add cron route: `src/app/api/cron/world-cadence/route.ts`
- Schedule hourly trigger and execute due daily/weekly jobs from pointers.
- Update `vercel.json` schedule config.

## PR5: Student World API + Overlay UI
- Add APIs:
  - `src/app/api/student/classrooms/[id]/world/route.ts`
  - `src/app/api/student/classrooms/[id]/world/interactions/route.ts`
- Add UI:
  - `src/components/world/WorldOverlayProvider.tsx`
  - `src/components/world/WorldOverlay.tsx`
- Integrate into `src/components/AppShell.tsx` for student role only.
- Guarantees: one-click dismiss, max 1 active interaction, non-blocking editor flows.

## PR6: Weekly Catalog + Tiered Episodes
- Add seeded weekly catalog (12 entries: 4 baseline, 4 nicer, 4 special).
- Implement weighted selection + cooldown + era gating.
- Persist weekly selected event key and track advancement.

## PR7: Hardening + Verification
- Unit tests:
  - `tests/unit/world-scoring.test.ts`
  - `tests/unit/world-scheduler.test.ts`
- API tests:
  - `tests/api/student/world.test.ts`
  - `tests/api/cron/world-cadence.test.ts`
- Integration tests for:
  - same-day daily claim + midnight expiry
  - Friday tier evaluation
  - no-opportunity normalization
  - one-time 3-day Pika unlock
- UI screenshots for student and teacher flows per repo policy.

## Defaults for Remaining Open Items
- Mischief frequency: daily scheduled only in v1; no extra random interruptions during active typing.
- Teacher visibility: no teacher-facing world summary in v1.
