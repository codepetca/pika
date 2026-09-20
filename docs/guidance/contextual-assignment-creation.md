# Contextual Assignment Creation

Status: implemented behind an off-by-default exact user/Classroom gate; not
approved for cohort activation or production migration application.

## Scope

Migration 192 and the matching server gate cover creation of one Assignment and
its initial submission requirements. A matched current Classroom owner may be
teacher- or student-valued; global account role is not used as ownership evidence.

Bulk creation, classwork reorder, grading, feedback/return, repository review,
automatic grading, UI routing and rollout activation remain outside this slice.

## Admission and compatibility

`PIKA_CLASSROOM_ASSIGNMENT_CREATION_ACCESS_ENABLED` must equal `true` and
`PIKA_CLASSROOM_ASSIGNMENT_CREATION_ACCESS_PAIRS` must be a strict JSON array of
exact `{ "userId": "uuid", "classroomId": "uuid" }` pairs. The gate is
independent from assignment reads, existing-assignment owner mutations and every
learner-document gate.

When disabled, authentication remains global-teacher-first and happens before
body parsing. When enabled but unmatched, a teacher-valued user stays on the
legacy path and a student-valued user receives the legacy role denial. Missing or
malformed enabled configuration fails closed. No wildcard, user-only,
Classroom-only or cross-product admission exists.

The request body is validated by a strict named Zod schema after authentication.
The legacy path retains its existing ownership check and insert sequence; only an
exact matched pair enters the contextual transaction.

## Transaction boundary

`public.create_assignment_for_owner_v1` accepts the authenticated actor and exact
Classroom IDs plus server-normalized Assignment fields and requirements. It:

- allocates the Assignment identity before locking;
- acquires the Assignment-submission advisory namespace before the shared
  Classroom-operation namespace;
- locks the current Classroom row and rechecks exact ownership and active state;
- calculates the next position across Assignments, materials and surveys; and
- inserts the Assignment and initial requirements in one transaction.

The function returns the inserted rows as binding evidence. The server adapter
rejects malformed output, a substituted Classroom or actor, and any requirement
bound to a different Assignment. Contention is mapped to a safe retry response.

The RPC is `SECURITY DEFINER` with an empty search path and is executable only by
`service_role`. Applying migration 192 changes no durable product rows and routes
no requests.

## Verification and rollout

The rollback-only database harness covers teacher- and student-valued owners,
mixed-classwork positioning, requirements, unrelated actors, archived
Classrooms, malformed titles and malformed requirements. The multi-connection
harness covers ownership-transfer-first, creation-first and two simultaneous
creations with distinct sequential positions. Both require migration 192 and
never apply migrations themselves.

Keep the gate disabled until migration 192 is deployed to the target environment
and the broader classroom pilot checklist approves the exact user/Classroom
pairs. Bulk/reorder, grading and feedback/return compatibility must be completed
before the whole owner experience is considered role-neutral.
