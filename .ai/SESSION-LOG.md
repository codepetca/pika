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

## 2026-07-23 — Hardened standalone test preview

**Risk profile:** workspace-state, exam-mode, authorization, external-network, schema

**Model recommendation:** GPT-5.6 Sol and Terra (high) - this slice crosses authorization, concurrent ownership, outbound document fetching, atomic persistence, focus, and the full-screen exam-mode shell.

**Completed:**
- Added route regressions for unauthenticated, non-teacher, non-owner, classroom/test mismatch, and authorized teacher access.
- Made `testId` the preview-data owner and invalidated requests only at committed effect boundaries so abandoned concurrent renders cannot stall the active preview.
- Hid old-owner content until the current preview finishes loading and ignored every late visible-state write from superseded requests.
- Added A/B and suspended-render regressions proving preview B survives late A and committed A survives an abandoned B render.
- Added named preview, document, and question regions plus keyboard focus transfer into an opened document and restoration to its trigger on close.
- Revalidated the measured window fallback after blocked fullscreen/resize attempts and on later resize so non-maximized content relocks.
- Added a DNS-resolving, address-pinned outbound fetch boundary that rejects private/reserved IPv4 and IPv6 targets, mixed DNS answers, and public-to-private redirects.
- Added migration 105 for an atomic snapshot attach that locks test/classroom ownership, rejects archive/document/URL conflicts, preserves concurrent document changes, and returns the exact superseded snapshot for cleanup.
- Switched snapshots to unique immutable storage paths and remove uncommitted or superseded objects after persistence outcomes.
- Preserved the existing full-screen composition. Migration 105 was applied locally under one-time authorization and generated database types were refreshed; production, Gradex, and deferred mobile layout work were unchanged.

**Validation:**
- Focused preview, document sync, safe-fetch, migration, and existing editor suites (8 files / 77 tests)
- Full repository suite (413 files / 3,712 tests)
- `pnpm exec tsc --noEmit`
- `pnpm lint`
- `pnpm check:architecture` (625 modules / 0 allowances)
- `pnpm build`
- Pika changed-file audit
- `git diff --check`

**Remaining:**
- Require independent PR review and exact-head CI before merge.
- Next retire unused component prop wrappers and the legacy test automation id; preserve database-shaped fields and the old `tab=quizzes` URL tombstone.

## 2026-07-23 — Retired legacy Quiz UI wrappers

**Risk profile:** none

**Model recommendation:** GPT-5 Codex - the pass crosses shared Test component contracts, draft identity, exam-mode E2E setup, and the legacy retirement ratchet without changing rendered behavior.

**Completed:**
- Removed unused `quiz`, `quizId`, `quizTitle`, and `onQuizUpdate` component and hook aliases after confirming no production callers remained.
- Made current Test identity and update props explicit and required.
- Renamed the internal student action-footer automation id from `student-quiz-action-footer` to `student-test-action-footer`.
- Updated student and teacher exam-mode E2E setup to decode the current `test` API response key.
- Removed the final quiz-keyed Tests list payload type from assessment URL-state E2E setup after independent review.
- Added an architecture ratchet preventing retired UI aliases and the old automation id from returning.
- Preserved the `tab=quizzes&quizId=...` old-link tombstone, persisted `quiz_id` fields, schema, archives, gradebook tombstones, and course package compatibility.

**Validation:**
- Focused wrapper and component suites (7 files / 115 tests)
- Full repository suite (408 files / 3,670 tests)
- Exam-mode Playwright discovery (10 tests)
- `pnpm exec tsc --noEmit`
- `pnpm lint`
- `pnpm check:architecture` (624 modules / 0 allowances)
- `pnpm build`
- Pika changed-file audit
- `git diff --check`

**Remaining:**
- Require independent PR review and exact-head CI before merge.
- Next prove and remove unreachable quiz-mode rendering and legacy quiz markdown code while preserving URL and data contracts.

## 2026-07-23 — Retired standalone legacy Quiz Markdown

**Risk profile:** none

**Model recommendation:** GPT-5 Codex - the pass removes an isolated compatibility parser/serializer and consolidates the shared editor on its already-current Test Markdown contract.

**Completed:**
- Removed `src/lib/quiz-markdown.ts` and its dedicated compatibility test after confirming no package, archive, import, or persisted-data reader depended on it.
- Consolidated `TestDetailPanel` draft serialization, Markdown parsing, document handling, and question-field preservation on `testToMarkdown` / `markdownToTest`.
- Added an architecture ratchet preventing the retired module and its assessment/quiz Markdown aliases from returning.
- Updated the cleanup guide to identify unreachable quiz-mode rendering as the next implementation pass.
- Preserved persisted `quiz_id` fields, schema, archives, gradebook tombstones, course package compatibility, and the `tab=quizzes` URL tombstone.

**Validation:**
- Focused Markdown, component, and architecture suites (3 files / 53 tests)
- Full repository suite (407 files / 3,666 tests)
- `pnpm exec tsc --noEmit`
- `pnpm lint`
- `pnpm check:architecture` (623 modules / 0 allowances)
- `pnpm build`
- Pika changed-file audit
- `git diff --check`

**Remaining:**
- Run full repository validation, independent PR review, and exact-head CI before merge.
- Next prove and remove unreachable quiz-mode rendering and wording from current Test components.

## 2026-07-23 — Retired unreachable Quiz rendering

**Risk profile:** none

**Model recommendation:** GPT-5 Codex - the pass traces Test-only callers through large teacher and student components, removes dead rendering/contracts, and preserves persistence and compatibility boundaries.

**Completed:**
- Removed assessment-mode switches and unreachable quiz submission, result, list-badge, authoring, preview, and grading branches from active Test components.
- Consolidated student Test form submissions and returned results on current structured Test payloads.
- Removed the orphaned `TestIndividualResponses` and `TestMultipleChoiceQuestionEditor` modules and their isolated compatibility coverage.
- Simplified Test detail draft saves on the already-current full Markdown snapshot path and retained stale-request guards by test, classroom, and API scope.
- Preserved authoring-preview freshness with uncached reads and a request-generation guard so a late stale response cannot replace a newer refresh.
- Updated the governed native-control registry for the removed controls and modules.
- Added architecture ratchets for retired modules, props, helpers, test ids, and rendering branches.
- Updated the cleanup guide so the next pass is archive/schema migration design and production evidence, not cosmetic naming.
- Preserved schema, migrations, persisted `quiz_id`, legacy archive resources, gradebook tombstones, course-package compatibility, and the `tab=quizzes` URL tombstone.

**Validation:**
- Focused component and architecture suites (7 files / 118 tests)
- Full repository suite (407 files / 3,662 tests)
- `pnpm exec tsc --noEmit`
- `pnpm lint`
- `pnpm check:architecture` (621 modules / 0 allowances)
- `pnpm run check:ui-policy` (207 registered native controls / 65 files)
- `pnpm build`
- Pika changed-file audit
- Teacher/student Test visual verification across desktop/mobile and light/dark, including teacher authoring and the student form
- `git diff --check`
- Independent review found one blocking in-flight preview freshness regression; fixed with a request-generation guard and deferred-response regression coverage.

**Remaining:**
- Require independent PR review and exact-head CI before merge.
- Next gather read-only production evidence and design the archive-compatible schema retirement plan; no migration may be applied without exact one-time approval.

## 2026-07-23 — Designed legacy Quiz schema retirement

**Risk profile:** none

**Model recommendation:** GPT-5 Codex - the pass crosses hosted evidence, archive format versioning, deterministic backfill, package compatibility, and destructive migration rollback without applying schema changes.

**Completed:**
- Added a target-pinned, redirect-rejecting, read-only inventory for legacy Quiz table rows, Quiz drafts, Quiz blueprint assessments, and verified archive manifest counts.
- Required two matching aggregate snapshots and emitted no row ids, titles, content, storage paths, or credentials.
- Ran the inventory against production project `zhioqbapgfcrronyuidm`: 1 quiz, 3 questions, 60 responses, 0 manual score overrides, 0 Quiz drafts, and 0 Quiz blueprint assessments.
- Confirmed the single verified archive-v1 manifest contains the same non-empty Quiz graph.
- Designed archive-v2 retired-assessment envelopes instead of mapping historical Quiz rows into active Tests, which would resurface removed product data and lose whole-assessment override semantics.
- Defined additive adapter, freeze/backfill, production-proof, destructive-retirement, gradebook, and course-package passes with explicit approval, validation, and forward-repair gates.
- Created no migration and performed no production write.

**Validation:**
- Focused inventory, archive, package, gradebook, docs, and architecture suites (8 files / 96 tests)
- Full repository suite after review remediation (409 files / 3,672 tests)
- `pnpm exec tsc --noEmit`
- `pnpm lint`
- `pnpm check:architecture` (622 modules / 0 allowances)
- `pnpm build`
- Pika changed-file audit
- Production inventory completed with two stable snapshots

**Review:**
- Independent review found that the plan needed an explicit version-keyed
  TypeScript/database archive transition and an atomic fate for zero-row Quiz
  blueprint assessments.
- The same review found that equal-count archive replacement was not part of
  private snapshot stability evidence.
- Added the versioned registry, operation/RPC, constraint, deployed-code fixture,
  and blueprint lock/preflight requirements; added private archive UUID/checksum
  comparison and concrete duplicate, count-drift, and truncated-page tests.
- Targeted review caught ambiguous destructive-pass wording; clarified that v2
  becomes current without deleting either immutable registry graph or the v1
  adapter, and required a post-drop v1 restore fixture.
- Re-ran the target-pinned production inventory with stable unchanged aggregates.

**Remaining:**
- Require independent PR review and exact-head CI before merge.
- Next implement the additive retired-resource envelope and archive-v2/v1 adapter only after explicit approval to create its named migration; do not apply it without separate exact target-and-filename authorization.

## 2026-07-23 — Established versioned Quiz archive compatibility

**Risk profile:** runtime-platform

**Model recommendation:** GPT-5.6 Terra - the pass freezes a historical archive
contract, adds version dispatch, and converts legacy relational data into a
future persistence shape without enabling unapproved schema behavior.

**Completed:**
- Froze the exact 42-resource archive-v1 table, primary-key, and actor-reference
  contract independently from the live database inventory.
- Added explicit v1/v2 manifest schemas and registry dispatch while retaining v1
  as the only enabled export and restore contract.
- Restricted locale-dependent canonical serialization/checksum recovery to v1;
  v2 accepts only the current deterministic canonical form.
- Defined the inactive v2 graph with generic retired-assessment record and actor
  resources instead of the four Quiz tables.
- Added a deterministic, non-mutating adapter that preserves complete Quiz and
  Quiz-draft payloads, parent identities, actor references, timestamps, and
  canonical SHA-256 evidence without mapping retired data into Tests.
- Expanded the verified non-empty v1 fixture to include all four Quiz resources,
  a manual score override, and a Quiz draft.
- Froze portable v1 tar-content, manifest-content, and per-resource hashes so
  the non-empty contract cannot be regenerated with silent Quiz drift.
- Tightened independent-review findings: Quiz drafts retain and validate their
  Quiz parent; adapter replay preserves existing envelopes; archived actor
  references must resolve; and strict v2 verification rejects malformed,
  checksum-invalid, orphaned, actor-invalid, or credential-shaped envelopes.
- Added an explicit Gradex capability gate and moved source download, checksum,
  strict verification, identity, and metadata-version binding before operation
  creation so disabled or mislabeled v2 causes zero RPC or storage writes.
- Restricted inactive-v2 envelopes to the declared legacy Quiz source contract
  and added a resource registry that enforces payload identity, required
  parent/FK shape, classroom binding, cross-parent Quiz identity, actor-to-
  payload equality, required actor fields/references, and credential-key
  rejection including client secrets, private keys, and token variants.
- Updated the retirement plan and cleanup guide to distinguish the completed
  application foundation from the approval-gated database/v2 activation work.
- Created no migration and performed no production write.

**Validation:**
- Focused archive contract, format, restore, adapter, Gradex, and docs suites
  (7 files / 59 tests)
- Full repository suite after review fixes (411 files / 3,690 tests)
- `pnpm exec tsc --noEmit`
- `pnpm lint`
- `pnpm check:architecture` (624 modules / 0 allowances)
- `pnpm build`
- Portable empty-v1 tar SHA:
  `4d3c518c262c5269844b112953dab52b08b68e7999ec235f422e126f54306093`
- Non-empty Quiz-v1 tar SHA:
  `32dd2bd5ed2bc3795076831385d01a2e046589b4b8d88949de4d24c731314e58`

**Remaining:**
- Require changed-file audit, independent PR review, and exact-head CI before merge.
- Next create the envelope tables and versioned database archive registry, then
  activate v2 export/restore, only after explicit approval to create the named
  migration; applying it requires separate exact target-and-filename permission.

## 2026-07-23 — Staged the additive archive-v2 contract locally

**Risk profile:** runtime-platform

**Completed:**
- Added migration `105_classroom_archive_v2_contract.sql` with private retired
  assessment envelopes, a version-keyed archive registry, operation contract
  pins, archive format-v2 metadata, and distinct v2 export/restore RPCs while
  preserving every deployed v1 RPC and source table.
- Validated archive-v2 export through deterministic v1 Quiz adaptation and
  validated the explicit v1/v2-to-envelope restore path. Kept current
  application export and restore on v1 because compaction remains v1-only and
  migration 105 is not hosted.
- Kept Gradex on v1 and made v2 compaction plus envelope-backed source export
  fail closed until the freeze/backfill pass provides direct v2 snapshots.
- Preserved full Quiz, question, response, manual-score, and Quiz-draft payloads
  with actor references; added a direct v1-to-v2 archive/restore round trip.
- Applied migration 105 only to the local validation database after explicit
  authorization. The first attempt rolled back on deferred FK ordering; moved
  the version-registry FK creation after seed rows and validated the corrected
  schema. No hosted database was changed.
- Regenerated `src/types/database.generated.ts` and added a transactional v2
  database harness to CI. Legacy v1 export/restore/compaction and Gradex
  database harnesses remain green.

**Validation:**
- Full repository suite at the final head: 412 files / 3,710 tests.
- Focused final suite: 20 files / 232 tests.
- Local v1 export, v1 restore, v1 compaction, Gradex, and v2 export/restore
  database contracts.
- `pnpm exec tsc --noEmit`, `pnpm lint`, `pnpm run db:types:check`, migration
  filename/static checks, `git diff --check`, and Pika changed-file audit.

**Remaining:**
- Run architecture/build/full final validation at the exact head.
- Open the PR, independently review and remediate it, then require exact-head CI.
- Migration 105 still requires separate explicit authorization for every hosted
  target. The next implementation pass is the atomic freeze/backfill ledger.

## 2026-07-23 — Closed archive-v2 contract review blockers

**Risk profile:** runtime-platform

**Completed:**
- Registered the retired assessment record and actor tables in the live
  44-resource classroom ownership graph while keeping archive v1 frozen at 42
  resources and archive v2 at 40.
- Preserved the deployed v1 production inventory contract and separated v1
  fixtures from the expanding live ownership graph.
- Reordered restore URL rewriting so v1 source rows are transformed before
  envelope adaptation, direct v2 payload checksums are recomputed, and the final
  staged envelope graph is validated after all transformations.
- Moved the original v1 export begin implementation to a private compatibility
  function. Both public v1 and v2 begin RPCs now lock the classroom revision
  before checking for envelopes, fail closed without snapshot rows, preserve
  completed replay, and serialize concurrent envelope insertion.
- Added a real two-session database race proving an uncommitted envelope cannot
  cross the export fence, plus legacy entry-point and zero-snapshot assertions.
- Made the v2 database harness select the configured Pika Supabase container
  instead of the first matching local project.
- Applied only the corrected 105 function segment to `supabase_db_pika` under
  the existing local authorization; migration history remains 001-105 and no
  hosted database was changed.

**Validation:**
- Full repository suite: 412 files / 3,710 tests.
- Local v1 export, restore, compaction, Gradex, and v2 database contracts.
- Live local ownership audit: 123 foreign-key relationships.
- `pnpm exec tsc --noEmit`, `pnpm lint`, `pnpm check:architecture`,
  `pnpm run check:ui-policy`, `pnpm run db:types:check`, `pnpm build`,
  `git diff --check`, shell syntax check, and Pika changed-file audit.

**Remaining:**
- Commit and push the remediation, run targeted and integration re-review, and
  require exact-head CI before merging PR 927.
- Migration 105 remains unapplied to every hosted target.
- After merge, implement the separately reviewed atomic Quiz freeze/backfill
  ledger; applying its migration requires a new exact authorization.

## 2026-07-23 — Kept archive v1 current through compaction

**Risk profile:** runtime-platform

**Completed:**
- Final integration review found that making v2 the current application export
  format was incompatible with the still-v1-only compaction path.
- Kept explicit v2 construction and v1/v2 restore support, but restored v1 as
  the current application writer and retained the deployed v1 RPC flow.
- Updated contract and coordinator tests to prove the current writer preserves
  historical Quiz rows in v1 while the explicit v2 compatibility path remains
  independently testable.
- Shortened the continuity summary to restore the startup-document budget.

**Validation:**
- The full local archive recovery drill passes export, compaction, restore,
  cleanup, and idempotent replay with the frozen 42-resource v1 graph.
- Focused archive and migration suites, startup-document tests, TypeScript, and
  lint pass.

**Remaining:**
- Run final repository checks, integration review, and exact-head CI before
  merging PR 927.
- Migration 105 remains unapplied to every hosted target.

## 2026-07-23 — Preserved pre-105 archive restore rollout

**Risk profile:** runtime-platform

**Completed:**
- Final integration review found that the application restore coordinator
  required migration 105 even though no hosted target has it.
- Restored the active coordinator and compaction preflight to the deployed v1
  planner and migration-083 RPCs; current export, compaction, and restore now
  share the frozen 42-resource v1 contract.
- Kept a separate explicit v2 planner for compatibility validation without
  making it reachable from the current application coordinator.
- Froze the v1 restore order and protected it with a digest and exact resource
  set regression.
- Clarified that migration 105 is additive for data and public API surface, but
  broadens v1-only constraints and wraps selected implementations internally.
- Added a live database assertion that all six deployed v1 archive RPC
  signatures and service-role grants survive migration 105.

**Validation:**
- Active v1 and explicit v2 restore planning tests pass.
- Local v1 export, restore, compaction, Gradex, and v2 database harnesses pass.
- Full local archive recovery drill passes export, compaction, restore,
  cleanup, and idempotent replay.
- TypeScript, lint, shell syntax, Pika changed-file audit, and focused tests
  pass.

**Remaining:**
- Push the remediation, run the final authorized targeted review, and require
  exact-head CI before merging PR 927.
- Migration 105 remains unapplied to every hosted target.

## 2026-07-23 — Froze archive restore ordering

**Risk profile:** runtime-platform

**Completed:**
- Derived the inactive v2 restore order from the frozen topological v1 order
  with Quiz resources removed, then appended the retired-assessment record and
  actor resources parent-first.
- Removed the final live classroom-graph dependency from v1 compaction
  preflight staging.
- Added regressions for every declared v2 parent-before-child dependency and
  the actual non-empty v1 compaction staging sequence.

**Validation:**
- Focused archive contract, restore, and compaction tests pass.
- TypeScript and lint pass.
- Local compaction database harness and full archive recovery drill pass.

**Remaining:**
- Publish, independently review, and require exact-head CI before merge.
- Then proceed to the separately authorized atomic Quiz freeze/backfill pass.

## 2026-07-23 — Prepared atomic legacy Quiz freeze and backfill

**Risk profile:** runtime-platform

**Completed:**
- Added migration 106 to freeze the retired Quiz tables and drafts, prove Quiz
  blueprints are empty, and narrow the constraint to Test-only. Archive-ordered
  parent/child `NOWAIT` locks roll back immediately on live conflicts.
- Added deterministic SQL envelope IDs and canonical payload checksums matching
  the TypeScript adapter, parent and actor preflights, collision checks, and an
  aggregate-only five-resource parity ledger.
- Kept every source row intact for the observation window and added no
  dual-write or active Test-table mapping.
- Added a disposable rehearsal for v1/v2 compatibility, failed preflights,
  envelope/source lock contention, the freeze and ledger, and SQL/TS parity.
- Documented that migration 106 cannot be hosted until direct v2 snapshots,
  version-aware compaction, and v1-to-v2 restore dispatch are current.

**Validation:**
- Focused migration and archive-v2 unit tests, TypeScript, shell syntax, and
  `git diff --check` pass.
- Migration 106 was not applied to the shared local database or a hosted
  target; its executable rehearsal is reserved for disposable PR CI.

**Remaining:**
- Run repository checks, independent review, and exact-head CI before merge.
- Next pass: implement the version-aware archive runtime required before
  migration 106 can receive target-specific application approval.

## 2026-07-23 — Activated direct archive-v2 runtime

**Risk profile:** runtime-platform

**Completed:**
- Recorded the maintainer decision that experimental Quiz rows, drafts,
  envelopes, and Quiz portions of v1 artifacts are disposable.
- Added migration 107 to purge Quiz source rows/drafts/envelopes, narrow
  drafts to Tests, promote the live archive registry to v2, and capture source
  contract 2 directly.
- Made export, restore, and compaction strict v2 paths with no pre-107 RPC
  fallback. V1 restore now discards Quiz resources while retaining other
  classroom content.
- Extended disposable replay through migrations 106-107 and proved direct
  source counts, snapshot membership, upload intent, and finalization.
- Review remediation now purges the frozen Quiz source rows, fences retryable
  operations, and makes compaction use migration-107-specific v2 RPCs. V1
  archives must be re-exported before compaction.

**Validation:**
- Focused archive coordinator tests and TypeScript pass.
- The disposable freeze/backfill/direct-source database harness passes.
- Current-export and atomic-compaction database harnesses pass against the
  disposable post-107 schema, including a complete v2 cold transition.
- No shared local or hosted migration was applied.

**Remaining:**
- Complete repository validation, independent review, exact-head CI, and merge.
- Next pass: migration 108 hard-drops the legacy Quiz schema and removes the
  remaining active compatibility types and payload fields.

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

**Remaining:**
- Production migration history is aligned through 116; the application feature is still only in
  draft PR #963 and has not been deployed.
- All one-time migration authorizations are consumed; no staging migration, application deployment,
  classroom purge, or additional production operation is authorized.
