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

## 2026-08-28 — Consolidate selected-Test actions menu

**Risk profile:** none — teacher Test grading UI and shared menu focus behavior only.

- Moved Edit Test into the selected Test grading view's three-dot menu beside
  Delete Test on every viewport, and renamed the trigger tooltip and accessible
  label to More actions.
- Fixed shared work-surface menus to restore focus after Escape/click-away and
  to hand dialog focus back to the menu trigger after a menu action.
- Added component and browser coverage for menu contents, tooltip copy, focus
  restoration, and open-menu screenshots. Focused Vitest (70/70), lint,
  architecture boundaries, and the light/dark desktop/mobile grading matrix pass.
- Confirmed the selected-screen Active label is raw Test lifecycle state and can
  be misleading for archived Classrooms or fully closed student access; no status
  presentation change was included in this task.

## 2026-08-28 — Repair post-134 database lint findings

**Risk profile:** runtime-platform — replacement PL/pgSQL definitions for the
individual-student purge failure path and the legacy archive snapshot engine;
no persistent local, staging, or production migration was applied.

- Added migration 135. `fail_student_purge_object` now qualifies the joined
  retry expression as `object.attempt_count`, fixing the reproduced PostgreSQL
  `42702` runtime failure. The archive-v082 actor temp table was proven safe at
  runtime by the existing rollback regression; its lint finding was a
  `plpgsql_check` limitation, resolved with runtime-bound, explicitly
  `pg_temp`-scoped dynamic references while preserving archive behavior.
- Extended the rollback-only student-purge database fixture through the real
  storage-deletion failure path. It now proves object/operation failure state,
  error evidence, exponential backoff, lease cleanup, stale-lease rejection,
  and a fresh retry lease before successful completion.
- Independent high-risk review found and remediation added operation-first row
  locking plus post-lock live-lease validation, preventing a deadlock or stale
  failure write when an expired lease is reclaimed concurrently. A disposable
  two-session regression now proves the stale reporter waits, loses authority,
  and cannot overwrite the replacement lease or operation retry state.
- The disposable race harness accepts only its reserved database-name prefix
  and drops the database only after a successful create, so an unsafe override
  or pre-existing database cannot be removed during failed setup.
- Replayed migrations 001-135 from scratch in a disposable isolated Supabase
  project. Error-level database lint reports zero findings and is now an
  all-schema, fail-on-error CI gate; focused student
  purge and archive database contracts, generated database types, 5,172-test
  coverage, TypeScript, lint, architecture/UI/design policies, migration
  lineage, diff/shell checks, the Pika audit, and the production build pass.

**Model recommendation:** GPT-5.6 Sol for high-risk PostgreSQL migration and
static-analysis/runtime reconciliation.

## 2026-08-28 — Preserve linked Tests during Blueprint purge

**Risk profile:** runtime-platform — pending migration 134 trigger semantics;
no migration was applied, no database was reset, and no hosted state changed.

- Extended the owner-only provenance exception so Blueprint purge finalization
  may clear only `test_questions.source_blueprint_version_id` and `updated_at`
  after student work exists. Authored Test content and identity remain frozen.
- Added a transactional database regression covering an active linked Test,
  question, submitted attempt, and response. The old trigger fails purge
  permanently; the revised trigger completes purge while preserving all Test
  and student-work records and clearing only Blueprint lineage.
- Full Vitest passes (588 files, 5,168 tests), as do focused migration tests,
  lint, the production build, SQL diff validation, and transaction-only local
  before/after database proofs. Migration 134 remains unapplied to production.

**Model recommendation:** current frontier coding model for the bounded
PostgreSQL trigger and deletion-contract fix.

## 2026-08-28 — Complete Blueprint identity and database-lint rollout

**Risk profile:** runtime-platform — protected production release, hosted
migrations 134–135, and authenticated production Blueprint verification.

- Merged the reviewed Test-question identity and Blueprint purge corrections
  through production, then applied migration 134 after an exact clean preflight.
  Production migration history matched local through 134 and the production
  Blueprint capture/reuse smoke passed with a real disposable student attempt.
- The smoke verified portable Test-question identity and ordering across initial
  reuse and recapture/current reuse. Assignments, materials, and Tests copied;
  student enrollment, attempts, responses, submissions, grades, and activity did
  not. The source submission remained intact.
- Merged PR #1097 and applied migration 135 after a sole-migration production
  dry run. Production now matches local through 135, a second dry run is empty,
  and error-level database lint reports zero findings.
- Full PR CI covered migration replay, Test identity rehearsal, student-purge
  failure concurrency, archive recovery, browser matrices, 5,172 tests, lint,
  TypeScript, and the production build.

**Model recommendation:** GPT-5.6 Sol for production migration and concurrency
verification; GPT-5.6 Terra for release compatibility and continuity review.

## 2026-08-28 — Repair Classroom and Blueprint purge finalization

**Risk profile:** runtime-platform — migration 137 changes trusted purge trigger
semantics, cross-purge ordering, and retained retry evidence; production remains
unchanged and migration 137 is not authorized for hosted application.

- Reproduced the retained smoke failure against a production-schema clone. Hot
  Classroom purge deleted `test_questions` before `test_attempts`, so migration
  134's student-work freeze correctly rejected the direct question deletion.
- Migration 137 permits only owner-run whole-Classroom finalization to delete
  those questions; ordinary authored Test changes remain frozen. The database
  regression now includes a closed Test, question, submitted attempt, and
  response and proves the complete Classroom graph is deleted.
- Added explicit Classroom/Blueprint purge ordering. A linked purge fence blocks
  the second deletion from starting. One canonical lineage relation now covers
  direct, proposal, operation, and editing-session links for atomic advisory
  locking, conflict detection, and upgrade repair. Three synchronized two-session
  database races prove exactly one purge installs a fence for indirect links.
  The fixture identifies each backend, proves the coordinator owns the pair
  lock and both contenders are waiting before release, and runs in the CI
  Architecture Database Contracts job.
- Preserved the cold-Classroom lifecycle fence that migration 122 added. A
  rollback database regression proves both the shared guard and cold tombstone
  trigger still reject mutations while a cold purge is active.
- Legacy interleaved operations drain in Classroom-then-Blueprint order. The
  retained-failure repair now includes operation-only and editing-session-only
  links and is covered by a database fixture for both omitted upgrade shapes.
- Expanded both rollback-only purge contracts for linked versions, completed
  capture lineage, applied proposals, retained fences, and worker-role access.
  Before the rebase/resequence, a clean 001-136 replay, all four database
  contracts, 5,181 tests, lint, build, and database lint passed; lint reported
  only established warning-level findings. CI will replay the resequenced
  migration 137 after main's new migration 136.
- During the isolated replay, `supabase db reset --db-url` recognized the local
  container and recreated its default local database rather than the named
  disposable database. No hosted database was touched. The local database was
  a clean replay of the pre-resequence branch through its former migration
  136. No hosted environment was changed.

**Model recommendation:** GPT-5.6 Sol for migration, trigger, and concurrent
deletion review; GPT-5.6 Terra for compatibility and operability review.

## 2026-08-28 — Preserve linked Tests during Blueprint purge

**Risk profile:** runtime-platform — pending migration 134 trigger semantics;
no migration was applied, no database was reset, and no hosted state changed.

- Extended the owner-only provenance exception so Blueprint purge finalization
  may clear only `test_questions.source_blueprint_version_id` and `updated_at`
  after student work exists. Authored Test content and identity remain frozen.
- Added a transactional database regression covering an active linked Test,
  question, submitted attempt, and response. The old trigger fails purge
  permanently; the revised trigger completes purge while preserving all Test
  and student-work records and clearing only Blueprint lineage.
- Full Vitest passes (588 files, 5,168 tests), as do focused migration tests,
  lint, the production build, SQL diff validation, and transaction-only local
  before/after database proofs. Migration 134 remains unapplied to production.

**Model recommendation:** current frontier coding model for the bounded
PostgreSQL trigger and deletion-contract fix.

## 2026-08-28 — Restore selected-student Attendance actions

**Risk profile:** standard application behavior — teacher Attendance selection
and batch-action composition changed; existing permissions, command polling,
QR provenance, API/schema behavior, authentication, and student UI are unchanged.

- Restored row and select-all checkboxes plus the persistent Student actions
  menu, disabled with no selection and labeled with the selected count when
  enabled. Removed the superseded whole-roster Present/Late/Absent controls.
- Retained the inline per-student Present/Late/Absent segmented control,
  Check-in time, and QR correction Undo. Removed only the visible `Status`
  column-header label while retaining accessible sortable status counts.
- Preserved the joined date navigator, centered session/action hierarchy, quiet
  utilities, compact internally scrolling roster, sticky sortable/resizable
  headers, archived/closed-state permissions, and mobile action access.
- Refreshed desktop/mobile light/dark evidence for default, selected, open-menu,
  manual-with-Undo, and hours states. The Tailscale gallery on port 8792 was
  refreshed and left running. Durable guidance changed only where its
  Attendance-specific mapping described the superseded whole-roster direction.
- Composite-widget accessibility checklist reviewed: yes; keyboard behavior
  covered: yes; semantic selection, menu, sortable-count, and pressed-state
  behavior covered by tests: yes; remaining manual follow-up: none.

**Verification:** focused component/UI tests (25/25), responsive Attendance
Playwright matrix (4/4), TypeScript, lint, production build, architecture,
design policy, UI policy, Pika audit, diff checks, and combined source/rendered
Product Design comparison pass. Student UI is n/a because this remains a
teacher-only surface.

**Model recommendation:** GPT-5.6 Terra/high for one bounded independent review
of requirements coverage, selection behavior, accessibility, evidence, and
responsive regression risk.

## 2026-08-28 — Refine Attendance row status targets

**Risk profile:** low visual/composite-widget refinement — only the appearance
of the existing teacher row status targets changed; status semantics, commands,
permissions, selection, QR Undo, API/schema behavior, and student UI are
unchanged.

- Removed the check, clock, and x icons from each row's Present/Late/Absent
  targets and changed the three 44 x 44 targets from rounded squares to circles.
- Preserved fixed Present/Late/Absent order, semantic attendance colors,
  tooltips, named `aria-pressed` buttons, and roving Arrow/Home/End keyboard
  behavior.
- Added component and browser assertions for icon absence and circular geometry,
  then refreshed desktop/mobile light/dark default, selected-menu,
  manual-with-Undo, and hours evidence plus before/after comparison boards.
- No durable guidance changed because the treatment is Attendance-specific.
- Composite-widget accessibility checklist reviewed: yes; keyboard behavior
  covered: yes; semantic state, tooltip naming, icon absence, and geometry
  covered by tests: yes; remaining manual follow-up: none.

**Verification:** focused component/UI tests (20/20), responsive Attendance
Playwright matrix (4/4) with no browser/page errors, TypeScript, lint, Pika
audit, diff checks, and combined source/rendered Product Design comparison pass.
Student UI is n/a because this remains a teacher-only surface.

## 2026-08-28 — Strengthen Attendance selected-state clarity

**Risk profile:** low visual/copy refinement — only the visible size and selected
emphasis of existing teacher row status controls plus Attendance time formatting
changed; hit targets, status commands, permissions, selection, QR Undo,
API/schema behavior, and student UI are unchanged.

- Reduced each visible Present/Late/Absent disc from 44 x 44 to 36 x 36 while
  retaining its 44 x 44 interactive target and existing keyboard/focus behavior.
- Added a semantic primary ring and subtle shadow to the selected status; inactive
  states remain identifiable at lower emphasis in light and dark themes.
- Standardized session-window, Check-in, and QR-expiry times to uppercase AM/PM.
- Added component and browser assertions for disc geometry, selected/inactive
  styling, and time labels, then refreshed desktop/mobile light/dark evidence,
  gallery images, and matching before/after comparison boards.
- No durable guidance changed because the visual treatment and time copy are
  Attendance-specific.
- Composite-widget accessibility checklist reviewed: yes; keyboard behavior
  covered: yes; semantic pressed state, hit geometry, visible-disc geometry,
  selected ring, inactive opacity, and time labels covered by tests: yes;
  remaining manual follow-up: none.
- One bounded independent review found the browser regression test described the
  44 x 44 hit target without asserting its exact size. Added explicit tolerant
  width/height assertions and reran the four-project matrix successfully.

**Verification:** focused component/UI tests and responsive Attendance Playwright
matrix (4/4) pass; TypeScript, lint, Pika audit, and diff checks pass; CI and
bounded independent re-review are pending before handoff. Student UI is n/a
because this remains a teacher-only surface.

## 2026-08-28 — Finalize approved always-editable Attendance controls

**Risk profile:** low visual/composite-widget refinement — teacher Attendance
presentation and interaction placement changed without changing API/schema,
session/mark permissions, command polling, QR provenance, or student UI.

- Made the per-student Present/Late/Absent controls permanently visible within
  existing Attendance permission gates, removed their segmented track, and
  reduced inactive discs to 12% opacity while retaining the full-color selected
  disc and semantic blue ring.
- Aligned the three 36 px count pills with the three 36 px row discs on a fixed
  44 px target grid; retained accessible names, pressed state, tooltips, and
  keyboard movement.
- Replaced the trailing Attendance hours icon with a right-justified clickable
  session range using uppercase AM/PM and spaced-dash formatting. Added the
  approved clock fallback for dates without a session range and retained mobile
  hours access in the condensed action menu.
- Preserved checkboxes, the persistent disabled-until-selection Student actions
  menu, Check-in time, QR correction Undo, sticky sortable/resizable headers,
  compact internal roster scrolling, and Attendance-specific terminology.
- Refreshed the approved Product Design reference and desktop/mobile light/dark
  evidence for default, selection, menu, Undo, hours-dialog, and no-hours states.
  Durable design guidance did not change because the reusable work-surface rules
  already cover the shared hierarchy.
- Composite-widget accessibility checklist reviewed: yes; keyboard behavior
  covered: yes; semantic selection, pressed state, 44 px hit targets, 36 px
  status/count alignment, inactive opacity, time-control naming, and no-time
  fallback are covered by component/browser checks; remaining manual follow-up:
  none.
- One bounded independent review found no actionable issues. After rebasing onto
  the latest `main`, CI's governed-design check rejected an arbitrary minimum
  width; replaced it with the standard `min-w-40` token and confirmed design/UI
  policy checks locally.

**Verification:** focused component tests (17/17), responsive Attendance
Playwright matrix (4/4), TypeScript, lint, architecture boundaries, Pika audit,
diff checks, and same-viewport source/implementation Product Design comparison
pass. Student UI is n/a because this remains a teacher-only surface. Bounded
independent review passed; rerun PR CI remains before handoff.

## 2026-08-28 — Fit Attendance time and tighten row controls

**Risk profile:** low teacher-only visual/composite-widget refinement — no
Attendance commands, permissions, session state, QR provenance, API/schema, or
student behavior changed.

- Left-aligned the clickable Attendance time control and made it shrink to its
  content. Verified the full `Open · 12:45 AM - 10:34 PM` label without
  stretching the leading context track.
- Reduced each row Present/Late/Absent target from 44 px to 36 px and its visible
  disc from 36 px to 32 px. Matched the sortable count pills to the 32 px disc
  width and reduced the QR-correction Undo target so it does not hold rows open.
- Kept mobile Check-in time on one line so the reduced controls materially lower
  row height at the narrow viewport as well as desktop.
- Updated the live Open Design mock, approved reference, brief, Product Design
  QA, and desktop/mobile light/dark evidence. No durable guidance changed because
  these remain Attendance-specific density and placement choices.
- Composite-widget accessibility checklist reviewed: yes; keyboard behavior
  unchanged and covered; semantic names, pressed state, focus rings, tooltips,
  36 px target geometry, 32 px disc/count geometry, longest-time alignment, and
  compact row height are covered by component/browser checks.

**Verification:** focused component tests (18/18), responsive Attendance
Playwright matrix (4/4) with zero browser/page errors, TypeScript, lint,
architecture, design policy, UI policy, Pika audit, diff checks, and same-view
source/implementation Product Design comparison pass. Student UI is n/a.

## 2026-08-28 — Center Attendance time and further compact row controls

**Risk profile:** low teacher-only visual/composite-widget refinement — no
Attendance commands, permissions, session state, QR provenance, API/schema, or
student behavior changed.

- Moved the content-sized Attendance time control into the centered primary
  action cluster immediately after the joined date navigator.
- Removed the visible `Open` label and status dot. The open state now uses a
  subtle semantic success background while the accessible name still announces
  the state; mobile hours access remains in the condensed action menu.
- Reduced each row's visible Present/Late/Absent disc from 32 px to 28 px and
  matched the count-pill width. Preserved 44 px status and QR Undo hit targets,
  pressed state, focus rings, tooltips, and keyboard behavior.
- Refreshed the live Open Design mock, approved reference, change brief, Product
  Design QA, and desktop/mobile light/dark evidence. No durable shared guidance
  changed because the adjustments remain Attendance-specific.

**Verification:** focused component tests (18/18) and responsive Attendance
Playwright matrix (4/4) pass; same-viewport Product Design source and production
captures were reviewed together. Student UI is n/a because this remains a
teacher-only surface. TypeScript, lint, policy checks, Pika audit, and PR CI
pass. Bounded independent review found and prompted correction of a 32 px
hit-target regression, then confirmed the 44 px target/28 px visual treatment.
The final integration pass found no behavior blocker and identified two P3
documentation gaps: the teacher-view contract now records QR-origin provenance
fields with a route assertion, and superseded 36 px comparison captures are
explicitly marked historical. One targeted documentation confirmation remains
before handoff.

## 2026-08-28 — Restore Attendance time to leading context

**Risk profile:** low teacher-only visual refinement — no Attendance commands,
permissions, session state, QR provenance, API/schema, or student behavior
changed.

- Restored the content-sized clickable Attendance range to the quiet left
  context slot while keeping the date and action hierarchy centered.
- Limited the subtle success background to a confirmed open session. Closed,
  scheduled, cancelled, stale, and pending states remain neutral; the accessible
  name continues to announce the actual state.
- Added explicit light/dark closed-session browser captures and assertions, and
  refreshed the live two-state Open Design comparison, evidence record, and
  Product Design QA. Mobile continues to expose Attendance hours through the
  condensed actions menu.
- No durable shared guidance changed because this placement and open-only state
  cue are Attendance-specific refinements.

**Verification:** focused component tests (19/19) and the responsive Attendance
Playwright matrix (4/4) pass with explicit leading-placement, longest-label,
open-background, neutral-closed, stale, and pending assertions. Open and closed
source/production captures were visually compared in desktop light/dark; mobile
light/dark remained free of overflow. Student UI is n/a because this remains a
teacher-only surface.

## 2026-08-28 — Integrate Attendance redesign with timing rules

**Risk profile:** standard integration of a teacher-only UI with newly merged
Attendance timing and automatic-status behavior; no authorization boundary or
schema was added by this branch.

- Merged current `main`, including configurable Attendance timing rules and the
  reviewed Course Guide import, into the feature branch before final review.
- Preserved the approved compact roster and persistent selected-student menu.
  Mapped the new `Use automatic` and confirmed `Remove QR check-in` actions into
  that menu instead of restoring a separate bulk action bar.
- Updated per-row QR correction Undo to clear the manual override and reveal the
  timing-derived automatic status. Check-in time now comes from the durable
  check-in fact introduced by the timing work.
- Retained the leading session-time control, open-only success treatment,
  neutral closed/stale/pending states, compact 28 px discs in 44 px targets, and
  mobile condensed action hierarchy.
- Refreshed Product Design QA and desktop/mobile light/dark evidence for the
  integrated selected-student menu and Attendance timing dialog. No new durable
  shared design guidance was needed.

**Verification:** TypeScript passes; five focused Attendance test files pass
(40 tests); the integrated teacher/student Playwright matrix passes in all
eight desktop/mobile light/dark cases with no browser or page errors. Visual
comparison passed for default, selection menu, timing dialog, and dark/mobile
states. Final policy, lint, audit, independent review, and PR merge gates follow.

### Final-review privacy correction

- Independent review identified a merge-blocking provider-boundary leak: the
  timing integration exposed Bara's opaque `check_in_ref` in the Pika-owned
  teacher browser contract even though the UI only needed existence state.
- Replaced the public reference with provider-neutral `hasQrCheckIn`, retained
  `pendingCommand` separately, and updated selection filtering, removal
  confirmation polling, and per-row automatic-status Undo.
- Updated the typed session-route fixture, privacy assertions, builder tests,
  durable teacher-surface contract, and visual evidence record. Serialized view
  tests now explicitly reject private check-in references.

**Verification:** TypeScript and six focused Attendance test files pass (48
tests). The targeted browser matrix, policy gates, audit, targeted independent
confirmation, and GitHub checks follow before merge.

## 2026-08-28 — Define configurable Attendance timing semantics

**Risk profile:** runtime-platform — proposed Pika/Bara timing, lifecycle,
status, persistence, and versioned-contract behavior; no product code,
migration, deployment, PR, merge, production state, or Bara file changed.

- Completed the mandatory Pika startup contract in a fresh detached worktree at
  the fetched `origin/main` head `09bb0c54`; installed locked dependencies and
  passed `verify-env.sh`.
- Audited native Pika Attendance policy creation, Toronto/DST schedule
  materialization, teacher/student permissions, QR entry and idempotency,
  projections, persistence, API validators, and focused tests. The current v1
  model has only absolute open/close instants: every accepted QR scan becomes
  Present and closing finalizes Unmarked students as Absent.
- Inspected open PR #1094. It preserves teacher corrections and Undo while
  exposing original QR check-in time from signed Bara events, but it does not
  add timing cutoffs; reconciliation cannot yet recover immutable first-QR
  evidence if the original event was missed.
- Inspected `/Users/stew/Repos/bara` read-only at local `main` `f66850f`.
  Bara's server clock and Convex mutation are authoritative, the entry interval
  currently closes exclusively at `closesAt`, manual Pika corrections are
  allowed after close, and automatic close turns only Unmarked records Absent.
- Recommended separating session start/end, QR entry open/close, Present grace,
  and Absent finalization; using explicit boundary semantics and a v2 contract;
  preserving existing policies in legacy mode until a teacher opts in; and
  waiting for maintainer agreement before any implementation plan or change.

**Model recommendation:** GPT-5.6 Sol with high reasoning for the eventual
cross-repository, time-boundary, persistence, and compatibility implementation.

## 2026-08-28 — Implement configurable Attendance timing

**Risk profile:** runtime-platform — coordinated pre-release Pika/Bara contract,
PostgreSQL migration, QR acceptance ledger, derived status rules, and teacher UI;
no migration was applied and no PR, commit, deployment, or hosted state changed.

- Rewrote the shared v1 contract in place because neither integration is in use.
  Bara now receives only concrete `[accepts_at, stops_accepting_at)` gates and
  publishes authoritative accepted/invalidated check-in facts; it no longer
  assigns Pika Present/Late/Absent outcomes.
- Added Pika timing policy defaults and occurrence snapshots for session start/end,
  QR open/close, inclusive Present grace, and Absent cutoff. Frozen occurrences
  retain their policy after QR entry opens, including scans already accepted.
- Added Pika-side status derivation, audited teacher overrides with Undo, and
  audited individual/bulk QR check-in invalidation. Invalidation preserves the
  fact history and permits a new scan while Bara's gate remains open.
- Updated the teacher timing dialog, live roster timestamps/source labels,
  automatic-status control, removal confirmation, student confirmation reads,
  Toronto DST/cross-midnight handling, validation, reconciliation, and docs.
- Pika passed 591 files/5,180 tests, TypeScript, lint, production build, the
  repository audit, and an eight-case Playwright matrix covering teacher/student,
  desktop/mobile, and light/dark states. Bara passed 34 files/180 tests,
  TypeScript, and lint with only four generated-file warnings.

**Rollout note:** migration 138 remains unapplied and requires exact one-time
authorization. Deploy Pika's migration/API and Bara's matching v1 contract as a
coordinated pre-release cutover; there is intentionally no legacy compatibility
mode.

**Model recommendation:** GPT-5.6 Sol for the migration review and coordinated
cutover; GPT-5.6 Terra for bounded UI and contract follow-up.

## 2026-08-28 — Course Guide Phase 2 curriculum import

**Risk profile:** teacher AI-assisted content mutation — one-time PDF/public-URL
extraction into the live classroom-backed Course Guide; no ongoing Blueprint or
classroom synchronization. Migration 140 adds a durable provider-call lease and
rate window; it has not been applied to local or hosted state.

- Added an Import curriculum assistant to Guide options with explicit Source,
  Review, and Confirm steps. Teachers can upload a validated PDF up to 4 MB or
  provide a public HTTPS document URL, then edit the extracted overview,
  expectations, and useful links before anything is applied.
- Added a server-side structured Responses API extraction boundary with
  non-stored requests, untrusted-document instructions, bounded validated
  output, safe failures, and source provenance. The confirmed apply path always
  attaches the citation server-side so review edits cannot remove it.
- Preserved existing teacher content by appending the reviewed import, and used
  an expected-overview compare guard to return a conflict instead of silently
  overwriting a Course Guide changed during review.
- Applied the owner refinement that the Course Guide is orientation, not an
  activity feed. The shared teacher/student/public display model now contains
  only overview/resources visibility plus title-only Assignment and Test
  records. Lesson sequence, Announcements, instructions, dates, scores,
  statuses, documents, and grading details are absent from the payload and UI;
  their classroom features remain unchanged. Guide options exposes only the
  four orientation sections.
- Added domain, provider-boundary, API authorization/concurrency, component,
  fixture, and regression coverage. All 5,223 tests pass, along with lint,
  architecture, design/UI policy checks, production build, Pika audit, and diff
  validation.
- Visual verification passed 13 teacher/student/public checks across desktop
  and mobile, light and dark, covering the narrowed options, title-only lists,
  removed activity sections, source, editable cited review, confirmation,
  extraction failure, overflow, and absence of teacher controls for students.
- Independent review remediation lowered PDF uploads to the hosting-safe 4 MB
  boundary; added extraction timeout/output limits; moved apply authorization
  before body parsing; signed source provenance to the teacher/classroom;
  normalized and previewed the locked citation; preserved existing overview
  bytes; used raw classroom content when visibility is off; and cancelled stale
  client operations across classroom switches. Final hardening canonicalized
  public URLs, rejected credentials and control/format characters, emitted the
  locked citation as safe plain text, and removed redundant provenance-token
  fields so maximum valid inputs still fit the apply contract.
- Final merge review rebased the branch onto Attendance PR #1103 and closed the
  remaining provider-cost boundary: public curriculum URLs are fetched through
  the existing DNS-pinned, redirect-revalidated 4 MB document path before they
  reach OpenAI. A teacher-scoped database lease now permits one active extraction
  and three attempts per ten minutes across all deployed server instances. The
  confirmed write now also rechecks teacher ownership and non-archived state in
  the atomic update predicates.
- Updated production continuity to the user-confirmed baseline: production
  commit 530d444a with migrations through 136 applied and zero error-level
  database lint findings. Migration 140 was added but not applied to local or
  hosted state; nothing was merged or deployed.
- Recorded `epic-gradebook-general-breakdown` as separate future work for a
  general Attendance, Term Work, and Final breakdown; no mark breakdown was
  added to the Course Guide.

## 2026-08-28 — Stop feature branches from consuming Vercel deployments

**Risk profile:** runtime-platform — repository deployment-trigger configuration
only; no application behavior, database, or hosted state changed.

- Replaced the single-segment `*` deployment exclusion with recursive `**`, so
  slash-containing feature branches such as `codex/*` and `claude/*` are
  rejected before Vercel creates a deployment. `main` preview and `production`
  release deployments remain explicitly enabled.
- Added a regression test that locks the exact three-rule deployment policy.
  The focused test, lint, JSON policy assertion, and diff validation pass.

## 2026-08-28 — Clarify compact operational control targets

**Risk profile:** none — durable design guidance only; no product code,
behavior, schema, dependency, deployment, or hosted state changed.

- Clarified in the canonical design contract that dense visible control
  geometry may be smaller than its interaction geometry only while preserving
  a non-overlapping 44 by 44 CSS-pixel target and perceptible focus/state cues.
- Clarified the teacher operational-table contract for mutually exclusive
  inline statuses: inactive choices remain available but subordinate, while
  the selected choice combines domain color, semantic pressed state, and a
  non-color boundary.

**Model recommendation:** GPT-5.6 Terra for a low-risk, cross-page design
guidance clarification grounded in the reviewed Attendance implementation.

## 2026-08-28 — Release configurable Attendance timing

**Risk profile:** runtime-platform — coordinated Pika/Supabase/Bara production
release with protected-branch merges, exact Git-source deployments, and a
production Convex worker correction.

- Merged configurable Attendance timing through Pika production PR #1106 at
  `f895b240` and Bara production PR #49, followed by the worker correction in
  PRs #50/#51 at `8515a4ca`. Exact Git-source Vercel production deployments are
  Ready and own the stable Pika and Bara aliases.
- Verified production Supabase migrations 001–138 are aligned. Migration 138
  owns timing-policy persistence, occurrence snapshots, Pika-side status
  derivation, immutable accepted-check-in facts, and audited invalidation.
- Kept service ownership explicit: Bara enforces only the concrete half-open QR
  gate and records authoritative timestamps; Pika derives Present/Late/Absent,
  applies teacher overrides/Undo, and invalidates or clears accepted facts.
- Corrected Bara's scheduled worker after production logs exposed two paginated
  queries in one Convex transaction. The coordinator is now an internal action
  whose open and close pages run as separate mutations. Full Bara tests,
  typecheck, build, and lint passed; repeated production cron runs are clean.
- Restricted Vercel deployment creation in both repositories to `main` and
  `production`; slash-containing feature branches are rejected before a preview
  deployment is created. Main preview and production release paths remain on.
- Restored the configured canary teacher's missing entitlement through the
  separately authorized, audited production operation. The active revision-1
  grant has no expiry, classroom access returns `ready`, and the final deployed
  `enabled`/`teacher_entitlements` signed smoke passed 4/4 across canary scope,
  transition health, Pika-to-Bara authentication, and Bara-to-Pika callback.

**Model recommendation:** GPT-5.6 Terra for routine Attendance monitoring and
bounded follow-up now that the coordinated rollout is complete.

## 2026-08-28 — Build the automatic development-speed workflow

**Risk profile:** runtime-platform — CI selection, browser concurrency, AI PR
routing, and protected production-promotion behavior changed; no schema,
dependency, secret, or hosted state was changed.

- Measured the pre-change CI baseline: latest clean lanes took 4m41s for Test &
  Build, 7m32s for database contracts, and 9m08s for the browser matrix; the
  recent successful wall-time median was 563s, with 8 of 30 attempts cancelled
  after consuming about 41 minutes.
- Added a fail-closed, change-aware classifier and aggregate `PR Gate`. Draft
  pushes skip heavy work; docs/AI guidance uses the fast workflow-contract lane;
  application, database, and rendered-browser paths select their relevant lanes;
  unknown/runtime/CI paths and manual dispatches run the full suite.
- Made the draft-first stable-SHA lifecycle automatic for AI agents: focused
  local checks, draft PR, risk-matched review, batched remediation, one ready-SHA
  CI run, and return-to-draft before any correction push.
- Combined the three Playwright CI launches, moved the public Course Guide setup
  into deterministic seed state, and enabled two CI workers while keeping each
  spec internally serial. Added a reusable performance measurement command and
  rollout/rollback targets.
- Changed production promotion to reuse one cumulative draft PR and kept direct
  or noncanonical production PRs on fail-closed full CI. Repository ruleset
  replacement remains an explicit owner checkpoint after the workflow proves
  both docs-only and full classifications.
- Independent Sol/Terra review found and batch-remediated spoofable production
  provenance, deletion omission, over-broad runtime safe classification, a
  shared Playwright mutation, persistent production-worktree divergence,
  malformed aggregate selectors, and metrics that could not prove per-mode
  targets. Production abbreviation now requires same-repository head = current
  `main`; all other cases fail closed. Mutable publication coverage has a
  dedicated fixture, promotion worktrees are ephemeral, and metrics inspect
  actual `PR Gate` timing by classifier mode.
- A targeted remediation review then closed four remaining integration gaps:
  the helper now publishes the exact `origin/main` SHA even when production is
  divergent; all three aggregate selectors are validated together; fork PRs
  cannot enter promotion discovery; and unrecognized `.github` paths fail
  closed. Executable temporary-repository coverage exercises merge, squash,
  rebase, and subsequent promotion preparation.
- Validation on current `main` passed 77 workflow contracts, architecture,
  UI/design policies, TypeScript, lint, production build, actionlint, Bash
  syntax, Playwright discovery (93 tests), focused checks, and diff validation.
  Two full-suite attempts each passed 5,287/5,288 but exposed different
  non-repeating timing failures; both affected files passed immediately in
  isolation. The PAL timeout test now has scheduler headroom while retaining a
  strict bound. Final GitHub CI remains authoritative. Ephemeral database and
  real-browser execution remain selected for the final ready-PR run because
  local seed/migration application was not authorized.
- Tightened the Pika audit so newly introduced production `console.log` calls
  still fail without forcing unrelated edits to clean legacy logging elsewhere
  in the same file; regression coverage locks both cases.
- Final exact-SHA GitHub CI passed every selected full-mode safeguard: aggregate
  `PR Gate` in 7m34s, database contracts in 7m17s, Test & Build in 6m21s, and
  the combined browser matrix in 5m13s versus the 9m08s browser baseline.
  After owner approval, current `main` advanced through Course Guide limiter PR
  #1111; the speed-program PR returned to draft and merged that change while
  retaining its new database-contract step in the aggregate CI workflow.
- The next exact-SHA CI exposed a pre-existing archive visual test that packed
  20 context/navigation states into one 30-second case. Test & Build and database
  contracts passed, while all browser retries timed out even though an artifact
  snapshot showed the expected verified state arriving after the deadline.
  Split the four viewport/theme entries into separate internally serial tests,
  preserving every assertion and screenshot. The exact two-worker combined
  browser command then passed 82 tests with 14 intentional skips in 2.5 minutes;
  each split archive case passed first try in 4.3–10.2 seconds.

**Model recommendation:** GPT-5.6 Sol at high reasoning for the branch-protection
transition and initial post-rollout evidence review; use Terra for routine
follow-up once the aggregate gate is established.

## 2026-08-28 — Limit Test publication wording to the publish transition

**Risk profile:** none — teacher Test workspace labels and confirmation copy only.

- Removed the raw Draft/Active/Closed lifecycle indicator from the selected-Test
  workspace; publication state is no longer persistently labelled there.
- Renamed the irreversible Draft-to-Active confirmation to Publish test and made
  its one-way effect explicit while preserving the existing API lifecycle.
- Added component and browser coverage proving lifecycle wording stays absent
  from the workspace and publication wording appears in the confirmation only.
  Focused Vitest (70/70), lint, architecture boundaries, and eight light/dark
  desktop/mobile browser cases pass; screenshots were reviewed visually.

## 2026-08-28 — Separate Test publication from student access

**Risk profile:** runtime-platform — atomic publication RPC, teacher publication
and roster controls, and student Test-list visibility.
Migration 139 was applied to the local and production Supabase databases with
separate explicit authorizations; no application code was deployed.

- Moved Edit Test into the selected Test's three-dot More actions menu and
  removed persistent Draft/Active/Closed wording from the grading workspace.
- Added an irreversible Publish action to draft authoring. Publication validates
  and materializes the saved draft as a closed Test; direct Draft-to-Active
  requests are rejected. Open All and Close All now only change student access
  and remain disabled before publication.
- Published closed Tests now remain visible in the student list with a clear
  closed treatment, while not-started students cannot open them until access is
  granted. Once access opens, the card becomes actionable and the teacher's live
  grading refresh resumes even though the internal published-default status is
  closed. Submitted and returned work remains governed by the existing access
  contract.
- Added migration 139 with a service-role-only atomic publication RPC. It wraps
  draft materialization and the published-but-closed transition in one database
  transaction so a close failure restores the draft, materialized questions,
  and Classroom revision. Added a rollback contract script and CI wiring.
- Replaced the route's prior two-step activation/close sequence with that RPC
  and made the server fail closed if the result is not a closed Test. Repaired
  the publication browser fixture so it waits for the loaded editor and cannot
  pass while an editor-load error is present.
- Focused post-migration coverage passes (165 tests), as do lint, TypeScript, the
  production build, architecture, design-policy, UI-policy, managed-storage
  lineage, the Pika audit, shell syntax, and diff validation. The affected
  Playwright matrix passes 12 cases across teacher/student, desktop/mobile, and
  light/dark; all screenshots were reviewed and visual verification passed.
  The full Vitest run passes all 609 files and 5,264 tests.
- After the authorized local migration application, migration history is aligned
  through 139, the real success-and-forced-failure rollback contract passes,
  generated database types include the publication RPC and match the migrated
  schema, and error-level database lint reports no findings.
- After the separately authorized production application, remote migration
  history is aligned through 139 and read-only error-level database lint reports
  no findings. The fixture-writing rollback contract was not run against
  production.
- Independent high-risk review found three merge blockers. The remediation
  removes legacy active/closed lifecycle mutations from the generic Test PATCH,
  redacts document content and storage identifiers until a student can open or
  view submitted work, and derives the student Closed treatment from effective
  access so individually closed students no longer see a disabled New card.
  The browser fixture count now matches the one actually open Test.
- Post-remediation coverage passes 166 focused tests plus lint, TypeScript, the
  Pika audit, and four student desktop/mobile light/dark Playwright cases. The
  updated captures were reviewed and preserve a clear Closed treatment without
  overflow. A non-blocking lost-response publication-retry reconciliation is
  documented for follow-up because it needs a durable idempotency design beyond
  the already-applied migration.
- Final integration review found and corrected a partial-success failure path:
  if the published-closed Test query fails, the student list now returns 500 so
  the existing retry/stale-snapshot UI can preserve prior data instead of
  replacing it with a misleading active-only list. Regression coverage proves
  the request fails rather than emitting partial data.

**Model recommendation:** GPT-5.6 Sol for the migration transaction,
publication/access state boundary, cross-role UI behavior, and high-risk PR
review.

## 2026-08-28 — Resequence Course Guide import rate-limit migration

**Risk profile:** workspace-state/schema-numbering — migration filename and
references only; no SQL behavior, database state, or hosted environment changed.

- Rebased the merged Course Guide branch onto current `origin/main`, skipping
  the five feature commits already represented by squash merge `ba08bf52`.
- Preserved and restored the uncommitted database-backed import-rate-limit work.
- Resolved the active-worktree collision with the student Tests migration
  `139_publish_test_from_draft_atomic.sql` by renaming the Course Guide limiter
  to `140_course_guide_import_rate_limits.sql` and updating its tests and
  continuity references.
- Migration 140 remains unapplied. It must be rebased after migration 139 lands
  before any authorized local or hosted application.

**Model recommendation:** current frontier coding model for shared-worktree
preservation and migration-lineage coordination.

## 2026-08-28 — Apply Course Guide import rate-limit migration

**Risk profile:** runtime-platform — explicitly authorized local and production
application of migration 140; no deployment or unrelated migration application.

- Reconstructed the complete 001–140 migration directory in an isolated
  workspace because migration 139 remains in its separate student Tests
  worktree. Both target ledgers were already aligned through 139.
- Dry runs for local and linked production each proposed only
  `140_course_guide_import_rate_limits.sql`.
- Applied migration 140 locally, then verified the shared lease/concurrency and
  three-attempt window contract plus zero error-level database lint findings.
- Applied migration 140 to production. The production ledger is aligned through
  140 with zero error-level lint findings; an authenticated schema dump confirms
  the RLS-enabled table, constraints, security-definer functions with empty
  search paths, and service-role execution grants.
- The database-backed limiter application changes remain uncommitted and
  undeployed; production continues using the merged in-memory limiter until the
  code completes its own PR/review/release loop.

**Model recommendation:** GPT-5.6 Sol for the remaining migration-backed server
code review and rollout because it crosses provider-cost and database authority.

## 2026-08-28 — Harden Course Guide import rate limiting

**Risk profile:** runtime-platform — rolling teacher-wide provider-cost limit,
lease fencing, and explicitly authorized local and production migration 141.

- Added migration 141 to replace the fixed Course Guide import window with a
  rolling three-attempt/ten-minute history and extend extraction leases to 90
  seconds. Existing migration-140 rows are backfilled conservatively.
- Kept acquisition serialized with row locking and retained token-fenced release
  so an expired worker cannot clear a replacement lease.
- Added database-contract coverage for existing-row concurrency, rolling-window
  boundaries, conservative upgrade behavior, and stale-token replacement.
- Independent security re-review found no remaining blockers. Focused tests,
  TypeScript, lint, database type generation/checking, shell syntax, the Pika
  audit, and the live local database contract pass.
- With explicit target-and-migration authorization, applied migration 141 first
  to local and then production. Both migration ledgers are aligned through 141,
  error-level database lint reports no findings, and an authenticated production
  schema dump confirms the hardened function, constraints, and grants.
- The application changes remain pending their exact-head PR/CI/merge loop; no
  application deployment was performed as part of the schema application.

**Model recommendation:** GPT-5.6 Sol for the final exact-head CI and merge loop.

## 2026-08-28 — Consistent classroom work-surface controls

**Risk profile:** low — teacher/student presentation structure and shared
control composition only; existing domain behavior, routes, schema,
dependencies, deployments, and hosted state are unchanged.

- Added the shared app-level `DateNavigator` composition and adopted it in
  Daily, Attendance, and Calendar while leaving each feature's date logic and
  picker behavior local.
- Migrated every production consumer of the transitional floating teacher
  action bar to the anchored, mathematically centered
  `TeacherWorkSurfaceContextBar`: Classwork, Tests summary, Gradebook, Roster,
  Announcements, and Calendar. Existing commands and menu contents are
  unchanged.
- Preserved the floating layer token on the anchored context row so open menus
  remain above sticky operational-table headers; verified the Gradebook and
  Roster open-menu states explicitly.
- Documented the shared date-scope composition and removed the Calendar raw
  value/native-control exceptions made obsolete by the refactor.
- Visual verification passed teacher Calendar, Daily, Classwork, Tests,
  Gradebook, Roster, and Announcements across desktop/mobile and light/dark,
  plus student Calendar across the same matrix and student Classwork where the
  shared page was otherwise unchanged.
- All 608 test files / 5,254 tests pass, along with lint, architecture,
  design/UI policy checks, production build, and diff validation. The build
  retains the existing WorkOS Edge Runtime and browsers-data warnings.

No deployment or database operation was performed.

**Model recommendation:** GPT-5.6 Sol for the cross-surface consistency review;
GPT-5.6 Terra for bounded follow-up on an individual classroom surface.

## 2026-08-29 — Make local Pika startup supply safe runtime credentials

**Risk profile:** runtime-platform — local development process bootstrap and
secret handling only; no hosted configuration, database state, migrations, or
application behavior changed.

- Added a repository-scoped `pika-local-dev` skill so future agents launch Pika
  with a generated process-only session secret and credentials derived from the
  already-running local Supabase stack.
- Required loopback HTTP and trusted Pika Git-common-directory identity before
  reading or passing local Supabase credentials. Current and legacy Supabase key
  names are supported without adding a `jq` dependency.
- Disabled inherited shell tracing before sensitive reads and fail closed when
  OpenSSL fails or returns anything other than a 64-character hex secret.
- Cleared inherited Git repository selectors and required the canonical target
  to appear in the trusted Pika repository's registered-worktree inventory
  before the launcher reads local credentials.
- Added behavioral coverage for credential injection, key-format compatibility,
  missing-key diagnostics, untrusted-worktree and non-loopback rejection,
  trace redaction, secret-generation failure, stopped-stack failure, and
  check-only mode.

**Verification:** focused skill tests (12/12), live prerequisite check, Bash and
ShellCheck validation, and Codex skill validation pass.

**Model recommendation:** current frontier coding model for bounded local
developer tooling with security-sensitive environment handling.

## 2026-08-29 — Audit development-speed rollout after 20 CI attempts

**Risk profile:** standard — CI operating guidance and browser-test scheduling;
no product behavior, branch enforcement, dependencies, schema, migrations, or
hosted data changed.

- Measured the first 20 completed natural CI attempts after rollout commit
  `12336121b05ae55fa0ea97fb5bf81e21ff7b9f6a` at
  `2026-08-29T03:20:41Z` with `pnpm measure:ci -- --limit 20`. Exact output:

```json
{
  "sampleSize": 20,
  "successfulSampleSize": 8,
  "counts": {
    "cancelled": 3,
    "skipped": 9,
    "success": 8
  },
  "cancellationRate": 0.15,
  "cancelledElapsedSeconds": 116,
  "successfulQueueSeconds": {
    "min": 0,
    "p50": 0,
    "p95": 0,
    "max": 0,
    "average": 0
  },
  "successfulRunSeconds": {
    "min": 54,
    "p50": 464,
    "p95": 533,
    "max": 533,
    "average": 409
  },
  "successfulWallSeconds": {
    "min": 54,
    "p50": 464,
    "p95": 533,
    "max": 533,
    "average": 409
  },
  "successfulRunsWithoutPrGateEvidence": 1,
  "prGateByMode": {
    "application-test-build": {
      "sampleSize": 1,
      "timeToGateStartSeconds": {
        "min": 376,
        "p50": 376,
        "p95": 376,
        "max": 376,
        "average": 376
      },
      "gateRunSeconds": {
        "min": 3,
        "p50": 3,
        "p95": 3,
        "max": 3,
        "average": 3
      },
      "timeToGatePassSeconds": {
        "min": 379,
        "p50": 379,
        "p95": 379,
        "max": 379,
        "average": 379
      }
    },
    "docs-only": {
      "sampleSize": 1,
      "timeToGateStartSeconds": {
        "min": 49,
        "p50": 49,
        "p95": 49,
        "max": 49,
        "average": 49
      },
      "gateRunSeconds": {
        "min": 4,
        "p50": 4,
        "p95": 4,
        "max": 4,
        "average": 4
      },
      "timeToGatePassSeconds": {
        "min": 53,
        "p50": 53,
        "p95": 53,
        "max": 53,
        "average": 53
      }
    },
    "full": {
      "sampleSize": 4,
      "timeToGateStartSeconds": {
        "min": 460,
        "p50": 496,
        "p95": 528,
        "max": 528,
        "average": 486
      },
      "gateRunSeconds": {
        "min": 2,
        "p50": 4,
        "p95": 4,
        "max": 4,
        "average": 3
      },
      "timeToGatePassSeconds": {
        "min": 462,
        "p50": 500,
        "p95": 532,
        "max": 532,
        "average": 489
      }
    },
    "production-promotion": {
      "sampleSize": 1,
      "timeToGateStartSeconds": {
        "min": 393,
        "p50": 393,
        "p95": 393,
        "max": 393,
        "average": 393
      },
      "gateRunSeconds": {
        "min": 2,
        "p50": 2,
        "p95": 2,
        "max": 2,
        "average": 2
      },
      "timeToGatePassSeconds": {
        "min": 395,
        "p50": 395,
        "p95": 395,
        "max": 395,
        "average": 395
      }
    }
  }
}
```

- The initial checkpoint failed two targets: cancellation rate was 15% rather
  than below 10%, and full-mode time to PR Gate pass had a 500-second p50 rather
  than below 480 seconds. Docs-only passed at 53 seconds. The one successful run
  without PR Gate evidence was an intentional `workflow_dispatch` diagnostic.
- Inspected every skipped, cancelled, failed, and missing-evidence attempt. All
  nine skipped attempts were draft pushes with no heavy jobs. Two cancellations
  came from a production promotion opened ready by a stale personal skill; that
  skill now delegates to the repository's draft-first exact-main workflow. The
  third was a redundant manual dispatch launched beside the exact-SHA ready-event
  run; the workflow guidance now prohibits this concurrency.
- Two of four full-mode runs paid two 30-second timeouts in the single packed
  student-purge visual matrix before retry #2 passed. Split the unchanged
  desktop/mobile and light/dark teacher/student assertions into four separately
  timed cases. Local verification passed all four on the first attempt in
  2.4–8.8 seconds while retaining every screenshot path.
- Safety targets remained intact: both active branch rulesets still require the
  strict `PR Gate`; selected database/browser lanes fed that gate; unknown-path
  PR #1114 failed closed to full mode; browser specs and artifacts remained in
  the stable two-worker combined job; and production promotion #1115 ultimately
  passed in provenance-checked promotion mode from exact `main`.
- Because the initial checkpoint failed, the development-speed goal remains
  open. After this bounded remediation merges, collect 20 new natural attempts
  and repeat the complete audit before declaring success.

**Verification:** startup workflow contract (41/41), split Playwright discovery
(four target cases), local student-purge browser suite (6/6 including auth),
strict `main` and `production` ruleset inspection, and diff validation pass.

**Model recommendation:** GPT-5.6 Terra for the bounded CI/browser-test
remediation review and GPT-5.6 Sol only if the follow-up audit exposes a deeper
workflow or safety-lane defect.

## 2026-08-29 — Combine Daily and teacher Attendance

**Risk profile:** standard application behavior — teacher classroom navigation,
authoritative Attendance commands, responsive operational-table composition,
and existing Daily logs/summary; no schema, migration, hosted configuration, or
student Attendance behavior changed.

- Removed the standalone teacher Attendance destination and composed entitled,
  classroom-enabled Attendance hours, QR/session commands, selected-student
  actions, Check-in, and Present/Late/Absent controls into Daily.
- Preserved Daily date selection, First/Last/ID/Log sorting, resizable columns,
  log hover text, student-log inspection, and the dotted resizable Class Log
  Summary. The summary timestamp now omits “Generated,” uses the existing
  Toronto-relative formatter, and names its action list “Class log follow-ups.”
- Kept the Daily-only state stable when Attendance is unavailable or disabled:
  centered date navigation and a trailing More menu containing only Show/Hide
  ID. Legacy `?tab=attendance` links and new Blueprint classrooms resolve to
  Daily. Daily-log content never infers Attendance.
- Added production-path tests for entitlement/setting composition, status and
  bulk mark commands, session close, QR presentation, sorting, ID removal,
  menu/dialog focus, and preserved Daily split/resize behavior. Stabilized two
  unrelated Test-detail debounce assertions selected by the full dependency
  gate by asserting the immediate mirror update synchronously and holding the
  other assertion's 3-second autosave timer.
- Independent review identified that an accepted Attendance command could stay
  locally pending forever when provider confirmation arrived after the bounded
  foreground poll. Daily now keeps one cancellable background revalidation
  queue until authoritative success or terminal failure, then releases the
  affected controls. Non-retryable check-in invalidations are surfaced through
  the existing per-student failure contract. Request-scoped ownership rejects
  overlapping commands for a still-pending student, and a monotonic view
  generation cancels stale foreground work across A-to-B-to-A date transitions.
  Regression coverage confirms delayed success after the eighth read, terminal
  session failure recovery, overlap rejection, view-generation cancellation,
  non-retryable active-versus-invalidated check-in mapping, and controller-level
  rejection of mark/reset commands for students whose authoritative view still
  reports pending command ownership.
- Final integration review hardened four boundaries: Attendance hours remain
  reachable when the entitlement exists but the policy is disabled or missing;
  a current pending retry takes precedence over retained historical outbox
  failures; long-roster headers stay sticky inside the Daily scroll pane; and
  Escape closes the active action menu, restores trigger focus, and preserves
  the selected Daily log workspace. Direct controller, server-view, component,
  shared-menu, and browser-geometry regressions cover these cases.
- A subsequent cumulative review closed three more integration boundaries.
  The server projection now exposes authoritative session-command ownership so
  remounts cannot submit a duplicate open/close command. Selection and bulk
  mutations are intersected with the current Daily log rows, immediately
  pruning students hidden by a fresher Daily response. The rare QR check-in
  plus manual-override recovery action now stacks below the three 44px status
  targets inside a minimally wider status column instead of overflowing it.
  Focused controller, server-view, component, and browser-geometry regressions
  cover all three cases.
- Visual verification passed Attendance-on, unconfigured Attendance, and
  Daily-only teacher states on desktop/mobile in light/dark, including
  selection, hidden ID, open More menus, the sticky long-roster header, and the
  contained QR-override recovery row. The unchanged student Daily flow also
  passed in all four browser projects.
- Ready-PR CI exposed an action-menu focus race in the existing Tests workspace.
  Tooltip-wrapped icon menus now keep the same trigger mounted while their menu
  is open and suppress only the tooltip through one lifetime-controlled Radix
  state, so a dialog reliably captures and restores focus to its opener without
  an uncontrolled/controlled transition or retained hover state. The full Tests
  workspace file and a shared action-cluster modal round-trip regression cover
  the hosted failure.
- `pnpm check:focused -- --base origin/main` passes: workflow, architecture,
  UI/design policy, 228 changed-path tests, 1,868 related tests, TypeScript, and
  lint. The Pika pre-commit audit passes; the composite-widget checklist is
  covered by direct semantic, keyboard, focus, and resize tests.

**Model recommendation:** GPT-5.6 Terra high for correctness, requirements,
responsive behavior, and compatibility review of the complete PR diff.

## 2026-08-29 — Finalize assignment history exploration and focused previews

**Risk profile:** low — shared teacher/student history visualization and
client-side saved-document comparison only; no API contract, schema,
persistence, authentication, dependency, migration, deployment, or hosted
state changed.

- Replaced fragmented snapshots with one compact complete-history chart across
  actual activity days. Long and dense histories aggregate by day, zoom reveals
  individual saves, vertical wheel input zooms around the pointer, and
  horizontal or Shift-wheel input pans the bounded window with smooth,
  reduced-motion-aware zoom transitions.
- Kept the document at normal reading size while hovering a save and scrolled to
  its earliest changed location. Clicking retains the existing pinned-save
  behavior. Insertions show Added, rewrites show Revised, and deletions leave a
  `Deleted here` anchor.
- Added a narrow, non-interactive whole-document minimap with change marks and a
  viewport box that follows reading scroll. It hides at narrow mobile widths,
  remains absent from the accessibility tree, and a polite status message
  announces change kinds, counts, and document-block locations.
- Bounded adjacent-save matching by precomputing block signatures, capping exact
  LCS work, and using unique patience-style anchors with monotonic gap matching
  for large documents. A one-block move remains exactly one addition plus one
  deletion across the 199–202 boundary and at 1,000/5,000 blocks; the 5,000
  block case completes in about 9–11 ms locally.
- Independent stable-SHA review found and resolved four P2 issues: unbounded
  comparison work, mixed-save focus order, color-only change semantics, and the
  large-reorder threshold edge. Final targeted re-review found no residual
  P0–P2 issues.
- Clarified the UI gallery demonstration after review: its five saves now grow
  from 8 to 20 to 40 sections, and it opens on the mid-project save so the
  minimap visibly ends before the final-document length. The main pane lands on
  Sections 9–11 marked Added, making snapshot-at-that-time behavior immediate.
- Smoothed overview zooming across the full window-size change instead of only
  animating a clamped final step. Daily totals now crossfade into individual
  saves on the same 420 ms easing curve, zoom-out uses the reciprocal scale,
  and wheel zoom waits for the active transition so repeated wheel events do
  not interrupt the motion. Follow-up review caught and removed the remaining
  0.05–20 scale clamp; year-long histories now retain the exact zoom ratio and
  reciprocal dezoom ratio with direct regression coverage.
- Ready-PR CI exposed an unrelated date-boundary failure in the newly merged
  Daily/Attendance browser fixture: its fixed August 29 summary expected a
  relative `Today` label. The fixture now fixes its browser clock to August 29,
  and the affected desktop/mobile light/dark matrix passes 4/4.

**Verification:** the final pre-rebase focused gate passed 77 workflow tests,
179 focused tests, and 571 related tests plus TypeScript, lint, architecture,
UI/design policy, diff checks, and the Pika audit. Playwright covered teacher
and student desktop, student mobile, and dark mode, including hover, pinning,
rewrite/insertion/deletion marks, minimap scrolling, no horizontal overflow,
and no browser errors. The post-rebase exact-SHA gate is rerun before PR handoff.

**Composite-widget accessibility checklist:** checklist reviewed: yes; keyboard
behavior covered: yes; semantic state covered by tests: yes; remaining manual
follow-up: none.

**Model recommendation:** GPT-5.6 Sol for compact time-series interaction,
historical document diffing, viewport coordination, and cross-role visual QA.

## 2026-08-30 — Keep the light Pika favicon in every theme

**Risk profile:** none — root metadata and its focused regression assertion
only; no application behavior, schema, runtime configuration, or role-specific
surface changed.

- Replaced the theme-conditioned light/dark favicon metadata with one
  unconditional `pika-icon-light.svg` declaration so browser color preference
  cannot select the dark asset.
- Updated the existing middleware/favicon regression test to require the light
  icon, reject the dark icon from root metadata, and reject favicon media
  conditions while preserving the static-asset checks.
- Visual verification passed in headed Chrome: the same light mouse icon appears
  in the tab under light and dark color preferences. Playwright DOM checks also
  confirmed the unconditional light SVG on desktop and mobile. Teacher and
  student roles are not applicable because favicon metadata is global browser
  chrome.
- `pnpm check:focused -- --base origin/main` passes in application-browser mode,
  including workflow, architecture, UI/design policy, focused/related tests,
  TypeScript, and lint. The Pika pre-commit audit passes.
- Ready-PR CI exposed an existing Toronto-midnight rollover in the combined
  Daily/Attendance visual contract: a fixed August 29 timestamp was asserted as
  “Today” after August 30 began. The browser assertion now verifies the stable
  `10:10 AM` timestamp inside the summary while unit coverage continues to own
  relative-day formatting. The corrected scenario passed desktop/mobile in
  light/dark; one cold-start desktop fixture race passed on its immediate
  targeted rerun.

**Model recommendation:** current model for this narrow metadata-only visual
fix.

## 2026-08-30 — Development-speed remediation audit at 30 natural attempts

**Risk profile:** workspace-state — CI evidence audit and a browser-test clock
fixture; no product behavior, schema, migration, dependency, or enforcement
change.

- Ran the approved post-remediation audit after 30 completed natural CI attempts
  following 2026-08-29T16:09:56Z. Exact `pnpm measure:ci -- --limit 30` output:

```text
failed to get run: Get "https://api.github.com/repos/codepetca/pika/actions/workflows/217397176": read tcp 172.16.30.1:59640->140.82.114.5:443: read: operation timed out
{
  "sampleSize": 30,
  "successfulSampleSize": 7,
  "counts": { "cancelled": 1, "failure": 3, "skipped": 19, "success": 7 },
  "cancellationRate": 0.03333333333333333,
  "cancelledElapsedSeconds": 355,
  "successfulQueueSeconds": { "min": 0, "p50": 0, "p95": 0, "max": 0, "average": 0 },
  "successfulRunSeconds": { "min": 448, "p50": 464, "p95": 482, "max": 482, "average": 467 },
  "successfulWallSeconds": { "min": 448, "p50": 464, "p95": 482, "max": 482, "average": 467 },
  "successfulRunsWithoutPrGateEvidence": 1,
  "prGateByMode": {
    "application-browser": {
      "sampleSize": 2,
      "timeToGateStartSeconds": { "min": 445, "p50": 477, "p95": 477, "max": 477, "average": 461 },
      "gateRunSeconds": { "min": 2, "p50": 3, "p95": 3, "max": 3, "average": 3 },
      "timeToGatePassSeconds": { "min": 447, "p50": 480, "p95": 480, "max": 480, "average": 464 }
    },
    "full": {
      "sampleSize": 4,
      "timeToGateStartSeconds": { "min": 459, "p50": 466, "p95": 478, "max": 478, "average": 466 },
      "gateRunSeconds": { "min": 2, "p50": 4, "p95": 4, "max": 4, "average": 3 },
      "timeToGatePassSeconds": { "min": 461, "p50": 469, "p95": 482, "max": 482, "average": 469 }
    }
  }
}
```

- Passes: cancellation rate is 3.3% (<10%); full-mode PR Gate p50 is 469
  seconds (<480); all 19 draft runs were inspected individually and contained
  no non-skipped jobs; the sole cancellation was a superseded PR attempt, not a
  duplicate dispatch. All seven successful runs have a PR Gate; the one missing
  measurement evidence was the transient GitHub API timeout above, and direct
  rechecks proved five full and two application-browser gate modes.
- The two application-browser and five full successes selected their expected
  browser/database dependencies. Failed browser lanes caused PR Gate to fail,
  never to skip. Existing strict `PR Gate` rulesets, unknown-path fail-closed
  classification, two-worker combined browser workflow, artifact upload, and
  canonical production-promotion behavior remain unchanged.
- Documentation-only mode did not occur in this post-remediation sample, so its
  under-two-minute target is not newly evidenced here (the prior audit measured
  53 seconds). No production-promotion attempt occurred in this window.
- The checkpoint nevertheless fails browser stability: runs 33293971804 and
  33295218351 each exhausted all retries of the new Daily/Attendance browser
  case because the fixture asserted `Today 10:10 AM` for a fixed
  2026-08-29 timestamp after the calendar advanced. The third failure was an
  unrelated Test-detail focus assertion. Preserve enforcement; remediate the
  deterministic Daily/Attendance fixture within the approved speed program.
- Freeze that browser test's clock at 2026-08-29T14:15:00Z before navigation so
  the Toronto-relative fixture label remains deterministic. Targeted local
  browser verification passes all four viewport/theme cases first try (6/6
  including auth) in 18.7 seconds.

**Verification:** targeted Daily/Attendance Playwright matrix (6/6), focused
application-browser checks (77 workflow tests, architecture/UI/design policies,
TypeScript, lint), and diff validation pass. Final CI/review remains pending.

**Model recommendation:** GPT-5.6 Terra high for the bounded browser-fixture
stability review; no broad product or CI-policy redesign is indicated.

## 2026-08-30 — Tween history zoom through the actual time window

**Risk profile:** low — client-side motion refinement in the shared
teacher/student history chart only; no API, persistence, authentication,
dependency, migration, or deployment behavior changed.

- Replaced the SVG scale transform with a frame-by-frame tween of the chart's
  actual visible start and end times. Bars now move continuously between the
  complete-history overview and the focused save window in both directions.
- Synchronized the daily-to-save crossfade and vertical character scale with
  the same symmetric easing curve. Hover no longer interrupts an active zoom;
  click-to-pin, keyboard selection, wheel zoom, horizontal pan, and the reduced
  motion instant path remain intact.
- Added deterministic animation-frame tests covering pointer-anchored zoom,
  midpoint interpolation, reciprocal dezoom, year-long histories, interruption,
  click locking, and reduced motion, plus pure easing/window interpolation tests.
- Independent review found three P2 transition-boundary issues in hover, click,
  and pan handling. One remediation batch keeps hover live against the rendered
  layer, pins the exact visible save or day, and retargets a mid-tween pan from
  the on-screen window without snapping. Direct regressions cover all three.
- Visual verification passed for the shared teacher and student examples at
  desktop and mobile widths, including captured zoom/dezoom intermediate frames
  and a long six-week history. Browser console errors: none. Dark mode is n/a
  because Pika does not currently expose a dark theme.
- `pnpm check:focused -- --base origin/main` passes: 77 workflow tests, 184
  focused tests, 576 related tests, TypeScript, lint, architecture, UI policy,
  and design policy. The Pika pre-commit audit passes.

**Composite-widget accessibility checklist:** reviewed: yes; semantic slider
state and keyboard selection remain covered by component tests; click selection
during tween is covered; reduced motion is covered; remaining manual follow-up:
none.

**Model recommendation:** GPT-5.6 Terra high for animation-state correctness,
interaction interruption behavior, and shared teacher/student compatibility.

## 2026-08-30 — Restore version context after discarding the separate zoom task

**Risk profile:** low — shared teacher/student history presentation and
interaction only; no API, persistence, authentication, dependency, migration,
or deployment behavior changed.

- Stopped the overlapping Smooth history zoom task and reverted only its three
  commits, returning the product tree exactly to the existing tween baseline.
- Added a compact chart context label: exact date, time, and character change
  for individual saves; date and daily addition/deletion totals in overview.
  Hover context clears on leave, while click-to-pin keeps the selected context
  visible. Large totals wrap within the 240 px student chart.
- Focused regression coverage passes 76/76 across the history graph, history
  utilities, assignment-history helpers, and gallery fixtures.
- Visual verification passed for teacher and student views, desktop/mobile
  widths, hover and pinned states, daily and exact-save labels, and dark mode.
  Browser console errors: none.

**Composite-widget accessibility checklist:** reviewed: yes; the visible label
is supplemental to the existing complete slider value text, keyboard behavior
is unchanged, and the label is hidden from the accessibility tree to avoid
duplicate announcements; remaining manual follow-up: none.

**Model recommendation:** GPT-5.6 Sol for branch-conflict recovery, scoped UI
rollback, history interaction correctness, and cross-role visual QA.

## 2026-08-30 — Add Daily relative-date context and stronger light header

**Risk profile:** none — teacher-only Daily presentation and pure date-label
formatting changed; no persistence, API, schema, Attendance commands, or student
behavior changed.

- Added a compact muted subtitle inside the Daily date selector for past dates:
  Today, Yesterday, elapsed days, weeks, months, or years. Forward dates keep
  the selector single-line, while configured Attendance context remains in the
  action bar's left slot.
- Gave the Daily table header a stronger light-theme surface using the existing
  `surface-3` token. The token resolves to the prior header value in dark mode,
  preserving the approved dark appearance.
- Added boundary coverage for every relative-date unit, future-date omission,
  action-bar updates while navigating, and the Daily-specific header surface.
- Independent follow-up review caught and fixed a shared `DateNavigator`
  regression: joined static labels without subtitles retain flex centering for
  Calendar's All-dates state, with direct regression coverage.
- Visual verification passed the teacher desktop/mobile light views, teacher
  desktop/mobile dark views, and unchanged student mobile view. The small
  subtitle remains legible without increasing the action bar's control height.

**Verification:** focused Daily/date tests; `pnpm check:focused -- --base
origin/main`; exact-branch Playwright teacher/student desktop/mobile captures;
browser console check; Pika audit; `git diff --check`.

**Model recommendation:** current model for this bounded teacher Daily context
and semantic-surface refinement.

## 2026-08-30 — Add Daily relative-date visibility preference

**Risk profile:** low — teacher-only local presentation preference; no API,
schema, Attendance command, or student behavior changed.

- Added a persistent Hide relative date / Show relative date toggle to Daily
  More actions, following the existing ID-column preference pattern.
- Hiding the subtitle preserves the established date selector layout and date
  navigation; reopening Daily restores the teacher's preference.
- Added component coverage for hide, persistence, and restore, plus browser
  coverage across teacher desktop/mobile and light/dark variants.
- Visual verification passed for the open menu and hidden selector states on
  teacher desktop/mobile in light/dark themes; the student view is unchanged.

**Verification:** focused Daily/date tests; targeted Daily Playwright matrix
(6/6 including auth); repository UI verification captures; Pika audit; focused
gate; `git diff --check`.

**Model recommendation:** current model for this bounded Daily preference.

## 2026-08-30 — Balance standalone teacher action-bar spacing

**Risk profile:** low — shared teacher work-surface presentation only; no
business logic, persistence, API, schema, or student behavior changed.

- Added the compact content-top spacing token above standalone teacher action
  bars. Together with the context bar's internal padding, this creates the same
  12px visual rhythm above and below the controls and matches page side gutters.
- Kept attached-tab shell behavior unchanged and added direct shell coverage
  for standalone summary and workspace states.
- Visual verification passed Daily, Classwork, Tests, Gradebook, and Roster on
  teacher desktop/mobile, plus a dark-mode Daily spot check and unchanged
  student baselines.

**Verification:** TeacherWorkSurfaceShell, Daily, and Classwork component tests;
repository UI verification across all five consumers; focused gate; Pika audit;
`git diff --check`.

**Model recommendation:** current model for this shared spacing refinement.

**Review follow-up:** independent cumulative review identified that the Daily
date button's explicit accessible name masked its new subtitle. Linked the
subtitle with a stable `aria-describedby` ID and added accessible-description
coverage for both shown and hidden states. The full focused gate remains green;
the correction does not change visual styling or the existing control name.

## 2026-08-30 — Enforce stable-SHA PR Gate launch

**Risk profile:** runtime-platform — GitHub Actions admission policy and its
workflow contract only; no product behavior, schema, dependency, secret, or
branch-ruleset change.

- Ran the approved post-#1125 audit after 25 completed natural CI attempts
  following 2026-08-30T15:49:02Z. Exact `pnpm measure:ci -- --limit 25` output:

```text
{
  "sampleSize": 25,
  "successfulSampleSize": 5,
  "counts": {
    "cancelled": 9,
    "skipped": 11,
    "success": 5
  },
  "cancellationRate": 0.36,
  "cancelledElapsedSeconds": 892,
  "successfulQueueSeconds": {
    "min": 0,
    "p50": 0,
    "p95": 0,
    "max": 0,
    "average": 0
  },
  "successfulRunSeconds": {
    "min": 467,
    "p50": 479,
    "p95": 518,
    "max": 518,
    "average": 483
  },
  "successfulWallSeconds": {
    "min": 467,
    "p50": 479,
    "p95": 518,
    "max": 518,
    "average": 483
  },
  "successfulRunsWithoutPrGateEvidence": 0,
  "prGateByMode": {
    "full": {
      "sampleSize": 5,
      "timeToGateStartSeconds": {
        "min": 464,
        "p50": 474,
        "p95": 513,
        "max": 513,
        "average": 479
      },
      "gateRunSeconds": {
        "min": 2,
        "p50": 2,
        "p95": 4,
        "max": 4,
        "average": 3
      },
      "timeToGatePassSeconds": {
        "min": 466,
        "p50": 478,
        "p95": 517,
        "max": 517,
        "average": 482
      }
    }
  }
}
```

- The full-mode p50 remains within target (478 seconds), but the checkpoint
  fails cancellation rate: 9/25 (36%). Eleven draft runs skipped every job;
  the five successes all produced `PR Gate` evidence. There was no fresh
  docs-only or production-promotion run, so those targets remain unevidenced.
- Each cancellation was inspected. Eight launched or queued on the same ready
  PR #1089 while successive commits and reverts were pushed; seven cancelled
  already-running Test & Build, browser, and database lanes, consuming 892
  seconds total. The remaining cancellation was draft-skipped. The two manual
  dispatches were separate exact-head full runs and did not overlap eligible
  pull-request runs.
- Preserve all safety lanes and branch rulesets. The bounded remedy admits
  heavy lanes only for `ready_for_review` or deliberate `workflow_dispatch`.
  A ready-PR push now runs only the lightweight required `PR Gate`, which fails
  with instructions to return to draft before pushing and mark the stable
  reviewed SHA ready again. This prevents skipped checks from satisfying branch
  protection and makes the documented lifecycle mechanically enforceable.

**Verification:** CI workflow contract (4/4), workflow suite (77/77), focused
full-mode checks (workflow, architecture, UI/design policy, TypeScript, lint),
Pika audit, and diff validation pass. Independent review and exact-head CI are
pending.

**Model recommendation:** GPT-5.6 Terra high for CI admission and protected
branch-safety review; no product-domain review is needed.

## 2026-08-30 — Focused check and agent workflow efficiency

- Combined workflow, changed, and related test selection in one native Vitest run; successful checks now print summaries/timings with full private temporary logs and complete failure output.
- Added opt-in startup context reuse while retaining environment/current-state checks; documented single-writer handoff, detached reviewer checkouts, evidence reuse, and compact context in the canonical workflow.
- Measured date-helper case: old runs executed 14 + 292 tests; combined selection retained the identical 292 unique cases in 21 files. One local sample took 9.94s versus 7.97s; not a general speed guarantee. Startup output was approximately 20 KB versus 5 KB when guidance was already loaded.
- Native two-project selection, standalone/space-containing paths, failure propagation, dry-run, invalid workflow/base, and startup-verification regression checks passed. No CI topology, application behavior, coverage threshold, dependency, model default, or migration changes.
