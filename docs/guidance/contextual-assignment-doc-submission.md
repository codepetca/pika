# Contextual Learner Assignment Submission

## Status

Migration 186 and the assignment-document submit/unsubmit route integrations are
additive, dormant foundations. The routes share an independent exact
user/assignment pair gate that is disabled by default. Disabled and unmatched
requests retain the legacy student-role path. Applying the migration changes no
rows and does not activate either route.

The rollout controls are:

- `PIKA_CLASSROOM_ASSIGNMENT_DOC_SUBMISSION_ACCESS_ENABLED=true` activates
  exact-pair evaluation after authentication;
- `PIKA_CLASSROOM_ASSIGNMENT_DOC_SUBMISSION_ACCESS_PAIRS` is a strict JSON array
  of `{ "userId": "<uuid>", "assignmentId": "<uuid>" }` objects, capped at
  100 pairs and 20,000 characters;
- malformed enabled configuration fails closed, and there are no wildcard or
  separately cross-producted user/assignment admissions.

## Transactional contract

`public.submit_assignment_doc_for_member_v1` and
`public.unsubmit_assignment_doc_for_member_v1` accept only a trusted authenticated
actor and assignment identifier. Submit also accepts the established atomic-submit
payload and optional server-built Pal completion event. Each function:

- takes the established assignment-submission and editor-save fences before the
  broader classroom/member locks;
- discovers the classroom only to establish the advisory-lock namespace, then
  re-reads and locks the assignment and classroom and rejects a changed binding;
- hides deleted, draft, scheduled and archived assignments as not found;
- requires an exact current enrollment while membership-removal fences are held;
- delegates document revision, submission history and unsubmission behavior to the
  established atomic functions;
- returns the locked classroom binding along with the established result so the
  server can validate the complete actor, assignment, document and history evidence.

The optional Pal event is constrained to the database-verifiable v1 assignment
completion shape and locked due-date timing. A null event remains valid when the
membership-scoped Pal path owns delivery. Both functions are `security definer`,
use an empty search path and are executable only by `service_role`.

The server adapter strictly validates trusted inputs and every success/error envelope.
Missing schema, malformed database evidence and transport failures fail closed; a
matched request never falls back to the legacy RPC. Guarded lifecycle contention is
returned as a safe 409 refresh/retry response.

## Route integration

A matched submit performs bounded assignment, document and submission-resource
preflight reads only to preserve the existing confirmation and Pal behavior. The RPC
remains the authorization, visibility and mutation authority. Pal delivery uses the
locked classroom returned by the transaction. A matched unsubmit goes directly to the
transaction and does not rely on a legacy authorization preflight.

Rollback-only database contracts cover teacher-valued and student-valued exact members,
outsiders, owner-without-enrollment, draft, scheduled and archived assignments, malformed
Pal evidence and submit/unsubmit behavior. Eighteen multi-connection cases cover both
directions of removal, save, submit and unsubmit overlap without deadlock.

This slice does not widen history/restore or artifact mutations. The assignment open,
save and submission gates are independent and must remain disabled until every reachable
learner mutation is compatible, the complete pilot matrix passes and rollout is separately
approved. Production migration application and route activation each require their own
explicit authorization.
