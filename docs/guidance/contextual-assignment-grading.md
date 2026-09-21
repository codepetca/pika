# Contextual Assignment Manual Grading

Status: implemented behind an off-by-default exact user/Assignment gate; not
approved for cohort activation or production migration application.

## Scope

Migrations 194–195 and the matching server gate cover manual grade saves for one
student or a selected student set. A matched current Assignment owner may be
teacher- or student-valued; global account role is not used as ownership
evidence.

Feedback return is covered by its separate dormant gate. Repository review, AI
auto-grading, bulk Assignment operations, classwork reorder, UI routing and
rollout activation remain outside this slice.

## Admission and compatibility

`PIKA_CLASSROOM_ASSIGNMENT_GRADING_ACCESS_ENABLED` must equal `true` and
`PIKA_CLASSROOM_ASSIGNMENT_GRADING_ACCESS_PAIRS` must be a strict JSON array of
exact `{ "userId": "uuid", "assignmentId": "uuid" }` pairs. The gate is
independent from reads, owner mutations, learner-document operations and
classwork creation.

When disabled, authentication remains global-teacher-first and happens before
params or body parsing. When enabled but unmatched, a teacher-valued user stays
on the legacy route and a student-valued user receives the legacy role denial.
Missing or malformed enabled configuration fails closed. Existing grading
schemas, revision checks, result shapes and legacy RPC behavior are unchanged.

## Transaction boundary

`public.save_assignment_grades_for_owner_v1` accepts the authenticated actor,
exact Assignment, student set, rendered document revisions and normalized grade
fields. It:

- acquires the established grading/return Assignment fence;
- discovers the Classroom only to select the broader operation namespace;
- acquires the Classroom-operation fence and locks the Assignment and Classroom;
- acquires each target learner's purge subject/pair fences nonblocking so a
  started purge wins with a retry instead of forming a reverse-order deadlock;
- rechecks stable binding, exact current ownership and active lifecycle; and
- delegates within the same transaction to the established atomic grade save.

The RPC is `SECURITY DEFINER` with an empty search path and is executable only by
`service_role`. The server adapter rejects malformed results, a substituted
Assignment, duplicate students or any returned student outside the exact request.
Applying migrations 194–195 changes no durable product rows and routes no requests.

## Verification and rollout

The rollback-only database harness covers a student-valued owner, service-only
privileges, unrelated actors, non-enrolled students and archived work. The
multi-connection harness proves archive-first denies the waiting grade and
grade-first completes before a waiting archive. It also proves a purge holding
the learner subject fence makes grading return a retry and then proceeds without
deadlock. Neither harness applies migrations.

Keep the gate disabled until migrations 194–195 are deployed to the target environment
and the broader classroom pilot checklist approves the exact user/Assignment
pairs. AI grading/repository review, bulk/reorder and remaining owner surfaces
must be completed before the whole owner experience is considered role-neutral.
