# Contextual Learner Assignment Open

## Status

Migration 182 and `openContextualAssignmentDoc` are additive, dormant foundations.
No production route calls them, no environment flag is added, and applying the
migration changes no existing row. The current learner assignment-document GET and
all teacher flows remain legacy until a separately reviewed integration slice.

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

## Intentionally deferred

The next slice may add an independent, off-by-default exact user/assignment admission
gate to the learner GET and consume this function's evidence. That integration must also
bind feedback, submission requirements, artifacts and GitHub identity before returning
them, preserve immediate Pal delivery behavior, and keep unmatched requests on the exact
legacy path.

Even after that read/open integration, the gate must remain disabled until learner
autosave, submission and artifact mutations enforce contextual membership at transaction
time. Migration application and any route activation require their own rollout approval.
