# Contextual Learner Assignment Save

## Status

Migrations 184–185 and the assignment-document PATCH integration are additive, dormant
foundations. The route is controlled by an independent exact user/assignment pair gate
that is disabled by default. Disabled and unmatched requests retain the legacy student
role path. Applying the migration changes no rows and does not activate the new path.

The rollout controls are:

- `PIKA_CLASSROOM_ASSIGNMENT_DOC_SAVE_ACCESS_ENABLED=true` activates exact-pair
  evaluation after authentication;
- `PIKA_CLASSROOM_ASSIGNMENT_DOC_SAVE_ACCESS_PAIRS` is a strict JSON array of
  `{ "userId": "<uuid>", "assignmentId": "<uuid>" }` objects, capped at 100
  pairs and 20,000 characters;
- malformed enabled configuration fails closed, and there are no wildcard or
  separately cross-producted user/assignment admissions.

## Transactional contract

`public.save_assignment_doc_for_member_v1` accepts only a trusted authenticated actor,
assignment identifier and the established atomic-save payload. It:

- discovers the assignment's classroom only to establish the advisory-lock namespace;
- first takes the established assignment-submission and editor-save fences in a fixed
  order, so submit, unsubmit, restore and legacy autosave never hold a document lock while
  contextual save holds the broader classroom/member fences;
- takes the same classroom, student-subject and classroom/student advisory fences used
  by membership removal and purge;
- re-reads and locks the assignment and classroom, rejecting a changed binding;
- hides deleted, draft, scheduled and archived assignments as not found;
- requires an exact current enrollment while the membership fences are held;
- delegates revision, idempotency, history, save-operation and metric semantics to
  `save_assignment_doc_atomic` while the authorization parents remain locked;
- validates the returned assignment, actor, document and history bindings before return.

The function is `security definer`, has an empty search path and is executable only by
`service_role`. The server adapter independently validates trusted UUID inputs, the
complete success/error envelope, the exact document binding and any history binding.
Missing schema, malformed database evidence and transport failures fail closed. It never
falls back to the legacy RPC after a matched request.

Migration 185 is the effective lock-order definition. Existing assignment-document and
teacher assignment/classroom adapters convert guarded lifecycle contention into a safe
409 refresh/retry response rather than exposing it as a generic 500. Multi-connection
contracts cover both save/submit orderings, unsubmit-first, both contextual/legacy-save
orderings, and save-first draft/archive retries in addition to removal and visibility races.

## Route integration

A matched PATCH performs a bounded exact actor/assignment document read only to preserve
the existing patch/snapshot calculation and submitted-document response. No document is
a valid result: direct PATCH-before-GET still lets the transaction create the baseline
document exactly as the legacy save does. Duplicate, malformed or substituted evidence
fails closed. Authorization, assignment visibility and membership are decided again in
the transaction.

This slice does not widen submit, unsubmit, restore/history or artifact mutations. The
GET and PATCH gates are independent and must remain disabled until those reachable
learner mutations are compatible, the complete pilot matrix passes and rollout is
separately approved. Migration application and any route activation each require their
own explicit authorization.
