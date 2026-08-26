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

## 2026-08-21 — Center the first-login Pal reward

**Risk profile:** none — student-only reward-modal layout and regression coverage;
no reward timing, acknowledgement behavior, schema, hosted state, or auth changed.

**Completed:**
- Centered Pal's narrower celebration card inside Pika's wider modal panel while
  preserving the shared modal root, backdrop, focus, and dismissal behavior.
- Added a component regression assertion for the centering layout contract.

**Verification:**
- Full suite passes 4,911 tests across 562 files; TypeScript, lint, production
  build, design policy, and UI policy pass.
- Matched Playwright evidence passes on desktop/mobile in light/dark themes:
  the card moved from 112 px left of center on desktop and 35 px left on mobile
  to exactly centered in all four variants.

## 2026-08-21 — Enforce the native attendance production canary

**Risk profile:** runtime-platform — teacher/student authorization, signed event
ingress, unattended delivery/reconciliation workers, opaque QR entry tokens,
and one additive Supabase migration. No hosted configuration, deployment, or
database was changed.

**Implemented:**
- Added a fail-closed exact Pika teacher/classroom scope on top of the global
  attendance flag. Non-canary reads retain the disabled UI, and mutations stop
  before WorkOS identity resolution or attendance side effects.
- Bound the Pika classroom UUID into version-2 encrypted entry tokens and
  required canonical Base64URL encoding before student identity resolution.
- Added migration 129 with teacher/classroom-scoped schedule, reconciliation,
  outbox claim/health, and atomic event-ingress RPCs. Workers cannot lease
  non-canary work and Bara still receives only opaque contract references.
- Added the two required rollout variables, preflight validation, generated
  database types, operator documentation, and production sequence updates.
- Review remediation split preflight into explicit disabled `pre-enable` and
  enabled modes, verifies the configured classroom is active and still owned by
  the configured teacher, and repeats that ownership check before ingress or
  unattended worker activity.
- Database claims and event application hold an active-classroom row lock so a
  concurrent archive cannot race the runtime check; archived QR issuance and
  archived event application fail before Bara access or projection writes.
- Archived teacher session reads now return the disabled attendance view and
  policy reads stop before attendance storage. The rollout contract defines
  authorization at operation start: already-started work may settle after soft
  archive, while every new operation is rejected.

**Verification:**
- Focused canary/API/worker/token coverage passes; the clean local
  Supabase reset replayed migrations 001–129, generated types match, and the
  attendance SQL contract passes exact-pair, wrong-teacher, privilege, and
  cross-classroom checks. The contract behaviorally exercises scoped claims,
  reconciliation, rejected event atomicity, and a valid atomic event apply.
- The full repository suite passes all 4,932 tests across 564 files. TypeScript,
  lint, architecture, design policy, UI policy, and production build pass. The
  shared environment's non-loopback Bara URL correctly prevents the local-only
  cross-service rehearsal from running without explicit reconfiguration.

## 2026-08-21 — Retire unscoped attendance service capabilities

**Risk profile:** runtime-platform — production release review, Supabase RPC
capabilities, and rollout sequencing; attendance remains globally disabled.

**Completed:**
- Applied reviewed migration 129 to the authorized Pika production project and
  verified remote history plus the five scoped function/grant definitions.
- Opened the `main` to `production` release PR with attendance disabled.
- Added migration 130 to revoke service-role execution of the five superseded
  unscoped worker/event RPCs while retaining them for scoped security-definer
  wrappers and migration compatibility. Migration 130 remains unapplied and
  requires separate exact production authorization.
- Updated active rollout guidance to record migration 129 as applied, migration
  130 as the remaining database gate, and the lack of an isolated preview
  database for hosted load testing.
- Removed a duplicate production-only timezone mock so the release result
  matches `main` outside the intentional remediation.

**Verification:**
- Full Vitest passes 4,939 tests across 565 files, including the UI test that
  timed out once in the initial release CI run.
- TypeScript, lint, architecture, production build, focused privilege/docs
  contracts, and diff checks pass.
- The database-writing local contract was not run because applying migration
  130 locally requires separate exact authorization; the release PR's clean
  ephemeral database job is the required migration replay and privilege proof.

## 2026-08-21 — Route attendance RPC retirement through main

**Risk profile:** runtime-platform — linearizes the reviewed attendance
privilege migration and rollout guidance onto `main`; no hosted database,
deployment, environment variable, or attendance flag was changed.

**Completed:**
- Replayed the two reviewed release-remediation commits onto a dedicated branch
  from current `origin/main`, excluding the production-only calendar-test
  parity correction that was already absent from `main`.
- Preserved migration 130 as an unapplied, separately authorized rollout step
  and kept attendance globally disabled pending the exact-pair canary audit.

**Verification:**
- Focused migration and documentation coverage passes 3 tests.
- Full Vitest passes 4,939 tests across 565 files; TypeScript, lint,
  architecture boundaries, and the production build pass.
- The clean release CI already replayed migrations through 130 in an ephemeral
  Supabase database; no local or production migration application was run.

## 2026-08-21 — Restore the remembered-login contract

**Risk profile:** runtime-platform — Pika and WorkOS session lifetime,
cross-cookie identity binding, protected-route recovery, middleware headers,
and browser logout. No hosted configuration or deployment was changed.

**Implemented:**
- Replaced the WorkOS pilot's 12-hour compatibility cookie with one shared
  180-day Pika policy and set both the browser `Max-Age` and encrypted
  `iron-session` seal TTL, avoiding the library's otherwise hidden 14-day TTL.
- Versioned Pika sessions and bound WorkOS-authenticated sessions to the exact
  verified WorkOS user ID plus normalized email. Legacy, unbound, mismatched,
  or Pika-only sessions fail closed while the pilot is enabled.
- Added read-only silent restoration for an active WorkOS session. It recreates
  the Pika UUID/role mapping only from the existing exact
  `public.users.workos_user_id` link and never creates or relinks by email.
  Restoration explicitly suppresses student login telemetry so it performs no
  Pal outbox write or delivery attempt.
- Preserved protected deep links and query strings through reauthentication by
  injecting a middleware-owned request-path header, stripping inbound spoofed
  values, and validating every returned internal path.
- Routed browser logout through a CSRF-protected same-origin POST, Pika cookie
  destruction, and the WorkOS logout URL so the server-side WorkOS session is
  invalidated. The retained JSON compatibility endpoint now explicitly revokes
  the WorkOS session and clears local state even if provider revocation fails.
- Updated the WorkOS rollout gate and operator guidance for the 180-day cookie,
  an exact 180-day Dashboard absolute maximum, Preview/Production cutoff
  verification, and rollback. The local Bara configurator now consumes the
  shared duration constant instead of reintroducing the former 12-hour value.

**Verification:**
- Full Vitest passes 4,965 tests across 570 files. The full coverage run also
  passes and restores `src/lib/auth.ts` to 100% branch coverage. Lint, the clean
  production build, diff checks, and the Pika audit pass.
- Playwright verification passes for the normal login and silent-restoration
  states on desktop/mobile in light/dark themes. The pre-auth surface is shared
  by teacher and student; both required stored-role captures were run.
- The account menu now performs a user-activated POST directly, while `/logout`
  is an explicit confirmation fallback and cannot auto-submit after a
  cross-origin navigation. Its confirmation state was inspected in teacher
  desktop, student mobile, teacher mobile, and dark-theme captures with no
  overflow or readability issues.
- Live local protected requests preserve full safe paths and query strings in
  `/login?next=...`. The shared `.env.local` was not modified; the local server
  used a process-only `WORKOS_COOKIE_MAX_AGE=15552000` override.
- Composite accessibility checklist reviewed: keyboard behavior remains native
  and unchanged, the restoration status is exposed through `role=status` with
  `aria-live`, semantic state is component-tested, and no manual follow-up
  remains.

## 2026-08-22 — Harden the legacy logout endpoint

**Risk profile:** runtime-platform — authentication logout CSRF protection; no
hosted configuration, deployment, database, or UI changed.

- Applied the existing exact-origin POST guard to `POST /api/auth/logout`
  before WorkOS session inspection, provider revocation, or local cookie
  destruction.
- Added regression coverage proving a cross-origin request returns 403 without
  invoking WorkOS or changing Pika and WorkOS authentication state.
- The test reproduced the prior behavior as a 200 response before the fix.
  After remediation, the focused authentication suite passes 112 tests across
  12 files; lint, Pika audit, and diff checks pass. Targeted security re-review
  reports no remaining blocker in the correction.

## 2026-08-22 — Preserve auth authority during rollback and Preview logout

**Risk profile:** runtime-platform — authentication rollback provenance and
logout CSRF origin validation; no hosted configuration, deployment, database,
or UI changed.

- Every new Pika session now records explicit password or WorkOS provenance.
  When the pilot is disabled, only current password-origin sessions remain
  valid; WorkOS mappings and ambiguous legacy seals fail closed instead of
  becoming independent credentials.
- Same-origin logout validation now trusts the origin serving the request,
  allowing Preview and custom aliases while retaining the canonical public URL
  solely for the WorkOS provider return destination.
- Regression tests reproduced all three prior failures before the fixes and
  cover password-session preservation, WorkOS-mapping rejection, and both
  logout endpoints on a non-canonical Preview origin.
- The focused auth surface passes 154 tests across 16 files. Full Vitest passes
  4,970 tests across 570 files; lint, architecture boundaries, Pika audit,
  diff checks, and the production build pass.

## 2026-08-22 — Make attendance recovery and credential smoke fail closed

**Risk profile:** runtime-platform — cross-service authentication, private
database state, and operator recovery; no hosted data, flags, configuration,
deployment, or production state changed.

- Normalized literal-null and all-null attendance outbox claim responses to a
  durable pending result, while sanitizing malformed composite diagnostics.
- Added migration 131 for private, service-role-only, canary-scoped smoke audit
  runs and replay nonces with rate limits and bounded nonce cleanup.
- Added production-only deployed Pika-to-Bara and Bara-to-Pika credential proof
  routes. The signed exchange is tenant, installation, teacher, classroom, and
  canary bound; it stores aggregate booleans and never mutates attendance data.
- Documented recovery invariants, production-only Preview skip rules, rollout
  ordering, and the explicit authorization boundary for migration/deployment.
- Local migration reset, generated-type parity, database privilege guard, full
  4,980-test suite, lint, and production build pass.
- Independent review corrections classify smoke audit ownership edges, bind
  callbacks to an active five-minute challenge, reject recovery idempotency
  drift, derive recovery time server-side, and repair the pre-enable rollout
  order. The same full verification passed after remediation.
- A subsequent independent PR review added audited recovery-page continuation
  so unchanged failures cannot starve later eligible events, and replaced the
  shared cron bearer with a dedicated smoke credential that is read only after
  the destination matches the configured canonical Pika production origin.

## 2026-08-22 — Close attendance recovery review-loop gaps

**Risk profile:** runtime-platform — deployed authentication smoke, bounded
operational state, and tenant deletion behavior; no hosted data, migration,
deployment, flag, credential, or production state changed.

- Made the deployed operator gate require HTTP 200 as well as a strict passing
  aggregate body, so pass-shaped 401/409/429/5xx responses cannot authorize
  rollout expansion.
- Made Preview reverse callbacks reject before configuration or database access
  and made the operator route fail closed when its dedicated credential is
  missing, short, or overlaps cron or either attendance HMAC secret.
- Bounded smoke-run and nonce retention to 100 expired rows of each kind per
  new challenge after 24 hours. Smoke-only evidence now cascades with an
  otherwise-authorized tenant deletion while active five-minute challenges
  remain protected.
- Added runtime database-guard coverage for retention cleanup and classroom
  deletion, plus focused route, runner, migration, and callback regressions.

## 2026-08-22 — Move attendance rollout preflight into deployed runtimes

**Risk profile:** runtime-platform — production cross-service authentication
and rollout gating; no hosted configuration, flags, deployment, or data changed.

- Made the Pika operator smoke run the complete pinned production environment
  audit inside Vercel before creating any smoke state, avoiding false evidence
  from locally downloaded Sensitive values that Vercel intentionally redacts.
- Bound each operator invocation to an explicit pre-enable or enabled mode and
  made Bara verify that mode against its deployed Convex integration flag before
  consuming nonce or callback state.
- Kept the proof aggregate-only, exact-canary scoped, authenticated, replay
  resistant, and non-mutating; updated rollout documentation and regression
  coverage for target drift, mode mismatch, and fail-before-smoke behavior.

## 2026-08-22 — Expose authenticated aggregate preflight diagnostics

**Risk profile:** runtime-platform — operator-only production rollout
diagnostics; no hosted configuration, flags, deployment, credential, attendance
event, or production data changed.

- Returned only fixed failed-check identifiers and aggregate pass/total counts
  after successful dedicated operator authentication when the deployed
  attendance environment preflight fails.
- Kept unauthorized responses diagnostic-free and preserved fail-before-state
  behavior, `no-store`, and `no-referrer` response controls.
- Normalized missing, short, overlapping, and incorrect operator credentials to
  the same private unauthorized response, preventing authentication-configuration
  disclosure before the deployed audit.
- Aligned the migration gate with hosted evidence that migration 131 is already
  recorded as applied: operators verify it and stop for fresh authorization if
  it is absent, but never dry-run or reapply it from this rollout flow.
- Swept every sibling attendance status, canary, roadmap, completion-audit, and
  recovery runbook so none still instructs operators to authorize or apply the
  already-recorded production migration 131; 42 focused documentation and
  startup guard tests pass.
- Added route and deployed-runtime regression coverage. The focused 24-test
  surface and the full 5,008-test suite, typecheck, production build, lint,
  architecture guard, and diff check pass.

## 2026-08-23 — Add teacher-scoped attendance entitlements

**Risk profile:** runtime-platform — service-only authorization, schedule
deactivation, cross-service rollout gating, and additive database schema; no
hosted migration, deployment, flag, entitlement, requeue, or production state
changed.

- Added an audited, idempotent teacher entitlement boundary keyed by stable
  Pika user ID. The global attendance flags remain kill switches, while the UI,
  teacher APIs, workers, outbox, reconciliation, and event ingress share the
  same fail-closed authorization predicate.
- Added stateful classroom deactivation: a higher-revision empty schedule
  cancels future intent, preserves open and historical sessions, and remains
  resumable until Bara acknowledges it. Expiry clamps future schedule delivery.
- Kept the existing exact Codepet Labs canary as the non-mutating deployed
  credential smoke and made the requested rollout scope an authenticated,
  audited preflight expectation instead of broadening the smoke payload.
- Added a dry-run-first, operation-id-bound service operator command and rollout
  documentation for enablement, revocation, rollback, Preview skip behavior,
  release order, and the production authorization boundary.
- Bara's 166-test suite, typecheck, and production build pass. Pika's full
  5,029-test suite, TypeScript check, production build, architecture guard,
  design guard, UI guard, and diff check pass. Local execution of migration 132
  and generated-type parity remain intentionally pending exact local-only
  authorization.

## 2026-08-23 — Repair attendance entitlement operator launch

**Risk profile:** runtime-platform — service-only entitlement operator
availability; no authorization binding, RPC payload, hosted entitlement, flag,
credential, or attendance state changed.

- Wrapped the existing operator body in an async entrypoint so the documented
  CommonJS `tsx` package command no longer fails compilation on top-level await.
- Added a subprocess regression that invokes the exact package script and proves
  it reaches argument validation instead of the transform failure.
- Verified the documented command against production in dry-run mode only; it
  read the current active revision 1 entitlement and emitted a disposable exact
  binding without executing an RPC.
- Focused tests, the full Vitest suite, lint, architecture guard, production
  build, and diff check pass.

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
