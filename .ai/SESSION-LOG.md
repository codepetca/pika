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

## 2026-08-17 — Add session-expiry recovery

**Risk profile:** workspace-state and accessibility — shared teacher/student
reauthentication routing and the unauthenticated login state; no schema,
migration, production, Gradex, mobile, or student-history route change.

**Completed:**
- Added an explicit session-expiry reason to safe login redirects while
  preserving the interrupted path and query string.
- Closed backslash-based external redirect variants through one canonical
  same-origin path parser shared by redirect production and login consumption;
  canonicalized protocol-relative paths produced by dot segments are rejected
  after URL normalization as well.
- Added a persistent polite warning on the existing login card, associated it
  with the email field, and moved focus there for immediate recovery.
- Made the session watcher validate both user ID and role, with a distinct
  account-change recovery message. Ordinary authorization failures remain in
  place instead of being mislabeled as expired sessions.
- Added component and unit regressions for announcement, focus, safe redirect
  fallback, and return-path preservation, plus a seeded Chromium recovery flow
  that returns a teacher to the interrupted utility route after login.

**Validation:**
- Focused auth and Daily suites pass after review remediation. The final full
  suite passes: 4,391 tests across 500 files. TypeScript, lint, production
  build, architecture, design/UI policy, Pika audit, session-log, and diff
  checks pass.
- Desktop Playwright captures pass in light and dark for the shared
  unauthenticated recovery state. Teacher/student role-specific rendering is
  not applicable; both role return paths use this same login surface.
- CI's seeded browser and database-contract lanes pass. A repeated unrelated
  `TestDetailPanel` coverage-lane race was stabilized by waiting for its mocked
  initial reads before clicking Preview and allowing the async save assertion
  the same bounded time it receives under full-suite coverage load.
- The `/student/history` compatibility decision remains the next independent
  slice.

## 2026-08-17 — Retain and clarify student attendance utility

**Risk profile:** none — compatibility-preserving student utility cleanup; no
schema, migration, production, Gradex, or mobile redesign work.

**Completed:**
- Confirmed `/student/history` is attendance history rather than assignment or
  test history. It remains the only cross-classroom full class-day summary;
  classroom Today intentionally loads only the latest submitted logs, so a
  redirect would lose absent and pending records.
- Preserved the stable URL, changed its visible navigation label to Attendance,
  and moved class-day row construction into the tested attendance domain.
- Removed the unmounted duplicate `StudentHistoryTab` and its isolated tests.
- Replaced feature-local native controls and the hand-built log modal with
  shared controls, keyboard-operable rows, and governed dialog focus return.

**Validation:**
- The full suite passes: 4,390 tests across 499 files. A first run exposed only
  a 17-character startup-context overage from the continuity update; the
  summary was tightened and its complete 38-test contract rerun passed.
- TypeScript, lint, production build, architecture, design/UI policy, Pika
  audit, session-log, and diff checks pass. Six stale native-control and raw
  design-value exceptions were removed with the legacy implementation.
- Playwright passes the student utility contract across desktop/mobile and
  light/dark with no horizontal overflow. Loaded and empty states were visually
  inspected; the shared dialog passes both desktop themes and returns focus.
- Independent compatibility review was clean. Accessibility review found that
  the submitted-log button name hid its visible attendance status; the name now
  includes date, status, and action, with a focused regression test and targeted
  rereview.

## 2026-08-17 — Organize Settings and decide student grades/profile scope

**Risk profile:** none — teacher Settings organization and durable product
decisions; no API, schema, migration, production, Gradex, or mobile redesign.

**Completed:**
- Split the existing teacher Settings surface into stable URL-backed General,
  Access, Syllabus, Class Days, and Reuse sections without changing the fields,
  save behavior, archived read-only behavior, or underlying routes.
- Kept the shared keyboard-operable segmented control and added narrow-screen
  containment so section navigation cannot widen the page.
- Recorded that returned assignment/test feedback remains the student grade
  surface until aggregate disclosure, weighting, hidden-work, and incomplete-
  work semantics are defined.
- Recorded that standalone student profile editing remains declined until one
  source of truth and synchronization contract exists for global profiles and
  classroom roster names.

**Validation:**
- The 26-test Settings component suite passes, including cross-section state
  reset, stale URL fallback, save/error behavior, archived read-only behavior,
  syllabus preferences, enrollment, and blueprint capture.
- The full run passed all 4,390 behavior tests; its only failure was a
  19-character startup-context overage, then the tightened summary passed the
  complete 38-test startup contract.
- TypeScript, lint, production build, architecture, design/UI policy, Pika
  audit, and diff checks pass.
- Playwright captures pass for every section at desktop and 390px in light and
  dark. Each URL selects the intended section, body width equals viewport width,
  and the teacher surface remains visually consistent. Student is not affected.
- Independent review found the unpublished-syllabus recovery action still
  opened bare Settings. It now uses in-app navigation directly to the Syllabus
  section, with a focused resources regression.

## 2026-08-17 — Blueprint rollover retry and review handoff

**Risk profile:** none — teacher-only blueprint rollover reliability and review
UX; no schema, migration, production, archive cleanup, or Gradex work.

**Completed:**
- Classroom capture and blueprint instantiation now retain one UUID operation
  key while the same semantic request is retried, then clear it after success.
- Blueprint-created classrooms remain in the create dialog for a focused review
  handoff that states assignments/tests are unpublished, calls out due-date and
  release review, lists lesson plans that did not fit the chosen calendar, and
  opens the new classroom's Assignments tab from every parent surface when the
  teacher explicitly selects Review Classroom.
- Blueprint completion refreshes parent classroom state through a non-routing
  callback. Escape/backdrop dismissal only closes the completed handoff, and
  dismissal is blocked while instantiation is pending so its operation key
  cannot be discarded before the request settles.
- Dashboard and Calendar keep one stable modal instance when the first created
  classroom replaces their empty state, preserving the completed review
  handoff until the teacher explicitly reviews or dismisses it.
- The completed step moves focus to its heading and preserves the existing
  dialog, progress, and continuation patterns.

**Validation:**
- Focused component coverage proves both same-key retry paths, delayed success
  completion, in-flight dismissal blocking, non-routing completion callbacks,
  empty-state handoff preservation, overflow rendering, and focus transfer. The
  full suite passes all 4,394 tests across 499 files; TypeScript, lint,
  production build, Pika audit, and diff checks pass.
- Playwright verifies the teacher-only overflow handoff at desktop/mobile in
  light/dark, including a browser-sent UUID operation key and no horizontal
  overflow. Student rendering is not applicable to this teacher creation flow.
- Composite checklist reviewed: yes. Keyboard behavior covered: yes. Semantic
  state covered by tests: yes. Remaining manual follow-up: none.

## 2026-08-17 — Course package import retry identity

**Risk profile:** none — teacher-only client retry behavior; no API, schema,
migration, production, archive cleanup, Gradex, or student behavior changes.

**Completed:**
- Added one shared browser-safe package operation helper used by both teacher
  import entry points. It normalizes JSON, compares exact TAR bytes, retains one
  caller UUID for unchanged retries, and replaces the key when content changes.
- Import identity now survives retryable network/server failures and clears
  after success, wizard cancellation, or component teardown. Synchronous guards
  prevent concurrent file submissions from creating competing operation IDs.
- The Blueprints page disables and relabels its import action while a request is
  pending; the classroom wizard retains its existing busy-state behavior.

**Validation:**
- Thirty focused component/API tests cover JSON and TAR headers, semantic JSON
  retries, exact archive retries, changed bytes, success/cancellation clearing,
  both import entry points, pending-request suppression, and the existing route
  contract.
- The full suite passes all 4,405 tests across 499 files.
- TypeScript, lint, architecture, production build, Pika audit, and diff checks
  pass.
- Teacher desktop/mobile light/dark screenshots remain clean. An intercepted,
  non-mutating request verifies the disabled importing state without layout
  shift or clipping. Student is not affected by this teacher-only route.

## 2026-08-17 — Blueprint import review-gap coverage

**Risk profile:** none — test-only follow-up; no runtime, UI, API, schema,
migration, database, production, Gradex, or student behavior changes.

**Completed:**
- Added dedicated Blueprints-page coverage for normalized JSON retry identity,
  changed-content key replacement, and operation-key clearing after success.
- Added classroom-wizard coverage proving a pending package import suppresses a
  second file submission until the first request settles.
- Independent review's P3 maintainability finding was fixed by scoping the
  suppression assertion to package-import requests instead of all global fetches.
- Targeted re-review's P1 false-positive finding was fixed by also proving the
  second event never re-enters asynchronous package preparation.

**Validation:**
- All 27 focused component tests and all 4,407 repository tests pass.
- TypeScript, lint, architecture, production build, diff checks, and Pika audit
  pass. Visual verification is not applicable to this test-only patch.

## 2026-08-17 — Blueprint editor dirty-state protection

**Risk profile:** none — teacher-only Blueprint editor reliability and shared
status/dialog UI; no API contract, schema, migration, production, archive,
Gradex, or student behavior changes.

**Completed:**
- Added a normalized saved baseline for every independently editable Blueprint
  section: course details, planned site, grading, and each Markdown package tab.
- Saving one section now refreshes accepted server state only for that section,
  preserving unsaved work elsewhere. Editor writes are locked while a save,
  import, or proposal application can replace accepted state.
- Every selected-Blueprint transition invalidates stale detail requests and
  clears the previous editor before the new detail loads, including successful
  package import and new-Blueprint creation.
- Blueprint changes, local route actions, authority changes, imports, and
  proposal application now require explicit discard confirmation. Export and
  classroom creation explicitly confirm that they use the last saved version.
- Permanent deletion also requires the local-discard confirmation before its
  existing durable purge review. Blueprint-list reloads use request generations
  so older responses cannot overwrite newer post-mutation state; purge
  completion starts a fresh authoritative guarded reload.
- Preparing a classroom update now confirms that it uses the last saved
  Blueprint and is disabled while a save can replace accepted state. Proposal
  and classroom-comparison requests use independent generations so returning to
  the same Blueprint cannot surface an older response. Blueprint selection is
  locked while that durable proposal is being prepared, and its global lock is
  cleared defensively when the request settles.
- The editor exposes shared Saved/Saving/Unsaved status and protects browser
  refresh or tab closure while any section differs from its saved baseline.

**Validation:**
- Twenty-eight focused unit/component tests cover per-section comparisons,
  cross-section save preservation, accepted server values, transition guards,
  import/create/list/proposal/comparison races, deletion, saved-version actions,
  unload protection, and in-flight editor locking.
- Teacher desktop/mobile light/dark Playwright captures verify the dirty state
  and saved-version dialogs with no horizontal overflow and initial focus on
  Keep editing. Student rendering is not applicable to this teacher-only route.
- The full suite passes all 4,425 tests across 500 files. TypeScript, lint,
  architecture boundaries, production build, Pika audit, and diff checks pass.

## 2026-08-17 — Classroom-to-Blueprint rollover browser drill

**Risk profile:** none — local-only E2E verification and documentation; no
application behavior, schema, migration, or production state changed.

- Added `pnpm e2e:verify blueprint-rollover`, which drives the seeded `TEST01`
  classroom through Settings → Reuse, Blueprint review, classroom creation, and
  the assignment date/release review handoff against the real local stack.
- The drill compares reusable titles, artifact lineage, nested requirement and
  question content, assignment instructions, lesson content, syllabus/resources,
  and grading configuration. It proves that assignments/tests return as drafts
  while enrollments, roster rows, logs, submissions, and test attempts stay out.
- Added loopback-only guards for the app, Supabase API, and database; the drill
  refuses managed-upload source fixtures and removes its generated local records.
- Captured and visually inspected Blueprint review, classroom-created handoff,
  and assignment review screenshots. The initial 33 browser checks passed.
- Verification: the clean full suite passes all 4,432 tests. Production build,
  lint, typecheck, architecture boundaries, Pika audit, and diff checks pass.

**Independent review remediation:**
- Added temporary non-empty material, survey/question, assignment-requirement,
  announcement, and announcement-read fixtures. Announcements are now correctly
  asserted as excluded live state rather than reusable Blueprint content.
- Expanded lineage checks to every reusable parent and child plus the immutable
  Blueprint Version used to create the classroom.
- Snapshot and restore the shared source classroom's identity, provenance, and
  revision fields; delete only the drill's exact operation rows; and assert the
  source, operation ledger, storage inventory, and generated fixture inventory
  all match their pre-drill state after cleanup.
- The remediated browser drill passes all 42 checks. Managed-upload rollover is
  explicitly outside this drill and remains follow-up package compatibility work.
- Targeted re-review hardened the cleanup coordinator so known records are
  restored even when fallback discovery fails, with a focused failure-path
  regression test. It also binds the instantiated Version to the captured
  Blueprint, checks each nested child's cloned-parent lineage, and requires a
  non-empty source roster before asserting roster exclusion.
- Final integration review bound operation cleanup to the browser requests'
  exact idempotency keys, preallocated every temporary fixture ID before writes,
  added non-empty test-response exclusion, checks both target artifact identity
  columns, and verifies reusable test documents/settings. The browser drill now
  passes 44 checks and restores the temporary source test document as part of
  its baseline.
- An explicitly approved fourth remediation batch now records each valid browser
  operation ID before allowing its request onto the network and includes a real
  browser failure-path probe proving a missing key creates no ledger result.
- Submitted-document coverage now filters `assignment_docs.is_submitted = true`
  so drafts cannot satisfy the live-data precondition. A temporary assignment
  with non-default due timing, points, weight, final-grade exclusion,
  authenticity tracking, and position makes the reusable comparison
  non-vacuous; material and survey positions are also compared.
- The remediated local browser drill passes all 47 checks and visually shows the
  four draft assignments followed by the material and survey. Focused unit tests
  pass all 11 cases. The full suite passes all 4,436 tests across 501 files;
  TypeScript, lint, architecture boundaries, production build, Pika audit, and
  diff checks pass.

## 2026-08-17 — Course Package versioned contract core (PR A)

**Risk profile:** high — foundational untrusted package boundary and historical
compatibility; no schema migration, production operation, dependency, or UI
change.

**Completed:**
- Verified the historical v2-v5 file matrix against repository history and the
  evidence in draft PR #1018: v2 requires the six reusable legacy files and
  optionally accepts/discards `quizzes.md`; v3/v4 require exactly those six;
  v5 requires exactly the current eight.
- Replaced the shared v5-shaped raw record with strict discriminated wire types,
  per-version manifest schemas, and an explicit required/allowed file registry.
  Raw schemas no longer synthesize missing files.
- Added one evidence-preserving verifier shared by direct JSON and TAR inputs.
  Historical adapters run only after verification and produce one canonical
  portable course model.
- Added independently built, SHA-locked JSON and binary TAR fixtures for every
  supported version plus table-driven parity mutations for required/forbidden/
  duplicate entries, manifests, UTF-8/checksum failures, and size boundaries.
- Preserved useful PR #1018 retry evidence by making legacy Artifact identity
  deterministic per import operation and canonicalizing operation UUIDs.

**Validation:**
- The focused package contract suite passes 91 cases. The authoritative full
  verification passes all 4,528 tests across 502 files, lint, architecture
  boundaries, and the production build. Pika audit and diff checks pass.
- Visual verification is not applicable because this PR changes no UI.

**Independent review remediation:**
- Raw JSON now remains bytes until the package boundary, uses fatal UTF-8
  decoding, rejects duplicate keys at every object depth and leading BOMs,
  preserves the exact received text, and applies the same 2 MiB manifest-entry
  limit as TAR.
- Verified bundles and raw evidence are defensively cloned, deeply frozen, and
  exposed through a branded verified type so caller mutation cannot rewrite
  evidence or change what a later adapter sees.
- TAR verification now requires block alignment, zero entry padding, and two
  complete zero terminator blocks; truncated and non-aligned zero tails fail.
- Upload-document and managed-storage semantic policy remains deliberately
  deferred to PR B, matching the requested phase sequence.

## 2026-08-18 — Tighten the v3 Course Package manifest contract

**Risk profile:** high — strict historical compatibility boundary; no schema,
production, dependency, or UI change.

- Replaced the permissive v3 planned-site catchall with the exact historical
  seven-key shape, including the retired `quizzes` key.
- Removed unsupported `retired_navigation` evidence from the immutable v3 JSON
  and TAR fixtures and updated their locked SHA-256 digests.
- Added direct JSON/TAR parity coverage proving unknown v3 planned-site keys
  fail as `invalid_manifest` before adaptation.
- Full verification passes 4,529 tests across 502 files, lint, and the
  production build. Pika audit and diff checks pass.

## 2026-08-18 — Preserve both strict v3 planned-site forms

**Risk profile:** high — historical package compatibility boundary; no schema,
production, dependency, or UI change.

- Kept the v3 planned-site schema strict while allowing only the historically
  evidenced `quizzes` key to be omitted or supplied as a boolean.
- Added JSON/TAR parity coverage for the six-key v3 compatibility form and
  proved it adapts to the same portable content as the original seven-key form
  while preserving distinct raw source manifests.
- Retained rejection coverage for arbitrary v3 configuration keys and updated
  the package contract documentation.
- Full verification passes 4,530 tests across 502 files, lint, and the
  production build. Pika audit and diff checks pass.

## 2026-08-18 — Emit Pal adaptive term calendars prospectively

**Risk profile:** runtime-platform — additive external contract and
transactional delivery behavior; no migration, historical backfill,
dependency, or UI change.

- Updated the vendored Pal v1 contract and fixtures to Pal main commit
  `88bab8e30319089e45d7f5e129e76dd265bc2b4c`, including the complete adaptive
  term calendar accepted by the guaranteed weekly story scheduler.
- Added a stable Monday-aligned Toronto academic calendar and opaque HMAC term
  tokens. Current open weekly configurations gain one monotonic calendar
  revision; historical calendar-less catch-up weeks remain calendar-less, while
  later closures preserve any calendar already emitted.
- Preserved the atomic weekly-configuration/outbox RPC, existing Pal sync cron,
  privacy allow-list, stable idempotency keys, leases, retry classification,
  and bounded recovery. Pika emits no collectible, finish-tier, XP, or
  achievement calculations.
- Added contract, calendar, planner, outbox, vertical integration, and guarded
  local Postgres/HTTP recovery coverage. All 4,544 tests across 504 files,
  TypeScript, lint, architecture/UI/design policy, production build, real
  outbox recovery, and PostgreSQL concurrency checks pass.
- After the initial registry lookup returned 404, alpha.3 was published and the
  public `alpha` dist-tag moved to it. Pika now pins
  `@codepet/pal-widget@0.1.0-alpha.3` exactly and tests Pal-owned story finish,
  title, and roadmap collectible presentation through the existing Pika hosts.
  Playwright verification covers student desktop/mobile, light/dark,
  sketch/full-color roadmap states, and the open story reward dialog; teacher
  views remain unaffected.
- Independent review added winter-term and Toronto DST boundary coverage,
  proved retries preserve the original producer timestamp, and made the real
  recovery smoke remove and verify every fixture row. Pal main still compares
  story eligibility with ingestion time instead of the preserved producer
  timestamp; correcting that cross-service cutoff and proving the delayed
  boundary case is a rollout blocker outside this Pika-only PR.

## 2026-08-18 — Verify Pal source-timestamp rollout dependency

**Risk profile:** documentation and cross-service verification only; no Pika
runtime, contract, schema, dependency, privacy, or UI change.

- Verified merged Pal PR #73 at `2c4f71389db978e495af42f9d494b9de2bf8354a`
  adds append-only migration `0010_story_source_timestamps.sql` and uses
  producer `learner_facts.occurred_at` for story eligibility, lateness,
  terminal effective due time, and protection/reconstruction checks.
- Verified Pal's persisted-ingest test uses Pika's seven-field adaptive calendar,
  accepts a pre-boundary fact delivered after the boundary, rejects a truly late
  fact, and proves a retry with the same idempotency key remains a duplicate.
- Confirmed Pal PR #73 CI is green, the public widget remains exactly
  `@codepet/pal-widget@0.1.0-alpha.3`, and Pal changed no contract or widget
  source after Pika's vendored contract commit.
- Updated the pilot runbook to name the required Pal migration and record that
  the code-level blocker is cleared. Applying it in a target Pal environment
  remains Pal-controlled; Pika performs no deployment or historical backfill.

## 2026-08-18 — Course Package portable policy and integration (PR B)

**Risk profile:** high — application-layer untrusted package semantics and
write-path authorization; no schema migration, production operation,
dependency, or UI change.

- Added a strict package-owned Test document union. Portable packages admit
  exact link and embedded-text records only; uploads and runtime storage or
  snapshot fields fail before a canonical plan is produced.
- Export construction selects portable fields explicitly and omits upload
  documents, managed-origin URLs, and all runtime storage state.
- Centralized origin-aware managed URL classification, including encoded paths,
  while allowing matching paths on external origins. Parsed structured URLs are
  authoritative; freeform Markdown scanning is defense in depth.
- Import and repository-proposal routes now share the same bounded JSON package
  planner once and pass only a branded verified canonical plan to server write
  operations. Invalid input never reaches import/proposal RPC or managed-storage
  work.
- Added source, runtime-field, origin/encoding, direct/JSON/TAR, route parity,
  byte-limit, and no-side-effect matrices.
- Full verification passes 4,555 tests across 503 files, lint, type checking,
  and the production build. Pika audit and diff checks pass. Visual verification
  is not applicable because this change has no UI surface.

**Independent review remediation:**
- Expanded the managed-storage abstraction to cover Supabase image-render
  routes, encoded relative paths, and trailing DNS-root aliases (including
  encoded dots) while preserving exact scheme and port checks.
- Added structured/freeform bundle, JSON, TAR, export-filter, import-route, and
  proposal-route regressions for every bypass. Invalid inputs are rejected
  before any server write-capable operation is called.
- Remediated full verification passes 4,566 tests across 503 files, lint, type
  checking, and the production build.
- A targeted re-review found fully encoded leading slashes still escaped the
  representation-specific freeform extractor. Replaced URL-shape matching with
  bounded Markdown tokenization so literal, encoded, double-encoded, inline-link,
  absolute, and protocol-relative candidates all reach the one classifier.
- The second remediated full verification passes 4,573 tests across 503 files,
  lint, type checking, and the production build.
- After the same freeform extraction category recurred around valid object-key
  punctuation, the human-approved third remediation moved the policy boundary:
  any recognized managed route through a managed bucket is rejected at the
  bucket boundary, without depending on successful object-key tokenization.
- Added structured, freeform, JSON/TAR, import, and proposal regressions for
  parenthesized and comma-prefixed object keys plus bucket-root object and image-
  render routes. The third remediated full verification passes 4,583 tests
  across 503 files, lint, type checking, and the production build.
- A targeted security re-review found the same extraction category in URL
  userinfo containing delimiter characters. At the required human checkpoint,
  the owner approved a fourth remediation and extended review budget.
- Replaced delimiter tokenization with a bounded, single-pass URL/Markdown
  candidate scanner. It preserves complete non-whitespace destinations and
  authorities, recognizes absolute, protocol-relative, literal-relative, and
  encoded-relative starts, and fails closed on excessive candidate spans/counts.
- Added bundle/JSON/TAR and import/proposal no-write regressions for `=`, `;`,
  `,`, and `|` userinfo plus external-origin, protocol, port, and labeled-relative
  negatives. The fourth remediated full verification passes 4,595 tests across
  503 files, lint, type checking, and the production build.

## 2026-08-19 — Close unbounded encoded-path package bypass

**Risk profile:** high — untrusted package semantic boundary and write-path
authorization; no schema migration, production operation, dependency, or UI
change.

- Rebased PR B onto `origin/main` at `370750d7`; the only conflict was historical
  continuity archive content, resolved in favor of current `main`. No migrations
  were added or renamed and no task stash remains.
- Replaced fixed encoded-slash depth enumeration with a grammar-based candidate
  recognizer: a boundary-leading percent sign, any number of encoded-percent
  `25` layers, and a final encoded slash `2f` are handed to the centralized
  bounded decoder. Over-depth values therefore reach its fail-closed policy.
- Added direct bundle/JSON/TAR parity and import/proposal no-write coverage for a
  four-times-encoded managed path, while proving ordinary percent text remains
  portable.
- Refreshed this worktree from the already-committed frozen lockfile after the
  rebase so current `main`'s Pal alpha.3 tests used alpha.3 instead of stale
  alpha.2 installation state; this PR changes no dependency declarations.
- Full verification passes 4,611 tests across 505 files, lint, type checking,
  and the production build. Visual verification is not applicable because this
  change has no UI surface.

## 2026-08-19 — Close proposal TAR transport parity gap

**Risk profile:** high — untrusted package transport dispatch at both
application entry points; no schema migration, production operation,
dependency, or UI change.

- Centralized content-type-aware JSON/TAR planning in the bounded package
  request module and made both import and repository-proposal routes call it.
  Valid exported TAR packages can now reach proposal construction through the
  same verified canonical plan as direct JSON packages.
- Expanded entry-point coverage so every portable semantic rejection case runs
  through JSON and an independently encoded TAR at both routes, remains
  response-identical, and cannot reach server or managed-storage operations.
- Added valid JSON/TAR assertions proving import and proposal entry points pass
  the same canonical plan downstream.
- Full verification passes 4,613 tests across 505 files, lint, type checking,
  and the production build. Pika audit and diff checks pass. Visual verification
  is not applicable because this change has no UI surface.

## 2026-08-20 — Verify public planned-course sites

**Risk profile:** runtime-platform — public content-exposure and publication
lifecycle behavior; no migration, production operation, dependency, archive
cleanup, or Gradex change.

**Completed:**
- Added deterministic published and unpublished planned-course fixtures to the
  standard local/CI seed path without coupling them to the legacy seed runner.
- Reworked `/planned/[slug]` into a scan-friendly section layout with semantic
  headings, keyboard-visible section navigation, responsive containment, and
  consistent Tests terminology.
- Added a route-specific generic not-found state so unpublished and unknown
  slugs share the same privacy-preserving response.
- Added component and Playwright coverage for publish/unpublish behavior,
  desktop/mobile light/dark rendering, keyboard focus, overflow, safe resource
  links, and exclusion of private prompts, answer keys, documents, and IDs.

**Validation:**
- `pnpm seed` passes with the isolated planned-course fixture runner.
- Full verification passes 4,614 tests across 506 files, lint, type checking,
  and the production build. Architecture, UI policy, design policy, Pika audit,
  and diff checks pass.
- The final Playwright experience matrix passes 36 tests with 14 intentional
  project skips. All eight published/not-found desktop/mobile light/dark
  screenshots were visually reviewed with no overflow or overlap findings.
- Composite-widget checklist reviewed: keyboard behavior and semantic section
  navigation are covered; no manual follow-up remains.

**Model recommendation:** Sol with high reasoning for the public content-
exposure boundary and cross-route publication lifecycle.
