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

## 2026-08-19 — Verify native attendance against disposable local databases

**Risk profile:** runtime-platform and disposable local data. The user
explicitly authorized resetting and discarding the shared local Pika database.
No hosted database, WorkOS dashboard, deployment, rollout flag, production
write, commit, merge, or promotion changed.

**Model recommendation:** frontier reasoning model — this verification spans
real WorkOS sessions, Pika/Supabase, Bara/Convex, signed adapters, two browser
roles, standalone regression, and concurrent authoritative writes.

**Completed:**
- Replayed Pika migrations 001–127 on shared local Supabase, ran local Convex,
  and used distinct staging WorkOS Applications with localhost callbacks.
- Signed in a real teacher and student through Pika, created and joined a
  rostered classroom, configured attendance hours, opened automatically,
  checked in through the native Pika QR path, reconciled the projection,
  corrected the student to Late, and closed the session without leaving Pika.
- Signed into standalone Bara through its own WorkOS Application, opened an
  independent ad-hoc session on the mapped roster, marked the student through
  Bara's tap UI, and closed it.
- Added a guarded loopback-only signed-adapter/engine load runner and recorded
  aggregate local evidence in the scan runbook. Thirty concurrent scans passed
  30/30 at p50 120.4 ms, p95 223.0 ms, p99 226.6 ms; 100 concurrent scans
  passed 100/100 at p50 339.7 ms, p95 589.0 ms, p99 606.3 ms.

**Verification:**
- Pika passes 542 files and 4,567 tests, TypeScript, production build,
  architecture, design-policy, UI-policy, and diff checks.
- Bara passes 32 files and 148 tests, TypeScript, production build, brand, and
  diff checks. The hosted rollout command correctly refuses to run without a
  named Preview/Production stage and exact HTTPS origins; no staging target
  exists to satisfy that gate.
- Browser screenshots were visually checked for native student success,
  teacher correction and closed state, and standalone Bara attendance.

**Remaining gates:**
- Local latency is not hosted latency. Hosted p50/p95/p99, hosted migration and
  backfill, tenant-isolation/canary proof, and real teacher/student approval
  remain blocked on provisioning an isolated Preview or explicitly approving a
  different non-production target. Production remains disabled.

## 2026-08-19 — Verify native attendance against disposable local databases

**Risk profile:** runtime-platform and disposable local data. The user
explicitly authorized resetting and discarding the shared local Pika database.
No hosted database, WorkOS dashboard, deployment, rollout flag, production
write, commit, merge, or promotion changed.

**Model recommendation:** frontier reasoning model — this verification spans
real WorkOS sessions, Pika/Supabase, Bara/Convex, signed adapters, two browser
roles, standalone regression, and concurrent authoritative writes.

**Completed:**
- Replayed Pika migrations 001–127 on shared local Supabase, ran local Convex,
  and used distinct staging WorkOS Applications with localhost callbacks.
- Signed in a real teacher and student through Pika, created and joined a
  rostered classroom, configured attendance hours, opened automatically,
  checked in through the native Pika QR path, reconciled the projection,
  corrected the student to Late, and closed the session without leaving Pika.
- Signed into standalone Bara through its own WorkOS Application, opened an
  independent ad-hoc session on the mapped roster, marked the student through
  Bara's tap UI, and closed it.
- Added a guarded loopback-only signed-adapter/engine load runner and recorded
  aggregate local evidence in the scan runbook. Thirty concurrent scans passed
  30/30 at p50 120.4 ms, p95 223.0 ms, p99 226.6 ms; 100 concurrent scans
  passed 100/100 at p50 339.7 ms, p95 589.0 ms, p99 606.3 ms.

**Verification:**
- Pika passes 542 files and 4,567 tests, TypeScript, production build,
  architecture, design-policy, UI-policy, and diff checks.
- Bara passes 32 files and 148 tests, TypeScript, production build, brand, and
  diff checks. The hosted rollout command correctly refuses to run without a
  named Preview/Production stage and exact HTTPS origins; no staging target
  exists to satisfy that gate.
- Browser screenshots were visually checked for native student success,
  teacher correction and closed state, and standalone Bara attendance.

**Remaining gates:**
- Local latency is not hosted latency. Hosted p50/p95/p99, hosted migration and
  backfill, tenant-isolation/canary proof, and real teacher/student approval
  remain blocked on provisioning an isolated Preview or explicitly approving a
  different non-production target. Production remains disabled.

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
- Full verification passes 4,616 tests across 507 files, lint, type checking,
  and the production build. Architecture, UI policy, design policy, Pika audit,
  and diff checks pass.
- The final Playwright experience matrix passes 36 tests with 14 intentional
  project skips. All eight published/not-found desktop/mobile light/dark
  screenshots were visually reviewed with no overflow or overlap findings.
- Composite-widget checklist reviewed: keyboard behavior and semantic section
  navigation are covered; no manual follow-up remains.

**Model recommendation:** Sol with high reasoning for the public content-
exposure boundary and cross-route publication lifecycle.

**Independent review remediation:**
- Replaced private database-row React keys with server-only positional keys and
  expanded the raw-response denylist to every fixture Blueprint, child,
  embedded-content, and artifact UUID. Direct response inspection confirms all
  nine identifiers are absent.
- Added fixed assignment, Test, and lesson artifact identities. Both reserved
  Blueprints now reconcile all five child tables before inserting the exact
  fixture set, so stale local fixture content cannot survive a reseed.
- Added drift-injection idempotency coverage, verified two consecutive real
  local seeds, and brought `seed:fresh` onto the same planned-course fixture
  path as `seed`.
- Changed fixture reconciliation to read the complete canonical state first and
  perform no writes when it is already exact, preventing unchanged seeds from
  incrementing Blueprint content revisions. A real-database replay preserved
  the complete fixture fingerprint and content revision 30.
- Made drift repair fail closed: the public Blueprint is unpublished before
  child reconciliation and published only after every canonical write succeeds.
  An injected child-write failure verifies that the public site remains private.
- The final targeted review found that subset comparison could miss same-ID
  drift in grading, submission, authenticity, or nested JSON fields. Fixture
  rows now project every teacher-editable canonical field and require exact
  nested JSON equality; same-ID drift correction and fail-closed failure paths
  are covered directly.
- Remediated full verification passes 4,616 tests across 507 files, lint, type
  checking, and the production build. The final browser matrix remains 36
  passing with 14 intentional skips.

## 2026-08-20 — Streamline Blueprint-to-Classroom creation

**Risk profile:** runtime-platform — Blueprint materialization, immutable
lineage, and student-visibility defaults; no migration, production operation,
dependency, deletion endpoint, or archive-lifecycle change.

**Completed:**
- A Blueprint preselected from `/teacher/blueprints` now moves directly from
  classroom name to calendar. Dashboard/classroom entry paths without a
  preselection still require choosing a Blueprint. Back navigation, unsaved
  editor confirmation, retry idempotency, the post-create handoff, overflow
  reporting, and assignments-tab navigation remain covered.
- The real rollover drill now verifies draft/unreleased assignments, Tests,
  materials, and surveys; an unpublished actual classroom site; authenticated
  student API denial; immutable Version lineage; complete reusable content;
  live-data exclusion; and cleanup.
- The drill exposed a pre-existing nested Test-question lineage defect when a
  source had no assessment-draft row. Blueprint source loading now normalizes
  saved-draft and fallback question IDs to portable artifact identities.
- Current/audit/evidence docs record the reviewed decision: no pre-create
  preview or teacher-facing Version picker, and no immediate active-classroom
  deletion. Remaining Phase 5 work is the existing archive/purge lifecycle UI.

**Validation:**
- Focused component/server/verification coverage passes 64 tests; the real
  browser/API/database rollover drill passes all 54 checks with clean rollback.
- Full verification passes 4,620 tests across 507 files, lint, type checking,
  and the production build. Architecture/UI/design policy checks, Pika audit,
  and diff checks pass.
- Teacher desktop/mobile light/dark calendar-step captures were visually
  reviewed with no picker, overflow, overlap, or legibility findings. Student
  UI did not change; non-visibility is verified through browser/API/database
  coverage. Composite-widget checklist reviewed with no remaining follow-up.

**Model recommendation:** Sol with high reasoning for final atomic creation,
lineage, and student-visibility review; Terra with high reasoning for broad
compatibility, test, UX, and documentation review.

## 2026-08-20 — Productize hot archive recovery copies

**Risk profile:** data-security — authenticated archive status, revision-fenced
export, and the existing gated archive operation. Migration 126 adds the atomic
expected-source-revision fence. Its final reviewed definition is applied to
shared local only. Nothing was applied to production.

**Completed:**
- Added a strict teacher-scoped recovery summary for hot archived Classrooms.
  It exposes only export availability, latest operation state, verified date,
  compressed size, and retention policy; private paths, checksums, identities,
  and Classroom content remain server-only.
- Archived Classroom rows now distinguish database-only, rollout-unavailable,
  interrupted/retryable, failed, and verified recovery-copy states. Eligible
  teachers explicitly confirm creation, and retries preserve the durable
  operation UUID across browser failures and page reloads.
- Verified recovery copies suppress duplicate creation and show their size and
  retention policy. Export still retains every hot row and source object; this
  slice does not compact a Classroom or free database space.
- Independent review hardened the slice so verified evidence must match the
  Classroom's current source revision, resumable exports replay their original
  retention contract, same-lifecycle tabs derive one operation UUID, successful
  exports retain that UUID until status reconciliation, and a status-only outage
  cannot hide unarchive, reuse, restore, or purge actions.
- Targeted review found that an old tab could submit its prior lifecycle UUID
  after another tab rearchived the Classroom. Migration 126 now locks the
  Classroom and revision rows, rejects a mismatched expected revision before
  operation creation, and leaves the existing archive-v2 writer unchanged.
- Narrowed remaining Phase 5 archive work to hot-to-cold eligibility/progress,
  followed by cold-restore progress and quota/retention policy.

**Validation:**
- Focused client, API, component, deterministic-ID, retry, stale-revision,
  malformed-data, and missing-migration coverage passes 59 tests.
- Full verification passes 4,638 tests across 509 files, lint, type checking,
  and the production build. Architecture, design/UI policy, Pika audit, and
  diff checks pass.
- The focused CI Playwright matrix passes with teacher rollout-unavailable,
  status-outage, available, confirmation, stale, and verified states at
  desktop/mobile in light/dark, plus the student absence boundary. Screenshots
  were visually reviewed with no overflow, overlap, contrast, wrapping, or
  hierarchy findings.
- Composite-widget checklist reviewed: existing segmented-control and dialog
  keyboard/semantic contracts are unchanged and covered; recovery state is
  text-plus-icon, confirmation uses the canonical dialog, and no manual
  follow-up remains.
- Shared local Supabase was reset on this branch and replayed migrations
  001-126. Review then found and fixed prior-revision operation replay; the final
  migration replays and passes the live contract in both disposable and shared
  local 001-126 databases. The concurrent Bara migration is resequenced to 127
  on its rebased branch.
- The migration-126 assertions now run only when its RPC exists, so the legacy
  migration-108 Quiz compatibility database contract continues to pass.

**Model recommendation:** Sol with high reasoning for the final archive
authorization, idempotency, privacy, and lifecycle-state review.

## 2026-08-20 — Isolate Pika principals and harden attendance recovery

**Risk profile:** high — cross-service identity, idempotency, durable delivery,
Supabase migration, archive/purge containment, and native attendance behavior.
The user explicitly authorized discarding and resetting only Pika's local
Supabase data. No hosted database, dashboard, deployment, flag, or production
state changed.

**Completed:**
- Replaced WorkOS subjects in the v1 boundary with random Pika principal refs.
  Pika still verifies WorkOS locally; Bara namespaces each principal by signed
  installation and cannot reuse a standalone WorkOS identity or organization.
- Gave each logical student scan a fresh attempt ID while preserving one stable
  idempotency key across uncertain transport retries of that attempt.
- Made retryable teacher delivery uncertainty return durable `pending`, and
  rebuilt pending session/mark state from the private outbox after reload.
- Made outbox claims enforce roster-before-schedule and
  roster/schedule-before-command dependencies rather than creation order.
- Added classroom/student lineage to the event inbox and projections. Removed
  service-role delete authority and fail-closed archive compaction, hot purge,
  and final classroom deletion until a versioned Bara decommission/reseed
  protocol exists; ordinary soft archive/restore remains intact.
- Added a CI database regression that proves privileges, all eight delete-guard
  row families, no-state deletion, early compaction/purge rejection, and
  reversed-order delivery dependencies on local Supabase.

**Verification:**
- Local Supabase reset replayed migrations 001–127 cleanly; generated database
  types match; `pnpm run check:bara-attendance-db` passes.
- Pika passes 548 files and 4,818 tests, TypeScript, production build,
  architecture, design-policy, UI-policy, database type, shell, and diff checks.
- The four vendored Pika v1 contract files are byte-identical to Bara.

**Remaining gates:**
- No hosted staging database exists. Provisioning one, applying migration 127,
  configuring a frequent hosted recovery trigger, running cross-service
  teacher/student/tenant-isolation flows, measuring hosted p50/p95/p99, and a
  canary all remain explicit rollout work. Production stays disabled.

## 2026-08-20 — Close attendance privacy and operator-state review findings

**Risk profile:** high — student privacy deletion, archive schema inventory,
and permanent cross-service command failures. Only the disposable local Pika
Supabase database was reset; no hosted or production state changed.

**Completed:**
- Blocked individual-student purge at both begin and finalization whenever the
  target has attendance mappings or projections, and rejected new attendance
  subject state once a student purge fence exists.
- Serialized attendance writes, purge begin, and purge finalization on the same
  per-student advisory lock. A two-session database regression proves a writer
  that started first commits while both competing purge paths wait and then
  fail closed, eliminating the MVCC check-then-commit race.
- Classified every attendance FK as provider-owned blocking state so the live
  schema audit does not treat inbox/projections as portable or rebuildable.
- Mapped classroom decommission fences to stable 409/non-retryable outcomes.
- Kept the private classroom-state helper unexposed while making its two
  fully-qualified, empty-search-path trigger callers security-definer; this
  preserves the fence for restricted database roles used by existing flows.
- Split permanent session/mark delivery failures from retryable pending work;
  teachers see a sanitized previous-failure state and may issue a fresh command.
- Corrected both repositories' identity documentation to state that WorkOS is
  verified only in Pika and only an installation-scoped opaque principal ref
  crosses to Bara.

**Verification:**
- Local migrations 001–127 replayed cleanly and the database harness proved
  begin/finalize privacy fences, two-session concurrency serialization,
  in-flight write rejection, deletion guards, privileges, and dependency
  ordering.
- The existing Gradex extract/retention database contract passes with the
  classroom decommission trigger active under its restricted fixture role.
- All 4,829 tests across 552 files pass, along with TypeScript, production
  build, architecture, design-policy, UI-policy, database type parity, feature
  metadata, shell syntax, and diff checks.

## 2026-08-20 — Keep attendance rollback failures recoverable

**Risk profile:** runtime-platform — cross-service rollback and durable delivery
classification. No schema, database, environment, or deployment state changed.

**Completed:**
- Standardized disabled adapters on `503 temporarily_unavailable`, keeping
  resource-specific and contract-specific 404s as permanent failures.
- Made disabled Pika attendance event ingress return a retryable
  `503 temporarily_unavailable`, so Bara retains and replays authoritative
  events instead of poisoning its outbox during a rollback.
- Added regressions for both transport directions and proved Pika can reuse the
  same durable idempotency key after Bara becomes available again.
- Documented the asymmetric rollback response rules in the native-attendance
  roadmap.

**Verification:**
- Focused client, outbox, and event-ingress coverage passes 27 tests.
- The full test suite, TypeScript, lint, production build, architecture,
  design-policy, UI-policy, session-log validation, and diff checks pass.

## 2026-08-20 — Align attendance verifiers with migration 127

**Risk profile:** runtime-platform — migration evidence and local rollout
guarding only. No database, environment, or deployment state changed.

**Completed:**
- Updated the Bara attendance database guard to require migration 127 rather
  than the unrelated archive migration 126.
- Updated local rehearsal evidence to report the complete 001–127 migration
  range and added a regression that binds both operational verifiers to 127.

**Verification:**
- Migration filename and focused attendance-migration tests pass; local dry-run
  identifies only migration 127 as pending.

## 2026-08-20 — Close Pika attendance PR review blockers

**Risk profile:** runtime-platform — durable cross-service ordering, snapshot
idempotency, migration replay, and scan/load evidence. The user authorized
discarding Pika's local data. No hosted database, deployment, flag, or secret
changed; the shared Bara development selectors were restored after local
Convex startup.

**Completed:**
- Made roster snapshot retries byte-identical across manual and automated sync
  by using one persisted-contract display value and enforcing it in migration
  127.
- Serialized outbox enqueue commits per classroom and made both exact and batch
  claims wait for earlier snapshot revisions, session commands, or corrections
  in the same causal stream.
- Updated hosted and local load runners for current scan attempt IDs and opaque
  principal mappings, and corrected the runbook to distinguish the local
  server-helper path from the hosted HTTP endpoint.
- Replaced obsolete local load figures with current-contract measurements:
  30/30 confirmed at p50 91.8 ms, p95 161.8 ms, p99 163.9 ms; 100/100 confirmed
  at p50 276.7 ms, p95 498.8 ms, p99 513.1 ms.

**Verification:**
- Reset disposable local Supabase and replayed migrations 001–127; database
  types, migration dry-run, causal-order/idempotency contract, privacy fences,
  and two-session purge concurrency checks pass.
- Guarded loopback rehearsal passed roster/schedule sync, open, student scan and
  duplicate retry, teacher correction, close, closed scan, duplicate event, and
  stale reordered event handling.
- Independent security and architecture re-reviews found no remaining P0–P2
  issue. Full coverage passes 556 files and 4,862 tests; TypeScript, production
  build, architecture, design-policy, UI-policy, and diff checks pass.

**Remaining gates:**
- Hosted preview/database verification, real hosted teacher/student smoke,
  hosted endpoint latency, scheduler-capacity proof, and canary remain rollout
  gates. Production integration remains disabled.

## 2026-08-21 — Stop false local-edit warnings after assignment submission

**Risk profile:** workspace-state — student assignment autosave, recovery, and
submit reconciliation. No schema, hosted environment, or production state changed.

**Completed:**
- Replaced order-sensitive `JSON.stringify` equality in the student assignment
  editor with structural JSON document equality across save, recovery, conflict,
  page-hide, restore, submit, and unsubmit boundaries.
- Added a regression proving a Pal achievement delivery plus PostgreSQL JSONB
  key reordering does not produce the false “newer local edits” warning or retain
  a recovery draft, while existing real submit-race preservation remains intact.
- Confirmed through a local seeded browser submission that Postgres returned
  reordered nested Tiptap keys, the student saw `Submitted`/`Saved` with no
  warning, and the teacher summary updated to `1/2`.

**Verification:**
- Focused JSON patch and assignment-editor suites pass 57 tests; TypeScript,
  lint, architecture, design policy, and diff checks pass.
- Playwright visual verification passed for student submitted-detail and teacher
  assignment-summary states on desktop/mobile in light/dark themes.

## 2026-08-21 — Serve favicon outside AuthKit middleware

**Risk profile:** runtime-platform — production AuthKit middleware routing. No
database, identity record, environment variable, or attendance flag changed.

**Completed:**
- Kept exact `favicon.ico`, both exact theme-specific SVG icons, and real
  Next.js static/image segments outside AuthKit so passive assets cannot
  participate in WorkOS session refreshes, while malformed prefix collisions
  remain covered.
- Added self-contained, transparent light and dark SVG favicons from the
  existing `/pika.png` mark. Media-qualified metadata selects black for light
  browser chrome and white for dark chrome without relying on SVG-internal
  color-scheme queries, which Safari 26 does not honor for favicons.
- Added an unadvertised transparent ICO fallback in `public/` so conventional
  `/favicon.ico` requests remain static even though only the SVG variants are
  advertised in page metadata.
- Added regressions for all exact icon exclusions, malformed prefix collisions,
  both media-qualified metadata entries, both embedded PNGs, and the ICO
  fallback.

**Verification:**
- The boundary regression fails against the unbounded matcher and passes with
  exact/segment exclusions. The compiled Next matcher has the same behavior.
- Focused middleware/auth coverage passes 50 tests; the full suite passes 562
  files and 4,911 tests after syncing current `main`. TypeScript, lint, and the
  production build pass.
- Page metadata advertises separate light/dark SVG routes with matching media
  queries. Browser verification confirms the original mark renders black/white
  at both 64px and tab-sized 16px; Safari selects the white mark in actual dark
  tab chrome.
- A pilot-enabled production smoke returns static `200` responses for both
  icons with no session cookie; `/classrooms` still redirects to `/login`,
  collision paths return normal 404 responses, and server logs stay clean.

## 2026-08-21 — Add classroom-scoped feature visibility

**Risk profile:** workspace-state + exam-mode — per-classroom navigation,
student notifications, direct-link routing, assessment visibility, and one
additive schema migration. Migration 128 was explicitly authorized and applied
only to the local Supabase database; no hosted environment was changed.

**Implemented:**
- Added one default-on classroom feature contract for Attendance, Classwork,
  Tests, Gradebook, Calendar, Syllabus, Announcements, and Pal-gated
  Achievements; Daily/Today, Roster, and Settings remain permanent.
- Added teacher Settings switches with complete-record validation, optimistic
  persistence, rollback, archived read-only behavior, and a Gradebook dependency
  on Classwork or Tests.
- Centralized teacher/student sidebar filtering, workspace mounting, stale URL
  fallback, prefetch suppression, notification counts, and Calendar-embedded
  assignment/announcement visibility.
- Authored migration 128 with a constrained JSON default and cold-archive row
  normalization so pre-128 archives restore with all features enabled.
- Documented the teacher/student tab mapping and rollout contract in
  `docs/guidance/classroom-feature-visibility.md`.

**Verification completed:**
- All 4,901 tests across 560 files, TypeScript, lint, production build,
  architecture, design policy,
  UI policy, generated database contract, diff checks, and the Pika pre-commit
  audit pass.
- Composite-widget accessibility review passes: labeled group, semantic pressed
  and switch state, roving keyboard focus, arrow/Home/End behavior, and tests.
- Local migration history, column/default/constraint shape, existing rows, and
  cold-archive normalization were checked after applying migration 128; generated
  database types now include `feature_visibility`.
- Playwright verification passed for teacher and student desktop/mobile views in
  light/dark themes, including enabled/hidden Settings states, filtered nav,
  direct-link fallbacks, hidden notification counts, and restoration to defaults.

## 2026-08-21 — Adopt the minimal Pal level-up celebration

**Risk profile:** none — student-only presentation and reward-modal dismissal;
no schema, grading, assessment, workspace persistence, or hosted state changed.

**Implemented:**
- Pinned the reviewed public `@codepet/pal-widget@0.1.0-alpha.4` release.
- Enabled Pal's opt-in fireworks/brightness effect in Pika's existing
  host-managed reward modal and removed the normal Continue action.
- Preserved Pika ownership of dialog semantics, focus containment, Escape,
  backdrop dismissal, scroll lock, and reward acknowledgement. A failed
  acknowledgement keeps the modal visible and restores Pal's Retry action.
- Updated the Pal pilot integration contract and minimal title-presentation
  expectations.

**Verification:**
- Focused student Pal experience and widget theme-contract suites pass 17 tests;
  TypeScript, lint, architecture, design policy, UI policy, and diff checks pass.
- Playwright verification passed for the student modal on desktop/mobile in
  light/dark themes, including launch/linger visuals, Escape and backdrop
  acknowledgement, failure/retry, and reduced-motion suppression. Teacher view
  is not applicable because Pal reward layers mount only for students.
- Composite-widget accessibility checklist reviewed: keyboard behavior covered
  yes; semantic state covered by tests yes; remaining manual follow-up none.

## 2026-08-21 — Make teacher CLI hints invocation-aware

**Risk profile:** none — teacher CLI help and recovery text only; no application
runtime, schema, hosted environment, deployment, or database state changed.

**Completed:**
- Derived the copy-pasteable command prefix from the global launcher's existing
  `PIKA_ORIGIN_PWD` handoff, so global runs print `pika ...` while package-script
  runs print `pnpm pika ...`.
- Applied the detected invocation consistently to help, usage errors, login and
  expired-session recovery, Blueprint follow-up, and Classroom undo hints.
- Replaced the stale `course pull/push/instantiate` error text with the current
  Blueprint commands while retaining newer proposal, apply, and delete commands.
- Added behavior-level regression coverage through both real entry points with
  a local mock API for help/errors, recovery, Next, and Undo output.

**Verification:**
- Focused CLI suite passes 8 tests; full suite passes 4,909 tests across 561 files.
- Lint, production build, architecture boundaries, and Pika pre-commit audit pass.

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
