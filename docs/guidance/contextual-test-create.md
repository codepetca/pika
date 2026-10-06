# Contextual owner ordinary Test creation

Status: source preparation on main `25457e2d1`; no native acceptance, phase exit
or activation. Draft-save PR #1480 merged after exact reviewed-head CI passed.
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
