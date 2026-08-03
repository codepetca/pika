# Managed storage ownership rollout

This foundation deliberately does not provide permanent classroom deletion. It
does not grant a purge RPC, schedule cleanup, enable an application gate, or add
deletion UI. `managed_storage_objects` is the sole authority that may decide
whether a persistent managed file is live or eligible for cleanup.

## Architectural contract

- One managed object names exactly one immutable bucket/path and exactly one
  owner: Classroom, Course Blueprint, or provisional copy. A Classroom owner is
  valid in either hot relational state or the cold tombstone, never both at the
  instant an owner is created.
- Raw URLs and paths are compatibility and integrity evidence. Relational and
  operational rows carry `managed_object_id`; embedded JSON is mirrored into
  `managed_storage_json_references`, whose host columns are real foreign keys.
- A writer reserves an object, uploads or copies bytes, reads them back when a
  producer has a checksum contract, verifies Storage presence/integrity, and
  attaches the UUID in the same database transaction that changes `verified`
  to `ready`.
- A failed or interrupted writer leaves a reserved/verified row with an expiry,
  or explicitly queues it. Cleanup uses leased, retryable lifecycle transitions;
  Storage deletion is rejected unless the managed object is
  `cleanup_processing`. Completion leaves a terminal `deleted` tombstone so
  operational foreign keys remain valid and retries are idempotent. If a live
  reference appears after a compatibility worker claims an object, completion
  cancels the cleanup, preserves the bytes, and restores the object to `ready`.
- Blueprint capture and Classroom instantiation copy test documents through a
  provisional owner. The existing atomic Blueprint RPCs adopt those objects to
  the new owner inside their transaction. The pre-wrapper RPCs are not callable.
- Legacy embedded JSON can remain byte-for-byte immutable. Reconciliation binds
  exact registered bucket/path evidence to the host registry. New writers also
  persist UUIDs in JSON. A raw reference with no exact, same-owner managed object
  blocks reconciliation/readiness and is rejected after enforcement.
- Every managed writer takes a shared lock on the singleton protocol row and
  advances a writer revision. Readiness takes the conflicting row lock and
  captures the revision. Activation takes the row lock again and rejects stale
  generation, digest, or revision evidence. A pre-enforcement transaction can
  therefore neither commit after activation nor be omitted from its evidence.

## Producer and reference inventory

| Bucket | Producers | Persistent references and cleanup evidence |
| --- | --- | --- |
| `assignment-artifacts` | student submission artifact upload; archive restore copy | `assignment_submission_artifacts`; assignment document/history JSON; archive manifests and restore staging; artifact and archive-source cleanup ledgers |
| `submission-images` | authenticated inline assignment image upload; archive restore copy | assignment document/history JSON and registry; archive manifests, restore expected objects, and source cleanup |
| `test-documents` | teacher file upload; verified link snapshot; Blueprint/Classroom provisional copies; archive restore copy | tests; Blueprint assessments, immutable versions, and proposals; JSON registry; snapshot cleanup; archive restore/source ledgers |
| `classroom-archives` | verified archive export | archive operation, upload-cleanup intent, immutable `classroom_archives` row; restore and compaction operations retain the archive through that row |
| `gradex-analytics-extracts` | verified Gradex transform | archive operation, immutable extract row, and extract cleanup ledger |

Archive export uses the exact ready Classroom inventory once enforcement is on,
not URL discovery. Restore gives every restored object a deterministic operation
UUID, rewrites raw evidence and managed identities, reserves before the restore
RPC stages its expected inventory, and lets restored rows attach the objects.
Compaction preserves the archive, transfers Classroom validity from hot state to
the cold tombstone, and queues removed source objects only after the atomic hot
deletion completes.

Course packages exclude internal managed URLs and UUIDs. Classroom-to-Blueprint
and Blueprint-to-Classroom flows copy bytes; they never share ownership across
the boundary.

## Migration lineage and deployment sequence

Production history is fixed through migration 116. Files 115 and 116 in this
branch must retain the deployed SHA-256 values checked by
`pnpm check:managed-storage-lineage`. Migration 117 is a single forward-only
ownership extraction; never renumber, replace, or squash 115/116.

No command below authorizes applying a migration. A human must separately name
the exact migration and exact target under the schema rollout checklist.

1. CI runs the lineage check. Apply migration 117 as one database release while
   the migration-116 application is still serving. The
   old application remains valid because mode stays `compatibility`, and no
   cleanup worker or purge capability is enabled.
2. Deploy the ownership-aware application. It can also run briefly against
   schema 116: producers explicitly fall back to legacy writes when the new RPC
   is absent. Blueprint copies probe protocol version 2 before using provisional
   adoption. While mode remains `compatibility`, an identity-less legacy Test
   upload may be read only to create a distinct managed provisional copy; an
   explicit identity mismatch still fails closed, and this fallback is rejected
   after enforcement.
3. Register legacy Storage objects only after assigning one unambiguous owner.
   `managed_storage_legacy_object_id(bucket,path)` supplies the mandatory
   deterministic UUID; `register_legacy_managed_storage_object` rejects missing
   bytes, owner ambiguity, and conflicting replays. Do not log raw paths.
4. Bind exact relational and embedded references with
   `pnpm managed-storage:readiness reconcile`. It requires
   `MANAGED_STORAGE_TARGET` and the exact acknowledgement
   `MANAGED STORAGE RECONCILE <target>`. It fails the transaction on unmatched,
   wrong-owner, missing, or provisional embedded objects.
5. Run `pnpm managed-storage:readiness refresh` with the matching exact
   acknowledgement. Investigate only hashed finding identities. Repeat
   registration/reconciliation until the run is `ready`; do not waive findings.
   Readiness also fails while any legacy operational cleanup lease is processing,
   so activation cannot strand an already claimed delete.
6. Activate with the reported generation and digest using
   `pnpm managed-storage:readiness activate`, the target, and exact
   `MANAGED STORAGE ACTIVATE <target>` acknowledgement. Database locking makes
   this ordering executable rather than a convention.
7. Leave generic cleanup off until enforcement behavior is observed. Generic
   claiming is rejected in compatibility mode. Existing cleanup ledgers mirror
   leases, retries, and terminal completion whenever an exact managed identity
   is bound, including during compatibility rollout; unmatched raw-only rows
   retain migration-116 behavior until readiness closes that window. An active
   managed cleanup lease fences exact-path Storage writes in either mode. A
   migration-116 worker that observes a newly live reference completes as a
   cancellation rather than a deletion; its managed lease returns to `ready`.
   A manual cleanup batch additionally requires
   `MANAGED_STORAGE_CLEANUP_ENABLED=true` and
   `MANAGED STORAGE CLEANUP <target>`. No scheduler is installed here.

The database fixture `scripts/check-managed-storage-database.sh` is run by CI
after a fresh migration replay. Running it locally still counts as applying the
migrations and requires separate authorization naming the local target and exact
migrations.

## Rollback and preservation boundaries

- Application rollback while enforcement is active requires first running the
  serialized `pause` command; a legacy app would otherwise receive deliberate
  raw-writer rejections. Pausing invalidates readiness evidence. It does not
  delete registry data or managed objects.
- Disable the generic cleanup environment flag before cleanup rollback. Leases
  expire and retry safely; do not delete managed rows or Storage bytes manually.
- Do not reverse or edit deployed migrations. Correct defects with a new forward
  migration.
- Archived-hot and archived-cold Classrooms retain the same Classroom owner.
  Blueprint objects remain Blueprint-owned. Restore and Blueprint copies create
  new object identities; neither boundary adopts the source object.
- Permanent classroom deletion remains unavailable. It may later consume this
  authority only after its own design, authorization, and rollout.
