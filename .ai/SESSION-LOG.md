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

## 2026-08-23 — Make student mobile attendance state obvious

**Risk profile:** student-facing attendance read UX — private tenant-scoped
status reads, bounded revalidation, and QR check-in confirmation; no migration,
hosted data, deployment, flag, entitlement, credential, or production state
changed.

- Added a signed-in-student-only attendance status endpoint and bounded batch
  reader for active enrolled classrooms. It preserves teacher entitlement and
  exact-canary scope and returns no token, roster, other-student, or arbitrary
  classroom data.
- Added a prominent mobile Today banner and compact classroom-index status for
  open check-in, plus the student's own present/late confirmation and Toronto
  timestamp. The banner remains informational and scanning the teacher's QR is
  still required.
- Invalidated the private client snapshot after successful or idempotent
  duplicate scans, linked back to the matching classroom, and bounded refreshes
  while suppressing stale prompts at the exact close time. Review remediation
  added forced boundary reads, bounded failure retries, next-day-close support,
  exact local close/confirmation validity timers, and Toronto-midnight rollover
  for closed confirmations even when status refreshes fail.
- Added unit, API, component, and teacher/student experience-matrix coverage for
  entitlement and classroom isolation, unavailable and closed states, mobile
  rendering, and duplicate-scan confirmation. Visual checks passed across
  desktop/mobile and light/dark student views plus the prescribed teacher and
  student smoke screenshots.
- The full 5,049-test suite plus two later boundary regressions, lint,
  TypeScript, production build, architecture,
  design, UI, Pika audit, browser matrix, and diff checks pass. Local database
  runtime/type-parity guards remain intentionally unavailable because the local
  schema does not include unapplied migration 132; no migration was applied
  without fresh authorization.

## 2026-08-23 — Refine the student classroom attendance signal

**Risk profile:** student-only visual refinement; no attendance behavior,
authorization, schema, flag, deployment, or production state changed.

- Replaced the classroom-list attendance sentence with an icon-only Lucide
  QR-scan indicator in the card's upper-right corner. The open indicator uses a
  restrained reduced-motion-safe pulse; confirmed attendance uses the existing
  static success icon. Full scanning instructions remain on Today.
- Kept a polite named status for assistive technology and preserved the entire
  classroom card as the only interaction on the index.
- Focused component tests, TypeScript, lint, Pika audit, and the six-test
  desktop/mobile light/dark browser matrix pass. Visual verification passed for
  teacher/student smoke views and the student open state in every required
  viewport/theme combination.

## 2026-08-23 — Compact and statically highlight student attendance prompts

**Risk profile:** student-only visual refinement; no attendance behavior,
authorization, schema, flag, deployment, or production state changed.

- Shortened the open-state Today banner to the single line “Scan QR for
  Attendance” beside the QR-scan icon while preserving the private confirmed
  Present/Late state and timestamp.
- Replaced the classroom-list pulse with a static semantic accent ring and soft
  highlight, and applied the same non-interactive emphasis to the compact Today
  status. No attendance indicator now uses looping motion.
- Focused component tests (13), TypeScript, lint, Pika audit, and the six-test
  desktop/mobile light/dark attendance browser matrix pass. Visual verification
  passed for student open/closed/confirmed states and teacher/student regression
  views without overflow.

## 2026-08-23 — Close student attendance confirmation and clock-skew review gaps

**Risk profile:** runtime-platform — student-only attendance read reconciliation
and expiry timing; no attendance mutation, schema migration, flag, entitlement,
deployment, credential, or production state changed.

- Preserved validated successful and idempotent check-in results in a
  student-and-classroom-scoped, in-memory handoff while the asynchronous record
  projection converges. The handoff lasts at most two minutes, polls no faster
  than every five seconds, and clears for unavailable, unenrolled, archived, or
  projection-confirmed classrooms.
- Added validated server time to the private attendance status contract and
  anchored client refresh and visibility deadlines to monotonic elapsed time,
  preventing ahead or behind mobile clocks from retaining or hiding prompts at
  the wrong instant.
- Added component and browser regressions for stale-open navigation after an
  idempotent duplicate scan, client clocks two hours ahead and behind, bounded
  reconciliation, cross-student isolation, and automatic disabled-scope hiding.
- Independent re-review found and remediation removed an SSR-to-POST identity
  race by binding the handoff to the route-authenticated student returned in the
  positive response. Cached status views also retain their original monotonic
  receipt so remounting cannot re-age server time near close or expiry.
- A final integration re-review found that the short-lived scan handoff could
  override a newly closed/scheduled/no-session projection. The handoff now only
  overlays a still-open projection and is capped at its server-authored close.
- A fresh security pass found the status snapshot lacked a response-to-session
  identity binding. Status views now carry the GET-authenticated student ID and
  every post-auth response carries the same binding; success or failure
  mismatches are rejected, cleared, and never cached or rendered.
- A subsequent fresh security pass bound that handoff to the exact attendance
  occurrence with a student-scoped one-way tag, so a later open occurrence in
  the same classroom cannot inherit an earlier confirmation. Initial transient
  read failures now retry single-flight every 15 seconds while remaining
  claim-free until a validated private snapshot arrives.
- Focused tests, TypeScript, the full Vitest suite, lint, production build,
  architecture/design/UI guards, Pika audit, and the six-test desktop/mobile
  light/dark attendance matrix pass. Visual artifacts were inspected. The local
  database-type guard remains unavailable because the existing local Supabase
  schema predates already-merged attendance migrations; no migration or type
  rewrite was performed without authorization, and CI must use ephemeral replay.

## 2026-08-24 — Hide the titlebar fullscreen control on mobile

**Risk profile:** none — responsive presentation only; fullscreen behavior,
authorization, data, schema, and deployment state are unchanged.

- Hid the shared titlebar fullscreen/maximize control below the existing `sm`
  breakpoint while preserving the same desktop control and keyboard shortcut.
- Added a focused AppHeader regression assertion for the responsive visibility
  contract.
- Focused component tests, lint, and the design-policy check pass. Playwright
  visual verification passed for teacher and student titlebars at 390px and
  1440px in light and dark themes, with no horizontal overflow.

## 2026-08-24 — Consolidate live-attendance center FAB

**Risk profile:** none — teacher-only attendance navigation and action layout;
no attendance behavior, API contract, schema, flag, entitlement, or deployment changed.

- Moved the live-attendance date navigator from the action-bar label slot into
  the center floating action cluster alongside session actions.
- Replaced the scheduled-state Open attendance text button with an accessible
  DoorOpen icon button and shared tooltip while preserving its command behavior,
  loading state, disabled state, and accessible name.
- Kept the open-state QR and Close actions icon-only below the `sm` breakpoint,
  with accessible names and keyboard-disclosed tooltips, and increased mobile
  action-bar clearance so the center FAB does not overlap the session summary.
- All 11 focused component tests, lint, design policy, and UI policy pass; the
  Pika audit found no violations. Playwright verification passed at exact 320px
  and 375px widths in
  light and dark modes, including keyboard tooltip disclosure; student is not
  applicable to this teacher-only surface.

## 2026-08-24 — Simplify attendance-hours guidance

**Risk profile:** none — teacher-only copy and contextual-help refinement; no
attendance behavior, API contract, schema, flag, entitlement, or deployment changed.

- Removed the attendance-hours dialog subtitle and moved the Closing day and
  automatic scheduling explanations into accessible help-icon tooltips.
- Kept both concise labels visible, preserved checkbox/select behavior, and
  retained shared semantic tokens, tooltip ownership, focus treatment, and
  minimum control targets.
- The focused dialog suite, lint, and UI policy checks pass. Playwright visual
  verification passed for teacher desktop/mobile, light/dark, and both hover or
  keyboard-focus tooltip states. Independent review found that touch taps do not
  open Radix tooltips, so each help icon now also toggles an accessible inline
  disclosure with verified first-tap open and second-tap dismissal. Disclosure
  state resets between dialog sessions so reopened settings remain concise.
  Student is not applicable to this teacher-only dialog.

## 2026-08-24 — Rebase and reverify attendance-hours guidance

**Risk profile:** workspace-state — rebased the existing teacher-only UI
refinement onto current `origin/main`; no product behavior, schema, migration,
flag, entitlement, or deployment state changed.

- Preserved current `main` behavior and archive lineage while replaying all
  three attendance-hours refinement commits. The only conflict was the
  generated continuity archive marker; no migration files were added or
  renamed, and no task stash was created.
- Focused component tests (7/7), lint, UI policy, design policy, continuity-log
  validation, and diff checks pass on the rebased worktree.
- Playwright verification passed for teacher desktop/mobile, light/dark,
  hover, keyboard-focus, and both touch-disclosure states. Student remains not
  applicable to this teacher-only dialog.
- Fresh rebased-head review found collapsed help buttons retained `aria-controls`
  references to absent disclosure elements. The relationships are now emitted
  only while expanded, with focused assertions covering both help controls.
- The remediated focused suite remains 7/7 passing; lint, UI policy, design
  policy, continuity-log validation, and diff checks pass.

## 2026-08-24 — Simplify teacher Daily class-log summary

**Risk profile:** none — teacher-only presentation refinement; summary loading,
content, resizing behavior, API contracts, schema, and student surfaces are unchanged.

- Removed the horizontal dividers from the expanded Class Log Summary resize
  handle, title row, and generated timestamp.
- Standardized summary content and state padding so the copy shares the title's
  left edge across ready, pending, empty, and error states, with a normal 8px
  title-to-copy gap.
- Removed the redundant Needs Attention label while preserving the warning dot
  and linked student name. The list retains a nonvisual accessible name and the
  decorative dot is hidden from assistive technology.
- Added the shared Toronto-aware `formatRelativeDateTimeInToronto` helper for
  `Today`, `Yesterday`, and compact older timestamps, including DST-boundary
  coverage, and adopted it for the generated-summary label.
- The focused component and timezone suites pass (34/34), the full Vitest suite
  passes (5,077/5,077), lint and the production build are clean apart from the
  existing WorkOS Edge-runtime warnings, and diff checks pass. Playwright visual
  verification passed for teacher desktop/mobile in light/dark themes using an
  isolated exact-class harness because the shared local environment has no
  Supabase test credentials. Student is not applicable to this teacher-only panel.

## 2026-08-24 — Verify the enabled attendance entitlement rollout

**Risk profile:** runtime-platform — authorized local database reset and
production signed smoke verification; no production migration, deployment,
flag, entitlement, cleanup, or attendance-data mutation was performed.

- Reset the shared local database and replayed migrations 001-132 from current
  `main`, repairing an older installed migration-131 smoke-function definition.
  The complete Bara attendance database contract now passes; local remains
  intentionally unseeded.
- Read-only production checks confirmed migrations 001-132 are recorded and
  the installed migration-131 smoke cleanup plus migration-132 entitlement
  contracts are present.
- An authorized pre-enable exact-canary diagnostic failed before smoke state
  with `attendance_disabled_for_preflight` and `attendance_scope_mode`, proving
  production had already advanced beyond the stale continuity record.
- The separately authorized deployed smoke then passed 4/4 in `enabled` mode
  with `teacher_entitlements` as current and target scope, proving canary scope,
  transition-queue health, and both signed Pika/Bara directions.

## 2026-08-25 — Adopt relative assignment timestamps

**Risk profile:** none — teacher/student assignment timestamp presentation only;
no assignment state, API contract, schema, persistence, or layout behavior changed.

- Adopted the shared Toronto-relative date formatter for the live teacher
  saved-version preview, student returned-feedback timestamps, and student
  submission labels. The unreferenced legacy `TeacherStudentWorkModal` remains
  unchanged rather than broadening this work into its unrelated audit debt.
- Preserved the student's exact saved-version date in the restore confirmation,
  where an unambiguous historical identifier remains more useful than relative copy.
- Focused teacher/student component and timezone tests pass (51/51), the full
  Vitest suite passes (5,079/5,079), and lint, build, architecture, design, UI,
  audit, continuity, and diff gates are clean apart from the existing WorkOS
  Edge-runtime build warnings. Playwright verification passed for the affected
  teacher/student compositions on desktop and mobile in light and dark themes
  using a temporary Pika-token harness because the shared local environment has
  no Supabase credentials; the harness was removed. The composite-widget
  checklist was reviewed: keyboard and semantic behavior are unchanged, with
  no remaining manual follow-up.

## 2026-08-25 — Reconcile attendance rollout documentation

**Risk profile:** none — documentation consistency only; no migration,
deployment, configuration, entitlement, smoke, or hosted data changed.

- Reconciled the adapter status, control runbooks, native-attendance roadmap,
  canary boundary, and completion audit with the verified production state:
  migrations through 132, enabled `teacher_entitlements`, and the passing 4/4
  deployed smoke.
- Preserved the exact pair as the signed-smoke scope, retained separate
  authorization for future changes, and replaced completed pre-enable steps
  with the remaining entitled-teacher workflow, UI, isolation, and pilot gates.
- Review remediation rewrote the operational-recovery procedure from the
  current enabled state and extended the rollout regression to cover the
  compact handoff plus production smoke instructions.
- Final remediation made the regression pin the runbook's dated 4/4 status and
  complete enabled production command, preventing a partial command or stale
  pre-enable block from satisfying the rollout-continuity gate.
- Rebased onto current `main`, retained its assignment timestamp work and
  canonical continuity history, then corrected the v1 guide's production
  preflight example to the enabled entitlement state and pinned the full command
  in regression coverage.
- Rereview hardened that regression to inspect fenced preflight commands
  independent of option order while allowing historical prose and preview-only
  pre-enable examples.
- Final parser remediation reconstructs individual continued commands across
  common shell fence labels, preventing cross-command false positives and
  catching reordered or equals-form stale production flags.
- With an explicitly extended review budget, replaced the growing shell parser
  with an exact single-purpose preflight-fence contract and labeled the
  migration-132 rollout sequence as completed audit history rather than future
  operator instructions.

## 2026-08-25 — Pin the student Pal companion on iPhone

**Risk profile:** none — student-only Pal companion placement; no academic
state, API contract, authentication, schema, or reward behavior changed.

**Model recommendation:** GPT-5.6 — localized host-layout work with
cross-browser verification and a bounded independent review.

- Made the Pika-owned companion host explicitly use a non-interactive
  bottom-right placement contract backed by Pika spacing/layer tokens and iOS
  safe-area insets.
- Added component and stylesheet contract coverage for the placement invariant
  while preserving the existing test-surface suppression and Pal failure
  boundary behavior.
- The focused suites pass (19/19), the full Vitest suite passes
  (5,081/5,081), and lint, TypeScript, architecture, design, UI, and diff gates
  are clean after rebasing onto current `main`.
- Playwright visual verification passed for student desktop/mobile in light and
  dark themes and for an iPhone 13 WebKit profile; teacher desktop/mobile were
  checked as unaffected. Chromium and WebKit pointer-drag probes both retained
  the same bottom-right rectangle at 16px from the viewport edges.

## 2026-08-25 — Verify entitled-teacher active-class readiness

**Risk profile:** runtime-platform — read-only production UI and aggregate
database verification; no production migration, deployment, entitlement,
configuration, flag, cleanup, or attendance-data mutation was performed.

- Confirmed the entitled teacher sees Attendance in the sole active production
  classroom and that its enabled policy plus opaque roster/schedule mapping are
  fully synced.
- Added the target-pinned, aggregate-only `attendance:pilot:readiness` operator.
  It emits no teacher, classroom, roster, or student identifiers and fails
  closed unless configured and unconfigured active classrooms both exist.
- The production run correctly reported
  `requires_at_least_two_active_classrooms` and
  `requires_unconfigured_active_classroom`; the save-isolation gate therefore
  remains open until a second intended active classroom exists or an exact
  temporary setup and restoration is separately authorized.
- Added focused readiness, service-role read-path, and operator-contract
  coverage. The full suite passes (5,085/5,085); lint, TypeScript, and the
  production build pass with only the existing WorkOS Edge-runtime warnings.
- Independent review found that separate REST reads could observe inconsistent
  states, an unconfigured Class mapping could mask a missing configured-Class
  mapping, the service-role transport was not operation-read-only, and output
  could expose unstable error or revision detail.
- Remediated those findings with proposed, unapplied migration 133: one stable
  aggregate SQL RPC, configured-Class mapping association, an exact RPC/teacher
  transport allowlist, stable operator failure codes, and database regression
  coverage. The final suite passes (5,089/5,089); lint, TypeScript, architecture
  boundaries, and the production build pass. Production remains through
  migration 132 and was not modified.
- Targeted re-review caught and fixed a database-test false positive where the
  allowed `roster_mappings` key matched a broad `roster_` leak substring. The
  assertion now requires exactly the eight aggregate keys with numeric values;
  migration 133 remains unapplied pending exact authorization.

## 2026-08-25 — Repair Blueprint Test question identity mapping

**Risk profile:** runtime-platform — the initial database RPC replacement was
applied locally; its review revision awaits authorized local reapplication. No
staging or production migration was applied.

- Traced production Blueprint capture operation
  `33a23284-60e1-492a-8409-cf316e79eebf` to a `23505` uniqueness failure and
  confirmed Test draft questions intentionally use JSON array order rather than
  a persisted `position` field.
- Added proposed migration 134 so active Classroom capture and archived
  Classroom reuse map Test question identities by zero-based JSON ordinality,
  preserving the managed-storage wrapper, RPC signatures, privileges, and all
  unrelated function behavior.
- Added rollback/replay database coverage and CI wiring. The new rollback-only
  harness reproduces the production `23505` artifact-identity collision against
  the pre-134 schema; the local dry run contains only migration 134.
- After exact one-time authorization, migration 134 applied locally as the sole
  pending migration. The post-migration database harness passes active capture,
  archived reuse, rollback, identity order, and replay; adjacent atomic
  Blueprint, versioned Blueprint, and managed-storage contracts also pass.
- Initial PR review found that valid source positions can contain gaps after a
  question deletion. Fix batch 1 now maps each JSON question to the nth source
  row ordered by `(position, id)` and gives both active and archived fixtures
  positions `0,2`; the strengthened harness failed against the installed
  pre-review function as expected.
- After exact destructive-reset authorization, local was reset without seeding
  and migrations 001-134 replayed from the reviewed branch. The strengthened
  active/archived gap-position harness, adjacent atomic and versioned Blueprint
  contracts, managed-storage contract, generated types, lint, architecture,
  audit, and 48 focused tests all pass.
- Lint, architecture boundaries, generated database types, focused Blueprint
  tests, and the full Vitest suite pass (5,093/5,093). Staging and production
  remain unchanged, and the worktree has no production project binding.

## 2026-08-25 — Repair Blueprint Test question identity mapping

**Risk profile:** runtime-platform — the initial database RPC replacement was
applied locally; its review revision awaits authorized local reapplication. No
staging or production migration was applied.

- Traced production Blueprint capture operation
  `33a23284-60e1-492a-8409-cf316e79eebf` to a `23505` uniqueness failure and
  confirmed Test draft questions intentionally use JSON array order rather than
  a persisted `position` field.
- Added proposed migration 134 so active Classroom capture and archived
  Classroom reuse map Test question identities by zero-based JSON ordinality,
  preserving the managed-storage wrapper, RPC signatures, privileges, and all
  unrelated function behavior.
- Added rollback/replay database coverage and CI wiring. The new rollback-only
  harness reproduces the production `23505` artifact-identity collision against
  the pre-134 schema; the local dry run contains only migration 134.
- After exact one-time authorization, migration 134 applied locally as the sole
  pending migration. The post-migration database harness passes active capture,
  archived reuse, rollback, identity order, and replay; adjacent atomic
  Blueprint, versioned Blueprint, and managed-storage contracts also pass.
- Initial PR review found that valid source positions can contain gaps after a
  question deletion. Fix batch 1 now maps each JSON question to the nth source
  row ordered by `(position, id)` and gives both active and archived fixtures
  positions `0,2`; the strengthened harness failed against the installed
  pre-review function as expected.
- After exact destructive-reset authorization, local was reset without seeding
  and migrations 001-134 replayed from the reviewed branch. The strengthened
  active/archived gap-position harness, adjacent atomic and versioned Blueprint
  contracts, managed-storage contract, generated types, lint, architecture,
  audit, and 48 focused tests all pass.
- Lint, architecture boundaries, generated database types, focused Blueprint
  tests, and the full Vitest suite pass (5,093/5,093). Staging and production
  remain unchanged, and the worktree has no production project binding.

## 2026-08-26 — Adopt Pal widget alpha.5

**Risk profile:** none — pinned widget package and compatibility assertions only;
no schema, API, persistence, authentication, or production state changed.

- Published and installed the immutable registry release
  `@codepet/pal-widget@0.1.0-alpha.5`; the `alpha` dist-tag resolves to alpha.5
  and the regenerated lockfile records its npm registry integrity rather than a
  temporary tarball path.
- Updated the package pin and compatibility assertions for concealed achievement
  titles and collectible-focused story celebrations. The Pika-owned reward modal
  now asserts `The Clockwork Lantern`, sketch art, and the absence of the retired
  `Story Keeper` title.
- Focused Pal integration tests pass (19/19), the registry-backed full Vitest
  suite passes (5,090/5,090), and frozen install, lint, TypeScript, architecture
  boundaries, and the production build pass.
- Playwright desktop (1440x900) and mobile (390x844) review confirmed the modal
  remains centered and responsive with the collectible-only presentation. The
  temporary unauthenticated review route was removed; teacher review is n/a
  because the integration is student-only.

## 2026-08-26 — Stabilize unsaved-grade action test

**Risk profile:** none — test synchronization only; no application behavior,
schema, API, persistence, authentication, or production state changed.

- Confirmed the intermittent `TeacherClassroomView` failure was an assertion
  race: the mocked grading panel renders before its passive effect reports the
  pending-grade state to the parent.
- Moved the panel predicate and all three disabled-action assertions into one
  `waitFor`, so the test awaits the observable contract instead of assuming
  effect timing.
- The focused test passes 20/20 repetitions, all 50 tests in the component file
  pass under coverage, the full 5,090-test coverage suite passes, and lint is
  clean.

**Model recommendation:** GPT-5.6 Sol for precise React effect and async-test
reasoning.

## 2026-08-26 — Improve mobile classroom navigation

**Risk profile:** none — shared classroom-shell navigation and responsive
presentation only; no API, schema, persistence, dependency, or hosted state changed.

- Added Pika's home affordance to the mobile classroom drawer as a distinct
  `All classrooms` navigation row beneath the `Navigation` heading, with its
  own surface, hover state, and focus ring. The desktop header logo is unchanged.
- Reclaimed the unused mobile header center column for the classroom selector,
  so the seeded `Test Classroom` label renders in full instead of collapsing to
  its first character.
- Added regression coverage for mobile layout ownership, drawer home navigation,
  blocked navigation, the Pika brand link, and active student exam mode hiding
  the mobile navigation while rejecting direct home-exit attempts.
- Full Vitest passes (5,096/5,096), lint, design policy, UI policy, and diff
  checks pass. Playwright visual verification passed for teacher and student,
  desktop and mobile, light and dark, including drawer-open and keyboard-focus
  states. Mobile captures had no horizontal overflow, and both roles navigated
  from the drawer to `/classrooms`.

## 2026-08-26 — Simplify the student Daily Log prompt

**Risk profile:** none — student-facing prompt copy and hierarchy only; no
editor, API, persistence, authentication, or teacher behavior changed.

- Removed the rotating reflection opener and fresh-start copy so the Daily Log
  shows only `What's your plan for today?` as its primary prompt.
- Kept the existing rich-text writing area, placeholder, focus behavior, and
  save state unchanged, per product direction.
- Focused Daily Log coverage passes 22/22; lint and UI policy pass. Playwright
  visual verification passed for student desktop/mobile in light/dark and for
  the unchanged teacher desktop/mobile views.

**Model recommendation:** GPT-5.6 for small, judgment-sensitive UI refinements.

## 2026-08-26 — Match the Pika logo to theme text

**Risk profile:** none — shared brand presentation only; no layout, API, schema,
persistence, authentication, dependency, or hosted state changed.

- Replaced the logo's warm dark-mode image filter with a semantic mask colored
  by `--color-text-default`, so the mark exactly matches primary text in light
  and dark themes.
- Preserved the logo's accessible image name and existing dimensions while
  updating shared-header regression coverage for the semantic token contract.
- Focused component and semantic-token tests pass (19/19); lint, design policy,
  diff checks, and the production build pass (with existing WorkOS Edge-runtime
  warnings).
- Playwright screenshots were visually reviewed for teacher and student
  contexts at desktop/mobile in light/dark. Authenticated routes were unavailable
  because the shared env lacks Supabase configuration, so the real shared header
  and logo were rendered in a temporary local verification route that was removed
  after capture.

- PR #1072 independent review found no implementation blockers. Initial CI
  exposed one stale `getByAltText` assertion in the mobile sidebar test; it now
  verifies the preserved accessible image role and name, and the focused header
  plus sidebar suite passes (11/11).

**Model recommendation:** GPT-5.6 Sol for exact semantic-theme and visual review.

## 2026-08-26 — Leave missing student Today lesson plans blank

**Risk profile:** none — student-facing empty-state copy only; no lesson-plan
data, loading behavior, API, schema, persistence, or teacher UI changed.

- Removed the `No lesson plan for today` and missing previous-class lesson-plan
  messages from the student Today sidebar while preserving its Today/Yesterday
  headings, dates, real lesson content, loading state, and no-previous-class copy.
- Updated the classroom-page regression coverage to assert both empty lesson
  messages remain absent after a classroom route change.
- The focused 30-test component suite, lint, and environment verification pass.
  Playwright review of the exact sidebar component passed at desktop/mobile in
  light/dark with no overflow or browser console errors; the temporary review
  route was removed after capture. Teacher review is n/a because the changed
  sidebar is student-only.

**Model recommendation:** GPT-5.6 for a narrow, copy-only UI refinement.

## 2026-08-26 — Pin student Achievements navigation to the bottom

**Risk profile:** none — student classroom navigation ordering and layout only;
no API, schema, persistence, dependency, or hosted state changed.

- Moved the student-only Achievements destination out of the primary classroom
  navigation cluster and pinned it to the bottom of the desktop sidebar and
  mobile navigation drawer. Teacher navigation remains unchanged.
- Added regression coverage for the complete student navigation order, active
  `aria-current` state, and the bottom-placement class.
- Full Vitest passes (5,096/5,096). Focused navigation/sidebar tests pass
  (16/16), lint, design policy, Pika audit, and diff checks pass.
- Playwright visual verification passed for student and teacher, desktop and
  mobile, light and dark. The active Achievements link stays inside the viewport
  at the bottom edge with no horizontal overflow.
- Composite-widget checklist reviewed: keyboard behavior is unchanged; semantic
  active state is covered by tests; remaining manual follow-up: none.

**Model recommendation:** GPT-5.6 Sol for the small shared-shell layout change
and bounded PR review.

## 2026-08-26 — Move student check-in status into Today side card

**Risk profile:** none — student Today-tab composition only; no attendance
logic, API, schema, persistence, authentication, or hosted state changed.

- Moved the existing `StudentAttendanceStatus` banner from above the daily-log
  editor into the right-side lesson-plan card's `Today` section. The signed-in
  student identity and classroom-scoped status selection remain unchanged.
- Kept the open state as the one-line `Scan QR for Attendance` prompt and
  simplified confirmation to one line: `Checked in at 9:07 AM`. The visible
  Present/Late taxonomy, timezone suffix, and secondary confirmation line were
  removed from this student surface.
- Added focused coverage proving the attendance hook receives the signed-in
  student and the rendered status is contained by the `Today` side-card
  section. A dedicated mobile inspector keeps the side card before the Daily
  Log in both visual and assistive-technology reading order below `lg`, while
  desktop keeps the Daily Log before the right-side inspector. Attendance
  status and Today-history regressions remain covered.
- Focused Vitest passes (82/82), lint and design policy pass. Playwright
  captures of the real component and side-card markup cover QR-open and
  confirmed states on desktop/mobile in light/dark with no banner overflow,
  wrapping, or legibility issues. The temporary visual
  fixture was removed; the authenticated app matrix was unavailable because
  the shared local environment has no Supabase URL or keys. Teacher UI is n/a
  because this composition renders only for the student Today workspace. A
  focused responsive-order capture also confirms Today-first stacking on
  mobile and the unchanged right-side placement on desktop.

**Model recommendation:** current model for a localized React composition and
visual-verification change.

## 2026-08-26 — Prevent the mobile Pika logo from flashing blank

**Risk profile:** none — shared brand rendering only; no navigation behavior,
layout, API, schema, persistence, dependency, or hosted state changed.

- Replaced the network-backed `/pika.png` CSS mask with the existing compact
  brand image embedded as a shared CSS data-URI token. This preserves semantic
  light/dark coloring while making the mask available on the first drawer paint.
- Added regression coverage for the inline mask contract and explicitly rejects
  restoring the delayed external mask.
- Full Vitest passes (5,097/5,097); focused header/sidebar tests pass (11/11).
  Lint, architecture, design policy, UI policy, Pika audit, diff checks, and the
  production build pass (with existing WorkOS Edge-runtime warnings).
- Playwright visual verification passed for teacher and student at desktop/mobile
  in light/dark. The mobile drawer was captured immediately after opening; the
  Pika mark is present in all four cold-open mobile captures with correct theme
  color and no overflow.
- PR CI exposed stale attendance-matrix assertions from the preceding Today-card
  merge. The test now targets the visible responsive inspector and the current
  one-line confirmation copy; its desktop/mobile, light/dark matrix passes (6/6).

**Model recommendation:** current frontier coding model for a narrow visual-load
regression with cross-role and cross-theme verification.

## 2026-08-26 — Adopt Pal widget alpha.5

**Risk profile:** none — pinned widget package and compatibility assertions only;
no schema, API, persistence, authentication, or production state changed.

- Published and installed the immutable registry release
  `@codepet/pal-widget@0.1.0-alpha.5`; the `alpha` dist-tag resolves to alpha.5
  and the regenerated lockfile records its npm registry integrity rather than a
  temporary tarball path.
- Updated the package pin and compatibility assertions for concealed achievement
  titles and collectible-focused story celebrations. The Pika-owned reward modal
  now asserts `The Clockwork Lantern`, sketch art, and the absence of the retired
  `Story Keeper` title.
- Focused Pal integration tests pass (19/19), the registry-backed full Vitest
  suite passes (5,090/5,090), and frozen install, lint, TypeScript, architecture
  boundaries, and the production build pass.
- Playwright desktop (1440x900) and mobile (390x844) review confirmed the modal
  remains centered and responsive with the collectible-only presentation. The
  temporary unauthenticated review route was removed; teacher review is n/a
  because the integration is student-only.

## 2026-08-26 — Canonicalize Test-question identity from draft creation

**Risk profile:** runtime-platform — application identity synchronization,
transactional migration/backfill, immutable-Version instantiation, and database
contract changes; no hosted migration, deployment, or merge occurred.

- Defined `TestDraftQuestion.id` as the portable Artifact ID assigned when the
  question is created; `test_questions.id` remains an internal row identity.
  New persisted questions now store the draft UUID in `artifact_id`, and draft
  reconstruction prefers source/artifact identity over row identity.
- Made activation preflight and synchronize by artifact/source identity without
  positional matching or partial updates on identity ambiguity. Blueprint
  capture and archived reuse now validate source identity read-only; draft-only
  IDs remain portable without creating or rewriting source rows.
- Migration 134 transactionally backfills legacy row-ID draft JSON, fails closed
  on ambiguous matches, and rematerializes newly instantiated Version questions
  with explicit artifact/source IDs rather than inferring them by position.
- Rebased the worktree onto PR #1066 head `cc7c14d7` while retaining the
  separately completed durable failure-ledger remediation. The authorized local
  database was reset without seed to replay the final migration; hosted state
  was untouched.
- The canonical identity and broader Versioned Blueprint database contracts
  pass. The full Vitest suite passes (5,106/5,106), as do lint, the production
  build, generated Supabase type checks, diff checks, and the Pika audit.

## 2026-08-26 — Make Blueprint question identity capture draft-safe

**Risk profile:** runtime-platform — proposed migration and rollback-only test
coverage; no staging or production migration, deployment, or merge occurred.

- Replaced ordinal row lookup in proposed migration 134 with stable identity
  matching across physical, artifact, and source-artifact IDs. Missing rows are
  accepted for draft-only additions; multiple matching rows fail closed with
  SQLSTATE `22023`.
- Added active and archived regressions for deleted and reordered questions,
  draft-only additions, ambiguity after an earlier identity write, atomic
  rollback, successful capture/reuse, and idempotent replay.
- The ambiguity fixture now requires the exact active/archived error message and
  verifies active classroom Blueprint linkage, operation, Blueprint, and source
  identity writes all roll back.
- Rebasing onto `origin/main` preserved migration number 134 because main ends
  at 133. Continuity-history conflicts were resolved without restoring the
  duplicate archived attendance entry.
- Focused Blueprint tests (30/30), lint, architecture boundaries, generated
  database types, and the production build pass. The installed local function
  is an earlier 134 revision, so fresh-database CI remains the authoritative SQL
  replay gate; local migration state was not changed without new authorization.

## 2026-08-26 — Preserve Blueprint identity failure evidence

**Risk profile:** runtime-platform — proposed migration and transactional
database regression changes only; no local, staging, or production migration,
deployment, or merge occurred.

- Wrapped the active-capture and archived-reuse identity writes in an outer
  ledger-owned transaction boundary. Identity ambiguity now rolls back the full
  Blueprint graph while retaining a structured failed operation with stable
  `test_question_identity_ambiguous` code and SQLSTATE `22023`.
- Strengthened the database contract to assert the failed ledger, rolled-back
  domain writes, a successful same-key retry after repairing the source
  collision, and idempotent replay for both active and archived sources.
- The full Vitest suite passes (5,093/5,093), as do lint, architecture
  boundaries, generated database types, the Pika audit, and the production
  build. The database regression still requires fresh-database CI because the
  installed local function is an earlier migration 134 revision.

## 2026-08-26 — Keep archived Blueprint repair retries idempotent

**Risk profile:** runtime-platform — application request hashing and regression
coverage only; no migration application, deployment, or merge occurred.

- Removed the archived source revision from the stable Blueprint operation
  request hash while retaining it as the RPC stale-read precondition. The UI's
  retained operation key can now retry after an identity-only source repair
  advances the Classroom revision.
- Added a server regression proving revision-only retries send the new expected
  revision with the original request hash. The database fixture now proves the
  repair advances the source revision before its same-key retry.
- Focused Blueprint tests (20/20), architecture boundaries, the Pika audit, and
  the production build pass. Fresh-database CI remains the authoritative SQL
  replay gate because the installed local function is an earlier migration 134
  revision.

## 2026-08-26 — Harden PR 1066 identity compatibility and migration fencing

**Risk profile:** runtime-platform — draft/API identity compatibility,
transactional migration backfill, and browser-contract regression updates; the
authorized local database was reset, while hosted state remained untouched.

- Centralized Test-question identity resolution so draft reads, activation, and
  Blueprint capture use the same exact portable-ID and legacy row-ID contract.
  UUIDs are normalized to PostgreSQL-compatible lowercase semantics, ambiguous
  or colliding matches fail before writes, and no positional/content heuristic
  is used.
- Preserved draft-created UUIDs as `artifact_id` during activation and added a
  capture-to-activation-to-reconstruction regression. Blueprint projection is a
  read-only compatibility operation and does not assign or mutate source IDs.
- Made migration 134 lock the draft table during its scan/backfill and increment
  each changed draft's version so stale clients are fenced after deployment.
  A clean local reset replayed migrations 001–134 and the Blueprint identity
  database contract passed.
- Updated the browser matrix to select the visible responsive attendance status
  and assert the current post-check-in copy. The full matrix passes (40 passed,
  14 intentionally skipped), as do the full Vitest suite (5,114/5,114), focused
  identity tests, lint, TypeScript, the Pika audit, and the production build.

## 2026-08-26 — Close PR 1066 active-generation and ledger replay blockers

**Risk profile:** runtime-platform — migration function selection, operation
idempotency/recovery, and rollback-only database contracts; no database was
reset or migrated and no hosted state was changed.

- Rebased the dedicated PR worktree onto current `origin/main`; migration 134
  remains sequential after main's 133 with no duplicate migration prefixes.
- Restricted active Blueprint capture to non-archived assignment, Test, lesson,
  material, and survey generations. Added a real database fixture with an
  archived Test generation and active replacement sharing portable identity and
  position, including a colliding archived question identity.
- Moved archived Classroom operation identity validation ahead of the winner
  shortcut. A same-key/different-hash replay now returns
  `idempotency_conflict`, while a compatible retained failed operation is
  reconciled to the winner Blueprint and completed ledger evidence.
- Independent SQL review found two structural gaps in the same lifecycle. The
  migration backfill now fences `test_questions` before `assessment_drafts`,
  matching question-before-Draft synchronization order, and its database
  contract rehearses that a concurrent question writer blocks.
- Instantiation now seeds and validates its operation ledger outside the
  question-rematerialization savepoint. A forced post-base failure proves the
  Classroom graph rolls back while the failed ledger survives, then the same
  operation key retries successfully and replays the completed result.
- Full Vitest passes 5,114 tests across 586 files. Focused migration guards,
  lint, TypeScript, architecture boundaries, generated database type parity,
  shell syntax, diff checks, and the production build pass. The revised SQL
  fixture remains for fresh-database CI because migration application/reset was
  explicitly prohibited for this task.

## 2026-08-26 — Serialize Test draft saves with activation

**Risk profile:** runtime-platform — Test authoring/activation transactions,
question immutability after student work, and teacher editor close behavior; no
database was reset or migrated and no hosted state was changed.

- Added version-fenced, service-role-only migration-134 RPCs for atomic Test
  authoring saves and draft activation. Both lock Test, Classroom, draft, and
  questions in the same order, so activation either consumes the completed save
  or rejects a stale version, and archive cannot cross an authorized write.
- Activation materializes questions only through explicit portable identity.
  Draft-created UUIDs become `artifact_id`, persisted row IDs remain internal,
  and active/closed authoring rebuilds from and atomically synchronizes the
  materialized question rows instead of trusting stale draft JSON.
- Preserved the supported active/closed editor lifecycle while freezing question
  mutations once student work exists. Metadata/document-only saves remain
  possible because unchanged question rows are not rewritten.
- The teacher authoring dialog now flushes queued/debounced saves before close,
  remains open with a disabled `Saving...` action during the flush, and
  activation sends the exact saved draft version obtained during preflight.
- Blueprint capture is read-only for Test/question identity and uses draft JSON
  only for draft Tests; active/closed Tests are captured from materialized rows.
- Added real two-session save/activation and archive ordering, active-authoring,
  student-work lock, and rollback regressions for fresh CI replay. Full Vitest
  passes 5,123 tests across 586 files; the final focused surface passes 169
  tests. Lint, TypeScript, production build, shell syntax, diff checks, Pika
  audit, accessibility review, desktop/mobile light/dark Playwright verification,
  and two bounded independent re-reviews pass. Local generated-type parity is
  intentionally deferred to fresh CI because the installed local database has
  the earlier migration-134 definition and applying/resetting it was prohibited.

## 2026-08-27 — Replace archived Classroom action labels with icons

**Risk profile:** none — teacher archived-Classroom action presentation only;
no workflow, API, schema, persistence, dependency, or hosted state changed.

- Replaced the visible `Reuse` label with the Lucide copy-plus icon and the
  visible `Unarchive` label with the archive-restore icon. Both actions retain
  their accessible names and expose the original labels through shared
  hover/focus tooltips.
- Preserved primary/surface action hierarchy, loading feedback, disabled state,
  focus treatment, and the shared 44px minimum target.
- Focused component coverage passes (31/31), including icon identity, absence
  of visible label text, and tooltip behavior. Lint and design policy pass.
- Playwright visual verification passed for teacher desktop/mobile in
  light/dark, including hover and keyboard-focus tooltips, with no horizontal
  overflow. Student desktop/mobile light/dark captures confirm the actions
  remain absent. A temporary visual route was removed after capture because the
  shared local environment has no Supabase URL or keys.

**Model recommendation:** current model for a narrow, accessible UI refinement.

## 2026-08-27 — Return Pika logo navigation to active classrooms

**Risk profile:** none — localized teacher classroom-list state transition; no
layout, API, schema, persistence, authentication, or hosted state changed.

- Added a shared app-home selection event to the existing Pika logo navigation
  without changing its route, guarded-navigation behavior, or modifier clicks.
- Made the teacher classrooms index switch from Archived to Active when the logo
  selects Home while preserving Organize mode.
- Added semantic component coverage for the header signal, blocked navigation,
  and `aria-pressed` Active state, plus the exact interaction in the archived
  classroom Playwright matrix.
- Focused Vitest passes (42/42); lint, architecture, UI policy, Pika audit, and
  diff checks pass. Playwright passed for teacher/student boundaries and the
  teacher Archived-to-Active interaction at desktop/mobile in light/dark, with
  no overflow or visual regression.
- Composite-widget checklist reviewed: keyboard behavior unchanged and covered
  by the shared control; semantic state covered by tests; remaining manual
  follow-up none.
- CI twice exposed the unrelated in-app test-preview callback regression racing
  its own five-second `waitFor` under full-suite coverage load. The test keeps
  its five-second assertion deadline but now has a ten-second outer deadline.

**Model recommendation:** GPT-5.6 Terra at high reasoning for a standard-risk
application state-transition review.

## 2026-08-27 — Keep Daily class-log summaries minimal

**Risk profile:** runtime-platform — AI summary policy, untrusted-output boundary,
cached-summary compatibility, and a teacher unavailable state; no schema,
dependency, migration, deployment, or hosted state changed.

- Reframed the Daily class-log summary prompt as minimal triage instead of a
  general sentiment-and-themes summary.
- Required explicit facts only and prohibited inferred emotion, motivation,
  intent, diagnoses, causes, tone interpretation, embellishment, or constructed
  patterns.
- Restricted action items to explicit high-priority safety, wellbeing, serious
  incident, or participation-blocking concerns needing prompt teacher action.
  Routine difficulty, mild frustration, ordinary questions, incomplete work,
  neutral updates, achievements, and vague wording are excluded.
- PR review hardened the boundary: logs are JSON-serialized behind server-issued
  source references, the Responses API enforces a strict category-only schema,
  runtime validation rejects unknown/duplicate references and extra fields, and
  all visible wording is derived server-side.
- Versioned cached summaries retire legacy broad summaries instead of serving
  them as current, including stale and malformed historical shapes. The teacher
  sees concise unavailable copy for those dates.
- Successful model responses must now be complete and non-refusal before their
  schema-valid output can be accepted; incomplete and mixed refusal/output
  payloads fail closed.
- A committed, reproducible synthetic live-model matrix passed 5/5 explicit
  high-priority cases and 7/7 routine/vague exclusions with zero category or
  attribution mismatches. The evaluation pins the documented
  `gpt-5-nano-2025-08-07` snapshot and verifies the provider-returned model.
  The package evaluation command loads the shared `.env.local` directly and
  passes with no API key pre-exported in the shell.
  A forged log boundary stayed attributed to its submitting log and never to
  the targeted student.
- Focused unit, cron, teacher API, and component suites pass (65/65). Visual
  verification of the teacher unavailable state passed on desktop/mobile in
  light/dark with no overflow; student is n/a because the panel is teacher-only.
- Pika audit, lint, architecture, TypeScript, session-log, and diff checks pass.
  The remediated full suite passed 5,104/5,105 and hit one unrelated
  `TestDetailPanel` timing failure; that complete 43-test file passed immediately
  in isolation.

**Model recommendation:** GPT-5.6 Sol for the untrusted AI-output, attribution,
safety-threshold, cache-compatibility, and review remediation boundary.

## 2026-08-27 — Make the titlebar Classroom title static

**Risk profile:** none — shared titlebar interaction removal only; no API,
schema, persistence, authentication, dependency, or hosted state changed.

- Replaced the multi-Classroom selector in `AppHeader` with the same static,
  truncated Classroom title treatment used for a single Classroom. Clicking the
  title now has no behavior; the Pika logo remains the Home link to
  `/classrooms`.
- Removed the unused selector component, its switching/navigation guard
  plumbing, its focused test suite, and the now-stale UI/design exception
  registry entries. Added AppHeader coverage proving multiple Classrooms still
  render the current title without a selector or listbox and remain inert when
  clicked, plus shell/exam-source wiring contracts that prevent the removed
  callback from returning.
- Focused Vitest passes (54/54); lint, TypeScript, architecture, UI policy,
  design policy, Pika audit, and diff checks pass.
- Playwright rendered the real AppHeader for teacher and student at
  desktop/mobile in light/dark. All eight captures passed visual review with no
  overflow, truncation, alignment, or contrast regressions; direct browser
  clicks left the titlebar unchanged and desktop snapshots retained the linked
  Pika logo. The temporary visual harness was removed after capture because the
  shared local environment has no Supabase URL or keys.
- Composite-widget review: the Classroom dropdown was removed completely, so
  its menu keyboard/focus contract and exception entries are no longer
  applicable. Existing UserMenu and mobile navigation controls are unchanged.
- Independent PR review found no merge blockers. Its one P3 documentation
  finding was fixed by updating the shared-header comment from Classroom
  selector to Classroom title.

**Model recommendation:** GPT-5.6 Sol for a shared-shell behavior removal with
cross-role visual verification.

## 2026-08-27 — Complete the canonical Test-question identity path

**Risk profile:** runtime-platform — Test authoring API retirement, portable
identity enforcement, Version instantiation, migration backfill, and archived
operation recovery; no database was reset or migrated and no hosted state was
changed.

- Retired direct question-row create/edit/delete/reorder writes. Those endpoints
  now preserve authentication and ownership checks but direct teachers to the
  version-fenced Test draft contract, keeping the saved document as the single
  authoring source activation consumes.
- Enforced UUIDv4 portable identity at draft validation, save, activation, and
  migration backfill. Legacy input is resolved only through exact row/artifact/
  source identity; collisions and non-v4 identities fail the migration atomically
  rather than receiving inferred or newly generated lineage.
- Prevented the compatibility instantiator from creating Test-question rows by
  position. Migration 134 now passes Tests without questions through that layer
  and materializes Version questions exactly once with explicit artifact identity.
- Made archived-Classroom winner replay reserve and validate every operation key,
  retain stale-revision failures durably, reject same-key/different-hash reuse,
  and reconcile compatible failed or fresh operations to the established winner.
- Added static/API/unit and fresh-database regressions for direct-write retirement,
  identity collisions, non-v4 rejection without partial writes, positional-path
  bypass, post-winner replay, stale failure recovery, and result-count parity.
  The full Vitest suite passes 5,120 tests across 586 files; the focused surface,
  TypeScript, architecture/design/UI policies, shell syntax, diff checks, and the
  production build pass. Fresh-database CI remains authoritative for the SQL
  harness because applying or resetting migration 134 was explicitly prohibited.

## 2026-08-27 — Preserve operational AI reference caches after Test freeze

**Risk profile:** runtime-platform — post-attempt Test-question mutation policy
and reusable AI grading cache behavior; no database was reset or migrated and
no hosted state was changed.

- Narrowed migration 134's student-work freeze from every question UPDATE to
  authored and identity changes. Updates that alter only the four
  `ai_reference_cache_*` fields (plus the automatic `updated_at` timestamp) are
  permitted, while INSERT, DELETE, and all other present or future columns stay
  frozen by default.
- Added static and fresh-database contract coverage proving an AI reference
  cache persists after an attempt exists, the cache write does not advance the
  Classroom structural revision, and the existing authored-question mutation
  still fails atomically with `test_questions_locked`.
- Rebased the dedicated branch onto current `origin/main` and ran the canonical
  session-log trimmer, restoring chronological order and the rolling-entry cap.
  Migration 134 remains the sole branch-added migration after main's 133.

## 2026-08-27 — Simplify Classwork inspector summaries

**Risk profile:** UI-only — teacher Classwork inspector presentation and keyboard
regression coverage; no data, API, or student-facing behavior changes.

- Replaced the History authenticity meter and Grade color badge with compact,
  right-aligned text summaries beside their section labels.
- Preserved authenticity flag details in the existing tooltip and kept the
  section headers keyboard-accessible.
- Added focused assertions for typography, alignment, and Enter-key toggling.
