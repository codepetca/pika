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

## 2026-08-27 — Complete the canonical Test-question identity cutover

**Risk profile:** runtime-platform — Test draft, activation, Blueprint capture,
archive reuse, and migration concurrency contracts; no database was reset or
migrated and no hosted state changed.

- Defined one persisted portable question identity,
  `coalesce(source_artifact_id, artifact_id)`, while keeping
  `test_questions.id` internal. Post-backfill save, activation, and Blueprint
  capture no longer union portable identity with internal row identity.
- Made `question_identity_version: 1` mandatory for new and updated Test drafts.
  The pre-migration application can still project unmarked live drafts with
  exact internal-row precedence; migration 134 marks every live Test draft and
  installs an at-rest constraint that makes that compatibility branch
  unreachable after commit.
- Added uniqueness constraints for active Tests and Test questions at their
  portable identity boundaries. Capture selects only the active Test generation
  and remains read-only with respect to Test and question identity.
- Standardized write locking as Classroom, Test, Draft, then questions,
  including the shared question-mutation trigger. The database contract now
  runs save and activation against the real archived-Classroom reuse operation
  in both arrival orders.
- Preserved immutable Blueprint Versions byte-for-byte and kept legacy identity
  translation at the explicit cold-archive restore boundary. Restored resources
  are normalized in memory into the canonical marked format before reuse.
- Added a CI-only lifecycle contract that resets an ephemeral database to
  migration 133, seeds the known production row-ID/artifact-ID collision,
  applies 134, and continues through save and activation. It was syntax-checked
  locally but intentionally not executed outside CI.
- The focused 44-test identity/archive/capture suite, full 5,150-test suite,
  TypeScript, lint, architecture/design/UI policies, managed-storage lineage,
  shell syntax, diff validation, and production build pass.

**Model recommendation:** GPT-5.6 Sol for the finite compatibility cutover,
database concurrency review, and migration lifecycle verification.

## 2026-08-27 — Separate captured Test membership from source identity

**Risk profile:** runtime-platform — Classroom capture and Blueprint proposal
application contracts in unapplied migration 134; no database was reset or
migrated and no hosted state changed.

- Stopped treating `source_artifact_id` as both portable lineage and Blueprint
  membership. A captured origin Test now keeps `source_artifact_id = null` and
  records membership through the immutable capture Version.
- Active and archived Classroom capture record
  `source_blueprint_version_id` on participating Tests and materialized
  questions. The application layer only classifies a source-null Test as
  tracked when its Version matches the Classroom's current Blueprint Version.
- Replaced the migration 112 classroom-proposal apply RPC in migration 134 so
  Test matching and removal use source-first portable identity plus Version
  provenance. Classroom-only Tests without that provenance remain untouched.
- Added unit coverage for Version-based counting and snapshot filtering, plus a
  disposable-database capture → Blueprint edit → apply regression that updates
  the original Test row, creates no duplicate portable identity, and preserves
  an unrelated local Test.
- The focused 39-test identity/proposal suite, TypeScript, lint,
  architecture/design/UI policies, managed-storage lineage, shell syntax, diff
  validation, and production build pass. The full suite passed 5,150 of 5,151
  tests; its single unrelated Test-editor timing failure passed immediately in
  isolation. CI remains authoritative for the ephemeral migration replay.

**Model recommendation:** GPT-5.6 Sol for the Version-provenance database
contract and final migration replay review.

## 2026-08-27 — Migrate selected Test grading to the teacher work surface

**Risk profile:** async-grading — teacher Test roster presentation, sorting,
selection, and action routing changed around preserved grading mutations; no API,
schema, persistence, authentication, dependency, or student UI changed.

- Mapped the selected-Test domain before migrating it: whole-Test access remains
  distinct from selected-student access, while AI grade, unsubmit, return, and
  delete-work retain their existing eligibility and confirmation behavior.
- Adopted the shared teacher context bar, internally scrolling table frame, and
  selection bar. The whole-Test access control stays mathematically centered;
  lifecycle context and Test utilities stay quiet at the edges; bulk actions
  appear only after row selection.
- Split names into sortable/resizable First and Last columns, kept compact
  operational metrics, added sticky sortable/resizable headers, and added
  semantic count chips that can prioritize closed, submitted, or returned rows.
- Added a guarded long-roster fixture and responsive browser contract covering
  default, status-sorted, scrolled, and selected states on desktop/mobile in
  light/dark. Student UI is n/a because the surface is teacher-only.
- Composite-widget accessibility checklist reviewed: keyboard navigation and
  Escape behavior remain covered, semantic sort/pressed states have focused
  tests, and remaining manual follow-up is none. Existing design guidance
  already governs this surface, so no durable design rule was added.

**Verification:** focused Test/shared work-surface tests (71/71), responsive
Playwright matrix (4/4), lint, architecture/design/UI policies, Pika audit, diff
checks, and production build pass. Visual review covers eight captures: default
and selected long-roster states across desktop/mobile and light/dark.

**Model recommendation:** current GPT-5 coding model for a domain-sensitive
teacher workspace migration with responsive visual verification.

## 2026-08-27 — Tighten selected Test roster controls

**Risk profile:** UI-only — selected Test grading spacing, stacking, and checkbox
alignment changed; no grading behavior, permissions, API, schema, persistence,
authentication, dependency, migration, or student UI changed.

- Reduced the selected Test action-to-roster gap to the established Attendance
  work-surface spacing and kept the centered whole-Test action visually dominant.
- Raised the action-bar stacking context with the existing semantic layer token
  so the whole-Test split-button menu stays visible and interactive above the
  sticky roster header.
- Restored the shared selection-cell inset so the select-all checkbox and row
  checkboxes align on desktop and mobile.
- Added browser geometry regressions for the 4px maximum gap, checkbox-center
  alignment, and an unobscured menu, plus component coverage for menu semantics,
  Escape dismissal, and focus restoration.
- Composite-widget accessibility checklist reviewed: yes; keyboard behavior
  covered: yes; semantic state covered by tests: yes; remaining manual follow-up:
  none.

**Verification:** focused Test/shared component tests (87/87 plus final Test-only
68/68), responsive long-roster Playwright matrix (4/4), lint, design/UI policies,
Pika audit, and diff checks pass. Visual review covers default, menu-open, and
selected states on desktop/mobile in light/dark. Student UI is n/a because this
is a teacher-only surface.

**Model recommendation:** current GPT-5 coding model for a bounded teacher UI
remediation with responsive visual verification.

## 2026-08-27 — Consolidate Test grading actions at the top

**Risk profile:** UI-only — selected Test grading action placement and shared
teacher context-bar chrome changed; no grading behavior, permissions, API,
schema, persistence, authentication, dependency, migration, or student UI
changed.

- Removed the floating bottom selection bar from Test grading. Selecting rows
  now replaces the centered whole-Test control with the selected-student action
  toolbar in the same top command area.
- Preserved direct bulk actions on wide layouts and kept every action available
  from a top overflow menu on narrower layouts. Access, clear-selection, action
  eligibility, confirmations, and terminology are unchanged.
- Removed the 4px inset from the shared teacher context-bar floating chrome so
  the chrome hugs the existing 44px buttons instead of making the FAB appear
  oversized. This also keeps Attendance and Test on the same shared treatment.
- Removed obsolete bottom scroll clearance after the selection bar moved.
- Composite-widget accessibility checklist reviewed: yes; keyboard behavior
  covered: yes; semantic state covered by tests: yes; remaining manual follow-up:
  none.

**Verification:** focused Test/shared component tests (74/74, then 71/71 after
the final guard fixes), responsive long-roster Playwright matrix (4/4 twice),
lint, architecture/design/UI policies, Pika audit, diff checks, and live local
browser inspection pass. Visual review covers default and selected states on
desktop/mobile in light/dark; the live selected toolbar has 0px wrapper padding
while button height remains 44px. Student UI is n/a because this is a
teacher-only surface.

**Model recommendation:** current GPT-5 coding model for a focused responsive
teacher-work-surface interaction refinement.

## 2026-08-27 — Compact selected-student Test actions

**Risk profile:** UI-only — selected-student utility controls changed from
labeled buttons to icon buttons; no action eligibility, grading behavior,
permissions, API, schema, persistence, authentication, migration, or student UI
changed.

- Converted AI Grade, Unsubmit, Return, and Delete Work to shared teacher
  work-surface icon buttons on desktop while retaining their explicit accessible
  names, hover tooltips, disabled states, and destructive treatment.
- Kept the selected access split button labeled because it communicates the
  current action and scope, and retained labeled utility actions in the narrow
  layout overflow menu.
- Added component coverage for icon-only accessible naming and browser coverage
  for empty visible button text plus the AI Grade hover tooltip.
- Hardened an unrelated in-app Test preview regression exposed by CI coverage:
  its fetch mock now matches URL and method instead of depending on concurrent
  request order. Product code and preview behavior are unchanged.
- Composite-widget accessibility checklist reviewed: yes; keyboard behavior
  covered: yes (existing split/menu Escape and focus tests remain intact);
  semantic state covered by tests: yes; remaining manual follow-up: none.

**Verification:** full Vitest suite and full coverage suite (5,139/5,139),
responsive long-roster Playwright matrix (4/4), TypeScript, lint,
architecture/design/UI policies, Pika audit, and diff checks pass. Visual review
covers selected desktop/mobile states in light/dark and the desktop tooltip
hover state. Student UI is n/a because this is a teacher-only surface.

**Model recommendation:** current GPT-5 coding model for a bounded accessible
teacher-toolbar refinement.

## 2026-08-27 — Adopt persistent Test grading action scopes

**Risk profile:** standard — selected Test grading action placement, row access
state changes, and AI-grading request scope changed; permissions, enrollment
validation, test status rules, grading eligibility, persistence schema,
authentication, dependencies, migrations, and student UI are unchanged.

- Kept Open All and Close All as persistent icon commands in the centered Test
  action cluster, with tooltips and confirmation for the global mutations.
- Added one persistent student-actions menu that is disabled before selection,
  becomes a selected-count trigger, and contains only AI Grade, Unsubmit,
  Return, and Delete Work. Global access commands and selection clearing are not
  duplicated in the menu.
- Replaced row access icons with immediate semantic switches: green/right for
  open and red/left for closed, with a lock-state icon, accessible state, and no
  per-row confirmation.
- Added an AI Grade scope prompt for Only ungraded versus Regrade all and passed
  the explicit scope through a Zod-validated API boundary into run preflight.
  Ungraded scope now preserves any persisted grade; all scope queues eligible
  answered responses even when previously graded.
- Updated stable teacher operational-table guidance to combine Attendance's
  table rhythm with selected Test grading's persistent action-scope pattern.
  Attendance's bottom selection bar is now documented as migration debt for a
  later focused pass.
- Composite-widget accessibility checklist reviewed: yes; keyboard behavior
  covered: yes; semantic state covered by tests: yes; remaining manual follow-up:
  align Attendance with the new persistent selection-menu pattern in a separate
  change.

**Verification:** TypeScript, lint, focused Test/UI/API/validation tests
(117/117), responsive long-roster Playwright matrix (4/4), Pika audit, and diff
checks pass. Visual review covers default, global confirmation, selected menu,
and AI scope states on desktop/mobile in light/dark. Student UI is n/a because
this is a teacher-only surface.

**Model recommendation:** GPT-5.6 Sol for implementation and GPT-5.6 Terra/high
for one bounded independent correctness and requirements review.

## 2026-08-27 — Redesign teacher Attendance action hierarchy

**Risk profile:** standard UI interaction change — teacher Attendance action
placement and responsive grouping changed; Attendance permissions, session
states, command eligibility, confirmation polling, API behavior, persistence,
authentication, schema, migrations, dependencies, and student UI are unchanged.

- Implemented the user-selected Option 1 using the Test grading work-surface
  hierarchy without importing Test terminology or domain behavior.
- Joined the previous/date/next controls into one segmented date navigator. The
  arrows touch the date and the selectable date has no dropdown chevron.
- Moved Present, Late, Absent, and Clear mark from the transitional bottom bar
  into a persistent centered Student actions menu that is disabled before
  selection and becomes a selected-count trigger.
- Preserved explicit desktop QR and session commands. At 390 px, the same
  session actions collapse into one centered icon menu so the quiet edge utility
  menu cannot overlap the primary cluster.
- Kept Attendance hours and refresh at the quiet edge, retained status-count
  sorting and per-student status dots, and added a bordered internally scrolling
  roster with sticky sortable/resizable headers.
- Added component coverage for the joined date treatment, persistent selected
  actions, command confirmation, disabled states, and menu focus/arrow/Escape
  behavior. Expanded the Playwright experience matrix to a 45-student roster
  with default, selected, menu, sorted/scrolled, hours, mobile session-action,
  and browser-error checks.
- Retained the approved design target, normalized comparison boards, and the
  complete desktop/mobile light/dark evidence matrix under
  `docs/guidance/ui/evidence/attendance-actions-2026-08-27/`.
- Added no new durable rule because the reusable hierarchy was already
  established by the merged Test grading guidance. Corrected stale audit text
  that still described Attendance selection placement as migration debt; the
  joined date treatment remains scoped until another surface proves it reusable.
- One bounded independent review found that shared action-menu rows were shorter
  than the 44 px interaction target and lacked canonical visible focus. Added
  `min-h-control`, the inset focus ring, a regression assertion, refreshed the
  visual evidence, and corrected the stale work-surface audit state.
- Composite-widget accessibility checklist reviewed: yes; keyboard behavior
  covered: yes; semantic state covered by tests: yes; remaining manual follow-up:
  none.

**Verification:** focused component tests (20/20), responsive Attendance
Playwright matrix (4/4) after the mobile-overlap correction and again after the
menu accessibility remediation, TypeScript, lint, production build, Pika audit,
diff checks, and Product Design comparison pass.
Visual review covers teacher desktop/mobile in light/dark, default/selected/menu
states, internal scrolling/sticky headers, tooltips, mobile session actions, and
Attendance hours. Student UI is n/a because this is a teacher-only surface.

**Model recommendation:** GPT-5.6 Terra/high for one bounded independent review
of requirements coverage, responsive behavior, accessibility, and regression
risk.

## 2026-08-27 — Close Test identity release-safety gaps

**Risk profile:** runtime-platform — cross-version Test authoring compatibility
and Classroom/Test database lock ordering; no database was reset or migrated
and no hosted state changed.

- Replaced the missing-migration 503 with a narrow pre-134 fallback that maps
  marked portable question IDs back to exact legacy row IDs for persistence and
  activation while continuing to return the portable API contract. Active and
  closed saves accept metadata/document changes only when the question graph is
  unchanged; question edits require reopening as draft because migration 133
  cannot hold a student-entry fence across multiple application writes.
  Pre-migration activation is deliberately unavailable because migration 133
  has no transactional primitive that can safely synchronize questions while
  fencing every access override. Draft-only UUIDs remain in the legacy draft
  until migration 134 backfills them; the atomic RPC then materializes them.
  Draft-only/internal-row namespace collisions are rejected before writing.
- Added a real pre-migration integration contract to the disposable CI lifecycle:
  it runs closed-Test save and activation refusal against migration 133, covers the
  production-shaped row-ID/portable-ID collision plus draft-only collision
  rejection, active/closed refusal, edit/add/remove/reorder/reopen behavior,
  explicit pre-migration activation refusal, and a concurrent student-attempt
  race; it then applies migration 134 and verifies activation through the
  portable-only path.
- Wrapped student attempt save and submission so both acquire Classroom before
  Test, matching Test authoring, archive, Blueprint reuse, and child mutations.
  The original migration-088 implementations moved behind non-callable private
  functions, preserving behavior without exposing a bypass.
- Added database races for teacher question authoring versus both student
  autosave and submission. A third lock probe proves the student writer does not
  retain Test while waiting for Classroom, and both RPCs must complete without
  SQLSTATE 40P01 or partial state.
- The full 5,155-test suite, focused 63-test Test identity/API suite, TypeScript,
  lint, Pika audit, shell syntax, diff validation, and production build pass.
  The disposable migration replay remains CI-authoritative.

**Model recommendation:** GPT-5.6 Sol for the migration/concurrency correction
and GPT-5.6 Terra for cross-version compatibility review.

## 2026-08-27 — Make Blueprint provenance compatible with student work

**Risk profile:** runtime-platform — migration 134 trigger semantics and
production cutover controls; no database was reset or migrated and no hosted
state changed.

- Fixed the Test-question freeze so owner-run Blueprint identity mapping may
  update only `source_blueprint_version_id` after student work exists. The
  exception runs after Classroom/Test parent locks and requires both the
  transaction-local identity guard and the PostgreSQL owner; authored content
  and portable identity remain frozen.
- Added database regressions for active Blueprint capture and archived reuse
  with retained attempts and responses. They verify provenance is recorded,
  student work and question identity/content are unchanged, and an authored
  question mutation still raises `test_questions_locked`.
- Corrected production continuity to migrations 001–133 applied with only 134
  pending. Migration 134 now has a 10-second lock timeout and 15-minute
  per-statement timeout, with an idle-window preflight and fresh-authorization
  retry runbook. The production-shaped lifecycle deliberately blocks the
  migration, proves the timeout leaves 134 unapplied, then proves a clean retry.
- PR #1095 passed targeted independent safety review with no P0/P1/P2 findings.
  Full local tests pass (588 files, 5,168 tests), as do lint, TypeScript, build,
  Pika audit, focused migration tests, and all CI jobs. Production migration 134
  remains unapplied and still requires exact one-time authorization.

**Model recommendation:** GPT-5.6 Sol for migration and concurrency changes;
GPT-5.6 Terra for bounded compatibility review.

## 2026-08-27 — Course Guide Phase 1

**Risk profile:** cross-role UI plus authenticated and public-read APIs — a
classroom-backed guide, optional public sharing, teacher-managed guide content,
and one resource-save ordering migration applied to local only; staging and
production remain unchanged.

- Replaced user-facing Syllabus terminology with Course Guide while preserving
  the existing internal `syllabus` feature key and `/actual/[slug]` route for
  compatibility.
- Added one safe Course Guide projection and shared presentation for the
  authenticated teacher/student tab and optional public course webpage. The
  in-Pika guide is always available to the teacher and enrolled students; a
  public slug or publication state is no longer required. Removed the iframe
  preview and its message protocol.
- Published configured classroom sections: curriculum overview and
  expectations, resources, assignments, tests, lesson sequence, and
  announcements. Test questions/private uploads are excluded and document
  links are restricted to public HTTP(S) URLs; disabled sections are omitted
  from the public API payload.
- Added one consolidated curriculum overview and expectations editor plus the
  existing autosaving rules/links/reference resources editor directly inside
  the guide. Teacher-authored section headings become keyboard-clickable in
  edit mode, while derived assignments, tests, lesson sequence, and
  announcements remain read-only projections of the live classroom.
- Moved section visibility, lesson-sequence scope, and optional public sharing
  into an accessible Guide options dialog launched from the guide's focused
  floating action cluster. Removed the visible Course Guide Settings subtab;
  legacy `section=syllabus` URLs fall back to General while stored compatibility
  fields and APIs remain intact.
- Removed the redundant `Course Guide` page title from the guide content area;
  the classroom title now leads the document while teacher actions remain in
  the action bar.
- Removed the internal section jump links and kept all enabled guide sections
  in one continuous document with an explicit desktop scroll container inside
  the constrained classroom shell. Reduced doubled horizontal rules so only
  major-section and between-item separators remain.
- Removed course date ranges, term labels, and per-lesson dates from the guide.
  Retired the separate outline setting, visibility control, and rendered
  section while preserving its stored compatibility field. Seeded the local
  demo classroom overview with two Lorem Ipsum paragraphs for visual review.
- Added domain, server projection, authenticated/public API, component,
  settings, navigation, focus, mutation-failure, and regression tests. The full
  suite passes 5,146 tests across 591 files; lint, TypeScript, the production
  build, design/UI policy checks, and the Pika audit pass.
- Visual verification passed for teacher and student at desktop/mobile in
  light/dark, including read, edit, overview editor, resources editor, private
  and public options, saving, and save-error states. Semantic coverage also
  verifies loading, empty, retry, unpublished, archived read-only, unsaved
  discard, dialog focus/Escape/return, and section pressed states. No course
  dates added by the guide, outline section, second narrative editor, iframe,
  settings duplicate, or horizontal overflow remains. The local fixture stays
  private.
- Follow-up density pass reduced the guide header, section, assessment,
  lesson, announcement, and options spacing; shortened both authored editor
  canvases; and replaced the tall empty-resources checklist with one compact
  prompt. The title band is now slimmer, and the edit toggle plus its contextual
  Guide options/Done controls use the top-centred floating action position shared
  with Attendance. The Course Guide floating shell has no inset padding, so its
  shadow hugs the action edges. Focused tests and the 10-case cross-role browser
  matrix remain green.
- PR review removed the classroom join credential from every public/shared guide
  path, filtered future scheduled assignments, corrected duplicate-title grade
  matching, added unload-beacon POST support, made resource load failures
  non-editable/retryable, and restored the shared E2E classroom fixture after
  anonymous public-guide coverage.
- Final concurrency remediation adds migration 136 with a persisted
  monotonic resource `save_revision`, rejects stale PUT/beacon writes in the
  database, serializes and generation-fences client autosaves across classroom
  switches, and snapshots fixture state from the full classroom endpoint. The
  final local gate passes 5,191 tests across 594 files, lint, architecture,
  production build, and the Pika audit.
- With explicit one-time authorization, migrations 135 and 136 were applied to
  the local database only. Migration history now matches through 136, and the
  generated Supabase types were regenerated from and checked against that local
  schema. No hosted environment was touched.

## 2026-08-27 — Revise teacher Attendance controls after Option 1 selection

**Risk profile:** standard application behavior — teacher Attendance interaction,
read-model projection, and shared segmented-control styling API changed; existing
authorization, session/mark commands, confirmation polling, schema, migrations,
dependencies, authentication, and student UI are unchanged.

- Removed Attendance row-selection checkboxes and the selected-student actions
  menu. Added square, tooltip-backed Present/Late/Absent whole-roster controls
  to the centered cluster; each opens an explicit scope confirmation before
  posting marks for all enrolled students.
- Replaced static row statuses with an accessible three-state segmented control.
  Row corrections are immediate and reversible, use icons plus `aria-pressed`
  instead of color alone, retain 44 px targets, and support roving Arrow/Home/End
  keyboard navigation through the shared `SegmentedControl` primitive.
- Replaced Source with QR Check-in time. The teacher read model validates Pika's
  existing signed `attendance.record.changed` inbox events and projects the
  earliest QR-origin time/status per student, so a later staff correction can
  expose Restore QR check-in without losing durable provenance. No provider
  reference or raw integration payload is returned to the browser.
- Preserved Attendance-specific permissions, archived/closed states, session
  actions, command failures, status-count sorting, column resizing, internal
  roster scrolling, and mobile access to QR/open/close/hours/refresh utilities.
- Refreshed Product Design evidence for desktop/mobile, light/dark, default,
  manual-with-Undo, whole-roster confirmation, and hours states. Updated only
  stale Attendance-specific durable guidance; generic selection guidance remains
  conditional on selection feeding real batch actions.
- One bounded independent review found that QR inbox history was filtered by
  classroom/occurrence but not the active installation. Added query-level and
  defensive payload installation checks plus a rotation regression fixture, so
  an old provider installation cannot supply the Check-in time or Undo target.
  The same remediation batch historicalized a stale Test evidence note that
  still described the now-removed Attendance selection bar as active debt.
- Composite-widget accessibility checklist reviewed: yes; keyboard behavior
  covered: yes; semantic state covered by tests: yes; remaining manual follow-up:
  none.

**Verification:** focused API/server/component/UI tests (43/43), responsive
Attendance Playwright matrix (4/4), TypeScript, lint, production build,
architecture check, design-policy check, Pika audit, diff checks, and visual
reference comparison pass. Student UI is n/a because this remains a teacher-only
surface.

**Model recommendation:** GPT-5.6 Terra/high for one bounded independent review
of requirements coverage, QR provenance projection, accessibility, and
responsive regression risk.

## 2026-08-27 — Revise teacher Attendance controls after Option 1 selection

**Risk profile:** standard application behavior — teacher Attendance interaction,
read-model projection, and shared segmented-control styling API changed; existing
authorization, session/mark commands, confirmation polling, schema, migrations,
dependencies, authentication, and student UI are unchanged.

- Removed Attendance row-selection checkboxes and the selected-student actions
  menu. Added square, tooltip-backed Present/Late/Absent whole-roster controls
  to the centered cluster; each opens an explicit scope confirmation before
  posting marks for all enrolled students.
- Replaced static row statuses with an accessible three-state segmented control.
  Row corrections are immediate and reversible, use icons plus `aria-pressed`
  instead of color alone, retain 44 px targets, and support roving Arrow/Home/End
  keyboard navigation through the shared `SegmentedControl` primitive.
- Replaced Source with QR Check-in time. The teacher read model validates Pika's
  existing signed `attendance.record.changed` inbox events and projects the
  earliest QR-origin time/status per student, so a later staff correction can
  expose Restore QR check-in without losing durable provenance. No provider
  reference or raw integration payload is returned to the browser.
- Preserved Attendance-specific permissions, archived/closed states, session
  actions, command failures, status-count sorting, column resizing, internal
  roster scrolling, and mobile access to QR/open/close/hours/refresh utilities.
- Refreshed Product Design evidence for desktop/mobile, light/dark, default,
  manual-with-Undo, whole-roster confirmation, and hours states. Updated only
  stale Attendance-specific durable guidance; generic selection guidance remains
  conditional on selection feeding real batch actions.
- One bounded independent review found that QR inbox history was filtered by
  classroom/occurrence but not the active installation. Added query-level and
  defensive payload installation checks plus a rotation regression fixture, so
  an old provider installation cannot supply the Check-in time or Undo target.
  The same remediation batch historicalized a stale Test evidence note that
  still described the now-removed Attendance selection bar as active debt.
- Composite-widget accessibility checklist reviewed: yes; keyboard behavior
  covered: yes; semantic state covered by tests: yes; remaining manual follow-up:
  none.

**Verification:** focused API/server/component/UI tests (43/43), responsive
Attendance Playwright matrix (4/4), TypeScript, lint, production build,
architecture check, design-policy check, Pika audit, diff checks, and visual
reference comparison pass. Student UI is n/a because this remains a teacher-only
surface.

**Model recommendation:** GPT-5.6 Terra/high for one bounded independent review
of requirements coverage, QR provenance projection, accessibility, and
responsive regression risk.

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

## 2026-08-29 — Student work-surfaces review

**Risk profile:** none — documentation only, no application/schema changes.

- Added
  [`docs/guidance/ui/student-work-surfaces-review-2026-08.md`](../docs/guidance/ui/student-work-surfaces-review-2026-08.md),
  a code-inspection review of the student product paralleling the teacher
  work-surfaces canon/audit, done because teacher Attendance/Tests are
  considered stable and this refreshes the Student Workflow Map in
  `product-experience-audit-2026-07.md` against current code.
- Re-verified in code (not just the July doc) that the P0 submit-after-
  failed-save fix holds, the `ModalLayer` focus contract backs every student
  dialog, and `PageState`/`EmptyState` discipline is applied consistently
  across Today, Assignments, Tests, Calendar, Announcements, Achievements,
  and `/student/history`.
- Ranked findings: P1 is that `StudentTestsTab` (the largest student surface)
  and the Assignment editor have no student-specific mobile mode, matching
  the roadmap's already-deferred mobile items; P2 is `Card`-primitive drift
  in four files (`StudentTodayTab`, `StudentAnnouncementsSection`,
  `StudentClassResourcesSidebar`, `/student/history`) using raw
  `bg-surface`/`shadow-sm` boxes instead of `Card tone="panel"`.
- No `pnpm dev`/Playwright visual capture was run this pass; the doc calls
  out live verification as the explicit next step before treating any
  surface as done the way Attendance/Tests are done.

**Model recommendation:** Sonnet 5 is sufficient for the suggested next
steps (the Card-primitive convergence pass and Tests mobile-mode scoping);
escalate only if Tests mobile mode turns into a state-machine redesign.
