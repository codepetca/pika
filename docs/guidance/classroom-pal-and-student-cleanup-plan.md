# Classroom-specific Pal and student cleanup roadmap

Status: Phase1 and Phase2 delivered; provider and academic prerequisites delivered;
Phase3 backend PR1260 merged; teacher dialog integration in progress, default disabled. The automatic
worker follows the usable explicit flow. This is the existing six-phase roadmap,
updated to the user's settled live-data policy on2026-09-13.

Coordinator: `01a09083-d907-7532-ae50-9b46d292bdb6`. Current implementation owner:
`01a09d9e-e75e-7153-8cb6-c15e1d5e3d2a`, branch
`codex/teacher-live-purge-dialog`. Provider contract, exact invocation,
limitations and rollout evidence are maintained in
[student-provider-cleanup-integration.md](student-provider-cleanup-integration.md).

## Product decisions

- Remove the student immediately with the existing roster action. Explicitly
  purge that removed membership's LIVE classroom data afterward.
- Preserve the account, other classrooms, classmates and shared teacher materials.
  No restore-student action is offered. Successful cleanup permits fresh rejoin
  with a new generation and new Pal/Bara references; never reuse the old state.
- Pal belongs to one student in one classroom membership generation. New
  classroom progression starts fresh. There is no sitewide achievement migration,
  historical-removal backfill, legacy profile retirement or cutover in this slice.
- Historical backups, inactive retained archives and historical exports may remain
  under their actual retention. Their physical erasure, expiry, restoration tests
  or independent restore-suppression infrastructure do not block live completion.
  No promise covers a privileged administrator restoring an old database.
- Current external grading stores, serving replicas/caches, in-flight writers and
  shared/mixed live resources retain exact ownership and anti-recreation checks.
  Unknown live scope blocks completion; it is never relabeled historical.
- There is no invented two-day maximum. Show durable progress and truthful
  blockers; local academic completion alone cannot clear re-add.

These decisions supersede stronger old backup/restore policy language for NEW
`pika-live-v1` operations. Existing strict-v1 provider operations retain their
original semantics without upgrade, reopening or reuse.

## Phase1 — generation identity foundation: delivered, disabled

Pika PR1253 merged. Migration168 creates opaque membership references, tracks
active/removed generations and rejects old-generation reopening, including
archive restore through normal application paths. Ordinary roster removal keeps
academic data and closes membership. Account/classroom policy remains separate.
Production was recorded through168; exact current rollout evidence must be
verified before another schema application.

## Phase2 — classroom signals and client context: delivered, disabled

Pika PR1256 merged. Migrations169/170 add classroom-scoped Pal signals and
transactional delivery bindings using existing outbox owners. Enabled widgets
resolve exact classroom/generation context; legacy behavior remains gated.
Read-token caching and client memory are invalidated on denial/context changes,
and stale replies cannot repopulate closed state. Academic children are not
remounted merely to invalidate Pal. No Pal engine rewrite was required.

## Phase3 — explicit removed-membership live purge: backend merged, UI in progress

Delivered prerequisites:

- Pika PR1258, `29cde0b0df441cf1b55f305da5ed4a602ca1d642`: exact removed
  generation, private provider bindings, existing operation/fence, independent
  Pal and Bara progress, strict receipts, attendance delivery closure.171/172
  are immutable after their approved local applications.
- Pika PR1259, `ea9f45a5376b15b4d5cd44c57f1f0683598e8e16`: disabled academic
  inventory, resource and owner hashes, exact files/leases, shared-data blockers,
  attendance child ownership and late repository-review producer guard.173/174
  are immutable. Main CI34784421380 passed6919 tests plus DB/browser/build;
  automatic Preview READY. Prior owners are archived.
- Pal PR105 schema at `d032945` and PR106 runtime at
  `60e9befb0b31fa164663658f5f09c2615596cc14` are released.0014 applied;
  exact-main CI34791160069 passed; production
  `dpl_3n6iej97hKRGSfVdyHq5RqFXXdXL` READY at pal.codepet.ca. The exact
  erasure integration allowlist remains absent/off; no live purge occurred.
- Bara PR60 merged at `39660c0e207f087cf96923a975ea0f55e6472943`,234 tests
  passed. Its verified backend is the expiring `cautious-tortoise-152` Convex
  preview, expiringSeptember18. A stable production release remains a later gate.

Current coherent deliverable:

1. Preserve the old strict provider path; durably select Pal schema2 /
   `pika-live-v1` for new explicit operations. Validate its nine exact keys,
   chronology, policy, tenant/reference and backup-scope fields. Keep GET policy
   headers separate from POST progress. Unknown responses never complete cleanup.
2. Reuse the existing provider and academic coordinators, action/status RPC,
   operation/resource/file ledgers and locks. Add an explicit teacher-authorized
   reserve/advance/status API under the existing student purge surface. Default
   off; no destructive work starts from ordinary removal.
3. Keep provider progress independent. Inventory student+classroom academic data
   using the existing ownership checks; generation authenticates the operation,
   not individual-row provenance. Unknown current external grading/shared resources
   remain explicit blockers. No prospective provenance or relabeling project.
4. Exclude verified historical archive/export artifacts from the live policy while
   retaining unfinished producer and exact shared-file ownership checks. Never
   delete a whole-class archive or invoke whole-class Bara decommission.
5. After both providers and academic/files complete, clean exact live delivery
   payloads, redact the removed participant from mixed roster snapshots while
   preserving classmates, then atomically complete and release fresh rejoin.
   Retain operation/lease/path evidence and permanent old-generation rejection.
6. Verify synthetic provider+academic/file completion, fresh rejoin, tenant and
   classroom isolation, retries/lost responses, stale callbacks, malformed/wrong
   receipts, mixed ownership and client invalidation. Complete bounded independent
   security/concurrency and compatibility review before one stable-head CI run.
7. Update this roadmap and its existing integration record with source/review/CI
   evidence and the exact schema/release/activation approval packet.

Source implementation does not authorize migration application, provider HTTP,
allowlist/gate changes, a live deletion, production release or merge. Local ledger
was recorded001–174; production001–168. All previous migration approvals are
consumed.175 is a forward candidate; local/shared/hosted replay, reset, repair,
seeding and physical deletion need their applicable fresh authority. Disposable
normal CI fixtures remain authorized and must be labeled accurately.

Exit: a reviewed, CI-green, default-disabled explicit path with truthful supported
scope, exact commands/status, fresh rejoin proof and a concrete rollout packet.
Unsupported live-resource cases cannot be declared erased merely to finish Phase3.

## Phase4 — automatic worker: later

After the explicit path is usable and its rollout is separately approved, decide
whether and how automatic progress should use the existing engine. Preserve
stable operations, bounded retries, current authority, provider independence and
truthful status. Do not add a new queue/engine/dashboard or broad cron scheduling
as a prerequisite to the explicit flow. No removal backfill or destructive
automatic-on-removal enrollment policy is approved here.

## Phase5 — scoped rollout and live canary: separately approved

Verify exact deployed schema and code, stable Bara participant service, Pal
integration eligibility and live topology, current fenced writers and client
invalidation. Prepare the exact teacher/classroom/student/generation/operation
and provider bindings for a small explicit canary. Record real byte and provider
absence evidence separately from mocked transport and rollback SQL fixtures.
Historical backups remain outside live completion; actual retention is disclosed
without inventing dates or introducing a restoration-proof project.

Only the approved canary may activate relevant gates or make destructive live
requests. A failed or ambiguous response keeps the operation recoverable under
the same identity. Disabling new work preserves existing fences and receipts.

## Phase6 — acceptance and follow-up

Confirm ordinary production removal remains unchanged with gates off. Validate
fresh Pal on rejoin, rejection of old tokens/events/callbacks, account/classroom
isolation, provider/academic status clarity and unsupported current-data behavior.
Retain evidence that screenshots/client caches were cleared without losing
academic input. Revisit wider activation and any remaining genuine live-resource
integration separately. Legacy sitewide Pal retirement is not implied.

## Evidence rules

Feature status stays in `.ai/features.json`; this roadmap describes dependencies
and exit criteria. A source merge, successful CI, automatic Preview, production
release, migration application, activation and live erasure are distinct events.
Record exact commits/deployments and scope for each. Do not claim source fixtures
proved committed-row races or physical storage-byte deletion. Merge authority
remains with the coordinator/user after final PR Gate and review conditions.
