# Contextual Learner Assignment Open

## Status

Migrations 182–183 and the assignment-document GET integration are additive, dormant
foundations. The integration is controlled by an independent exact user/assignment
pair gate that is disabled by default. Disabled and unmatched requests retain the
legacy route. Applying the migrations changes no existing row, and all teacher
projection flows remain legacy.

The rollout controls are:

- `PIKA_CLASSROOM_ASSIGNMENT_DOC_OPEN_ACCESS_ENABLED=true` activates exact-pair
  evaluation after authentication;
- `PIKA_CLASSROOM_ASSIGNMENT_DOC_OPEN_ACCESS_PAIRS` is a strict JSON array of
  `{ "userId": "<uuid>", "assignmentId": "<uuid>" }` objects, capped at 100
  pairs and 20,000 characters;
- malformed enabled configuration fails closed, and there are no wildcard or
  separately cross-producted user/assignment admissions.

## Transactional contract

`public.open_assignment_doc_for_member_v1` accepts only a trusted authenticated actor,
an assignment identifier, the view timestamp and an optional server-built Pal v1
`learning_item.viewed` event. It:

- discovers the assignment's classroom without treating that read as authorization;
- takes the same classroom, student-subject and classroom/student advisory fences used
  by membership removal and purge;
- re-reads and locks the assignment and classroom, rejecting a changed binding;
- hides deleted, draft, scheduled and archived assignments as not found;
- requires an exact current enrollment while the membership fences are held;
- creates at most one exact actor/assignment document or refreshes `viewed_at` when a
  returned grade or feedback is newer;
- enqueues the legacy Pal event only when this call creates the document, while the
  existing membership-scoped trigger remains authoritative when its rollout gate is on;
- returns the locked assignment and document evidence for strict server-side binding.

The function is `security definer`, has an empty search path, and is executable only by
`service_role`. The outer result, assignment binding, actor binding and changed-view
timestamp are validated again by the server adapter. Missing schema, unexpected database
evidence and transport errors fail closed.

Migration 183 keeps membership-scoped Pal identity aligned with the classroom access
model: an exact active enrollment resolves identity regardless of the account's legacy
global `teacher`/`student` value. It preserves the existing archive, removal, purge,
generation and scope fences. This prevents a teacher-valued member from losing the
first-view signal when membership-scoped Pal routing is enabled; classroom ownership
without enrollment still does not grant member identity.

## Route integration

A matched request uses a narrow assignment timestamp preflight only to construct the
legacy Pal event. The RPC remains the sole authorization and visibility authority. Its
locked assignment and document evidence drive the response; feedback, submission
requirements, artifacts and GitHub identity are loaded in strict mode and rebound to
the authenticated actor, assignment and document before return. A created document
retains immediate Pal delivery. A `student_id` query parameter cannot substitute a
different learner on this member projection.

The independent learner autosave and submission foundations are documented in
[the contextual save contract](contextual-assignment-doc-save.md) and
[the contextual submission contract](contextual-assignment-doc-submission.md).
History/restore is now covered by the separately gated migration 188 contract. All gates
must remain disabled until artifact mutations enforce contextual
membership at transaction time. Production migration application and any route activation
require their own rollout approval.
