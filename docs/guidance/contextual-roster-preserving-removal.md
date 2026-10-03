# Shared preserving roster removal

Batch 1, dormant shared admission. Only the early shared branch of
`POST /api/teacher/classrooms/[id]/roster/remove` is adopted here. Existing
unmatched/legacy removal, bulk deletion, purge, restore and the UI are unchanged.
This slice does not activate the classroom experience or complete batch 1.

## Trust and transaction boundary

The existing shared roster actor helper authenticates before route parameters or
JSON are evaluated. Named feature schemas validate the classroom UUID and at most
100 requested roster UUIDs; the latter are canonicalized, deduplicated and sorted.
Only the current server-session actor reaches
`remove_classroom_students_for_owner_v1` through the service-role client. Request
identity, account role and subscription claims cannot grant classroom ownership.

The additive service-only transaction verifies the current active owner regardless
of global teacher/student label. Members, former owners and archived classrooms
cannot mutate. It retains the existing membership/lifecycle fences, locks the
classroom, relevant users, roster/binding/enrollment/mapping/revision sets and
affected Pal generations without waiting, then verifies exact learner purge fences.
Stable roster binding takes precedence over a changed account email. Unbound
matching uses normalized current email plus exact enrollment, without a global-role
filter; ambiguous identity fails closed before any write.

Joined students keep the roster row, stable identity and all six removal fields:
student UUID, enrollment UUID, enrolled timestamp, removed timestamp, manual
attendance marks and prior attendance-participant active state. Only the exact
enrollment is deleted and exact active attendance mapping deactivated. Their work,
grades, files and other classroom history are not deleted. Existing database Pal
generation triggers remain authoritative; no provider/API call is introduced.
Invitation-only rows may be deleted only after enrollment, binding and retained
identity ambiguity are excluded. Already-removed selected rows are idempotent and
contribute zero to `removed_count`.

Full persisted roster/binding/enrollment/mapping sets are compared after triggers,
including nonselected rows and preserved history. Suppressed, substituted or late
failing writes roll back the complete batch. Lock/serialization conflicts become
`PT409`, not an implicit SDK retry. The SQL and SDK independently validate the
actor/classroom/exact sorted request/count result. The HTTP response retains only
`success`, `requested_count` and `removed_count`. Missing RPC or unverified transport
returns generic 503; a failed post-commit response is uncertain, not proof of rollback.

## Duplicate-row lifecycle prerequisite

Installed migration 164's partial unique index permits only one retained removal
row per classroom/student. Migration 173's cleanup authorization (also used by
175) requires exactly one retained row. These controls are not relaxed here.

If an affected learner resolves from multiple active roster rows, both selecting
one and selecting all duplicates return 409 before DML:
“This student has multiple roster rows. Resolve the duplicate roster entries
before removing them.” Nonselected rows are never silently removed, and joined
duplicate history is never discarded to manufacture success.

This is a documented fail-closed compatibility limit. Coordinated multirow removal,
retained-generation/re-add identity, cleanup authorization, Pal generation and
purge/recovery compatibility must be completed in batch 3 before full cutover.
Do not drop the unique index as a standalone fix or claim this slice supplies
complete duplicate-removal support.

## Verification and rollout state

Forward migration 236 was applied once to local Supabase after frozen security
review, exact Pika/54322 target verification, matching 001–235 history, current-main
numbering check and a 236-only dry run. Its installed immutable SQL SHA256:
`24e23667b21580fdcadb7a64ca251725f87040fa52bf9a1fbe71e0c7b3c22249`.
Source/API/legacy tests pass (241 assertions across eight suites), plus scoped lint,
architecture, diff hygiene and the coordinator's staged audit. Frozen preapplication
GPT-5.6 Sol/high security review is CLEAN; 77 independent source tests passed.
Actual generated types add only this RPC (eight lines), and drift verification
passes. No generated signature was invented or hand edited.

Actual rollback-only SQL passed ACL, identity, exact purge fences, retained-history
and fault rollback checks with zero residual rows and an unchanged global baseline.
The actual SDK normal run passed both owner roles, bound/unbound teacher learners,
retained identity/history, retry/invitation isolation and observed lock races.
All three forced failures returned exactly exit 1 with their expected failure and
cleanup sentinels, including a suppressed-delete probe proving complete cleanup
rollback and restored generation guards. Full-row teardown checks passed before
commit and afterward. Earlier synthetic-fixture cleanup defects were corrected;
the exact abandoned fixture closure was independently reviewed and recovered
without changing unrelated database rows. Migration 236 itself was unchanged.
Final focused checks, full independent PR review and exact-head CI remain pending.
The CI hook's regression was reproduced RED then passes all seven workflow tests;
it requires normal SQL/SDK proofs plus exact forced exit 1 and both failure/cleanup
sentinels. Local schema is 001–236; production is 001–225.
The owner waived repeated routine local and review-extension approvals, not technical
gates. No production operation, account change or cohort activation occurs here.

### Forward correction after exact-head CI

The initial and changed-base reviews were CLEAN, but exact-head CI37141937671
at787e623f failed the warning-free database lint gate: the private removal result
validator declared IMMUTABLE calls STABLE `to_jsonb(anyelement)`. The PR returned
to draft; its database runtime checks before lint passed, but the run/gate did not.
Installed236 and237 remain byte-exact. Forward238 changes only that validator's
volatility to STABLE and fixes237's locked effective publication check to reject
both NULL and an empty saved slug before any UPDATE. The metadata correction
restores legacy400 behavior rather than committing then returning an uncertain503.

Because migration inventory must remain contiguous, this PR also carries the
exact installed237 as a dormant service-role database dependency. It imports no
metadata route/helper/UI and enables no account or cohort. The whole genuine237
type artifact retains the eight removal and four metadata RPC lines; root must
regenerate/check it from matching full001–238 local history after application.
The metadata rollback proof, including empty-slug rejection and unchanged full
classroom/Blueprint/archive revisions, runs before the removal proofs in CI.
Forward238 preapplication review/application, serial runtime regression proofs,
targeted correction and cumulative review, focused checks and exact-head CI are
pending. Earlier receipts do not certify this forward correction. Production
remains001–225 and shared admission/cutover stays OFF.

Forward238 was applied locally once on2026-10-03 after CLEAN targeted review of
frozen4390ea03/d1322acb and digest47a9bf5d, exact matched001–237 history and a
238-only preview. Installed history is001–238. Catalog checks prove the private
body hash/owner/ACL/security/search path/arguments unchanged with volatility `s`;
metadata definition matches238 and retains the service-only privileges. Genuine
generation and strict drift check pass; complete type artifact40d0289d unchanged.
Warning-free lint passes. Serial metadata and removal rollback-only SQL pass;
metadata SDK normal/two forced and removal SDK normal/three forced pass, every
forced child exiting exactly1 with its own expected failure and exact cleanup.
Suppressed roster cleanup rolls back all mutations and restores the guard.
No abandoned fixture, real-user change or schema-history repair was needed.
The first local startup check was22characters over16000; compact CURRENT retained
the original budget and canonical production marker. All188focused assertions
across16files and architecture/UI/design/TypeScript/lint now pass. Final cumulative
independent review and new exact-headCI are still pending; this is not rollout.
