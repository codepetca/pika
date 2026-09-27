# Contextual Assignment inline images

## Status

Migration 213 and the associated route integration are staged, dormant
foundations. They are controlled by their own exact user/Classroom pair gate:

- `PIKA_CLASSROOM_ASSIGNMENT_IMAGE_ACCESS_ENABLED=true` activates contextual
  evaluation after authentication;
- `PIKA_CLASSROOM_ASSIGNMENT_IMAGE_ACCESS_PAIRS` is a strict JSON array of
  `{ "userId": "<uuid>", "classroomId": "<uuid>" }` objects, capped at
  100 pairs and 20,000 characters.

The gate is off by default. With the gate off, and for enabled-but-unmatched
requests, the existing upload and delivery paths retain their legacy behavior.
An enabled malformed/missing cohort configuration fails closed with 503,
including the public-bucket compatibility delivery branch. The gate is not a
subscription entitlement and must not be enabled until the complete reachable
Assignment surface is compatible.

## Resource and lifecycle contract

For an exact matched pair, `read_assignment_inline_image_for_context_v1`
locks and rechecks the managed-object, document, Assignment, Classroom and
current enrollment evidence before a 60-second delivery redirect is issued.

- An active member, regardless of global account role, may read only their own
  document image, including submitted or returned work, when the Assignment is
  visible and the object is verified or ready.
- A current Classroom owner, regardless of global account role, may inspect a
  current enrollee's ready image. This follows the contextual Assignment
  owner-detail/history behavior: archived owner reads remain permitted, while
  the inspected subject must still be enrolled.
- A member cannot inspect another learner's image. A historical self-enrolled
  owner is treated as an owner, not as a member.

Reserve and finalization are member-only edits. They reject owners, revoked
enrollment, archived/draft/scheduled Assignments, substituted document/object
identities and submitted documents. Reservation invokes
`begin_managed_storage_upload` while the Assignment submission/editor,
Classroom-operation and membership fences are still held. Finalization performs
the direct-upload metadata check outside the database, then invokes
`verify_managed_storage_upload` under the same fresh authorization fences.
Preflight reads alone are not authorization for either write.

Managed object identity remains immutable: bucket, path, Classroom, creator,
data subject, resource type and document must all match the database-derived
context. Signed upload URLs authorize only one no-overwrite reserved path.
Delivery redirects remain private, no-store, and short-lived (60 seconds).
Revoking membership prevents new route authorization but cannot revoke a
previously issued signed delivery URL before that URL expires.

## Rollout and verification checkpoint

Migration 213 was applied locally on 2026-09-27 with exact owner authorization,
after a dry-run preview containing only that migration. Billing PR #1368 is
merged and this branch includes migrations 211–212. Local history is through
213, and generated database types have been refreshed and checked against it.
The rollback-only `scripts/check-contextual-assignment-inline-images-database.sh`
passed; its temporary users were verified absent after rollback.

A multi-connection membership-removal/submission race rehearsal and final
integration review remain outstanding. PR #1371 stays draft, the independent
gate stays off, and neither production migration application nor UI activation
is authorized by this local application. Regenerate types only from the
up-to-date local schema; never edit `src/types/database.generated.ts` by hand.
