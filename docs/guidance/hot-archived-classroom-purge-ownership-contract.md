# Hot-Archived Classroom Purge Ownership Contract

Status: approved redesign contract; implementation and rollout remain disabled.

This contract narrows permanent deletion to one enforceable ownership model. It replaces path
inference, table-by-table best guesses, and feature-specific deletion fences as the authority for a
hot-archived classroom purge.

## Scope

The operation permanently deletes one `archived_hot` classroom owned by the authenticated teacher.
It removes all classroom-scoped student work, submissions, tests, grades, attendance and logs,
feedback, roster data, operational records, verified archives, Gradex extracts, interrupted uploads,
and managed files. It preserves `users`, `student_profiles`, Course Blueprints, immutable Blueprint
Versions, and every file owned by a Course Blueprint.

Cold archived classroom deletion and comprehensive individual-student purging remain follow-up
scopes. Course Blueprint deletion is also outside this operation and must not share the classroom
purge state machine. Until that follow-up is designed, a Blueprint with managed files is preserved
by its restrictive owner foreign key and deletion fails closed.

## 1. Relational Ownership

### Teaching data

Every restorable classroom teaching-data table must have a real foreign-key path to `classrooms`.
Every owning edge uses `ON DELETE CASCADE`, and every foreign-key column used by that graph is
indexed. `CLASSROOM_RELATIONAL_RESOURCES` remains the archive/restore serialization contract, while
the PostgreSQL catalog is the deletion ownership authority.

Migration 117 must repair missing owning edges, including
`assignment_doc_save_operations.assignment_doc_id -> assignment_docs.id ON DELETE CASCADE`.
CI must fail when:

- a declared classroom resource lacks its catalog foreign key;
- an owning foreign key does not cascade;
- an owning foreign-key column lacks an index;
- a UUID-style parent reference in a classroom resource has neither a foreign key nor a named,
  reviewed exception; or
- the catalog discovers a classroom descendant absent from the checked-in contract.

The purge snapshots exact row counts before destructive work. Its relational finalizer may delete
the `classrooms` root only after file cleanup succeeds, but it must then verify that every registered
resource has zero rows for the purged classroom. Cascades are a structural safety mechanism, not the
only deletion evidence.

### Operational data

Archive, restore, compaction, Gradex, cleanup, and purge ledgers are not forced into the hot-row
cascade graph because cold compaction intentionally removes the hot classroom row while recovery
operations remain durable. They must instead have an explicit classroom identity, a catalog-backed
parent where their lifecycle permits it, and a documented purge reconciliation rule.

For hot purge, migration 117 must delete or redact every matching operational row in the same final
transaction after all managed files are absent. The durable completed purge operation may retain
only privacy-safe aggregate evidence needed for idempotent status reads; it must not retain classroom
content, raw paths, row identifiers, roster membership, or student identity.

Workflow references backed by a real non-owning foreign key must be listed in
`CLASSROOM_NON_OWNING_REFERENCES`. Deliberately FK-free lifecycle scopes must be
listed separately in `CLASSROOM_LOGICAL_SCOPE_REFERENCES`. Both kinds are reconciled before the classroom root delete. Course Blueprint
proposals and editing sessions are cancelled or detached; they are never cascaded into Blueprint or
user deletion.

## 2. Managed File Ownership

`managed_storage_objects` is the sole deletion authority for persistent Pika-managed objects in:

- `assignment-artifacts`
- `submission-images`
- `test-documents`
- `classroom-archives`
- `gradex-analytics-extracts`

Each ready object has one immutable lifecycle scope: a classroom UUID or one Course Blueprint. A
classroom UUID remains the same when its hot row is compacted into a cold tombstone and when it is
restored; hot/cold availability is not file ownership. `created_by_user_id` and
`data_subject_user_id` are attribution only and do not grant lifecycle ownership. User deletion is
not part of classroom purge.

The classroom scope column deliberately has no foreign key to the hot `classrooms` table. A hot-row
foreign key would force an ownership transfer during compaction, and that transfer creates an
untracked or multiply-owned interval. Instead, database guards require the scope UUID to resolve to
exactly one hot classroom or cold tombstone at lifecycle boundaries. The Blueprint owner keeps its
ordinary foreign key. This is the sole reviewed exception to the relational-parent rule.

Compaction and restore may briefly have both availability rows inside their single database
transaction, but they do not mutate file ownership during that interval and may not commit in that
state. Readiness reports any committed `missing` or `split` scope and prevents rollout.

Every relational reference or operational ledger that can keep a persistent object alive must store
a foreign key to its managed object. Raw bucket/path columns may remain as immutable integrity and
compatibility evidence during rollout, but they are not independent ownership or deletion authority.
This includes source uploads, archive artifacts, Gradex extracts, interrupted archive/Gradex upload
cleanup, restore objects, cold-compaction source cleanup, and test-document cleanup.

New writes follow one protocol:

1. reserve a managed object for the exact owner and immutable storage identity;
2. write the exact Storage key;
3. read it back and verify required size/hash evidence;
4. atomically mark the object ready and attach the domain/ledger reference; or
5. leave the same managed row as durable retryable cleanup work.

A permanent purge snapshots every managed object owned by the hot classroom. It may also adopt
historical operational cleanup objects into that ownership only through deterministic, verified
backfill. It never discovers purge membership from URLs, JSON recursion, user path prefixes, or a
manual union of feature tables.

Purge object rows reference the managed object while deletion is pending. The worker deletes only
the exact immutable key, verifies authoritative absence, and records completion under its current
lease. The finalizer removes the managed rows only after every purge item is complete. Terminal audit
rows retain a SHA-256 path fingerprint, not the raw path.

Persistent owned objects have only two physical deletion authorities: the generic managed cleanup
worker and a leased classroom purge object. Compatibility cleanup ledgers may finish once durable
exact-object delegation commits. Ownerless historical cleanup evidence may finish only after
authoritative absence; operational ledgers may retain their stricter completion evidence. The only
direct-delete exceptions are exact,
durably reserved copy targets that have not yet been adopted by any classroom or Blueprint; those
workflows may remove only their own provisional target and must fail closed once a managed owner
exists.

No classroom is eligible for purge until readiness proves:

- every current classroom reference resolves to a classroom-owned managed object whose state is
  stable for purge (`ready`, `cleanup_pending`, or a physically present interrupted upload);
- every nonterminal archive, Gradex, restore, source-cleanup, and interrupted-upload ledger resolves
  to a managed object with the expected classroom ownership;
- no classroom object is shared with another classroom or a Course Blueprint;
- Blueprint references resolve only to Blueprint-owned objects; and
- the classroom resource revision and managed inventory digest remain stable across verification.

Legacy Blueprint/Classroom path reconciliation is a bounded rollout/backfill concern. It must not be
part of the steady-state purge worker or finalizer.

## 3. Lifecycle Fence And Lock Order

All operations that can mutate classroom rows, managed ownership, or classroom-owned files use the
same transaction ordering:

1. read and lock rollout settings when the operation depends on a gate;
2. acquire the classroom lifecycle advisory lock;
3. lock the classroom row or cold tombstone;
4. lock the durable operation row;
5. lock managed-object rows in UUID order;
6. acquire exact storage-identity locks in `(bucket, path-hash)` order.

Code must not acquire an earlier lock after a later lock. Begin, claim, completion, failure,
finalization, archive, restore, grading, Blueprint capture/instantiate, and managed upload adoption
must either follow this order or call a shared primitive that does. Existing direct or legacy row
writes use a non-blocking lifecycle guard: if an earlier lifecycle lock is already held, the write
aborts retryably and releases its later row lock instead of waiting and forming a deadlock.

The purge fence is installed in the same transaction that rechecks teacher ownership,
`archived_at is not null`, readiness, and conflicts. While fenced, ordinary classroom mutations,
archive/restore/compaction, grading/repository review, Blueprint capture/proposals/editing, and new
managed uploads fail closed. Workers may finish only leases issued by the fenced purge.

Executable two-session tests must prove opposing operations serialize or fail with a stable conflict
instead of deadlocking. A statement timeout is test evidence, not the concurrency mechanism.

## 4. Durable Purge State Machine

The operation states are:

```text
inventory_pending -> deleting_files -> finalizing_relational -> completed
                                      \-> retryable_failure
```

The same idempotency key always resolves to the same operation. Every tick is bounded. Browser
closure, Storage failure, a lost lease, or server termination leaves durable resumable state. A
retry never expands the original ownership snapshot. If new owned state appears despite the fence,
finalization fails with drift and preserves the classroom for investigation.

The final relational transaction:

1. takes the canonical locks;
2. rechecks the fence, teacher, hot-archive state, and immutable inventory digest;
3. proves every purge object is authoritatively absent;
4. reconciles all classroom operational ledgers and non-owning workflow references;
5. deletes the corresponding managed-object rows after no retaining reference remains;
6. deletes the classroom root;
7. verifies every registered classroom resource is absent;
8. verifies users, Course Blueprints, Blueprint Versions, and Blueprint-owned managed objects were
   not deleted; and
9. redacts the durable purge operation before commit.

Any failure rolls back the relational finalization. File deletions already proven absent remain
recorded and are safely reusable on retry.

## 5. Authorization And UX Contract

Only the owning teacher may request impact, begin purge, tick, or read purge status. Students,
non-owners, cold tombstones, active classrooms, and merely archive-capable teachers are rejected.

The confirmation dialog shows students, relational rows, managed files/bytes, archives, Gradex
extracts, and interrupted uploads. It requires the exact classroom name or `DELETE` and states:

> This cannot be undone. It permanently removes all student work, submissions, tests, grades,
> attendance and logs, feedback, roster data, and uploads. Course Blueprints and user accounts are
> preserved.

The server validates the confirmation independently of the UI.

## 6. Rollout And Failure Boundaries

Migration 117 is one consolidated, unshipped migration. It remains unapplied until separately
authorized by exact filename and target. Deploying code does not enable ownership enforcement,
cleanup workers, or purge. Every database and environment gate defaults off.

Rollout is staged:

1. land the contract, catalog audits, schema, and disabled dual-compatible producers;
2. replay migration 117 only in an authorized ephemeral/local database and regenerate types;
3. run read-only readiness and repair/backfill every supported historical ledger/reference;
4. prove no unmanaged classroom files and no ledger without managed ownership;
5. enable managed-write enforcement for a named non-production canary;
6. run concurrency, crash/retry, and exact-deletion fixtures;
7. visually verify teacher/student and desktop/mobile boundaries;
8. deploy with purge disabled;
9. separately authorize a named production readiness pass and configure the database-enforced
   canary teacher/classroom pair while the general purge gate remains off; and
10. enable general hot purge only after canary evidence is reviewed.

Turning gates off stops new work without deleting durable ledgers. No rollback process may recreate
already deleted files. Production migration application, gate changes, worker activation, and a
destructive canary each require fresh, separately scoped authorization.

The canary gate is distinct from general release. It stores one exact teacher UUID and classroom
UUID, and begin, claim, and finalize enforce both identifiers in the database. Enabling a canary
therefore cannot expose permanent deletion to another owner or classroom; the global
`hot_classroom_purge_enabled` gate remains false until canary evidence has been reviewed.

## 7. Acceptance Evidence

The redesign is not complete until tests cover:

- catalog ownership, cascade actions, FK indexes, and missing-parent-reference detection;
- all five managed buckets and every operational ledger;
- historical pending source-cleanup rows from the production round-trip shape;
- teacher owner/non-owner and student authorization boundaries;
- active, hot, cold, and conflicting-operation lifecycle states;
- exact confirmation validation;
- archive, restore, grading, Blueprint, managed upload, and purge races;
- canonical lock ordering with two database sessions;
- Storage partial failure, lost leases, authoritative absence, and idempotent retry;
- relational-finalizer rollback and postcondition verification;
- preservation of user accounts, Course Blueprints, Blueprint Versions, and Blueprint-owned files;
- privacy-safe terminal redaction; and
- teacher desktop/mobile UI plus student/non-owner absence of the action.
