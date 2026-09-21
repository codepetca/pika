# Contextual Classwork Creation

Status: implemented behind an off-by-default exact user/Classroom gate; not
approved for cohort activation or production migration application.

## Scope

Migrations 192–193 and one matching server gate cover creation of Assignments,
materials and surveys. A matched current Classroom owner may be teacher- or
student-valued; global account role is not used as ownership evidence.

Bulk creation, classwork reorder, grading, feedback/return, repository review,
automatic grading, UI routing and rollout activation remain outside this slice.

## Admission and compatibility

`PIKA_CLASSROOM_CLASSWORK_CREATION_ACCESS_ENABLED` must equal `true` and
`PIKA_CLASSROOM_CLASSWORK_CREATION_ACCESS_PAIRS` must be a strict JSON array of
exact `{ "userId": "uuid", "classroomId": "uuid" }` pairs. The gate is
independent from assignment reads, existing-assignment owner mutations and every
learner-document gate.

When disabled, authentication remains global-teacher-first and happens before
body parsing. When enabled but unmatched, a teacher-valued user stays on the
legacy path and a student-valued user receives the legacy role denial. Missing or
malformed enabled configuration fails closed. No wildcard, user-only,
Classroom-only or cross-product admission exists.

Each request body is validated by a strict named Zod schema after authentication.
The schemas apply only after exact-pair admission. Each legacy path retains its
existing permissive parsing, required-field messages, ownership check and insert
sequence; only an exact matched pair enters a contextual transaction.

## Transaction boundary

`public.create_assignment_for_owner_v1`,
`public.create_classwork_material_for_owner_v1` and
`public.create_survey_for_owner_v1` accept the authenticated actor and exact
Classroom IDs plus server-normalized fields. Together they:

- allocate the Assignment identity before its submission lock; material and survey
  identities are assigned by their inserts after the shared Classroom fence;
- acquires the Assignment-submission advisory namespace before the shared
  Classroom-operation namespace;
- locks the current Classroom row and rechecks exact ownership and active state;
- calculates the next position across Assignments, materials and surveys; and
- insert the requested classwork, including initial Assignment requirements, in
  one transaction.

The functions return inserted rows as binding evidence. The server adapters
reject malformed output, a substituted Classroom or actor, and any requirement
bound to a different Assignment. Contention is mapped to a safe retry response.

The RPCs are `SECURITY DEFINER` with empty search paths and are executable only by
`service_role`. Migration 193 replaces the Assignment creator so all three use one
private allocator under the shared Classroom-operation fence. Applying migrations
192–193 changes no durable product rows and routes no requests.

## Verification and rollout

The rollback-only database harnesses cover teacher- and student-valued owners,
mixed-classwork positioning, requirements, unrelated actors, archived
Classrooms and malformed input. The multi-connection harnesses cover ownership
transfer, simultaneous Assignment creation, material followed by survey, and
survey followed by Assignment. They prove cross-kind positions remain distinct
and sequential. The harnesses require migrations 192–193 and never apply
migrations themselves.

Keep the gate disabled until migrations 192–193 are deployed to the target environment
and the broader classroom pilot checklist approves the exact user/Classroom
pairs. Assignment, material and survey creation must always use the same exact-pair
gate so admitted owners cannot split between transactional and legacy position
allocation. Bulk/reorder, feedback/return, AI grading and repository-review
compatibility must still be completed before the whole owner experience is
considered role-neutral. Manual grading is covered by its separate dormant gate.
