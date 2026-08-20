# Pika attendance scheduling v1

Risk profile: `runtime-platform` and schema mismatch.

Model recommendation: use a high-reasoning coding model because local-time
materialization, DST, opaque mappings, revisions, and cross-service retries
must remain consistent across Pika and Bara.

## Slice

Pika owns a teacher-configured classroom attendance window in
`America/Toronto`. For each active class day in a bounded reconciliation
window, Pika combines the local open/close times with the class date and emits
concrete UTC instants through the versioned Bara schedule snapshot. Bara never
reads `class_days` or infers the timetable.

This slice implements and tests the pure materializer first. Migration 127 now
defines private durable `roster_…`, `participant_…`, and `occurrence_…`
mappings plus the teacher-local window policy it consumes. The materializer accepts only
stored opaque `roster_…` and `occurrence_…` mappings, sorts occurrences
deterministically, skips non-class days, rejects nonexistent DST wall times,
and delegates final closed-shape validation to the shared v1 contract.

The authenticated Pika policy API now reads and writes that source of truth at
`/api/teacher/attendance/policy`. Writes use a teacher- and classroom-bound
private RPC with optimistic revisions; same-day windows must close after they
open, while a one-day offset explicitly supports evening classes. No default
time is guessed. The native Attendance pane exposes this through an Attendance
Hours dialog and requests an immediate 90-day sync after save. The policy API
remains dormant until migration 127 is applied.

The local rollout slice now also includes a daily Pika automation worker. It
selects the least-recently staged eligible classrooms through a
service-role-only RPC, materializes a rolling 90-day Toronto horizon, sends the
same versioned roster and schedule snapshots used by an explicit teacher sync,
and drains the durable retry outbox. Its response is aggregate-only: no teacher,
classroom, student, or provider identifiers are returned or logged. The worker
is registered as a once-daily Vercel cron, which is compatible with the free
Hobby cadence; timing imprecision is harmless because occurrences are
materialized months before Bara's own scheduler opens them.

After each drain, the worker reads a service-role-only aggregate health view.
Any retrying, still-pending, leased, or non-retryable message makes the cron
return HTTP 503 with counts and the oldest unresolved timestamp, while keeping
payloads, error details, contract references, and local IDs private. A clean or
disabled worker remains HTTP 200. Operators can invoke the separate protected
outbox route after a retry window; permanent failures remain retained for
review rather than being silently discarded.

A second daily worker reconciles Bara's authoritative snapshots back into
Pika's read projection. It is deliberately separate from schedule staging and
outbox delivery so the two jobs do not compete for one serverless execution
budget. The worker selects at most 50 active or recently closed occurrences
from the previous 48 hours, least-recently reconciled first, and fetches up to
five snapshots concurrently. Its response is aggregate-only, and any failed or
truncated batch returns HTTP 503. Reconciliation therefore repairs a dropped
Bara event without exposing student, classroom, occurrence, or provider
details in cron output.

## Implemented behind the migration gate

Roster and schedule staging does not infer revisions from timestamps. The
implemented boundary is an optimistic two-step transaction: a server-only
preparation RPC creates/loads opaque mappings and returns a database-computed
source token plus the next contract revision; each staging RPC locks the
mapping, recomputes the token, rejects concurrent source changes, and inserts
the pinned contract message while advancing that revision in the same
transaction. The pure roster and DST-safe schedule builders consume only that
closed preparation result. Roster stages before schedule and delivery preserves
that order. Explicit next-day closing windows are materialized against the next
Toronto calendar date rather than rejected or guessed.

- The daily worker and deployment registration are implemented and locally
  tested, including disabled, partial, migration-missing, and outbox-recovery
  states. Its first pilot cap is 50 least-recently-staged classrooms per run;
  truncation is explicit operator health, not silent success.
- Aggregate delivery health and unhealthy HTTP status are database-replayed
  locally. The health function is executable only by `service_role` and emits
  no row-level identity or payload data.
- The separate reconciliation worker, least-recently-reconciled selector, and
  authoritative snapshot application are implemented and locally replayed.
  Event and snapshot application fail closed unless roster, occurrence, and
  participant references resolve to one Pika classroom.
- Apply and exercise the teacher policy and opaque mappings in an explicitly
  authorized development database.
- Database-test the implemented preparation/staging RPCs, source-token conflict
  path, inactive-participant retention, and delivery-revision acknowledgements.
- Apply migration 127 to development and run the real cross-app round trip.
- Prove the hosted daily worker stages and delivers a changed class day before
  enabling it for a pilot classroom. Higher-frequency retry or a larger worker
  capacity is an institutional-readiness decision, not required for the first
  no-charge pilot.
