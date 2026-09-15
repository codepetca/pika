# Removed-student cleanup — proposed implementation boundary

Superseded proposal: use the [classroom Pal and cleanup phased plan](classroom-pal-and-student-cleanup-plan.md).
The constraints below remain investigation evidence, not the selected rollout plan.

Status: investigation complete; owner decision required before implementation.
Owner worktree: `codex/removed-student-cleanup`. Risk: runtime-platform,
irreversible student-data deletion. No migration, purge, schedule enablement,
provider write, or product UI change has been performed.

## Approved intent

Implement automatic cleanup before claiming that an existing account can rejoin
its course within two days. Removal must stay fast and final. Preserve the
account, other courses, classmates, and teacher-authored course content.

## Verified constraints

- `get_student_purge_inventory` still requires an active enrollment (migration
  123). Removed students need a new exact retained-identity entrypoint; temporarily
  reenrolling them or clearing their deny record is not acceptable.
- `student_purge_conflict` blocks Pal-linked identities, including Pal state from
  other courses, and remote Gradex work. Pika has event delivery and weekly
  configuration integrations, but no implemented course-scoped Pal erasure path.
- Migration 127 wraps both purge startup and finalization with Bara attendance
  guards. The later coordinated attendance-decommission feature is whole-course,
  not one-student; invoking it here would erase classmates' attendance.
- Existing student purge snapshots and deletes whole-course archive and Gradex
  backup objects. The explicit permanent-deletion dialog discloses that impact;
  ordinary removal does not. An automatic job must not silently inherit it.
- The current daily history cron resumes existing operations with a 25-tick
  bound. It neither discovers removed students nor guarantees completion of a
  large backlog or many-file student in two daily runs.
- Earlier removals explicitly preserved data and did not schedule erasure.
  Historical rows must not be silently enrolled in a new deletion policy.

## Recommended bounded first version — requires owner acceptance

1. Explicitly enroll new removals in a durable cleanup queue under the new
   policy; leave historical removed rows untouched pending separate approval.
2. Run an independently gated, authenticated daily worker with bounded work,
   idempotent operations, leases, retries, and a time budget. Separate discovery
   fairness from existing-operation resumption so one blocked row cannot starve
   the queue. Keep rollout disabled until schema validation and a named canary.
3. Revalidate the exact classroom, retained student identity, absence of active
   enrollment, and queue authorization under the existing membership/purge
   locks before startup. Reuse exact-object deletion and finalization contracts;
   never bypass provider, cold-course, active-operation, or storage ownership
   guards. Do not fabricate teacher confirmation as authorization for a worker.
4. Pending Pal/Bara/remote-provider and whole-course-backup cases remain blocked
   without deleting their deny records. No account-wide Pal erasure or
   whole-course attendance decommission is allowed.
5. Only release the re-add block after verified completion of all scoped data
   cleanup. Retain privacy-safe aggregate evidence, not raw student identifiers
   in completed operational records or logs.
6. Report blocked, failed, and over-48-hour queue counts. Treat 48 hours as an
   operational target, not a maximum duration promised in the modal.

## Completion and rollout gates

Test new-policy eligibility versus historical removals, exact tenant/identity
binding, enrollment races, duplicate runs, crashes, missing schema, disabled
rollout, bounded fair retries, provider/backup blocks, object absence, final
deny-record removal, and preservation of accounts/other courses/classmates.
Require migration replay and generated contracts, independent high-risk review,
exact-head CI, separately authorized migration application, named destructive
canary, and explicit production enablement.

A universal two-day statement remains out of scope until student/course-scoped
Pal and Bara erasure and backup handling are implemented and operationally
verified. Those are cross-service/product decisions, not cron configuration.
