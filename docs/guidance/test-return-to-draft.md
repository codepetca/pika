# Returning an unused Test to draft

Teachers can select a closed Test and choose **More actions → Return to draft**.
The confirmation says “Students will no longer see this test.” A successful
return restores authoring and Publish; draft Tests are hidden from student lists
and student Test/material routes.

The server requires the current teacher owner and a nonarchived Classroom/Test.
The Test must have no irreversible question lock, attempts, responses, focus
events, AI grading runs/items, or gradebook score overrides. An open student
availability grant also blocks the transition. Closed availability is retained.
A Test cannot be made eligible by resetting locks or deleting learner work.

“Unused” means no started or recorded work and no currently open access. Pika
does not persist a receipt for every read of questions/materials; this feature
cannot prove that a student never viewed the Test in the past.

## Persistence and concurrency

`POST /api/teacher/tests/[id]/unpublish` accepts only an empty JSON object. The
service-role-only `return_test_to_draft_atomic` RPC makes the final eligibility
decision under the same lifecycle locks used by student attempt/access writers.
Conflicts return 409. The existing overloaded Test PATCH remains unchanged.

Migration 255 rebuilds the retained assessment draft from current Test/question
rows, including the current title, results setting, points, options, keys, and
portable question IDs. It increments the draft version, or creates version 1
when a retained draft is absent. Stale retained Markdown is discarded so it
cannot replace newer published content. Test/question rows, references,
documents, grading settings and closed availability are preserved. Repeating a
completed request returns the same draft version.

The teacher UI validates the acknowledgement before updating and fences stale
responses by Classroom, Test, workspace and component lifetime. Failures keep
the confirmation open with retry; cancellation and Escape are disabled while
the mutation is pending.

## Rollout and evidence

Migration 255 adds the return-to-draft and live focus-event service-role RPCs in
`255_return_test_to_draft_atomic.sql`; its dependencies are present in the full
001–254 chain. Without 255, return to draft fails closed with 503 and focus-event
recording fails closed. The live focus endpoint uses an atomic writer to prevent
a request that observed earlier access from inserting after a return to draft.
Historical archive/cleanup SQL remains unchanged. Publication, editing and
student access continue through their current routes. Apply migration 255 before
promoting this app code to production to preserve focus-telemetry continuity;
there is no fallback to an insertion outside the lifecycle lock.
This feature does not activate the dormant contextual publication endpoint or
shared admission.

Canonical local and production migration application retain the exact-target,
one-attempt human authorization contract in
[schema rollout](./schema-rollout-checklist.md). Feature implementation and CI
replay do not authorize canonical database changes. Local application must
review every pending migration, including any earlier unapplied migrations.

Verification includes API/RPC and component tests, whole-file legacy PATCH/UI
fingerprint guards, a full disposable migration replay and generated types,
rollback/fault contracts, both contention orders against the 244 access writer,
and teacher/student desktop/mobile screenshots in light and dark themes.
The native database harness accepts an explicit disposable target and refuses
the canonical local Pika container. CI's fresh isolated container is admitted
only with `CI=true` plus its explicit opt-in flag.

Existing contextual Test proof source profiles admit the exact reviewed 255
filename and SHA-256 while preserving their full migration-chain and table-catalog
guards. They continue to reject future migrations and changed SQL bytes. This
source compatibility extension does not activate or execute those dormant paths.
