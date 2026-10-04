# Contextual owner Test detail read

Status: PR1468 draft on `codex/contextual-test-owner-detail-read`, based on
verified main `7c8fd90e25645b49288ca41be5675d244118d007`. The finite disposable SDK
mechanism passed at `ba42f662c581e2265cb794cd365487a897060829`; final cumulative
review, stable-head CI and normal merge remain pending. Local/main schema001–243;
production last verified001–225 remains
untouched. No new migration is planned unless actual query evidence demonstrates
the existing relationships cannot enforce the boundary.

## Scope

Only GET `/api/teacher/tests/[id]`: allow an admitted current classroom owner to
read Test detail regardless of their global account role. Owner precedence is
retained when the owner is also enrolled. Membership, a teacher-valued label or
a paid subscription alone does not authorize this owner-only disclosure.

Existing shared classroom-experience admission is the dormant entry contract.
Absent or non-admitted configuration retains the unchanged legacy GET. A present
malformed configuration fails closed after authentication and before discovery.
Admission grants no relationship, account role, feature entitlement or quota.
No additional Test-specific pilot gate or cohort activation is introduced.

Current ownership and fixed Test/Classroom identities must bind every payload,
child page, terminal-empty page and final read. Strict returned identities,
relationship cardinality, payload/row/statement limits and a bounded deadline are
required. This statement-bound contract is not a transaction snapshot or instant
revocation of previously delivered data. Archived or hidden-Classwork owner
inspection remains compatible with the existing detail GET.

## Existing query relationships

- Questions join the requested Test through `test_questions_test_id_fkey`.
- Drafts join through the Test's Classroom and
  `assessment_drafts_classroom_id_fkey`, with exact Test type/assessment identity.
  There is no direct Test-to-draft foreign key; require at most one matching draft.
- Managed document references join the requested Test through
  `managed_storage_json_references_test_id_fkey` and the object's composite
  `managed_storage_json_reference_identity_fkey`. Bind the current document JSON,
  reference, object, Classroom, bucket/path, purpose and ready/provisional state.

Actual disposable-local evidence now covers nonempty and terminal-empty questions
and references, plus empty/nonempty drafts, through the installed SDK's bounded
embedding. Source relationships alone remain insufficient evidence. If the
embedding cannot preserve required authority/cardinality, use a separately
reviewed additive owner-read RPC rather than reverting to unbound child reads.

## Compatibility and exclusions

Preserve the existing response shape, canonical closed-Test questions,
draft-only overlays, portable question identities, ambiguous-identity conflict,
and owner-only answer keys/solutions/stored cache fields. Reading stored cache
data does not invoke an AI provider. MIME evidence affects document rendering;
do not silently weaken the existing private-object or historical public-bucket
boundary to reuse an unbound metadata helper.

Test list, create, edit, draft repair, reorder, learner participation/results,
grading/jobs, file delivery and all UI remain outside this slice. In particular,
GET `/draft` calls an ensure helper that can create or repair records and requires
a later transactional owner boundary. No signup, plan, billing, production,
admission, provider, home or cutover activation is included.

## Acceptance

TDD and route regressions must cover both global-role owner labels, owner/member
precedence, member/outsider denial, invalid admission/identities, cross-resource
and child substitution, ownership loss/reparenting between pages, malformed or
oversized results, pagination completeness and timeout. Contextual failures may
not fall back to legacy authorization. Preserve legacy dispatch and portable
question/draft/document compatibility tests.

Require actual finite disposable-local SDK query evidence, exact owned teardown
and unchanged canonical baseline before treating the mechanism as verified.
The original sealed observer/platform/fixtures/SQL allowlists/restoration/cleanup
are not expanded silently by this preparation. Accept any new frozen finite
fixture/transport manifest independently before runtime. Then complete focused
checks, risk-matched independent review and stable-head CI/normal main merge.
No broader assessment-phase or rollout completion follows from this one slice.

## Finite proof contract

A sibling runner reuses the original sealed Assignment lifecycle, project
identity, resource discovery, original cases/revocations/restoration and exact
teardown. Only its separately hash-bound extension setup and finite Test/Storage
request manifest are new; the original SQL allowlist and native machinery remain
unchanged. Complete canonical fingerprints stay outside the app request budget.

The prepared ceiling is four disjoint actors, two Classrooms, four Tests, four
persisted questions, two drafts and two fixed68-byte PNG objects:64KiB extension
SQL,256 network requests,16 Storage requests and the existing15-second per-request
timeout. The app deadline is not increased. Preserve fresh full resource closure,
168/169 controls, all five rollout settings groups OFF, private buckets, no
grading/provider/Vault work and only the existing harmless cron predicates.

Reserve, upload without overwrite, verify and attach the exact managed Test
objects using existing protocols. Never rebuild global managed references or
insert ready records manually. Both forced modes must complete the full extension
setup before the original failure checkpoint. Source/unit tests alone do not
authorize runtime or establish actual query/metadata/teardown evidence; independently
review and explicitly accept the frozen manifest before any live run.

Source checks:60 app/new-route/legacy-route tests and30 offline proof tests pass;
the proof worker's151 checks include four unchanged original proof suites. Root's
batch1 candidate focused run198 tests/14files, architecture, UI/design policies,
TypeScript and lint pass. Audit covers all eight changed TypeScript files.
Those counts are source/offline receipts, distinct from the actual runtime
receipt below. Initial and targeted source reviews are complete; final cumulative
review, stable-head CI and merge remain pending.

Initial review of68064c63 was security-clean; compatibility requested explicit
copied-question source identity/populated-cache coverage and a current handoff.
Batch1 adds the contextual regression (three distinct identities, exact retained
cache fields, no external fetch/RPC capability) and updates continuity. The
finite proof/app implementation bytes remain unchanged. Targeted compatibility
review ofba42f662 is clean; root accepted the independently reviewed finite
generator/request manifest before any execution.

## Actual disposable-local receipt

Atba42f662, the normal run completed all eight actual SDK cases at14:10:32Z on
2026-10-04: both global-role owners, owner/member precedence, empty Tests, draft
overlay/portable IDs, closed canonical questions, exact managed MIME and null-MIME
Storage.info, and member/cross-class-owner denial. It also completed the inherited
cases/revocations/restoration, exact owned teardown and whole canonical closure.

Both `after-fixture` and `before-capture` forced runs completed the full extension
setup (including both fixed68-byte PNG uploads) before their failure checkpoints.
They returned expected exit1 and exactly two closed failure/cleanup markers,
with exact owned teardown and unchanged canonical closure. A separate wx0600
baseline captured once before runtime matched all five fields after the normal
run and each forced mode: canonical public/private/Storage rows,168 metadata,
settings, cron and resources. Forced receipts completed14:13:20Z and14:15:53Z.

No source bytes changed during the three runs; no canonical DML, new migration,
production, admission, account, billing or provider action occurred. These are
helper/SDK mechanism receipts, not authenticated HTTP/session/browser, concurrent
revocation, historical public-bucket positive runtime, phase-exit or rollout proof.
Copied source-lineage IDs/populated cache and archived compatibility are unit
covered, not additional claims about the eight actual fixture cases.
