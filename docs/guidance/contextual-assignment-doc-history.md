# Contextual Assignment Document History and Restore

## Status

Migrations 188-189 and the assignment-document history/restore route integrations are
additive, dormant foundations. Both routes share an independent exact
user/assignment pair gate that is disabled by default. Applying the migration changes
no durable product rows and does not activate either route.

The rollout controls are:

- `PIKA_CLASSROOM_ASSIGNMENT_DOC_HISTORY_ACCESS_ENABLED=true` activates exact-pair
  evaluation after authentication;
- `PIKA_CLASSROOM_ASSIGNMENT_DOC_HISTORY_ACCESS_PAIRS` is a strict JSON array of
  `{ "userId": "<uuid>", "assignmentId": "<uuid>" }` objects, capped at
  100 pairs and 20,000 characters;
- malformed enabled configuration fails closed, and there are no wildcard or
  separately cross-producted user/assignment admissions.

Disabled and unmatched history reads retain the existing authenticated owner/student
branching. Disabled and unmatched restores retain the existing student-role boundary.
A matched request never falls back after contextual evidence or mutation fails.

## Transactional history contract

`public.get_assignment_doc_history_for_actor_v1` accepts a trusted authenticated actor,
assignment, optional owner-selected student and a server-controlled member-only flag. It:

- discovers only the classroom and prospective document subject before locking;
- takes the established assignment-submission and editor-save fences before the
  classroom and subject membership fences;
- re-reads and locks the assignment and classroom and rejects changed bindings;
- gives a current owner the existing owner projection only when `student_id` identifies
  a current classroom enrollee, including draft and archived assignment history;
- gives a current member only their own history and hides deleted, draft, scheduled and
  archived assignments;
- returns a strictly bound assignment, subject, document and oldest-first history chain.

The contextual GET route reverses that verified chain to preserve the existing
newest-first API response. Restore requests force the member-only projection even when
the member also owns the classroom, because restore is a learner-work mutation.

## Transactional restore contract

The contextual restore route reconstructs the selected revision for display from the
strictly validated history response. `public.restore_assignment_doc_for_member_v1`
does not trust that reconstruction: it independently:

- repeats the established document and membership lock order;
- rechecks live assignment visibility and exact current enrollment;
- locks the actor's exact assignment document;
- requires the selected history UUID to still belong to that document;
- locks the target and its snapshot/patch chain, reconstructs the selected content in
  the database, and rejects caller content that differs from that exact revision;
- derives the restore snapshot and word/character counts from the locked target rather
  than accepting caller-provided audit evidence;
- delegates revision, immutable-submission, history, save-operation and metric behavior
  to `save_assignment_doc_atomic` with the established `restore` trigger;
- validates the returned actor, assignment, document and history bindings.

Both functions are `security definer`, have an empty search path and are executable only
by `service_role`. Missing schema, malformed database evidence, substituted identifiers,
transport failures and lifecycle contention fail closed. The restore mutation cannot
succeed on authorization inferred only from its earlier read.

Rollback-only database contracts cover teacher-valued and student-valued members,
student-valued owners, owner draft/archived reads, own-document scoping, outsiders,
removed members, live visibility, patch-based exact history targets, and atomic rejection
of a valid target UUID paired with tampered content. Twenty-two multi-connection cases
cover patch-target restore in both orderings against membership removal and contextual
saves, in addition to the existing save/submit/unsubmit races.

Artifact mutations are covered separately by migration 190 and their own independent
gate. Assignment open, save, submission, history/restore and artifact gates must stay
disabled until every reachable learner mutation is compatible, the complete pilot matrix
passes and rollout is separately approved. Production migration application and route
activation each require separate explicit authorization.
