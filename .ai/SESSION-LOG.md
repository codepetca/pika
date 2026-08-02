# Pika Session Log

Rolling recent session log for AI/human handoffs. Keep this file small; full historical session history lives in `.ai/JOURNAL-ARCHIVE.md`.

**Rules:**
- Append one concise entry for meaningful work, then immediately run `node scripts/trim-session-log.mjs` in the same change.
- Start each entry heading with a valid ISO date (`## YYYY-MM-DD ...`) so retention can identify the latest entries.
- CI allows at most 60 entries; the trim step compacts to the latest 40 entries by default so there is headroom for future appends.
- Use `node scripts/trim-session-log.mjs --check` to verify the log is chronological and within the 60-entry cap.
- Keep enough recent entries for weekly automations to inspect roughly the last week of work.
- The trim step appends removed entries to `.ai/JOURNAL-ARCHIVE.md`, so trimming never loses history.
- Use `.ai/JOURNAL-ARCHIVE.md` only for historical investigation.

## 2026-07-23 — Rebased test-preview hardening after Quiz removal

**Risk profile:** workspace-state/exam-mode/runtime-platform/schema-mismatch

**Completed:**
- Rebased PR 920 onto the completed legacy Quiz removal on `main`, preserving
  the canonical test-only API and both preview request-order regressions.
- Resequenced the atomic snapshot migration to 109 and consolidated the
  uncommitted document-authoring and durable-cleanup schema into migration 110.
- Kept ordinary document writers behind compare-and-swap updates, added a
  leased storage-cleanup queue and cron worker, and retained real transport
  SSRF/timeout coverage.
- Left the shared local database unchanged. It remains reset and seeded through
  migration 104; migrations 105-110 are unapplied there.

**Validation:**
- Full Vitest coverage passes: 421 files and 3,749 tests.
- Pika pre-commit audit, ESLint, production build, and `git diff --check` pass.
- No local or hosted migration was applied.

**Remaining:**
- Run targeted security rereview and final integration review.
- Push the rebased exact head, wait for CI, and merge only after approval.

## 2026-07-24 — AI-readiness CLI probe, course-import fix, repo tidy

**Completed:**
- Explored making Pika "AI-ready"; built a delete-able CLI probe (`pnpm pika`, branch `cli-probe`) that drives teacher operations headlessly via the existing role-gated API — no server changes. Logs in through `POST /api/auth/login`, persists the session cookie to `.auth/` (gitignored), and reuses the shared markdown contracts so a script produces exactly what the UI does. Commands: `login`, `whoami`, `test pull/push`, `course list/push/instantiate`; writes are dry-run unless `--yes`. Added `scripts/pika-cli-smoke.ts` (`pnpm smoke:pika-cli`) whose pull→push→pull round-trip is a drift detector. Pushed the branch to start a usage trial; not a merge candidate.
- The probe surfaced a real bug on first use: importing a course package containing tests/lesson-plans failed with `400 assessments.N: Unrecognized key: "id"`, affecting both the JSON API and the UI's tar upload. Root cause: markdown parsers attach `id: existingMatch?.id` (undefined on fresh import), which zod 4 rejects on `.strict()` schemas; assignments were normalized but assessments and lesson templates were passed raw. Fixed by normalizing all three consistently in `buildCreateBlueprintWritePlan`, with regression tests at the write-plan layer (the existing route test mocks the function, so it could not catch this). Merged as PR #932.
- Fixed `scripts/repo-tidy.sh` to classify worktrees by PR state (reusing the existing `PR_MAP`) instead of remote presence, since squash-merge + delete-on-merge makes "not on remote" the normal state of merged work — the old logic inverted the risk signal (33 of 44 flagged items were already merged). Merged as PR #934.
- Repo hygiene: reduced worktrees from 48 to 6 (removed 42 merged/closed-PR worktrees and local branches, remotes preserved for recovery), deleted one merged remote branch, and closed stale PR #567.

**Validation:**
- Full `pnpm test` (413 files, 3688 tests) on the #932 fix; regression tests confirmed to fail without the patch with the exact production error.
- End-to-end via the CLI against fixed `main`: `course push` with `tests.md` imports, `course instantiate` creates a classroom, and both quizzes materialize as real tests — the exact case that failed pre-fix.
- `pnpm smoke:pika-cli --full` passes; typecheck and `pnpm check:architecture` clean on both PRs.

## 2026-07-24 — Aligned Claude workflow guidance

**Risk profile:** none

**Completed:**
- Aligned the Claude session-start and workflow-reset commands with the
  canonical startup and worktree guidance.
- Simplified the Claude issue helper to route worktree setup through
  `docs/dev-workflow.md` instead of hardcoding one named-worktree layout.
- Added semantic prompt invariants covering both Claude and Codex startup,
  workflow-reset, and issue-helper surfaces.

**Validation:**
- `pnpm vitest run tests/unit/ai-startup-docs.test.ts` passes: 31 tests.

**Remaining:**
- None.
- `pnpm run db:types:check`
- Pika changed-file audit and composite-widget accessibility checklist
- Playwright teacher preview captures at desktop and mobile light/dark, including mobile-dark document-open focus, plus a student-authenticated denial capture; no horizontal overflow
- Component keyboard regression for document focus entry/return and semantic region assertions
- Live pinned public HTTPS fetch returned `200`; direct/mixed/private/IPv4/IPv6/NAT64 and redirect rejection tests issue no unsafe request
- Local migration history reports 105 applied; generated types match; the RPC exists with execute granted only to `service_role`
- `git diff --check`

**Remaining:**
- Require targeted security review, final integration review, exact-head CI, and protected merge.
- Apply migration 105 to each deployment target before deploying the updated sync route.
- Continue Tests with student flag pressed semantics and save/flag announcements; keep mobile and Gradex deferred.

## 2026-07-24 — Remediated test-preview review findings

**Risk profile:** workspace-state/exam-mode/runtime-platform/schema-mismatch

**Completed:**
- Rebased PR 920 onto current `main` and retained collision-free migrations 109
  and 110 without changing the shared local or hosted databases.
- Closed snapshot cleanup races by requiring pending provisional evidence under
  a row lock before attachment and by making the database concurrency harness
  use a deterministic lock barrier.
- Defined durable snapshot ownership across live tests, cold archives, and
  defensive legacy blueprint rows. Reusable blueprint capture, persistence,
  export, and instantiation now strip classroom-specific snapshot metadata.
- Applied one absolute deadline across DNS, redirects, and response transport,
  and discard redirect bodies without buffering them.
- Rebound an open teacher-preview document to refreshed same-ID data and close
  the viewer when the document disappears.

**Validation:**
- Focused remediation suite: 12 files and 142 tests.
- Full Vitest suite: 421 files and 3,767 tests.
- TypeScript, ESLint, architecture boundaries, production build, shell syntax,
  `git diff --check`, and Pika changed-file audit pass.
- Teacher preview verified visually at desktop and mobile; student access to
  the teacher-only route correctly renders the unavailable state.
- No migration was applied to the shared local database or a hosted target.

**Remaining:**
- Push the rebased exact head, run the disposable migration/database checks in
  CI, and resolve any exact-head failures before merge.

## 2026-07-24 — Promoted the pika teacher CLI and made it global

**Completed:**
- Reviewed the CLI before real use and fixed four bugs: the flag parser
  greedily consumed the token after `--yes`, so `test push --yes <id> <file>`
  read the id as the flag's value; `course push` defaulted a missing manifest
  version to `3` after the format moved to `4`; `test pull --out nested/dir.md`
  threw when the directory did not exist; and help omitted the required
  `--semester`/`--year` args for `course instantiate`. Added `--key=value`
  support.
- Closed the curriculum-as-code loop for whole courses. `course pull` exports a
  blueprint to an editable directory using the shipped package decoder, and
  `course push` now detects an existing blueprint by course code (else title)
  and refuses by default, with `--replace` to recreate and `--new` to duplicate
  on purpose. Previously every push created another blueprint.
- Promoted the CLI from the `cli-probe` experiment into `main` (PR #937) and
  retired `scripts/pika`, the earlier worktree-router that held the name,
  rewriting its section in `docs/dev-workflow.md`.
- Made the CLI runnable from anywhere. It must run with CWD at the repo root
  because `src/lib` uses `@/` tsconfig aliases that tsx resolves from the
  working directory, so `scripts/pika-global.sh` cds in but forwards the
  caller's directory via `PIKA_ORIGIN_PWD`; repo-owned paths (`.env.local`, the
  saved session) anchor to the repo through `__dirname`. Installed as a
  dedicated checkout at `~/.pika-cli` on `main`, symlinked to `~/bin/pika`.
- Made `smoke:pika-cli --full` tear down the blueprint and classroom it creates,
  including when an assertion throws partway through (PR #938). Without it,
  runs had accumulated nine duplicate blueprints and nine stray classrooms
  locally; those were cleared, keeping the seeded `Test Classroom`.

**Validation:**
- Full smoke (`--full`) passes; three consecutive runs leave row counts
  unchanged, `--keep` retains exactly one blueprint and classroom, and an
  injected mid-phase failure tears down without leaking.
- Course round-trip verified end to end: push, pull, guard refusing a duplicate,
  edit, `push --replace`, then pull confirming the edit landed.
- Global `pika` verified from an unrelated directory: files land in the caller's
  cwd and nothing leaks into `~/.pika-cli`.
- TypeScript and `pnpm check:architecture` (628 modules) clean; CI green on both
  PRs.

**Remaining:**
- Use the CLI for real curriculum work and let that rank the next slice.
  Unbuilt candidates: gradebook commands for agent-in-the-loop grading,
  `assignment pull/push`, and creating a test from scratch.
- `~/.pika-cli` does not self-update; run `git -C ~/.pika-cli pull` after CLI
  changes land.

## 2026-07-25 — Authoring system WYSIWYG rollout

**Completed:**
- Added governed `brief`, `compact`, `document`, and `markdown-safe` TipTap toolbar presets, accessible editor semantics, shared authored-content fields/save status, and a limited-Markdown WYSIWYG compatibility boundary with round-trip warnings.
- Migrated assignment instructions, classwork materials, test question prompts, and teacher calendar direct entry to purpose-fit WYSIWYG while retaining structured answer/options/code/document inputs and explicit advanced Markdown modes.
- Kept full document tools for student assignment submissions and class resources, no-toolbar editing for student daily reflections and calendar cells, and unified autosave status presentation.
- Reworked the mobile week calendar into one aligned horizontal viewport and centered the active direct-entry cell; fixed mobile editor toolbar placement and shared dark-mode editor text.
- Preserved existing Markdown/TipTap storage, autosave/history behavior, APIs, schema, and data.

**Validation:**
- `pnpm test --run` (427 files / 3,794 tests)
- `pnpm lint`
- `pnpm check:architecture` (631 modules / 0 allowances)
- `pnpm build`
- `bash .codex/skills/pika-audit/scripts/audit.sh`
- Teacher/student desktop/mobile light/dark Playwright matrix for assignment authoring, student submissions, test authoring, and calendar viewing/direct entry
- Composite-widget accessibility checklist reviewed; keyboard behavior and semantic state covered by tests; no remaining manual follow-up
- `git diff --check`

**Remaining:**
- Publish or merge the isolated `codex/authoring-system` worktree when ready; no schema rollout is required.

## 2026-07-25 — Rebased and reviewed PR 832

**Risk profile:** exam-mode

**Model recommendation:** GPT-5.6 Terra — standard-risk application behavior review.

**Completed:**
- Rebased the test-answer completeness simplification from PR #832 onto current `origin/main` in a dedicated worktree.
- Preserved the shared completeness predicate used by the student submit gate and TypeScript final-response validator; whitespace-only open responses remain incomplete.
- Removed a stale test prop exposed by the rebase and repaired the old session-log edit so current continuity entries remain intact and chronological.
- Completed an independent correctness and test-adequacy review with no actionable or merge-blocking findings.

**Validation:**
- Focused test-submit Vitest: 5 files / 49 tests.
- Full Vitest suite.
- `pnpm exec tsc --noEmit --pretty false`
- `pnpm lint`
- `pnpm check:architecture` (631 modules / 0 allowances)
- `pnpm build`
- `node scripts/trim-session-log.mjs --check`
- `git diff --check`

**Remaining:**
- Push the rebased exact head to PR #832 and require fresh CI before merge.

## 2026-07-25 — Design-system consolidation Phase 1

**Risk profile:** none

**Model recommendation:** GPT-5.6 Terra — documentation-only authority and
consistency review.

**Completed:**
- Added root `DESIGN.md` as the canonical design entry point and documented the
  source-of-truth order across principles, executable tokens, shared UI,
  Tailwind aliases, stable/family-specific/experimental/legacy guidance, and
  Git history.
- Consolidated the still-useful compact-density and approachable-character
  principles from the historical design-system document, replaced
  `docs/core/design.md` with a compatibility redirect, and retired
  `docs/design-system.md` without copying its obsolete raw colors, 36px target
  guidance, or pre-token recipes.
- Updated active AI instructions, prompts, documentation routing, governed UI
  guidance, and `src/ui/README.md` to route design work through the new
  authority.
- Added documentation hierarchy tests covering the root authority, redirect,
  historical-document disposition, active legacy governance, and AI routing.
- Opened PR #948. Independent review found two non-blocking documentation-index
  and redirect-test gaps; both were corrected in one remediation batch, and the
  targeted re-review was clean.
- Kept this phase documentation-only: no visual, component, token, Pal runtime,
  dependency, schema, or application behavior changes.

**Validation:**
- Full Vitest suite.
- `pnpm lint`.
- Focused UI guidance, policy, and semantic-token contrast tests: 3 files / 24
  tests.
- UI policy scan: 202 registered native controls across 64 files.
- Architecture boundaries: 631 modules / 0 deletion-only allowances.
- `bash scripts/verify-env.sh`.
- `git diff --check`.

**Remaining:**
- Require green exact-head CI and a clean final integration review before any
  merge decision.
- In Phase 2, add the missing portable foundation tokens and policy checks
  before implementing the Pika-to-Pal semantic bridge.

## 2026-07-25 — Pika-side Pal achievements pilot

**Risk profile:** integration, privacy, database, cross-origin embed

**Completed:**
- Implemented the disabled-by-default `PAL_ENABLED` pilot on
  `codex/pal-pilot`, with pinned Pal v1 contract fixtures and stable HMAC
  learner/classroom/item/fact tokens. Outbound payloads exclude raw IDs,
  assignment names, work, grades, deadlines, and teacher-maintained catalogs.
- Drafted unapplied migration 111 for a service-role-only transactional
  outbox, leases, retries, non-retryable visibility/requeue, and monotonic
  learner/week opportunity revisions.
- Wired authenticated session, new enrollment, the real daily-log autosave
  creation path, genuine first assignment open, and first valid assignment
  completion to the outbox. Duplicate daily logs and resubmissions retain one
  fact identity.
- Added daily Monday–Friday opportunity reconciliation across learner
  enrollments and class days, including short weeks, schedule/archive changes,
  completion floors, and terminal prior-week closure.
- Added the student-only Achievements navigation item and secure
  `/embed/roadmap` iframe with origin/source/nonce validation, short-lived
  read-token handoff, bounded failure/retry, and light/dark appearance
  messages. Pika retains its shell; Pal owns roadmap and reward rendering.
- Added the Pika operations/rollout guide, including week-boundary rollout,
  no historical backfill, at-least-once/out-of-order delivery, and current Pal
  prerequisites. No migration was applied and no environment was enabled.

**Validation:**
- `pnpm test` (440 files / 3,850 tests).
- `pnpm exec tsc --noEmit`
- `pnpm lint`
- `pnpm check:architecture` (648 modules / 0 allowances)
- `pnpm check:ui-policy` (202 controls / 64 files)
- `pnpm build`
- Desktop/mobile and light/dark Playwright inspection using a temporary Pal
  handshake harness; selected navigation, ready embed, and live theme changes
  were verified.
- `git diff --check`

**Remaining:**
- Apply migration 111 only through the separately authorized target-specific
  process.
- Complete Pal v1 ingest, read-token, and `/embed/roadmap` dependencies, then
  run the real duplicate/retry/out-of-order vertical slice before enabling the
  pilot or merging the integration branch to `main`.

## 2026-07-25 — Pika-side Pal achievements pilot

## 2026-07-26 — DESIGN.md product-conformance loop

**Risk profile:** none

**Model recommendation:** GPT-5.6 Sol high reasoning — cross-checking design
authority against implemented owners, current product evidence, and a portable
widget boundary requires repository-wide synthesis.

**Completed:**
- Audited the canonical root design contract against executable tokens,
  Tailwind aliases, shared primitives, policy tests, representative product
  surfaces, and the current Pal pilot footprint.
- Used two Open Design passes to classify confirmed invariants, executable-only
  behavior, migration gaps, governed legacy exceptions, and unverified Pal
  work; the second independent pass gave the revised structure a qualified
  pass and identified two final wording edits.
- Refined `DESIGN.md` with an explicit claim-classification model, observed
  Pika visual invariants, named adoption gaps, bounded classroom/auth/workspace
  exceptions, evidence freshness requirements, risk-matched verification, a
  conformance loop, and a provisional Pika-to-Pal handoff packet.
- Kept exact visual values with their executable owners and retained the Pal
  bridge detail only as a provisional handoff until the real package API can be
  reviewed.
- Added hierarchy-test coverage for the new classification, verification,
  evidence, and provisional-contract language.
- Kept the work documentation-only; no existing runtime UI, behavior, tokens,
  dependencies, schema, migrations, or production state changed.
- Opened PR #949. Independent review found that shell-light authentication
  guidance overstated current legacy text-control conformance, the start
  taxonomy did not explicitly define governed legacy/experimental guidance,
  and the linked July evidence set did not identify its missing provenance.
  One remediation batch classified the registered auth controls as Phase 6
  migration debt, completed the taxonomy, and marked the older captures as a
  historical evidence set rather than fresh conformance proof.
- Targeted review then found that the observed-invariant definition still
  called the linked evidence current. A second narrow remediation distinguished
  current executable owners from recorded historical baselines and requires
  refreshed captures before claiming current visual conformance.

**Validation:**
- Open Design revision board: structure, interaction, evidence integrity,
  responsive breakpoints, visible 44px controls, and independent desktop render
  inspection at 1280px.
- Full Vitest suite: 427 files / 3,799 tests.
- `pnpm exec tsc --noEmit --pretty false`.
- `pnpm lint`.
- Architecture boundaries: 631 modules / 0 deletion-only allowances.
- UI policy scan: 202 registered native controls across 64 files.
- `bash .codex/skills/pika-audit/scripts/audit.sh`.
- `node scripts/trim-session-log.mjs --check`.
- `git diff --check`.

**Remaining:**
- Complete targeted remediation review and exact-head CI for PR #949, and merge
  only if the review gate is clean.
- Keep future Pal custom-property names provisional until `@pal/widget`, the
  Pika adapter, contract tests, and host captures are reviewed together.

## 2026-07-26 — Portable design-foundation enforcement

**Risk profile:** standard

**Model recommendation:** GPT-5.6 Sol high reasoning — shared token aliases,
class-merging behavior, repository-wide visual-value policy, and pixel-parity
evidence require cross-layer verification.

**Completed:**
- Added host-neutral typography, minimum target, focus, motion, page-width,
  density, layer-responsibility, and light/dark scrim variables while preserving
  the implemented Pika values.
- Exposed the foundations through Tailwind and migrated canonical page,
  control, overlay, status, header, tooltip, tab, table, and floating-action
  owners to semantic aliases.
- Extended `tailwind-merge` so semantic ring-width and ring-offset aliases
  remain distinct from semantic ring colours; the first focused test run caught
  this before commit.
- Added reduced-motion resolution for shared duration tokens. Normal light/dark
  geometry and appearance remain unchanged; adopted transitions resolve to
  zero only when reduced motion is requested.
- Added an exact design-value policy for raw colours, arbitrary spacing, and raw
  layers. The governed baseline records count, fingerprint, reason, and
  migration owner, so additions, removals, and same-count substitutions fail
  CI without an explicit registry update.
- Added portable-foundation contract tests, updated affected component
  contracts, wired the design policy into CI, and documented the foundation and
  exception rules in `DESIGN.md`, stable guidance, and `src/ui/README.md`.
- Added a repository PR conformance checklist and a durable visual-evidence
  provenance template.
- Independent review found that the first raw-value scanner missed arbitrary
  Tailwind values/properties, literal inline styles, and CSS/SCSS, and that
  caller-last overrides did not conflict with every new Tailwind alias.
- Expanded the policy across TypeScript, JavaScript, CSS, and SCSS while
  preserving `src/styles/tokens.css` as the explicit semantic-definition
  boundary. Follow-up review also closed arbitrary color-property and
  background-shorthand escapes. The exact baseline now governs 779 values
  across 100 files.
- Registered page-width, minimum-target, density (including negative bleed),
  motion, easing, and layer aliases in `tailwind-merge`, with caller-last
  regression coverage for every portable alias family.

**Validation:**
- Full Vitest suite: 429 files / 3,810 tests.
- `pnpm lint`.
- `pnpm build`.
- `pnpm exec tsc --noEmit --pretty false`.
- Architecture, UI policy, design policy, and semantic-token contrast checks.
- Pika audit passed; composite accessibility checklist reviewed, with keyboard
  behavior and semantic state covered by existing and updated tests.
- Browser experience matrix: 18/18 across teacher/student, desktop/mobile, and
  light/dark.
- Pika UI verification screenshots reviewed for teacher desktop, teacher
  mobile, student mobile, and mobile dark variants.
- Direct current-`main` comparison: teacher/student light/dark classroom-index
  captures were pixel-identical below the dynamic clock header; the login
  capture was fully pixel-identical. Stored snapshot baselines are stale under
  the current browser/runtime and were not rewritten in this change.
- Remediation regressions: 13/13 focused policy/foundation tests; all six files
  that timed out under full-suite parallel resource contention passed
  sequentially (165/165).
- `git diff --check`.

**Remaining:**
- Commit and publish the review remediation, complete targeted independent
  review and exact-head CI, and merge only when both gates are clean.
- Keep the public `--pal-*` bridge out of Pika until the actual `@pal/widget`
  package API can be reviewed and contract-tested.

## 2026-07-26 — Pika-to-Pal theme adapter

**Risk profile:** none

**Model recommendation:** GPT-5.6 Sol high reasoning — the small adapter still
requires exact cross-repository contract and semantic-token drift checks.

**Completed:**
- Added a dormant, widget-scoped Pika theme boundary that aliases the reviewed
  36-property Pal contract exclusively to existing Pika semantic tokens.
- Vendored only Pal's dependency-free contract manifest while `@pal/widget`
  remains private; no Pal components, styles, artwork, or behavior were copied.
- Confirmed contract version 1 in `DESIGN.md` while keeping Pika ownership of
  host layout, overlay placement, theme, density, focus, and motion.
- Added drift tests for property completeness, allowed appearance attributes,
  raw-value exclusion, and existence of every referenced Pika token.
- Isolated this safe adapter from the broader draft Pal pilot after independent
  review found rollout blockers in that cumulative branch.

**Validation:**
- Focused design/theme guidance tests: 17/17.
- TypeScript, lint, production build, architecture check, UI policy, design
  policy, and Pika audit passed.
- No current route mounts the boundary, so existing Pika UI/UX is unchanged.

**Remaining:**
- Complete independent review and exact-head CI for the isolated adapter PR.
- Replace the vendored manifest with a direct package import when Pal publishes
  `@pal/widget`; mount it only as part of the separately reviewed native pilot.

## 2026-07-26 — Pika-to-Pal widget theme contract

**Risk profile:** cross-repository UI contract, accessibility, package release

**Completed:**
- Pal commit `7a6d869` defines theme contract v1 with 36 optional scoped
  properties, explicit theme/density/viewport/motion provider values, portable
  light/dark fallbacks, focus/target/motion handling, and contract tests.
- Added the Pika `PalWidgetThemeBoundary` and one CSS-module adapter that maps
  every Pal input to an existing Pika semantic token without copied raw values.
- Vendored only Pal's dependency-free property manifest while `@pal/widget`
  remains private; documented its upstream commit and mandatory deletion after
  the package can be imported directly.
- Updated `DESIGN.md`, the pilot runbook, startup context, and hierarchy tests
  to record the confirmed native-widget boundary. The disabled iframe remains
  an interim prototype and is not an enablement target.
- Registered the interim iframe's two existing raw height utilities under the
  native-widget release owner so current design-policy CI remains exact.

**Validation:**
- Pal widget tests: 37/37; Pal widget/web lint and typecheck passed.
- Pal sandbox reviewed at 1440x900 and 390x844 in light/dark, including visible
  keyboard focus and reward/companion layers; desktop is the default.
- Pika adapter, hierarchy, startup-budget, and design-policy tests passed.
- Pika audit, lint, typecheck, architecture, UI policy, design policy, build,
  and `git diff --check` passed.
- Full Pika suite passed 443/444 files and 3,870/3,871 tests; the sole
  unrelated `TestDetailPanel` timeout passed in isolation in 0.54s.

**Remaining:**
- Publish a reviewed non-private `@pal/widget` package and import its contract
  directly.
- Replace the disabled iframe with the native provider/surfaces, then run the
  authenticated Pika student visual matrix and real delivery vertical slice.
- Migration 111 and feature enablement remain human-controlled.

## 2026-07-26 — Versioned Course Blueprint lineage and proposals

**Risk profile:** high — migration 111 changes reusable artifact identity and
structural revision triggers, and adds atomic proposal application.

**Completed:**
- Defined Course Blueprint, Blueprint Draft, immutable Blueprint Version,
  Artifact ID, Course Package, Change Proposal, and Classroom Archive
  boundaries. Student work and classroom runtime state remain outside the
  Blueprint.
- Added package format v5 with UUIDv4 Artifact IDs and exact Blueprint
  revision/version/editing-session provenance while retaining legacy package
  import adapters.
- Added stable Blueprint-to-classroom lineage for assignments, tests,
  questions, submission requirements, lesson plans, classwork materials,
  surveys, and survey questions.
- Expanded the complete reusable structure boundary to include mixed classwork
  ordering, assignment authenticity settings, and category gradebook defaults
  while excluding releases, responses, grades, and other runtime/student data.
- Added content-addressed immutable Blueprint Versions and made export and
  classroom instantiation save/select an exact Version.
- Added atomic, idempotent, stale-safe proposal storage/application for
  repository, classroom, package, and Pika AI sources.
- Completed the inverse update path from an immutable Blueprint Version into
  an existing linked classroom. Pika now prepares a classroom-target proposal
  against exact Blueprint, classroom, start-date, and class-day revisions and
  applies the reviewed plan atomically.
- Added live-classroom successor safety: attempted Tests, surveys with
  responses, and assignments with student documents retain their historical
  rows and receive new unpublished draft successors for content updates.
  Blueprint removals retire lineage from future sync without deleting runtime
  or student data.
- Replaced destructive CLI replacement with pull-edit-propose-review/apply and
  added proposal listing/application commands.
- Added explicit Pika-managed versus repository-managed authority. Direct Pika
  Draft edits are blocked in repository mode.
- Routed classroom promotion and AI drafting through proposals rather than
  direct Blueprint writes.
- Added teacher Materials, Surveys, and Grading editors, AI targets, and a
  Proposal review surface with operation-level diffs, actionable/stale states,
  and repository read-only messaging.
- Applied migrations 106-111 to shared local after a verified backup and
  regenerated the database contract.
- Published draft PR #952 after rebasing onto current `main`. Independent
  security/migration and architecture/compatibility reviews found and the
  first remediation batch fixed external publication-state authority, stale
  classroom-source application, Version deletion cascades, concurrent proposal
  replay, strict v4 file validation, archive ownership classification for
  workflow-only classroom references, and current-main UI policy registration.
- Added a database-backed CI contract for two-connection proposal replay,
  source-classroom staleness, direct Version immutability, and Blueprint/user
  cascade deletion.
- Fixed the final CI integration issues: archive schema fixtures now include
  declared non-owning Blueprint workflow references, and classroom structural
  revision triggers honor the archive-restore transaction guard so a restored
  classroom exactly preserves its verified source revision.

**Validation:**
- Full Vitest suite: 437 files / 3,851 tests.
- Focused migration, Blueprint, Test, and assignment compatibility coverage:
  7 files / 64 tests.
- `pnpm run db:types:check`.
- `pnpm exec tsc --noEmit`.
- `pnpm lint`.
- `pnpm build` (valid `.next/BUILD_ID`).
- Pika audit.
- Playwright teacher desktop/mobile, light/dark, empty/populated, Materials,
  Grading, two-way Classroom Updates, and classroom-target proposal-detail
  captures; student route redirect capture.
- `git diff --check`.
- Local history through 111, identity/runtime preservation checks, and
  rollback-only Version, revision, proposal, and successor smokes.
- Rebased-head full suite, generated database-type parity, TypeScript, lint,
  build, UI/design policies, Pika audit, and the live versioned-Blueprint
  database contract.
- Exact local archive recovery rehearsal passed export, compaction,
  ownership-fenced source cleanup, exact row/object restore, and all
  idempotent replays.
- PR #952 review-head CI exposed archive fixture/recovery integration gaps;
  both failing paths pass locally after the final remediation.
- Pre-migration backup:
  `/Users/stew/Repos/.env/pika/backups/pika-local-pre-106-111-20260726T201121Z.dump`
  (SHA-256 verified).

**Remaining:**
- Publish the final remediation, run final independent exact-head review, and
  require exact-head CI before marking PR #952 ready. Leave it unmerged unless
  explicit merge authority is provided.

## 2026-07-27 — PR 951 rebase and hardening

**Risk profile:** high — privacy contract, service-role SQL, transactional
source writes, background delivery, and cross-repository integration.

**Completed:**
- Rebased `codex/pal-pilot` onto current `origin/main`; retained migration 111
  without a sequence collision and dropped duplicate adapter content already
  merged through PR 953.
- Hardened Pal's authoritative v1 contract on Pal PR 39 at commit
  `cd9fc872b646b8c91551fd44f9b4b36725ab0fe4`, then synchronized Pika's
  vendored validator and privacy fixtures. Event envelopes and metadata are
  both closed allow-lists.
- Made enabled configuration fail closed; restricted Pal to HTTPS origins
  (loopback HTTP only in development); required distinct 32-character minimum
  integration/pseudonym secrets; capped read tokens at ten minutes.
- Removed silent null-event fallbacks from authoritative learner transitions.
  Empty/format-only logs no longer qualify, while empty autosaves emit
  atomically when they first gain real content.
- Preserved journal mood/minutes and optimistic version checks across the
  Pal-enabled POST/PATCH transaction paths.
- Added bounded missed-week recovery (12 periods/run) and a deadline-aware
  outbox drain (20-row batches, concurrency 10, 10 batches/run) with remaining
  ready-row reporting.
- Added the CI-generated Pal tables/functions to
  `src/types/database.generated.ts` and replaced new Pal persistence `any`
  boundaries with the generated service-role client types.

**Validation:**
- Clean ephemeral Supabase replay confirmed migration 111 and generated types
  are exact; no local or hosted migration was applied.
- Focused hardening suite: 80/80 tests.
- TypeScript, lint, architecture, UI policy, Pika audit-equivalent committed
  diff scan, and `git diff --check` passed.
- Independent security and operability reviewers found the lease/budget and
  journal-field parity issues above; their remediation passes targeted review.

**Remaining:**
- Publish the final remediation commit and require exact-head CI plus final
  independent security confirmation.
- Keep PR 951 draft and `PAL_ENABLED=false`; the published native widget,
  authenticated vertical slice, and one-time human authorization for the
  named migration target remain rollout gates.

## 2026-07-27 — Versioned Blueprint residual hardening

**Risk profile:** runtime-platform — migration 111 trigger and proposal
application invariants.

**Completed:**
- Replaced trigger-depth authorization for Blueprint Version deletion with
  proof that the owning Blueprint or user is absent during an FK cascade.
- Made proposal application preserve Pika's current planned-site publication
  state at the SQL boundary.
- Added live database contracts for unrelated nested-trigger deletion,
  concurrent classroom-target proposal replay, and proposal attempts to
  publish or unpublish a planned site.
- Returned PR #952 to draft. The shared local database remains on the prior
  migration 111 definition pending fresh, explicit application permission.

**Validation:**
- Full Vitest suite: 438 files / 3,854 tests.
- Focused Blueprint migration/package/proposal/version tests: 4 files / 36
  tests.
- Isolated rollback-only PostgreSQL trigger simulation covering direct,
  unrelated nested, Blueprint-cascade, and user-cascade deletion.
- TypeScript, lint, build, database types, architecture/design/UI policies,
  Pika audit, shell syntax, session-log check, and `git diff --check`.

**Remaining:**
- Publish the draft revision and require ephemeral migration replay, the live
  versioned-Blueprint database contract, exact-head CI, and final review before
  marking PR #952 ready again.

## 2026-07-27 — PR 952 migration resequence

**Risk profile:** high — migration ordering and local-history drift.

**Completed:**
- Rebased PR #952 onto current `origin/main`, preserving Pal and Blueprint
  continuity entries.
- Resequenced the branch-only Blueprint migration from 111 to 112 after Pal
  claimed 111 on `main`; updated runtime errors, docs, and tests.
- Kept the shared local database untouched because its earlier Blueprint-as-111
  history requires separate reset or repair authorization.
- Compacted current AI context under the enforced startup budget.

**Validation:**
- Full Vitest suite: 451 files / 3,933 tests.
- Focused Blueprint/startup suite: 43 tests.
- TypeScript, lint, architecture, design/UI policy, audit, ShellCheck, Bash
  syntax, session-log validation, duplicate migration-prefix check, and diff
  checks pass.

**Remaining:**
- Build, commit, force-push with lease, and require fresh 001–112 CI replay,
  generated-type parity, database contracts, and exact-head review.

## 2026-07-27 — Local migration-history reconciliation

**Risk profile:** high — destructive local database reset.

**Completed:**
- Verified the feature worktree and local-only Supabase target, then confirmed
  the ledger collision: local 111 contained the earlier Blueprint draft while
  current 111 is Pal and Blueprint is 112.
- Created and checksum-verified a full custom-format PostgreSQL backup.
- With explicit authorization, reset only the local database without seed data
  and replayed migrations 001–112.

**Validation:**
- Local migration ledger matches Pal 111 and Blueprint 112; push dry-run is a
  no-op.
- Generated database types match.
- Live versioned-Blueprint database contract passed.
- Pal outbox and Blueprint Version objects exist.

**Remaining:**
- The rebuilt local database contains no users or seed data. Recover prior data
  only through a separately planned selective restore; a full restore would
  reintroduce the old migration history.

## 2026-07-28 — Submitted-requirement Blueprint capture fix

**Risk profile:** runtime-platform — submitted-work integrity trigger and
service-role Blueprint capture.

**Completed:**
- Diagnosed the production Codepet Labs capture failure as migration 099's
  requirement guard rejecting migration 112's stable identity-only update
  after assignment documents had been submitted.
- Added migration 113, which permits only service-role, transaction-marked
  updates where the three Blueprint lineage columns are the sole differences.
  Requirement ownership and pedagogical fields remain immutable.
- Added safe RPC diagnostics that log the database error code without database
  message, detail, or row content.
- Expanded the live versioned-Blueprint database contract to capture an
  assignment with one link requirement and four submitted documents, prove the
  documents remain byte-for-byte unchanged, verify lineage mapping, reject a
  forged authenticated marker, and reject service-role content changes.

**Validation:**
- Full Vitest suite: 452 files / 3,936 tests.
- Live local PostgreSQL contract passed twice consecutively with exact fixture
  cleanup.
- Production build, generated database types, lint, Bash syntax, focused
  migration/server tests, migration numbering, Pika audit, and diff checks
  passed.

**Remaining:**
- Publish and review the fix PR.
- Applying migration 113 to production requires a fresh one-time authorization
  naming production and migration 113; no production mutation was performed.

## 2026-07-29 — Minimal guidance design contract

**Risk profile:** none — documentation-only design guidance.

**Completed:**
- Added a canonical content-and-guidance contract to `DESIGN.md`.
- Established minimal default screens, contextual optional help, dismissible
  first-visit orientation, short search placeholders, and narrow exceptions for
  persistent explanatory copy.

**Validation:**
- Markdown diff review and `git diff --check`.

**Remaining:**
- Apply the contract incrementally when Blueprint and other product surfaces
  are deliberately revised.

## 2026-07-29 — Course Blueprint deletion control

**Risk profile:** none — teacher-owned Blueprint UI over the existing
ownership-checked deletion endpoint.

**Completed:**
- Added a destructive Course Blueprint action to the desktop action bar and
  mobile overflow menu.
- Added confirmation copy that distinguishes unlinked Blueprints from linked
  Blueprints, whose classrooms remain intact while their Blueprint connection
  is removed.
- Bound each confirmation to the exact loaded Blueprint and suppress deletion
  while a newly selected Blueprint is loading, preventing stale-detail deletion
  races.
- Hid deletion while repository authority is active and added the matching
  server-side 409 guard; teachers can switch authority back to Pika before
  deleting.
- Kept the Blueprint list, selected detail, route, and request cache consistent
  after deletion.
- Added component coverage for confirmation, endpoint invocation, cache
  invalidation, route cleanup, selecting the next Blueprint, stale selection,
  and repository authority. Added server coverage for the repository guard.

**Validation:**
- Full pre-review Vitest suite: 452 files / 3,937 tests.
- Post-review focused suite: 2 files / 23 tests.
- Production build, TypeScript, Pika audit, and diff checks passed.
- Visually verified desktop and mobile layouts, light and dark themes, default,
  overflow-menu, and confirmation states. The student role safely redirects
  away from the teacher-only route.
- Independent review identified and the implementation resolved the
  stale-detail deletion race and repository-authority bypass.

**Remaining:**
- Complete targeted re-review and exact-head CI, then merge and release the
  deletion control.
- Use the released control to remove the temporary production smoke Blueprint.

## 2026-07-29 — Archived classroom Use again foundation

**Risk profile:** reusable course lineage and archived-classroom UX.

**Completed:**
- Added a compact **Use again** action to hot archived classroom cards while
  preserving the separate Restore action and cold-archive recovery boundary.
- Compared reusable classroom content with its exact source Blueprint Version
  and current Draft, normalizing expected instantiation transformations.
- Reused the current Draft when safe, promoted classroom-only changes through
  the atomic proposal path, and routed concurrent classroom/Draft changes to
  review without silently choosing a side.
- Created and linked a Pika-managed Blueprint copy for legacy archived
  classrooms with no lineage; no student or runtime data enters the copy.
- Opened normal classroom creation with the prepared Blueprint selected and
  added a direct review handoff to Classroom Updates.
- Documented the archive and Blueprint-version contracts for the flow.

**Validation:**
- Full Vitest suite: 454 files / 3,948 tests.
- Focused final suites: 5 files / 50 tests, plus copy-only Blueprint coverage.
- TypeScript, lint, production build, Pika audit, and diff checks.
- Playwright teacher matrix: desktop/mobile and light/dark for the archived
  card and conflict dialog. Student classrooms were checked and are unaffected.
- Composite-widget checklist reviewed; existing ConfirmDialog keyboard/focus
  behavior and semantic roles are covered, with no manual follow-up.

**Remaining:**
- Publish for independent review and exact-head CI before merge.
- A later slice can replace the advanced Classroom Updates conflict handoff
  with a more guided normal-user reconciliation surface.

## 2026-07-29 — Archived classroom Use again review remediation

**Risk profile:** high — concurrent Blueprint graph creation and archived
classroom lineage.

**Completed:**
- Added migration 114 with a classroom-row transaction fence so unlinked
  archived capture and lineage linking commit together; concurrent or
  crash/retry requests reuse one linked Blueprint.
- Added an archive-specific proposal finalizer that locks and rechecks the hot
  archive before changing the Blueprint, then saves the resulting immutable
  Version and advances source provenance in the same transaction.
- Made simultaneous classroom and Draft changes require review even when both
  sides independently reached matching current content.
- Replaced current-calendar lesson inference with persisted lesson artifact
  lineage, preventing overflow templates from becoming false deletions after
  calendar edits.
- Included reusable public-site visibility defaults in capture, comparison,
  suggestions, and promotion while excluding operational slug/publication
  state.
- Completed root and nested artifact lineage mapping for both initial archived
  capture and later promotion, including exact source Version IDs.
- Made initial Version hashing match Pika's recursive canonical JSON and pass
  the canonical result digest from TypeScript for promoted Versions.
- Regenerated the Supabase function contracts for all migration 114 RPCs and
  internal helpers after CI applied the migration successfully.

**Validation:**
- Focused suites: 6 files / 57 tests.
- Full Vitest suite: 455 files / 3,956 tests.
- TypeScript, lint, production build, migration contract, and diff checks pass.
- Post-review lineage/digest suites: 6 files / 47 tests; TypeScript and lint
  pass.

**Remaining:**
- Run Pika audit, complete targeted re-review and exact-head CI.
- Migration 114 requires explicit target authorization before application.

## 2026-07-30 — Simplify GitHub Actions usage

**Risk profile:** runtime-platform.

**Completed:**
- Changed comprehensive CI to run for pull requests to `main` and `production`
  or by manual dispatch, removing duplicate post-merge branch runs.
- Added per-PR concurrency so newer commits cancel stale CI runs.
- Folded UI import, design-value, and dark-class policies into the required
  Test & Build job and retired the separate UI Policy workflow.
- Limited coverage artifact uploads to failed Test & Build jobs.
- Added workflow contract coverage and updated the existing policy tests to
  prove the consolidated CI wiring.
- Enabled strict up-to-date required status checks in the active `main` and
  `production` GitHub rulesets while preserving the required Test & Build
  context and existing review rules.

**Validation:**
- `actionlint .github/workflows/ci.yml`.
- Architecture, UI policy, design policy, dark-class, lint, and production
  build checks pass.
- Full coverage suite: 456 files / 3,960 tests.
- New and updated workflow contract suites: 3 files / 23 tests.

**Remaining:**
- Publish the branch and confirm the real pull-request CI run on GitHub.

## 2026-07-30 — Hot archived classroom permanent deletion

**Risk profile:** critical — irreversible classroom-wide relational and managed-storage deletion.

**Completed:**
- Audited the full 40-table classroom ownership graph, archive/restore/compaction operations,
  grading and Blueprint workflows, managed storage buckets, Blueprint lineage, and the narrower
  roster-removal contract before implementation.
- Added migration 115 with an exact row-membership snapshot, cross-workflow advisory/write fence,
  sealed storage inventory, retryable per-object leases, shared-reference preservation, explicit
  archive/Gradex/cleanup reconciliation, and atomic child-first relational finalization.
- Preserved Course Blueprints, immutable Blueprint Versions, and user accounts; non-owning
  classroom workflow references are explicitly reconciled.
- Added owner-only impact/start/status/tick APIs, a daily authenticated safety-net worker, and a
  teacher confirmation dialog requiring the exact classroom name or `DELETE`.
- Limited the UI and database contract to hot archived classrooms. Cold archived classroom
  deletion and comprehensive individual-student purging remain explicit follow-up scopes.
- Added concurrency, partial-failure, authorization, exact storage cleanup, retry, confirmation,
  keyboard/focus, and teacher/student boundary coverage.

**Validation:**
- Full Vitest suite after the initial implementation: 458 files / 3,977 tests.
- Final focused suites: 5 files / 58 tests.
- TypeScript, lint, production build, feature inventory validation, diff checks, and Pika audit pass.
- Playwright matrix: teacher and student, desktop and mobile, light and dark; 10/10 checks pass.
- Composite-widget checklist reviewed: keyboard behavior and semantic dialog state are covered;
  no manual accessibility follow-up remains.
- With exact one-time authorization, migrations
  `114_atomic_archived_classroom_blueprint_reuse.sql` and
  `115_hot_archived_classroom_purge.sql` were applied successfully to local Supabase. Migration
  history records both through 115, generated database types match the applied local schema, and
  the focused 5-file / 58-test suite plus TypeScript and diff checks pass after application.
- With separate exact one-time production authorization, the dedicated worktree was linked to the
  same production Pika Supabase project verified from the hub and migration
  `115_hot_archived_classroom_purge.sql` was applied successfully. Post-apply migration history
  aligns through 115 and a linked dry run reports that production is up to date. No classroom purge,
  data cleanup, or Storage deletion was executed.
- The real local fixture exposed ambiguous download-based Storage absence responses and existing
  submitted-work integrity triggers that blocked the fenced finalizer. Storage verification now
  uses an exact directory listing, and migration
  `116_hot_archived_classroom_purge_trigger_reconciliation.sql` scopes the existing integrity and
  cleanup triggers away from the transaction-local purge finalizer without weakening normal writes.
- With exact one-time local authorization, migration 116 applied successfully. A purpose-built
  hot-archived classroom fixture then deleted 11 relational rows and one object from each of
  `assignment-artifacts`, `submission-images`, `test-documents`, `classroom-archives`, and
  `gradex-analytics-extracts`; preserved the reusable Blueprint and teacher/student accounts; and
  cleaned all generated fixture rows and Storage paths.
- With fresh exact one-time production authorization, migration
  `116_hot_archived_classroom_purge_trigger_reconciliation.sql` applied successfully. After one
  retryable Supabase API 502 during verification, migration history aligned through 116 and a
  linked dry run reported the production database up to date. No application deployment,
  classroom purge, data cleanup, or Storage deletion was executed.
- PR #963's database-backed ownership audit identified the temporary purge fence as an undeclared
  classroom foreign-key descendant. Classified that edge as a non-owning workflow reference,
  added drift regression coverage, and documented the redacted minimal terminal audit ledger.
  The exact local schema audit now passes across 144 foreign-key relationships; 36 focused tests,
  TypeScript, lint, diff checks, and the Pika audit pass.
- Independent security and architecture review found cleanup-only archive/Gradex objects, a
  shared-reference writer race, bounded Storage absence checks, raw preserved-object paths in the
  terminal ledger, and an API route-identity ordering issue. Migration
  `117_hot_archived_classroom_purge_review_hardening.sql` and its application changes now inventory
  interrupted cleanup objects, reserve shared-path writers, recheck references before deletion,
  paginate absence verification, redact preserved paths, and validate classroom ownership before
  ticking an operation.
- With exact one-time local authorization, migration 117 applied successfully and generated
  database types match the local schema. The expanded destructive fixture deleted 11 relational
  rows and seven managed files, preserved one Blueprint-shared file plus the reusable Blueprint and
  user accounts, and proved writer reservation. The 144-relationship schema audit, TypeScript,
  lint, production build, Pika audit, 3,995 non-flaky full-suite tests, the isolated rerun of one
  timing-sensitive UI test, and the 26-case teacher/student desktop/mobile Playwright matrix pass.
- Targeted security re-review found that the reservation ended after Storage deletion but before
  relational finalization and that external archive/Gradex path writers did not join the global
  barrier. Migration `118_hot_archived_classroom_purge_reservation_lifetime.sql` retains deleted
  paths as active reservations until the atomic completion transition, enrolls all external
  operational path writers, fails closed on unreservable active deleted rows, and redacts paths at
  completion.
- With fresh exact one-time local authorization, migration 118 applied successfully and local
  history/types align through 118. The destructive fixture now also proves a Blueprint write remains
  blocked after object deletion and another classroom's archive operation cannot acquire the
  reserved path. The fixture, 144-relationship schema audit, 27 focused tests, TypeScript, lint,
  generated-type check, diff check, and Pika audit pass.
- Final integration review found representation-sensitive matching for URL-encoded or JSON-escaped
  managed paths. With explicit authorization for one extra remediation batch, migration
  `119_hot_archived_classroom_purge_canonical_path_matching.sql` now compares decoded JSON scalar
  strings and once-percent-decoded URL values in both sharing scans and writer reservations.
- With fresh exact one-time local authorization, migration 119 applied successfully and local
  history/types align through 119. The real Storage fixture uses accepted space-containing keys to
  prove encoded shared-path preservation and encoded reserved-path rejection; it deletes eight
  managed files, preserves two shared files plus the Blueprint and accounts, and redacts every
  terminal path. The fixture, 144-relationship schema audit, 32 focused tests, TypeScript, lint,
  generated-type check, diff check, and Pika audit pass.
- Targeted security review found that invalid `%FF` or `%00` escapes elsewhere in one markdown
  field could poison migration 119's whole-field compatibility decode. With explicit authorization
  for one further remediation batch, migration
  `120_hot_archived_classroom_purge_isolated_url_matching.sql` now compares a canonically encoded
  path against normalized field text without decoding it and limits decoding to isolated URLs.
- With fresh exact one-time local authorization, migration 120 applied successfully and local
  history/types align through 120. The real Storage fixture proves poisoned-field encoded sharing
  and reservation behavior while still deleting eight files, preserving two shared files plus the
  Blueprint/accounts, and redacting terminal paths. The fixture, 144-relationship schema audit,
  37 focused tests, TypeScript, lint, generated-type check, diff check, and Pika audit pass.
- Targeted security review found that malformed query or fragment escapes could still poison
  compatibility decoding of one target URL whose pathname used an equivalent noncanonical escape.
  With explicit authorization for one additional remediation batch, migration
  `121_hot_archived_classroom_purge_url_path_isolation.sql` strips query and fragment before
  pathname decoding.
- With fresh exact one-time local authorization, migration 121 applied successfully and local
  history/types align through 121. The real Storage fixture proves `%61` pathname preservation with
  a poisoned fragment and `%2F` reservation rejection with a poisoned query while retaining all
  prior deletion and preservation invariants. The fixture, 144-relationship schema audit, 40
  focused tests, TypeScript, lint, generated-type check, diff check, and Pika audit pass.
- Because production remains at 116, exact authorization was granted to consolidate all unshipped
  hardening from local migrations 117-121 into one migration 117 and reset/reseed local Supabase.
  The consolidated migration also aligns database matching with application WHATWG special-URL
  behavior for case-insensitive schemes, backslashes, and dot segments. Files 118-121 were removed.
- Consolidated migration replay exposed two statement-ordering defects left by the mechanical
  merge; each failed 117 transaction rolled back cleanly. Migration 117 now defines canonical
  matchers, the reservation trigger function, trigger installation, revocation, and comments in
  dependency order, with a static ordering regression. A final authorized local-only push applied
  only migration 117, local history and generated types align through 117, and `pnpm seed`
  completed against the verified loopback target.
- The final consolidated destructive fixture deleted 11 classroom-owned relational rows and eight
  managed files while preserving two shared files, the reusable Course Blueprint, and teacher and
  student accounts. The 144-relationship database audit, 44 focused migration tests, full
  465-file / 4,019-test suite, TypeScript, lint, production build, generated-type check, diff
  checks, and Pika audit pass.

**Remaining:**
- Production migration history is aligned through 116. Consolidated migration 117 is a hard
  deployment prerequisite and has not been authorized or applied outside local Supabase.
- The application feature is still only in draft PR #963 and has not been deployed. No staging
  migration, production migration 117, application deployment, classroom purge, or Storage
  deletion is authorized by the consumed local migration permission.

## 2026-07-31 — Tightened commit prompt worktree guardrails

**Risk profile:** none

**Completed:**
- Added the missing repo-root guard to the Codex `commit-and-pr` prompt so it
  now resolves `git rev-parse --show-toplevel` and stops in the hub checkout at
  `$HOME/Repos/pika` before any commit/push flow.
- Extended the startup-doc regression suite to require both the Claude and
  Codex commit prompts to include the canonical worktree safety checks:
  repo-root resolution, hub-checkout stop, detached-HEAD stop, and no
  force-push guidance.
- Installed local dependencies in this app-managed worktree so the focused
  startup-doc suite could run here.

**Validation:**
- `pnpm vitest run tests/unit/ai-startup-docs.test.ts`
- `git diff --check`

**Remaining:**
- None.

## 2026-07-31 — Replaced inferred file sharing with explicit managed ownership

**Risk profile:** destructive-data, authorization, storage, concurrency, archive/restore, Blueprint lineage, UI

**Completed:**
- Reworked unshipped migration 117 around an exact `(bucket, path)` registry in which each source
  object has one classroom or Course Blueprint lifecycle owner; user ids are attribution only.
- Added fail-closed ownership coverage, legacy global backfill, Storage write/delete enforcement,
  leased cleanup, permanent purge reservations, exact database absence checks, and two operator
  gates that default off.
- Converted assignment artifacts, inline student images, teacher test uploads, and execution
  snapshots to reserve-before-upload/adopt-after-upload ownership. Link snapshots now run only on
  explicit sync or test activation, not while browsing authoring/preview screens.
- Added durable verified physical copies from classrooms to Blueprints and from Blueprints to new
  classrooms, atomic document ownership rewrites, explicit Blueprint file deletion, package-id
  stripping, and exact archive/restore managed-object manifests.
- Replaced purge URL/JSON inference with verified exact classroom ownership plus archive, Gradex,
  and interrupted-cleanup ledgers. Course Blueprints and users remain outside purge membership.
- Added cleanup, copy, backfill, upload, partial-failure, retry, authorization, archive/restore,
  confirmation, focus, and rollout-gate regressions. Updated lifecycle rollout guidance.

**Validation:**
- Full Vitest suite: 465 files / 4,009 tests; TypeScript, lint, production build, SQLFluff
  PostgreSQL parse, diff checks, and Pika audit pass.
- Playwright verification passes for teacher available/blocked dialogs on desktop/mobile and
  light/dark, plus student desktop/mobile boundaries with no deletion control.
- Migration 117 was not applied or replayed. Local runtime still lacks the new managed ownership
  tables, proving this session did not consume migration authorization. Generated database types
  therefore remain intentionally unchanged.

**Remaining:**
- Keep PR #963 draft. A fresh exact authorization is required before applying migration 117 even
  locally; only then regenerate database types and run the destructive exact-ownership fixture.
- Deployment, rollout gates, cleanup worker enablement, production migration 117, cold archived
  classroom deletion, and comprehensive individual-student purging remain out of scope.

## 2026-07-31 — Added managed-storage rollout readiness and exact purge fixture coverage

**Risk profile:** destructive-data, authorization, storage ownership, concurrency, operator rollout

**Completed:**
- Rebuilt the local purge fixture around explicit classroom-owned managed objects and independent
  Course Blueprint physical copies. It now exercises managed-cleanup claim exclusion, failure and
  retry, exact purge retry, concurrent purge ticks, wrong-teacher rejection, unreserved-write and
  permanent-path fencing, physical deletion/preservation, ownership reconciliation, and terminal
  path/lease/error redaction. Both database rollout gates are reset to false in an outer `finally`.
- Added `pnpm managed-storage:readiness`, a report/dry-run-by-default all-class operator command. It
  binds hosted API and database targets to one project ref, requires separate production/local
  execution opt-ins, a clean production commit and exact acknowledgement, refuses execution while
  either rollout gate is enabled, supports idempotent resume, reports coverage and global orphans,
  and never changes either gate.
- Redacted readiness findings to bucket names plus SHA-256 path fingerprints; raw Storage paths stay
  internal to the in-memory comparison and require separately authorized database investigation.
- Exported the backfill's exact candidate collector so readiness analysis and writes cover identical
  artifact, inline-image, teacher-material, snapshot, and legacy references. Added expected revision
  evidence, an all-class preflight before the first write, per-class before/after checks, and a final
  operator recheck so stale resources cannot be verified against a newer revision.
- Added focused operator/backfill regressions, CI report-mode coverage, and rollout runbook guidance.

**Validation:**
- ESLint passed for all touched TypeScript; 9 focused Vitest regressions passed; full TypeScript
  checking and `git diff --check` passed.
- A read-only local readiness smoke reached the connected Supabase target and failed closed because
  that running instance does not have migration 117. No migration was applied, no rollout gate was
  enabled, and the destructive fixture was not run against an incompatible database.

**Remaining:**
- Migration 117 still requires fresh named authorization before any local or hosted application.
  After an authorized replay, run the CI-wired report and destructive fixture against that exact
  schema; production execution and every rollout-gate change remain separately authorized actions.

## 2026-07-31 — Closed managed-ownership deletion review findings

**Risk profile:** destructive-data, schema mismatch, backfill correctness, storage, concurrency,
archive/restore, Blueprint lineage

**Model recommendation:** GPT-5.6 Sol - the review crosses immutable Blueprint lineage, resumable
Storage copies, cold-compaction transactions, exact ownership backfill, and destructive purge
authorization boundaries.

**Completed:**
- Rebasing draft PR #963 onto `origin/main` preserved migration numbering at 115–117 and resolved
  the continuity-log conflict without touching migration targets.
- Fixed Blueprint instantiation copy adoption to validate `source_blueprint_id`; copy-bearing
  operations now remain running until adoption, resume before replay, keep historical Versions
  immutable and free of classroom-owned file references, append a final adopted Version, and relink
  classroom artifact lineage to it.
- Made course packages fail closed before Version/session creation when uploaded Pika-managed Test
  documents cannot be portable; imports reject current-project managed URLs instead of retaining a
  dangling URL after ownership ids are stripped.
- Added explicit cold tombstone/archive file ownership and coverage. Verified hot ownership moves
  atomically during compaction, source cleanup decrements cold coverage, and restore releases cold
  sources only after exact replacement objects exist. Migration 085's rolled-back delete preflight
  uses immediate-by-default deferred FKs scoped to the exact compaction operation; ordinary and
  cold deletion remain blocked.
- Bound restore and compaction lifecycle triggers to the exact wrapper operation id, kept legacy
  Test ownership attachment revision-neutral, added a report/dry-run-by-default all-class readiness
  command with stable revisions and hashed path evidence, and rebuilt the local purge fixture around
  independent classroom and Blueprint physical copies.
- Fixed the first ephemeral migration replay failure by loading the Test row and deriving its
  classroom id separately instead of using a PostgreSQL record variable in a multi-target `INTO`.
- Replayed migrations 001–117 successfully in exact-head GitHub CI, then reconciled the checked-in
  generated database types from that disposable CI schema without applying migration 117 to any
  persistent local, hosted, or production database.
- Reconciled the existing database fixtures with the intentional managed-coverage deletion fence;
  qualified deferred ownership constraints for the empty-search-path compaction RPC; made coverage
  initialization idempotent across rolled-back dry runs; and registered the compaction fixture's
  physical source object so hot-to-cold ownership is exercised instead of bypassed.
- Restored canonical Storage-path validation on archive cleanup completion and made the fixture
  follow the production worker contract: claim the reserved source, physically delete it, then
  complete ledger reconciliation. Completion continues to fail closed while the object exists.
- Made cold compaction and restore trigger context checks null-safe, so an absent optional
  maintenance setting is treated as an ordinary lifecycle change rather than accidentally entering
  privileged maintenance logic.
- Kept shared database fixtures compatible with pre-117 schema replays by conditionally cleaning
  managed coverage and registering/verifying managed objects only when those contracts exist. The
  disposable legacy Quiz/archive compatibility rehearsal now passes through compaction again.
- Made the destructive purge fixture self-contained: it creates its own non-owner teacher for
  authorization checks, verifies the owner, non-owner, and student accounts all survive deletion,
  and removes only the fixture-owned probe account during teardown.
- Added an early exact purge-fence check to the server start path. A competing operation now returns
  `classroom_purge_active` before rebuilding an inventory that the running purge is mutating, while
  a replay with the same operation id resumes through the durable tick path.
- Restored terminal purge-ledger path redaction in migration 117's rewritten completion RPC. Deleted
  rows retain only their hashed identity and audit timestamps; raw paths, leases, and retry errors
  are cleared.
- Updated the full archive-recovery drill to create its fixture file through the managed upload
  reservation/adoption contract while the classroom is active, archive only after fixture writes,
  and verify exact revision-bound coverage before compaction. Fixture teardown now reconciles both
  hot and cold managed ownership before deleting physical test objects and relational rows.

**Validation:**
- Full Vitest suite: 466 files / 4,025 tests; production build; TypeScript; lint; architecture;
  design/UI policies; PostgreSQL SQLFluff parse; `git diff --check`; Pika audit.
- Focused final lifecycle regression: 49 tests covering migration contract, compaction, and restore.
- Migration 117 was not applied to any persistent local or hosted target. GitHub CI replayed it only
  in its disposable database; no rollout gate, Storage object, or production environment was
  modified.
- Exact-head CI iterations cleared schema replay, generated-type drift, atomic grading/submission,
  Blueprint, and archive lifecycle contracts before reaching the hardened compaction cleanup flow.

**Remaining:**
- Keep PR #963 draft. Fresh named local authorization is required before replaying migration 117 or
  running the destructive exact-ownership fixture. Hosted migration, backfill execution, orphan
  remediation, gate changes, canaries, and deployment remain separately authorized actions.

## 2026-07-31 — Completed explicit managed-file ownership architecture

**Risk profile:** destructive-data, storage ownership, concurrency, immutable Blueprint lineage,
zero-downtime rollout

**Completed:**
- Replaced client URL/file-id authority with exact managed ownership claims for assignment images,
  Test uploads/snapshots, and Blueprint Version material. Database wrappers lock and revalidate the
  exact owner, bucket, path, purpose, status, and immutable snapshot URL before committing writes.
- Made Test document replacement and removed-file cleanup one compare-and-swap transaction. A
  standalone cleanup caller also locks the Test and refuses to queue an object that is currently
  referenced, closing remove/re-add and cleanup/purge races.
- Added durable reconciliation for the supported legacy case where one Classroom and one
  same-teacher Blueprint share a physical Test document. Copy/adoption preserves immutable Versions,
  rewrites live owners atomically, protects nonterminal ledgers with restrictive lifecycle guards,
  and removes the ledger only after terminal adoption.
- Added fail-closed Blueprint-only legacy registration and readiness discovery across mutable
  assessments and immutable Versions. Ambiguous cross-Classroom or cross-Blueprint sharing remains
  blocked for operator investigation.
- Preserved immutable Version files until Blueprint deletion and made Version creation use a managed
  transactional RPC; the compatibility Version signature rejects upload-bearing snapshots.
- Made legacy assignment RPC compatibility safe during staged rollout: a stale write takes the
  classroom lifecycle lock and invalidates verified coverage while enforcement is off, then fails
  closed after enforcement is enabled. Private legacy implementations are not callable by the
  service role.
- Added the permanent-ledger Storage identity index and preserved non-retryable relational finalizer
  outcomes.

**Validation:**
- Independent final architecture and security reviews found no remaining blockers.
- Final full Vitest suite: 467 files / 4,053 tests; lint; TypeScript; production build;
  `git diff --check`; Pika audit.
- UI verification captured teacher desktop/mobile and student desktop/mobile classroom views. The
  managed image change is serialization-only and produced no visible regression or role-boundary
  leak. Composite-widget accessibility checklist reviewed; keyboard and semantic behavior remain
  covered by existing editor tests.
- Reset local Supabase, replayed migrations 001–116, fixed a PostgreSQL parser error exposed by the
  first migration-117 replay, applied the corrected migration 117 locally, and completed `pnpm seed`.
  Verified both rollout gates remain false, the managed Version/Test RPCs exist, and migrations
  001–117 are recorded locally. No hosted target, worker, canary, deployment, commit, push, or PR
  state was changed.

**Remaining:**
- Keep PR #963 draft. Readiness execution, worker/gate activation, canary, hosted rollout, and
  deployment each still require their own fresh named authorization.
- Cold archived classroom deletion and comprehensive individual-student purging remain follow-up
  scopes; ambiguous legacy sharing remains a fail-closed manual reconciliation case.

## 2026-07-31 — Proved managed ownership and purge end to end locally

**Risk profile:** workspace-state, destructive local fixture, storage ownership, concurrency

**Completed:**
- Confirmed the dedicated worktree, migration history 001–117, and local rollout settings
  `enforce_ownership=false` and `hot_classroom_purge_enabled=false`.
- Ran the read-only managed-storage readiness report against loopback Supabase. The seeded
  classroom was verified with no missing coverage, shared paths, missing objects, registered
  drift, Blueprint reconciliation work, or global Storage orphans.
- Ran managed-storage readiness `execute` locally. It completed idempotently, left both rollout
  gates unchanged, and reported `ready_for_enforcement=true`.
- Ran the guarded destructive local purge fixture. It deleted exactly eight synthetic
  classroom/operational objects across all five required buckets, preserved two independently
  Blueprint-owned copies and all user accounts, and proved cleanup retry, purge retry,
  concurrent-claim exclusion, competing-purge exclusion, cross-teacher authorization, exact-path
  fencing, relational cleanup, and terminal path/lease/error redaction.
- Verified fixture teardown: no fixture users or Storage objects remain, no purge is active, the
  original seed remains, both gates are false, and a post-fixture readiness report is still clean.
- Regenerated `src/types/database.generated.ts` from the exact local 001–117 schema after the
  contract check exposed missing reconciliation and managed-write RPCs.

**Validation:**
- Local runtime: readiness report, readiness execute, destructive purge fixture, teardown audit,
  and post-fixture readiness report passed.
- Focused ownership/purge suite: 17 files / 134 tests.
- Full Vitest suite: 467 files / 4,053 tests.
- Production build, lint, TypeScript, architecture boundaries, generated database contract,
  `git diff --check`, and Pika audit passed.
- PR #963 remains open and draft. No hosted database, rollout gate, worker, deployment, commit,
  push, or production state changed.

**Remaining:**
- Keep production and persistent rollout gates disabled. Hosted migration/backfill, cleanup-worker
  activation, ownership enforcement, named canary, application purge enablement, deployment, and
  PR publication each require separate authorization.
- Cold archived classroom deletion and comprehensive individual-student purging remain follow-up
  scopes; ambiguous legacy sharing remains fail-closed/manual.

## 2026-07-31 — Published PR #963 hardening and fixed review blockers

**Risk profile:** migration, destructive-data, storage race, rollout rollback, CI contract

**Completed:**
- Committed and pushed the locally verified managed-ownership redesign to draft PR #963 at
  `7338a79a`, and corrected the PR description to distinguish local migration/fixture evidence
  from untouched production state.
- Classified the transient legacy Classroom/Blueprint reconciliation ledger as a non-owning
  Classroom workflow reference, fixing the current-head schema ownership audit without adding it
  to classroom archive or purge payload membership.
- Extended permanent purge reservations to reject exact-key writes in all five purge buckets,
  including classroom archives and Gradex extracts, before the managed-source-bucket early return.
  Finalization now checks reappearance by retained bucket/path hash after raw path redaction.
- Made both rollout gates an authoritative emergency stop for active operations: no new purge
  object lease or relational finalization occurs while either gate is off. An already-issued lease
  may still record authoritative deletion completion so retry evidence remains coherent.
- Serialized begin, claim, and finalization with gate updates by taking the singleton settings row
  `FOR SHARE` before destructive locks. A gate disable that commits first is observed by the RPC;
  one that starts later waits until the already-authorized transaction commits.
- Extended the database-backed purge fixture to disable each gate mid-operation and prove no
  progress, then resume after re-enable. It also completes and redacts one object from each
  operational bucket and proves exact-path recreation is rejected before finalization. Dedicated
  concurrent PostgreSQL sessions also prove claim/finalizer decisions hold the settings lock and
  prevent a gate update from committing through them.

**Validation:**
- Initial independent review: architecture/compatibility reviewer found no blocker; security
  reviewer found the two accepted storage-race and emergency-stop blockers fixed above. The first
  targeted re-review exposed the accepted missing settings-row serialization, fixed in the second
  remediation batch.
- Current-head CI before remediation: Test & Build and Browser Experience Matrix passed;
  Architecture Database Contracts exposed the accepted non-owning-reference omission.
- Local schema ownership audit passes with 165 foreign-key relationships.
- Focused remediation suite: 4 files / 50 tests; TypeScript, lint, architecture boundaries,
  SQLFluff PostgreSQL parse, and `git diff --check` pass.

**Remaining:**
- Push the second remediation batch, require current-head CI (including the database-backed purge
  fixture), and run one final targeted security re-review before considering the draft review complete.
- Do not merge, deploy, apply migration 117 to a hosted target, or change any production gate.

## 2026-07-31 — Strengthened purge gate concurrency evidence

**Risk profile:** destructive-data fixture, PostgreSQL concurrency, rollout rollback

**Completed:**
- Replaced the purge fixture's timing-sensitive lock-timeout inference with an exact PostgreSQL
  blocker handshake: it captures the holder and updater backend PIDs, waits for the updater's
  `Lock` wait state, verifies `pg_blocking_pids` names that exact holder, and then releases the
  holder through controlled cancellation and transaction rollback.
- Added database-backed coverage proving `begin_hot_archived_classroom_purge` serializes with a
  concurrent gate update, alongside the existing claim and finalizer scenarios.
- Added the exact claim -> physical deletion -> committed gate disable -> completion scenario and
  asserted the already-issued lease records durable deletion with raw-path redaction while both
  gates are disabled.
- Added static lock-order assertions proving begin and claim acquire the settings row before their
  classroom, operation, and purge-object locks.

**Validation:**
- Focused migration suites: 2 files / 35 tests.
- TypeScript, targeted ESLint, `git diff --check`, and Pika audit pass.

**Remaining:**
- Require current-head CI to replay migration 117 and run the destructive fixture against an
  ephemeral Supabase instance, then use the final targeted reviewer slot.
- Keep PR #963 draft. Do not merge, deploy, apply migration 117 to a hosted target, or change any
  production gate.

## 2026-07-31 — Made mismatched Blueprint file copies self-recovering

**Risk profile:** runtime-platform, destructive storage cleanup, migration contract

**Completed:**
- Fixed the draft PR review blocker where a mismatched deterministic Blueprint-copy target could
  remain unowned, retry forever, and keep the source classroom permanently blocked from purge.
- Reused the existing durable copy lease instead of adding another ledger or migration: the worker
  removes only the exact operation-owned target, then migration 117 resets the item for immediate
  retry only after locking the path and confirming authoritative `storage.objects` absence.
- Kept failures resumable across Storage removal errors, lost leases, and crashes before or after
  deletion; the normal expired-lease claim path remains the recovery mechanism.
- Added application and migration-contract regressions for successful mismatch recovery, failed
  Storage cleanup, lost cleanup leases, exact-path locking, and catalog absence verification.

**Validation:**
- Pika audit, architecture boundaries, lint, production build/type validation, and
  `git diff --check` pass.
- Focused purge and Blueprint suite: 4 files / 42 tests pass; the narrower recovery suite now has
  5 worker tests and 28 migration-contract tests.

**Remaining:**
- Push the fix to draft PR #963 and require current-head CI to replay migration 117 in the
  ephemeral database before the review blocker is considered closed.
- No migration was applied. Keep production, deletion, and both persistent rollout gates disabled.

## 2026-08-01 — Fenced Blueprint mismatch cleanup before Storage removal

**Risk profile:** runtime-platform, Storage concurrency, migration contract

**Completed:**
- Reworked deterministic Blueprint copy mismatch recovery so the active copy lease must first
  transition into a durable cleanup phase before any Storage removal. Expired cleanup leases remain
  cleanup-only work and cannot silently become upload leases.
- Fenced stale Storage writes while cleanup owns a target, required exact-path locking and physical
  presence before normal and legacy copy completion/adoption, and retained authoritative absence
  verification before returning a target to copy retry.
- Applied the same recovery contract to mandatory legacy Blueprint/Classroom reconciliation so a
  mismatched pre-existing target no longer blocks readiness forever.
- Added replacement-worker, lost-lease, cleanup-reclaim, removal-failure, retry, and adoption-safety
  regressions for both copy paths.

**Validation:**
- Full Vitest suite: 467 files / 4,063 tests pass.
- Focused final suite: 3 files / 42 tests pass.
- Supabase generated-type check, TypeScript, lint, architecture boundaries, Pika audit, production
  build, and `git diff --check` pass.

**Remaining:**
- Push the fix to draft PR #963 and require current-head CI to replay migration 117 in an ephemeral
  database before considering the concurrency blockers closed.
- No migration was applied. Keep production deletion and all rollout gates disabled.

## 2026-08-01 — Redesigned purge around enforceable ownership

**Risk profile:** migration, destructive-data, authorization, storage concurrency, UI

**Completed:**
- Reworked hot archived classroom deletion around one stable classroom scope, structural
  relational ownership, and a managed-object registry spanning assignment artifacts,
  submission images, test documents, classroom archives, and Gradex extracts.
- Made managed object identity immutable, retained exact-object deletion leases and retry
  evidence, and reconciled legacy cleanup ledgers through durable managed-object delegation.
- Canonicalized lifecycle fencing and lock ordering across purge, archive, restore, grading,
  and Blueprint workflows while preserving Course Blueprints and user accounts.
- Added the ownership contract, readiness/resource audits, destructive-fixture assertions,
  deletion-authority tests, and a unique-student impact count.
- Visually verified teacher desktop/mobile, light/dark confirmation, active/cold exclusions,
  and student boundaries; corrected the mobile dialog footer so both actions stay visible.

**Validation:**
- Full Vitest suite: 468 files / 4,078 tests pass.
- TypeScript, lint, Pika audit, `git diff --check`, and PostgreSQL SQLFluff parsing pass.
- Persistent local rollout gates remain disabled. No migration was applied or replayed.

**Remaining:**
- Publish this redesign as a fast-forward update to draft PR #963 and require current-head CI.
- Migration 117's redesigned source still needs a separately authorized local replay before the
  readiness/backfill and destructive database fixture can be treated as current evidence.
- Do not merge, deploy, enable deletion, or apply migration 117 to production.

## 2026-08-01 — Corrected managed-upload migration parsing

**Risk profile:** migration, CI contract

**Completed:**
- Parenthesized both `CASE` expressions inside the managed-upload PL/pgSQL `IF` condition after
  ephemeral CI replay exposed PostgreSQL stopping at the nested `THEN` token.
- Added a migration-contract regression that preserves the parser-safe form for both archive and
  Gradex operational upload validation.

**Validation:**
- The exact `begin_managed_storage_upload` function compiles in PostgreSQL inside an explicit
  transaction that is rolled back.
- Focused migration suite: 1 file / 34 tests passes.
- TypeScript, Pika audit, `git diff --check`, and full PostgreSQL SQLFluff parsing pass.
- No migration was applied or replayed; production and all persistent rollout gates are unchanged.

**Remaining:**
- Push the focused correction to draft PR #963 and require green current-head CI.
- Keep migration 117 and destructive local fixture separately authorization-gated.

## 2026-08-02 — Corrected purge worker composite reads

**Risk profile:** migration, destructive-data worker, CI contract

**Completed:**
- Replaced the two invalid PL/pgSQL record-plus-scalar `INTO` lists in purge object completion
  and failure with a single candidate record followed by explicit typed assignments.
- Preserved teacher filtering, operation identity, lifecycle lock ordering, managed-owner fencing,
  lease validation, and exact-path locking.
- Audited migration 117 for the defect class; these were the only composite-row occurrences.

**Validation:**
- Both exact functions compile in PostgreSQL inside an explicit transaction that is rolled back.
- Focused migration suite: 1 file / 35 tests passes.
- TypeScript, Pika audit, `git diff --check`, and full PostgreSQL SQLFluff parsing pass.
- No migration was applied or replayed; production and all persistent rollout gates are unchanged.

**Remaining:**
- Push this second focused CI correction and require current-head ephemeral migration replay.
- Keep PR #963 draft and preserve the separate authorization gate for any local/hosted migration.

## 2026-08-02 — Replayed managed ownership and passed destructive purge

**Risk profile:** migration, destructive local fixture, managed Storage cleanup

**Completed:**
- Used the one-time authorized local reset to replay migrations 001–117, regenerated the database
  contract from the replayed schema, and reseeded the normal Pika development fixture.
- Corrected the permanent-deletion fixture so completed and interrupted archive/Gradex files have
  explicit managed owners, operational ledgers reference those owners, and verified classroom
  coverage expands automatically from the four teaching files to all eight scoped objects.
- Reordered fixture teardown to mirror the production finalizer's child-first operational cleanup
  and made Storage cleanup report every exact-key error instead of silently ignoring API failures.
- Removed the exact rows and ten Storage keys left by the pre-fix failed fixture, then proved zero
  fixture residue and both rollout gates disabled.

**Validation:**
- Local migration history and generated types match migrations 001–117; seed completed.
- Managed-storage readiness: 1/1 verified, no missing/shared/orphaned/invalid ownership, enforcement
  ready, gates unchanged.
- Destructive purge fixture passed eight deletions across all five buckets while preserving two
  Blueprint-owned copies and teacher/student accounts; retry, concurrency, auth, fencing, and
  terminal redaction assertions passed.
- Focused suite: 5 files / 88 tests; TypeScript, lint, architecture boundaries, Pika audit, and
  `git diff --check` pass.

**Remaining:**
- Push the generated database contract and fixture correction to draft PR #963, then require green
  current-head CI before the completion review.
- Do not deploy, apply migration 117 to a hosted target, or enable either rollout gate.
