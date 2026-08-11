# Hot archived classroom permanent deletion

## Contract

Permanent deletion is available only to the owning teacher for a hot archived
classroom. It removes the complete `CLASSROOM_RELATIONAL_RESOURCES` graph,
purge-only operational rows, archive/restore/Gradex ledgers, and every exact
migration-117 managed object owned by the classroom or by an expired
provisional operation targeting it. User accounts, Course Blueprints, immutable
Blueprint versions, and Blueprint-owned files are preserved.

Cold archived Classroom deletion is a separate state machine documented in
`docs/guidance/cold-archived-classroom-purge.md`. Comprehensive
individual-student purging remains a follow-up scope. Neither is an atomic
dependency of hot deletion because cold archives have a separate
tombstone/recovery authority and users are deliberately outside Classroom
ownership.

## State machine

1. The teacher reviews a stable impact summary and types the classroom name or
   `DELETE`.
2. One transaction revalidates owner, hot state, rollout gates, source revision,
   managed inventory digest, and conflicts; installs the classroom fence; and
   snapshots relational membership plus exact managed object IDs.
3. Workers lease one exact object at a time. Storage deletion is authorized only
   by that live purge lease (or by the independent generic cleanup lease).
4. Completion verifies Storage absence before redacting the raw path. Provider
   failures are recorded with retry timing; missing objects are idempotent.
5. Finalization verifies every file is absent and no owned managed identity was
   added, reconciles workflow/operational records, explicitly deletes the
   catalogued relational graph, deletes exact managed rows, and then marks the
   operation complete.

The database fence remains after a partial failure. Browser retries and the
authenticated cleanup cron resume the durable operation.

The cleanup cron's aggregate, privacy-safe health checks and operator response
are documented in `docs/guidance/managed-deletion-monitoring.md`.

A transient object failure remains retryable but is not reclaimed before its
`next_attempt_at`; an empty claim means “nothing is due,” not “all files are
gone.” If Storage reports that a previously verified-deleted path exists again,
the operation stops terminally with its fence intact. An operator must inspect
and remove that exact provider object before any separately reviewed recovery;
the redacted purge ledger is deliberately insufficient to delete it again.

## Concurrency and authorization

- Database ownership checks are authoritative; URL parameters do not grant
  access and status/tick endpoints bind teacher, classroom, and operation.
- Managed ownership enforcement must be active before deletion is available.
- Archive, restore, compaction, Gradex, grading, Blueprint, provisional-copy,
  and active storage-cleanup work blocks startup.
- Purge orchestrators take locks in `managed settings → purge settings →
  classroom lifecycle → classroom/revision → managed object` order.
- Trigger-level writers use a nonblocking lifecycle lock. They fail retryably
  instead of waiting while holding row locks and cannot deadlock the purge.
- Purged bucket/path identities remain reserved, preventing late or future
  recreation after the managed row is removed.

## UX boundary

The archived classroom action says **Delete permanently**. The dialog states
that deletion cannot be undone and removes all student work, submissions,
tests, grades, attendance/logs, feedback, roster data, and uploads. It also
states that Course Blueprints and user accounts are kept. The action is absent
for active classrooms, cold archives, and student surfaces.

## Rollout

Migration 118 creates `classroom_purge_settings` in `disabled` mode. Applying it
does not enable deletion.

Migration 119 appends the validated one-time managed identity binding required
for verified archive rows created before managed storage. It does not enable
deletion or cleanup.

Before applying 118, verify that migration 115 has no unfinished deletion:

```sql
select id, classroom_id, status, retryable, error_code
from public.classroom_purge_operations
where status <> 'completed';
```

Migration 118 aborts with `unfinished_legacy_classroom_purge_operations` if this
query returns a row. Stop and obtain a separately reviewed reconciliation plan;
do not coerce the legacy raw-path ledger into managed ownership or delete its
fence by hand.

1. Replay migrations 001–119 in a disposable/local environment and run the
   destructive, concurrency, retry, authorization, and partial-failure fixtures.
2. Deploy compatibility app code while both managed ownership enforcement and
   classroom purge rollout remain disabled. The daily cleanup route treats a
   missing migration-118 table as a no-op so code-first deployment stays safe.
3. Complete migration-117 readiness and activate managed ownership under its
   own runbook.
4. Enable one exact teacher/classroom canary in `classroom_purge_settings`.
5. Observe Storage/DB postconditions and retry behavior, then explicitly approve
   broader enablement.

Every migration application or rollout-gate change requires fresh authorization
naming the exact target and migration or SQL change. Nothing in this branch
authorizes staging or production changes.

The verified production database already contains the final schemas from both
versions under its separately authorized reconciliation history. Do not reapply
or repair either remote version. The canonical source order keeps merged
migration 118 immutable and appends compatibility migration 119 so databases
that already applied `main` can upgrade safely.

## Follow-up scopes

- Add a durable, resumable deletion operation for teacher-owned Course
  Blueprints and their managed files. Until that exists, Blueprint deletion must
  fail closed when managed ownership would otherwise be orphaned.
- Before deleting the preserved production canary Blueprint, create and verify
  a Classroom from it to prove that classroom purge preserved a reusable course
  package, including its managed test material.
- Comprehensive individual-student purging remains a separate follow-up scope.
- Cold archived Classroom deletion remains independently gated under migration
  122 and never shares a migration or rollout with student purging.
