# Contextual hot classroom archive and restore

Status: source preparation; native verification, generated types, independent
review and final-SHA CI are still required. No migration application or rollout
activation follows from this document.

## Scope

The existing `PATCH /api/teacher/classrooms/[id]` accepts a strict
`{ archived: boolean }` operation for accounts admitted through the existing
classroom-experience gate. Metadata requests continue through their unchanged
strict schema and RPC. Mixed metadata/lifecycle requests remain invalid. One
authentication/admission decision and one body parse select the operation.
Absent or unmatched admission preserves the complete legacy branch.

Migration 268 adds only `set_classroom_hot_archive_for_owner_v1(uuid,uuid,boolean)`.
It is service-role-only, takes the authenticated server actor, and authorizes the
current owner under a row lock without consulting the historical account role.
Membership, self-enrollment and a paid plan do not confer ownership. It does not
archive cold data, modify retention, delete content, move Storage objects or
introduce another rollout flag.

The new path reuses the existing owner classroom response and existing UI
controls; no layout, component, menu, quota message or page activation changes.

## Transaction and policy

Lock order is the creation-entitlement subject, the existing purge operation,
the classroom row, then its archive-revision row. Operation/row contention
returns a controlled conflict. Current purge/decommission and maintenance-mode
fences remain authoritative.

- Archive changes only `archived_at` plus the normal update/archive-revision
  timestamps. It preserves position and does not require a creation grant.
- Restore retains the existing live creation-entitlement assertion and table
  trigger, including exact expiry and active-classroom capacity. It places the
  restored class before the owner's current active classes.
- The transaction verifies exactly one changed row, the complete expected row
  after immediate triggers, and exactly one archive-revision increment.
  Ownership, Blueprint revision, metadata and all other row fields are unchanged.
- Neither operation changes membership, assignments, Tests, responses or grades.

Creation and the new lifecycle writer serialize on the entitlement subject.
Legacy reorder and legacy precomputed restore do not use the same ordering
protocol. This slice does **not** promise globally atomic ordering against those
writers or change their existing behavior.

An archive revision change invalidates stale export/compaction finalization
through the existing revision contract. A cold-only classroom has no hot row and
returns 404. No export-history deletion or blanket export-operation prohibition
is introduced. The separately prepared archive-recovery work remains independent.

## Failure contract

Success preserves `200 { classroom }`. Duplicate archive/restore retains the
existing 400 messages. Current nonowners receive 403; missing hot rows receive
404; lifecycle fences receive controlled 403; contention receives 409. Restore
entitlement errors retain the existing exact status, `error_code` and `retryable`
envelope. Raw SQL messages are never returned.

A missing RPC, malformed/substituted result, postcondition failure or lost
transport returns 503 with an uncertain-outcome instruction to refresh. The
adapter performs one RPC call, never replays a mutation, and never falls back to
legacy authorization. It does not claim a lost response proves rollback.

## Acceptance and holds

Offline route/service tests exercise both historical role values, strict
dispatch, authentication ordering, legacy preservation, the installed SDK with
a stubbed fetch, exact errors and malformed/lost responses. The rollback SQL
checks ACLs, transitions, ownership, entitlement denials, row/revision/content
preservation and fault rollback. Authored SQL is not native evidence.

Before readiness: replay 001–268 only in a newly bound disposable project; run
the rollback contract and focused real-SDK/concurrency checks, generate genuine
database types, verify preservation/cleanup, and complete independent review and
CI. Then rerun the consolidated Test workflow on a newly reviewed app revision.
Do not replay any previously spent rehearsal token.

Shared-local and production migration applications, production promotion,
provider/account/plan changes and admission/home/page/cohort/cutover activation
remain held. This foundation closes a concrete dependency of the consolidated
permissions check; it is not a Tests, batch-2, lifecycle-batch or overall-goal exit.
