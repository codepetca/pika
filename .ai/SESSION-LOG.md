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

## 2026-07-23 — Prepared legacy Quiz hard removal

**Risk profile:** runtime-platform/destructive-schema

**Completed:**
- Added migration 108 to fail closed unless migration 107 purged all retired
  data, then drop the four Quiz tables, their catalog helpers, the private
  backfill ledger/functions, `gradebook_settings.quizzes_weight`, v1 database
  export RPCs/registry rows, and retired site-configuration keys.
- Removed active Quiz branches and aliases from assessment drafts, gradebook,
  course packages, publishing, blueprints, current domain types, and server
  helpers. Course packages now export v4 and import v2/v3/v4; the v2 reader
  discards `quizzes.md` while preserving reusable non-Quiz content.
- Reduced the live classroom ownership graph from 44 to 40 resources while
  retaining the immutable archive-v1 resource contract solely for discard-only
  restore of non-Quiz classroom data.
- Regenerated Supabase database types from a disposable post-108 database; the
  generated contract has no Quiz tables, fields, or functions.
- Removed obsolete retirement inventory, backfill parity, and envelope adapter
  utilities after their destructive decision was finalized.
- Review remediation preserves course-package v2 as an import-only boundary,
  discarding `quizzes.md` while retaining reusable non-Quiz content. V1
  classroom restore now excludes Quiz-only actors and storage objects from the
  restore plan after validating the complete source artifact.
- Migration 108 now requires exact equality between the live archive registry
  and versioned source contract 2. The disposable harness proves registry drift
  fails without deleting v1 metadata or Quiz tables before restoring the
  registry and completing hard removal.
- Final integration review found the production archive canary still bound to
  archive v1. The operator runner and runbook now use archive format 2, the
  40-resource graph, migration-107 source/restore contracts, and the current v2
  restore planner. A subprocess smoke test loads the actual excluded script so
  future import drift fails in Vitest.

**Validation:**
- Fresh disposable replay through migrations 106-108 passes freeze, direct
  archive-v2 activation, hard-removal catalog assertions, current export,
  restore, and compaction contracts.
- Generated Supabase types exactly match the disposable post-108 schema.
- TypeScript, lint, architecture, UI policy, shell syntax, `git diff --check`,
  and the Pika pre-commit audit pass.
- Full coverage passes: 413 files and 3,684 tests. The post-108 atomic blueprint
  database contract also passes against the disposable database.
- The focused post-review archive suite passes: 4 files and 53 tests, including
  actual operator-runner loading. TypeScript, lint, architecture, diff checks,
  and the Pika audit remain green after the canary port.
- Migration 108 was not applied to the shared local database or any hosted
  target.

**Remaining:**
- Complete PR review/remediation, exact-head CI, and merge. Applying migration
  108 remains separately target-authorized.

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

## 2026-08-02 — Built managed-storage ownership foundation

**Risk profile:** high — rolling schema/application compatibility, cross-owner
file copies, Storage/relational atomicity, legacy reconciliation, and concurrent
enforcement activation.

**Completed:**
- Created `codex/managed-storage-ownership-foundation` from `origin/main` in a
  dedicated worktree and left draft PR #963 and all of its worktrees unchanged.
- Restored deployed migrations 115/116 byte-for-byte and added a lineage hash
  guard. Added one forward-only migration 117 for compatibility schema,
  deterministic registration/reconciliation/readiness, serialized enforcement,
  provisional Blueprint/Classroom copies, and leased generic cleanup.
- Converted all five managed buckets' active producers to reserve, upload/copy,
  verify, and atomic attach/adopt. Added managed UUIDs to relational,
  operational, cleanup, archive, restore, Gradex, and embedded JSON references.
- Made archive export use the exact managed Classroom inventory under
  enforcement; restore creates deterministic new managed identities and rewrites
  preserved references; compaction queues source objects after hot deletion.
- Added target-acknowledged reconciliation/readiness/activation/pause and manual
  cleanup commands. No cleanup scheduler, purge worker/gate, permanent deletion
  route, or deletion UX was added.
- Documented the exact rollout, rollback, Classroom/Blueprint preservation, and
  migration-116 compatibility contract in
  `docs/guidance/managed-storage-rollout.md`.

**Validation:**
- Full Vitest suite: 459 files / 3,971 tests; all passed.
- Focused managed-storage, archive, restore, compaction, Gradex, Blueprint,
  upload, and component suites pass.
- TypeScript, lint, production build, SQLFluff parse, migration lineage hashes,
  shell syntax, diff check, and Pika audit pass.
- The database fixture includes mismatch rejection, legacy writer rejection,
  interrupted cleanup retry/idempotency, and a real two-session writer versus
  activation fence. It was not run locally because no migration application was
  authorized; CI runs it only after a fresh isolated replay.

**Remaining:**
- Obtain fresh authorization naming exact migration 117 and an isolated
  target before any replay. The shared local database contains PR #963's
  different migration 117 and was only queried read-only.
- After an authorized deployment, register legacy objects, reconcile, refresh
  readiness, and activate using exact target acknowledgements. Generic cleanup
  remains separately disabled. Permanent classroom deletion remains in PR #963
  as a later consumer and must be redesigned against this authority.

## 2026-08-02 — Remediated managed-storage ownership review

**Risk profile:** high — cleanup authority, embedded identity validation,
concurrent activation, and Classroom/Blueprint ownership boundaries.

**Completed:**
- Preserved managed-object tombstones and made generic cleanup enforcement-only;
  existing operational cleanup leases now mirror into the managed authority.
- Made JSON evidence exact by UUID, bucket, path, resource, and subject; fenced
  reference removal and host deletion with durable cleanup intents.
- Blocked readiness on compatibility-era cleanup leases already in flight.
- Copied registered legacy test documents at both Classroom/Blueprint boundaries
  without sharing ownership, and refreshed generated database types.
- Revoked the internal protocol-lock helper from API roles, made deterministic
  legacy replays compare every subject/resource/integrity field, and preserved
  per-reference document metadata when a source file is copied once.
- Kept migration 117 unapplied and PR #963 unchanged.

**Validation:**
- Focused ownership, Blueprint, and startup suites pass (46 tests).
- Full suite reached 3,973/3,974 under concurrent load; the unrelated schema
  audit timeout passed immediately in isolation (2/2).
- TypeScript, lint, architecture, lineage, production build, full SQL parse,
  shell syntax, diff check, and Pika audit pass.
- CI's isolated 115→117 migration replay succeeds; the first remediation run
  stopped only on generated-type ordering, now matched exactly to its diff.
- A later database fixture exposed polymorphic cleanup triggers reading absent
  record fields; both now use JSON-safe optional-field access, with direct
  compatibility inserts plus enforced worker coverage.

**Remaining:**
- Push the approved extra correction, require complete database fixture CI,
  and run the final cumulative integration review.

## 2026-08-02 — Closed compatibility cleanup authority gap

**Risk profile:** high — rolling cleanup compatibility and exact-path Storage
write/delete serialization.

**Completed:**
- Made legacy cleanup rows opportunistically bind exact registered managed
  identities during compatibility rollout while leaving unmatched raw-only rows
  on their migration-116 behavior.
- Mirrored managed cleanup leases, retries, and terminal tombstones in both
  protocol modes, and fenced all exact-path Storage updates while such a lease
  is active.
- Added a real compatibility-mode claim, overwrite rejection, delete,
  completion, tombstone, and readiness fixture; corrected the fixture's
  submission-requirement column to the deployed `label` schema.
- Kept generic cleanup enforcement-only, migration 117 unapplied outside
  disposable CI, permanent deletion unavailable, and PR #963 unchanged.

**Validation:**
- Pending focused checks, disposable CI replay/fixture, and final targeted
  independent review.

**Remaining:**
- Publish the correction after local static checks, require green PR CI, and
  complete the approved targeted review.

## 2026-08-03 — Preserved live references during cleanup cancellation

**Risk profile:** high — migration-116 worker compatibility, cleanup lease
reclamation, and managed readiness.

**Completed:**
- Distinguished physical deletion from legacy worker cancellation: a live raw
  or managed reference with present bytes now returns the leased object to
  `ready`, while missing referenced bytes and unreferenced present bytes still
  fail closed.
- Counted expired processing-lease reclamation as a new managed attempt while
  leaving same-token renewal neutral.
- Extended the disposable database fixture across assignment and Test snapshot
  cancellation, retry accounting, reconciliation, readiness, Storage overwrite
  fencing, and the local Storage-API delete simulation contract.
- Kept generic cleanup enforcement-only, migration 117 unapplied outside CI,
  permanent deletion unavailable, and PR #963 unchanged.

**Validation:**
- Pending focused static checks, disposable CI replay/fixture, and the approved
  targeted follow-up review.

**Remaining:**
- Publish after local verification, require green PR CI, and complete the final
  targeted review without starting another automatic remediation loop.

## 2026-08-03 — Serialized late references with cleanup deletion

**Risk profile:** high — concurrent compatibility writers, Storage deletion,
and cleanup completion.

**Completed:**
- Normalized managed lifecycle locking to protocol, managed-object row, then
  exact path across reservation replay, compatibility references, Storage
  writes/deletes, operational cleanup claims, and cleanup completion.
- Made compatibility assignment and Test JSON writers adopt an exact managed
  identity and safely cancel processing cleanup only while bytes remain;
  deletion-first races now reject the late reference.
- Made Storage deletion recheck relational, embedded, and raw live references
  under the same lifecycle fence.
- Added disposable two-session assignment/Test race fixtures for both ordering
  outcomes and a referenced-but-absent completion fixture that fails closed.
- Materialized the cleanup live-reference predicate before its conditional
  after the first disposable replay exposed a PL/pgSQL parser ambiguity.
- Corrected readiness revision capture to bind by the serialized generation;
  the earlier digest predicate ran before the refresh stored that digest and
  made first-time enforcement activation fail stale despite a ready inventory.
- Replaced the Storage writer trigger's implicit `FOUND` check with an explicit
  managed UUID check because the intervening exact-path lock overwrote
  `FOUND`, allowing an unreserved write even after enforcement activated.
- Preserved active readiness evidence while an enforced deployment runs a new
  readiness scan, avoiding an invalid transient settings row without pausing
  enforcement; only a ready scan replaces the active evidence.
- Kept migration 117 unapplied outside disposable CI, permanent deletion
  unavailable, deployed migrations 115/116 unchanged, and PR #963 untouched.

**Validation:**
- Full suite passes (3,975 tests), along with TypeScript, lint, architecture,
  lineage, production build, SQL parse, shell syntax, diff check, and Pika
  audit.

**Remaining:**
- Push the remediation, require the disposable database replay and concurrency
  fixtures to pass, then perform the one approved final targeted review.

## 2026-08-03 — Completed managed-storage archive compatibility rehearsal

**Risk profile:** high — rolling archive compatibility, cleanup authority, and
recovery preservation across managed ownership activation.

**Completed:**
- Preserved archive export and compaction under reserve-first ownership while
  limiting the rollback rehearsal bypass to simultaneous compaction and restore
  maintenance scopes.
- Made legacy archive restore derive deterministic managed ownership for
  assignment artifacts, submission images, and Test documents; ambiguous or
  mismatched legacy references fail closed.
- Updated recovery teardown to use the existing disabled cleanup protocols and
  accept current `classroom-v2.tar.gz` archive identities without introducing a
  scheduler, purge path, or enabled production worker.
- Added a service-role-only exact managed-object presence probe so cleanup can
  verify local Storage API 400 responses without trusting bucket-level evidence.
- Closed the final Blueprint rollout gap: identity-less Test uploads are
  atomically registered to their exact existing owner in compatibility mode
  before producing a distinct managed provisional copy; ambiguous, explicit,
  owner-mismatched, unsettled, and post-enforcement sources fail closed.
- Kept migrations 115/116 byte-identical to deployed production history, kept
  all new schema work in migration 117, applied no migration outside disposable
  CI, and left draft PR #963 unchanged.

**Validation:**
- CI run 30826141547 is fully green: migration replay and generated types,
  ownership/enforcement and concurrency database fixtures, archive recovery and
  teardown, Browser Experience Matrix, full tests, TypeScript, lint, and build.
- Focused cleanup and migration tests, Pika audit, migration-lineage hashes,
  diff checks, and branch/remote cleanliness pass at `06983ebd`.
- Focused Blueprint compatibility and migration contracts pass after the final
  review remediation, along with TypeScript, shell syntax, and changed-file audit.

**Remaining:**
- Require exact-head disposable CI and final read-only review, update draft PR
  #967's validation summary, and keep deployment/application of migration 117
  under fresh target-specific authorization.

## 2026-08-03 — Serialized Blueprint adoption with raw compatibility writers

**Risk profile:** high — exact-path ownership adoption and concurrent rolling
deployment writers.

**Completed:**
- Made every embedded raw-path writer take the exact-path lifecycle fence even
  when no managed row is committed yet, then re-read ownership after waiting.
- Rejected explicit managed UUID/path mismatches before locking the
  caller-supplied path, preserving the canonical object-row/path lock order.
- Pre-locked all existing UUID and raw-path identities in one global managed
  UUID order, including identities removed by an update; newly appearing
  identities abort safely for retry rather than mixing path-first and
  row-first locking.
- Corrected the disposable fixture to adopt its deliberate legacy Blueprint
  source before expecting readiness, and added two-session coverage for a late
  cross-Classroom raw writer, a held wrong-path mismatch lock, and inverse
  path/UUID ordering without deadlock. Added a separate replacement race that
  proves previous identities are locked before a new absent raw path.
- Kept all schema work consolidated in migration 117, left migrations 115/116
  unchanged, applied no migration, and left PR #963 untouched.

**Validation:**
- Focused Blueprint and migration contract tests, TypeScript, shellcheck, shell
  syntax, SQL parse, migration lineage, diff checks, and Pika audit pass.

**Remaining:**
- Push the correction, require exact-head disposable database CI, and obtain a
  targeted independent concurrency review before the final integration gate.

## 2026-08-03 — Closed managed-storage readiness and Blueprint retry blockers

**Risk profile:** runtime-platform — migration 117 readiness liveness,
provisional ownership, and idempotent Blueprint file copies.

**Completed:**
- Made serialized readiness transition expired, unreferenced reserved/verified
  objects to `cleanup_pending` without deleting Storage bytes, and made expired
  provisional-owner findings ignore settled cleanup/tombstone states.
- Made Blueprint provisional-owner and target object identities deterministic
  by operation, direction, and source managed identity; completed operations
  are preflighted and incomplete retries reuse verified bytes.
- Made capture and instantiation queue every exact provisional copy on any
  downstream failure; referenced/adopted objects remain protected by the
  managed cleanup authority check.
- Added a narrowly scoped retry transition for queued, still-provisional
  Blueprint copies, plus regressions for expiry, readiness, activation,
  tombstone cleanup, failed atomic operations, and same-operation replay.
- Corrected semantic Blueprint replays that succeed without adopting copies:
  exact provisional copies are queued, while the database refuses cleanup for
  any concurrently adopted/referenced winner.
- Closed the compatibility cleanup race where a live reference could arrive
  after a legacy worker claim but before Storage deletion: the protected delete
  failure now restores the managed object to `ready` instead of re-queuing it.
- Reconfirmed that migration 117 revokes all migration-115 purge entry points,
  including `service_role`; no purge capability was added or exposed.
- Kept migrations 115/116 unchanged, kept all corrections in unapplied
  migration 117, applied no migration, enabled no worker, exposed no deletion,
  and left PR #963 untouched.

**Validation:**
- Pika audit, lint, TypeScript, architecture/design/UI policy, lineage, shell
  syntax, and diff checks pass.
- Focused ownership/Blueprint tests pass (36 tests); the full suite passes
  (459 files, 3,986 tests); the production build passes.
- The semantic replay regression, TypeScript, shell syntax, and diff checks
  pass after the final correction.
- The extended database fixture was not executed locally because migration
  application/replay still requires fresh authorization naming migration 117
  and the local target; exact-head disposable CI remains required.

**Remaining:**
- Push the correction to PR #967, require exact-head CI including disposable
  migration replay/database fixtures, and perform a final read-only review.

## 2026-08-04 — Hardened purge rollout visibility and verification gates

**Risk profile:** runtime-platform — irreversible classroom purge rollout,
PostgreSQL function semantics, and conflicting background operations.

**Completed:**
- Added a fail-closed, server-authoritative archive-list field so permanent
  deletion is visible only when managed ownership is enforced and the exact
  teacher/classroom rollout gate is open; the purge RPC remains final authority.
- Corrected the migration-118 conflict function volatility and added a scoped
  database-lint gate that checks every function created or replaced by 118
  without making unrelated historical warnings a new CI baseline.
- Expanded the rollback-only destructive fixture to independently prove active
  archive, restore, assignment grading, repository grading, test grading,
  Blueprint operation, proposal, and editing-session conflicts.
- Visually verified teacher archived list/dialog and the student boundary on
  desktop/mobile in light/dark through Playwright interception, without changing
  local rollout settings.

**Validation:**
- Pika audit, TypeScript, lint, architecture, design/UI policy, diff checks, and
  production build pass; full Vitest passes (464 files, 4,010 tests).
- The current old local migration body makes the new database lint and purge
  fixture fail exactly at the known composite-row assignment; all newly added
  conflict assertions pass before that expected boundary.

**Remaining:**
- Obtain fresh authorization to reset/reseed local Supabase, replay corrected
  migration 118, regenerate types, and rerun the lint/readiness/destructive
  fixtures. Keep staging/production untouched and rollout gates disabled.

## 2026-08-04 — Replayed and verified managed-ownership purge locally

**Risk profile:** runtime-platform — authorized destructive local database reset
and verification of irreversible purge infrastructure.

**Completed:**
- Used the one-time authorization to reset local Supabase, replay migrations
  001–118 once, regenerate database types, and reseed the development fixtures.
- Passed migration-118 PostgreSQL lint, the managed-storage readiness and
  concurrency fixture, and the rollback-only destructive purge fixture covering
  conflict blocking, authorization, retries, partial failure, storage cleanup,
  preservation, and operation locks.
- Reconfirmed post-fixture safe defaults: classroom purge remains `disabled`
  and managed storage remains in `compatibility` mode.
- Applied nothing to staging or production and left PR #963 untouched.

**Validation:**
- Generated Supabase types match the replayed schema; TypeScript passes.
- Focused purge/API/UI/migration coverage passes (7 files, 50 tests).
- Teacher/student desktop/mobile light/dark verification already passed without
  enabling the rollout gates.

**Remaining:**
- Complete final read-only change-set review, then commit and publish the draft
  replacement PR only when authorized.

## 2026-08-04 — Stopped at purge review circuit breaker

**Risk profile:** runtime-platform — irreversible deletion, managed Storage,
authorization, concurrency, and migration compatibility.

**Completed:**
- Ran the high-risk independent review topology: security/concurrency and
  architecture initial reviewers, one targeted security re-review, and one
  final cumulative integration review.
- Used two consolidated remediation batches to close retry/backoff and live-
  lease state, durable Storage resurrection evidence, migration-115 upgrade
  refusal, RPC-only ledger writes, operational impact/digest/fences, code-first
  compatibility handling, and browser no-progress request storms.
- Kept migration 118 draft and rollout-disabled; changed no local/hosted database
  after the earlier authorized replay, and left PR #963 unchanged.

**Validation:**
- TypeScript, focused tests (47), startup tests (38), production build, lint,
  architecture/design/UI policy, lineage, generated-type compatibility, Pika
  audit, shell syntax, and diff checks pass.
- The full suite before remediation batch 2 had 4,012 passing tests and only the
  subsequently fixed startup-document budget failures.

**Remaining:**
- Two final P1s require an owner-approved third remediation batch: probe the
  migration-118-only settings authority before cron reads legacy purge rows,
  and pass the operational digest in the primary destructive fixture.
- After those narrow fixes, run exact-head ephemeral DB CI and one final targeted
  review before committing/publishing the replacement draft PR.

## 2026-08-04 — Cleared final purge review blockers

**Risk profile:** runtime-platform — code-first migration compatibility and
exact-head destructive purge verification.

**Completed:**
- Added a migration-118-only readiness probe before the cleanup cron can read or
  advance legacy migration-115 purge operations; pre-118 targets now fail closed
  without RPC or Storage access.
- Updated the primary destructive fixture to pass the complete server inventory,
  including the operational inventory digest required by migration 118.
- Used the owner-authorized final remediation batch and fifth targeted reviewer;
  no P0/P1 or merge-blocking findings remain in the bounded fixes.

**Validation:**
- Focused purge/cron/migration coverage passes (3 files, 35 tests), including the
  pre-118 no-op regression.
- TypeScript, destructive-fixture shell syntax, migration-118 function lint,
  continuity validation, and diff checks pass.

**Remaining:**
- Publish the draft replacement PR while leaving #963 unchanged.
- Run exact-head database CI before enabling or deploying deletion. Migration
  118 still requires fresh authorization for every database target.

## 2026-08-04 — Verified draft hot-archive purge replacement

**Risk profile:** runtime-platform — irreversible classroom deletion,
concurrency, managed Storage ownership, and migration safety.

**Completed:**
- Reconciled existing managed-cleanup and archive-compaction concurrency
  fixtures with migration 118's fail-fast lifecycle lock and retry contract.
- Hardened the rollback-only purge fixture to simulate provider-side object
  resurrection without weakening Supabase Storage ownership or app-role access.
- Kept PR #968 draft, PR #963 unchanged, rollout gates disabled, and migration
  118 unapplied by this remediation.

**Validation:**
- Exact-head CI run 30952362597 passed Architecture Database Contracts, Test &
  Build, Browser Experience Matrix, and Vercel at `ab4ce5f6`.
- Pika audit, shell syntax, diff checks, and 27 focused tests pass.
- Targeted security/concurrency and final cumulative integration reviews found
  no P0/P1 or merge-blocking findings.

**Remaining:**
- Keep migration 118 and deletion disabled until separately authorized rollout
  and canary verification. Cold archives and individual-student purge remain
  follow-up scopes.
