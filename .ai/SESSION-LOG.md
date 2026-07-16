# Pika Session Log

Rolling recent session log for AI/human handoffs. Keep this file small; full historical session history lives in `.ai/JOURNAL-ARCHIVE.md`.

**Rules:**
- Append one concise entry for meaningful work, then immediately run `node scripts/trim-session-log.mjs` in the same change.
- CI allows at most 60 entries; the trim step compacts to the latest 40 entries by default so there is headroom for future appends.
- Use `node scripts/trim-session-log.mjs --check` to verify the log is within the 60-entry cap.
- Keep enough recent entries for weekly automations to inspect roughly the last week of work.
- The trim step appends removed entries to `.ai/JOURNAL-ARCHIVE.md`, so trimming never loses history.
- Use `.ai/JOURNAL-ARCHIVE.md` only for historical investigation.

## 2026-07-13 — Atomic and observable blueprint round trips

**Completed:**
- Replaced compensating-delete package import, classroom capture, and classroom instantiation with single transactional RPC boundaries and a service-role-only idempotency/failure ledger.
- Added stable classroom and blueprint revision snapshots, including child-table triggers, final read checks, and transaction-time source locks to reject mixed-version write plans.
- Preserved assignment submission requirements during classroom capture and kept new classroom assignments/tests unpublished for teacher review.
- Added strict Zod write-plan/RPC response contracts, structured operation metrics, caller idempotency keys, failure metadata, and migration-required fail-closed behavior.
- Made generated class codes/default themes deterministic from the operation ID and added stable query tie-breakers so retries rebuild an identical write plan.
- Added ephemeral Supabase contract checks for malformed plans, child-write rollback, stale capture rejection, and successful replay; documented rollout, rollback, recovery, retention, privacy, and observability.

**Validation:**
- `pnpm test` (314 files, 2,808 tests)
- `pnpm build`
- `pnpm exec tsc --noEmit`
- `pnpm lint`
- Pika audit
- `bash -n scripts/check-atomic-blueprint-operations.sh`
- `git diff --check`
- Ephemeral Supabase migration/behavior check pending PR CI

## 2026-07-13 — Canonical classroom lifecycle and archive contracts

**Completed:**
- Added strict Zod-derived contracts for active, hot-archived, and cold-archived lifecycle states, with separate verified evidence for compaction and completed restore.
- Encoded the current 42-table classroom ownership graph, all restore dependencies, privacy classes, parent-first restore order, child-first cleanup order, and a deidentified Gradex allowlist.
- Added strict version 1 classroom archive and Gradex extract manifests with canonical file paths, row/byte counts, SHA-256 checksums, retention metadata, actor snapshots, managed storage descriptors, and restore preflight gates.
- Defined the existing course package as a reusable, student-free, non-recoverable artifact; defined private archive/Gradex destinations and referenced-only discovery for the three current source buckets.
- Added a read-only PostgreSQL catalog audit that fails on untracked/stale classroom resources, missing restore dependencies, or invalid selection keys, plus recovery, observability, compatibility, and production-canary guidance.
- Added the unfinished `epic-classroom-lifecycle-archives` entry to the append-only feature inventory so repository status reflects the remaining implementation and production verification work.
- Removed a duplicated architectural-direction section from `.ai/CURRENT.md` to keep the required startup context below its 16,000-character budget after adding the epic.
- No application runtime path, database migration, database row, storage object, dependency, or production environment changed.

**Validation:**

## 2026-07-13 — Enforce architecture dependency boundaries

**Completed:**
- Added a TypeScript import-graph analyzer for runtime-aware imports, re-exports, dynamic imports, and CommonJS `require`, with independent traversal from every `'use client'` entry.
- Enforced dependency direction between domain, UI, presentation, API, server-only, and shared type layers; blocked browser reachability to server modules, Supabase runtime clients, Next.js server APIs, and Node built-ins.
- Added a deletion-only baseline for four existing client paths that reach `src/lib/server/assessment-drafts.ts` through assessment markdown helpers. New violations and obsolete baseline entries fail the check.
- Replaced the duplicated browser Supabase parser with the shared analyzer, documented the boundaries, and added `pnpm check:architecture` to CI.
- No runtime product behavior, database migrations, dependencies, or production data changed.

**Validation:**
- `pnpm run check:architecture` (556 modules; 4 deletion-only allowances)
- `pnpm test`
- `pnpm exec tsc --noEmit`
- `pnpm lint`
- `pnpm build`
- `pnpm exec vitest run tests/lib/contracts/classroom-lifecycle.test.ts tests/lib/contracts/classroom-artifacts.test.ts` (15 tests)
- Read-only local catalog audit: `CLASSROOM_SCHEMA_AUDIT_DATABASE_URL=... pnpm exec tsx scripts/check-classroom-resource-schema.ts` (97 public foreign-key relationships)

## 2026-07-13 — Verified export-only classroom archives

**Completed:**
- Added migration 082 and a fail-closed teacher API for private, immutable, deterministic classroom archive exports without deleting any hot row or source object.
- Added idempotent snapshot/finalization RPCs, revision triggers for all 41 descendants, durable operation evidence, strict actor snapshots, 50 MB private archive/Gradex buckets, full upload read-back verification, and terminal/retry recovery behavior.
- Added canonical tar+gzip and NDJSON serialization with strict manifest, row/byte/checksum, actor, storage-object, content, and outer-artifact verification.
- Extended the 42-resource schema contract to audit actual primary keys and every direct actor foreign key; actor capture now uses only those explicit columns and rejects arbitrary user UUIDs in free text.
- Restricted storage discovery by source context: assignment artifacts from relational paths, submission images from embedded content, and test documents only from `tests.documents`.
- Added a server-only export enable flag plus teacher UUID allowlist, future-retention validation, structured privacy-safe metrics, database CI, recovery guidance, and adversarial regressions.
- Kept the archive epic unfinished: restore, Gradex extract generation, cold compaction, cleanup automation, teacher UI, and production canaries remain pending.

**Validation:**
- `pnpm test` (320 files, 2,844 tests)
- `pnpm lint`
- `pnpm build`
- `pnpm exec tsc --noEmit`
- Pika audit
- Fresh isolated Supabase replay through migrations 080/081/082
- Atomic blueprint database contract
- Verified archive database contract, including stale-source, terminal replay, unrelated-UUID privacy, retention, grants, and immutable metadata checks
- Classroom schema audit (102 public foreign-key relationships)
- `bash -n scripts/check-classroom-archive-database.sh`
- `git diff --check`

## 2026-07-13 — Resumable and version-aware classroom archive restore

**Completed:**
- Added migration 083 with cold tombstones outside the classroom ownership graph, bounded idempotent JSONB staging, conservative database-capacity preflight, concurrent-operation rejection, service-role-only RPCs, and one atomic 42-resource finalization transaction.
- Added strict archive decoding, source-to-target adapter selection, actor reconciliation, exact storage-reference matching, deterministic operation-scoped object paths, managed-reference rewriting, and outer/read-back checksum verification.
- Added a separately gated teacher restore endpoint requiring an enable flag, teacher UUID allowlist, idempotency key, and explicit database-budget setting; applying the migration alone does not expose restore or enable compaction.
- Preserved exact archived values by suppressing blueprint/archive touch triggers only inside the transaction-local restore context and restoring the archived revision explicitly; PostgreSQL records final referential-integrity evidence after inserts pass.
- Added rollback-only database coverage for capacity refusal, schema drift, unresolved actors, concurrent restores, expired-operation replacement, idempotent staging/completion, exact JSONB row equality, revision preservation, tombstone cleanup, and browser-role denial.
- Corrected restore concurrency so only unexpired snapshots block a replacement operation; expired operations can no longer strand a cold classroom while awaiting cleanup automation.
- Kept the archive epic unfinished: cold compaction, separate deidentified Gradex extract generation, cleanup automation, teacher UI, and production canaries remain pending. No production database, migration, row, or storage object was modified.

**Validation:**
- `pnpm test` (324 files, 2,866 tests)
- `pnpm exec tsc --noEmit`
- `pnpm lint`
- `pnpm build`
- Pika audit
- Fresh isolated Supabase replay through migrations 080/081/082/083 with matching source/copy migration hashes
- Verified export and restore database contracts executed as `service_role`
- Post-review focused restore suite (4 files, 21 tests) and fresh rollback-only restore canary, including expired-operation replacement
- Classroom schema audit (105 public foreign-key relationships)
- Supabase lint: one existing migration-082 false positive for the function-local `classroom_archive_actor_ids` temporary table; both executable database contracts pass
- `git diff --check`

## 2026-07-13 — Deidentified Gradex artifact transformer

**Completed:**
- Added a server-only pure transformer that derives a deterministic Gradex tar+gzip artifact only from a strictly verified classroom archive.
- Added explicit projections for every allowlisted assignment/test resource, per-extract HMAC relationship references, relative structured timestamps, shared direct-identifier redaction plus known-actor redaction, and exclusion of storage/external references.
- Added independent verification for canonical manifests/NDJSON, resource/content checksums, HMAC shapes, projected relationships, exact resource inventory, and zero detected direct identifiers.
- Capped version 1 extract retention at 90 days and documented that runtime operations, upload/finalization, deletion automation, and production canaries remain unfinished.

**Validation:**
- Focused Gradex, artifact-contract, and startup-policy suites (43 tests)
- `pnpm test`
- `pnpm exec tsc --noEmit`
- `pnpm lint`
- `pnpm build`

## 2026-07-13 — Durable Gradex operations and cleanup contract

**Completed:**
- Added stacked migration 084 with a service-role-only Gradex resource allowlist, idempotent begin/finalize/fail operations, immutable verified extract metadata, and a separate mutable retention-cleanup ledger.
- Serialized generation per immutable source archive, capped retention and file size, required exact resource counts and verification evidence, and scheduled older extracts immediately when superseded.
- Added lease-based cleanup claiming, stale-lease rejection, exponential retry, and durable deletion evidence without deleting audit metadata.
- Tightened final review invariants for typed verification evidence, bounded verification timestamps, conflicting finalization replays, failure metadata, and cleanup lease inputs.
- Kept the database contract unreachable from browser roles and added no API, cron, upload, deletion, or production execution path.

**Validation:**
- Fresh isolated Supabase replay through migration 084
- Expanded rollback-only service-role Gradex database contract
- Focused migration, transformer, artifact-contract, and startup-policy suites (47 tests)
- Full Vitest suite (326 files / 2,874 tests)
- `bash -n scripts/check-classroom-gradex-database.sh`
- `pnpm exec tsc --noEmit`
- `pnpm lint`
- Pika pre-commit audit

## 2026-07-13 — Gated Gradex runtime coordinator

**Completed:**
- Added a server-only coordinator that verifies immutable classroom archives before building Gradex extracts, then performs private no-overwrite upload, full read-back, independent integrity/privacy verification, and exact durable finalization.
- Added explicit enablement, teacher allowlisting, a minimum-strength HMAC secret, HMAC-key fingerprint request binding, deterministic operation paths, strict Zod RPC contracts, and privacy-safe metrics.
- Added safe replay, concurrent-upload reuse, terminal cleanup, and transient-finalization retry behavior without exposing any API, cron, or production execution path.
- Documented the runtime boundary and configuration while keeping deletion automation, cold compaction, teacher UI, and production canaries unfinished. No production database, migration, row, or storage object was modified.

**Validation:**
- Full Vitest suite (327 files / 2,889 tests)
- Focused archive/Gradex/runtime suites (4 files / 36 tests)
- `pnpm exec tsc --noEmit`
- `pnpm lint`
- `pnpm build`
- `git diff --check`

## 2026-07-13 — Doubly gated Gradex teacher trigger

**Completed:**
- Added a teacher-authenticated Gradex generation route requiring an explicit UUID idempotency key and a future deletion timestamp bounded by the 90-day artifact contract.
- Kept deployment fail-closed behind both the existing teacher coordinator allowlist and a separate exact source-archive canary flag/allowlist; no UI, cron, or automatic caller was added.
- Delegated generation, immutable archive ownership, transformation, storage, read-back, privacy verification, and durable finalization to the existing coordinator and migration 084 boundaries.
- Extended the rollback-only database contract and static migration guard to reject foreign-teacher and wrong-classroom archive requests without creating an operation.
- Updated environment, lifecycle, test, and current-context documentation. No production database, migration, row, storage object, or environment setting was modified.

**Validation:**
- Full Vitest suite (328 files / 2,899 tests)
- Focused trigger/coordinator/transformer/artifact/startup suites (5 files / 67 tests)
- Focused route/coordinator/migration suite after ownership review (3 files / 29 tests)
- `pnpm exec tsc --noEmit`
- `pnpm lint`
- `pnpm build`
- `bash -n scripts/check-classroom-gradex-database.sh`
- Local executable database contract unavailable because the running Supabase container predates migration 082; migrations were not applied or modified
- `git diff --check`

## 2026-07-13 — Verified Gradex retention cleanup runtime

**Completed:**
- Added a server-only, disabled-by-default cleanup coordinator over migration 084's lease claim, completion, and retry RPCs without adding an HTTP route, cron entry, or automatic caller.
- Bounded each invocation to 10 claims and strictly validated the private bucket, canonical teacher/classroom/extract path shape, extract id binding, claim uniqueness, attempts, and lease inputs with Zod.
- Required exact post-delete read-back evidence: only authoritative object-key absence can complete the current lease; missing buckets, present objects, uncertain Storage results, stale leases, and malformed RPC responses fail closed.
- Added durable per-claim retry recording, stale-lease non-mutation, independent failure containment, privacy-safe aggregate metrics, and idempotent already-absent handling.
- Updated environment, lifecycle, test, and current-context documentation. No production database, migration, row, storage object, route, schedule, or environment setting was modified.

**Validation:**
- Full Vitest suite (329 files / 2,915 tests)
- Focused cleanup/generation/transformer/artifact/migration/startup suites (6 files / 80 tests)
- `pnpm exec tsc --noEmit`
- `pnpm lint`
- `pnpm build`
- `git diff --check`

## 2026-07-13 — Manual Gradex cleanup canary trigger

**Completed:**
- Added a `CRON_SECRET`-authenticated GET/POST cleanup endpoint behind an independent disabled-by-default trigger gate while preserving the cleanup worker's separate gate.
- Bounded the manual canary to one claim per invocation and delegated lease, storage deletion, exact read-back, completion, and retry behavior to the existing cleanup coordinator.
- Kept durably recorded item retries healthy while returning `503` when any claim lacks durable retry evidence; responses expose no storage paths or content.
- Added tests that lock the route out of `vercel.json`; no schedule, UI caller, migration, dependency, production database, row, storage object, or environment setting was changed.
- Updated environment, lifecycle, test, and current-context documentation.

**Validation:**
- Full Vitest suite (330 files / 2,925 tests)
- Focused trigger/cleanup/extract/operations/artifact/startup suites (6 files / 85 tests)
- `pnpm exec tsc --noEmit`
- `pnpm lint`
- `pnpm build`
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

## 2026-07-13 — Atomic classroom cold-compaction database contract

**Completed:**
- Added migration 085 with idempotent begin/stage/complete/fail compaction RPCs, exact archive/source/count verification, one child-first deletion transaction, and service-role-only access.
- Added a durable source-object cleanup ledger whose rows remain ineligible `staged` work until relational deletion and tombstone creation commit atomically, then become retryable `pending` work.
- Strengthened lifecycle Zod evidence with archive identity, both checksums, fresh read-back proof, and transition-specific compaction cleanup evidence.
- Added forced rollback, concurrency, idempotency, traversal rejection, security, replay, and real hot-to-cold-to-hot database contracts in ephemeral CI; restore no longer manufactures its tombstone.
- Kept rollout database-only: no route, runtime caller, UI, schedule, environment gate, production migration application, row, or Storage object was changed.

**Validation:**
- Full Vitest suite (331 files / 2,931 tests)
- Focused lifecycle/migration/archive/restore/startup suites (6 files / 45 tests)
- `pnpm exec tsc --noEmit`
- `pnpm lint`
- `pnpm build`
- `bash -n` for compaction and restore database contracts
- Pika pre-commit audit
- Local migration replay intentionally not run; GitHub's ephemeral Supabase database job is the execution authority
- `git diff --check`

## 2026-07-13 — Gated classroom cold-compaction runtime coordinator

**Completed:**
- Added a server-only compaction coordinator over migration 085 with independent enablement, exact teacher allowlisting, and exact immutable-archive allowlisting; no route, UI, cron, or automatic caller was added.
- Required canonical private archive paths, outer checksum equality, strict manifest/read-back verification, exact teacher/classroom/archive identity, exact relational and storage inventories, and bounded idempotent source-object cleanup staging before atomic finalization.
- Added fail-closed completion handling that validates durable evidence and counts, never reports an ambiguous committed response as success, records terminal versus retryable operation failures, and returns completed replays without rereading Storage.
- Documented disabled-by-default configuration and the remaining lease-based source-object cleanup worker. No production database, migration, row, object, schedule, or environment setting was modified.

**Validation:**
- Full Vitest suite (332 files / 2,950 tests)
- Focused compaction/archive/lifecycle/restore/startup suites (6 files / 68 tests)
- `pnpm exec tsc --noEmit`
- `pnpm lint`
- `pnpm build`
- `git diff --check`

## 2026-07-13 — Verified classroom source-object cleanup boundary

**Completed:**
- Added migration 086 with service-role-only, skip-locked claim/complete/fail RPCs over compaction source objects, explicit processing/failed/deleted states, bounded leases, expired-lease reclaim, exponential retry backoff, and immutable deletion evidence.
- Restricted claims to completed compact operations with matching cold tombstones; stale, wrong, or expired leases cannot complete or fail work.
- Added a disabled-by-default server worker that reads each exact key, verifies complete bytes against the archived SHA-256 and byte count before removal, and completes only after authoritative exact-key absence; missing buckets, mismatches, uncertain reads, and unconfirmed deletion fail closed.
- Added strict Zod validation for RPC claims and runtime bounds, duplicate-object rejection, independent failure containment, and privacy-safe results/metrics with opaque object references.
- Extended the ephemeral database contract for pre-compaction exclusion, active and expired leases, stale-token rejection, retry backoff, canonical inputs, completion evidence, and role security. No route, UI, schedule, production setting, database, row, or Storage object was changed.

**Validation:**
- Full Vitest suite (334 files / 2,968 tests)
- Focused source cleanup runtime/migration suites (2 files / 18 tests)
- `pnpm exec tsc --noEmit`
- `pnpm lint`
- `pnpm build`
- `bash -n scripts/check-classroom-archive-compaction-database.sh`
- Pika pre-commit audit
- Local migration replay intentionally not run; GitHub's ephemeral Supabase database job is the execution authority
- `git diff --check`

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
