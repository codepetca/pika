# Pika–Bara attendance canary boundary

Pika's first production attendance rollout is limited to one exact Pika teacher
and one exact Pika classroom. The global attendance flag is necessary but not
sufficient: both UUID-valued canary variables must match the verified request
context before Pika reads, stages, sends, receives, or reconciles attendance.

Required variables:

- `PIKA_BARA_ATTENDANCE_ENABLED=true`
- `PIKA_BARA_ATTENDANCE_CANARY_TEACHER_ID=<Pika users.id>`
- `PIKA_BARA_ATTENDANCE_CANARY_CLASSROOM_ID=<Pika classrooms.id>`

The classroom must belong to the configured teacher. UUIDs are table-local and
may coincidentally have the same value; ownership, not UUID inequality, binds
the pair. Non-matching teacher UI
receives the existing disabled attendance view; mutation and QR APIs fail
closed before identity resolution or attendance writes. Student entry tokens
cryptographically bind the classroom, inbound events resolve their Pika
classroom before persistence, and workers use classroom-scoped database RPCs so
they never lease non-canary work. Claim and event-apply transactions lock and
recheck the active classroom row, so archive cannot interleave with those
database authorization points.

The authorization boundary is the start of each operation. Work already
claimed or already in flight may settle after a later soft archive; soft archive
retains attendance authority and projection state by design. Once archive wins
the authorization race, new teacher commands, QR issuance/check-in, ingress,
claims, reconciliation selection, and attendance reads fail closed. Pika does
not hold a database transaction or expiring lease across a Bara network call.

Changing the canary requires changing both variables and redeploying. As of
2026-08-22, production migrations through 131 are recorded as applied and the
exact Codepet Labs canary
completed one end-to-end roster, schedule, session, QR mark, projection, and
duplicate-idempotency proof after both directional HMAC pairs were aligned.
That evidence does not authorize expansion. Verify migration 131 remains
recorded; do not reapply it, and stop for fresh authorization if it is absent.
The deployed bidirectional smoke in
`pika-bara-attendance-operational-recovery.md` must pass before another
enablement or rollout-expansion decision. Run the aggregate
deployed `--mode pre-enable` audit and smoke with both flags false for a new
deployment; after separate enablement authorization, rerun the deployed gate
with `--mode enabled` before the controlled flow. This boundary is intentionally
Pika-local: Bara continues to authorize the Pika installation and never receives
Pika internal IDs.
