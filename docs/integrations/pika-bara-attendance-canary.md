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
recheck the active classroom row, so a concurrent archive cannot race the
runtime preflight and still deliver or project attendance.

Changing the canary requires changing both variables and redeploying. Keep the
global flag false until migration 129 and the exact pair are installed and the
`pre-enable` rollout audit proves that the classroom is active and currently
owned by the configured teacher. After the paired flags are enabled, run the
`enabled` audit again before the controlled flow. This boundary is intentionally
Pika-local: Bara continues to authorize the Pika installation and never receives
Pika internal IDs.
