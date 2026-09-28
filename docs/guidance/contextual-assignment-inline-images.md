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
The mixed-role/lifecycle fixture in
`scripts/check-contextual-assignment-inline-images-database.sh` passed and rolls
back. Its invoked race harness passed four real cross-connection cases: removal
before reservation, reservation before removal, submission before finalization,
and finalization before submission. Barrier evidence uses PostgreSQL blocking
relationships and terminal stored state, not timing alone.

The local race harness requires compatibility storage mode and never changes
that setting. It temporarily commits exact synthetic fixtures for connection
visibility, removes mutable fixture rows and temporary trigger/functions, and
checks baseline counts. Immutable anonymous PAL membership audit evidence is
retained by its existing guard; the tests do not bypass it. No physical storage
bytes are uploaded by these fixtures.

PR #1371 merged as `39c948e8` after final independent review, 125 focused tests,
static checks and full CI. The independent gate stays off. On 2026-09-27, the
owner authorized applying migration 213 to production; the application command
timed out while connecting before reporting migration execution. A subsequent
read-only history check confirmed production remained through 212. With fresh
exact authorization, a later retry on 2026-09-27 applied only 213 successfully.
Production history now matches 001–213. Read-only catalog verification confirms
all four functions exist with empty search paths; public entrypoints are callable
only by service_role among application roles, and the private helper is not
directly executable by application roles. No rollout settings changed; 214 was
not applied.
Regenerate types only from the up-to-date local schema; never edit
`src/types/database.generated.ts` by hand.

After this dormant image slice, the next integration phase is a restricted
synthetic Assignment lifecycle rehearsal, as described in the classroom-access
roadmap. That later rehearsal is not evidence supplied by the image contract
tests, and neither the unrestricted classroom shell nor Teaching/Joined home
may be enabled as part of these tests.
