# Dormant contextual member Test list read

Source preparation on `codex/contextual-test-member-list-read`, main base
`47659857d`. This is an independent batch-2 component, not native acceptance,
phase exit, cohort admission or product rollout. Owner reorder #1515's separate
capacity decision does not block this read-only boundary.

## Boundary and compatibility

Only GET `/api/student/tests?classroom_id=...` receives dormant shared admission.
Absent/nonadmitted configuration preserves its legacy role guard, queries, DTO
and missing-schema compatibility. A present configuration is authenticated and
strictly decoded before parameters or service-client construction; malformed
configuration fails closed. Use the existing single admission contract, not a
new per-route switch.

The actual active Classroom's current nonowner member may read the published
Test list regardless of global account role or subscription plan. Self-enrolled
owners remain owners, not learners. Archived Classrooms, removed membership and
hidden Tests deny member access. Creation quotas are not learner authorization.

A single metadata-only preflight may read exact Classroom `id,teacher_id,
archived_at` to retain missing-Class and owner/archive refusal behavior. It grants
no payload authority. Every subsequent control, payload, child, terminal-empty
and final statement independently binds the exact Classroom/current owner,
nonowner actor, active archive state, named-FK `!inner` membership and Tests
visibility. Capture the feature JSON and require the same fingerprint thereafter.
Child pages also bind Test id/Class/status/updated timestamp and the actor's own
rows; no roster-wide participant data is fetched.

Preserve the legacy thirteen Test fields, active-before-closed position ordering,
normalized documents and student/effective-access status calculation. Draft Tests
never enter the read. Blueprint-retired published rows retain legacy visibility.
Submitted/returned/closed-for-grading attempt controls, meaningful option zero,
repeated responses and availability overrides retain their existing semantics.
Documents are empty unless effective access allows start/continue or viewing
submitted work. Question/answer content, raw responses, grades, feedback and
private child identities are not returned.

## Completeness, privacy and limits

Use complete bounded keyset pages and parent batches, strict identity/cardinality
checks, an abortable deadline and bounded decoded/cumulative output. Reuse the
existing Test-list limits: 1,000 root page, 50 parent batch, 100 child page,
10,000 per collection, 100,000 aggregate rows, 1,024 statements, 20 seconds,
8 MiB per decoded DTO/final response and 64 MiB cumulative decoded output.
Verification reads count against these limits; never silently truncate or
substitute zeroed status on missing/error data.

Re-read the complete Test set and own attempt/response/availability collections,
then final parent and Classroom controls before returning. Failure or drift is
unavailable, not permissive fallback. This is statement-bound authorization and
bounded revalidation, not a transaction snapshot or protection against a change
after the last guard. Transport-origin errors cannot supply public status/text.

## Acceptance and exclusions

Require role-neutral member and owner-precedence cases, current archive/visibility
and revocation binding, publication/document/status compatibility, child parent
and actor validation, uneven/terminal pages, cardinality/completeness, malformed
results and every size/action/time limit. Route tests must prove auth/config
ordering and unchanged unmatched legacy dispatch. Mock tests alone are not
actual installed-SDK or database evidence.

Prepare an independently frozen finite disposable-local SDK fixture and request
manifest, retaining the inherited lifecycle/platform guards, restoration policies,
full five-field canonical preservation, exact resource teardown and both fully
set-up forced-failure modes. Current source replays through disabled quota253;
its isolated catalog addition must be externally migration-SHA-bound, not inferred
from the fixture or used to exempt any canonical table/state. Independent fixed
source review and explicit coordinator manifest acceptance precede execution.
Focused checks and exact reviewed-head CI/PR Gate precede normal main merge.

No member detail/start/save/submit/history/material/results, owner mutations,
grading, UI adopter, new migration/type contract, Storage/provider or billing
change is included. Do not expose the Tests tab until its complete reachable
member workflow is integrated. Quota messages belong only on upgrade/tier
summaries. All canonical migration249+, production promotion, enforcement,
admission/home/page/cohort/cutover and account/provider/billing holds remain.

## Source checkpoint — 2026-10-08

App source and inert proof-source preparation are complete: 49 helper, 12 route,
28 proof-source and one CI-contract checks pass (90 total). The independently
enumerated proof contains five actors, five Classrooms, eight Tests, seven live
memberships plus one removed generation, four attempts, five responses, three
availability rows and nine SDK cases. Natural trigger categories/revisions are
statically asserted. Every case requires full before/after table fingerprints;
normal and both forced modes require inherited cleanup and unchanged canonical
state. No native execution, independent review, PR or acceptance is claimed yet.

Draft #1534's initial source07718606b received complete fresh security/privacy and
architecture/compatibility reviews. Both found the same CI canonical-profile
blocker, not an app authorization defect. One remediation accepts only the exact
schema-only183-table held248 and184-table post253 catalogs, preserving every
canonical field/table and the externally SHA-bound idempotent253 union. Its
regression rejects missing, extra, substituted and duplicated table names and
changed migration bytes/digest. Targeted review and native execution remain gates.

Pre-run readonly checks found the earlier private canonical checkpoint differs
only in login session/rate-limit tables. No member fixture or SDK run has started;
the prior checkpoint is preserved, not overwritten, and no table is exempted.
Reconcile local sign-in activity before accepting a verification checkpoint.

## Native attempt and bounded diagnosis — 2026-10-08

The catalog remediation received a clean targeted review at `2a5ed85bc`.
A fresh component pre-run checkpoint was captured twice identically, preserving
the historical checkpoint and its three auth-table differences. All 183 tables,
including auth, and all five fields must remain unchanged during every run.
This is not permission to replace a baseline after a failed fixture.

The first actual normal attempt failed after completing the nine-member matrix
(61 SDK requests; final HTTP200). Exact teardown and whole canonical preservation
passed, with zero disposable resources remaining. Its overall duration exceeded
the unchanged 900-second total bound. The inherited primary failure stage was
not exposed, so its precise cause remains unknown; this is not native acceptance.

A small source remediation adds fixed-enum inherited-stage/deadline diagnostics
and checks the existing total budget before and after inherited native proof
phases. Cleanup and canonical-after inspection remain unconditional and outside
that work budget. No deadline, fixture, assertion, restoration policy or transport
limit is relaxed. Independent targeted review and a fresh normal/two-forced run
against the same preserved checkpoint remain required; the PR stays draft.
