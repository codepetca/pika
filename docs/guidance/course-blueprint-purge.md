# Course Blueprint permanent deletion

## Contract

Permanent deletion is available only to the owning teacher for a Pika-managed
Course Blueprint. It removes the Blueprint draft graph, immutable Versions,
proposals and editing sessions, its published planned course site, and exact
Blueprint-owned managed objects in `test-documents`.

It does **not** delete users, linked Classrooms, Classroom content, student work,
or the Classroom-owned file copies created during instantiation. Linked
Classrooms are explicitly unlinked and all references to the deleted Blueprint
Versions are cleared.

Repository-managed Blueprints must switch to Pika as Editor first. The teacher
must review a fresh impact summary and type the exact Blueprint title or
`DELETE`. The confirmation becomes stale if graph membership, a linked
Classroom, the draft revision, or a managed-object identity changes.
After deletion begins, linked Classrooms remain editable; finalization checks a
separate Blueprint-owned membership digest so preserved Classroom changes do
not strand an operation after its files have been removed.

## Safety boundaries

- Migration 120 creates an independent rollout gate that defaults to
  `disabled`; applying the migration never enables deletion.
- A durable operation, fence, exact-object work queue, and expiring leases make
  retries idempotent. Raw Storage paths are erased from the work queue after
  verified provider deletion, while their hashes remain reserved.
- Blueprint, Version-lineage, managed-object, provisional-copy, and Storage
  triggers prevent writes from crossing an active purge.
- Blueprint-to-Classroom copies register their source intent before downloading
  or copying bytes, heartbeat while live, and explicitly close as adopted or
  aborted only after ownership or cleanup is durable. Every unclosed intent
  blocks deletion even after its lease expires; lease age is diagnostic state,
  not deletion authority. Deterministic operation retries can settle an intent.
  A hard-crash orphan requires the private recovery RPC, an exact expired
  snapshot, no running operation, no live provisional files, a 24-hour stale
  interval, and an operator attestation that no worker remains.
- Database finalization explicitly reconciles linked Classrooms and operation
  audit rows, deletes each Blueprint table, and then removes the root. Foreign
  key cascades remain an integrity backstop, not the deletion implementation.
- The legacy root DELETE endpoint and direct teacher root deletes fail closed.
- A scheduled safety net resumes retryable operations if the browser closes.
  The teacher API also rediscovers an active operation from its durable ledger,
  returns its persisted impact, and reuses the same request identity after a
  lost response instead of recomputing against intentionally deleted files.
  Terminal drift or Storage reappearance stops the operation with its fence and
  evidence intact for operator review.

## Rollout

1. Apply migration 120 to a reset local database only with fresh authorization
   naming `120_course_blueprint_purge_managed_ownership.sql`.
2. Regenerate database types, reseed, and run
   `scripts/check-course-blueprint-purge-database.sh`. This fixture covers
   ownership, rollout defaults, active-operation blocking, write concurrency,
   provider failure, heartbeat retry, fail-closed expired copy intents, guarded
   hard-crash recovery, exact Storage deletion, path-reappearance defense,
   Classroom preservation, lineage cleanup, and user preservation.
3. Keep rollout disabled while application and migration compatibility are
   reviewed. Do not reuse Classroom-purge or generic-cleanup rollout switches.
4. With separate production authorization, apply migration 120 once. Confirm
   the gate remains disabled and run read-only inventory checks.
5. Enable one synthetic teacher/Blueprint canary using the exact IDs and current
   inventory digest. Exercise deletion and verify preserved linked Classrooms,
   users, unrelated Blueprints, Storage totals, and the durable operation audit.
6. Expand only after canary evidence and a fresh decision. Generic cleanup and
   Classroom deletion remain independently gated.

## Follow-up scopes

This contract does not add user-account deletion, comprehensive individual-user
purging, or cold-archived Classroom deletion. Account deletion for a user who
owns managed Blueprint files needs its own atomic ownership and retention
contract rather than being folded into Blueprint deletion implicitly.
