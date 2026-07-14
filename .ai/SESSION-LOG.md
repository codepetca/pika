# Pika Session Log

Rolling recent session log for AI/human handoffs. Keep this file small; full historical session history lives in `.ai/JOURNAL-ARCHIVE.md`.

**Rules:**
- Append one concise entry for meaningful work, then immediately run `node scripts/trim-session-log.mjs` in the same change.
- CI allows at most 60 entries; the trim step compacts to the latest 40 entries by default so there is headroom for future appends.
- Use `node scripts/trim-session-log.mjs --check` to verify the log is within the 60-entry cap.
- Keep enough recent entries for weekly automations to inspect roughly the last week of work.
- The trim step appends removed entries to `.ai/JOURNAL-ARCHIVE.md`, so trimming never loses history.
- Use `.ai/JOURNAL-ARCHIVE.md` only for historical investigation.

## 2026-06-24 — Student log history cached JSON

**Completed:**
- Continued the bounded architecture/UI improvement goal with a small client read-cache consistency slice.
- Replaced `StudentLogHistory`'s latest and load-more manual cached history GET fetchers with `fetchCachedJSON`.
- Preserved existing cache keys, 60s TTL, pagination URL params, loading behavior, and error handling.
- Added a focused regression proving the load-more history page is reused from cache on a repeated request.

**Validation:**
- `bash scripts/verify-env.sh`
- `pnpm vitest run tests/components/StudentLogHistory.test.tsx tests/unit/request-cache.test.ts`
- `pnpm exec tsc --noEmit`
- `pnpm lint`
- `git diff --check`
- `bash .codex/skills/pika-audit/scripts/audit.sh`
- `pnpm test`
- `pnpm build`

## 2026-07-05 — Student exam access e2e coverage

**Completed:**
- Added one focused Playwright flow for student exam mode covering teacher-closed access during an in-progress open-response test.
- The test creates an active open-response test through existing teacher APIs, saves a student draft, closes and reopens that student's access, and verifies the draft is restored after reopening.
- Kept the patch to e2e coverage plus this continuity entry; no app logic, migrations, or dependencies changed.

**Validation:**
- `bash scripts/verify-env.sh`
- `corepack pnpm exec playwright test e2e/student-exam-mode.spec.ts --project=chromium-desktop --grep "preserves an open-response draft when teacher closes and reopens access"`
- `corepack pnpm lint`

## 2026-07-09 — Collaborator readiness: rulesets, CODEOWNERS, onboarding docs

**Completed:**
- Updated GitHub rulesets via API: `main` now requires a PR with 1 approving code-owner review plus the `Test & Build` status check (squash/rebase only); `production` mirrors the review + status-check requirements. Repo admins retain bypass.
- Added `.github/CODEOWNERS` (`* @armorup`) and `CONTRIBUTING.md` (collaborator setup, PR workflow, contribution permission note).
- README Getting Started rewritten: own-Supabase-per-developer with `supabase db push` (was stale "migrations 001–008 in dashboard"), required vs optional env split, seeded staging creds removed from docs.
- Marked shared `.env.local` symlink convention as maintainer-specific in `.ai/START-HERE.md` and `docs/dev-workflow.md`.
- Ran gitleaks over full history (1242 commits): no live secrets; flagged initial-commit README/tests 64-hex `SESSION_SECRET` example for precautionary rotation.
- PR: https://github.com/codepetca/pika/pull/835

**Validation:**
- `pnpm test tests/unit/ai-startup-docs.test.ts` (26/26 passed)
- `gh api repos/codepetca/pika/rulesets/{10460660,12273665}` confirmed new rules active

## 2026-07-09 — Archive trimmed session-log entries instead of deleting

**Completed:**
- Fixed `scripts/trim-session-log.mjs` so entries it removes from `.ai/SESSION-LOG.md` are appended to the bottom of `.ai/JOURNAL-ARCHIVE.md` (preserving entry markdown and chronological order) instead of being permanently deleted, matching the header claim that full history lives in the archive.
- Added `--archive <path>` and `--no-archive` flags; archiving is on by default and skipped when nothing is trimmed. A missing archive file is created with a minimal append-only header.
- Documented the archiving behavior in the generated session-log header rules and script usage text.
- Updated `tests/unit/trim-session-log.test.ts`: existing temp-path tests now pass explicit `--archive`/`--no-archive` (so they cannot write to the real archive), plus new coverage for appending to an existing archive, default-path archive creation, and no-op trims leaving the archive untouched.
- Note: entries trimmed between ~2026-05-05 and 2026-06-14 predate this fix; they are gone from the archive but recoverable from `.ai/SESSION-LOG.md` git history.

**Validation:**
- `pnpm test tests/unit/trim-session-log.test.ts` (8/8 passed)
- `pnpm test tests/unit/ai-startup-docs.test.ts`
- `node scripts/trim-session-log.mjs --check`
- `pnpm lint`

## 2026-07-09 — Remove stale staging environment references

**Completed:**
- Removed stale staging-environment references now that the staging Supabase environment is gone: README.md (seed `ENV_FILE` example, UI gallery wording, renamed the "Staging workflow" E2E section to a remote/preview workflow), docs/core/pilot-mvp.md (Environments section and manual cron trigger now reference Vercel preview deployments), docs/core/project-context.md, docs/core/tests.md, docs/semester-plan.md, docs/deployment/BREVO-SETUP.md, seed script headers (scripts/seed.ts, scripts/seed-gld2o.ts), and src/lib/email.ts comments.
- Kept the generic `ENV_FILE` mechanism (examples now use a pasteable `.env.custom.local`) and reworded remote-testing guidance to Vercel preview deployments.
- Left the seeded `GLD2O Staging` classroom title unchanged (test-data name, not an environment reference) and `.ai/JOURNAL-ARCHIVE.md` (historical archive).

**Validation:**
- `bash scripts/verify-env.sh`
- `grep -rni staging` (only seed-data classroom title and journal archive remain)
- `pnpm lint`
- `pnpm exec tsc --noEmit`

## 2026-07-11 — Collaborator-local env startup guidance

**Completed:**
- Aligned the remaining startup/env guidance drift so collaborator-owned `.env.local` files are explicitly valid outside the maintainer symlink setup.
- Updated `AGENTS.md`, `.ai/CURRENT.md`, `.codex/prompts/session-start.md`, `.claude/commands/session-start.md`, and `docs/core/project-context.md` to describe the maintainer symlink as the default on that machine, while allowing collaborators to copy `.env.example`.
- Replaced the `ai-startup-docs` invariant that enforced a universal symlink requirement with a dual-path check that requires both the maintainer shared-env path and collaborator-local setup guidance.
- No product code, runtime behavior, migrations, or dependencies changed.

**Validation:**
- `bash .codex/skills/pika-session-start/scripts/session_start.sh`
- `pnpm vitest run tests/unit/ai-startup-docs.test.ts`
- `git diff --check`

## 2026-07-10 — Bump GitHub Actions off deprecated Node 20

**Completed:**
- Bumped pinned action majors in ci.yml and ui-policy.yml to clear the "Node.js 20 is deprecated" runner warning: checkout v4→v7, setup-node v4→v6, pnpm/action-setup v4→v6, cache v4→v6, upload-artifact v4→v7.
- All step inputs used are stable across these majors (no removed inputs); relying on CI to validate.

**Validation:**
- CI `Test & Build` on the PR (self-validating workflow change)

## 2026-07-10 — Repo cleanup and /repo-tidy skill

**Completed:**
- Deleted 101 stale remote branches (95 merged/closed-PR + 6 from closing stalled PRs) and ~140 local branches; pruned phantom `origin/pr/672` ref.
- Removed 20 stale worktrees and 2 orphan directories; tagged 9 scratch-branch tips as `rescue/*` (local-only) before deleting.
- Closed stalled PRs #298, #323, #328, #341, #568, #739. Rescued uncommitted work from an unattended worktree into PR #838.
- Enabled `delete_branch_on_merge` on the repo so merged PR branches self-clean.
- Added `scripts/repo-tidy.sh` (read-only hygiene report) plus `/repo-tidy` command in `.claude/commands/` and `.codex/prompts/`, and documented it in `docs/dev-workflow.md`.

**Validation:**
- `bash scripts/repo-tidy.sh` (clean run against the tidied repo)
- `pnpm test tests/unit/ai-startup-docs.test.ts` (26/26 passed)
- `pnpm lint`

## 2026-07-10 — Issue backlog triage + CONTRIBUTING "Finding work" section

**Completed:**
- Triaged 61 open issues → 46. Closed 10 delivered-by-merged-PR (#86/#87/#88/#99/#144/#418/#431/#460/#523/#417), 2 duplicates (#451→#152, #366→#362), 1 abandoned (#252), 2 out-of-direction Clerk auth (#434/#449).
- Labeled all 46 survivors (0 unlabeled): 14 bug, 29 enhancement, 4 good-first-issue, 2 needs-triage (new label).
- Added a "Finding something to work on" section to CONTRIBUTING.md pointing collaborators at label filters and noting big ideas (e.g. gamification #205) vs ad-hoc feature work.

**Validation:**
- `gh issue list` label coverage check (0 unlabeled)

## 2026-07-10 — Auto-label new issues with needs-triage

**Completed:**
- Added .github/workflows/triage-label.yml: on issue `opened`, adds `needs-triage` if the issue has zero labels (leaves template/pre-labeled issues alone).
- Dependency-free (uses pre-installed gh CLI, no pinned actions) and least-privilege (`permissions: issues: write` only, over the repo's read-only default).

**Validation:**
- YAML parse check; workflow runs only on issue events (no CI impact to validate here)

## 2026-07-11 — Teacher-ready blueprint classroom rollover

**Completed:**
- Preserved assignment due timing as Toronto-local offsets from the source classroom start date.
- Made assignments and tests created from blueprints explicitly unpublished for teacher review.
- Added a realistic blueprint-to-classroom acceptance regression covering resources, assignments, submission requirements, tests/questions, lesson plans, relative due dates, and excluded student records.
- Added migration 080 and course-package v3 support to preserve assignment/test point scales, gradebook weights, and final-grade inclusion, including validation and backward-compatible defaults for older packages.
- Documented the classroom rollover contract.

**Validation:**
- Blueprint-focused Vitest suite (36/36 passed)
- `pnpm lint`
- `pnpm build`
- Pika audit

## 2026-07-13 — Blueprint architecture stabilization

**Completed:**
- Split published classroom syllabus loading from the teacher-authoring blueprint extractor, with explicit public projections that exclude classroom ownership and draft assessment content.
- Kept draft tests in reusable blueprints and batched test-question/draft loading to remove the per-test query loop.
- Preserved fractional assignment/test points and negative relative due offsets through Markdown, course-package bundle, and tar round trips.
- Scoped blueprint grading metadata parsing to the test header so matching prompt content is not stripped or interpreted as configuration.
- Updated migration 080 to use the runtime-compatible `numeric(6,2)` point scale and verified that 080 remains the next migration after `origin/main`.

**Validation:**
- `pnpm test` (311 files, 2,790 tests)
- `npx tsc --noEmit`
- `pnpm lint`
- Pika audit
- `git diff --check`

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
