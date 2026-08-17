# Pika Session Log

Rolling recent session log for AI/human handoffs. Keep this file small; full historical session history lives in `.ai/JOURNAL-ARCHIVE.md`.

**Rules:**
- Append one concise entry for meaningful work, then immediately run `node scripts/trim-session-log.mjs` in the same change.
- Start each entry heading with a valid ISO date (`## YYYY-MM-DD ...`) so retention can identify the latest entries.
- CI allows at most 60 entries; the trim step compacts to the latest 40 entries by default so there is headroom for future appends.
- Use `node scripts/trim-session-log.mjs --check` to reject empty entries and verify the log is chronological and within the 60-entry cap.
- Keep enough recent entries for weekly automations to inspect roughly the last week of work.
- The trim step appends removed entries to `.ai/JOURNAL-ARCHIVE.md`, so trimming never loses history.
- Use `.ai/JOURNAL-ARCHIVE.md` only for historical investigation.

## 2026-08-06 — Make Blueprint copy fences fail closed

**Implementation:**
- Removed lease expiry from Blueprint purge authorization: every unclosed
  source-copy intent now blocks purge until durable settlement.
- Heartbeats continue after transient failures; a later successful heartbeat
  clears the operational error while the durable intent remains the safety
  boundary throughout provider I/O.
- Added a private, service-role-only hard-crash recovery RPC. It requires the
  exact owner/operation/teacher/source tuple and expiry snapshot, 24 hours of
  staleness, no running operation, no live provisional files, and explicit
  confirmation that no worker remains. Recovery is compare-and-swap and
  idempotent.
- Expanded static, runtime, privilege, stale-intent, exact-snapshot, running-
  operation, and provisional-file reconciliation fixtures.
- Classified heartbeat transport failures as retryable and intent/fence
  rejection as terminal. A single wrapper now checks authority before and after
  every asynchronous copy action so no later reservation, read-back, or
  verification begins after authority is lost.
- Completed-operation retries return the deterministic owner identity and
  idempotently repair lost settlement. Migration 120 also binds and closes only
  legacy adopted owners proven by a matching completed operation and live
  teacher-owned source Blueprint.

**Boundary:**
- Full Vitest (4,083 tests), lint, architecture, production build, Pika audit,
  shell syntax, static migration checks, and final bounded reviews pass.
  Migration 120 has not been replayed after this change; generated types and
  the database fixture still require a fresh authorized local reset. No staging
  or production state changed, and all rollout gates remain disabled.

## 2026-08-06 — Verify revised Blueprint purge on clean local replay

**Risk profile:** runtime-platform — authorized destructive local reset and
schema/Storage concurrency verification only.

**Completed:**
- Verified the target was loopback `127.0.0.1:54321` with the healthy
  `supabase_db_pika` container, then used the one-time authorization to reset
  local Supabase and replay migrations 001–120 including the revised migration
  120.
- Regenerated `database.generated.ts`, reseeded one teacher, two students, one
  Classroom, assignments, tests, grades, and history, and confirmed generated
  types match the replayed schema.
- Passed the managed-storage contract/readiness and multi-session concurrency
  fixtures plus the transactional Course Blueprint purge fixture, including
  fail-closed copy intents and guarded recovery.

**Postconditions:**
- Migration history is exactly 001–120 with no gaps or mismatches. Both purge
  modes are `disabled`; managed Storage is `compatibility`; cleanup/compaction
  environment gates are disabled or unset; no purge operation is active.
- Synthetic fixture users and Storage objects were removed. No staging or
  production state changed, and migration 120 remains local only.

## 2026-08-06 — Prepare verified Blueprint deletion draft

**Risk profile:** workspace-state — publish the already verified feature only.

**Prepared:**
- Reconfirmed this dedicated branch matches current `origin/main`, the complete
  worktree diff is limited to Course Blueprint deletion and its continuity
  metadata, and the Pika audit and diff checks pass.
- Prepared migration 120, the disabled-by-default application/API/UI flow,
  tests, fixtures, and rollout guidance for a separate draft PR. PR #963 and
  all staging and production state remain untouched.

## 2026-08-06 — Reconcile Blueprint deletion CI contracts

**Risk profile:** runtime-platform — test and CI integration only.

**Fixed:**
- Updated the versioned Blueprint database fixture to assert that migration
  120 rejects direct root deletion while preserving the Blueprint and its
  immutable Version. The independent user-account cascade test remains.
- Added the transactional Course Blueprint purge fixture to the Architecture
  Database Contracts job so authorization, fencing, retries, exact Storage
  cleanup, and Classroom/user preservation run in CI.

**Validation:**
- Shell syntax, the versioned Blueprint database contract, and the Course
  Blueprint purge database fixture pass against local `supabase_db_pika`.
- No migration, application runtime, staging, or production state changed.

## 2026-08-07 — Add workflow-friction guardrails

**Risk profile:** workspace-state.

- Updated the E2E coverage and weekly simplification automations to create their
  named task branch before edits when Codex starts them on a detached HEAD, and
  to stop on any unexpected checkout state.
- Added an explicit fallback for the workflow-friction review memory path while
  retaining the configured hub project roots and report-only boundary.
- Made session-log trim and check operations reject empty entries, removed the
  existing empty duplicate heading, and added focused regression coverage.
- Validation passed: focused trim/startup tests (51), full Vitest (468 files,
  4,049 tests), lint, session-log check, TOML parsing, and diff checks.

## 2026-08-07 — Center login password-recovery link

**Risk profile:** none — localized unauthenticated login layout refinement.

**Completed:**
- Moved “Forgot password?” from the password-field edge to a centered row
  between the Login button and Sign up link.
- Preserved the recovery navigation and added the shared minimum target and
  visible keyboard-focus treatment.

**Validation:**
- Focused LoginClient tests, lint, design/UI policy checks, Pika audit, and
  diff checks passed.
- Regenerated and reviewed the affected Playwright desktop light/dark login
  visual-regression baselines; their focused snapshot suite passed.
- Playwright visual verification passed for the unauthenticated desktop/mobile
  login screen in light and dark themes, including default, hover, and focus
  states. Teacher/student authenticated variants are not applicable.

## 2026-08-08 — Rebase Blueprint deletion onto current main

**Risk profile:** runtime-platform — migration and durable deletion integration.

**Completed:**
- Rebased PR #971 onto current `origin/main`, preserving the login recovery and
  AI-continuity guardrail changes added after the initial review.
- Resolved only derived continuity-archive conflicts; application code and
  migration 120 had no merge conflict or numbering collision.
- Kept Course Blueprint deletion rollout disabled and migration 120 unapplied
  outside the existing local development database.

**Validation:**
- Exact-head migration lineage, generated-type parity, shell/workflow syntax,
  147 focused tests, both Blueprint database contracts, feature validation,
  TypeScript, lint, production build, and diff checks pass.
- Fresh cumulative PR review and GitHub CI remain before merge.

## 2026-08-08 — Add immediate Pal event delivery

**Risk profile:** runtime-platform — transactional outbox delivery and learner
state refresh behavior.

**Completed:**
- Added a targeted, two-second post-commit delivery attempt for authenticated
  sessions, classroom joins, qualifying daily logs, first assignment views, and
  assignment completions while preserving the existing durable outbox,
  idempotency, leases, retry backoff, and daily recovery worker.
- Refreshes the mounted Pal provider only after a newly confirmed delivery, so
  achievements and companion reactions can update without waiting for the
  60-second polling fallback.
- Documented the reusable host/provider SaaS boundary and clarified that the
  daily cron owns weekly configuration reconciliation plus delivery recovery,
  not the primary user-action response path.
- Independent review tightened the hard caller deadline across adapter I/O and
  added atomic recovery of expired immediate-delivery leases.

**Validation:**
- Full Vitest passed (473 files, 4,093 tests), plus TypeScript, lint,
  architecture/UI policy checks, production build, and diff checks.

## 2026-08-08 — Harden Pal delivery release readiness

**Risk profile:** runtime-platform — delivery telemetry, PostgreSQL claim
concurrency, outage recovery, and production release evidence.

**Completed:**
- Added privacy-safe structured logs for immediate delivery and daily outbox
  drains, plus protected ready/retry/expired-lease/backlog-age and recent
  delivery-latency metrics.
- Added an ephemeral PostgreSQL concurrency harness proving one claim winner
  for pending and expired batch and targeted claims.
- Added a loopback-only HTTP recovery smoke that persists a 503 retry, restores
  the peer, delivers the queued event once with the same idempotency key, and
  removes its synthetic fixture.
- Closed independent-review gaps by emitting sanitized error-category drain
  telemetry, reserving a 60-second cron execution budget, and replacing timing
  assumptions with database-observed claim and lock contention gates.
- Bounded the complete drain path across claims, delivery transitions, and the
  final count, and made ready-backlog age use the actual retry/lease-ready time.
- Classified both direct and PostgREST-wrapped abort/timeout failures as the
  sanitized `deadline` drain outcome.
- Confirmed read-only that the current production adapter is enabled and has
  delivered events; no Pal code, Pal PR #50, migration, or production data was
  changed by the readiness implementation.

**Validation:**
- Full Vitest passed (475 files, 4,101 tests), plus TypeScript, lint,
  architecture/design/UI policy checks, Pika audit, production build, both
  real-database/HTTP Pal harnesses, continuity validation, and diff checks.

## 2026-08-08 — Install production Blueprint purge schema

**Risk profile:** irreversible production schema installation; rollout and
execution remained disabled.

**Completed:**
- Verified the dedicated worktree at merged `main`, the hub-linked production
  Pika project, migration history through 119, migration 120 static checks, and
  the managed-storage lineage.
- Confirmed the linked dry run contained only
  `120_course_blueprint_purge_managed_ownership.sql`.
- Applied migration 120 exactly once through `supabase db push --linked` under
  exact production authorization.

**Validation:**
- Production migration history now records 120.
- `course_blueprint_purge_settings.rollout_mode` is `disabled`; canary teacher
  and Blueprint IDs are null, and no Blueprint purge operation exists.
- No purge, managed-storage cleanup, rollout activation, or Storage deletion
  ran. Enabling a canary remains a separate production decision.

## 2026-08-08 — Complete managed deletion production rollout

**Risk profile:** irreversible production deletion availability with fail-closed
authorization, ownership, operation-conflict, and managed-storage gates.

**Completed:**
- Ran successful production canaries for managed Course Blueprint deletion and
  hot archived Classroom deletion, preserving linked Classrooms, reusable
  Classroom-owned files, and user accounts where required.
- Enabled permanent deletion broadly for eligible teacher-owned Pika Course
  Blueprints and hot archived Classrooms. Cold archives and comprehensive
  individual-student purging remain separate follow-up scopes.
- Refreshed the protected synthetic verification credentials after invalidating
  a diagnostic-output exposure; no real-user credentials were affected.

**Validation:**
- Production migration history matches local migrations 001–120, and managed
  storage remains enforced at protocol version 2.
- All three current hot archived Classrooms and both current Course Blueprints
  report deletion available, with zero active purge operations or conflicts.
- Managed Storage reconciles at 140 registered/140 stored objects with no
  missing, unregistered, interrupted, or active-cleanup objects.
- Desktop/mobile teacher and student boundaries passed; non-owner teacher
  access returned 404 and student access returned 403. No purge was started by
  either broad rollout action.

## 2026-08-08 — Add accessible student test flag toggles

**Risk profile:** exam-mode — student test-taking interaction and lock behavior.

**Completed:**
- Exposed each `StudentTestForm` question flag heading as a named toggle with
  `aria-pressed`, plus `aria-disabled` and removed tab stops while interaction
  is locked.
- Preserved the existing heading-sized target, visual treatment, localStorage
  contract, and single-toggle Enter/Space behavior.
- Added component coverage for pointer round trips, Enter, Space, accessible
  naming, initial/updated pressed state, persistence, and locked behavior.

**Validation:**
- Focused `StudentTestForm` component tests, TypeScript, lint, architecture,
  UI/design policy checks, Pika audit, and `git diff --check` passed.
- Playwright visual verification passed for the student form in desktop/mobile,
  light/dark, flagged/unflagged, and keyboard-focus states; teacher was not
  applicable.

## 2026-08-08 — Audit remaining managed deletion scopes

**Risk profile:** runtime-platform — irreversible cold recovery loss,
cross-Classroom student lineage, managed Storage, and durable purge recovery.

**Audited:**
- Created dedicated worktree `codex/remaining-deletion-scopes`, completed the
  session-start workflow, and verified the local read-only schema is exactly at
  migrations 001–120.
- Traced cold tombstones, immutable archives, restore/compaction operations,
  Gradex extracts, managed ownership/cleanup leases, hot/Blueprint purge
  fences, and the complete Classroom resource graph.
- Traced Classroom-scoped student rows, embedded JSON/provenance, managed
  student files, existing partial roster removal, account-level data, Pal
  ledgers, and cross-Classroom preservation boundaries.

**Recommendation:**
- Add privacy-safe read-only deletion health monitoring first, then implement
  cold-Classroom purge and Classroom-scoped individual-student purge as
  separate migrations and PRs with independent rollout gates.
- Keep generic orphan cleanup disabled; neither purge scope depends on it.
- Require cold archives to be restored before individual-student purge; do not
  rewrite immutable archive bundles or erase user accounts/other Classrooms.

**Boundary:**
- No implementation, migration application, local reset, rollout change,
  production query, purge, or Storage deletion was performed. PR #963 remains
  closed and untouched. Awaiting approval of the scope and sequencing package.

## 2026-08-08 — Add managed deletion health monitoring baseline

**Risk profile:** runtime-platform — read-only production health aggregation
across irreversible purge ledgers and managed-storage ownership.

**Completed:**
- Added migration 121 with a service-role-only, aggregate RPC for hot
  Classroom and Course Blueprint purge failures/stalls, fence/lease drift,
  deleted-object reappearance, and managed-storage ownership/reference drift.
- Added an exact Zod response boundary, code-first missing-schema compatibility,
  privacy-safe structured counts, and sanitized probe failures.
- Integrated the probe after successful work in the existing authenticated
  daily cleanup cron. Critical findings return 503; warning-only findings remain
  observable without granting cleanup authority.
- After the initial independent review of PR #980, moved recursive JSON/history
  reconciliation out of the daily path into a separate unscheduled,
  service-role-only diagnostic; added payload UUID/digest mismatch detection and
  made every dependency error except the exact missing-RPC signal fail closed.
  A targeted follow-up made evidence reconciliation registry-driven so removing
  a payload's final managed reference cannot hide the stale registry row.
- Documented operator response and staged rollout. Generic orphan cleanup stays
  disabled, and no additional cron schedule or deletion capability was added.

**Validation:**
- Full Vitest passed (478 files, 4,128 tests), plus focused monitoring/migration
  tests, TypeScript, lint, architecture boundaries, managed-storage
  lineage, hot-Classroom purge SQL lint, production build, and diff checks.
- After separate exact authorization, the dry run previewed only migration 121
  and it was applied once to the dedicated local Supabase database. Rollback-only
  database fixtures proved read-only/service-role/privacy boundaries, warning
  and critical findings, partial/lease/reappearance detection, eight concurrent
  readers, and a 1,000-object runtime of 9–34 ms with 6,265 shared-buffer hits.
- The originally authorized local application predates the review correction;
  that one-time permission was not reused. Final generated types and the revised
  rollback fixture are gated on PR CI's fresh ephemeral migration replay. No reset, remote migration,
  rollout change, production query, purge, or persistent Storage deletion was
  performed; the temporary helper and all fixtures were removed. No UI changed,
  so visual verification was not applicable.

## 2026-08-09 — Deploy managed deletion health monitoring

**Risk profile:** runtime-platform — production schema activation, daily cron
monitoring, and managed-storage health visibility.

**Completed:**
- Merged `main` into protected `production` through PR #981 after the full CI,
  database-contract, build, and browser matrix passed; Vercel confirmed
  production commit `64e8a22a` deployed.
- Verified the linked production Supabase project had migrations 001–120 and
  that the dry run contained only `121_managed_deletion_health_monitoring.sql`,
  then applied migration 121 once under exact production authorization.
- Kept generic orphan cleanup disabled and did not invoke a purge, retry,
  cleanup route, rollout gate, Storage deletion, or the deep JSON diagnostic.

**Validation:**
- Production migration history now records 001–121.
- The lightweight service-role aggregate RPC returned HTTP 200 with
  `healthy: true`, zero critical findings, zero warnings, and zero managed
  storage or purge-protocol drift; anonymous invocation was denied with 401.
- The production worktree is clean and synchronized with `origin/production`.

## 2026-08-09 — Implement cold-archived Classroom permanent deletion

**Risk profile:** runtime-platform — irreversible cold recovery loss, teacher
authorization, exact managed Storage ownership, concurrency, and resumability.

**Completed:**
- Added independent, disabled-by-default cold-Classroom deletion using the
  existing managed-deletion operation ledger, fences, leases, retries, and
  monitoring; hot-Classroom and Blueprint purge behavior remains separate.
- Bound every operation to one teacher-owned cold archive, prioritizing the
  authoritative recovery bundle last, and preserved user accounts, reusable
  Blueprints, other Classrooms/archives, and their managed files.
- Added fail-closed teacher APIs, conflict/readiness checks, resumable cron
  ticking without a new schedule, audit-safe resource hashes, and irreversible
  confirmation UX. Generic orphan cleanup remains disabled.
- Independent high-risk review caught and fixed two cross-scope regressions:
  migration 122 now preserves Blueprint purge Storage-lease authority, and the
  hot/cold safety nets filter scope and terminal failures before limiting work.
  Regression coverage exercises both worker-starvation cases, while fresh CI
  replay runs the existing Blueprint purge fixture and the new cold purge fixture.
- Documented contracts, recovery-loss consequences, rollout gates, operations,
  and tests. Added desktop/mobile teacher and student-boundary visual coverage.

**Validation:**
- Under exact local-only authorization, previewed migration history 001–121,
  applied only `122_cold_archived_classroom_purge.sql` to the dedicated local
  Supabase database, regenerated types, and confirmed the gate remains
  `disabled`.
- The rollback-only database harness passed authorization, restore-conflict,
  tombstone fence, live-lease, retry, exact-object ordering, cleanup, audit, and
  preservation checks, then rolled back all fixtures.
- Full Vitest passed (483 files, 4,159 tests), plus TypeScript, lint, generated
  type parity, production build, architecture/design/storage checks, Pika audit,
  diff checks, and Playwright visual verification across desktop/mobile and
  light/dark teacher states plus the student boundary.
- No staging/production migration, rollout, purge, object deletion, or generic
  cleanup was performed. Migration 122 and its rollout still require separate,
  exact production authorization after merge.

## 2026-08-10 — Refine archived Classroom action terminology

**Risk profile:** low — presentation-only labels, accessible icon treatment,
and focused regression coverage; no lifecycle behavior or rollout gates changed.

**Completed:**
- Renamed the hot-archive actions from “Use again” to “Reuse” and from
  “Restore” to “Unarchive,” including the confirmation dialog and supporting
  copy. Cold-archive recovery remains “Restore.”
- Replaced the permanent-delete text action with the standard trash icon while
  retaining the accessible “Delete permanently” name and tooltip.
- Added component assertions and a focused teacher/student visual matrix for
  desktop/mobile and light/dark modes.

**Validation:**
- Focused Vitest passed (2 files, 23 tests), lint passed, and the isolated
  Playwright matrix passed (3 tests, including auth setup).
- Screenshots were visually reviewed for all teacher matrices and the student
  boundary. No database, migration, API behavior, feature gate, or destructive
  operation changed.

## 2026-08-10 — Add Student Tests live-status accessibility

**Risk profile:** exam-mode, workspace-state — student test announcements and
autosave error feedback while preserving the mounted attempt and exam owner.

**Completed:**
- Added action-only polite flag/unflag announcements without announcing loaded
  localStorage state or duplicating pointer/keyboard toggles.
- Added polite autosave transition announcements for unsaved, saving, and saved
  states while keeping the visible status layout and teacher preview unchanged.
- Exposed save and submission errors as assertive alerts without changing API,
  draft, retry, availability, locking, or submission behavior.
- Added controlled timer/promise coverage for announcements, save failure draft
  preservation, preview isolation, and existing pressed/locking/storage rules.

**Validation:**
- Focused StudentTestForm tests pass (17 tests), including controlled stale
  success/failure races so an older save cannot overwrite newer live state.
- TypeScript, lint,
  architecture, UI policy, Pika audit, and diff checks.
- Playwright verified real student flagged/unflagged, saving/error, response
  preservation, and keyboard-focus states plus teacher preview at desktop/mobile
  and light/dark; no layout regression or overflow was found.
- The temporary local test fixture was deleted after capture; no API, database,
  migration, Gradex, exam-mode ownership, or dependency changes were made.
- Independent review identified one P1 stale-autosave completion race; the
  accepted remediation guards UI completion by the latest pending draft and
  monotonic successful-save sequence without changing persistence requests.

## 2026-08-10 — Compact teacher Daily log table

**Risk profile:** none — presentation and client-side table ordering only.

**Completed:**
- Reduced the First, Last, and ID column widths in the teacher Daily table so
  the log preview receives more horizontal space.
- Removed the standalone attendance-status column and combined its row marker,
  Complete/Incomplete counts, and sortable behavior into the Log column.
- Added accessible completion labels and preserved Log sorting in both the
  full-width table and selected-student workspace.
- Independent PR review caught that the Complete/Incomplete count badges were
  hidden after selecting a student; restored them in the selected workspace
  and added a regression assertion for the accessible count label.
- Removed the stale arbitrary-spacing exception for the deleted status-column
  width.

**Validation:**
- Focused component coverage passes (17 tests), including Enter/Space
  activation, ascending and descending Complete/Incomplete sorting, focus, and
  sortable-header semantics.
- Lint, architecture, design policy, UI policy, and diff checks pass.
- Playwright experience matrix passes (18 tests) across teacher/student,
  desktop/mobile, and light/dark; screenshots of the teacher default and sorted
  states show no page overflow or broken layout.
- The selected-student remediation was visually rechecked in teacher
  desktop/mobile and light/dark states with no horizontal page overflow.

## 2026-08-10 — Standardize resizable Daily columns

**Risk profile:** none — shared client-side table layout behavior only.

**Completed:**
- Moved the Complete/Incomplete count chips immediately beside the Daily Log
  label while preserving its sortable semantics.
- Added adjustable First, Last, and ID widths to Daily; Log absorbs the
  remaining space. Narrow values truncate instead of wrapping in the selected
  workspace.
- Extracted the assignment table's accessible pointer/keyboard resize behavior
  into shared `@/ui` table primitives and migrated assignments to the shared
  owner without sharing domain-specific cells.
- Removed stale native-control and raw-layer registry entries from the former
  assignment-local implementation.

**Validation:**
- Focused DataTable, Daily, and assignment coverage passes (29 tests), including
  separator semantics, Arrow/Home/End resizing, pointer clamping, sorting, and
  selected-row truncation.
- Lint, architecture, UI policy, design policy, and Pika audit pass.
- Playwright captures were reviewed for teacher desktop/mobile, light/dark,
  default, sorted, selected, minimum-width resize, and the assignment reference
  table; the student attendance boundary was also checked.
- Composite checklist reviewed: yes; keyboard behavior covered: yes; semantic
  state covered by tests: yes; remaining manual follow-up: none.

## 2026-08-11 — Implement hot-Classroom individual-student purge

**Risk profile:** runtime-platform and irreversible-deletion design; local code
only. Migration 123 was not applied and no purge or rollout ran.

**Completed:**
- Added disabled/canary/enabled exact-triple rollout settings, stable roster
  student lineage, durable operation/resource/object ledgers, pair and
  whole-Classroom fences, exact Storage leases, retries, and explicit
  finalization for one student in one hot Classroom.
- Preserved the user and other Classrooms; staged the target's exact managed
  objects and all retained Classroom archive/Gradex copies. Pal-backed,
  remote-Gradex, cold, retired-assessment, and conflicting-operation targets
  fail closed.
- Added teacher-only impact/start/status/tick routes, cleanup-cron recovery and
  health signals, Roster action/dialog, route/component/server/migration tests,
  generated types, and a rollback-only CI database fixture.

**Validation:**
- Full suite passes (4,210 tests/492 files); focused purge/cron slice, build,
  TypeScript, lint, architecture/design/UI policy, Pika audit, and diff checks pass.
- Pika UI verification passed for teacher desktop/mobile light/dark dialog and
  progress states plus student desktop/mobile light/dark absence boundaries.
- Rollback-only CI fixture now covers managed-file lease authority, byte absence,
  update ownership fences, relational deletion, and cross-Class preservation.

**Remaining:**
- Publish for independent PR review and fresh-database CI replay.
- Local database replay awaits separate migration authorization.
- Production migration, rollout, and purge remain separately prohibited.

## 2026-08-11 — Complete production cold-Classroom purge canary

**Risk profile:** runtime-platform — one exact authorized irreversible production
canary with a disabled-by-default rollout gate.

**Completed:**
- Merged release PR #991 with the reviewed impact-envelope fix and verified
  Vercel deployed production commit `47316895`.
- Activated canary mode only for teacher
  `34bd4439-e552-483b-b8aa-e3a8f86009af` and synthetic Classroom
  `58f90ce4-ac21-4e68-bbf4-f1db3ae77f74`, then ran durable purge operation
  `3a88d39d-5bc4-40f3-8c21-8aa2fa1e6151` for archive
  `c748ec90-4952-4ec1-8ee7-99be3354b71a`.
- Deleted the one verified 2,106-byte recovery archive before atomically
  finalizing six cold resources; restored the rollout gate to disabled.

**Validation:**
- The completed audit retains aggregate counts for one archive, two archive
  operations, one cold actor, one tombstone, and one managed Storage object.
- Exact Storage download now proves the archive absent; the hot Classroom,
  tombstone, archive, source operations, cold actors, managed registry row,
  Gradex extracts, and active fence are absent.
- The teacher account and unrelated active Classroom remain unchanged.
- Aggregate and deep managed-deletion health are healthy with zero critical
  findings and zero warnings. Generic cleanup did not run.

**Next:**
- Keep cold deletion disabled and observe two scheduled healthy monitoring runs
  before requesting broad rollout authorization. Keep individual-student purge
  and generic orphan cleanup as separate scopes.

## 2026-08-11 — Prepare cold-deletion canary and repair impact parsing

**Risk profile:** runtime-platform — production cold-archive preparation plus a
server boundary fix; cold deletion remained disabled.

**Completed:**
- Created, hot-archived, exported, and cold-compacted the synthetic production
  Classroom `58f90ce4-ac21-4e68-bbf4-f1db3ae77f74`; immutable archive
  `c748ec90-4952-4ec1-8ee7-99be3354b71a` remains ready and recoverable.
- Verified the hot row is absent, the cold tombstone and completed export /
  compaction operations are present, the archive bytes still match their
  checksum, the teacher and unrelated Classroom remain, and managed-deletion
  health is healthy at 0 critical / 0 warnings.
- Production-shaped verification found that the cold purge inventory RPC's
  `ok` / `status` envelope was rejected by the strict impact schema. Normalize
  those two transport fields before strict domain validation, matching the
  established Blueprint purge boundary.

**Validation:**
- Focused cold purge, route, dialog, availability, and migration coverage passes
  (8 files, 65 tests), including the production-shaped RPC regression.
- TypeScript, lint, architecture, diff checks, and the Pika audit pass.
- No cold purge, rollout enablement, generic cleanup, or production deployment
  of the parsing fix ran; each remains separately authorized.

## 2026-08-11 — Deploy cold-archived Classroom deletion foundation

**Risk profile:** production rollout — compatible application deployment plus
an additive, disabled-by-default irreversible-deletion capability.

**Completed:**
- Merged release PR #988 from `main` to `production` after the architecture
  database contracts, full test/build, browser matrix, and Vercel checks passed.
- Verified Vercel deployed production commit `7108345c` before changing schema.
- Verified production migration history was exactly 001–121 and the linked dry
  run contained only `122_cold_archived_classroom_purge.sql`, then used the
  one authorized production application attempt.
- Kept `cold_classroom_purge_settings` in `disabled` mode with no canary IDs.
  No purge, rollout enablement, Storage deletion, or generic cleanup ran.

**Validation:**
- Production migration history records 001–122.
- The linked production project has zero active cold purge operations.
- The read-only managed-deletion health snapshot is version 1 and healthy with
  zero critical findings and zero warnings at the one-hour stuck threshold.
- An exact production cold purge canary remains a separate authorization.

## 2026-08-11 — Standardize production table capabilities

**Risk profile:** workspace-state — shared client-side table selection,
keyboard navigation, sorting, and persisted layout preferences; no API or data
model changes.

**Completed:**
- Added generic `useTableSelection`, optional local width persistence, shared
  mixed-state selection cells, and a reusable left/right resize handle.
- Migrated the seven production table surfaces to canonical `@/ui` primitives:
  Assignment students, Daily attendance, Roster, Test grading, Gradebook,
  dashboard attendance, and Add Students preview.
- Added sorting/resizing where operationally useful, retained checkbox
  selection only where real batch actions exist, and kept the Add Students
  preview intentionally static.
- Removed the legacy table re-export and student-specific selection hook, and
  documented the composable table ownership boundary.

**Validation:**
- Focused table coverage passes (127 tests), TeacherClassroomView passes (50
  tests), TypeScript and lint pass, and the Pika audit reports no violations.
- The full 4,181-test run had one unrelated transient ColdClassroomPurgeDialog
  timing failure while its inventory was still loading; its isolated suite
  passed immediately afterward (3/3).
- Playwright verified teacher desktop/mobile, light/dark, default, sorted,
  mixed-selection, focused-resize, selected-row/inspector, Test grading,
  Assignment students, Dashboard, and Add Students preview states; the student
  mobile boundary was also checked. No overflow or visual regression remained.
- Composite checklist reviewed: yes; keyboard behavior covered: yes; semantic
  state covered by tests: yes; remaining manual follow-up: none.

## 2026-08-12 — Harden individual-student purge after independent review

**Risk profile:** runtime-platform — destructive deletion protocol remains
disabled and unapplied; this pass changes only reviewed code, migration source,
tests, and documentation.

**Completed:**
- Replaced the archive-contract-breaking roster user column with a derived,
  non-archive roster/student binding that is rebuilt from enrollment lineage.
- Added authoritative account-email confirmation, operation-scoped completed
  replay binding, stable client idempotency across lost start responses,
  permanent purged-path reservations, and non-student-derived grading-run
  selection hashes.
- Expanded the rollback-only database fixture across assignment, test, survey,
  report-card, announcement, archive, Gradex, target/classmate, replay, fence,
  exact-object, and delayed-write cases.
- Added a focused runbook, corrected hot/cold scope docs, and made the visual
  teacher/student matrix a named CI gate with retained failure artifacts.

**Validation:**
- Full suite passes: 4,216 tests across 492 files. Focused remediation tests,
  TypeScript, architecture, lint, production build, design/UI policy, Pika
  audit, and diff checks pass.
- Playwright passed teacher default/progress and student-boundary verification
  across desktop/mobile and light/dark on an isolated local port; screenshots
  were visually inspected with no overflow or contrast regression.
- Migration 123 was not applied locally or remotely, no rollout setting changed,
  no purge ran, and no Storage object was deleted. Ephemeral CI replay remains
  the next database validation gate.

## 2026-08-13 — Show semester ranges on Classroom cards

**Risk profile:** none — presentation and classroom-list read fields only.

**Completed:**
- Replaced join codes on teacher active, teacher archived, and student Classroom
  cards with Toronto-safe abbreviated semester ranges such as
  `Sept 2025 - Jan 2026`.
- Added the required `start_date` and `end_date` fields to narrow teacher and
  student Classroom list reads, with a non-sensitive fallback when dates are
  unavailable.
- Added shared formatter and direct component/API regression coverage, and
  updated the archived-Classroom Playwright fixture to assert the date range is
  visible while the join code is absent.

**Validation:**
- Focused unit, component, and API coverage passes: 46 tests across 6 files.
- Lint, architecture, design policy, production build, diff checks, and the Pika
  audit pass.
- Playwright and visual inspection pass for teacher active/archived and student
  active cards across desktop/mobile and light/dark, with no overflow or layout
  regression. Composite-widget checklist is not applicable because interaction
  semantics and keyboard behavior were unchanged.

## 2026-08-14 — Add durable cleanup-history cron evidence

**Risk profile:** runtime-platform — additive service-only observability and
overlap serialization around the existing cleanup-history safety-net route.

**Completed:**
- Added migration 124 with a privacy-safe run ledger, scheduled/manual source
  attribution, exact aggregate metric allowlist, overlap records, stale-run
  supersession, one-way finalization, and an identity-free health snapshot.
- Integrated the cron route with pre-124 compatibility and fail-closed ledger
  errors, plus focused tests, a rollback-only database fixture, CI coverage,
  generated types, operator guidance, and rollout instructions.
- With explicit local authorization, applied migrations 123–124, then reset the
  disposable database without seeds and replayed migrations 001–124 to remove
  stale migration-121 schema state.

**Validation:**
- Full suite passes: 4,239 tests across 494 files; focused ledger coverage passes
  43 tests. TypeScript, lint, production build, Pika audit, shell syntax, and
  diff checks pass.
- Fresh migration replay, migration-123 and migration-124 rollback-only
  fixtures, generated-type drift check, and preservation of the migration-121
  deep-health RPC all pass.
- Database lint identified an inherited ambiguous `attempt_count` reference in
  migration 123's storage-failure retry function. Keep that correction separate
  from migration 124. No production migration, deploy, cron run, rollout change,
  purge, or Storage deletion occurred.
- Initial PR review found a false-green scheduled-health path. Remediation now
  requires exact Vercel GET metadata, keeps POST manual, and requires a fresh
  successful scheduled run within 26 hours; empty, expired, or failed scheduled
  evidence stays unhealthy even after manual success. The revised fresh replay,
  database fixture, generated types, and 44 focused tests pass.
- Final integration review caught an over-budget `.ai/CURRENT.md` that omitted
  canonical app-managed worktree and collaborator env forms. The compressed
  handoff restores both contracts; startup-doc coverage and the full 4,240-test
  suite pass.

## 2026-08-15 — Make student Surveys recoverable and keyboard-native

**Risk profile:** workspace-state — student-only survey presentation and local
request state; no API, schema, migration, production, or Gradex change.

**Completed:**
- Replaced the ambiguous results `null` state with survey-scoped loading,
  success, and announced error states plus an explicit Retry action.
- Replaced styled answer buttons with native radios in a named radio group,
  retaining the existing card treatment while adding checked state, focus, and
  browser keyboard behavior.
- Updated the exact native-control policy entry and added component regression
  coverage for semantic selection and failed-results recovery.

**Validation:**
- Full suite passes: 4,242 tests across 494 files. Lint, production build,
  architecture, design/UI policy, Pika audit, and diff checks pass.
- Playwright and visual inspection pass for student results, edit/selected,
  focus, error/retry, desktop, mobile, light, and dark states. Arrow-key radio
  movement passed in Chromium; mobile body width remained within 390px.
- Teacher verification is not applicable because no teacher-owned surface
  changed. Composite semantics and keyboard behavior are covered; no manual
  follow-up remains.

## 2026-08-15 — Make teacher Survey results recoverable

**Risk profile:** none — teacher-only results presentation and local request
state; no API, schema, migration, production, or Gradex change.

**Completed:**
- Replaced false empty-result fallback data with survey-scoped loading, ready,
  and announced failure states plus explicit Retry actions.
- Preserved the last valid result snapshot during failed roster/response-count
  refreshes and kept stale Survey responses out of the selected workspace.
- Recorded the completed teacher/student Surveys slice in the product audit.

**Validation:**
- Full suite passes: 4,244 tests across 494 files. Production build, lint,
  architecture, design/UI policy, Pika audit, and diff checks pass.
- Playwright and visual inspection pass for teacher results and cold errors at
  desktop/mobile in light/dark, with no horizontal overflow. Unit interaction
  coverage proves retained-result failure and successful retry replacement.
- Composite-widget checklist is not applicable because no composite control or
  keyboard model changed; alert/status semantics and Retry are role-tested.

## 2026-08-16 — Make Announcement tabs recoverable and Toronto-safe

**Risk profile:** workspace-state — teacher/student Announcement presentation,
request ownership, and read acknowledgement; no API, schema, migration,
production, Calendar, mobile redesign, or Gradex change.

**Completed:**
- Added explicit loading, successful empty, cold-error, and Retry states while
  preserving valid classroom-scoped data and rejecting stale responses.
- Made failed student read acknowledgement visible and retryable without
  prematurely clearing notification state.
- Centralized Announcement timestamps in `America/Toronto` for teacher and
  student display and scheduling labels.
- Fenced teacher create/edit/delete and student read completions by committed
  classroom generation, including abandoned concurrent renders.

**Validation:**
- Full suite passes: 4,258 tests across 494 files. Focused component/domain
  tests, lint, TypeScript, Pika audit, and diff checks pass.
- Independent review findings for provider-driven automatic read retry,
  cross-classroom mutation repainting, and render-phase ownership leakage were
  remediated with provider-settlement, committed-switch, and suspended-transition
  regression coverage.
- Visual verification passes for teacher/student desktop/mobile and light/dark
  loaded/error states, plus the student read-error state. No composite keyboard
  behavior changed; semantic alert/status and Retry coverage passes.

## 2026-08-16 — Make Calendar sources independently recoverable

**Risk profile:** none — teacher/student Calendar presentation and local
request ownership; no API, schema, migration, production, mobile redesign, or
Gradex change.

**Completed:**
- Replaced false-empty Calendar fallbacks with independent lesson-plan,
  assignment, announcement, and class-day loading/error/snapshot contracts.
- Preserved successful data during partial failures, added source-specific
  Retry actions, and fenced stale classroom and overlapping teacher assignment
  refresh responses.
- Corrected date-only term parsing and made initial/today navigation explicitly
  Toronto-based.

**Validation:**
- Full suite passes: 4,289 tests across 495 files. Production build, lint,
  TypeScript, architecture, design/UI policy, Pika audit, and diff checks pass.
- Independent review found that background lesson refreshes could discard
  edits and successful Retry actions could strand keyboard focus. Pending
  edits now remain authoritative during refreshes, Retry controls stay mounted
  while requests run, and successful recovery focuses the named Calendar
  workspace. Targeted re-review additionally caught a GET/autosave ordering
  gap and retry intent crossing classroom boundaries; per-edit acknowledgments
  and classroom-scoped retry state now fence both cases. A final ABA review
  found that returning to a classroom could make an earlier visit's save look
  current; queued saves now carry a monotonically increasing classroom epoch.
  Focused teacher/student regressions cover all corrections.
- Playwright verification passes for teacher/student desktop loaded and partial
  error states in light mode, loaded states in dark mode, and the existing
  mobile layout. Retry controls retain valid lesson data with no overflow.
- No composite control behavior changed; existing Calendar navigation semantics
  remain covered, and new alert/Retry behavior has focused role tests.

## 2026-08-16 — Serialize Calendar writes and retained retries

**Risk profile:** workspace-state — teacher lesson-plan mutation ordering and
teacher/student Calendar retry state; no API, schema, migration, production,
mobile redesign, or Gradex change.

**Completed:**
- Serialized inline, bulk, and unload lesson-plan writes per classroom across
  component remounts so older requests cannot commit after newer edits.
- Retained failed inline saves with bounded automatic retries, scoped pending
  edits by classroom, and blocked bulk markdown saves until inline drains
  succeed.
- Replaced unload beacons with explicit keepalive `PUT` requests and exposed
  retained class-day refreshes as pending without clearing their prior error.

**Validation:**
- Full suite passes: 4,295 tests across 495 files. Production build, lint,
  TypeScript, architecture, Pika audit, and diff checks pass.
- Focused regressions cover server commit order, inline-before-bulk order,
  failed-write retry, unload method/payload, and teacher/student class-day
  retry focus through failure and recovery.
- Playwright verification passes for teacher/student desktop/mobile and
  light/dark Calendar views plus the retained `Retrying class days` state.

## 2026-08-16 — Make Calendar mutations durable across unload and classroom switches

**Risk profile:** schema-and-workspace-state — teacher lesson-plan ordering,
bulk draft ownership, and visible save recovery; migration 125 was applied to
the shared local database only. Production was not modified.

**Completed:**
- Added a durable per-browser-session ordering head and atomic lesson-plan
  mutation function so reversed save/delete completion cannot overwrite newer
  teacher intent, including direct keepalive requests during unload.
- Retained queued and in-flight inline saves through page unload, with database
  sequence fencing making repeated keepalive delivery idempotent.
- Fenced bulk-save completion by classroom epoch, retained failed classroom
  drafts by revision, and prevented delayed or identical-payload responses from
  closing or clearing newer work.
- Added bounded inline retries with an explicit manual Retry action after
  exhaustion, preserving the exact unsaved lesson content.
- Migrated the date and bulk request bodies to feature-owned Zod schemas and
  removed both routes from the API validation debt baseline. Calendar dates
  are now validated as real dates before any bulk write begins.
- Registered the durable mutation-head table as purge-only operational data and
  included its exact PostgreSQL count in the purge stability digest and durable
  operation inventory without archiving it. Mutation-head writes now obey the
  classroom purge fence.

**Validation:**
- Full suite passes: 4,314 tests across 498 files. Production build, lint,
  TypeScript, generated Supabase type drift, Pika audit, and diff checks pass.
- Local PostgreSQL rollback tests prove newer-save/stale-save,
  newer-delete/stale-save, and newer-save/stale-delete ordering. RPC execution
  is denied to `anon` and `authenticated` and granted only to `service_role`.
- Independent review findings covering queue-blocked unload writes,
  identical-payload draft ownership, impossible calendar dates, and schema
  ownership were remediated with focused regressions. Rereview additionally
  found paginated, unfenced mutation-head purge accounting; migration 125 now
  computes and fences that count inside the database inventory. The local
  classroom schema audit passes across 198 foreign-key relationships.
- Playwright verification passes for the exhausted-save Retry alert in teacher
  light/dark views; the student Calendar remains visually unchanged. Mobile
  redesign remains explicitly deferred.

## 2026-08-16 — Complete Tests save-status accessibility

**Risk profile:** workspace-state — teacher test authoring and grading save
announcements plus cross-student grading draft retention; no visual styling,
mobile redesign, API, schema, migration, production data, or Gradex change.

**Completed:**
- Added one persistent polite atomic live region to teacher test authoring and
  grading so unsaved, saving, and saved transitions are announced without
  repeating the existing visual status labels.
- Kept stale authoring save responses from announcing false success and retained
  the existing selected-student grading workflow and class-wide table.
- Updated the product-experience audit: student flag/save accessibility was
  already complete, and Tests now has only deferred mobile navigation work.

**Validation:**
- Focused remediation coverage passes: 123 tests across `TestDetailPanel`,
  `TeacherTestsTab`, and `TestStudentGradingPanel`; TypeScript passes.
- The full suite passes: 4,318 tests across 498 files, and the production build,
  lint, Pika audit, and diff checks pass.
- Playwright verification passes for teacher grading, teacher authoring, and
  student Tests in desktop/mobile and light/dark. The change is visually neutral.
- Independent review found that an in-flight save could outlive a student
  selection change and publish its status under the newly selected student.
  The grading panel now emits operation-owned test/student scope while the
  parent gates announcements by classroom, test, and selected student. The
  shared grading draft map remains mounted across selection changes, and
  regressions prove stale completion is not announced while an A → B → A draft
  remains intact and autosaves. The post-fix grading-switch visual matrix also
  passes.

## 2026-08-16 — Complete Dashboard entry-detail recovery

**Risk profile:** workspace-state and accessibility — teacher Dashboard student
log detail only; no API, schema, migration, production, Gradex, or mobile
redesign change.

**Completed:**
- Replaced the hand-built student-log overlay with the canonical content dialog
  and explicit loading, ready, successful-empty, and retryable error states.
- Scoped each request to classroom, student, and date; closing the dialog,
  changing classrooms, or opening another student invalidates older responses.
- Preserved the compact detail width and existing attendance table, classroom
  selection, sorting, resizing, roster, and export workflows.

**Validation:**
- Focused Dashboard and modal suites pass: 20 tests. The full suite passes:
  4,323 tests across 498 files. TypeScript, lint, production build, Pika audit,
  and diff checks pass.
- Composite-widget checklist reviewed: keyboard behavior covered, semantic
  state covered by tests, and no manual accessibility follow-up remains.
- Playwright verification passes for teacher ready/loading/error states at
  desktop and mobile widths, ready state in dark mode, and the student-role
  redirect. Captures have no horizontal viewport overflow.
- Independent review found one non-blocking test gap. Added regressions proving
  Retry preserves the exact classroom/student/date scope and a pending entry
  cannot repaint after the selected classroom changes.
- Post-push UI policy caught the intentionally removed native close button in
  the exact control registry. The Dashboard debt count is updated from three to
  two; no exception or policy rule was weakened.
- Final integration review found Retry could unmount the focused action while
  leaving the dialog open. Retry now preserves the same button node as a named,
  aria-disabled in-progress action, keeping focus inside the modal until the
  request settles; a deterministic regression covers the transition.
- The exact design-value inventory now removes the retired raw scrim color and
  reduces the Dashboard raw z-index count from three to two.

## 2026-08-16 — Complete Roster recovery and accessibility

**Risk profile:** workspace-state and accessibility — teacher Roster loading,
removal, counselor editing, keyboard behavior, and the existing counselor PATCH
contract; no schema, migration, production, Gradex, or mobile redesign change.

**Completed:**
- Separated cold roster failures from successful empty classrooms, added
  focus-preserving Retry, and retained valid roster data during refresh errors.
- Kept committed removals visible when their follow-up refresh fails and moved
  removal errors into the confirmation dialog with deterministic retry focus.
- Replaced counselor-edit native controls with governed primitives, added
  descriptive field/action semantics and operation-scoped recovery, and fenced
  stale saves across students and classroom changes.
- Added optimistic concurrency to counselor updates through each roster row's
  existing `updated_at` revision, and scoped delayed add/upload completion to
  the classroom that was actually mutated.
- Fenced Add Students and CSV Upload internal loading, error, confirmation, and
  close state by classroom/open generation so an earlier classroom response
  cannot repaint or submit into the current classroom. Generations advance only
  in committed layout lifecycles, so an abandoned concurrent render cannot
  invalidate the still-visible classroom's request.
- Bound the roster workspace's classroom identity to committed layout lifecycles
  and refresh stale counselor revisions after conflicts while preserving the
  teacher's attempted value for retry.
- Added direct keyboard coverage for table selection and Escape focus return,
  plus regressions for overlapping loads, counselor saves, removal recovery,
  modal error semantics, and focus behavior.

**Validation:**
- Focused roster API, modal, table, and dialog suites pass: 91 tests. The full
  suite passes: 4,358 tests across 499 files. TypeScript, lint, production build, UI
  policy, design policy, architecture checks, Pika audit, and diff checks pass.
- Composite-widget checklist reviewed: direct keyboard behavior and semantic
  state are covered by tests, with no manual accessibility follow-up remaining.
- Playwright verification passes for teacher desktop/mobile ready and error
  states, selected and editing states, light/dark themes, and the student-role
  redirect. Captures have no horizontal viewport overflow.
- Mobile row detail for hidden primary and alt email fields remains deliberately
  deferred with the broader mobile UI/UX work.

## 2026-08-16 — Rename the roster contact slot

**Risk profile:** terminology-only — teacher roster, manual add, CSV upload, and
conflict copy; no schema, migration, API field, or production data change.

**Completed:**
- Renamed the user-facing `counselor_email` concept to “Alt email” across
  roster columns, actions, editing semantics, add/upload guidance, and errors.
- Retained the legacy database and API field for compatibility, with focused
  assertions preventing user-facing terminology drift.

**Validation:**
- Focused roster API and component suites pass: 92 tests. The full suite passes:
  4,359 tests across 499 files. TypeScript, lint, production build, UI policy,
  design policy, architecture checks, Pika audit, and diff checks pass.

## 2026-08-16 — Complete Gradebook desktop recovery

**Risk profile:** workspace-state and accessibility — teacher Gradebook reads,
assessment-weight refreshes, retry focus, and stale classroom ownership; no
schema, migration, production, Gradex, or mobile redesign change.

**Completed:**
- Separated cold Gradebook failures from successful empty classrooms with a
  governed loading/error state and explicit Retry recovery.
- Preserved the last valid assessment matrix during failed refreshes and kept
  the class-wide table, selected-student detail, sorting, selection, and column
  controls intact.
- Fenced overlapping reads and in-flight assessment-weight saves by committed
  classroom identity and per-assessment request generation so stale work cannot
  repaint another classroom and concurrent column saves each trigger a refresh.
- Restored focus to the named student table after successful cold or retained
  recovery, preserved Retry focus after another failure, and retained the
  existing direct keyboard row navigation and Escape behavior.

**Validation:**
- Focused Gradebook component, API, and architecture suites pass: 47 tests;
  the component suite now covers cold, empty, retained-refresh, stale-load,
  stale-save, retry-focus, and direct keyboard behavior.
- Full suite passes: 4,365 tests across 499 files. TypeScript, lint, production
  build, architecture, design/UI policy, Pika audit, and diff checks pass.
- Playwright verification passes for teacher loaded light/dark, cold-error
  light/dark, retained-refresh, and narrow loaded/error states with no viewport
  overflow. Gradebook is teacher-only; student role coverage is not applicable.
- Independent review found component-wide save ownership could suppress a
  concurrent column's final refresh and retained Retry success could lose
  focus. Per-assessment ownership and success-gated focus restoration resolve
  both findings; targeted rereview found no blockers, and the noted failed-retry
  test gap is closed.

## 2026-08-17 — Complete Syllabus iframe reliability

**Risk profile:** workspace-state and accessibility — shared teacher/student
Syllabus framing, readiness, failure recovery, and keyboard access; no schema,
migration, production, Gradex, legacy-resource deletion, or mobile redesign.

**Completed:**
- Replaced the duplicated teacher/student iframe markup with one shared,
  viewport-bounded `SyllabusPreview` and constrained the classroom Resources
  workspace to prevent competing desktop document scrolling.
- Added a compact external-open action, a named focusable iframe with a visible
  focus boundary, and removed the covered iframe from keyboard order until its
  document is ready.
- Added an explicit same-origin readiness handshake emitted only by the
  successfully hydrated syllabus page. The parent validates origin, source
  frame, and exact URL, so HTTP error documents remain hidden and outside
  keyboard order. A bounded timeout exposes Retry, which remounts the iframe
  with a fresh request while preserving the canonical public syllabus URL.
- Confirmed the old rich-text resource sidebars are unmounted; retained their
  APIs and data contract for a focused Phase 6 compatibility-led retirement.

**Validation:**
- Focused Syllabus, legacy resource-sidebar, and classroom-shell suites pass.
  The full bounded suite passes: 4,372 tests across 499 files.
  Component coverage includes loading, ready, unpublished, timeout, Retry,
  keyboard eligibility, and viewport ownership states.
- The durable Chromium matrix now intercepts real iframe navigations with HTTP
  404 and 500 documents and requires both to remain unavailable and
  unfocusable. It first proves a real published page completes the handshake
  and accepts keyboard focus. Local execution was blocked before that case by
  missing shared seed accounts; CI's seeded browser lane owns the repeatable
  run.
- Targeted review found that a settings-driven slug change could inherit the
  mounted preview's prior ready state. Teacher and student resource tabs now
  key the preview by syllabus URL, and regression coverage proves a new URL
  remounts loading, ignores a matching-URL signal from the stale frame, and
  times out unfocusable for both roles.
- Playwright verification passes for teacher/student desktop and narrow,
  light/dark loaded states plus the teacher failed-load state. Desktop outer
  scroll is `900/900`; focus moves from Open syllabus to the named iframe; no
  horizontal overflow was observed.
- TypeScript, lint, production build, architecture, design/UI policy, Pika
  audit, startup-context budget, session-log, and diff checks pass.
