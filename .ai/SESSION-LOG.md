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

## 2026-08-26 — Generalize the Attendance work-surface hierarchy

**Risk profile:** none — teacher UI composition, reusable layout primitives,
and guidance only; no attendance business logic, API, schema, persistence,
authentication, dependency, or hosted state changed.

- Replaced Attendance's floating date cluster plus separate session-summary row
  with one anchored context bar: quiet session context on the left, an exactly
  centered date navigator, and compact counts/actions on the right.
- Added shared `TeacherWorkSurfaceContextBar`, `TeacherSelectionBar`, and
  `TeacherWorkSurfaceTableFrame` primitives. Attendance now uses a sticky table
  header and reserves bottom scroll clearance only while selection actions are
  visible, keeping more names on screen during normal use.
- Added the reusable change brief, expanded teacher work-surface canon, and AI
  routing so later Classwork and Tests passes can adopt the hierarchy without
  moving feature business logic into shared components.
- Full Vitest passes (5,102/5,102); lint, production build, startup-doc budget,
  and diff checks pass. The build retains existing WorkOS Edge-runtime warnings.
- Playwright verification passed for the teacher surface at desktop/mobile in
  light/dark, including default, long-scroll, and selected states; the date was
  programmatically checked for exact centering and captures had no horizontal
  overflow. At the prior 1280×659 audit size the denser layout shows roughly
  three additional compact rows. A temporary local verification route was
  removed after capture because the shared env lacks Supabase configuration.
  Student UI is n/a because these primitives and their first consumer are
  teacher-only.

**Model recommendation:** GPT-5.6 Sol for shared UI architecture plus visual
verification and reusable AI guidance.

## 2026-08-26 — Restore the Attendance center-action affordance

**Risk profile:** none — refinement of the pending teacher Attendance layout
and its reusable guidance only; no business logic, API, schema, persistence,
authentication, dependency, or hosted state changed.

- Responded to visual review by grouping the date navigator, QR action, and
  open/close command into one elevated center action cluster. Removed the outer
  card chrome so session state and counts read as quiet information rather than
  controls; hours and refresh remain subordinate utilities.
- Updated the reusable component contract, canon, change brief, and regressions
  so later Classwork/Tests adoption preserves the distinction between immediate
  centered actions and peripheral information.
- Focused component coverage and lint pass. The production build passes.
  Playwright review covers teacher desktop/mobile in light/dark plus default,
  selected, and scrolled states; the center cluster is exactly centered, all
  five immediate controls are present, and captures have no horizontal overflow.
  Student UI is n/a because the revised component and consumer are teacher-only.

**Model recommendation:** GPT-5.6 Sol for judgment-sensitive shared UI
hierarchy and responsive visual verification.

## 2026-08-26 — Tighten Attendance spacing and scroll hierarchy

**Risk profile:** none — refinement of the pending teacher Attendance layout
and shared operational-table guidance only; no business logic, API, schema,
persistence, authentication, dependency, or hosted state changed.

- Reduced the operational context-to-roster gap to 4px so the center action
  cluster and table read as one compact work surface.
- Removed the redundant `overflow-hidden` table wrapper that captured the
  sticky header. The operational context remains outside the internal roster
  scroller, the column header stays pinned, and only student rows scroll.
- Increased selected-state bottom scroll clearance on mobile, where the bulk
  action bar wraps to two rows, so the final student remains fully reachable.
- Full Vitest (5,102/5,102), lint, and the production build pass. Playwright verification covers
  teacher desktop/mobile in light/dark, default, deep-scroll, and selected
  states; it measures a 4px gap, confirms the context position is stable, the
  header is pinned, the final row clears the toolbar, and no horizontal
  overflow appears. Student UI is n/a because this surface is teacher-only.

**Model recommendation:** current GPT-5 coding model for a contained teacher
UI and scroll-behavior refinement.

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

## 2026-08-27 — Simplify Attendance status presentation

**Risk profile:** none — teacher Attendance presentation and pending guidance
only; no attendance behavior, API, schema, persistence, authentication,
dependency, or hosted state changed.

- Removed aggregate present/late/absent/unmarked counts from the operational
  context bar so the center action cluster and utilities retain the hierarchy.
- Replaced visible roster status labels and dots with accessible icon-only
  states: green check for present, yellow clock for late, red X for absent, and
  a neutral dash for unmarked. Pending and failure text remains available when
  relevant.
- Full Vitest (5,103/5,103), lint, and the production build pass. Playwright verification covers
  teacher desktop/mobile in light/dark plus default, scrolled, and selected
  states; each state has the expected accessible icon count, no visible row
  labels or aggregate context counts remain, the header stays sticky, and no
  horizontal overflow appears. Student UI is n/a because this surface is
  teacher-only.

**Model recommendation:** current GPT-5 coding model for a localized status
language and responsive-density refinement.

## 2026-08-27 — Match Attendance status dots to Daily and TeachAssist

**Risk profile:** none — teacher Attendance presentation, semantic color
tokens, regression coverage, and pending guidance only; no attendance behavior,
API, schema, persistence, authentication, dependency, or hosted state changed.

- Replaced the interim check/clock/X/dash roster icons with Daily's 12px
  accessible status-dot geometry. Visible status labels and aggregate context
  counts remain removed; tooltip and screen-reader names preserve meaning.
- Added attendance-specific semantic tokens using the exact colors inspected in
  the connected TeachAssist teacher view: present `#2DBF00`, late `#F1C700`,
  absent `#B10606`, and the shared neutral border token for unmarked. The
  source colors remain stable in dark mode without changing Pika's global
  success, warning, or danger palette.
- Full Vitest (5,103/5,103), lint, and the production build pass. Playwright
  verification covers the teacher surface at desktop/mobile in light/dark
  across default, scrolled, and selected states; it programmatically confirms
  ten dots per status, 12px geometry, and the exact TeachAssist RGB values.
  Visual review confirms the compact roster, sticky header, and mobile
  selection-bar clearance. Student UI is n/a because this surface is
  teacher-only.

**Model recommendation:** current GPT-5 coding model for a localized
cross-product visual-language match and responsive verification.

## 2026-08-27 — Align Attendance table sorting with Daily

**Risk profile:** none — teacher Attendance table presentation, sorting,
accessibility semantics, shared table tokens, regression coverage, and pending
guidance only; no attendance writes, API, schema, authentication, dependency,
or hosted state changed.

- Added three numbered Present, Late, and Absent chips to the Status header.
  They retain the exact TeachAssist colors, expose pressed state and descriptive
  names, and sort the selected status to the top. Unmarked remains a neutral row
  dot and intentionally has no fourth summary chip.
- Matched Daily's tight roster anatomy with separate sortable First and Last
  columns, a sortable Source column in Daily's metadata position, a trailing
  Status column, shared sort indicators, and resizable persisted data columns.
  The compact operational context, sticky table header, row selection, and
  bottom bulk-action clearance remain intact.
- Added semantic foreground tokens for the filled attendance chips and a
  semantic sticky-table layer. Composite-widget accessibility was reviewed:
  all chip and header controls are keyboard reachable, sorting state is
  conveyed through `aria-pressed`/`aria-sort`, and regression tests cover the
  interactions. No manual accessibility follow-up is required.
- Full Vitest (5,104/5,104), lint, design/UI policy checks, and the production
  build pass. Playwright verification covers teacher desktop/mobile in
  light/dark across default, status-sorted, column-sorted, scrolled, and
  selected states; it confirms the exact chip colors, 44px targets, sticky
  header, resize handles, correct sort ordering, and no mobile wrapping.
  Student UI is n/a because this surface is teacher-only.

**Model recommendation:** current GPT-5 coding model for this contained
teacher-table interaction and responsive visual verification.

## 2026-08-27 — Promote Attendance operational-table design to stable canon

**Risk profile:** none — design governance, AI routing, and reusable teacher
work-surface guidance only; no rendered UI, business logic, API, schema,
persistence, authentication, dependency, or hosted state changed.

- Promoted the human-approved Attendance composition from experimental guidance
  into Pika's stable design contract. Attendance is now the named reference for
  scan-heavy teacher operational tables with quiet edge information, an
  obvious centered action cluster, row-derived status sorting in the table
  header, sticky long-list behavior, and selection-triggered bottom actions.
- Added a durable operational-table guide with executable owners, composition
  example, status-chip rules, adoption checklist, must-not-add constraints, and
  explicit mappings for Attendance, Classwork, Tests summary, and selected-Test
  grading rosters. Domain statuses, colors, columns, comparisons, permissions,
  and mutations remain feature-owned.
- Updated `DESIGN.md`, stable guidance, teacher work-surface canon, audit, UI
  index, and AI routing so future agents load the pattern directly. Retired the
  superseded experimental draft after promotion.
- Focused behavior/design coverage passes (37/37), along with design policy, UI
  policy, lint, and diff checks. Visual dimensions are n/a because this was a
  documentation-only promotion; the unchanged approved Attendance captures
  remain the reference evidence.

**Model recommendation:** current GPT-5 coding model for scoped design-system
promotion and implementation routing.

## 2026-08-27 — Resolve Attendance status-dot contrast review

**Risk profile:** none — teacher Attendance status presentation, semantic token
coverage, accessibility regressions, and stable guidance only; no attendance
behavior, API, schema, persistence, authentication, dependency, or hosted state
changed.

- Accepted the independent PR review blocker that the exact TeachAssist status
  fills did not always form a 3:1 boundary against light and dark row surfaces.
  Preserved every approved fill and added a theme-adaptive semantic one-pixel
  halo, including default, hovered, selected, and selected-hover rows.
- Gave each compact status mark explicit image semantics and retained its
  accessible status name and tooltip.
- Added theme-aware non-text contrast contracts and component coverage for
  default and selected rows. Focused remediation coverage passes 24 tests,
  along with lint and design/UI policy checks.
- Playwright visual review passes for teacher desktop/mobile in light/dark over
  all four row surfaces. Student UI is n/a because Attendance is teacher-only.
  The independent reviewer reported no other actionable findings.

**Model recommendation:** current GPT-5 coding model for a localized semantic
contrast remediation with responsive visual verification.

## 2026-08-27 — Set the Attendance context bar as the migration target

**Risk profile:** none — design governance and a source-level deprecation notice
only; no rendered UI, behavior, API, schema, persistence, dependency, or hosted
state changed.

- Made `TeacherWorkSurfaceContextBar` the explicit target for teacher
  top-control rows as Classwork, Tests, and nearby pages are deliberately
  refreshed.
- Marked `TeacherWorkSurfaceActionBar` as transitional compatibility: new
  consumers are prohibited, while existing pages migrate one coherent workflow
  at a time with responsive and interaction-state visual verification.
- Kept the operational-table adoption checklist as the guard against a blind
  mechanical replacement on unrelated authoring surfaces.

**Verification:** documentation and source guidance only; lint, continuity, and
diff checks pass. Visual verification is n/a because rendered output is
unchanged.

## 2026-08-27 — Restore mobile access to Attendance utilities

**Risk profile:** low — responsive teacher Attendance controls and regression
coverage only; no attendance data behavior, API contract, schema, persistence,
authentication, dependency, or hosted state changed.

- Resolved the PR review blocker that hid Attendance hours and Refresh below
  640px. Desktop retains the two direct utility icons; mobile now uses the
  shared teacher work-surface overflow menu so the centered date/session FAB
  stays visually primary without overlapping trailing controls.
- Raised the Attendance action-bar stacking context with the existing semantic
  layer token so the mobile menu remains interactive above the sticky table
  header.
- Added a guarded Playwright-only Attendance fixture and a 390px browser
  regression that opens the real Attendance-hours dialog in light and dark.
  The same regression preserves direct desktop access in both themes and checks
  for horizontal overflow.
- Composite-widget accessibility checklist reviewed: yes; keyboard behavior is
  covered by the reused menu component tests; semantic state and dialog access
  are covered by Attendance component and browser tests; remaining manual
  follow-up: none.

**Verification:** focused Attendance component tests (14/14), full Vitest
(5,118/5,118), responsive Playwright regression (4/4), lint, design/UI policy,
Pika audit, diff checks, and production build pass. Visual review covers teacher
desktop/mobile in light/dark with both the context bar and dialog open. Student
UI is n/a because this is a teacher-only surface.

**Model recommendation:** current GPT-5 coding model for a bounded responsive
interaction remediation with browser verification.

## 2026-08-27 — Keep Attendance browser fixture reachable in local development

**Risk profile:** none — local browser-test fixture gating only; no product UI,
business behavior, API, schema, persistence, authentication, dependency, or
hosted state changed.

- Kept the Attendance fixture closed in production unless explicitly enabled,
  while allowing it automatically on development servers so Playwright can
  reuse a normal unflagged local server.
- Forced request-time rendering for the fixture route so `PIKA_E2E_FIXTURES`
  is evaluated when the production server handles each request instead of being
  frozen into the build artifact.
- Reproduced the reported reuse workflow with `PIKA_E2E_FIXTURES` absent. The
  existing Attendance-hours regression passed on desktop/mobile in light/dark
  and opened the real dialog in all four cases.
- Built one production artifact with the fixture flag present, then proved that
  same artifact returns 404 when started unflagged and 200 when started flagged.

**Model recommendation:** current GPT-5 coding model for a contained test-harness
compatibility correction and exact-workflow verification.

## 2026-08-27 — Resolve legacy Test-question backfill collisions

**Risk profile:** runtime-platform — production Test draft identity backfill;
no production data was changed by migration 134 and no migration retry occurred.

- Production already contained migration 133. The first authorized attempt to
  apply migration 134 failed atomically because 12 legacy draft questions each
  matched both their historical row ID and a question-zero row carrying that ID
  as corrupted portable lineage from migrations 112/114. Migration 134 remains
  unapplied in production.
- Changed the unapplied migration to resolve the exact historical row ID first,
  then use a unique artifact/source identity only when no row-ID match exists.
  The precedence is contractual and does not infer identity from position or
  content; genuine multiple portable matches still fail closed.
- Added static coverage and a fresh disposable-database regression that replays
  the migration's exact backfill statement against the production collision
  shape, proves both draft IDs resolve to distinct portable identities, and
  proves neither persisted question row is mutated. Extended that fixture
  through post-backfill save and activation so the installed RPCs cannot
  reintroduce row-ID ambiguity after the one-time conversion.
- Removed internal row-ID matching from migration 134's post-backfill save and
  activation functions. Materialized Blueprint capture now validates in a
  portable-only mode while the temporary dual reader remains scoped to actual
  legacy draft JSON.
- Reordered migration 134's write fence to acquire an `EXCLUSIVE` Draft-table
  lock before the question-table fence. This makes the migration wait behind an
  in-flight save before holding a lock that save must upgrade, preventing a
  Draft-row/question-table deadlock; the database harness now rehearses that
  two-session ordering.
- Scoped the legacy draft rewrite under the transaction-local identity-mapping
  guard. The identity-only update no longer advances Classroom structural
  revision or waits on a Classroom held by a save that is waiting at the Draft
  fence; the database harness now rehearses both migration/save arrival orders.
- A privacy-minimized read-only production rehearsal resolved all 351 questions
  across 28 drafts: 212 persisted questions would receive portable draft IDs,
  139 remain valid draft-only questions, and zero invalid IDs, ambiguous
  portable matches, row reuse, or duplicate portable identities remain.
- Rebased onto current `origin/main`. The focused 56-test identity/draft suite,
  full 5,142-test suite, TypeScript, lint, architecture/design/UI policies,
  shell syntax, diff validation, and production build pass. Fresh-database CI
  remains authoritative for the migration replay; migration 134 was not applied
  or reset locally and no hosted state changed.

**Model recommendation:** GPT-5.6 Sol for deterministic legacy backfill logic
that preserves student-linked row identity.

## 2026-08-27 — Version portable Test draft question identity

**Risk profile:** runtime-platform — Test draft identity compatibility and the
unapplied migration 134 backfill; no database was reset or migrated.

- Added `question_identity_version: 1` as the explicit discriminator for
  canonical Test draft question IDs. Marked drafts resolve only portable
  artifact/source identity; unmarked legacy drafts retain exact historical row
  ID precedence before portable fallback.
- Migration 134 now marks every successfully converted legacy draft, validates
  already-marked drafts strictly on replay, and makes Test draft saves preserve
  the marker. Blueprint capture, immutable Versions, and classroom
  instantiation also retain or introduce the portable marker at their format
  boundaries.
- Moved the Blueprint-capture operation-row lock outside the wrapper's failure
  savepoint so concurrent retries cannot overwrite a completed ledger result.
  Test save and activation now take the Classroom update lock up front, avoiding
  shared-lock upgrades when two Tests advance the same structural revision; the
  disposable database contract exercises concurrent saves.
- Archived-Classroom reuse normalizes pre-marker immutable Version snapshots in
  memory before semantic comparison. The persisted Version stays unchanged, and
  adding the discriminator alone cannot create a false Blueprint/Classroom
  divergence or unnecessary review flow.
- Added collision regressions across draft GET/PATCH projection, Blueprint
  detail GET overlay, Blueprint capture, migration replay, save, activation,
  and Version instantiation. The known row-ID/artifact-ID collision remains
  distinct after conversion instead of re-entering the legacy dual-identity
  reader.
- The focused identity suites, full 5,147-test suite, TypeScript, lint,
  architecture/design/UI policies, managed-storage lineage, shell syntax, diff
  validation, session-log validation, and production build pass. The disposable
  database CI job remains authoritative; migration 134 was not applied locally.

**Model recommendation:** GPT-5.6 Sol for the migration and runtime identity
boundary change, with an independent compatibility review.
