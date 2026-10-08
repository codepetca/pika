# Contextual Assignment Artifacts

## Status

Migration 190 and the assignment-artifact route integration are additive, dormant
foundations. One independent exact user/assignment pair gate covers link/repository
attachment, image upload/attachment and artifact deletion. It is disabled by default.
Applying the migration changes no durable product rows and does not activate the route.

The rollout controls are:

- `PIKA_CLASSROOM_ASSIGNMENT_ARTIFACT_ACCESS_ENABLED=true` activates exact-pair
  evaluation after authentication;
- `PIKA_CLASSROOM_ASSIGNMENT_ARTIFACT_ACCESS_PAIRS` is a strict JSON array of
  `{ "userId": "<uuid>", "assignmentId": "<uuid>" }` objects, capped at
  100 pairs and 20,000 characters;
- malformed enabled configuration fails closed, with no wildcard or separately
  cross-producted user/assignment admissions.

Disabled and unmatched requests retain the existing student-role path. A matched
request never falls back after contextual evidence or mutation fails. The gate remains
off until the complete assignment surface is compatible and rollout is separately
approved.

## Transactional contract

`public.prepare_assignment_artifact_for_member_v1`,
`public.upsert_assignment_artifact_for_member_v1` and
`public.delete_assignment_artifact_for_member_v1` share one private locked context. It:

- takes the assignment-submission and editor-save fences before classroom and
  membership fences;
- re-reads and locks the assignment/classroom binding and hides deleted, draft,
  scheduled and archived assignments;
- requires exact current enrollment even when the account globally holds a teacher
  role or owns that classroom;
- binds the requirement to the assignment, the document to the actor and the existing
  artifact to that exact document/requirement/actor/type tuple;
- creates the actor's missing document under those locks, preserving existing route
  behavior without a duplicate-document race;
- rejects submitted documents before attachment or deletion.

The upsert boundary accepts only server-validated artifact metadata. Link and repository
artifacts cannot carry storage identity. Image artifacts require a verified managed-object
UUID; the existing managed-storage trigger independently binds its bucket/path,
classroom, learner subject and assignment-document resource. Repository identity saving
is part of the same transaction and is forced to the actor. The delete boundary returns
the deleted storage path only after its row is gone, preserving the durable cleanup queue.

Image bytes are validated and uploaded outside the database transaction so locks remain
short. Preparation supplies database-derived classroom/document ownership for the
reservation. The attach RPC then independently repeats current membership, visibility,
document and requirement authorization. If access or submission state changes during the
upload, attachment fails and the route queues the managed object for cleanup.

All public functions are `security definer`, have an empty search path and are executable
only by `service_role`; the shared private helper is not directly executable by application
roles. Malformed evidence, substituted identifiers, managed-owner mismatches and lifecycle
contention fail closed.

Rollback-only database contracts cover teacher-valued and student-valued members,
non-enrolled owners, outsiders, unpublished/archived assignments, foreign requirements,
submitted documents, removed members, repository identity, managed images and durable
cleanup. The shared multi-connection harness covers membership removal and submission in
both lock-winner orderings against artifact attachment.

This slice does not widen grading, release or owner assignment mutations. Assignment open,
save, submission, history and artifact gates remain independent and disabled. Production
migration application and route activation each require separate explicit authorization.
