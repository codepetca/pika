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

## 2026-08-17 — Add authoritative attendance projection reconciliation

**Risk profile:** runtime-platform, privacy, and schema. Only the loopback
Supabase stack was reset; no hosted database, deployment, or external
configuration changed.

**Completed:**
- Added a separate daily reconciliation worker for up to 50 active or recently
  closed occurrences from a 48-hour window, ordered least-recently reconciled
  first and fetched with bounded concurrency.
- Applied signed Bara snapshots monotonically to Pika's private session and
  record projections, recording reconciliation progress even when revisions
  are already current so eligible sessions rotate fairly.
- Made event and snapshot ingress reject roster/occurrence and participant
  references that do not resolve to the same Pika classroom. Browser and cron
  responses remain closed and aggregate-only.
- Kept reconciliation separate from schedule/outbox automation so neither job
  consumes the other's serverless execution budget. Failed or truncated work
  returns HTTP 503 for operator visibility.

**Validation:**
- Focused event, reconciliation, cron, configuration, and migration tests pass
  22/22; TypeScript passes.
- Migration 127 replayed from zero against loopback Supabase. A rollback-only
  database smoke proved service-role-only target selection, valid event and
  snapshot application, last-reconciled rotation, and fail-closed participant
  mapping checks.
- The clean full-suite rerun passes 4,453 tests across 532 files. Production
  build, TypeScript, generated database types, design/UI policies, architecture
  boundaries across 746 modules, and diff hygiene pass. One unrelated
  asynchronous purge-dialog test failed during the first run, passed in
  isolation, and passed in the clean full rerun.

**Next gate:**
- Apply migration 127 only to an explicitly confirmed non-production hosted
  target and exercise the real no-second-login plus teacher/student attendance
  round trip.

## 2026-08-17 — Bind attendance rollout to an exact isolated environment

**Risk profile:** runtime-platform, authentication, and hosted target safety.
No Supabase project, Vercel variable, WorkOS resource, deployment, or DNS record
was changed.

**Completed:**
- Audited Vercel and Supabase target metadata without exposing values. Preview
  references Supabase `ykyikhblwvtqigwmtrkf`, whose hostname no longer
  resolves; Production uses the healthy Pika project
  `zhioqbapgfcrronyuidm`.
- Confirmed the Supabase account already has two active Free projects, so a
  third no-charge active development project is unavailable and paid preview
  branching is not an acceptable implicit fallback.
- Added an aggregate-only rollout preflight for exact Supabase refs and
  Pika/Bara origins, Staging WorkOS credentials, Brevo-only Magic Auth,
  no-prompt handoff, attendance transport/event ingress, and distinct secrets.
  Preview cannot pass while sharing the production ref.
- Exercised the preflight against the current Vercel Preview environment. It
  reports 7/20 checks passing; WorkOS and Bara configuration is absent, the
  existing Preview `SESSION_SECRET` is empty, and no value was printed.

**Validation:**
- Focused rollout, WorkOS delivery/session, Bara handoff, and signed-client
  tests pass 25/25. TypeScript, architecture boundaries across 747 modules,
  synthetic CLI success, and diff hygiene pass.

**Next gate:**
- Provision or explicitly designate an isolated non-production Supabase target
  without disrupting Pika, Codepet HQ, or production billing. Then load the
  preview WorkOS/Brevo/Bara environment, rerun the preflight, inspect remote
  migration history, and apply migration 127 only after the exact target is
  confirmed.

## 2026-08-17 — Harden the teacher attendance pilot surface

**Risk profile:** teacher UX and local test data only. No hosted database,
deployment, credential, or rollout state changed.

**Completed:**
- Audited the native Attendance tab at desktop and 390×844 mobile widths with
  an open session, projected roster, QR/manual controls, status counts, and QR
  failure recovery. Core controls retain programmatic names, the table remains
  usable at the mobile breakpoint, and the source column collapses without
  hiding attendance status.
- Replaced the internal “identity is not linked” QR response with a bounded
  teacher-facing setup/sync message while preserving the 409 recovery contract
  and provider-detail boundary.
- Removed the temporary local attendance projection fixture by explicitly
  resetting loopback Supabase and replaying migrations 001–127. Stopped the
  temporary development server and reset the browser viewport.

**Validation:**
- Focused rollout, teacher attendance component, and QR API suites pass 15/15;
  TypeScript passes. The prior clean full suite, production build, migration
  replay, generated types, and architecture evidence remain green.

**Next gate:**
- The rollout is locally ready but hosted verification remains blocked on one
  exact isolated non-production Supabase target. Do not repoint Preview at
  production or enable paid branching without an explicit environment choice.

## 2026-08-17 — Expose automatic attendance hours in the native teacher flow

**Risk profile:** teacher UX and schedule materialization. No hosted database,
deployment, credential, or external configuration changed.

**Completed:**
- Added an Attendance Hours action and accessible dialog to the native Pika
  Attendance pane so a teacher can explicitly set Toronto opening/closing
  times, same-day or overnight close, and automatic operation.
- Kept the no-guess boundary: a new policy starts with blank required times and
  same-day closing is validated before any write.
- Sent the existing optimistic policy revision on save, then requested the same
  bounded 90-day roster/schedule sync used by automation. If immediate delivery
  fails, Pika reports that the saved policy will retry rather than claiming the
  schedule is current.
- Reused Pika-owned routes and primitives; the browser receives no Bara,
  Convex, WorkOS, or integration identifiers.
- Made WorkOS the effective browser-session authority whenever the pilot flag
  is on: `pika_session` is accepted only with a verified WorkOS session whose
  normalized email matches the Pika user. Legacy, missing, unverified, and
  mismatched WorkOS pairings fail closed, while flag-off rollback is unchanged.
- Rebased the dirty feature worktree safely onto current `origin/main`
  (`d19286d9`), retained main's migration 125 and timezone-safe calendar date
  parsing, and kept attendance migration 127 as the only new schema version.
- Rechecked Supabase read-only after the sync: `Pika` and `Codepet HQ` occupy
  the two active Free slots, while an unverified `Attend` project is inactive.
  No project was resumed, paused, created, linked, reset, or otherwise changed.

**Validation:**
- The post-sync full suite passes 4,551 tests across 538 files. Production
  build, TypeScript, generated database types, architecture boundaries across
  751 modules, design/UI policies, session-log validation, and diff hygiene
  pass.
- Focused WorkOS/Pika session, handoff, QR-entry, Magic Auth verification,
  attendance UI/contract, and migration coverage passes 97/97.

**Next gate:**
- Apply migration 127 to one explicitly authorized isolated non-production
  Supabase target, then prove policy save, immediate materialization, automatic
  Bara open/close, and teacher/student attendance in the real cross-app smoke.

## 2026-08-17 — Isolate the Pika-to-Bara WorkOS handoff blocker

**Risk profile:** authentication provider diagnostic only. No hosted setting,
credential, database, redirect, or rollout flag was changed.

**Observed:**
- A fresh Chrome smoke completed Pika self-hosted Magic Auth and landed on
  `/classrooms`; WorkOS recorded `authentication.magic_auth_succeeded` and
  `session.created` for the Pika client.
- Codepet Platform Staging contains separate Bara (default) and Pika
  applications in one environment. Pika's local client ID and masked
  application-scoped staging API key matched the Pika application.
- WorkOS's successful Magic Auth response omitted the documented optional
  `authkit_authorization_code`. Pika logged
  `crossApplicationCodeReturned: false` and `status: unavailable`; Bara
  received no request. The silent redirect/callback flow therefore never ran.
- WorkOS's API reference describes that field as an authorization code that a
  different application can exchange, so the remaining issue is the provider
  response/entitlement or an undocumented issuance condition, not a Bara
  callback failure.

**Next gate:**
- Ask WorkOS to explain or enable cross-application authorization-code issuance
  for this same-environment, application-scoped Magic Auth flow. Do not weaken
  the boundary by sharing cookies, refresh tokens, Pika UUIDs, or database
  access. If WorkOS cannot support the documented exchange, explicitly design
  and approve a versioned Pika-to-Bara identity federation fallback before
  implementation.

## 2026-08-17 — Prove the approved shared Codepet Platform session

**Risk profile:** local authentication and documentation only. No hosted
WorkOS, Vercel, Convex production, or Supabase configuration changed.

**Decision and evidence:**
- Superseded the separate-application handoff blocker above after explicit
  product approval: Pika and Bara use one Codepet Platform AuthKit application
  and one environment-specific browser session, while Codepet Labs remains
  separate. Pika/Supabase and Bara/Convex still own separate internal users,
  authorization, data, and versioned integration contracts.
- Completed a Chrome smoke using Pika's six-digit passcode login and landed on
  `/classrooms`. Opening protected Bara on the same host required no second
  login; Bara resolved the WorkOS session and JWT, Convex reached authenticated
  state, and the Bara dashboard rendered.
- Repeated Bara reloads left the development deployment at three historical
  `app_users` and three linked WorkOS `auth_identities`; no duplicate bootstrap
  row was added for the current user.
- Isolated the apparent Convex failure to a local Next.js 16 origin mismatch:
  Bara was initialized as `localhost` while Chrome used `127.0.0.1`, so Next
  blocked its own development client runtime. Bara now explicitly allows the
  loopback development origin, and the normal dev command hydrates correctly.
- Kept the session cookie host-only for the local proof. No parent-domain cookie
  was enabled, and the versioned Pika/Bara API and event boundaries remain the
  production integration boundary.

**Next gate:**
- Configure and verify the same model in isolated Preview, then prove logout,
  exact QR return-path preservation, second-account tenant isolation, and the
  first native attendance contract slice before enabling pilot flags.

## 2026-08-17 — Harden Bara's eager-auth browser boundary

**Risk profile:** local Bara security headers and documentation only. No hosted
WorkOS, Vercel, Convex, or Supabase configuration changed.

**Completed:**
- Added a per-request nonce Content Security Policy around Bara's AuthKit eager
  auth path. Scripts require the nonce, inline event handlers and framing are
  blocked, and browser connections are limited to Bara plus the exact configured
  Convex cloud/site HTTP and WebSocket origins.
- Kept only the development exceptions required by React debugging and local
  HMR. The production policy contains no `unsafe-eval` and upgrades insecure
  subresource requests.
- Re-smoked the signed-in Bara dashboard, roster import, and public unavailable
  attendance state in Chrome with no CSP violations; production-mode Bara also
  retained the shared WorkOS session and authenticated Convex UI.

**Validation:**
- Bara passes 136 tests across 29 files, TypeScript, production build, brand
  guard, diff hygiene, and lint with only existing generated Convex warnings.

**Next gate:**
- Configure isolated hosted Preview, verify the emitted policy there, then run
  logout, exact QR return-path, second-account isolation, and bounded classroom
  contract smokes before enabling rollout flags.

## 2026-08-17 — Reaffirm separate WorkOS application boundaries

**Risk profile:** read-only hosted audit and documentation correction. No
WorkOS, Vercel, Convex, Supabase, DNS, or production configuration changed.

**Model recommendation:** frontier reasoning model — this phase spans WorkOS,
Vercel, Convex, Supabase, and two application security boundaries.

**Findings and decision:**
- Codepet Platform Staging and Production each contain separate Bara and Pika
  AuthKit Applications. Codepet Labs remains a separate WorkOS project.
- The boundary-preserving target is Pika authentication under its Application,
  a one-time WorkOS cross-application code, and exchange into Bara's own
  Application session before Convex resolves the subject locally.
- The same-client/shared-cookie local proof remains useful fallback evidence,
  but it is not the production architecture. Pika and Bara keep distinct client
  IDs, API keys, cookies, refresh tokens, token audiences, internal users,
  databases, and authorization.
- Bara Vercel Preview currently reuses development Convex and an obsolete
  callback. Pika Preview has no WorkOS/Bara variables and points at the only
  hosted Pika Supabase project. Deploying the attendance migration there would
  violate the isolated-preview gate.
- Pika Staging has a short-lived pilot key; Pika Production has no active key.
  No hosted settings were changed.

**Next gate:**
- Obtain WorkOS's exact issuance conditions for
  `authkit_authorization_code`, provision an explicitly isolated Pika Preview
  data target, then create Preview-only deploy credentials and run the complete
  no-prompt/auth/attendance smoke. Keep all rollout flags disabled meanwhile.

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

## 2026-08-18 — Complete local headless Bara attendance boundary

**Risk profile:** runtime-platform. No Supabase migration, Convex migration,
hosted configuration, rollout flag, production write, merge, or promotion.

**Completed:**
- Retired the cross-application Bara browser-session handoff. Pika now keeps
  student QR entry and authoritative result rendering on Pika, derives the
  actor from the verified Pika server session, and calls Bara's signed v1
  `student_check_in` command directly.
- Synchronized the closed Bara v1 contract and fixtures; added tenant/display
  identity fields, encrypted short-lived Pika entry tokens, stable command
  idempotency, one identical retry for uncertain outcomes, and no durable
  student-scan outbox.
- Kept teacher commands recoverable through the durable outbox and student
  success dependent on Bara's synchronous authoritative result. Invalid,
  closed, unmatched, duplicate, and unavailable states are explicit.
- Updated rollout guards and guidance so separate WorkOS Applications,
  databases, sessions, and internal IDs remain mandatory. The retired browser
  handoff flag must be false.
- Fixed the teacher QR validator/test to accept the encrypted entry-token shape
  and removed its fixed-date expiry flake. Consolidated duplicated startup
  guidance so the enforced 16,000-character startup budget passes.

**Verification:**
- Full Vitest run: 540 files and 4,557 tests pass after the focused startup-doc
  rerun; attendance-focused suites pass, including contract fixtures, retries,
  lost outcomes, closed/invalid QR, identity boundaries, event ordering, and
  teacher projection behavior.
- ESLint, `pnpm exec tsc --noEmit`, production build, architecture guard,
  design-policy guard, and diff hygiene pass.
- Playwright CLI verified desktop/mobile native success and mobile dark
  uncertain-outcome states with a local intercepted API. The browser remained
  on Pika and never sent a real Bara attendance command.

**Remaining gates:**
- Migration 127 is still unapplied and all attendance rollout flags remain
  disabled. An explicitly isolated hosted Preview and one-time migration
  authorization are required before real teacher/student flows.
- Hosted p50/p95/p99 latency and roughly 30–100 concurrent scan load evidence,
  tenant-isolation smoke, and pilot approval remain outstanding. Keep this
  feature marked failing until those gates pass.

## 2026-08-18 — Harden native attendance actors and make the hosted load gate runnable

**Risk profile:** runtime-platform and preview test tooling. No Supabase or
Convex migration, hosted setting, rollout flag, production write, deployment,
commit, merge, or promotion.

**Completed:**
- Made every Pika teacher-originated Bara command derive its actor from the
  live verified WorkOS server session. The server now exact-matches the stored
  Pika WorkOS subject and normalized email before session, mark, QR, or manual
  sync operations; mismatch fails closed before a Bara request or outbox write.
- Added a preview-only native scan measurement harness. It requires 30–100
  distinct authenticated student sessions in a mode-0600 gitignored manifest,
  exact matching HTTPS Preview origins, and a case count equal to concurrency.
  It refuses production and prints only aggregate closed-state counts,
  throughput, and min/p50/p95/p99/max latency.
- Added the hosted measurement runbook and a requirement-by-requirement
  completion ledger. Updated Bara's roadmap so the engine and native-student
  slices are accurately marked complete locally while hosted proof stays open.

**Verification:**
- Pika focused identity/load coverage passes 28/28. The complete Vitest run
  passes 542 files and 4,566 tests; ESLint, TypeScript, production build,
  architecture, design, UI-policy, session-log, and diff checks pass.
- Bara passes 32 files and 148 tests, TypeScript, production build, brand and
  12/12 synthetic Preview rollout guards, and diff hygiene. ESLint has only
  four generated Convex warnings after correcting a test-helper false positive.

**Remaining gates:**
- Pika migration 127 and Bara's roster-owner backfill remain unapplied. No
  isolated Preview, real cross-service teacher/student round trip, executable
  Supabase event-reordering proof, or hosted latency/load result exists yet.
- Obtain explicit target and migration authorization, then follow the ordered
  release sequence in the completion audit. Keep native attendance failing and
  all production flags off until those gates and a canary pass.

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
- Preserved the `favicon.ico` AuthKit matcher exclusion so passive asset
  requests cannot participate in WorkOS session refreshes.
- Added a real 64x64 Pika favicon through Next.js's static metadata convention,
  preventing `/favicon.ico` from rendering the authenticated root layout.
- Added a regression proving the favicon is excluded, application routes remain
  covered, Next.js internals remain excluded, and the asset has a valid ICO
  signature.

**Verification:**
- The revised regression fails against the unsafe matcher and passes with the
  restored exclusion and static asset.
- Focused middleware/auth coverage passes 50 tests; the full suite passes 557
  files and 4,865 tests. TypeScript and the production build pass.
- A pilot-enabled production-mode smoke test returns `200 image/x-icon` for
  `/favicon.ico` with no session cookie, while `/classrooms` still redirects to
  `/login`.
