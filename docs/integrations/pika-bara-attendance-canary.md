# Pika–Bara attendance canary boundary

In `exact_canary` mode, Pika attendance is limited to one exact Pika teacher and
one exact Pika classroom. Production now runs in `teacher_entitlements` mode;
an active audited teacher entitlement admits that teacher's active classrooms,
while the exact pair remains the deployed signed-smoke scope. The global
attendance flag is necessary but not sufficient in either mode.

Exact-canary mode variables:

- `PIKA_BARA_ATTENDANCE_ENABLED=true`
- `PIKA_BARA_ATTENDANCE_CANARY_TEACHER_ID=<Pika users.id>`
- `PIKA_BARA_ATTENDANCE_CANARY_CLASSROOM_ID=<Pika classrooms.id>`
- `PIKA_BARA_ATTENDANCE_SCOPE_MODE=exact_canary` (optional; this is the default)

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

Changing the canary requires changing both variables and redeploying. The exact
Codepet Labs canary completed one end-to-end roster, schedule, session, QR mark,
projection, and duplicate-idempotency proof on 2026-08-22 after both directional
HMAC pairs were aligned. Production migrations through 132 are recorded as
applied; production is enabled in `teacher_entitlements` mode, and its deployed
signed smoke passed 4/4 on 2026-08-24. Further deployments or rollout expansion
must use the deployed mode in the operational-recovery gate and require separate
authorization. This boundary is intentionally Pika-local: Bara continues to
authorize the Pika installation and never receives Pika internal IDs.

The entitlement expansion keeps this exact pair as the deployed signed-smoke
scope while runtime admission uses `teacher_entitlements`. See
`pika-bara-attendance-entitlement-rollout.md`. The mode does not authorize all
teachers: it admits only active, audited Pika teacher entitlements. Additional
entitlements and later flag changes remain separately authorized rollout
actions.
