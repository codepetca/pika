# Classroom Lifecycle And Archive Contract

This document defines the target contract for classroom lifecycle, reusable course blueprints,
recoverable archives, managed storage, and Gradex analytics extracts. The executable source of
truth is in:

- `src/lib/contracts/classroom-lifecycle.ts`
- `src/lib/contracts/classroom-data.ts`
- `src/lib/contracts/classroom-artifacts.ts`

Migration `082_verified_classroom_archive_exports.sql` and
`POST /api/teacher/classrooms/[id]/archives` implement the export-only rollout stage. They create a
private, read-back-verified archive while retaining every hot relational row and source object.
They do not enable cold compaction, Gradex generation, or automatic export on the existing
archive toggle. Current production behavior remains unchanged until a human applies the migration;
`classrooms.archived_at` continues to make a classroom read-only while relational data stays hot.

Migration `083_resumable_classroom_archive_restore.sql` and
`POST /api/teacher/classrooms/[id]/archives/[archiveId]/restore` add the canary-only restore
foundation. Restore requires a matching cold tombstone, so it cannot overwrite a hot classroom and
is not activated merely by applying the migration.
The route separately requires `CLASSROOM_ARCHIVE_RESTORE_ENABLED=true`, an exact teacher UUID in
`CLASSROOM_ARCHIVE_RESTORE_TEACHER_IDS`, and an explicit
`CLASSROOM_ARCHIVE_RESTORE_DATABASE_BUDGET_BYTES` value.

Migration `085_atomic_classroom_archive_compaction.sql` defines the database-only hot-to-cold
transition. It requires a matching immutable verified archive, exact source revision and ownership
counts, fresh read-back evidence, and a completely staged source-object cleanup inventory before one
transaction can create the tombstone and delete rows child-first. Staged source objects become
cleanup-eligible only after the relational deletion commits. There is still no compaction runtime,
route, UI, schedule, or production caller, so applying the migration alone cannot compact a classroom.

The endpoint accepts an optional UUID `Idempotency-Key` and an optional strict retention policy.
It also requires `CLASSROOM_ARCHIVE_EXPORT_ENABLED=true` and the teacher UUID in the server-only
`CLASSROOM_ARCHIVE_EXPORT_TEACHER_IDS` allowlist, so migration application alone cannot expose the
canary operation broadly. The operation fails closed when migration 082 or the deployed git commit is
unavailable. A completed retry returns the original immutable result. Retryable failures retain the
row-id membership snapshot for up to 24 hours; terminal or expired snapshots are removed. No archive
object path, signed URL, student content, or actor identity is emitted in operation logs.

## Artifact Boundaries

The three artifacts solve different problems and must not be substituted for each other.

| Artifact | Purpose | Student data | Restorable | Storage |
|---|---|---:|---:|---|
| Course package | Seed a reusable teacher-owned blueprint | No | No | Teacher-private download/import |
| Classroom archive | Recover the complete classroom | Yes | Yes | Private `classroom-archives` bucket |
| Gradex extract | Improve and evaluate grading behavior | Deidentified subset | No | Private `gradex-analytics-extracts` bucket |

The existing `.course-package.tar` manifest remains version 2. It includes teacher-authored course
content, assignment and assessment templates, lesson templates, grading configuration, submission
requirement templates, and planned-site configuration. It excludes rosters, students, submissions,
grades, attendance, journals, telemetry, join credentials, runtime publication state, and storage
objects. A course package is never evidence that classroom data is recoverable.

## Lifecycle States

- `active`: normal teacher and student access. Current representation: `archived_at is null`.
- `archived_hot`: read-only, but relational rows and referenced source objects remain in place.
  Current representation: `archived_at is not null`.
- `archived_cold`: a tombstone and verified archive metadata remain hot; classroom-owned rows have
  been removed after a verified private archive was created. Migrations 083 and 085 define this
  representation and transition, but no production runtime populates it yet.

Only adjacent transitions are valid:

```text
active <-> archived_hot <-> archived_cold
```

There is no direct `active -> archived_cold` or `archived_cold -> active` transition. Purging is an
explicit irreversible retention operation, not a classroom lifecycle state. Cold compaction and
restore require evidence containing an immutable operation id, archive checksum, verification time,
manifest validation, resource checksum/count validation, storage-object validation, and actor-snapshot
validation. Restore completion additionally requires schema-adapter validation, actor reconciliation,
restored row/object counts, and referential-integrity validation.

Archiving must not automatically compact a classroom during initial rollout. Automatic compaction
can be considered only after export-only and restore canaries meet production thresholds and the
teacher has a visible recovery path.

## Complete Archive Format

The canonical archive is a gzip-compressed tar bundle with manifest format
`pika.classroom-archive`, version 1. The manifest is strict and contains:

- archive, classroom, and owning-teacher ids
- source application commit and source schema migration
- creation time, privacy policy version, and retention policy
- one `data/<table>.ndjson` descriptor for every classroom-owned relational table, including tables
  with zero rows
- `actors.ndjson` identity-reconciliation snapshots
- one descriptor for every copied storage object
- byte counts, row counts, and SHA-256 checksums
- a deterministic content checksum over sorted file descriptors

Relational files use UTF-8 NDJSON. Each row uses canonical JSON with recursively sorted object keys,
and rows sort by their primary-key tuple before serialization. The manifest content checksum hashes
the canonical, path-sorted sequence of each file path, byte count, and file SHA-256. Changing this
serialization requires an archive-format version or an adapter that preserves version 1 verification.

The resource inventory currently contains 42 tables. `CLASSROOM_RELATIONAL_RESOURCES` defines the
selection path, all restore dependencies, privacy classes, and Gradex disposition for each table.
Rows export and restore parent-first; destructive cleanup runs in exact reverse order.

Shared account tables are not classroom-owned and must not be restored from an archive. Actor
snapshots may contain the user id, role, email, and student profile identity fields needed for
reconciliation. They must never contain password hashes, sessions, verification codes, WorkOS ids,
tokens, or secrets. Missing actors fail restore preflight; restore must not silently create accounts
or partially remap ownership.

### Schema Drift Gate

Any migration that adds, removes, or changes a classroom-descendant foreign key must update:

1. `CLASSROOM_RELATIONAL_RESOURCES`
2. privacy classification and Gradex disposition
3. archive export and restore adapters when the serialized shape changes
4. manifest version only when backward-compatible adapters cannot preserve the version 1 contract
5. focused archive, restore, and schema-audit tests

The read-only audit command compares PostgreSQL catalog relationships with the checked-in graph:

```bash
CLASSROOM_SCHEMA_AUDIT_DATABASE_URL="$DATABASE_URL" \
  pnpm exec tsx scripts/check-classroom-resource-schema.ts
```

It fails for untracked or stale tables, missing restore dependencies, and invalid selection keys.
Run it in database-backed CI after migrations are applied to the ephemeral database.

## Managed Storage

The archive copies only objects referenced by the classroom. Bucket-wide prefix copying is unsafe
because current source paths are user-oriented and can contain data from multiple classrooms.

| Source bucket | Current visibility | Discovery rule |
|---|---|---|
| `assignment-artifacts` | Private | `assignment_submission_artifacts.storage_path` |
| `submission-images` | Public | Storage URLs embedded in classroom-owned content fields |
| `test-documents` | Public | Upload URLs and `snapshot_path` values in `tests.documents` |

Archive copies live under `objects/<source-bucket>/...` and record original bucket/path, archived
path, content type, byte count, and checksum. Source objects must not be deleted until the archive
copy is downloaded or streamed back, checksummed, and represented in the verified manifest.

Archive and Gradex destination buckets are private. Signed URLs are short-lived delivery
mechanisms, not persisted archive references. A restored classroom must use restored managed-object
paths rather than stale signed URLs.

Migration 082 caps each destination object at 50 MB, matching the Supabase Free plan upload limit.
The export route rejects a larger compressed bundle without deleting hot data. Supabase currently
documents 500 MB of database size and 1 GB of file storage on Free, so moving verified archives to
Storage can create useful headroom only after restore and cold-compaction stages are implemented and
verified. Storage usage still counts against the separate file-storage quota.

## Restore And Recovery

Restore is idempotent and fail-closed:

1. Lock the classroom tombstone with an operation id; reject concurrent lifecycle operations.
2. Download the immutable archive and verify its outer checksum.
3. Strictly parse the manifest and select an adapter chain from source to target schema.
4. Verify every resource checksum, byte count, row count, and storage object.
5. Resolve all archived actor references to existing accounts. Stop on unresolved or ambiguous ids.
6. Copy objects into an operation-scoped temporary prefix.
7. Restore rows parent-first in one database transaction, preserving ids and rejecting conflicts.
8. Verify restored counts and referential integrity before committing the transaction.
9. Promote managed-object references and transition to `archived_hot` only after all checks pass.
10. Keep the original archive immutable after restore.

Migration 083 implements restore as bounded, resumable staging rather than one large JSON RPC.
Every batch is limited to 500 rows and 1 MiB, must match the current table's exact columns, and must
arrive parent-first. Finalization rejects conflicting hot rows and commits all 42 resources in one
transaction. A transaction-local restore context prevents normal blueprint and archive revision
triggers from mutating replayed values; the archived revision is restored explicitly. PostgreSQL,
not the application, records final referential-integrity evidence after all inserts and ownership
checks pass.

Restore temporarily needs both staged JSONB and final relational rows. The begin RPC requires at
least twice the archive's uncompressed size in configured database headroom, with a 1 MiB minimum.
This conservative preflight does not guarantee that every 50 MB compressed archive fits near the
Free-plan database limit. Operators must set the database budget to the actual plan quota and leave
headroom for indexes, MVCC, and vacuum; a refusal leaves the cold archive unchanged.

On failure, roll back relational writes, remove operation-scoped temporary objects, retain the cold
tombstone and original archive, and store a retryable error code. Never mark the classroom hot or
active after a partial restore.

## Cold Compaction

Cold compaction starts only from `archived_hot`, where mutation is already blocked:

1. Create an idempotent compaction operation bound to one immutable verified archive.
2. Discover and copy referenced storage objects.
3. Write the archive, read it back, and verify the strict manifest, checksums, bytes, and counts.
4. Persist immutable archive metadata and verification evidence.
5. Stage the exact source-object cleanup inventory as durable, non-runnable rows.
6. Recheck the source revision and every ownership count, then remove classroom-owned rows
   child-first in the same transaction that creates the tombstone.
7. Transition the staged cleanup rows to retryable `pending` work only after relational commit.
8. Delete now-redundant source objects as retryable cleanup; a cleanup failure does not invalidate
   the verified archive.

If any pre-deletion check fails, leave the classroom `archived_hot` and keep all hot data intact.
If the deletion transaction fails at any point, the tombstone, row deletions, operation completion,
and cleanup eligibility all roll back together. A terminal preflight failure removes the staged
cleanup inventory; a retryable failure retains it under the same idempotency key until expiry.

## Gradex Extract

Gradex uses a separate derived artifact, never the restore archive directly. Version 1 includes only
the explicitly allowlisted assignment/test authoring, submission, grading, feedback, and AI-run
resources in `GRADEX_RESOURCE_TABLES`.

`src/lib/server/classroom-gradex-extract.ts` implements the pure artifact boundary. It accepts only a
strictly verified classroom archive, applies explicit per-table projections, replaces relational ids
with per-extract HMAC references, rewrites structured timestamps as millisecond offsets from the
source archive creation time, and emits a deterministic tar+gzip bundle with resource and content
checksums. Its independent verifier repeats canonical serialization, checksum, pseudonym shape,
relationship, and direct-identifier checks.

The extract excludes rosters, enrollment, journals, attendance, report cards, focus telemetry,
attempt histories, raw artifacts, storage objects, URLs, and storage paths. All database ids and user
references are HMAC-SHA-256 pseudonyms scoped to one extract. Free text must pass known-identity and
pattern-based redaction. Timestamps become relative offsets. Release is blocked unless the direct
identifier scanner reports zero findings.

Every Gradex manifest has a finite `delete_after` timestamp capped at 90 days in version 1.
Regeneration writes a new immutable
extract and schedules the superseded object for deletion. A Gradex extract cannot restore a
classroom and must never be accepted by a restore endpoint.

The transformer alone is not a runtime pipeline. It exposes no teacher/API trigger, private upload,
deletion worker, or production canary. Those runtime controls must exist before any extract is
generated from production data.

Migration `084_gradex_extract_operations.sql` adds the durable database half of that pipeline:
service-role-only idempotent begin/finalize/fail RPCs, immutable verified extract metadata, and a
separate lease-based cleanup ledger with bounded retry. It still exposes no teacher/API trigger and
does not upload or delete any object by itself. The runtime coordinator must read back and verify the
private object before finalization; the cleanup worker must delete the object before recording its
lease as complete.

`src/lib/server/classroom-gradex-operations.ts` implements the gated generation coordinator. The
coordinator itself requires `CLASSROOM_GRADEX_EXTRACT_ENABLED=true`, an exact teacher UUID in
`CLASSROOM_GRADEX_EXTRACT_TEACHER_IDS`, and a server-only
`CLASSROOM_GRADEX_EXTRACT_HMAC_SECRET` of at least 32 bytes. It binds a non-secret fingerprint of
that key into the idempotency request, verifies source archive metadata, checksum, manifest, and
identity, uploads without overwrite to the private Gradex bucket, downloads the complete object,
repeats the independent integrity/privacy/relationship verification, and only then finalizes
migration 084 evidence. A matching object is reused during retry; a transient finalization failure
retains the verified object, while terminal rejection removes only an object uploaded by that
attempt.

`POST /api/teacher/classrooms/[id]/archives/[archiveId]/gradex` is the separately gated teacher
trigger. It requires teacher authentication, a caller-supplied UUID `Idempotency-Key`, an explicit
future `delete_after` no more than 90 days away, the coordinator's enabled teacher allowlist, and a
second `CLASSROOM_GRADEX_TRIGGER_ENABLED=true` gate with the exact source archive UUID in
`CLASSROOM_GRADEX_TRIGGER_ARCHIVE_IDS`. Migration 084 remains the ownership authority: its begin RPC
matches the immutable archive to both the authenticated teacher id and classroom id, including after
the classroom becomes cold. The route has no UI or cron caller and every gate defaults off, so merely
deploying it cannot generate an extract. Enabling a named production canary still requires explicit
human migration, environment, archive, retention, and invocation approval.

`src/lib/server/classroom-gradex-cleanup.ts` implements the server-only retention worker. It requires
`CLASSROOM_GRADEX_CLEANUP_ENABLED=true`, claims at most 10 migration 084 leases per invocation, and
accepts only the private Gradex bucket plus the canonical
`<teacher>/<classroom>/<extract>/gradex-v1.tar.gz` path whose extract segment matches the claim. For
each independent claim it requests deletion, reads the exact path again, and completes the current
lease only after Storage authoritatively reports that key absent. A present object, uncertain
read-back, rejected completion, or unexpected client failure never records deletion; the worker
records a stable retry code when it still owns the lease. Logs expose only lease ids, counts, and
error codes, never paths or classroom content.

`/api/cron/classroom-gradex-cleanup` is the manual cleanup canary boundary. It requires
`CRON_SECRET`, `CLASSROOM_GRADEX_CLEANUP_TRIGGER_ENABLED=true`, and the worker's independent
`CLASSROOM_GRADEX_CLEANUP_ENABLED=true` gate. Each invocation claims at most one object, reports a
durably recorded item retry as a healthy invocation, and returns `503` if retry evidence is
incomplete. GET and POST have the same contract. The route is not listed in `vercel.json`, has no UI
caller, and both cleanup gates default off; adding deployment scheduling requires separate approval
after migration 084 and a named manual canary have been verified.

## Observability

Every archive, restore, compaction, cleanup, Gradex generation, and purge operation needs durable
operation metadata:

- operation id, classroom id, actor id, operation type, and idempotency key
- source/target lifecycle states and schema versions
- started/completed timestamps, retry count, and stable error code
- row counts and bytes by resource, object count/bytes by bucket, compression ratio, and checksum
- unresolved actor count, adapter chain, verification result, and cleanup status

Logs and metrics must not contain student names, email, raw work, grades, archive URLs, signed URLs,
or object contents. Alerts should cover verification failures, partial cleanup, unresolved actors,
restore rollback, and archives without a successful read-back check.

## Backward-Compatible Rollout And Production Verification

1. **Contract only:** land schemas, inventory, tests, and catalog audit. No runtime behavior changes.
2. **Inventory mode:** run read-only row/object sizing for archived classrooms and compare catalog
   relationships with the contract. No writes.
3. **Export only:** create private archives for selected archived classrooms but retain all hot data.
   Compare counts/checksums and measure compression. Migration 082 and the teacher-only API implement
   this stage; rollout still requires human migration application and selected production canaries.
4. **Restore canary:** use migration 083's rollback-only database contract first. A teacher-approved
   cold canary may then use the gated restore endpoint; compare all rows/objects and preserve the
   immutable source archive. Production compaction remains disabled.
5. **Opt-in cold compaction:** add a separately gated runtime only after migration 085's rollback
   contract and the real compaction-to-restore database round trip pass. Then compact selected
   classrooms only after verified archive and restore evidence exists; monitor recovery and storage
   cleanup.
6. **Default cold policy:** consider automatic compaction after archiving only after sustained canary
   success, documented recovery drills, retention approval, and a teacher-visible restore workflow.
7. **Legacy retirement:** remove old archive representations only after production counts show no
   remaining readers/writers and every retained archive has a tested adapter.

Production database access for inventory and verification is read-only unless a human explicitly
approves a named canary operation. Migrations are applied by humans.

## Export-Only Verification And Recovery

The export coordinator uses a small database membership snapshot containing resource table names and
primary-key values, rather than duplicating full classroom JSON in Postgres. `actors.ndjson` is captured
separately from explicit, schema-audited foreign-key columns to `users`; arbitrary UUIDs in classroom
content are never treated as actor references. Its strict allowlist excludes password hashes, WorkOS
ids, sessions, verification codes, and tokens. Revision triggers cover all 41 non-root resources. A
revision-row share lock makes membership and actor capture consistent; finalization rejects any
descendant mutation that commits before verification.

Every successful export must prove all of the following before `classroom_archives` metadata is
inserted: exact 42-resource counts, canonical NDJSON checksums, strict manifest parsing, referenced
storage-object checksums, actor snapshot validation, outer artifact checksum, private upload, full
download/read-back equality, and unchanged source revision. Verified metadata cannot be updated.

Recovery for this stage is intentionally conservative:

1. A failure before finalization leaves the classroom `archived_hot`; no classroom rows or source
   objects are removed.
2. Retry the same idempotency key only when the operation reports `retryable: true` and its snapshot
   has not expired.
3. Use a new idempotency key after terminal failure or source mutation.
4. An orphan uploaded by the current request is removed when terminal finalization fails. A process
   interruption can leave an unreferenced private object; cleanup automation remains part of the
   compaction phase and must compare object paths with the durable operation ledger.
5. Never treat export-only success as permission to delete hot rows. Restore canary equality and the
   opt-in compaction transaction are still required.

Run the database-backed contract in an ephemeral Supabase instance:

```bash
supabase db start
bash scripts/check-classroom-archive-database.sh
CLASSROOM_SCHEMA_AUDIT_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres \
  pnpm exec tsx scripts/check-classroom-resource-schema.ts
supabase stop --no-backup
```
