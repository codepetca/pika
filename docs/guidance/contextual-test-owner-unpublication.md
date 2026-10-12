# Contextual owner Test return to draft

This dormant slice prepares the existing
`POST /api/teacher/tests/[id]/unpublish` endpoint. Shared complete-experience
admission selects the contextual path; absent or unmatched admission retains
the literal legacy teacher branch. An admitted failure never falls back.
Current active Classroom ownership, not the account role, Test creator,
enrollment or subscription, authorizes the contextual operation. No UI or
rollout switch changes are part of this slice.

## Transaction and compatibility

Reuse the existing seven-argument service-only `test_owner_workflow_v1` and
its current actor, fixed parent, Test-source CAS, membership-operation,
archive/purge/maintenance and deadline fences. The server performs inspect
then one unpublish mutation with the same absolute deadline; there is no new
plan RPC, automatic retry, compensation or raw table-write fallback.

Migration261 extracts migration255's algorithm into one private invoker core.
Only the legacy public wrapper and the current-owner transaction call it.
The legacy wrapper always requires the historical teacher role; the contextual
caller selects current ownership only after its own authority checks. PUBLIC,
anon, authenticated and service_role cannot execute the core directly. No
public authentication-policy parameter is introduced. The contextual branch
locks the Classroom archive revision before actor/Test, preserving255's
relative writer order before reentrant core locks.

Both callers retain255's eligibility and source synchronization:

- Only closed or draft Tests with unlocked questions qualify.
- Any attempt, response, focus event, AI run or item, Test score override
  (including a wrong-Class override), or open learner availability blocks the
  operation. Historical/completed work still counts; closed availability is
  preserved. These checks precede the draft no-op.
- A draft Test requires a matching existing draft and returns its current
  version without writes or repairs. This shortcut precedes closed-only
  question/content and maximum-version checks.
- A closed Test reconstructs its draft from current published Test/question
  rows, never stale retained draft content. Keep portable question identities,
  canonical validation,10000-question and2MiB-content bounds, version limits,
  and the existing draft identity/creator where present.
- Do not delete or rewrite questions, work, documents, availability, provenance,
  settings or unrelated classrooms. Only the permitted draft fields and Test
  status change, with ordinary trigger effects.

The strict internal witness binds actor, operation, Test and Classroom. It
checks the resulting Test and actual draft version; draft no-ops retain exact
Test equality. The public success envelope stays `{ test, draft_version }`,
including existing document normalization and `assessment_type: 'test'`.
Database infrastructure details and private witnesses are not returned.

## Acceptance and remaining work

Source preparation is not native acceptance. Require legacy-body parity and
literal dispatch regressions, route/transport TDD, genuine disposable001–261
replay/types, real SDK and rollback/ACL/held-lock/committed-change/cancellation
evidence, exact restoration and complete shared-resource preservation. Use
the existing finite engine, not a new verification framework. Each predecessor
profile must recognize only the exact sealed261 successor and still refuse
unknown, incomplete or altered migration inventories.

The populated native rollback proof uses eleven fixed source-derived frames in
one persistent session and transaction. Every original SQL assertion remains;
only tiny intermediate transaction acknowledgments separate the frames. The
original combined SQL remains a reconstruction oracle, not an executable
capability. Keep the12s request,180s aggregate,40-dispatch and full-graph bounds;
framing alone is not evidence that any individual check meets its time limit.

The question-count boundary fixture retains all10000 generated questions plus
the original two, with every ordinary trigger enabled. Four fixed2500-row
top-level INSERTs share one savepoint inside the original rollback transaction;
the count rejection is followed by savepoint rollback and complete graph/original
row equality against a pre-savepoint temporary baseline. These are fixture
statement boundaries, not smaller product limits or extra transactions. Eleven
contract frames plus28 race dispatches use39 of the unchanged40-dispatch cap.
The prior exact-head native pass does not establish acceptance of new framing.

The late-fault trigger probe must release its DDL locks before the next frame:
run its unchanged CREATE/probe/DROP in an exception subtransaction, deliberately
roll it back, and prove full graph and trigger-catalog restoration plus absence
of an owned exclusive Test-relation lock. Dropping the trigger alone retains
that lock until transaction end. This fixture correction does not prove the
cause of a particular guard failure or replace fresh native acceptance.

The availability and AI-before-unpublish holders must use the installed writer
RPCs that acquire the Test lifecycle advisory lock; a direct child-table insert
does not prove that RPC-level lock. The no-work AI holder requires the exact
installed no-op response while retaining the writer transaction lock. It proves
serialization, not durable AI creation or provider execution. Keep the separate
AI-history rejection checks and all14 contention schedules unchanged.

Independent security and compatibility review, focused checks and final
reviewed-head CI/PR Gate precede protected-main merge. This document grants
no database execution or activation authority. Shared local249+, production259+,
promotion, provider/billing/account and admission/home/page/cohort/cutover holds
remain unchanged. Whole-Test deletion, Surveys, Gradebook/returned Grades,
service/lifecycle integration and the integrated existing-screen rollout are
still separate obligations. This component does not finish Tests or the goal.
