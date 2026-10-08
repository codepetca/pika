# Contextual Classwork Reorder

Status: implemented behind an off-by-default exact user/Classroom gate; not
approved for cohort activation or production migration application.

## Scope

Migration 197 and the matching server gate cover both existing Classroom
ordering operations:

- Assignment-only ordering that preserves material and survey positions; and
- mixed Assignment, material and survey ordering.

A matched current Classroom owner may be teacher- or student-valued. The
transaction uses current Classroom ownership rather than global account role as
authority. Bulk Assignment creation/update/release, AI grading, repository
review, UI routing and rollout activation remain outside this slice.

## Admission and compatibility

`PIKA_CLASSROOM_CLASSWORK_REORDER_ACCESS_ENABLED` must equal `true` and
`PIKA_CLASSROOM_CLASSWORK_REORDER_ACCESS_PAIRS` must be a strict JSON array of
exact `{ "userId": "uuid", "classroomId": "uuid" }` pairs. The gate is
independent from classwork reads, creation and existing-resource mutation gates.

When disabled, authentication remains global-teacher-first and happens before
route params or body parsing. When enabled but unmatched, a teacher-valued user
stays on the legacy route and a student-valued user receives the legacy role
denial. Missing or malformed enabled configuration fails closed. Legacy request
validation, ownership checks, RPCs, status codes and messages remain unchanged;
only an exact matched pair uses the contextual transaction.

## Transaction boundary

`public.reorder_assignments_for_owner_v1` and
`public.reorder_classwork_items_for_owner_v1`:

- acquire the shared Classroom-operation advisory fence;
- lock the current Classroom row;
- recheck exact current ownership and active lifecycle;
- delegate to the established migration 068 ordering function in the same
  transaction; and
- return exact actor/Classroom binding evidence that the server verifies.

This ordering serializes contextual reorder with classwork creation and the
existing contextual owner mutations. The RPCs are `SECURITY DEFINER` with empty
search paths and are executable only by `service_role`; their private
authorization helper is not directly executable by application roles or
`service_role`. Applying migration 197 changes no durable product rows and
routes no requests.

## Verification and rollout

The rollback-only database harness covers a student-valued owner, both reorder
forms, mixed positions, service-only privileges, unrelated actors and archived
Classrooms. The multi-connection harness proves archive-first denies a waiting
reorder, reorder-first commits before a waiting archive, and concurrent
classwork creation makes a stale waiting reorder fail instead of overwriting the
new item. Neither harness applies migrations.

Keep the gate disabled until migration 197 is deployed to the target environment
and the broader classroom pilot checklist approves the exact user/Classroom
pairs. The same pair must have the dependent contextual creation and owner
mutation gates active before this gate is enabled. Bulk Assignment operations,
AI grading, repository review and remaining owner surfaces must still be
completed before the owner experience is considered role-neutral.
