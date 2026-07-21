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

## 2026-07-13 — Manual classroom source cleanup canary

**Completed:**
- Added a `CRON_SECRET`-authenticated GET/POST canary route around the source-object cleanup worker with a separate disabled-by-default trigger gate.
- Bounded every manual invocation to one lease and preserved the worker's independent enablement, checksum-before-remove, authoritative absence, stale-lease, and durable retry contracts.
- Kept durably recorded item failures healthy while returning `503` when any claim lacks durable retry evidence; responses expose opaque object references but no storage paths, checksums, classroom ids, or content.
- Locked the route out of `vercel.json` and documented both cleanup gates as disabled. No production setting, database, row, Storage object, UI caller, or schedule was changed.
- Corrected stale lifecycle/test documentation that still described the source cleanup worker as unfinished.

**Validation:**
- Full Vitest suite (335 files / 2,977 tests)
- Focused cleanup worker/trigger suites (2 files / 22 tests)
- `pnpm exec tsc --noEmit`
- `pnpm lint`
- `pnpm build`
- `git diff --check`

## 2026-07-13 — Local full-stack classroom archive recovery rehearsal

**Completed:**
- Added a local-only recovery drill guard requiring an exact destructive-operation acknowledgement, an HTTP loopback Supabase origin, and the Supabase local-demo service-role JWT before client construction.
- Added a synthetic full-stack rehearsal that invokes the real export, compaction, source-object cleanup, and restore coordinators against local Supabase REST and Storage.
- The rehearsal verifies representative row equality, restored object bytes, cold tombstone removal, immutable archive retention, idempotent operation replays, and complete synthetic-fixture teardown.
- Upgraded architecture CI from database-only startup to an ephemeral reduced Supabase stack and added the rehearsal after the existing rollback-only database contracts and ownership audit.
- Full-stack runs exposed a cleanup boundary mismatch: Node Storage `download()` wraps local missing-key responses in `StorageUnknownError.originalError`; the current SDK/local stack reports status 400, while other deployments can report 404. The worker accepts only that named bounded wrapper and requires a successful exact bucket lookup before treating it as object absence; explicit `NoSuchKey` remains direct evidence, unwrapped generic 400s and missing buckets fail closed.
- Kept the archive epic unfinished because no production canary or teacher-visible recovery flow has been approved. No production database, migration, row, object, or environment setting was modified.

**Validation:**
- Recovery target and source-cleanup suites (30 tests)
- Full Vitest suite
- `pnpm exec tsc --noEmit`
- `pnpm lint`
- `pnpm build`
- `bash -n scripts/check-classroom-archive-recovery-drill.sh`
- Local full-stack drill intentionally not run because the existing local Supabase instance predates migrations 082-086; migrations were not applied or reset
- `git diff --check`

## 2026-07-13 — Teacher cold-archive recovery surface

**Completed:**
- Extended the teacher Archived API response with teacher-scoped, Zod-validated cold tombstone summaries while preserving the existing response when migration 083 is absent and failing closed on unexpected query or contract errors.
- Added a distinct Stored archive row to the teacher classroom index; cold submissions, grades, and files remain inaccessible until the existing gated restore operation returns the classroom to `archived_hot`.
- Reused the existing restore route and required server feature gate, exact teacher allowlist, and database budget before enabling the control. The client keeps one UUID idempotency key through request and list-refresh failures and discards it only after refreshed state is confirmed.
- Added server, API, client, and component coverage for teacher scoping, rollout fallback, strict response validation, enabled/disabled controls, successful restore, and idempotent retries.
- Visually verified teacher desktop/mobile in light/dark plus disabled, confirm, processing, error, and restored-hot states; student desktop/mobile remained unchanged. No production database, migration, row, object, environment, or schedule was read or modified.

**Validation:**
- Full Vitest suite (338 files / 3,009 tests)
- Focused recovery list/API/client/component suites (5 files / 35 tests)
- `pnpm exec tsc --noEmit`
- `pnpm lint`
- `pnpm build`
- Pika pre-commit audit
- Local-only Playwright matrix with no overflow; intentional restore failure reused the same idempotency key on retry
- `git diff --check`

## 2026-07-13 — Archive recovery PR review consistency fix

**Completed:**
- Re-reviewed the local full-stack recovery drill and teacher cold-archive recovery PRs before merge; the drill had no findings.
- Fixed the teacher archive read model so independent PostgREST snapshots cannot combine a pre-transition hot row with a post-transition tombstone, or omit both sides during restore.
- Added a bounded stable-read protocol that brackets the hot query with validated tombstone snapshots, retries the complete read once on lifecycle movement, and returns `503` if state does not stabilize.
- Preserved the missing-migration hot-only fallback, teacher scoping, restore gates, and existing client response contract. No production database, migration, row, object, environment, or schedule was read or modified.

**Validation:**
- Focused archived-state server/API suites (2 files / 20 tests)
- Full Vitest suite (338 files / 3,015 tests)
- `pnpm exec tsc --noEmit`
- `pnpm lint`
- `pnpm build`
- Pika pre-commit audit
- `git diff --check`
- CI pending after push

## 2026-07-13 — Phase 1 API boundary validation foundation

**Risk profile:** runtime-platform

**Model recommendation:** GPT-5 Codex - cross-cutting API contract and architecture-test work benefits from repository-wide reasoning and strict verification.

**Completed:**
- Moved course-blueprint request schemas out of the broad teacher validation module into a feature-owned `course-blueprints` contract module, with shared course-publishing primitives isolated separately.
- Added full nested Zod validation to blueprint assignment, test, and lesson-template bulk mutation routes, reusing canonical test-draft and document validators.
- Added route tests proving malformed nested payloads return `400` before mutation services run.
- Added a deletion-only architecture baseline that blocks new body-reading API routes without a named Zod boundary and must shrink as existing routes migrate.
- Documented boundary parsing, contract ownership, non-JSON decoder expectations, and baseline maintenance.
- No database migrations, dependencies, UI changes, or production operations.

**Validation:**
- Focused blueprint and architecture suites: 21 tests passed
- `pnpm exec tsc --noEmit`
- `pnpm lint`
- `pnpm test` (312 files, 2,788 tests passed)
- `pnpm build`
- `git diff --check`

## 2026-07-13 — Generated Supabase database contract

**Completed:**
- Generated and committed the public Supabase schema contract in `src/types/database.generated.ts`; added `src/types/database.ts` for application-owned JSON/status/RPC refinements and typed both central Supabase client factories.
- Added `db:types:generate` / `db:types:check`, plus a CI `Database Contract` job that starts an ephemeral database, replays migrations, and rejects generated-type drift.
- Replaced generic persisted payload records exposed by the typed client with `TableRow`, `TableInsert`, and `TableUpdate` contracts; extracted assessment draft contracts into shared domain types.
- Fixed blueprint instantiation when `points_possible` is null by omitting it so PostgreSQL applies the assignment default; added a regression for null and explicit point values.
- Added documentation for generated types, custom refinements, compatibility exceptions, and the migration workflow.
- CI's clean replay exposed migration `080` from another worktree in the shared local stack; aligned the generated file to this branch's `001-079` history and made generation reject mismatched worktree/database migration histories.
- No production access or local migration-application command was used. Local type generation/checking only read the already-running development stack; CI used its own ephemeral database.

**Validation:**
- `pnpm test` (311 files, 2785 tests passed)
- `pnpm build`
- `pnpm exec tsc --noEmit --pretty false`
- `pnpm run lint`
- `pnpm run db:types:check` preflight rejected the intentionally mismatched shared stack (`database=080`, worktree missing `080`)
- `bash .codex/skills/pika-audit/scripts/audit.sh`

## 2026-07-14 — Atomic test grading contracts

**Completed:**
- Moved manual, bulk-clear, unanswered, and AI test grading writes behind typed atomic database RPCs with optimistic response/item revisions, exact-cohort validation, deterministic lock ordering, leases, and signed AI provenance.
- Added shared test-scoped advisory locking and an atomic test-deletion boundary so grading, finalization, and deletion serialize without deadlocks or partial writes.
- Added bounded client conflict recovery that reloads canonical revisions while preserving the teacher's latest draft, plus Zod validation at changed API/server boundaries.
- Hardened classroom archive restore context scoping and added database-backed CI coverage for both grading concurrency and archive restore contracts.
- Added migrations `089` through `095`, generated Supabase types, rollout guidance, focused API/server/component/architecture tests, and multi-session database regression harnesses.

**Validation:**
- `pnpm exec supabase db reset --local`
- `pnpm run db:types:check`
- `bash scripts/check-atomic-test-grading.sh`
- `bash scripts/check-classroom-archive-restore-database.sh`
- `bash .codex/skills/pika-audit/scripts/audit.sh`
- `pnpm lint`
- `pnpm vitest run` (359 files, 3,287 tests)
- `pnpm build`
- `git diff --check`

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
- Added classroom route loading, error-boundary retry, and intentionally indistinguishable unavailable/access-denied states while preserving the classroom shell.
- Migrated teacher dashboard and student history initial loading/empty behavior; failed classroom/history reads now render explicit retryable errors instead of valid-looking empty data.
- Added cache invalidation before client retries and direct regressions for state semantics, route boundaries, error/empty separation, and retry recovery.
- Documented the state decision table and App Router conventions in stable guidance.
- Visually verified teacher/student loading, error, and empty states plus classroom unavailable states at desktop/mobile sizes in light/dark themes. Governed states had no overflow or page errors, and retry/route-away controls measured 44px.
- Opened PR #900 for independent review; no schema, migration, API contract, or production data change was made.

**Validation:**
- `pnpm test` (387 files / 3,566 tests)
- Focused page-state, classroom-route, teacher-dashboard, student-history, UI-guidance, and startup-doc suites
- `pnpm exec tsc --noEmit`
- `pnpm lint`
- `pnpm check:architecture` (610 modules / 0 allowances)
- `pnpm build`
- `bash .codex/skills/pika-audit/scripts/audit.sh`
- Custom Playwright teacher/student desktop/mobile light/dark loading/error/empty/forbidden and keyboard-retry matrix
- `git diff --check`

**Remaining:**
- Open, independently review, and merge the page-state PR. Then continue Phase 2 with shared table, menu, tabs, segmented-control, and split-pane contracts.
