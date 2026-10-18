# Contextual hot classroom archive and restore

Status: disposable native verification passed on1678418b; genuine268 types have
been installed. Final type-integration review, consolidated browser verification
and final-SHA CI remain required. No shared-local/production migration application
or rollout activation follows from this document.

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

The disposable witness retains complete classroom and archive-revision rows.
Every other public/private/storage table is represented by its row count and
SHA-256 of the same complete, deterministically ordered full-row JSON. Table-key
inventory and the existing function/trigger catalog witness are compared too.
This avoids repeatedly transmitting fixture content while preserving change
detection across every table; native byte, action, session and time caps remain
unchanged. Missing, extra, malformed or changed witnesses fail verification.

Before readiness: replay 001–268 only in a newly bound disposable project; run
the rollback contract and focused real-SDK/concurrency checks, generate genuine
database types, verify preservation/cleanup, and complete independent review and
CI. Then rerun the consolidated Test workflow on a newly reviewed app revision.
Do not replay any previously spent rehearsal token.

2026-10-17 native receipt: source1678418b0e7d20abc25f1c288c46a1a3cc5d5ad2,
disposablepika_assignment_list_f5f76875a33c, exact001–268 chain
16dfffc916b245a55e7f6750ff26ae274b5f76b696404c6c9995401b38a1c2e0.
All13 realSDK calls, rollbackSQL and four backend-observed committed schedules
passed, using655controls/51actions/842800exchangedbytes and zero remaining
sessions. Exact teardown, canonical equality and independent source/dependency
preservation passed. CLI-generated artifact SHA256
1230d8e1b789293fe754b5aedbbfd5711a5de82e3dfee179eb01363896414414 matches
`src/types/database.generated.ts`; only the new RPC signature was added. The
application now invokes that generated typed RPC directly, without a temporary
signature cast. This receipt is component evidence, not the consolidated app
workflow, a phase exit or rollout approval.

Shared-local and production migration applications, production promotion,
provider/account/plan changes and admission/home/page/cohort/cutover activation
remain held. This foundation closes a concrete dependency of the consolidated
permissions check; it is not a Tests, batch-2, lifecycle-batch or overall-goal exit.
