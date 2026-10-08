# Contextual Assignment repository-target selection

This slice makes only the repository-target selection mutation role-neutral for an
exact, server-configured user/Assignment pair. It does not change repository
analysis, repository-review AI, grading, UI routing, signup roles, plans or billing.
The gate must remain disabled until the complete owner workflow is ready for a
separately approved pilot.

## Compatibility and admission

`PUT /api/teacher/assignments/[id]/repo-targets/[studentId]` uses
`PIKA_CLASSROOM_ASSIGNMENT_REPO_TARGET_ACCESS_ENABLED` and
`PIKA_CLASSROOM_ASSIGNMENT_REPO_TARGET_ACCESS_PAIRS`.

| Request | Authorization and write path |
|---|---|
| Gate disabled | Existing teacher-role authorization and legacy mutation |
| Gate enabled, pair unmatched | Existing teacher-role authorization and legacy mutation |
| Gate enabled, exact pair matched | Authenticated teacher- or student-valued current owner and migration 200 RPC |

Malformed enabled configuration fails closed. Admission is exact and bounded to
100 canonical user/Assignment UUID pairs. The learner remains a separate enrolled
student selected by the owner; ownership does not imply enrollment or learner
submission access.

## Transaction boundary

`save_assignment_repo_target_for_owner_v1` is `SECURITY DEFINER`, has an empty
search path, uses schema-qualified relations, and is executable only by
`service_role`. It performs no network work. Its lock order is:

1. Assignment submission fence.
2. Classroom-operation fence derived from the Assignment.
3. Target learner purge subject/pair fences.
4. Assignment and Classroom row locks.
5. Target learner enrollment share lock.

The transaction then rechecks stable Assignment/Classroom binding, exact current
ownership, active Classroom and Assignment lifecycle, and exact enrollment before
deleting or upserting the repository target. Returned actor, Assignment, learner
and target evidence is rebound by the server adapter before the API responds.

## External validation boundary

The route keeps the existing read-only owner, enrollment, document and artifact
preflight before calling GitHub. This prevents a matched account from using a
foreign Assignment to trigger external validation. Because those checks can become
stale during the network call, the migration 200 RPC independently rechecks all
write authority and lifecycle state after validation and before mutation.

Repository analysis and repository-review AI remain on their legacy paths. They
need a separate async/idempotency design and, before paid enforcement, a
transactional entitlement reservation/settlement boundary.

## Verification and rollout state

- `scripts/check-contextual-assignment-repo-target-database.sh` checks privileges,
  search path, owner/member behavior, payload validation, reset and archive denial.
- `scripts/check-contextual-assignment-repo-target-concurrency.mjs` checks purge and
  archive races in both winning orders.
- Local schema history is 001–200. Production remains 001–180.
- The new gate and every earlier contextual Assignment gate remain off.
