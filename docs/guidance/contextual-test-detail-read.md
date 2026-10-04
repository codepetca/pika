# Contextual owner Test detail read

Status: draft-review source candidate on `codex/contextual-test-owner-detail-read`, based on
verified main `7c8fd90e25645b49288ca41be5675d244118d007`. No runtime or PR acceptance
is claimed yet. Local/main schema001–243; production last verified001–225 remains
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

These source relationships are not proof that the installed SDK executes the
proposed bounded embedding correctly. Actual disposable-local evidence must
cover nonempty and terminal-empty question, draft and reference results. If the
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

## Source-only proof preparation

A sibling runner may reuse the original sealed Assignment lifecycle, project
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

Source checks:59 app/new-route/legacy-route tests and30 offline proof tests pass;
the proof worker's151 checks include four unchanged original proof suites. Root's
frozen candidate focused run197 tests/14files, architecture, UI/design policies,
TypeScript and lint pass. Audit covers all eight changed TypeScript files.
These are source/offline receipts only; actual disposable SDK/cleanup evidence
and independent fixed-head reviews remain pending.
