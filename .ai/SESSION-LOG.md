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

## 2026-07-14 — Archive stack review findings fixed

**Completed:**
- Ran repeated independent SQL, runtime, Gradex, and cross-layer review loops and fixed every actionable finding.
- Hardened export/restore upload cleanup, exact restore object descriptors, actor-role reconciliation, transactional compaction dry runs, canonical paths, expiry/retry state transitions, and fail-closed source cleanup.
- Tightened Gradex v2 with strict per-table Zod contracts, required relationships and projected fields, safe analytic enum preservation, Unicode-aware identifier scanning, pseudonymized unknown tokens, exact cleanup canaries, and retention fences.
- Updated database contract drills, lifecycle guidance, cron integration, and environment documentation. No production database, migration, row, object, environment, deployment, or schedule was read or modified.

**Validation:**
- Fresh local Supabase reset through migrations 001–086
- Archive export, restore, compaction, and Gradex database contract scripts
- Full Vitest suite (339 files / 3,037 tests)
- `pnpm exec tsc --noEmit`
- `pnpm lint`
- `pnpm build`
- Pika pre-commit audit
- `git diff --check`

## 2026-07-14 — Archive stack consolidation CI fix

**Completed:**
- Fast-forward merged reviewed archive PRs 852–866 into the final stack base without changing commit history.
- Fixed the consolidated recovery drill after CI exposed a stale duplicate of the restore object-path algorithm; the drill now calls the production canonical path helper.
- Kept PR 851 unmerged from `main` until its refreshed required checks pass. No production state was accessed or modified.

**Validation:**
- Local full archive recovery drill passed twice, including row equality, object equality, and idempotent replays
- Focused restore unit suite (1 file / 9 tests)
- `pnpm exec tsc --noEmit`
- `pnpm lint`

## 2026-07-14 — Read-only production classroom archive inventory

**Risk profile:** runtime-platform

**Model recommendation:** GPT-5 Codex - production verification crosses Supabase target safety, archive graph consistency, privacy-safe reporting, and fail-closed storage evidence.

**Completed:**
- Added a target-bound, read-only inventory command that requires the exact hosted Supabase project ref, validates deployed archive and Gradex contract rows, audits exposed PostgREST relationship metadata, and traverses the canonical 42-resource graph with exact-count pagination.
- Bound the separately required direct PostgreSQL catalog audit to the same expected project ref for direct or Supabase pooler DSNs and required TLS.
- Hardened the catalog runner against libpq DSN overrides and credential disclosure by allowlisting one TLS parameter, passing validated fields through `PG*` environment variables, sanitizing failures, and requiring either a hosted project ref or explicit loopback-only local mode.
- Bracketed each hot archived classroom read with archive revisions, resolved managed objects through exact Storage metadata reads, and emitted only aggregate labels, counts, and byte sizes; missing referenced objects fail the command.
- Ran the inventory against production after migrations 080-086 were applied: three hot archives, 44,813 relational rows, 42.2 MiB canonical relational payload, 165 referenced objects / 25.9 MiB, and zero missing objects or archive/restore/Gradex/cleanup operation rows.
- Kept the archive epic unfinished. PostgREST metadata cannot prove hidden or stale catalog relationships, so the direct read-only PostgreSQL catalog audit remains required; no export, restore, Gradex, compaction, cleanup, row mutation, or Storage mutation was performed.

**Validation:**
- Final production read-only inventory passed after all review fixes
- Full Vitest suite (345 files / 3,080 tests)
- Focused inventory, catalog-runner, and service-client suites (35 tests)
- Local read-only PostgreSQL catalog audit (117 foreign-key relationships)
- `pnpm exec tsc --noEmit`
- `pnpm lint`
- `pnpm check:architecture`
- `pnpm build`
- `git diff --check`

## 2026-07-14 — Assessment draft validation boundary

**Risk profile:** none

**Model recommendation:** GPT-5 Codex - cross-module boundary extraction benefits from repository-wide import analysis and behavior-parity verification.

**Completed:**
- Moved browser-safe assessment draft validation into the feature-owned `@/lib/validations/assessment-drafts` module while keeping persistence and database synchronization in `@/lib/server/assessment-drafts`.
- Split browser, blueprint, route, and server imports so pure modules no longer reach through the server boundary for validation contracts or draft types.
- Removed all four remaining deletion-only architecture allowances; the architecture check now covers 588 modules with zero allowances.
- Removed stale route-test validator stubs so invalid draft payload tests exercise the real validation boundary.
- Deleted the unused `syncAssessmentMetadataFromDraft` server export after CI coverage exposed that production performs the richer test metadata update directly in the route.
- No behavior, UI, database schema, dependency, migration, or production changes.

**Validation:**
- Focused assessment draft, route, and architecture suites (4 files / 34 tests)
- `pnpm test` (345 files / 3,081 tests)
- `pnpm vitest run --coverage --maxWorkers=1` (server assessment drafts: 66.67% lines, 95% functions, 65.74% statements)
- `pnpm build`
- `pnpm exec tsc --noEmit --pretty false`
- `pnpm lint`
- `pnpm check:architecture`
- `node scripts/trim-session-log.mjs --check`
- `node scripts/features.mjs validate`
- `git diff --check`

## 2026-07-14 — Assignment grading request boundary

**Risk profile:** none

**Model recommendation:** GPT-5 Codex - feature-boundary extraction requires repository-wide dependency analysis and exact API contract preservation.

**Completed:**
- Moved single-student and selected-student assignment grading request normalization into the feature-owned `@/lib/validations/assignment-grading` Zod contract.
- Kept assignment ownership, enrollment checks, and grade persistence in `@/lib/server/assignment-grades`; both routes now consume parsed contract values.
- Preserved legacy validation messages, ordering, score coercion, draft blanks, selected-ID filtering/deduplication, authentication-before-parse behavior, and the batch-only `apply_target` contract.
- Removed both grading routes from the deletion-only API Zod baseline, reducing existing migration debt from 62 routes to 60.
- Completed two independent review/fix rounds with no remaining findings.
- No UI, database schema, migration, dependency, or production changes.

**Validation:**
- Focused grading, API handler, and architecture suites (6 files / 33 tests)
- `pnpm vitest run --coverage --maxWorkers=1` (346 files / 3,098 tests; assignment grading validation: 96.36% lines, 100% functions)
- `pnpm build`
- `pnpm exec tsc --noEmit --pretty false`
- `pnpm lint`
- `pnpm check:architecture` (589 modules / 0 allowances)
- `git diff --check`

## 2026-07-14 — Atomic assignment grading and feedback expand release

**Risk profile:** async-grading

**Model recommendation:** GPT-5 Codex - transactional grading, concurrent roster changes, runtime response contracts, and rolling database deployment require cross-layer invariant analysis.

**Completed:**
- Added expand-only migration 087 with service-role atomic RPCs for manual and AI grades, AI run/item completion, repository review completion, and single/batch feedback returns.
- Added optimistic document revisions, assignment/classroom locking, replay-safe terminal operations, final-score validation, and all-or-none grade/result persistence.
- Routed native AI, Gradex, repository review, and teacher feedback flows through typed server boundaries; feedback returns now submit the browser-observed document revision.
- Added Zod contracts for assignment identifiers, grading and return payloads, and successful Gradex runtime responses; malformed successful responses fail before grade persistence.
- Added a live database/concurrency harness, migration contract tests, route/service tests, and completed teacher/student desktop/mobile visual verification.
- Documented the migration-first expand deployment and the separately numbered contract migration required only after all old application instances are drained.
- Completed repeated independent database and TypeScript reviews with no remaining findings. No production database or Storage changes were made.

**Validation:**
- `pnpm test` (350 files / 3,159 tests)
- Atomic assignment database/concurrency harness
- `pnpm build`
- `pnpm exec tsc --noEmit --pretty false`
- `pnpm lint`
- `pnpm db:types:check`
- `pnpm check:architecture` (592 modules / 0 allowances)
- Pika pre-commit audit
- `bash scripts/verify-env.sh`
- `git diff --check`

## 2026-07-14 — Manual test grading workflow boundary

**Risk profile:** async-grading

**Model recommendation:** GPT-5 Codex - grading request compatibility and persistence extraction require exact cross-layer behavior analysis.

**Completed:**
- Replaced the handwritten manual test-grade decoder with a feature-owned Zod contract while preserving score coercion, rounding, trim behavior, clear semantics, AI audit metadata, and duplicate rejection.
- Extracted teacher access, enrollment/question validation, existing-response preservation, grade row construction, and the legacy AI-column retry into `@/lib/server/test-grades`.
- Kept the existing non-transactional persistence sequence unchanged for this behavior-preserving expand slice; atomic test grading remains a separately reviewed follow-up.
- Made malformed JSON and JSON `null` fail deterministically with 400 responses instead of accidental internal errors.
- Removed the route from the deletion-only API Zod baseline and added regressions for access arguments, archive protection, query failures, question scope, score caps, clear fields, timestamps, and failed compatibility retries.
- Completed two independent review/fix rounds with no remaining findings. No UI, database schema, migration, dependency, or production changes.

**Validation:**
- Focused grading contract, route, and API architecture suites (3 files / 33 tests)
- `pnpm test` (351 files / 3,186 tests)
- `pnpm exec tsc --noEmit --pretty false`
- `pnpm lint`
- `pnpm check:architecture` (594 modules / 0 allowances)
- Pika pre-commit audit
- `git diff --check`

## 2026-07-14 — Atomic student test attempt expand phase

**Risk profile:** async-grading

**Model recommendation:** GPT-5 Codex - student autosave, final submission, lifecycle locks, and rolling database deployment require cross-writer concurrency analysis.

**Completed:**
- Added expand-only migration 088 with service-role RPCs that atomically save partial attempts and atomically commit final responses with the owning submitted attempt.
- Serialized submit/save against test close, per-student availability changes, question mutations, classroom archival, enrollment removal, and single/bulk attempt deletion through a consistent parent lock order.
- Preserved placeholder-response behavior, automatic multiple-choice scoring, open-response grading state, normalized legacy response payloads, and best-effort versioned history after database commit.
- Routed student autosave and final submit through feature-owned Zod and server boundaries; removed both routes from the API Zod migration baseline.
- Added forward-compatible 409 handling for the later strict question-immutability contract without enforcing it in migration 088, so old app instances remain compatible during migration-first rollout.
- Added an ephemeral database harness covering privileges, partial/final saves, validation rollback, forced post-insert rollback, double submit, availability/close/delete/autosave races, cascade deletion, and coherent final state.
- Completed repeated independent SQL and TypeScript review/fix rounds with no remaining findings. No migration or production state was applied or changed.

**Deployment obligation:**
- Apply migration 088 before deploying this app version.
- After deploying and draining all old app instances, add a separately numbered contract migration for semantic question immutability; do not add that enforcement to migration 088.

**Validation:**
- Focused student attempt/submit, validation, question compatibility, and architecture suites (8 files / 79 tests)
- `pnpm test`
- `pnpm build`
- `pnpm exec tsc --noEmit`
- `pnpm lint`
- `pnpm check:architecture` (596 modules / 0 allowances)
- `bash -n` and `shellcheck` for the database harness
- Pika pre-commit audit
- `git diff --check`

## 2026-07-15 — Production classroom archive canary runner

**Completed:**
- Added a production-only prepare/execute/resume CLI bound to one hosted project, teacher,
  archived-hot classroom, immutable mode-0600 plan, clean deployed commit, exact acknowledgement,
  and deterministic export/compact/restore operation UUIDs.
- Added exact pre/archive/restored-projection evidence across all 42 classroom resources and every
  source object, full manifest and operation metadata auditing, original/restored object byte checks,
  source-revision equality, pre/post database sizing, and a conservative restore safety margin.
- Kept every source/Gradex cleanup gate disabled and proved cleanup rows, reservations, restore
  staging, and upload-cleanup state remain untouched or empty after immediate restore.
- Added crash recovery for cold state, transient state/archive reads, ambiguous coordinator results,
  journal failure, and hot state after restore completion. Evidence files reject symlink traversal and
  unsafe permissions.
- Updated lifecycle/testing/operator documentation and current context. Production migrations 001-096,
  read-only inventory, and hosted catalog audit were previously verified; no mutation canary ran in
  this branch.
- Completed repeated independent production-safety/data-integrity review and fix rounds.

**Validation:**
- Production canary contract suite (14 tests)
- `pnpm vitest run` (363 files / 3,329 tests)
- `pnpm build`
- `pnpm exec tsc --noEmit`
- `pnpm db:types:check`
- `pnpm lint`
- `pnpm check:architecture` (600 modules / 0 allowances)
- Pika pre-commit audit
- `git diff --check`

## 2026-07-15 — Gradebook workflow boundary

**Completed:**
- Reduced the gradebook API route from 1,127 lines to a transport-only handler backed by a feature-owned server workflow and Zod request contracts.
- Preserved roster paging, 50-ID chunking, 1,000-row pagination, legacy-column fallbacks, assessment ordering, status calculation, summaries, and response shape while reusing the shared query-chunks infrastructure.
- Moved `ApiError` into a framework-neutral module so server workflows do not depend on Next transport types; `api-handler` re-exports the same class for compatibility.
- Tightened assessment weight input to string IDs and integer/decimal-digit weights, retained the intentional legacy-category `410`, and removed the route from the API Zod baseline.
- Narrowed missing-table detection so partial migrations fail visibly instead of silently hiding tests; added route, validation, migration-compatibility, and architecture regressions.
- Completed independent behavior/authorization and API/Zod review-fix rounds with no remaining findings. No UI, migration, dependency, or production changes.

**Validation:**
- Focused gradebook/API/error/architecture suites (5 files / 75 tests)
- `pnpm check:architecture` (602 modules / 0 allowances)
- `pnpm exec tsc --noEmit`
- `pnpm lint`
- `pnpm vitest run` (361 files / 3,322 tests)
- `pnpm build`
- `git diff --check`

## 2026-07-15 — Legacy quiz gradebook and archive compatibility decision

**Completed:**
- Removed the inactive quiz category from gradebook calculation inputs/results while retaining null/empty API response tombstones for older clients.
- Added an architecture guard that allowlists gradebook dependencies and quiz tombstones, forbidding legacy quiz identifiers from active calculation and persistence code.
- Classified legacy quiz gradebook rows as archival data and kept the version 3 course-package `quizzes` flag serialized but permanently normalized to `false`.
- Removed dead quiz-table fixtures from gradebook tests and added encoded package compatibility regressions.
- Expanded the archive database restore harness with non-empty quiz, question, response, and manual-override rows; the existing exact-table equality audit now proves they survive staging and final restore.
- Documented that schema retirement remains blocked on an archive adapter, production inventory, and production verification. No production state or schema was changed.
- Completed an independent review/fix loop; four guardrail findings were fixed and final rereview returned no findings.

**Validation:**
- Focused gradebook/package/archive suites (54 tests)
- Classroom archive restore database contract harness
- `pnpm vitest run` (361 files / 3,324 tests)
- `pnpm build`
- `pnpm exec tsc --noEmit`
- `pnpm lint`
- `pnpm check:architecture` (602 modules / 0 allowances)
- `bash -n scripts/check-classroom-archive-restore-database.sh`
- `git diff --check`

## 2026-07-15 — Legacy quiz alias retirement

**Completed:**
- Removed unused quiz server access/re-export modules, quiz-named assessment helper aliases, zero-caller `Quiz*` domain/draft/markdown type aliases, and obsolete test factories.
- Preserved persisted quiz tables/discriminants, archive resources, draft synchronization, markdown behavior, API payload aliases, gradebook tombstones, URLs, and UI compatibility props.
- Added a TypeScript module-resolution/export-graph regression that prevents retired modules or public aliases from returning through direct exports, re-exports, or replacement index modules.
- Removed stale Vitest coverage thresholds for deleted quiz modules and API routes, and corrected architecture/cleanup documentation.
- Completed independent behavior and architecture/config review-fix loops; six findings were fixed and final rereviews returned no findings. No UI, migration, dependency, or production changes.

**Validation:**
- Focused assessment/access/architecture suites (4 files / 90 tests)
- `pnpm vitest run` (361 files / 3,308 tests)
- `pnpm build`
- `pnpm exec tsc --noEmit`
- `pnpm lint`
- `pnpm check:architecture` (599 modules / 0 allowances)
- Pika pre-commit audit
- `git diff --check`

## 2026-07-15 — Legacy quiz draft alias retirement

**Completed:**
- Removed the zero-caller `validateQuizDraftContent`, `buildQuizDraftContentFromRows`, and `syncQuizQuestionsFromDraft` wrapper exports and their identity-only assertions.
- Preserved persisted `assessment_type = 'quiz'`, assessment-named legacy draft behavior, `quiz_questions`/`quiz_id` synchronization, archive resources, markdown compatibility, API aliases, and UI props.
- Strengthened the legacy alias architecture regression to inspect resolved exports across every TypeScript module under `src`, preventing aliases from returning through unrelated re-exports.
- Completed independent behavior and architecture review/fix loops; one guard bypass finding was fixed and final rereviews returned no findings. No UI, schema, dependency, or production changes.

**Validation:**
- Focused draft/architecture suites (2 files / 16 tests)
- `pnpm vitest run` (361 files / 3,307 tests)
- `pnpm build`
- `pnpm exec tsc --noEmit`
- `pnpm lint`
- `pnpm check:architecture` (599 modules / 0 allowances)
- Pika pre-commit audit
- `git diff --check`

## 2026-07-15 — Classroom archive source ownership fence

**Completed:**
- Added migration 096 to make assignment-artifact source deletion require a bounded, transactional ownership verification and a permanent SHA-256 path reservation.
- Serialized verification against artifact references, Storage writes, cleanup-ledger staging, and stale-worker deletion; reset pre-fence leases and rejected unreconciled historical deletions.
- Restricted cleanup claims, lease transitions, and exact Storage presence checks to service-owned database contracts with explicit privilege tests.
- Kept source cleanup manual, default-off, unscheduled, operation-scoped, and limited to one object per invocation; submission images and test documents remain preserved until they have authoritative relational registries.
- Expanded the database harness with live multi-session races and the recovery drill with exact export, cleanup, byte-identical restore, replay, and deidentified-fence retention checks.
- Completed repeated runtime and database review/fix rounds. No production state was read or modified by this phase.

**Deployment obligation:**
- Apply migration 096 before deploying this app version.
- Run hosted catalog audit and named canaries read-only before enabling any source cleanup; keep cleanup disabled unless both explicit gates and an exact completed operation ID are supplied.

**Validation:**
- Classroom archive source-cleanup route/server/migration suites (33 tests)
- `pnpm vitest run` (362 files / 3,317 tests)
- Classroom archive compaction database contract harness, including concurrent verifier/reference/Storage/staging races
- Classroom archive full recovery drill (42 resource tables; exact restore and replay)
- `pnpm build`
- `pnpm exec tsc --noEmit`
- `pnpm db:types:check`
- `pnpm lint`
- `pnpm check:architecture` (599 modules / 0 allowances)
- Pika pre-commit audit
- `git diff --check`

## 2026-07-15 — Production archive canary retry and recovery hardening

**Completed:**
- Hardened restore storage read-back, unexpected transport failures, durable failure recording, and terminal best-effort cleanup so retries retain the fixed operation ID without deleting reused objects.
- Added an independent archive-to-restored evidence oracle covering all resource rows, nested storage references, canonical public URLs, object identity, byte size, and SHA-256 bindings; the production canary no longer verifies restore output from its own restore plan.
- Made the canary reconcile thrown restore calls against durable hot/cold state and retry the fixed operation ID up to three times.
- Added migration 097 to preserve concurrent retryable restore failures and safely rearm exact expired requests. Expiry recovery now fences active cleanup leases, rolls back transient rearm state when delegated begin fails, and recovers a naturally expired snapshot in one call.
- Expanded the database contract drill for same-ID finalization races, active cleanup leases, delegated-failure rollback, and expiry recovery. Completed repeated independent review/fix loops covering restore safety, equality evidence, SQL concurrency, privilege boundaries, and cleanup ownership.
- No production canary, source cleanup, Gradex cleanup, or migration application was performed.

**Deployment obligation:**
- Apply migration 097 before deploying or running the production canary.
- Keep source cleanup and Gradex cleanup disabled. Prepare a fresh named canary plan after production is on the reviewed commit; do not reuse the obsolete local plan.

**Validation:**
- Focused archive restore/canary/migration suites (4 files / 37 tests)
- `pnpm vitest run` (364 files / 3,345 tests)
- `pnpm build`
- `pnpm exec tsc --noEmit`
- `pnpm check:architecture` (600 modules / 0 allowances)
- Bash syntax validation for the restore database contract drill
- Pika pre-commit audit
- `git diff --check`
- `pnpm db:types:check` intentionally blocked because local database history remains at 096 and AI did not apply migration 097

## 2026-07-15 — Production archive canary timeout hardening

**Completed:**
- Verified production migrations 001-097, released the reviewed archive recovery changes, and prepared a fresh named canary against the exact production deployment.
- Completed the approved production export for one archived-hot classroom: 42 relational resources and 20 source objects were captured in a 2,489,962-byte compressed archive with independent evidence.
- Kept the classroom hot after two same-operation compaction attempts rolled back atomically. No source or Gradex cleanup ran; all 20 source cleanup rows remain staged and no ownership verification or deletion attempt was recorded.
- Correlated both failures with PostgreSQL SQLSTATE `57014` in hosted logs: `complete_classroom_archive_compaction` exceeded the default statement timeout while finalizing the transition.
- Added migration 098 to set `statement_timeout = '60s'` only on the service-only compaction finalizer. Added source and replayed-database assertions that reject role- or database-wide timeout changes.
- Left migration application and the existing canary resume to a human. Independent subagent review was unavailable due to the account usage limit; local SQL review found no additional issue.

**Deployment obligation:**
- Apply migration 098 before resuming the existing fixed canary operation from its approved runner commit.
- Keep source cleanup and Gradex cleanup disabled. Resume the same plan; do not prepare a replacement operation or release a different runner before the round trip completes.

**Validation:**
- Focused archive timeout/compaction/migration suites (3 files / 11 tests)
- `pnpm vitest run` (365 files / 3,346 tests)
- `pnpm build`
- `pnpm exec tsc --noEmit`
- `pnpm check:architecture` (600 modules / 0 allowances)
- Bash syntax validation for the compaction database contract harness
- Pika pre-commit audit (no TypeScript files changed)
- `git diff --check`
- Database replay deferred to PR CI because local database history remains at 097 and AI did not apply migration 098

## 2026-07-15 — Explicit AI migration authorization policy

**Completed:**
- Replaced the blanket AI migration-application prohibition with a human-controlled-by-default contract that permits one exact application only after a current-task instruction names the target environment and exact migration.
- Required target verification, migration-list inspection, an explicit local/linked dry run, approved-set equality, applicable tests, and read-only post-application verification.
- Kept reset, migration-history repair, rollback/down, seeding, data cleanup, Storage deletion, alternate database URLs, project relinking, and extra push flags outside ordinary migration approval.
- Made failed or partial application attempts consume the permission and require renewed authorization before retry.
- Updated active agent, architecture, project, schema, archive, and legacy-contract guidance and added a regression that prevents blanket prohibition or overbroad authorization from returning.
- No migration or Supabase project state changed. During validation, a shell search expanded an inline command, but the unlinked worktree failed target resolution before preview or application; it was not retried.

**Validation:**
- Migration authorization and startup guidance suites (2 files / 29 tests)
- `pnpm vitest run` (366 files / 3,349 tests)
- `pnpm exec tsc --noEmit`
- `pnpm lint`
- `pnpm check:architecture` (600 modules / 0 allowances)
- `git diff --check`

## 2026-07-15 — Production archive round-trip canary completion

**Completed:**
- Applied the explicitly authorized migration 098 to the verified production target after a linked dry run proved it was the only pending migration. Production history is 001-098, and a hosted schema read-back confirmed `statement_timeout = '60s'` only on the atomic compaction finalizer.
- Resumed the existing immutable canary plan from its exact approved production commit and reused all three fixed operation IDs; no replacement plan or operation was created.
- Replayed the verified export, compacted 42 tables containing 20,184 rows in about 57 seconds, and restored the classroom on the first restore attempt in about 38 seconds. The retained archive contains 20 source objects and is 2,489,962 bytes compressed from 13,359,104 bytes.
- Passed the runner's independent archive/restored evidence oracle and a separate hosted-state query: one archived-hot classroom, no cold tombstone, one retained verified archive, three completed operations, and no restore residue.
- Kept all source and Gradex cleanup gates disabled. All 20 source cleanup rows remain pending with zero attempts, ownership verification, reservations, or deletions.
- Marked `epic-classroom-lifecycle-archives` passing; the feature inventory is now 13/13. A Gradex generation canary remains a separately approved optional rollout action, not an archive-epic completion requirement.

**Validation:**
- Production migration list and post-application dry run
- Hosted schema dump verification of the finalizer timeout, security, search path, comment, and service-role grant
- Named production export/compact/immediate-restore runner final evidence
- Independent Management API read-only lifecycle, operation, cleanup, reservation, and staging verification
- Source and Gradex cleanup remained disabled throughout

## 2026-07-16 — Product experience audit and phased architecture backlog

**Completed:**
- Audited the complete teacher/student product topology against the current UI canon, API/domain boundaries, database contracts, tests, accessibility behavior, and error states. Added explicit maps for authentication, classroom workflows, teacher utility routes, student utility history, Gradex, blueprints, and archive lifecycle.
- Captured 53 seeded-local product screenshots and 52 DOM/accessibility snapshots at desktop/mobile widths, plus two Open Design board-QA pairs. Committed 22 representative product pairs and two board-QA pairs after removing a credential-bearing local login capture during review.
- Used only local Supabase data. Temporarily set the seeded classroom to hot-archived to capture Restore/Delete, restored `archived_at` to `null`, and verified the fixture. No production system was read or modified.
- Built the Open Design project `Pika Product Experience Audit` (`ec89fd79-1229-4143-8f69-cf24842c6584`) through generation run `879efda2-651b-4b5c-aeba-111e43e0cab4` and review run `b503a4ba-f0c0-41df-85a5-6b349588c7e7`. Corrected its evidence model after review and browser-verified the final board at `1440x900` and `390x844`; mobile client and scroll width both measured 375px.
- Ranked data integrity first: unsafe hot-archive deletion, stale assignment submission after failed save, broken dashboard entry authorization, blueprint v2/v3 contract drift, and invalid active-classroom Delete commands on teacher utility routes.
- Added measurable exit evidence for all six phases, including shared UI contracts, vertical workflow slices, Gradex deidentification/ingestion/retention, end-of-course blueprint rollover, archive eligibility/restore equality, production authorization, and evidence-based legacy retirement.
- Resolved independent architecture and evidence reviews. Verified that blueprint v2/v3 drift is real: runtime/package guidance uses v3 while `COURSE_BLUEPRINT_TRANSFER_CONTRACT` and lifecycle guidance still declare v2. Registered the six-phase program as the active incomplete epic.

**Next:**
- Review and merge the Phase 1 audit PR.
- Start the first Safety Wave PR: disable the legacy permanent classroom Delete endpoint and UI. Any future hot-data removal must use only the archive compaction state machine.

**Validation:**
- Open Design static checks and browser review at desktop/mobile widths
- Representative screenshot visual inspection
- `pnpm lint`
- `pnpm run test:coverage` (366 files, 3349 tests)
- Pika pre-commit audit (no TypeScript files changed)
- `git diff --check`

## 2026-07-16 — Safety Wave: retire legacy classroom deletion

**Completed:**
- Removed the classroom-level `DELETE /api/teacher/classrooms/[id]` handler and the archived-index, legacy-dashboard, and top-level-calendar deletion controls. Deleted the orphaned `useDeleteClassroom` hook.
- Preserved archive, hot restore, cold restore, and verified compaction behavior. Permanent hot-data removal remains exclusive to the archive compaction state machine.
- Added API and component regressions proving the route exports no `DELETE` handler, archived classrooms are restore-only, and teacher utility surfaces issue no classroom deletion request.
- Corrected the Pika audit matcher so route-specific tests for generic `page.tsx` files are recognized only through exact static/dynamic imports. Added negative coverage for prefix collisions and line, trailing, and block comments.
- Browser-verified teacher archived, dashboard, and calendar states plus the student classroom index at desktop/mobile widths and light/dark archived states. Populated legacy utility captures reconfirmed the already-ranked mobile overflow findings; this PR did not broaden into that Phase 2 work. Restored the seeded classroom to active afterward.
- Completed repeated independent review/fix loops. Both final reviewers reported no actionable findings. No production system was read or modified.

**Validation:**
- Focused deletion-retirement and audit suites (5 files / 67 tests)
- `pnpm run test:coverage` (366 files / 3,353 tests)
- Teacher calendar readiness suite repeated 50 times after CI race hardening
- `pnpm build`
- `pnpm exec tsc --noEmit`
- `pnpm lint`
- `pnpm check:architecture` (599 modules / 0 allowances)
- Bash syntax validation for the Pika audit script
- Pika pre-commit audit
- `git diff --check`

## 2026-07-16 — Phase 2 assignment save and submission integrity

**In progress:**
- Replaced split assignment draft, submit, unsubmit, and combined assignment/requirement writes with migration-first atomic RPC contracts, revision fences, advisory-lock ordering, durable save-operation replay evidence, and bounded authenticity metric checkpoints.
- Hardened the student editor for immutable retry payloads, response and body timeouts, exact ambiguity reconciliation, persistent tab writer identity, monotonic recovery generations, 30-day recovery expiry, same-content metric replay, stale page-exit responses, and restore deferral.
- Added authoritative submit-history enforcement, submitted-content and artifact immutability guards, legacy-writer compatibility, archive-restore normalization, and a 35-day save-ledger cleanup while preserving the 42-resource archive contract.
- Added durable provisional evidence and a leased cleanup cron for assignment image Storage objects. Upload and row-commit ambiguity are reference-aware; shared paths are not deleted; failed cleanup remains retryable.
- Added strict Zod request boundaries and validating, additive-compatible RPC response decoders that strip unknown future fields before returning older app shapes.
- Added migration 099, atomic and live-concurrency SQL harnesses, CI database-contract gates, rollout guidance, generated type coverage, and a narrow Pika-audit exemption for the canonical `parseContentField` implementation.
- Multiple review rounds found and fixed retry, metric, recovery, artifact cleanup, RPC compatibility, migration-upgrade, lock-order, privilege, timeout, and test-coverage issues. Final client, API, and database rereviews returned no actionable findings.
- Opened PR #891. Its first architecture-database run exposed three stale-revision setups in the pre-existing feedback-return harness that directly edited submitted content. Replaced those setup writes with allowed feedback-draft revisions so the harness continues testing serialization without violating migration 099's submitted-content guard.
- The next CI run exposed a synthetic archive ownership race row that referenced no assignment document. Rebuilt the fixture with a real active classroom, assignment, unsubmitted document, and requirement so migration 099's document guard runs normally and the existing archive path reservation still proves serialization.
- Closed the remaining assignment utility coverage branches for default release clocks and returned documents missing a submission timestamp. The full coverage gate is back to 100% for `src/lib/assignments.ts`.
- The subsequent real archive round-trip exposed an empty-`search_path` restore wrapper resolving its deferred constraint by an unqualified name. Schema-qualified the migration 099 constraint flush and tightened its migration contract test.
- The full recovery drill then exposed a stale fixture sequence that inserted a submitted document before its required artifact. The drill now creates an unsubmitted document, attaches its requirement and artifact, and only then submits through the guarded update path. It also verifies submit-history source/restore equality and removes and checks its artifact-cleanup ledger during teardown; a source contract preserves those checks.
- No production data, Storage, migration history, or deployment was read or modified.

**Deployment obligation:**
- Apply and verify migration 099 before deploying this application version. Leave migration 099 in place if the app rolls back; do not deploy the new writers before it.
- Migration application remains human-controlled and requires exact one-time permission naming the target and migration 099.

**Validation:**
- Focused assignment client/API/server suites, including 46 editor save/submit tests and additive-schema/ambiguous-upload regressions
- `pnpm test:coverage` (375 files / 3,483 tests; `src/lib/assignments.ts` at 100%)
- `pnpm build`
- `pnpm exec tsc --noEmit`
- `pnpm lint`
- `pnpm run check:architecture` (604 modules / 0 allowances)
- Atomic assignment SQL transaction harness
- Assignment concurrency harness against a disposable 001-099 database replay
- Atomic feedback-return harness against a disposable 001-099 database replay after the CI compatibility fix
- Classroom archive compaction database contract against a disposable 001-099 database replay after the relational race-fixture fix
- Real classroom compaction and resumable restore round trip against a disposable 001-099 database replay after the schema-qualified constraint fix
- Recovery-drill fixture ordering contract plus TypeScript validation after the migration 099 compatibility fix
- Generated database types match the normalized disposable 001-099 schema
- Pika pre-commit audit
- `git diff --check`
- Local Playwright verification on the assignment surfaces: student editor and restore dialog on desktop/mobile in light/dark; teacher assignment list on desktop/mobile in light/dark
- The student autosave response was mocked in-browser because local migration 099 is intentionally unapplied; final captures had no console errors and no database write was sent

**Remaining before merge:**
- Push the CI compatibility and integration-fixture fixes, wait for PR checks and review, then merge only after the required migration-first deployment obligation is clear.

## 2026-07-17 — Assignment cloned-tab writer-fence review fix

**Completed:**
- Fixed the PR #891 review finding where a live assignment save-session identity persisted in cloneable `sessionStorage` could be inherited by a duplicated tab. A stale page-exit save from that tab could otherwise be mistaken for a same-editor superseding save and bypass the database revision conflict.
- Made each mounted student assignment editor use a fresh writer identity and sequence. Exact uncertain operations still retain and replay their original immutable save identity from durable recovery evidence.
- Replaced the cross-remount identity-reuse test with a regression proving copied writer state is ignored and a remounted editor starts a distinct fence at sequence one.
- Did not read or modify production, apply migration 099, merge the PR, or advance the broader phased product-experience goal.

**Validation:**
- `pnpm test` (375 files / 3,484 tests)
- Focused assignment integrity suites (3 files / 68 tests)
- `pnpm exec tsc --noEmit`
- `pnpm lint`
- `pnpm run check:architecture` (604 modules / 0 allowances)
- Pika pre-commit audit
- `git diff --check`

**Remaining before merge:**
- Push the review fix, wait for PR checks, and rereview PR #891. Migration 099 must still be applied and verified before the application version is deployed.

## 2026-07-18 — Assignment submit/recovery race review fixes

**Completed:**
- Ran independent Sol/high database, client-state, and integration reviews of PR #891 after CI passed. The client review found and fixed four ordering/recovery defects: a conflict catch overwriting a newer durable draft, edits arriving during a successful submit being shown or cleared incorrectly, queued save reconciliation being cleared by a later submit response, and a definitively rejected equal-content recovered operation retaining a stale writer fence.
- Added a synchronous preserved-draft reference so the submitted server snapshot remains authoritative while newer local content survives save/submit response reordering and can be restored after unsubmit.
- Replaced stale recovered operations with a fresh mount-local writer identity and refreshed revision while retaining the original metric-session identity and cumulative counters for database deduplication.
- Added behavior regressions for all four races. Final independent rereviews reported no findings and confirmed the tests fail against the prior implementation.
- No production data, Storage, migration history, deployment, or visible layout was modified.

**Validation:**
- `pnpm test` (375 files / 3,487 tests)
- Focused assignment integrity suites (3 files / 71 tests)
- `pnpm exec tsc --noEmit`
- `pnpm lint`
- `pnpm run check:architecture` (604 modules / 0 allowances)
- Pika pre-commit audit
- `git diff --check`

**Remaining before merge:**
- Push the final review fixes and wait for PR checks. Migration 099 still requires exact one-time target authorization and must be applied and verified before this application version is deployed.

## 2026-07-18 — Production assignment integrity migration

**Completed:**
- Applied only migration `099_assignment_submission_integrity_guards.sql` to the linked production Pika project after exact one-time authorization and a clean dry run.
- Verified production migration history is aligned through 099, both new ledger tables have RLS enabled, the writer-fence columns are present, and the four application RPCs exist with execution granted to `service_role` but denied to `anon` and `authenticated`.
- No reset, repair, rollback, seed, cleanup, Storage deletion, or application deployment was performed.

**Validation:**
- `supabase migration list --linked` records migrations 001-099
- Read-only production catalog checks for RPC signatures, role grants, RLS, save RPC overload count, and assignment document columns
- PR #891 CI: architecture/database contracts, full test/build, and UI policy checks passed before application

**Remaining:**
- Merge PR #891 to deploy the application version that uses migration 099, then continue the product-experience program.

## 2026-07-18 — Enforce chronological session-log retention

**Completed:**
- Updated the session-log trimmer to order ISO-dated entries chronologically before retaining or archiving them while preserving source order for same-day entries.
- Made check mode reject chronological drift so CI catches future merge-order mistakes.
- Made archive appends idempotent with deterministic path-normalized per-trim batch markers so failed output writes can be retried without duplicating history or collapsing identical entries; added forced-failure, duplicate-entry, and equivalent-path recovery coverage after independent review.
- Made trim and check modes reject undated or invalid entry headings instead of guessing whether they belong in the latest retention window; aligned startup guidance after independent review.
- Repaired the rolling log's existing July 13-15 ordering drift and added focused regression coverage.

**Validation:**
- `bash .codex/skills/pika-session-start/scripts/session_start.sh`
- `pnpm test tests/unit/trim-session-log.test.ts tests/unit/ai-startup-docs.test.ts` (2 files / 41 tests)
- `pnpm lint`
- `node --check scripts/trim-session-log.mjs`
- `node scripts/trim-session-log.mjs --check`
- `git diff --check`

## 2026-07-20 — Migration 099 local seed compatibility

**Completed:**
- Fixed `pnpm seed` for databases with migration 099 by creating assignment documents as editable, inserting their baseline/autosave/blur history, and only then finalizing submitted documents.
- Let migration 099's deferred constraint trigger create each authoritative submit snapshot, preserving the database invariant that editable history cannot be written after submission.
- Aligned the synthetic writing timelines with the existing 4-day and 2-day submission dates so grading fixtures remain chronologically valid.
- Added unit and source-order regression coverage for history partitioning and seed lifecycle ordering.
- Derived the earliest returned-feedback timestamp from the generated submission time after review found an early-day chronology edge case.
- Re-ran `pnpm seed` against the authorized loopback database; the complete classroom, assignment-review, and test fixtures now seed successfully. No production resources were accessed or modified.

**Validation:**
- `pnpm test` (376 files / 3,495 tests)
- `pnpm exec tsc --noEmit`
- `pnpm lint`
- `pnpm seed` against the loopback Supabase database through migration 099
- Direct loopback database checks: one submit row per submitted document, matching content snapshots, all editable history before submission, and returned feedback after submission
- `git diff --check`

**Audit note:**
- The Pika pre-commit audit reports the existing CLI progress `console.log` calls throughout `scripts/seed.ts` after that file is touched. No new production logging path was introduced; this is a whole-file false positive for the development seed CLI.

## 2026-07-20 — Teacher dashboard entry authorization contract

**Completed:**
- Replaced the teacher dashboard's unauthorized `/api/student/entries` read with an exact student/day query through the teacher-owned student-history route.
- Added a named Zod query contract for classroom, student, exact/paged date, and bounded limit inputs while preserving authentication-first handling.
- Kept classroom ownership and enrollment checks ahead of entry access, and added regressions for foreign classrooms, unenrolled students, exact-date filtering, and the dashboard endpoint choice.
- Preserved the existing 50-row cap for oversized history limits and rejected ambiguous exact/paged date filters after independent review.
- Verified the route against local Supabase with a teacher session: the teacher endpoint returned the selected entry and the old student endpoint returned HTTP 403.
- No schema, migration, production data, or visible UI layout changed.

**Validation:**
- `pnpm test` (376 files / 3,501 tests)
- Focused dashboard, teacher entry/history, consumer, and API boundary suites (5 files / 23 tests)
- `pnpm exec tsc --noEmit`
- `pnpm lint`
- `pnpm check:architecture` (605 modules / 0 allowances)
- Live loopback teacher authorization and exact-entry query
- `git diff --check`

**Remaining:**
- Independently review PR #894. After merge, reconcile the blueprint package v2/v3 contract as the final uncompleted Safety Wave item before Phase 2.

## 2026-07-20 — Blueprint package version contract reconciliation

**Completed:**
- Merged PR #894, fast-forwarded the hub to `origin/main`, and removed its clean feature worktree and local branch.
- Made course package version 3 the shared canonical export and lifecycle contract while explicitly retaining version 2 import compatibility.
- Added a focused Zod boundary for package manifests and files so malformed and unsupported versions fail before operation planning; server operations now consume validated manifest metadata rather than the original request value.
- Preserved legacy version 2 course content while intentionally ignoring retired `quizzes.md` content, with a checked-in compatibility fixture and bundle/tar regressions.
- Made v3 file membership strict, bounded HTTP and tar input size/counts, and rejected unknown or duplicate archive entries after independent review; removed the import route from the API validation debt baseline.
- Added byte-aware per-file limits for both JSON and tar imports after rereview; the final independent rereview reported no actionable findings.
- Updated package and classroom lifecycle guidance to agree on current and supported versions. No database migration, production access, or visible UI change was required.

**Validation:**
- `pnpm test` (376 files / 3,514 tests)
- Focused package, artifact, server, API, documentation, and route-standard suites (6 files / 52 tests)
- `pnpm exec tsc --noEmit`
- `pnpm lint`
- `pnpm check:architecture` (606 modules / 0 allowances)
- `pnpm build`
- `git diff --check`

**Remaining:**
- Merge PR #895 after required checks/review. Phase 2 begins after that merge.

## 2026-07-20 — Phase 2 semantic-token contrast contract

**Completed:**
- Merged PR #895, completing the Product Experience Safety Wave and beginning Phase 2.
- Added a WCAG AA contract that evaluates semantic foreground/background pairs in both themes, including translucent selected and status surfaces.
- Split semantic foreground colors from opaque solid action fills, migrated filled controls to the new solid tokens, and corrected failing muted, status, accent, and selected-state combinations.
- Preserved a persistent selected-row cue in the gradebook after reducing the dark selected-surface opacity.
- Resolved all findings from two independent reviews, including omitted hover/subtle pairs, solid-fill opacity enforcement, inverse-text bypasses, and missing direct component coverage.
- Visually verified representative teacher and student routes at desktop/mobile sizes in light/dark themes, plus selected gradebook rows in both themes. No overflow, overlap, console, or page errors were found.

**Validation:**
- `pnpm test` (378 files / 3,523 tests)
- `pnpm exec tsc --noEmit`
- `pnpm lint`
- `pnpm build`
- `bash .codex/skills/pika-audit/scripts/audit.sh`
- `bash .codex/skills/pika-ui-verify/scripts/ui_verify.sh classrooms`
- Custom Playwright teacher/student desktop/mobile light/dark matrix and gradebook selected-row checks
- `git diff --check`

**Remaining:**
- Review and merge PR #896. Then implement Phase 2's shared modal-layer contract as a separate slice.

## 2026-07-20 — Phase 2 shared modal-layer contract

**Completed:**
- Reviewed and merged PR #896, then fast-forwarded the hub and started the next Phase 2 slice from current `main`.
- Added a portal-based `ModalLayer` that owns top-layer keyboard handling, initial focus, Tab containment, focus restoration, background inertness, scroll locking, stacking, Escape, and backdrop behavior.
- Preserved the canonical `AlertDialog`, `ConfirmDialog`, `DialogPanel`, and `ContentDialog` APIs while routing them through the shared layer; migrated classroom mobile left/right drawers without changing their visual design.
- Fixed independent-review findings for lifecycle churn while a confirmation becomes busy and reverse Tab containment when a custom panel owns focus; added regressions and narrowed documentation to migrated surfaces.
- Visually verified open dialogs and navigation drawers for teacher/student roles at desktop/mobile sizes in light/dark themes, including focus, inert background, scroll lock, Escape cleanup, and focus restoration.
- Opened PR #897. No schema migration or production data change was made.

**Validation:**
- `pnpm test` (381 files / 3,529 tests)
- `pnpm exec tsc --noEmit`
- `pnpm lint`
- `pnpm build`
- `bash .codex/skills/pika-audit/scripts/audit.sh`
- Custom Playwright teacher/student desktop/mobile light/dark open-state matrix
- `git diff --check`

**Remaining:**
- Review and merge PR #897. Continue Phase 2 with shared button target sizing/focus-visible behavior and semantic form-field propagation.

## 2026-07-21 — Internal test grading profile and provenance

**Risk profile:** async-grading

**Model recommendation:** GPT-5.4 - this phase crosses provider contracts, privacy boundaries, durable grading concurrency, revision fencing, and rolling database compatibility.

**Completed:**
- Moved test open-response prompts, strict output schemas, output budgets, and profile versions into the database-independent grading core while preserving Pika's sanitization, reference cache, score buckets, telemetry, and teacher workflows in the compatibility adapter.
- Routed direct and durable test grading through the shared structured-output provider executor with bounded, pseudonymous per-request provenance and complete retry token accounting.
- Added signed manual provenance propagation and migration `102` with service-role-only compatibility wrappers that atomically persist provenance without double-incrementing response revisions.
- Preserved provenance for teacher corrections, cleared stale provenance for legacy AI replacements and grade clears, and kept durable replay idempotent.
- Kept the remote Gradex worker disabled; no live provider calls, production changes, or local migration application were performed.

**Validation:**
- Focused grading/persistence suite (10 files / 114 tests)
- Full Vitest suite (403 files / 3,632 tests)
- `pnpm exec tsc --noEmit`
- `pnpm lint`
- `pnpm check:architecture` (620 modules / 0 allowances)
- `pnpm build`
- `bash -n scripts/check-atomic-test-grading.sh`
- `git diff --check`
- Migration replay, database harness, and generated-type drift check pending ephemeral CI

## 2026-07-21 — Phase 2 shared control and form-field contract

**Completed:**
- Merged PR #897 and began the next Phase 2 slice from current `main`.
- Standardized shared button, input, select, segmented-control, split-button, sortable-table, and split-pane interaction targets and focus-visible treatment without changing Pika's information-dense workflows.
- Made `FormField` the semantic owner for label association, required state, hints, errors, `aria-describedby`, `aria-errormessage`, and `aria-invalid` while preserving child IDs and existing descriptions.
- Kept hint and error content visible together, prevented custom props from leaking to native controls, and documented the one-control composition contract.
- Fixed review findings by expanding the split-pane divider target, reconciling the `FormField` docs, reserving the full mobile classroom switcher height, and forwarding generated field naming and validation semantics to the rich-text editor.
- Visually verified unauthenticated, teacher, and student surfaces across desktop/mobile and light/dark themes, including keyboard focus, form errors, the dense gradebook, and the student Today view. No overflow or layout regression was found.

**Validation:**
- `pnpm test` (383 files / 3,543 tests)
- Focused shared-control and integration suites (8 files / 69 tests)
- `pnpm exec tsc --noEmit`
- `pnpm lint`
- `pnpm check:architecture` (607 modules / 0 allowances)
- `pnpm build`
- `bash .codex/skills/pika-audit/scripts/audit.sh`
- `bash .codex/skills/pika-ui-verify/scripts/ui_verify.sh classrooms/07e8da7d-9a2a-4e74-b516-f5fe2bab1bf8?tab=attendance`
- Custom Playwright light/dark desktop/mobile focus, error, teacher, and student checks
- `git diff --check`

**Remaining:**
- Merge reviewed PR #898 after required CI. Then continue Phase 2 with page structure, typography, spacing, action placement, and responsive density as a separate slice.

## 2026-07-21 — Phase 2 shared page-structure contract

**Completed:**
- Merged PR #898 and began the next Phase 2 slice from current `main`.
- Promoted page framing into the canonical `@/ui` layer with named content widths, explicit teacher/student density, governed page and section headings, content stacks, and responsive action placement; retained the old component path as an incremental compatibility export.
- Preserved compact table-first teacher workflows and the existing implicit density for unmigrated callers while adopting the governed contract on teacher and student classroom indexes.
- Corrected the shared `AppShell` main region so default pages fill the available width instead of accidentally shrinking to their contents.
- Removed action-bar overrides that reduced shared controls below 44px and gave mobile menu items explicit target and focus-visible treatment.
- Visually verified teacher and student classroom indexes at desktop/mobile sizes in light/dark themes, including the open mobile menu. All eight role/viewport/theme cases had exact viewport width, no console/page errors, and focused 44px menu items.
- Opened PR #899. Initial independent architecture review found no actionable issues; accessibility review prompted additional disabled-item, ArrowUp, Home, and End menu coverage plus reconciliation of stale promotion guidance.
- Targeted remediation review prompted an explicit keyboard-activation regression proving Enter invokes the focused action, closes the menu, updates expanded state, and restores trigger focus.
- An explicitly approved final remediation batch scoped menu keys to menu focus, restored the startup-doc budget, and reconciled the remaining experimental page-scaffolding guidance.
- Final review retained legacy width compatibility, migrated Blueprints to the named wide contract, and made all-disabled mobile action groups non-openable.

**Validation:**
- Full `pnpm test` suite
- Focused page, shell, classroom-index, action-menu, and teacher-work-surface suites
- `pnpm exec tsc --noEmit`
- `pnpm lint`
- `pnpm check:architecture` (608 modules / 0 allowances)
- `pnpm build`
- `bash .codex/skills/pika-audit/scripts/audit.sh`
- `bash .codex/skills/pika-ui-verify/scripts/ui_verify.sh classrooms`
- Custom Playwright teacher/student desktop/mobile light/dark and menu-state matrix
- Composite widget checklist reviewed; keyboard behavior and semantic state are covered, with no remaining manual accessibility follow-up.
- `git diff --check`

**Remaining:**
- Complete targeted remediation review and merge PR #899 after required checks. Then continue Phase 2 with page-level loading, error, empty, and forbidden contracts.

## 2026-07-21 — Phase 2 governed page-state contract

**Completed:**
- Merged PR #899 and started Phase 2 item 5 from current `main` in a dedicated worktree.
- Added canonical `PageState` loading, error, empty, and forbidden variants with explicit live-region semantics, text-backed icons, optional actions, and compact work-region support.
- Added classroom route loading, error-boundary retry, and intentionally indistinguishable unavailable/access-denied states while preserving safe layout framing and route-away behavior.
- Migrated teacher dashboard and student history initial loading/empty behavior; failed classroom/history reads now render explicit retryable errors instead of valid-looking empty data.
- Added cache invalidation before client retries and direct regressions for state semantics, route boundaries, error/empty separation, and retry recovery.
- Documented the state decision table and App Router conventions in stable guidance.
- Visually verified teacher/student loading, error, and empty states plus classroom unavailable states at desktop/mobile sizes in light/dark themes. Governed states had no overflow or page errors, and retry/route-away controls measured 44px.
- Opened PR #900 for independent review; no schema, migration, API contract, or production data change was made.
- Fixed independent-review findings by separating attendance read failures from empty rosters, binding data to its owning classroom, routing roster-upload refresh through the same guarded coordinator, and rejecting stale entry-detail responses after class switches.
- Added deterministic focus recovery and page-level heading semantics, clarified shell behavior when protected identity data is unavailable, and made the teacher dashboard and student history stack cleanly on mobile without changing their table-first desktop workflow.

**Validation:**
- `pnpm test` (387 files / 3,569 tests)
- Focused page-state, classroom-route, teacher-dashboard, student-history, UI-guidance, and startup-doc suites
- `pnpm exec tsc --noEmit`
- `pnpm lint`
- `pnpm check:architecture` (610 modules / 0 allowances)
- `pnpm build`
- `bash .codex/skills/pika-audit/scripts/audit.sh`
- Composite-widget checklist reviewed; no composite widget behavior changed in this slice, while retry keyboard/focus behavior is covered directly.
- Custom Playwright teacher/student desktop/mobile light/dark loading/error/empty/forbidden and keyboard-retry matrix; all remediation cases had no overflow or page errors, 44px retry controls, and stable post-retry focus
- `git diff --check`

**Remaining:**
- Merge the independently reviewed page-state PR after required checks. Then continue Phase 2 with shared table, menu, tabs, segmented-control, and split-pane contracts.

## 2026-07-21 — Phase 2 composite-control contracts

**Completed:**
- Merged PR #900 and started Phase 2 item 6 from current `main` in a dedicated worktree.
- Promoted canonical `DataTable` and `Tabs` primitives into `@/ui`, retained the legacy table export for incremental compatibility, and migrated teacher Attendance, Assignments, Tests, Gradebook, Roster, document-editor, and work-surface callers.
- Standardized automatic tabs, roving segmented controls, Home/End menu navigation, keyboard table selection, stable row identity, split-pane and column-resize separators, focus-visible treatment, 44px interaction targets, and narrow-screen tab overflow.
- Fixed independent-review findings covering failed Attendance refreshes, legacy `aria-label` compatibility, extra tab-panel stops, mobile tab overflow, row-focus semantics and cancellation races, remount-safe Attendance focus restoration, and resize target sizing.
- Added governed composite-control guidance plus direct primitive and integration regressions. No schema, migration, API, production, or data change was made.
- Opened PR #902 after independent architecture and accessibility re-reviews. The final cumulative review then caught bubbled table shortcuts overriding nested inputs, failed Attendance reads falling through to empty-roster copy, and empty copy flashing during retry; all now have direct regressions and remediated behavior.
- Restored the startup-context budget after CI caught a 10-character overage in `.ai/CURRENT.md`.

**Validation:**
- `pnpm test --run` (390 files / 3,579 tests)
- Focused DataTable, Attendance, and startup regressions (3 files / 50 tests)
- `pnpm exec tsc --noEmit`
- `pnpm lint`
- `pnpm check:architecture` (612 modules / 0 allowances)
- `pnpm build`
- `bash .codex/skills/pika-audit/scripts/audit.sh`
- Teacher/student desktop/mobile light/dark visual matrix plus live Attendance ArrowDown selection, row focus, Escape deselection/focus restoration, retryable error desktop/mobile light/dark states, and overflow checks
- `git diff --cached --check`

**Remaining:**
- Merge PR #902 after required CI. Then continue Phase 2 with the next scoped shared-experience slice from the product-experience audit.

## 2026-07-21 — Phase 2 shared application navigation

**Completed:**
- Merged independently reviewed PR #902 as `14de9893`, fast-forwarded the hub, and started Phase 2 item 7 from current `main` in a dedicated worktree.
- Added a shared `AppNavigation` route-family mechanism with active-page semantics, stable prefix matching, 44px link targets, visible keyboard focus, and narrow-width horizontal overflow.
- Added an optional application-navigation region to `AppShell` and migrated the teacher utility layout from its duplicate logo/header/logout implementation to the canonical compact `AppHeader`, `UserMenu`, session watcher, and shared navigation band.
- Preserved the existing `Classrooms`, `Blueprints`, and `Calendar` destinations without adding a dashboard destination or changing classroom navigation, page content, API contracts, schema, production state, or data.
- Added direct navigation, shell-order, and teacher-layout regressions plus stable guidance for incremental utility-family migration.
- Browser-verified teacher Blueprints and Calendar at desktop/mobile widths in light/dark themes, including active-link focus and navigation-shell overflow isolation. The student mobile shell remained unchanged and overflow-free. Calendar's previously ranked narrow-screen content compression remains assigned to its Phase 3 vertical slice.
- Opened PR #903 for independent review.
- Accepted independent-review findings that the first implementation dropped the prior teacher-content gutters and used an outward focus ring that could be clipped by the navigation scroller. Restored the content geometry, moved focus treatment inside each link, and added a durable browser contract for every teacher utility route.

**Validation:**
- `pnpm test --run` (392 files / 3,584 tests)
- Focused application-navigation, app-shell, teacher-layout, and app-header suites (4 files / 12 tests)
- `pnpm exec tsc --noEmit`
- `pnpm lint`
- `pnpm check:architecture` (613 modules / 0 allowances)
- `pnpm build`
- `bash .codex/skills/pika-audit/scripts/audit.sh`
- Custom Playwright teacher desktop/mobile light/dark navigation matrix plus unchanged student mobile-dark regression (7 checks including auth setup)
- Durable Playwright teacher dashboard/Blueprints/Calendar desktop-light and mobile-dark navigation contract
- `node scripts/trim-session-log.mjs --check`
- `git diff --check`

**Remaining:**
- Complete full repository verification, independent review, and merge for the teacher navigation slice. Then migrate the student utility family as a separate Phase 2 item 7 PR.

## 2026-07-21 — Phase 2 student utility navigation

**Completed:**
- Merged independently reviewed PR #903 as `d157d4cf`, fast-forwarded the hub, and started the second Phase 2 item 7 slice from current `main` in a dedicated worktree.
- Migrated the student utility layout from its duplicate logo/header/logout implementation to the canonical `AppShell`, compact `AppHeader`, account menu, session watcher, and shared application-navigation band.
- Preserved the existing `Classrooms` and `History` destinations plus the original `max-w-4xl px-4 py-8` content geometry. This slice does not redirect, retire, or consolidate `/student/history`, and does not change classroom navigation.
- Added a direct student-layout regression and expanded the durable application-navigation Playwright contract with student desktop-light and mobile-dark checks for active state, inset focus, rendered target size, spacing, and overflow.
- Visually inspected populated student History at desktop and mobile widths; the two-column desktop layout and stacked mobile workflow remain intact with the cleaned shared header.
- Opened PR #904 for independent review.
- Accepted one independent accessibility finding: the newly activated shared header and account menu exposed sub-44px controls. Enlarged the Home, fullscreen, login, account, sidebar, and menu-item hit areas without changing icon sizes, removed the menu scale animation that temporarily shrank interactive rows, and added unit plus rendered-size keyboard regressions.

**Validation:**
- `pnpm test --run` (393 files / 3,585 tests)
- Focused student-layout, application-navigation, app-shell, and student-history suites (4 files / 10 tests)
- Focused remediation suite for the shared header, account menu, student shell, and navigation (6 files / 20 tests)
- `pnpm exec tsc --noEmit`
- `pnpm lint`
- `pnpm check:architecture` (613 modules / 0 allowances)
- `pnpm build`
- `bash .codex/skills/pika-audit/scripts/audit.sh`
- Durable Playwright application-navigation suite (10 checks including auth setup)
- Desktop/mobile teacher and student screenshots, including open mobile-dark account menus
- `node scripts/trim-session-log.mjs --check`
- `git diff --check`

**Remaining:**
- Complete full repository verification, independent review, and merge for the student navigation slice. Then continue Phase 2 with specialized-control policy enforcement.

## 2026-07-21 — Phase 2 specialized-control policy

**Completed:**
- Merged independently reviewed PR #904 as `f614fa61`, fast-forwarded the hub, and started Phase 2 item 8 from current `main` in a dedicated worktree.
- Replaced the brittle UI import grep with a TypeScript-AST policy checker and a versioned, Zod-validated exception registry covering 215 native controls across 67 files.
- Required exact per-file/per-kind counts, constrained rationale categories, explicit Phase 2/3/6 review ownership, canonical `@/ui` imports, and rejection of legacy UI component paths.
- Converted 22 remaining `@/ui/*` imports to the canonical barrel and retained narrow compatibility exports for existing component paths.
- Corrected seven full `@/ui` test mocks to preserve unmocked barrel exports after the full suite exposed their hidden coupling.
- Added direct semantic coverage for calendar navigation, creation dialogs, multiple-choice review states, announcement menus, edit toggles, split panes, and teacher action menus.
- No runtime UI behavior, schema, migration, API contract, production state, or data changed; visual verification is not required for this import/tooling-only slice.
- Opened PR #905 for independent review.
- Accepted initial review findings covering dynamic/CommonJS/import-equals bypasses, literal React factory controls, complete static input classification, and overly broad Tiptap exclusions; remediated them together with direct regression fixtures.
- Kept roadmap ownership in `reviewBy` and `.ai/features.json` rather than introducing date-dependent CI expiry for source exceptions.
- Targeted re-review found import-option/import-type bypasses, case/template static-input gaps, and missing namespace/root fixtures; closed all four in the second remediation batch.
- With explicit approval to exceed the default review budget, the third remediation batch closed final cumulative findings for relative UI paths, CommonJS/import-equals React factories, shorthand input props, strict registry metadata, and stale Phase 1 audit evidence.

**Validation:**
- `pnpm test --run` (full repository suite)
- Focused UI-policy, guidance, and composite-control suites
- `pnpm check:ui-policy` (215 controls / 67 files)
- `pnpm check:architecture`
- `pnpm exec tsc --noEmit`
- `pnpm lint`
- `pnpm build`
- `bash .codex/skills/pika-audit/scripts/audit.sh`
- `git diff --check`

**Remaining:**
- Publish, independently review, remediate, and merge the specialized-control policy PR. Then continue Phase 2 with mobile and light/dark Playwright projects plus representative teacher/student CI coverage.

## 2026-07-21 — Phase 2 browser experience matrix

**Completed:**
- Merged independently reviewed PR #905 as `126658e0`, fast-forwarded the hub, and started Phase 2 item 9 from current `main` in a dedicated worktree.
- Added desktop light, desktop dark, mobile light, and mobile dark Chromium projects while preserving the established `chromium-desktop` snapshot identity.
- Kept the broad feature and manual snapshot suites on the desktop-light project and limited the additional three projects to a focused experience contract, preventing a fourfold expansion of the full E2E suite.
- Added read-only seeded browser coverage for teacher Daily attendance, student Today, teacher Blueprints navigation, and student History navigation. The contract verifies real role authentication, classroom data, active navigation, mobile drawer behavior, persisted themes, viewport geometry, and horizontal overflow.
- Added a dedicated GitHub Actions job that starts ephemeral local Supabase, replays migrations, exports local-only credentials, runs `pnpm seed`, installs Chromium, executes the matrix, uploads failure diagnostics, and always tears down the database.
- Updated testing guidance and Phase 2 audit evidence. No runtime UI, API, schema, migration, production state, or production data changed.

**Validation:**
- `pnpm e2e:matrix` (18 checks across setup and four projects)
- `pnpm test` (397 files / 3,603 tests)
- `pnpm exec tsc --noEmit`
- `pnpm lint`
- `pnpm check:architecture` (613 modules / 0 allowances)
- `pnpm check:ui-policy` (215 controls / 67 files)
- `pnpm build`
- `bash .codex/skills/pika-audit/scripts/audit.sh`
- `git diff --check`

**Remaining:**
- Publish, independently review, remediate, and merge the browser matrix PR. Then confirm Phase 2 exit evidence and begin Phase 3 with the first independently releasable vertical product slice.

## 2026-07-21 — Phase 3 Classwork list states

**Completed:**
- Began Phase 3 with a narrow assignment slice that preserves the existing class-wide teacher workflow and student assignment list.
- Replaced ambiguous initial loading and failed-read empty states with governed `PageState` loading, error, and successful-empty states for teacher and student Classwork.
- Added bounded Retry actions that invalidate assignment, material, and survey list caches before reloading; failures never render "No classwork yet," and successful retry restores the normal list.
- Added focused role regressions and browser-verified loading, error, empty, retry, and restored-list states at desktop/mobile widths in light/dark themes. No API, schema, migration, production state, or production data changed.
- Independent review found that reactivating Classwork after a failed load used the content-preserving refresh path and could expose the empty state while retrying. Reactivation from an error now uses the blocking load path; both roles prove pending reactivation, repeated failure, and recovery.
- Final cumulative review found the remaining survey-list exception could still turn survey failures into empty or partial Classwork. Survey reads now participate in the same required failure/retry contract, with teacher and student survey-specific recovery regressions.

**Validation:**
- Focused Classwork component suites (2 files / 61 tests)
- `pnpm test --run` (397 files / 3,605 tests)
- `pnpm exec tsc --noEmit`
- `pnpm lint`
- `pnpm check:architecture` (613 modules / 0 allowances)
- `pnpm check:ui-policy` (215 controls / 67 files)
- `pnpm build`
- `bash .codex/skills/pika-audit/scripts/audit.sh`
- `git diff --check`
- Playwright forced-state matrix (16 checks across two focused local runs)

**Remaining:**
- Complete repository gates, independent review, and merge. Then continue the assignment slice with mobile workspace modes, save announcements/dialog semantics, and the Gradex status boundary.

## 2026-07-21 — Internal grading core foundation

**Risk profile:** async-grading

**Model recommendation:** GPT-5 Codex - grading contracts, provider error semantics, reproducibility metadata, and database security require cross-layer invariant analysis.

**Completed:**
- Started the internal modular-grading direction from current `main` without modifying the open remote Gradex worker branch or enabling remote grading.
- Added a database-independent grading core with Zod rubric/result contracts, profile and provider interfaces, canonical weighted criterion results, and versioned policy, prompt, profile, rubric, usage, and provider-request metadata.
- Extracted the OpenAI Responses structured-output transport behind the provider interface, including timeout/status classification, bounded output-cap fallback, structured response extraction, and cumulative token usage.
- Moved native assignment grading onto a pure Pika assignment profile while preserving the existing Completion/Thinking/Workflow rubric, prompt text, sanitization, teacher routes, durable run orchestration, retry semantics, and atomic writes.
- Added migration 100 to replace the legacy assignment-run claim with an empty search path, validated lease arguments, and service-role-only execution. No migration was applied.
- Added core engine/profile, assignment compatibility, usage, retry/error, and migration security regressions. No live provider call, production change, deployment setting, or data mutation occurred.

**Validation:**
- `pnpm test` (396 files / 3,593 tests)
- `pnpm exec tsc --noEmit`
- `pnpm lint`
- `pnpm check:architecture` (619 modules / 0 allowances)
- `pnpm build`
- `bash .codex/skills/pika-audit/scripts/audit.sh`
- Focused grading and assignment route suites (59 tests)
- `git diff --check`

**Remaining:**
- Add fully fenced assignment lease mutation contracts and durable grading audit/suggested-score persistence through the authorized schema workflow.
- Migrate test and repository-review profiles to the shared core, then add teacher-correction evaluation datasets and metrics.

## 2026-07-21 — Internal grading core review remediation

**Risk profile:** async-grading

**Completed:**
- Opened PR #906 and completed the initial independent review wave for the assignment grading core.
- Preserved the legacy direct-grading behavior by creating an abort signal only when the caller supplies a timeout; durable background runs continue to supply their existing 25-second timeout.
- Classified response-body `AbortError` and `TimeoutError` failures, including browser-style `DOMException` aborts, as retryable provider timeouts.
- Kept aggregate token usage unknown when either request in the output-cap fallback sequence omits usage, avoiding silently incomplete cost telemetry.
- Added a provider-to-run regression proving a response-body timeout requeues the assignment item with a future retry and leaves the batch running rather than failing it closed.
- No migration was applied, no live provider call was made, and no production state changed.

**Validation:**
- `pnpm test` (396 files / 3,597 tests)
- Focused grading, provider, and durable assignment-run suites (3 files / 27 tests)
- `pnpm exec tsc --noEmit`
- `pnpm lint`
- `pnpm check:architecture` (619 modules / 0 allowances)
- `pnpm build`
- `bash .codex/skills/pika-audit/scripts/audit.sh`
- `git diff --check`

**Remaining:**
- Complete targeted remediation and final cumulative reviews for PR #906, then obtain the required external approval before merge.
- Continue the active internal grading subsystem goal with assignment audit persistence, followed by test and repository-review profiles.

## 2026-07-21 — Durable assignment grading provenance

**Risk profile:** async-grading

**Completed:**
- Fixed the cumulative PR #906 review finding that versioned assignment grading metadata was computed but not durably persisted.
- Added a strict, bounded, pseudonymous provenance contract containing only provider/model, profile/rubric/prompt/policy versions, provider request count, and nullable token usage.
- Added migration 101 with an `assignment_docs.ai_grading_provenance` JSONB contract and additive service-role-only wrappers around the existing direct-grade and durable-item atomic RPCs, preserving rolling compatibility for old application instances.
- Added a compatibility trigger that clears provenance whenever legacy direct, durable, batch, repository-review, manual-grade, or missing-work writers replace grade/audit fields without supplying replacement provenance.
- Routed native Pika assignment grading through both provenance-aware persistence paths while legacy Gradex, missing-work, and repository-review callers write null provenance until their profiles migrate.
- Extended the CI database harness to verify wrapper privileges, direct persistence, durable-item persistence, transactionality, replay preservation, and stale-provenance clearing across old direct, durable, batch, and missing-work writers; updated generated and refined database contracts.
- No migration was applied locally, no live model call was made, and no production state changed.

**Validation:**
- `pnpm test` (401 files / 3,619 tests after rebasing onto `origin/main`)
- Focused grading, persistence, migration, Gradex compatibility, and database-contract suites (9 files / 64 tests)
- `pnpm exec tsc --noEmit`
- `pnpm lint`
- `pnpm check:architecture` (619 modules / 0 allowances)
- `pnpm build`
- `bash -n scripts/check-atomic-assignment-feedback-returns.sh`
- `bash .codex/skills/pika-audit/scripts/audit.sh`
- `git diff --check`

**Remaining:**
- Confirm migration replay, generated-type parity, and the database-backed provenance contract in PR CI, then complete the final independent re-review.
- Obtain required external approval before merge; continue with test and repository-review profile migration after this assignment foundation lands.

## 2026-07-22 — Phase 3 assignment accessibility evidence

**Completed:**
- Audited the remaining non-mobile assignment backlog against current `main` and confirmed #891 already shipped polite atomic save announcements and the shared restore-confirmation dialog.
- Replaced the assignment suite's hand-built confirmation stub with the real `ConfirmDialog`, added focused initial-focus coverage, and locked the visible save-status live-region attributes with regression assertions.
- Updated the product audit and current context to remove completed assignment work from the backlog. No runtime UI, API, schema, migration, production state, or production data changed.

**Validation:**
- `pnpm test tests/components/StudentAssignmentEditor.save-submit.test.tsx tests/ui/ModalLayer.test.tsx` (2 files / 52 tests)
- `pnpm exec tsc --noEmit --pretty false`
- `pnpm lint`
- `pnpm check:architecture` (613 modules / 0 allowances)
- `pnpm check:ui-policy` (215 controls / 67 files)
- `bash .codex/skills/pika-audit/scripts/audit.sh`
- `node scripts/trim-session-log.mjs --check`
- `git diff --check`

**Remaining:**
- Complete repository gates, independent review, and merge this evidence slice. Then start Daily/Attendance; assignment mobile UX remains deferred and Gradex remains owned by a separate session.
## 2026-07-22 — Internal repository-review grading profile and provenance

**Risk profile:** async-grading

**Model recommendation:** GPT-5.4 - this slice crosses structured provider contracts, sanitization, deterministic fallback semantics, revision fencing, and transactional database provenance.

**Completed:**
- Moved ambiguous-change classification and repository-review feedback into versioned, strict, bounded grading-core profiles using the shared OpenAI Responses provider, 25-second timeouts, minimal reasoning, and classification batches capped at 50 changes.
- Preserved Pika ownership of GitHub access, student identity mapping, sanitization, deterministic metrics, heuristic fallback, teacher workflow, and run orchestration; remote Gradex remains disabled.
- Added truthful per-result provenance for both model output and local heuristic fallback, with actual model/request/token metadata and zero provider requests for deterministic local grades.
- Added migration 103 with bounded result provenance, model/provenance linkage, an additive provenance-aware wrapper around the migration-087 completion RPC, completed-run replay preservation, exact student-row matching, and atomic propagation to assignment documents.
- Extended the database harness for service-role isolation, zero-request heuristic persistence, replay, and rollback on invalid provenance. Updated generated types and rollout/architecture guidance. No migration was applied locally, no live model call was made, and no production state changed.

**Validation:**
- `pnpm test` (405 files / 3,642 tests)
- Focused repository-review/core/migration suite (7 files / 30 tests)
- `pnpm exec tsc --noEmit`
- `pnpm lint`
- `pnpm check:architecture` (621 modules / 0 allowances)
- `pnpm build`
- `bash -n scripts/check-atomic-assignment-feedback-returns.sh`
- `git diff --check`

**Remaining:**
- Confirm migration 103 replay, database harness behavior, and generated-type parity in ephemeral PR CI; complete independent review and merge only after the assignment/test stack is approved.
- Add teacher-correction evaluation capture and offline comparison metrics across assignment, test, and repository-review grading.

## 2026-07-22 — Identity-free teacher grading reviews

**Risk profile:** async-grading, database, privacy, grading-quality

**Model recommendation:** GPT-5.4 - this slice crosses teacher outcome semantics, rolling-safe grading persistence, strict privacy contracts, and deterministic eval design.

**Completed:**
- Added a strict `grading-review-v1` core contract that cannot represent student identity, source assessment IDs, submission content, or raw feedback, plus deterministic summaries for criterion/overall score error, acceptance/edit rates, feedback dispositions, and model/profile counts.
- Added migration 104 with bounded `ai_grading_review` snapshots on assignment documents and test responses. Provenance-aware AI writes initialize reviews; manual edits update final outcomes; assignment/test return marks reviews final; test grade clearing records dismissal; changed student work and legacy AI replacement clear stale reviews.
- Kept repository-review grading on the assignment-document lifecycle, preserved existing routes and teacher UI, and prevented review-only test metadata updates from advancing response revisions.
- Added synthetic accepted, edited, dismissed, and pending fixtures plus `pnpm eval:grading-reviews` for free offline evaluation. Remote Gradex remains disabled, the existing Gradex archive extract is unchanged, and no live model call was made.
- Extended assignment/test database harnesses for suggestion preservation, correction capture, return finalization, dismissal, privacy rejection, legacy-writer clearing, and test revision stability; updated generated/refined types and rollout/privacy guidance.
- No migration was applied locally or remotely. The local Docker database had no Pika schema, so fresh migration replay and database harness execution remain PR CI gates.

**Validation:**
- `pnpm test` (407 files / 3,657 tests)
- `pnpm exec tsc --noEmit`
- `pnpm lint`
- `pnpm check:architecture` (622 modules / 0 allowances)
- `pnpm eval:grading-reviews scripts/fixtures/grading-review-scenarios.json`
- `git diff --check`

**Remaining:**
- Require fresh PR CI to replay migrations 001-104, verify generated type parity, and execute both atomic grading database harnesses.
- Complete independent review and obtain external approval before merging the stacked grading PRs.
- After the pilot collects 10-20 teacher-reviewed outcomes, add an explicit local-admin export of minimum sanitized grading inputs for paid candidate prompt/model comparisons.

## 2026-07-22 — Enforced grading-core isolation

**Risk profile:** async-grading, foundational architecture

**Model recommendation:** GPT-5.4 - enforcing extraction boundaries requires repository-wide import analysis while preserving existing grading policy behavior.

**Completed:**
- Added an architecture rule that prevents every `src/lib/grading/**` module from importing Pika-owned database, server, route, UI, shared application, or type modules, including type-only imports.
- Moved the canonical Pika test prompt guidelines into the versioned grading profile directory and retained the old application path as a compatibility re-export, preserving current consumers and prompt output.
- Added a regression test proving the boundary rejects both runtime Supabase and type-only database dependencies while allowing grading-core imports.
- Documented the enforced extraction boundary. No route, UI, schema, provider, prompt text, production state, or remote Gradex behavior changed.

**Validation:**
- `pnpm test` (407 files / 3,658 tests)
- `pnpm check:architecture` (623 modules / 0 allowances)
- focused architecture and test-grading suites (3 files / 43 tests)
- `pnpm exec tsc --noEmit`
- `pnpm lint`
- `pnpm build`
- Pika audit
- `git diff --check`

**Remaining:**
- Run the full repository gates and exact-head PR CI, then obtain the required external code-owner approval before merging the grading stack.
- Apply migrations 100-104 only with explicit target permission, deploy with remote Gradex disabled, and collect 10-20 teacher-reviewed outcomes before adding paid replay comparisons.

## 2026-07-22 — Corrected total-score grading eval error

**Risk profile:** none

**Model recommendation:** Current coding model - the correction is a small deterministic TypeScript aggregation change with focused regression coverage.

**Completed:**
- Changed overall grading-review error to compare the summed suggested score with the summed final score instead of adding absolute criterion errors.
- Added a regression scenario where opposite criterion corrections leave the total score unchanged while criterion-level errors remain visible.
- Preserved acceptance, feedback, and per-criterion metric behavior; no migration, provider, grading prompt, route, or production state changed.

**Validation:**
- `pnpm test` (407 files / 3,659 tests)
- `pnpm exec tsc --noEmit`
- `pnpm lint`
- `pnpm check:architecture` (623 modules / 0 allowances)
- `pnpm build`
- Focused teacher-correction eval suite (1 file / 6 tests)
- `pnpm eval:grading-reviews scripts/fixtures/grading-review-scenarios.json`
- `node scripts/trim-session-log.mjs --check`
- `git diff --check`

**Remaining:**
- Push the correction to PR 911, require exact-head CI, and complete the fresh review.
