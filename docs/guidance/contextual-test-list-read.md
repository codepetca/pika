# Contextual owner Test list read

Status: source candidate on `codex/contextual-test-owner-list-read`, prepared
against reviewed predecessor `039642ac26ac80e69737d714bf5f68ae8b721f9e` and integrated
onto its identical-tree main merge before publication.
PR1468 merged as `902cbf7617bc7f5e0788cfd01fd07d78f051c99c`; all five exact-head CI
checks, reviewed/merged tree parity and clean canonical-main fast-forward passed.
Both writers have relinquished their assigned files. Actual SDK execution requires
independent fixed-source review and explicit coordinator manifest acceptance.
Local schema001–243; production last verified001–225 remains untouched.
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
