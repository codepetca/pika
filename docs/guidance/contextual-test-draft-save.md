# Contextual owner Test draft saves

Status: implementation in progress; no activation or phase exit. Coordinator
starts from main `c25ebf78f` on 2026-10-05. PR #1473 is merged; Audit #1474
retains migration 248, while draft GET retains immutable 247. Production's
recorded schema is 001–248; shared admission/home/page/cutover/billing stay OFF.

## Scope and compatibility

Prepare only the admitted branch of `PATCH /api/teacher/tests/[id]/draft`.
Authenticate through the existing complete-experience contract before parameter
or body discovery; leave unconfigured/unadmitted legacy PATCH byte-for-byte.
Both historical role values can save only as the current active classroom owner.
Membership, plan and former ownership cannot confer authoring rights.
No direct-table, missing-RPC, nontransactional or Storage fallback is permitted.
No UI, subscription, provider, account or production activation is included.

GET owns draft initialization/repair. An absent draft or invalid draft-status
baseline yields verified 409/reload without PATCH writes. Existing editors GET
before editing and accept a bare conflict response. This narrow contextual
contract does not change legacy PATCH's hidden initialization. Patch takes
precedence when both patch and content are supplied, preserving the editor
transport. Full content and RFC6902 operations remain bounded, strictly decoded,
and canonicalized before persistence; client snapshot metadata is never authority.
The full-content boundary explicitly bounds and strips the active editor's
question `test_id`, `position`, `created_at` and `updated_at` transport fields.
They cannot confer parent, ordinal or stamp authority; unrelated unknown fields
remain invalid, and canonical SQL candidates never contain transport metadata.
Existing marked stored drafts retain GET's normalization compatibility for
unknown legacy fields and omitted optional question values. The SQL baseline
check is separate from strict incoming candidate validation: reloading cannot
repair a valid historical row that GET deliberately only inspects. Unmarked
pre-134 storage compatibility remains outside the native current-schema claim.

## Transaction interfaces

Two service-only entrypoints, private helpers uncallable by application roles:

- `snapshot_test_draft_save_for_owner_v1(p_actor_id uuid, p_test_id uuid,
  p_deadline timestamptz) returns jsonb`.
- `finish_test_draft_save_for_owner_v1(p_actor_id uuid, p_test_id uuid,
  p_classroom_id uuid, p_expected_source_sha256 text, p_expected_version integer,
  p_operation text, p_content jsonb, p_documents jsonb,
  p_update_documents boolean, p_deadline timestamptz) returns jsonb`.

Snapshot is the 247 source envelope with the `test` projection extended by raw
`documents` and `updated_at`; its distinct SQL-owned digest covers those fields.
Final operations are only `inspect` and `save`. `p_expected_version` may be null
only for inspect when no draft exists. Inspect accepts null content only for a
reload without a valid baseline. Save requires a present valid draft/version.
Final returns `{version:1, actor_id, classroom_id, test_id, operation, draft,
test, editingPolicy}`; draft is nullable only for reload. Test is the same explicit
bounded snapshot Test projection, not unrestricted `to_jsonb(tests)`.
Public success remains `{draft,test,editingPolicy}`. Conflict may include a
verified current baseline only; never perform an unguarded latest-draft read.

Use 247's current-owner/fixed-parent/advisory/purge/Class/Test/Draft/revision
locks and a new PATCH source digest. Final checks source and document CAS, then
calls SQL 134 `save_test_draft_atomic`, never its fallback/Storage-dispatching JS
wrapper. Preserve 220's durable started-Test correction guard. Verify actual
post-trigger draft/Test/question graph, owner/lifecycle, stamps and revision
effects inside the same transaction; invalid effects or expiry must roll back.
Existing managed-reference and durable cleanup-queue effects are permitted
only within the inherited exact identity/classroom contract and must be proven.
Even a no-doc save can run UPDATE OF documents triggers; do not claim zero
managed-reference writes. No Storage API or immediate deletion is authorized.
Existing URL-only upload representations remain raw source/CAS authority for
no-document saves. Newly authored uploads require a validated managed identity;
their retained PDF MIME is bound to the managed object's authoritative type.
Exact retained server link snapshots use the execution-snapshot purpose, not
the newly authored upload purpose. Caller snapshot fields cannot grant access.

The inherited managed-storage writer revision sequence is an operational
invalidation watermark: PostgreSQL sequence increments are not transactional.
It can advance in the disposable fixture even when rejected writes roll back.
Zero rejected-save data effects means exact TABLE-row/Storage equality, not a
claim that this existing sequence value rolls back. Canonical controls and
baseline still must be unchanged; no sequence is reset to manufacture equality.

Preserve 10,000-question/2MiB-content/8MiB-envelope/64MiB-total ceilings, at most
two RPCs under one 20-second deadline, phase clock checks and bounded lock waits.
Raw 42501 and unknown schema/capability states fail 503. Closed PT403/PT404/PT409
map to caller states; contention is bounded 409 without retry. Do not weaken
normal error gates or claim function-local statement_timeout physically cancels
an outer server statement. Candidate/document/portable identity constraints must
also hold in SQL, not only in TypeScript.

## Acceptance and ownership

Coordinator owns integration, continuity, generated-type installation, Git/PR,
independent review and main merge. Application worker owns new validator/helper,
PATCH dispatch and focused API/helper tests. SQL worker owns only the additive
migration and its offline SQL-contract test. Proof worker owns additive finite
PATCH fixtures/lifecycle/SQL/native driver and their tests; original Assignment
and GET fixtures/guards/caps remain unchanged. Workers do not delegate or operate
Git, production, shared database, Docker cleanup or rollout settings.

Before readiness: offline matrices; installed SDK cases including >1,000 source
rows and documents; real post-trigger rollback and two-session races; genuine
isolated CLI-generated contracts; normal and both deterministic forced-cleanup
proofs; the SAME captured canonical baseline; focused/static checks; independent
high-risk review; stable reviewed SHA and exact-head CI/PR Gate. A component merge
does not complete assessments, full experience or the goal.

### Frozen proof-source proposal

The separately bounded PATCH transport has 24 installed-SDK cases (11 saves,
five verified conflicts, seven ownership/lifecycle denials and one foreign-upload
400): exactly 41 RPCs plus one restored raw-42501 privilege probe, with a 64-RPC
ceiling and zero Storage requests. The inherited GET's limits are unchanged.
Additive SDK/SQL setup totals seven actors, five classrooms, 16 Tests, 1,010
questions, 11 drafts and four managed identities; bounds use 10,001 separately
sealed rollback-only question IDs. Sixteen two-session schedules retain the
180-dispatch, 200-action and 4,000-control limits. The inherited disposable
engine still owns only five containers, two volumes and one network.

Offline proof checks passed 90/90. Real execution, types and cleanup receipts
remain pending. Earlier mock timeout and source-hash drift failures are retained;
only the offline test timeout changed, not runtime or source-identity guards.
The coordinator additionally verified 120 application tests after a RED/GREEN
canonical locked-policy message regression and 77 continuity/CI checks; suites
overlap and must not be summed as unique coverage. Initial focused run failed
the mock timeout; initial tsc has only the two missing genuinely generated RPCs.

Standing human authority covers in-scope implementation, local migrations,
reviews/extensions and normal main PR merges. Task-stop waiver retains cumulative
review counters; correctness/runtime/provider pauses and production/external
authority remain intact. DeepSeek is paused through 2026-12-31 Toronto.
Weekly account reading at start: 54% remaining; attributable usage unknown.
