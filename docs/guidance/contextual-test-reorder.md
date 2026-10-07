# Dormant contextual Test-list reorder

Implementation contract, 2026-10-07; parent main `473a5de8a23c252eafc0f53572853cbf83b52724`.
This is preparation, not native acceptance, migration application or rollout.

## Scope and compatibility

Prepare `POST /api/teacher/tests/reorder/atomic` with the legacy request
`{ classroom_id, test_ids }` and response `{ success: true }`. Leave the existing
reorder endpoint, UI and dispatch unchanged. Shared classroom-experience
admission must precede body reads and service-client construction. SQL authorizes
the current active Classroom owner, independent of global account role or plan.
Admission, classroom authority and subscription entitlements remain separate.

The input must contain the complete current Classroom Test membership, including
Blueprint-retired rows. The current list reader retains those rows, and the
legacy UI permits their presentation reordering. Only `position` and inherited
`updated_at` may change; authored content, lifecycle, lineage and runtime stay
read-only. An empty list succeeds only for an empty active owned Classroom.
Reject stale/partial/foreign membership with 409. Unchanged membership is not an
order-version CAS: concurrent reorders retain ordinary last-writer semantics.

## Fixed HTTP and RPC contract

Use one absolute 20-second body-plus-RPC deadline, with caller cancellation and
no retries, compensation or fallback. Bound actual UTF-8 body bytes to 512 KiB;
reject duplicate JSON keys (including escaped equivalents), malformed UTF-8,
deep JSON, locked/used bodies and oversized bodies. Require strict request keys,
canonicalized UUIDs, unique IDs and at most 10,000 IDs.

Exactly one `reorder_tests_for_owner_v1` service-only SECURITY DEFINER RPC:
`p_actor_id uuid`, `p_classroom_id uuid`, `p_test_ids uuid[]`,
`p_deadline timestamptz`. Empty search path, PostgreSQL owner, revoke PUBLIC,
anon and authenticated EXECUTE; grant service_role only. No table, Storage or
provider calls from HTTP. Never hand-edit generated database types or cast an
unregistered RPC around their contract.

Private strict acknowledgement keys: `version` (1), `actor_id`, `classroom_id`,
`test_ids` (requested order), `positions` (`N-1` through `0`), `count`,
`changed_count`. Bind identity, order, every position and count to the request.
Bound acknowledgement/envelope to 512 KiB/1 MiB. Release only `{ success: true }`.
Missing or malformed acknowledgement, transport failure or lost commit response
means 503; it never permits an automatic second write.

## Transaction and preservation

READ COMMITTED, finite deadline no farther than 20 seconds ahead; existing
8-second SQL phase budget capped by that same absolute deadline. Try/NOWAIT
locks: managed settings SHARE (without writer-sequence advancement), Classroom
purge-operation key, membership-change key, full Classroom UPDATE, archive
revision UPDATE, actor KEY SHARE, every current Test UPDATE in ascending UUID
order. Bound membership discovery to 10,001; above 10,000 fails closed.

Apply publication252 maintenance/finalization/purge/provider-cleanup guards.
Compare the complete current membership before any mutation. Update only changed
positions, retaining both Test ID and fixed Classroom predicates. Verify affected
count, complete membership and full row postimages after all immediate triggers.
Bound each Test row to 2 MiB and cumulative pre/post state to 64 MiB. Bound and
check Class/archive/settings state too. Overflow and deadline checks precede
mutation and postcondition acknowledgement.

With C changed-position Tests, exact expected deltas are: each changed Test only
position/updated_at; unchanged Tests identical; Classroom
blueprint_source_revision +C and archive revision +2C, timestamps at
transaction_timestamp() iff C > 0; all other fields unchanged. Settings unchanged
and no operation-caused managed writer sequence calls. The current catalog has
**13** Test triggers (including update_tests_updated_at); catalog reachability and
native full-Class/whole-project comparisons must attest no children, managed
state or queue writes. This is not a product-runtime global fingerprint.

Map named SQL errors: PT400 invalid input, PT403 forbidden/fenced, PT404 missing
Classroom, PT409 membership/busy/serialization, PT503 bounds/deadline/source/
postcondition failure. Raw permission failures and unknown 55000 are unavailable,
not an invented authorization success or fallback.

## Required evidence before acceptance

TDD body/route/helper boundary checks; SQL source/catalog contracts; isolated
native complete-chain replay and genuine CLI-generated types; role-neutral owner
and denial checks; mixed live/retired/started Tests and populated preserved
children; empty/no-op, 1,001/10,000 success and 10,001/byte/revision limits;
partial/superset/foreign/duplicate/null rejection; injected suppression,
alteration, reparenting and revision drift rollback; real lock races with two
reorders, ownership/archive, create250, discard251, save249/publication252,
legacy writers and Blueprint/purge operations; installed SDK transport;
forced-cleanup and canonical whole-project preservation receipts. Proof execution
requires a reviewed finite fixture/manifest, not an unbounded ad hoc runner.

The fixed rollback schedules include the actual migration114 archived-Class
Blueprint reuse entrypoint, which locks an active Class before declining with
`source_classroom_not_archived`, and both directions of contention with
migration122's actual purge lifecycle guard. These do not claim successful
Blueprint creation/proposal coverage or an enabled purge workflow. Enabled purge
execution remains held; persisted purge/provider fences are checked separately.
Committed schedules must run after the SDK matrix and attest stale membership
after create/delete/reparent commits, revoked authority after owner/archive
commits, unchanged-membership last-writer semantics and the legacy MAX residual.
They must compare complete graphs internally and return compact receipts without
restoring committed changes or reusing the prior SDK effect ledger.

The dedicated proof fixture represents 21,002 bulk rows using each row's full
immutable-postimage SHA256 plus identity/position/timestamp, while retaining raw
small representative rows and populated children. Its measured offline snapshot
is about 5.14 MiB; real native measurements remain required. Preserve the existing
8 MiB per-snapshot and 64 MiB native-engine limits. The new feature's fixed SDK
matrix separately caps cumulative private before/after snapshots at 256 MiB
(at most 24 contexts/48 snapshots) and actual SDK request/response exchange at
64 MiB. The dedicated lifecycle adopter caps its counted snapshot/control/SDK
exchange at 384 MiB, reserving the complete 64 MiB native-engine allowance.
Its application layer and native engine each retain a 200-action cap (400
counted actions combined), rather than a single shared 200-action allowance.
Inherited lifecycle adapter calls are reported separately; these counters do
not claim to measure opaque CLI traffic or every internal SQL statement.
Ordinary execution retains one absolute 900-second deadline. A bounded,
one-time canonical-after verification reserve remains available during cleanup
after execution-budget exhaustion; it cannot resume ordinary work. These are
isolated-proof scale budgets, not wider application limits or changes to earlier
proof profiles. Every captured feature snapshot is counted.

Legacy creation can read MAX(position) before this transaction and insert that
previously computed position after commit (migration250's existing residual).
Do not claim this slice closes that race, disabled-trigger maintenance writes or
nonconforming direct writers after commit. Demonstrate the residual honestly.

Independent risk-matched stable-SHA review, focused checks and final exact-head
PR Gate remain required before normal main merge. Canonical local/production
migrations249 onward, production promotion and all rollout/account/billing/
provider controls remain held; no UI adopter or activation in this slice.

## CI bulk-capacity diagnosis — 2026-10-07

PR1515's reviewedb668 CI37584113261 passed14857 tests (8 skipped), build and
browser checks, but the reorder normal proof failed with PT503 at the
bulk10000 success dispatch (21 actions/308 controls). Earlier accepted local
proofs remain historical evidence; they do not substitute for this failed CI.
The underlying PT503 reason is not yet observed. The dense fixture changes all
10000 positions and inherits10000 Classroom and20000 archive-revision writes.

The proof now maps only seven exact known PT503 messages to fixed PRD01–07
SQLSTATEs for this dispatch: deadline, source limit, catalog drift, invalid
source, revision limit, postcondition and result limit respectively. Unknown
messages retain PT503; every mapped error still aborts. This exposes no raw
PostgreSQL message, query, row or context. The product RPC, workload,8s/20s
deadlines, byte/action caps, one-update and sealed trigger contracts are unchanged.
No capacity/performance relaxation or native/CI acceptance is implied.

CI37593268925 on3531 passed build and browser checks, but failed earlier:
the native35s frame timer expired in authority-effects (15 actions/236controls,
unknown SQLSTATE), before bulk execution. Its13 probes perform33 complete graph
computations within one frame. This is not evidence of a product RPC deadline
failure, and the previous bulk PT503 remains independently unresolved.

The rollback manifest retains all50 unique probes in9 logical groups, now
partitioned into27 exact source-owned executions, at most2 probes each. Every
execution has its own BEGIN/ROLLBACK, full baseline, unchanged probe bodies and
full effect/rollback assertions, final fixture equality and exact compact receipt.
The existing native validator admits these exact issued SQL strings only.
Native/application action, control, byte and900s lifetime caps remain unchanged;
35s per-frame and8s/20s product deadlines are not extended. The additional18
dispatches and compact receipts remain counted. Fresh source review, native
normal/forced-cleanup proofs and exact-head CI are required; this rebatching is
not acceptance or a fix for the separate bulk-capacity failure.

CI37607651625 on reviewedb3 passed14878 tests (8 skipped), build and browser,
but frame26 bulk10000 failed with PRD01 (39actions/524controls). This confirms
`test_reorder_deadline`, not which internal deadline check or execution phase.
The PR returned to draft; exact cleanup passed, but the remaining reorder SDK,
race and committed evidence was not reached. Earlier local receipts stay labeled
with their original heads and cannot substitute for this failed CI.

The next bounded candidate replaces three duplicate SUM/MAX full-row byte
expressions with scalar-only `MATERIALIZED` measurements, preserving each
statement's original rows, predicates, JSON representation and guard ordering.
Only integer byte counts are materialized before guards; complete JSON aggregates
still follow them. Empty counts remain zero. All8s/20s/35s deadlines,10k dense
workload, triggers, revision deltas, full postimages and proof limits remain fixed.
This removes avoidable expression evaluation; its performance benefit and CI
capacity outcome are unmeasured. New independent review, full native/cleanup
evidence and exact-head CI are required. See [PostgreSQL17 materialization](https://www.postgresql.org/docs/17/queries-with.html#QUERIES-WITH-CTE-MATERIALIZATION).

CI37621234779 on b8f45fba passed test/build and browser, but again failed at
bulk10000 with PRD01 (39actions/524controls). The scalar-byte optimization did
not resolve CI capacity. Exact teardown and full canonical preservation passed;
the remaining SDK/race/committed matrix was not reached. Fresh local b8 native
normal/types and both forced-cleanup receipts passed but do not replace this CI.
An earlier same-head CI failed an unchanged UI test's5s timer; targeted/full-gallery
checks and this retry passed without source or timeout changes.

The next candidate changes proof diagnostics only, leaving migration253 SHA
71ed9848, all limits and the production function unchanged. Exact PT503 deadline
failures in bulk10000 inspect bounded private stacked context in PostgreSQL.
Only the first exact sealed RPC frame, its RAISE action and six source-bound
body lines map to PRD11–16; unfamiliar/oversized context keeps PRD01. PRD02–07
and unknown PT503 propagation remain unchanged. No raw context, query or row is
rendered. The existing expired-deadline probe calibrates actual PG17 first-frame
format and executes fixed positive/rejection cases within its unchanged rollback
frame. All50 probes/27 frames/full effect and rollback assertions remain.

PRD11/12/13/14/15/16 identify cumulative exhaustion after input validation,
Class locks/bounded discovery, pre-update validation/expected image, sole UPDATE
and immediate triggers, full postconditions/fences, and result construction,
respectively. They are not per-query timings: PRD14 does not attribute the cost
to UPDATE alone. Later checkpoints remain unobserved until actually reached.
See [PG17 stacked diagnostics](https://www.postgresql.org/docs/17/plpgsql-control-structures.html#PLPGSQL-EXCEPTION-DIAGNOSTICS).
