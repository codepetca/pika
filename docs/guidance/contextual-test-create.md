# Contextual owner ordinary Test creation

Status: isolated normal/forced cleanup proof accepted at `59a4b35b5736`; genuine
types installed. Final PR review/CI pending; no phase exit or activation.
Draft-save PR #1480 merged after exact reviewed-head CI passed.
Migration 250 is additive source only; canonical local/production 249/250 remain
unapplied. Shared admission/home/page/cutover/billing remain OFF.

## Scope

Prepare only the admitted branch of `POST /api/teacher/tests`. Keep existing GET
and the entire unadmitted legacy POST unchanged. The shared admission contract
authenticates before body discovery. Current active classroom ownership grants
authoring authority, independently of historical account role, enrollment or
plan; this is not permission to create additional classrooms.

Accept only `classroom_id` and optional nullable `title`, with UUID validation,
strict unknown-field rejection, a 500 UTF16-unit incoming title limit and 16 KiB
raw body cap. Preserve ECMAScript trimming and the existing Toronto fallback.
Carry one absolute 20-second deadline from body reading through the single
service-only `create_test_for_owner_v1` RPC. No direct-table, missing-RPC,
Storage, retry or compensating-delete fallback belongs to this branch.

The SQL transaction generates IDs and creates the ordinary default Test plus
its version 1 canonical empty draft. After both inserts and immediate triggers,
verify the complete 21-field Test and 10-field draft, parent/actor/defaults,
revision effects, category/settings and absence of fresh child/managed data.
Private draft/authority witnesses do not appear in the public 201 `{test}` DTO.
Known caller/contended states are closed; raw 42501 and unknown capability or
schema errors fail 503. A lost acknowledgement can leave a committed complete
pair; no automatic POST retry or assertion that 503 always means no commit.

## Ordering and compatibility

Use migration 117's settings-first managed-storage lock order, classroom operation lock,
current owner/archive/purge/decommission fences and bounded NOWAIT row locks.
The nonunique classroom/position index covers all Tests, including retired
rows. Preserve legacy integer position behavior; INT_MAX fails closed.
Contextual creates serialize with each other. A legacy request can read stale
MAX and insert after a contextual commit; this slice does not claim global
position uniqueness, rewrite legacy code or introduce idempotency.

API validation ratchet removal is route-level evidence of a named boundary in
the new branch, not evidence that the deliberately preserved legacy POST now
uses Zod. Legacy validation remains compatibility debt.

## Required acceptance

Offline application/route/source tests are not database proof. Before readiness,
verify actual defaults, trigger catalogs/revision effects, post-trigger rollback
and deadlines, bounded installed-SDK cases with a 1001-Test source, current-owner
denials, exact restored raw 42501 probe, and finite two-session contention races.
SQL rollback equality and committed SDK creates need distinct truthful receipts.
Do not reset the inherited nontransactional managed writer sequence to manufacture
equality. Use the original exact disposable-project teardown and SAME whole
canonical baseline, normal and both forced-cleanup modes, genuine isolated
CLI-generated types, focused/static checks and independent high-risk review.
Publish draft first; normal merge requires the stable reviewed SHA and exact-head
PR Gate. Component completion is not assessments or full rollout completion.

## Isolated acceptance receipt (2026-10-06)

The exact clean `59a4b35b5736d4145dab03fe09a0eab7ad0db989` normal run passed
14 installed-SDK cases, eight committed pairs, 15 RPC requests, zero Storage
requests and the actual restored raw-42501 probe. Native proof passed 46 rollback
checks and nine two-session schedules (53 dispatches, 67,078ms), using 1,673
control calls/91 actions and leaving zero sessions. Normal and both serial forced
cleanup modes passed exact teardown and the SAME whole immutable canonical B1;
independent B1 checks also passed before/after each forced mode.

Earlier normal attempts failed, first with undifferentiated P0001 and then the
closed PC013 trigger-catalog label. The expected inventory omitted two inherited
Test triggers from migrations157/173. It now enforces the exact17-trigger set,
not an optional/count-only allowance; no migration or assertion was weakened.

The genuine isolated CLI artifact is 436,960bytes, SHA256
`582d14b451555bb27690ba21c9cd624140b5ef0b8752cb40eeccfa12784f2299`.
`database.generated.ts` is installed byte-identically and adds only the CREATE
RPC declaration. These receipts do not apply249/250 to canonical local or
production, activate controls, prove deferred concurrent lifecycle-state writers,
or establish a phase/goal exit. Reviewed final SHA and required CI remain gates.
