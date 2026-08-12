# Cold archived Classroom permanent deletion

## Deletion and preservation contract

This scope permanently removes one teacher-owned `archived_cold` Classroom. It
deletes the authoritative cold tombstone, cold actor lineage, every retained
Classroom archive, archive/export/compaction/restore ledger and staging row,
Gradex extracts and cleanup rows, and every exact managed Storage object owned
by that Classroom or by an unsettled provisional owner targeting it.

It preserves all user accounts, Course Blueprints and their managed files,
other Classrooms, and data belonging to those other Classrooms. A student actor
record in the cold archive is evidence that the stored Classroom contains that
student; it is not authority to delete the student account or the student's
data elsewhere.

The immutable recovery archive is deleted last. Once that exact object is
verified absent, restoring or recovering the Classroom is no longer possible.
The operation never edits an archive bundle, restores hot rows merely to delete
them, or invokes generic orphan cleanup.

## State machine

1. The owning teacher reviews a stable impact snapshot and types the exact
   Classroom title or `DELETE STORED ARCHIVE`.
2. One transaction revalidates the teacher, tombstone/archive identity, source
   revision, independent rollout gate, managed-storage enforcement, active
   operation conflicts, exact managed inventory digest, and privacy-safe cold
   resource digest. It then installs a cold lifecycle fence and snapshots exact
   managed object IDs plus hashed operational identities.
3. The browser advances the operation immediately. The existing authenticated
   daily cleanup cron is only a safety net for already-started operations; it
   never starts a cold purge.
4. A worker leases one exact managed object at a time. Ordinary Classroom files
   use priority 10, non-authoritative retained archives priority 90, and the
   tombstone's authoritative recovery archive priority 100. A higher priority
   object is ineligible while any lower-priority object is unfinished.
5. Storage absence is proved before the raw path is redacted. Missing objects
   are idempotent success. Provider failures are recorded with bounded backoff;
   a live lease prevents concurrent claims.
6. Finalization verifies no object reappeared, no managed owner or cold
   operational identity drifted, and all snapshotted objects are deleted. It
   explicitly reconciles every cold table, removes exact managed registry rows,
   clears the fence, redacts the impact, and retains the aggregate operation
   audit record.

Partial or terminal failure leaves the tombstone and fence intact. The teacher
can safely resume a retryable operation. Terminal drift requires an operator
investigation and separately authorized repair; it is never repaired by the
cron.

## Authorization and concurrency

- Only the owning teacher can read impact, start, inspect, or tick an operation.
  Status and tick routes bind teacher, Classroom, archive, operation, and purge
  scope. Migration 122 also wraps the pre-existing hot worker RPCs so neither
  safety net can advance the other scope.
- Managed ownership must be `enforced`. The migration creates a separate
  `cold_classroom_purge_settings` gate in `disabled` mode; the hot-Classroom and
  Blueprint rollout settings do not enable it.
- Active archive/restore/compaction, Storage, Gradex cleanup, grading, or
  Blueprint work blocks startup. The cold fence blocks restore and tombstone
  mutation after deletion starts.
- Locks follow the existing managed-settings, scope-settings, Classroom
  lifecycle, tombstone/archive, and managed-object order. Object deletion
  requires the exact live lease in the database and Storage trigger.
- Cold deletion is not atomic with hot-Classroom deletion. A Classroom has one
  authoritative representation at a time. It is also not atomic with the
  independently gated individual-student purge. A cold Classroom must be
  restored to hot state before an individual purge can be considered; see
  `docs/guidance/individual-student-purge.md`.

## Teacher UX

The **Delete permanently** action appears only on a **Stored archive** row whose
Classroom ID is returned by the independent cold rollout gate. The dialog names
the recovery loss, retained archives and Gradex extracts, student/record/file
counts, missing Storage registrations, and any early scheduled-retention
override. It explicitly says user accounts, Course Blueprints, other
Classrooms, and their data are kept; deletion cannot be cancelled; interrupted
work resumes; and the recovery archive is removed last.

No student surface receives the action. Restore availability and cold deletion
availability are independent.

## Rollout and validation

Migration 122 is additive and disabled by default. It does not install a cron,
change a rollout gate, start a purge, enable generic cleanup, or delete an
object merely by being applied.

1. Run static migration tests, TypeScript, route/server/component tests, the
   Pika audit, build, and desktop/mobile light/dark visual verification.
2. With fresh authorization naming the local Pika database and migration 122,
   apply exactly that migration and regenerate database types. Run
   `pnpm check:cold-classroom-purge-db`; the fixture refuses an unexpected
   Docker target and contains all destructive evidence inside a rollback.
3. Deploy compatible application code and keep the new gate disabled. Verify
   normal hot and Blueprint purge safety nets remain scope-isolated and the
   aggregate health snapshot stays healthy.
4. With fresh authorization naming staging and migration 122, apply it with the
   gate disabled. Exercise one synthetic/staging cold archive and observe retry,
   fence, Storage, audit, and monitoring postconditions.
5. With separate fresh authorization, set one exact teacher/Classroom canary.
   Confirm the recovery-loss acknowledgement, archive-last ordering, preserved
   users/Blueprints/other Classrooms, and zero managed-storage drift.
6. Broad rollout requires a further explicit gate change after the canary and
   at least two scheduled monitoring runs remain healthy.

Every local, staging, or production migration application and every gate
change or purge requires fresh authorization naming its exact target and
operation. Generic orphan cleanup remains disabled; exact owned-object
processing makes it unnecessary for this scope.
