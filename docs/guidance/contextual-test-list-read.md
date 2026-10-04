# Contextual owner Test list read

Status: runtime-verified candidate on `codex/contextual-test-owner-list-read`, prepared
against reviewed predecessor `039642ac26ac80e69737d714bf5f68ae8b721f9e` and integrated
onto its identical-tree main merge before publication.
PR1468 merged as `902cbf7617bc7f5e0788cfd01fd07d78f051c99c`; all five exact-head CI
checks, reviewed/merged tree parity and clean canonical-main fast-forward passed.
Both writers have relinquished their assigned files. Actual SDK execution requires
independent fixed-source review and explicit coordinator manifest acceptance.
Shared local schema001–243; disposable proof replays001–246. Production last
verified001–225 remains untouched. Final cumulative review and exact-head CI/main
merge are still required.
This is an assessment-phase component, not phase-exit or rollout evidence.

## Approved boundary

Only GET `/api/teacher/tests?classroom_id=...` gains dormant contextual dispatch
through the existing shared classroom-experience admission. Absent/nonadmitted
configuration retains exact legacy behavior; present malformed configuration
fails closed after authentication and before parameters or discovery.

Actual current Classroom owners may inspect their Tests regardless of global
teacher/student label, including owner/member precedence and archived or hidden
Classwork. Membership, teacher labels and paid plans alone grant no owner access.
Every payload, child page, terminal-empty page and final statement binds the
fixed Classroom/current owner. Statistics also bind exact Test parent controls
and each participant's current enrollment through actual named foreign keys.

Return complete collections using finite keyset pages and bounded parent batches,
strict returned identities/cardinality, decoded result/aggregate limits and an
abortable deadline. Fail unavailable rather than return partial or zeroed stats
when contextual relationships, schema, authority or completeness cannot be proved.
Legacy missing-table compatibility remains only in the unchanged legacy branch.

## Compatibility

Preserve full current Test-row fields, physical Test IDs, descending position and
creation ordering, normalized persisted documents and all six existing statistics:
total students, respondents, submitted students, open/closed access and question
count. Submitted attempts and meaningful responses contribute deduplicated
participants; option0 is meaningful, whitespace is not. Repeated response rows
for one student are legitimate. Teacher-valued enrolled members count; the owner
does not count as their own learner, and removed membership history is excluded.

Preserve effective availability overrides. Draft-only validated overlays affect
title, show-results and question count; closed Tests use canonical questions.
Drafts join the Classroom FK with exact type/assessment identity, not a nonexistent
Test-to-draft FK. Question-count reads select identity fields only, never answers
or cache content. Raw participant IDs, responses and draft content stay internal.
Persisted document MIME fields are retained; no Storage MIME lookup/enrichment,
file delivery, provider or AI operation is added.

## Acceptance and exclusions

Require owner/denial and unchanged-legacy route regressions, full statistics and
draft/document compatibility, repeated/removed-member responses, uneven child
pages through terminal empties, owner loss/reparenting/enrollment loss, malformed
or oversized results and deadlines. Source mocks are not actual SDK evidence.

A separately frozen finite disposable-local fixture/request manifest must be
independently reviewed and explicitly accepted by the coordinator before runtime.
Preserve original sealed platform/lifecycle/allowlists/control/restoration/cleanup,
complete canonical closure and a separate once-captured baseline after each normal
and fully-set-up forced run. No new migration/RPC is indicated by the source map;
actual SDK authority/cardinality failure requires a separately reviewed additive
design rather than an unbound fallback.

No POST, editing, draft repair, reorder, learner/results, grading, account, plan,
billing, UI, production, admission/cohort, home or cutover activation is included.

## Source-preparation receipts

The app worker delivered43 new unit/route checks,10 existing list-route checks,
50 related detail/API-standard checks, TypeScript and scoped lint. Root inspected
all app/validation/new test source and independently passed93 integration checks
plus24 correctly selected legacy list/detail checks. Two initially mistyped legacy
test filters were ignored by Vitest; only actual matched test counts are claimed.
The route diff changes only imports and dormant GET dispatch. Actual SDK evidence
remains unverified; source mocks do not grant runtime authority. Root inspected
the three proof files and independently passed133 checks across the new list,
proof and legacy route surfaces. The proof worker passed36 new offline checks,
TypeScript and scoped lint; its21-minute wall time is a manual observation,
not attributable active time or token usage (both unknown).

The proposed finite extension has5 actors,3 Classes,4 Tests,4 questions,2 drafts,
4 attempts,5 responses,5 availability overrides and5 allocated enrollments.
One exact fresh enrollment deletion retains one removed168 generation alongside
four active generations. Signal169 stays OFF. Include9 trigger-created default
Gradebook categories in complete Class-bound snapshots; do not bypass triggers,
insert categories manually or reset/remove retained membership generations.
No new extension Storage/RPC operation; inherited native Storage effects remain.
Caps:64KiB extension SQL,256 network requests,15-second requests and8MiB responses.
Freeze the setup/snapshot generators and exact Class-root projection/filter/control
manifest after source completion and review. Its8 helper/SDK cases are distinct
from unit-only saturation, malformed payload, timeout and race scenarios.

## Runtime recovery and proof correction

The initial disk/API failure was recovered without deleting canonical data.
Exact owned failed-start resources were removed after global identity/attachment
checks; the same once-captured canonical baseline then compared equal. A later
Storage-unhealthy startup also completed teardown and baseline equality. A narrow
read-only observer verified healthy Storage on the next run, which reached but
failed the extension fixture setup before any extension SDK request.

Source analysis and a RED→GREEN regression found an incorrect zero-row archive
expectation: existing082/095/112/147 triggers create three owned-Class archive
rows. The corrected frozen footprint requires exact archive revisions41/7/4 and
blueprint revisions10/2/1, with exact Class IDs, cardinality and archive columns.
No extra fixture DML, guard bypass, lock/timestamp reset, Storage/RPC operation,
schema or application behavior is added. Closed setup checkpoints distinguish
guard, SQL, snapshot-read and validation failures without raw errors or row data.
49 proof tests and122 combined tests passed; actual normal/two full-setup forced
runs remain required after independent correction review and manifest acceptance.

The reviewed correction reached setup SQL but failed before SDK requests; exact
teardown and the same independent canonical baseline comparison passed. Catalog
metadata and migration044 expose another concrete fixture violation: multiple-choice
answer keys must be null. The fixture now keeps only open-response text keys,
with a generated-SQL regression; application and sealed lifecycle bytes are unchanged.
Actual normal and both fully-set-up forced runs remain pending verification.

The answer-key correction passed independent fixed-source review. Its actual
normal run completed strict fixture setup, then failed at matrix/dispatch with
19 attempted transport requests. Exact teardown and the same independent canonical
baseline passed. Closed diagnostic counters now distinguish fixed case/projection,
bounded context/guard elapsed time, caller abort, fixed failure classes and HTTP
status, without private error strings or rows. No guard or deadline is relaxed.
The timing cause remains unproved; forced runs have not been attempted.
Timing diagnostics are frozen immediately when the helper rejects, including any
in-flight guard time, so later teardown cannot inflate or overwrite that evidence.
The freeze is diagnostic-only and does not cancel, skip or authorize any operation.

## Audit-main reconciliation

Audit #1463 and receipt #1471 are merged on main `a2175080`. Their reviewed
platform/lifecycle now replay every immutable SQL file in the complete source chain
(001–246 here), never silently truncate at243. This slice changes neither platform
nor lifecycle; it inherits the new attempt-revision/storage/auth contracts and
locked dependency updates. Local shared243 and production225 are not changed.
Original own app/fixture/request/diagnostic/test bytes are preserved. Only history
and CURRENT conflicts required reconciliation; all full historical bodies and
multiplicities are checked against old branch + new main − old base.
The frozen diagnostic source reviews cover the prior base only. Updated-base
checks, independent integration review, explicit finite-manifest acceptance and
new actual normal/two forced receipts remain required; prior failed243 attempts
are historical evidence, not runtime proof of the new source chain.

The updated-base source review passed at `e8e001aa`, and the coordinator accepted
the complete immutable001–246 disposable manifest. Its actual normal run reached
the first SDK case after complete fixture setup, then froze this closed evidence:
context20001ms, cumulative/in-flight guard19651ms,18 attempted requests, availability
projection, guard phase. Exact teardown and the SAME once-captured independent
canonical public/private/Storage/168/settings/cron/resource baseline both passed.
This establishes guard overhead as the immediate deadline blocker, not disk space
or a passing SDK matrix. Neither fully-set-up forced mode has run yet.

A bounded additive executor now runs fresh global Docker discovery
pipelines concurrently through the sealed inventory's existing injection seam.
It must retain all original parsing,128-item inspect batches, complete foreign
attachment discovery, exact one-shot command consumption, pending-work settlement
and every private SQL guard. No durable cache, project-only filtering, bypass,
application deadline change or sealed native/lifecycle edit is permitted. Offline
equivalence tests cover global multi-batch/foreign attachments, concurrent bounded
pipelines, invalid/missing/duplicate identities, failures/settlement, fresh consecutive
invocations, one-shot consumption and native command/output caps. Worker70 proof
checks and209 related checks pass; root verification, independent fixed-source
review and coordinator acceptance precede any new actual run. Production/shared
schema and rollout remain unchanged.

History-only main #1472 (`9c2ff7ef`) is now reconciled. Application/proof/test/CI/
schema/dependency bytes match the pre-rebase correction exactly. Full-body hashes
preserve incoming canonical history multiplicities plus positive branch additions
relative to the fixed prior base; four missing original copies were restored and
14 surplus or malformed rebase fragments removed. No original historical body
was lost; official trim and exact multiset checks pass, and36 unrelated stashes
remain untouched. Current source checks and targeted fixed-head review remain
prerequisites for execution; no successful runtime is implied by the rebase.

The parallel guard correction passed targeted independent review and coordinator
acceptance at `b4d226cc`. Its actual normal run progressed beyond the prior
deadline through the three owner cases, then failed at the first denial case:
case3/root,41 attempted requests,1848ms context/1829ms guard,HTTP200. Exact teardown
and the SAME independent canonical baseline both passed. An expected helper403
also freezes transport diagnostics, so this does not distinguish denial validation
from the following snapshot read/equality assertion. A synthetic offline TSX
probe confirms403 with the same ApiError constructor and one request, not actual
SDK or snapshot evidence. Closed matrix checkpoints and finite API-error class/
status metadata now distinguish these failures without retaining messages, getters,
URLs, identities or rows. Original constructor/status/request-count/snapshot
assertions, fixture footprint, SQL, sealed parser and deadlines are unchanged.
Actual normal and both fully-set-up forced modes remain required.

## Superseding runtime receipt

The diagnostic correction passed independent Sol5.6/high review and explicit
coordinator finite-manifest acceptance at `d82aa4e27072e580dd2520d1edf34f78cd766824`.
Normal session77355 then passed all eight actual SDK cases with exact two PASS
markers and no stderr. Both full-setup forced runs passed their expected exit1,
exact cleanup-PASS/forced-FAIL marker pair and no unexpected output: after-fixture
session32135 and before-capture session42314. Logs are private0600.

Exact owned teardown and the SAME separately once-captured five-field canonical
public/private/Storage rows,168 metadata, settings, cron and resource baseline
passed after normal and each forced run; no recapture or baseline replacement.
All immutable001–246 migrations were replayed only inside disposable projects.
The previously recorded failures remain historical evidence, superseded only
as current blockers by these complete actual receipts. No authenticated appHTTP,
browser, public-legacy or live race coverage is inferred from these helper cases.
Application behavior, admission, source caps and real20s deadline are unchanged.
Final cumulative review, stable-head CI and normal main merge remain pending;
no phase exit, shared schema application, production or rollout activation.

## CI aggregate fixture correction

The final cumulative source review at `728f58e7` was clean, but its exact CI failed
one new aggregate-limit unit test at the unchanged5000ms test timeout under
coverage. The PR returned to draft before correction. The mock repeatedly scanned
100050 rows for50 parents on every page; a test-only parent index removes that
quadratic scan while preserving all participant, pagination and overflow checks.
An interleaved-page/index-read regression failed16-versus4 before the correction.
Application/proof/native/CI/schema/dependency source, collection limits and real20s
deadline remain unchanged; no timeout or coverage threshold was increased.

Root44 read/route checks and294 focused/static checks pass. A first full local
coverage attempt found only an installed-dependency mismatch: the locked braces
patch directory contained unpatched code. A worktree-owned frozen locked reinstall
restored the already-reviewed patch without changing package/config/patch source.
Fresh full CI-equivalent coverage passed12343 tests, all thresholds, and1036 files
(8 tests/2 files skipped by the existing command). These local results do not
replace new fixed-head review/runtime-environment verification or required CI.
Earlier CI/local failures remain historical; no main merge or rollout is claimed.
