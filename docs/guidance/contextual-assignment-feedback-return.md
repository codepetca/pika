# Contextual Assignment Feedback Return

Status: implemented behind an off-by-default exact user/Assignment gate; not
approved for cohort activation or production migration application.

## Scope

Migration 196 and the matching server gate cover both feedback-only return for
one learner and full return for a selected learner set. A matched current
Assignment owner may be teacher- or student-valued; global account role is not
used as ownership evidence.

AI auto-grading, repository review, bulk Assignment operations, UI routing and
rollout activation remain outside this slice. Classwork reorder is covered by
its separate migration 197 contract.

## Admission and compatibility

`PIKA_CLASSROOM_ASSIGNMENT_FEEDBACK_RETURN_ACCESS_ENABLED` must equal `true` and
`PIKA_CLASSROOM_ASSIGNMENT_FEEDBACK_RETURN_ACCESS_PAIRS` must be a strict JSON
array of exact `{ "userId": "uuid", "assignmentId": "uuid" }` pairs. The gate
is independent from reads, owner mutations, learner-document operations,
classwork creation and manual grading.

When disabled, authentication remains global-teacher-first and happens before
params or body parsing. When enabled but unmatched, a teacher-valued user stays
on the legacy route and a student-valued user receives the legacy role denial.
Missing or malformed enabled configuration fails closed. Existing request
schemas and legacy RPC/result behavior are unchanged.

## Transaction boundaries

`public.return_assignment_feedback_for_owner_v1` covers one feedback-only
return. `public.return_assignment_docs_for_owner_v1` covers one selected learner
set. Each wrapper:

- acquires the established Assignment feedback-return fence;
- discovers the Classroom only to select the broader operation namespace;
- acquires the Classroom-operation fence;
- acquires each target learner's purge subject/pair fences nonblocking, in
  stable order for a batch, so a started purge wins with a retry;
- locks the Assignment and Classroom, then rechecks stable binding, exact
  current ownership and active lifecycle; and
- delegates to the established atomic return operation in the same transaction.

Both RPCs are `SECURITY DEFINER` with an empty search path and are executable
only by `service_role`. The feedback-only adapter binds the returned document and
entry to the exact Assignment, learner and actor. The selected-return adapter
requires complete counts and an exact, disjoint partition of requested learners;
created documents must be a subset of returned documents. Applying migration
196 changes no durable product rows and routes no requests.

## Verification and rollout

The rollback-only database harness covers a student-valued owner, service-only
privileges, exact return evidence, unrelated actors, non-enrolled learners,
created documents, preserved grading/feedback semantics and archived work. The
multi-connection harness proves archive-first denies a waiting return,
return-first commits before a waiting archive, and a purge holding the learner
subject fence makes return retry without writing or deadlocking. Neither harness
applies migrations.

Keep the gate disabled until migration 196 is deployed to the target environment
and the broader classroom pilot checklist approves the exact user/Assignment
pairs. AI grading/repository review, bulk Assignment operations and remaining owner surfaces
must be completed before the whole owner experience is considered role-neutral.
