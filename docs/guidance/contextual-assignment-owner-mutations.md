# Contextual Assignment Owner Mutations

Status: implemented behind an off-by-default exact user/assignment gate; not
approved for cohort activation or production migration application.

## Scope

Migration 191 and the matching server gate cover mutations of an existing
Assignment only:

- edit Assignment fields and submission requirements;
- release an Assignment immediately or on a future schedule;
- delete an Assignment; and
- discard a newly created, untouched Assignment draft.

Creation, bulk/reorder, grading, feedback/return, repository review, automatic
grading, UI routing and rollout activation remain outside this slice.

## Admission and compatibility

`PIKA_CLASSROOM_ASSIGNMENT_OWNER_MUTATION_ACCESS_ENABLED` must equal `true` and
`PIKA_CLASSROOM_ASSIGNMENT_OWNER_MUTATION_ACCESS_PAIRS` must be a strict JSON
array of exact `{ "userId": "uuid", "assignmentId": "uuid" }` pairs. The
gate is independent from every assignment read and learner-document gate.

When disabled, authentication remains global-teacher-first and happens before
route parameter resolution. When enabled but unmatched, a teacher-valued user
stays on the legacy path and a student-valued user receives the legacy role
denial. Missing or malformed enabled configuration fails closed. No wildcard,
user-only, assignment-only or cross-product admission exists.

## Transaction boundary

Every contextual RPC accepts the authenticated actor ID and exact Assignment ID.
It acquires the established Assignment submission advisory lock, discovers the
Classroom namespace, acquires the Classroom operation advisory lock, then locks
the current Classroom and Assignment rows together. Under those locks it proves:

- the Assignment still belongs to the discovered Classroom;
- the actor is the Classroom's current owner; and
- neither the Classroom nor Blueprint-derived Assignment is archived.

Update keys are allow-listed. Schedule transitions are rechecked after locking,
and requirement changes retain the existing artifact-before-document ordering
and submitted-document immutability. Delete continues to rely on the established
database cleanup queue; the route runs the existing best-effort Storage cleanup
worker after success.

The public RPCs are `SECURITY DEFINER` with an empty search path, executable only
by `service_role`; the shared lock/authorization helper is not directly
executable by application roles or `service_role`.

## Verification and rollout

The rollback-only database harness covers teacher- and student-valued owners,
unrelated users, archived classrooms, arbitrary update keys, submitted
requirements, schedule validation, delete and pristine discard. The
multi-connection harness covers ownership-transfer-first and mutation-first
archive serialization. Both harnesses require migration 191 to be present and
never apply migrations themselves.

Keep the gate disabled until migration 191 is deployed to the target environment
and the broader classroom pilot checklist approves the exact user/Assignment
pairs. Applying the migration alone changes no rows and routes no requests.
