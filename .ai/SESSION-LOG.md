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

## 2026-08-30 — Add a governed Pattern Lab for consistent AI-built UI

**Risk profile:** none — development-only reference route, AI guidance,
catalog data, and regression coverage; no production data, schema, or runtime
feature behavior changed.

- Replaced the private, data-dependent UI gallery entrypoint with a guarded
  `/pattern-lab` reference that renders deterministic production components.
  The catalog covers stable versus experimental patterns, canonical owners,
  use/avoid guidance, core controls, semantic page states, and role-specific
  teacher/student reference surfaces.
- Added an approved Lucide icon catalog and a semantic status-symbol catalog.
  Icons remain supplemental to accessible names and visible labels; domain
  statuses remain feature-owned unless meaning and behavior genuinely match.
- Added the repository-owned `pika-ui-change` skill and wired it into agent and
  UI guidance. Every UI change now records reuse/extend/create decisions, uses
  the Pattern Lab plus a real product surface, and promotes shared components
  only after two genuine adopters and a durable behavioral contract.
- Added unit/accessibility coverage and deterministic Playwright snapshots for
  teacher/student, desktop/mobile, and light/dark modes. The canonical alert
  dialog interaction is also captured. Nine visual comparisons passed with no
  horizontal page overflow.
- `pnpm check:focused -- --base origin/main` passes: workflow, architecture,
  UI/design policy, focused and related tests, TypeScript, and lint; database
  and browser contracts are selected for final CI. The pre-commit audit passes,
  and its composite-widget test covers named navigation, tabs, segmented
  controls, role-specific references, and dialog open/dismiss behavior.
- Independent review closed three boundaries before ready review: production
  now rejects the route even if gallery/fixture flags are set; the Tabs example
  owns explicit tab-to-panel relationships and demonstrates arrow-key focus and
  selection; and remaining `/__ui` documentation now points to `/pattern-lab`.
- Targeted re-review kept both controlled tab panels mounted so every
  `aria-controls` target remains valid in either selection state, with direct
  regression assertions before and after keyboard selection. It also removed
  the obsolete Vercel-preview recommendation now that Pattern Lab is explicitly
  local/non-production only.
- Ready-PR CI confirmed Test & Build and all pre-existing browser contracts,
  then exposed that the new snapshots only had macOS baselines. The nine
  CI-generated Linux baselines were retrieved from browser diagnostics,
  visually reviewed, and added alongside the macOS set. The PR returned to
  draft before this correction; the database job completed every contract step
  but was canceled during cleanup by that draft transition.
- Final authorization review removed the teacher-only Snapshot gallery from
  student reference surfaces while preserving the teacher catalog. Catalog,
  rendered-UI, and browser assertions now enforce that boundary. Updated
  desktop/mobile light/dark baselines were visually approved on macOS and from
  stable GitHub Linux captures; the diagnostic browser run passed 94 existing
  scenarios and failed only the four intentionally stale student snapshots.

**Model recommendation:** GPT-5.6 Terra medium for a low-risk UI governance,
test, and documentation consistency review.

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

## 2026-08-30 — Reconcile Pattern Lab with merged teacher refinements

**Risk profile:** none — development-only examples and merge integration; no
new production behavior, schema, dependencies, or stable-guidance promotion.

- Integrated main through `16ec69ea` (Daily date context and standalone spacing),
  preserving the concurrently merged history-preview gallery from PR #1089.
- Added real-owner teacher examples for DateNavigator, the context bar,
  standalone shell spacing, and attached workspace modes. Catalog entries are
  family-scoped; no new shared component was extracted. Fixed fixture dates,
  temporary controls, and mounted tabpanel targets keep the examples reproducible.
- Kept Daily's saved preference, stronger table-header treatment, commands, and
  status meanings feature-owned. Existing icon/status guidance is unchanged.
- Reconciled the `/ui-gallery` compatibility route with the guarded Pattern Lab
  owner; preserved teacher/student history-preview interaction coverage.
- Visual review refined the Lab's embedding margins without altering shared
  owners. Composite checklist reviewed; date descriptions, toggle semantics,
  keyboard focus, panel relationships, and student isolation are tested.

**Verification:** focused gate passed (77 workflow, 261 focused, 807 related
tests, architecture/UI/design policy, TypeScript and lint); final targeted suite
19/19; Pattern Lab browser matrix 13 passed / 3 intentional dialog skips with
unchanged existing baselines. Teacher examples captured in desktop 1440x900 and
mobile 390x844, light/dark, default/hidden-subtitle/future/selected-focus states.
Repository screenshot procedure also run with explicit teacher/student fixture
roles. New captures are local review evidence, not promoted visual baselines.

**Checkpoint:** user visual approval is pending. PR #1124 remains draft;
independent review of this reconciliation and fresh final CI follow acceptance.
No merge authorized or performed. No new reviewer launched this turn.

**Model recommendation:** current coding model for implementation; one bounded
Terra review of the new integration scope after the visual checkpoint.

## 2026-08-30 — Clarify Daily-only relative-date scope

**Risk profile:** none. **Model recommendation:** current coding model for
this bounded Pattern Lab wording correction.

- Per user clarification, labeled the relative-date example page-specific and
  explicitly prohibited copying its relative-date text to other pages. The
  shared catalog now describes only date-navigation structure, spacing, and
  accessible labels. No production component or interaction changed.
- Added scope regression assertions. Focused gate passed (77 workflow and 20
  Pattern Lab tests, related tests, policies, TypeScript, lint). Browser matrix
  passed 13/13 with 3 intentional skips and unchanged baselines; inspected the
  updated desktop/mobile light/dark wording. Existing composite behavior and
  student isolation remain covered.
- Explained the future correction workflow: identify local drift versus a
  shared-owner issue versus a proposed design change; show before/after; update
  Pattern Lab, guidance, and reviewed baselines only where the approved contract
  actually changes. Visual approval, independent review, and final CI remain
  pending; PR #1124 stays draft.

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

## 2026-08-30 — Prepare final Pattern Lab integration review

**Risk profile:** none for the remaining development-only UI reconciliation.
**Model recommendation:** GPT-5.6 Terra/medium for one bounded final integration
review, with at most one follow-up launch inside the remaining review budget.

- User authorized final independent review and CI for PR #1124, not merging.
- Integrated main through `61ec4bbf`, preserving its stable-SHA CI admission
  workflow and both sides of the session-history conflict. No product source
  changed in this sync; Daily-only relative-date scope remains intact.
- Existing local UI checks passed at `471020c2`; the final integrated revision
  receives refreshed focused checks before ready-for-review. Review results and
  exact-head CI evidence will be recorded on the PR so evidence does not require
  an unreviewed post-review commit.
- Ledger carried forward: 6 earlier reviewer launches and 4 remediation batches;
  this checkpoint allows at most 2 additional launches and 2 remaining batches,
  20 minutes per reviewer, and 45 minutes for the review session. The integration
  preparation is not remediation of a reviewer finding.

## 2026-08-30 — Focused check and agent workflow efficiency

- Combined workflow, changed, and related test selection in one native Vitest run; successful checks now print summaries/timings with full private temporary logs and complete failure output.
- Added opt-in startup context reuse while retaining environment/current-state checks; documented single-writer handoff, detached reviewer checkouts, evidence reuse, and compact context in the canonical workflow.
- Measured date-helper case: old runs executed 14 + 292 tests; combined selection retained the identical 292 unique cases in 21 files. One local sample took 9.94s versus 7.97s; not a general speed guarantee. Startup output was approximately 20 KB versus 5 KB when guidance was already loaded.
- Native two-project selection, standalone/space-containing paths, failure propagation, dry-run, invalid workflow/base, and startup-verification regression checks passed. No CI topology, application behavior, coverage threshold, dependency, model default, or migration changes.

## 2026-08-30 — Sync Pattern Lab after PR #1128

- Integrated `origin/main` at `e1f4fb61` into PR #1124; resolved only the archive conflict while preserving both histories. Developer-tooling changes apply unchanged; no `src/` or `e2e/` changes from the previously reviewed `976b958d`.
- This task remains sole writer for `codex/pattern-lab-governance`. Returned the PR to draft before updating; refreshed focused checks, targeted integration review, and exact-head CI evidence will be recorded on the PR without post-review commits.
- Risk profile: none (tooling/history integration). Model recommendation: GPT-5.6 Terra/medium for one bounded fixed-commit review in a separate detached checkout. Ledger: 7 prior launches and 4 prior remediation batches; at most 1 launch remains. Merge approval is still outstanding.

## 2026-08-31 — Stable-SHA CI admission audit at 35 natural attempts

**Risk profile:** workspace-state — CI evidence audit only; no product, schema,
dependency, enforcement, or branch-ruleset change.

- Ran `pnpm measure:ci -- --limit 36` after the post-#1127 sample exceeded 20
  completed natural attempts. Exact output:

```text
{
  "sampleSize": 35,
  "successfulSampleSize": 15,
  "counts": {"cancelled": 3, "failure": 1, "skipped": 16, "success": 15},
  "cancellationRate": 0.08571428571428572,
  "cancelledElapsedSeconds": 22,
  "successfulQueueSeconds": {"min": 0, "p50": 0, "p95": 820, "max": 820, "average": 124},
  "successfulRunSeconds": {"min": 297, "p50": 485, "p95": 532, "max": 532, "average": 458},
  "successfulWallSeconds": {"min": 297, "p50": 501, "p95": 1135, "max": 1135, "average": 582},
  "successfulRunsWithoutPrGateEvidence": 0,
  "prGateByMode": {
    "application-browser": {"sampleSize": 1, "timeToGateStartSeconds": {"min": 510, "p50": 510, "p95": 510, "max": 510, "average": 510}, "gateRunSeconds": {"min": 4, "p50": 4, "p95": 4, "max": 4, "average": 4}, "timeToGatePassSeconds": {"min": 514, "p50": 514, "p95": 514, "max": 514, "average": 514}},
    "full": {"sampleSize": 13, "timeToGateStartSeconds": {"min": 473, "p50": 497, "p95": 1131, "max": 1131, "average": 606}, "gateRunSeconds": {"min": 2, "p50": 3, "p95": 4, "max": 4, "average": 3}, "timeToGatePassSeconds": {"min": 476, "p50": 501, "p95": 1134, "max": 1134, "average": 609}},
    "production-promotion": {"sampleSize": 1, "timeToGateStartSeconds": {"min": 293, "p50": 293, "p95": 293, "max": 293, "average": 293}, "gateRunSeconds": {"min": 3, "p50": 3, "p95": 3, "max": 3, "average": 3}, "timeToGatePassSeconds": {"min": 296, "p50": 296, "p95": 296, "max": 296, "average": 296}}
  }
}
```
- All 16 skipped draft attempts were individually inspected and contained no
  non-skipped job. The three cancellations and one failure were ready-PR guard
  events: PR Gate failed within 2–4 seconds while every heavy lane was skipped,
  then the succeeding ready event ran the exact-head full suite. This confirms
  #1127 prevents duplicate heavy work and cannot silently satisfy protection.
- The cancellation target passes (8.6% under 10%); selected browser/database
  dependencies passed in successful full runs, the application-browser lane
  passed, the production-promotion lane passed, and browser artifacts/two-worker
  combined execution remain selected. Existing fail-closed classifier and
  rulesets are unchanged.
- The audit does not pass: full-mode p50 exceeds the under-eight-minute target
  by 21 seconds, and fresh docs-only evidence is absent. These are evidence and
  traffic/queue issues, not a safe bounded workflow correction; preserve all
  enforcement and request a decision before changing performance targets or
  broad CI topology.

**Verification:** GitHub run-level inspection of every skipped, cancelled, and
failed attempt; exact measurement above; no new test execution.

**Model recommendation:** GPT-5.6 Terra high for any owner-approved CI topology
or target revision; no automatic remediation is justified.

## 2026-08-31 — UI consistency approach (read-only review)

Reviewed DESIGN.md, stable/family UI guidance, Pattern Lab catalog and fixtures, committed Pattern Lab visual evidence, and current product-experience progress. Recommended a page/role/state adoption matrix, family-scoped reference compositions, a Roster pilot, and incremental visual/interaction verification. No product code changed; no fresh live page audit performed. Next: baseline active routes and approve missing family patterns before implementation.

## 2026-08-31 — Reference-page audit and local preview

Started local Pika preview at localhost:3000 with the governed launcher and seeded local accounts. Captured Student Tests list/submitted detail, teacher Daily unselected/selected, and live Pattern Lab teacher examples. Initial findings: test Closed labels hide submitted progress; Daily first names truncate in current width configuration; Lab lacks complete source-page state examples. Preliminary audit and eight screenshots saved under the task visualization directory, pika-reference-audit/audit.md. No product code changed. Next: agree one small source-page preview before broader adoption.

## 2026-08-31 — Relative-date clipping local preview

Fixed clipped descenders in both DateNavigator subtitle render paths by restoring 16px line height. Local Daily/Lab preview updated, 44px control retained. Six component tests and four Pattern Lab browser matrix checks passed; all default captures reviewed; UI/design policy pass. Evidence: task visualization relative-date-fix/brief.md. Local preview on codex/fix-relative-date-descenders; awaiting visual acceptance before publishing.

## 2026-08-31 — History timestamp local preview

Extended shared HistoryGraph so hover/selected context shows only Toronto date/time below the chart, with a reserved line to prevent hover layout shifts. Removed overlay and character-count summary; kept detailed accessible slider labels and existing selection behavior. Updated Pattern Lab explanation and existing semantic tests. All 27 HistoryGraph tests, UI/design policy, and diff checks pass. Playwright verified both authenticated roles at desktop/mobile sizes in light/dark, with hover, pin, keyboard, clear and daily overview checks; screenshots visually reviewed. Evidence: task visualization history-tooltip-fix/brief.md. Local preview only, preserving relative-date fix; not published.

## 2026-08-31 — Stack history date above time

Refined the local HistoryGraph preview per user request: date on the first line, time below, both beneath the graph. Reserved two lines to avoid hover shifts; shared owner and existing interactions retained. All 27 component tests and UI/design policies pass. Playwright repeated both roles, desktop/mobile, light/dark with two-line, no-overlap, stable-layout, pin/keyboard/clear and daily-overview checks; screenshots reviewed. Evidence: task visualization history-tooltip-fix/stacked. Local only, not published.

## 2026-08-31 — Prepare UI fixes PR and authorized main merge

User authorized PR and merge of the relative-date descender fix and stacked history timestamp. Sole writer: current task on codex/fix-relative-date-descenders. Risk profile: none (localized UI presentation); no API, schema, dependency, or permission changes. Model recommendation: GPT-5.6 Terra/medium for one independent fixed-commit review. Ledger starts at 0 launches and 0 fix batches; limits 5 launches, 3 remediation batches, 45 minutes total and 20 minutes per reviewer. Existing visual evidence covers DateNavigator's four-project matrix and history's eight role/viewport/theme combinations, including hover/pin/keyboard/clear. Removed incidental gallery explanatory-copy edit; Pattern Lab still renders the changed production components directly. Focused checks, independent review and exact-head CI follow; results will be recorded on the PR without post-review commits.

## 2026-08-31 — Match and enlarge Classwork creation dialogs

Task Resize classwork creation modals owns codex/classwork-creation-modal-size. Extended CreationModalShell with opt-in 90dvh height and a non-scrolling footer; reused it for materials and expanded assignment/material editors. Other creation shells retain content-driven sizing. Assignment actions stay above the scrolling form; material actions stay below it. No business logic, dependencies, schema, or permissions changed (risk profile none). Pattern Lab includes a deterministic shell example; no new stable design pattern or unrelated refactor. Component tests cover sizing, footer placement, focus containment/return, and the gallery example. Playwright verified teacher desktop 1440x900 and mobile 390x844 in both themes, empty and long/scrolled content: matching 896x810 desktop and 374x759.6 mobile bounds, visible actions, no horizontal overflow, and keyboard containment/Escape. Student creation is n/a; standard both-role Classwork smoke screenshots also captured. Local evidence: output/playwright/ and /tmp/pika-modal-matrix.log. Focused checks passed; final check, one independent Terra/medium review, and draft-first PR follow. Merge requires user authorization.

## 2026-08-31 — Student Tests local redesign review

- Worktree `/Users/stew/.codex/worktrees/9667/pika`, branch `codex/student-tests-page-review`: progress-first test cards, mobile title wrapping, shared Back/focus return, and explicit detail read recovery. API, data, exam rules, and grading untouched.
- Experimental brief: `docs/guidance/ui/experimental/student-tests-progress.md`; deterministic production-owner examples under Pattern Lab feature patterns. Unrelated date/history fixes left to their owning task.
- Evidence: `/Users/stew/.codex/visualizations/2026/08/31/01a057fb-2a22-7e92-88f4-9d582c079959/student-tests/`. Focused checks: 176 tests plus policy/types/lint; 66 targeted access/exam regressions; four browser combinations; semantic-token contrast passes. Local preview runs on port 3001 with its own worktree build and local Supabase credentials.
- User accepted moving the preview through commit, draft PR, and independent review; leave card/page spacing and active exam workspace unchanged. Merge remains a separate approval; no migration or test-data writes.
- Risk profile: workspace-state. Model recommendation: GPT-5.6 Terra/high for one independent fixed-commit review in a detached checkout. Review budget: five launches, three remediation batches, 45 minutes maximum; final review and CI evidence will be recorded on the PR without changing the reviewed commit.

## 2026-08-31 — Approve Student Tests merge and integrate current main

- User manually verified the student preview and authorized PR review and main merge for #1131. This task remains sole writer of `codex/student-tests-page-review`; no production promotion is authorized.
- Integrated the Classwork-dialog change from current main. Preserved both Pattern Lab examples and both continuity histories; Student Tests application files and existing spacing are unchanged from the reviewed preview.
- Risk profile: none for integration (underlying PR workspace-state). Model recommendation: GPT-5.6 Terra/medium for one targeted fixed-commit integration review; earlier Terra/high behavioral review remains valid. Prior ledger: one review, zero remediation batches. Final focused checks, integration review, and CI will be recorded on the PR without post-review commits.

## 2026-08-31 — Consume published Pal badge-label cleanup

Task owns codex/pal-widget-alpha6. User authorized widget publication and Pika PR/review/main merge; production promotion is excluded. Pinned @codepet/pal-widget 0.1.0-alpha.6 and its registry integrity after Pal #102 merged and the guarded alpha release passed. Reused StudentAchievementsTab and PalWidgetThemeBoundary without host UI/API/schema changes (runtime-platform dependency risk). Regression tests fail against alpha.5 and pass against alpha.6: 25 Pal integration tests verify exact package version, name-only earned labels, focusability, unfinished status, and progress. Playwright inspected the real student achievement component with synthetic local data at 1440x900 and 390x844 in both themes, hover and keyboard focus; final mobile width 390/390, no broken images. Pattern Lab reference inspected; teacher badge surface is n/a. Evidence: /tmp/pika-pal-alpha6-visual.nEY1f9; temporary fixture removed, no authenticated classroom or production-data validation claimed. Focused checks, draft PR, one independent Terra/high fixed-commit review, and exact-head PR Gate follow; record final results on the PR without post-review commits.
