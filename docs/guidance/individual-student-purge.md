# Individual-student Classroom purge

## Contract and scope

This operation permanently removes one joined student's data from one
teacher-owned active or hot-archived Classroom. It is not account deletion. It
preserves the student's `users` and `student_profiles` rows, every other
Classroom and membership, classmates and teacher-authored course content, and
all Course Blueprints and Blueprint files.

The exact relational inventory includes the target membership and stable roster
binding, entries and attendance evidence, assignment work/history/feedback and
grading items, test attempts/responses/history/focus/availability and grading
items, surveys, report-card rows, announcement reads, and affected daily-log
summaries. Shared grading-run rows are retained after their target item and
student identifier are removed and their counts and non-student-derived
selection hash are recomputed.

Classroom archives and Gradex extracts are immutable whole-Classroom copies.
If any exist, their exact managed objects and Classroom ledgers are deleted
rather than selectively rewritten. This intentionally removes restore and
historical Gradex recovery for the entire Classroom, which the confirmation
dialog states before startup.

Cold Classrooms are excluded. Restore a cold Classroom to hot state under the
independent restore workflow before considering an individual purge. Student
purge is not atomic with hot- or cold-Classroom purge, Blueprint purge, archive,
restore, compaction, grading, Pal, or remote Gradex work; conflicts fail closed.

## Durable execution

1. The owning teacher opens a joined roster row. The server resolves the stable
   roster-to-user binding and returns an authoritative account email, exact row
   counts, exact managed-object digest, source revision, archive/Gradex impact,
   and conflicts.
2. The teacher types that case-sensitive account email. One transaction
   revalidates ownership, rollout, hot state, managed-storage enforcement,
   provider conflicts, inventory digests, and revision; installs a
   Classroom/student fence; and snapshots exact relational row IDs and managed
   object IDs.
3. The browser immediately advances the operation. It retains one operation UUID
   across a lost initial response. The daily cleanup cron only resumes already
   started retryable work; it never starts a purge.
4. Workers lease and delete one exact managed object at a time. Storage absence
   is authoritative before the raw path is redacted. Provider failures preserve
   progress with bounded retries. Purged bucket/path digests remain reserved so
   delayed or future writes cannot recreate erased bytes.
5. Finalization locks the same Classroom/student pair, rejects inventory or
   ownership drift, explicitly deletes every catalogued relational row in FK-safe
   order, redacts shared grading runs, removes exact managed rows and immutable
   archive/Gradex ledgers, then removes the active fence. The retained operation
   has aggregate audit evidence and an operation-scoped target digest, not the
   student's email or direct user ID.

Foreign-key cascades may remove derived binding rows, but they are not the sole
authority for product data deletion: the durable inventory and finalizer name
and verify each owned resource family. The roster binding is derived operational
state and is deliberately excluded from the v2 archive format; restore rebuilds
it from enrollment plus roster identity.

## Boundaries and failure handling

- Only the owning teacher may inspect, start, tick, or read the exact operation.
  Status authorization binds teacher, Classroom, operation UUID, and the retained
  operation-scoped student digest, including after completion.
- Writes involving the target pair, indirect child rows, archives, managed
  ownership, or whole-Classroom fences are serialized and rejected while the
  purge fence exists. Classmate and other-Classroom writes remain available.
- Pal rows, remote Gradex runs, retired assessment actor records, incomplete
  storage subject ownership, cleanup work, and active grading fail closed. These
  require a separately designed provider-erasure or reconciliation path.
- A retryable partial failure keeps its exact ledgers and fence. Terminal drift
  requires operator investigation and separately authorized repair. Generic
  orphan cleanup is not a recovery mechanism and remains disabled.

## Monitoring and operator response

The existing authenticated daily `/api/cron/cleanup-history` route runs the
bounded student-purge safety net and reads
`get_student_purge_health_snapshot`. It reports active, stuck, failed,
orphan-fence, and processing-lease-drift counts without student identifiers.
A degraded snapshot returns an unhealthy response and emits the structured
`[student-purge-health]` log entry.

After migration 124, each authenticated cleanup invocation also has durable
start/completion evidence and aggregate student-purge counters in the
service-only cleanup-history ledger. It contains no student, teacher,
Classroom, operation, or Storage identity and grants no retry or purge
authority.

For a degraded result, inspect the exact operation through service-only records,
verify fence and lease state, and confirm authoritative Storage presence before
retrying. Do not clear fences, mutate audit rows, enable generic cleanup, or
delete provider objects without fresh authorization naming the operation and
target.

## Validation and rollout

Migration 123 is additive and starts `student_purge_settings` in `disabled`
mode. Applying it does not start a purge, install a new cron, change generic
cleanup, or enable the UI.

1. Replay migrations 001–123 in ephemeral CI. Run the rollback-only database
   fixture, generated-type check, unit/API/component tests, architecture and Pika
   audits, lint, build, and teacher/student desktop/mobile light/dark browser
   verification.
2. Deploy compatible application code with the rollout disabled. Pre-123 code
   paths treat the missing settings/binding schema as unavailable and retain the
   existing email-based roster display fallback; they do not expose deletion.
3. Because this project has no staging environment, production migration 123
   application requires fresh authorization naming production and migration 123.
   Apply it disabled and verify schema, privileges, cron health, and normal
   Classroom/archive flows without starting a purge.
4. A production canary requires separate authorization naming the exact teacher,
   Classroom, student, rollout-gate change, and irreversible purge. Observe the
   object ledger, Storage absence, relational isolation, archive/Gradex loss,
   preserved user/other-Classroom data, retained audit record, and next scheduled
   cron health result.
5. Broad enablement requires another explicit authorization after canary evidence
   and scheduled monitoring are healthy.

Local reset/application, production migration application, rollout changes,
purge execution, and any exact Storage deletion each require their own current,
target-specific authorization. Generic orphan cleanup remains off because this
scope has exact ownership, fences, reservations, and resumable object processing.
