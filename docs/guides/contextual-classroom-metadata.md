# Contextual classroom metadata PATCH

This dormant batch-1 slice adds an early shared-admission branch to
`PATCH /api/teacher/classrooms/[id]`. It does not change either classroom-detail
GET, the literal legacy PATCH body, UI/SSR routing, creation, enrollment, billing,
ownership transfer, archive/restore or public Course Guide reads. Shared admission
and whole-experience cutover remain OFF; metadata is not completion of the phase.

## Request and authority

Configured shared admission authenticates before parameters/body and resolves
admission once. Admission alone grants no classroom authority. Either account-role
label may update a classroom they currently own while it is active. Nonowners,
including enrolled actors, are denied; ownership does not depend on a creation
grant, plan or quota for an ordinary metadata edit. Archived classrooms are denied.

The named feature-owned schema accepts only these 13 metadata keys:
`title`, `classCode`, `termLabel`, `allowEnrollment`, `joinPolicy`, `themeColor`,
`lessonPlanVisibility`, `featureVisibility`, `actualSiteSlug`,
`actualSitePublished`, `actualSiteConfig`, `courseOverviewMarkdown`, and
`courseOutlineMarkdown`. Existing field validation/normalization and explicit-null
slug clearing are preserved. Feature visibility requires all nine boolean flags;
actual-site configuration uses the complete eight-key normalized contract.
Empty patches and unknown actor, position, revision, provenance or manual-attendance
keys reject 400. Every explicit `archived` key rejects 400, including false/null
or a mixed metadata request: lifecycle writes remain reserved for batch 3.

The effective public sharing/slug pair is validated from locked current state.
Publishing requires a slug; clearing a published slug requires unpublishing in
the same patch. Only the genuine case-insensitive slug unique index maps an
address conflict to 409, without enumerating another classroom.

## Transaction and wire boundary

Migration `237_contextual_classroom_metadata_owner_write.sql` adds the narrowly
named `update_classroom_metadata_for_owner_v1(actor, classroom, normalized_patch)`
RPC. It independently validates every allowed database key, type, enum and config.
The service role alone has EXECUTE; PUBLIC, anon and authenticated do not.
It uses a fixed search path and established classroom-operation lock order,
targeted NOWAIT row/revision locks and the genuine purge/decommission fences.
There are no whole-user/table/provider locks or maintenance guard bypasses.

One explicit metadata UPDATE must affect exactly one row, even for a requested
no-op. A full preimage comparison rereads the classroom after immediate triggers,
allowing only the established updated-at timestamp and appropriate 112 structural
revision increment for overview/outline edits. The exact 082/095 archive-revision
effect is verified too. Suppression, substitution or late identity/lifecycle,
metadata/provenance/revision faults raise an exception inside SQL and roll back
the metadata write and its revision effects.

The application strictly validates the SDK envelope and all 30 persisted owner
fields, exact actor/classroom/active identity and requested normalized values,
then reuses the classroom-detail schema and existing full-owner hydrator.
Missing, malformed or substituted wire evidence denies without a partial DTO.
Contention returns 409; policy/input/missing-row errors retain their named status.
An uncertain or malformed transport returns 503: refresh to reconcile the result.
A lost response can follow a committed write; a JavaScript denial is not proof of
SQL rollback. No automatic retry, replay, legacy fallback or compensating write
is performed.

## Evidence and release gates

The coordinator applied the reviewed immutable SQL locally once after complete
001–236 reconciliation and a 237-only preview. Migration237 retains its reviewed
SHA256 `f61ec76016a13c2b2e5fd22f765857304d5798617cf96fc0720585fff699d883`.
Genuine generation adds only the 12 actual 236/237 RPC contract lines; type drift
checks and TypeScript pass. Execute ACL checks confirm service TRUE, anon and
authenticated FALSE, and the explicit 30-column owner contract. The 124-line
rollback-only SQL proof exits 0 with its complete marker at 17:23:59 UTC on
2026-10-03: direct validation, full owner output, genuine slug collision and
suppression/substitution/late-trigger rollback assertions pass.

The first actual SDK normal run reached all three behavior/race/uncertainty
markers but exited 1 during teardown, without its complete cleanup sentinel.
That is not a passing complete proof. Read-only diagnosis found six default
gradebook-category rows created by the fixture trigger; teardown correctly refused
them because its dependency whitelist omitted that table. The cleanup transaction
rolled back. Targeted independent review was CLEAN for the proof-only correction
(`2cf48304`) and private one-shot recovery (SHA256 `9aa5e2b8…`). At 17:37:18 UTC, the
coordinator's recovery exited 0 and removed only the exact 20-row synthetic closure.
It verified zero target residue, the enabled generation guard and preservation of
the current untouched whole-row baseline before COMMIT and afterward; this does
not certify the first failed process's original baseline.

The corrected normal SDK run `60635` exited 0 with all three behavior markers and
the exact cleanup sentinel at 17:37:48 UTC. Strictly serial forced-fixture run
`20684` then exited exactly 1 with its own expected post-fixture FAIL marker and
the exact cleanup PASS sentinel. Only after it closed did pre-capture run `56515`
run; it exited exactly 1 with its own expected pre-capture FAIL and cleanup PASS,
observed at 17:38:31 UTC. All three corrected modes restore their captured global
full-row baseline, leave zero residue and retain generation guard `O`. These are
exact expected-failure receipts, not acceptance of arbitrary failures. The proof
correction changes no product code or immutable metadata RPC. Full initial source
review, exact-head CI and actual-main integration remain pending release gates.

CI runs the SQL proof, normal SDK proof, then both forced modes serially. Normal
success requires every behavior marker and exact whole-row baseline cleanup.
Each forced mode requires exit exactly 1, its own expected FAIL marker and the
same complete cleanup sentinel. Synthetic parent/allowed-child candidates are
locked before teardown snapshots/scans; exact operation/provenance-bound deletion,
zero residue and full-row public/private/storage baseline equality are checked
before commit and afterward, with the generation guard enabled throughout.

Local schema is 001–237; production remains 001–225. Immutable 235/236 dependency
sources are retained; installed schema does not establish a main merge or release.
The [classroom access roadmap](../guidance/classroom-access-and-entitlements-roadmap.md)
continues to govern the remaining batch and whole-experience activation gates.
