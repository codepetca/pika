# Contextual Assignment Bulk Editing

Status: implemented behind an off-by-default exact user/Classroom gate; not
approved for cohort activation or production migration application.

## Scope

Migration 198 and the matching server gate cover the existing markdown
Assignment bulk editor at `POST /api/teacher/assignments/bulk`. A matched
current Classroom owner may be teacher- or student-valued and may create draft
Assignments, edit existing Assignments, release drafts, move scheduled work
back to draft, and update Assignment positions while preserving material and
survey slots.

AI grading, repository review, UI routing and rollout activation remain outside
this slice. The route and response shape are unchanged.

## Admission and compatibility

`PIKA_CLASSROOM_ASSIGNMENT_BULK_ACCESS_ENABLED` must equal `true` and
`PIKA_CLASSROOM_ASSIGNMENT_BULK_ACCESS_PAIRS` must be a strict JSON array of
exact `{ "userId": "uuid", "classroomId": "uuid" }` pairs. The gate is
independent from Assignment reads, individual owner mutations, classwork
creation and classwork reorder.

When disabled, authentication remains global-teacher-first and happens before
body parsing. When enabled but unmatched, a teacher-valued user stays on the
legacy route and a student-valued user receives the legacy role denial. Missing
or malformed enabled configuration fails closed. The legacy route retains its
existing queries, partial-write behavior, status codes and messages; only an
exact matched pair uses the contextual transaction.

## Transaction boundary

`public.save_assignments_bulk_for_owner_v1` receives server-normalized
instruction fields and the complete batch. It:

- resolves new Assignment IDs and acquires every Assignment submission fence in
  canonical UUID order;
- acquires the shared Classroom-operation fence and locks the current Classroom;
- rechecks exact current ownership and active Classroom state;
- locks and rebinds every referenced existing Assignment to that Classroom;
- validates missing IDs, archived Blueprint lineage and live-to-draft denial
  before any insert or update;
- allocates Assignment positions around current material and survey positions;
- creates new items as drafts and applies existing-item edit/release semantics;
  and
- returns actor, Classroom, count and Assignment binding evidence that the
  server verifies.

The RPC is `SECURITY DEFINER` with an empty search path and is executable only
by `service_role`. Applying migration 198 changes no durable product rows and
routes no requests.

## Verification and rollout

The rollback-only database harness covers a student-valued owner, mixed create
and update, release timestamps, forced drafts for new work, preserved mixed
positions, missing-ID atomicity, live un-release denial, unrelated actors,
archived Classrooms and function privileges. The multi-connection harness proves
archive-first denial, bulk-first completion before archive, and deterministic
serialization of overlapping batches with reversed input order.

Keep the gate disabled until migration 198 is deployed to the target
environment and the broader classroom pilot checklist approves the exact
user/Classroom pairs. The same pair must have dependent classwork creation,
owner mutation and reorder gates active before this gate is enabled. AI grading,
repository review and remaining owner surfaces must still be completed before
the owner experience is considered role-neutral.
