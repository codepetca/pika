# Contextual Test owner inspection, manual grading and return

## Scope and status

Source preparation follows the merged learner workflow (#1561) on main
`517d272abd0090e598092f1fa1bdf5d28b9bf13f`. This is a dormant batch-2 workflow
group, not an activation, deployment or phase exit. It keeps five existing URLs:

- GET `/api/teacher/tests/[id]/results`
- PATCH `/api/teacher/tests/[id]/responses/[responseId]`
- PATCH `/api/teacher/tests/[id]/students/[studentId]/grades`
- POST `/api/teacher/tests/[id]/clear-open-grades`
- POST `/api/teacher/tests/[id]/return`

Selected learner inspection already uses the results payload. Do not add an
owner attempt GET or include unsubmit, attempt deletion or new UI in this group.

## Authority

Reuse the shared classroom-experience admission contract. Admission selects a
server path, not a permission. Absent or valid-unmatched configuration retains
the legacy path and its historical role checks; malformed configuration fails
closed. Once admitted, errors never fall back to legacy authorization.

Each contextual database operation must independently prove the current owner,
fixed Test parent and required current nonowner roster. Historical teacher or
student account roles are not relationship authority. Include teacher-account
members in results; exclude the owner self-enrollment, removed and foreign
members from every identity, answer, focus and aggregate projection. Mutation
selections must reject those excluded subjects, not partially accept them.

Reuse the existing owner transaction protocol, managed-storage protocol share
lock, Test advisory lock, Classroom purge and membership-change locks and
current Classroom/Test locks. Owner/parent transfer, archive, purge, maintenance
and membership drift cannot be authorized by an earlier route preflight.
Archived results inspection remains compatible; writes reject either Classroom
archive or Test blueprint archive. Draft grading/return remains invalid.

## Preserve existing grading semantics

Reuse `save_test_response_grades_with_provenance_atomic`,
`clear_test_open_response_grades_atomic` and
`return_test_attempts_checked_atomic` inside the authorized transaction. Do not
replace their writers or directly update grade/return rows from the server.

Manual saves keep response revision CAS, question/subject binding, score bounds,
all-or-nothing batches and signed AI-provenance verification. Omitted suggestion
metadata preserves it; explicit clearing removes it. Existing review triggers
own final outcomes and do not increment revisions for metadata-only changes.
Accepting an existing signed suggestion authorizes no provider operation.
Clearing an answered multiple-choice score preserves the inherited normalized
zero; open-response clears remain null. An internal, exact clear-target witness
comes from locked current responses/questions before the existing writer. The
server validates it and the saved rows, then omits it from the public envelope.

Clear-open requires the complete expected current open-response set and its
revisions; multiple-choice grades stay untouched. Clearing a required grade
revokes incomplete return atomically. Editing a still-complete returned grade
does not revoke return or add a second publication step.

Return requires effective closed access for every selected current member. A
globally closed Test may finalize unfinished attempts under the inherited
contract; a per-member return must not close the global Test. Only complete
finite current-question scores are eligible. Zero counts; incomplete work is
skipped. Replay counts already-returned work without restamping it. The existing
return review trigger must remain authoritative.

Queued/running Test AI runs block contextual manual-save, clear and return
atomically under the existing shared Test advisory key. Completed/failed history
does not block them. Do not start, stop, delete or modify AI runs here. Results
may monitor the existing narrow active-run summary only with current-roster-safe
projection; no provider payload or removed-member error identity is disclosed.

## Reads and failure contracts

Results derive from one coherent, bounded transaction rather than unbound
service-role reads after inspection. Preserve the existing public response,
question ordering, draft monitoring, finalized response revisions, status/access
precedence and aggregate calculations. Project only existing public fields;
answer keys, sample solutions, provider credentials and private provenance/review
records must not appear just because internal source rows contain them.

Keep the current overall deadline, finite statement/row/body/byte bounds,
abort signal and exact actor/resource/operation witnesses. Oversized or incomplete
sources fail closed rather than returning a silently partial roster. Validate
mutation acknowledgement subjects, counts and revisions before HTTP success.
An ambiguous mutation is never retried automatically.

Results measure expanded, JSON-escaped projected rows before aggregation, with a
1 MiB source budget, 2 MiB result budget and 4,000,000-byte full witness budget.
The existing RPC declares an eight-second `statement_timeout` for PostgREST
transaction hoisting. Native acceptance must verify the actual schema cache and
hoisting configuration, cancellation and backend settlement; this source setting
alone is not that evidence. Direct SQL proof frames set the timeout before their
top-level statement. Compressible and JSON-escape-expanded inputs must both fail
closed at the logical source budget.

Authentication, invalid input, forbidden relationship and missing-resource
responses remain distinct. Fixed-parent/source/revision/contention and active-AI
conflicts return409; missing schema, malformed acknowledgement, timeout or
unrecognized transport failures return503. Do not expose SQL/provider details.
Keep hosted-safe `PT409`, not retryable `40001`, for business conflicts.

Learner disclosure remains the accepted workflow's existing availability/status
and returned-work rule. There is no new `show_results` gate. Clearing an incomplete
returned grade retracts item/aggregate eligibility under existing rules.

## Acceptance and holds

Source tests must cover admission dispatch, every historical account role,
current nonowner roster, exact public projections, mutations and provenance,
return/clear semantics, malformed acknowledgements and no retry/fallback.
Actual disposable full-chain replay, service-only ACL/search-path verification,
SDK/PostgREST requests with abort signals, revision/review trigger behavior,
late-fault rollback and both relevant contention orders are separate required
evidence. Mocks and source seals alone are not native acceptance.
The no-question return proof uses a separate, initially empty synthetic Test in
a rollback scope; it never deletes or unlocks started questions. The finite
grading proof also exercises answered-MC single clear, mixed clear/edit batches
and complete versus incomplete returned-work behavior with ordinary triggers.

Reuse existing finite verification machinery. No new permission framework,
per-route rollout flags, database tables or verification platform are needed.
Generated database types must come from the actual CLI, never a handwritten
claim about replayed schema.

Canonical local249+, production259+, reset/seed/history repair, promotion,
account/plan changes, provider/AI/billing work and quota/admission/home/page/cohort
cutover remain held. Prior native permissions are consumed; another actual
rehearsal needs fresh exact-source disposable-target authority. Ordinary source
implementation, independent review and protected main PR merge are authorized,
but merging still requires the complete evidence and final-head CI/PR Gate.

## Disposable evidence — 2026-10-11

The single approved rehearsal at `08389a934` completed migration history001–258,
then its rollback-proof SQL child failed before type generation, the closed
engine or genuine SDK acceptance. Exact owned teardown, global inventory/ports
and whole canonical rows/settings/cron/resources checks passed. Native acceptance
is **not** established. The driver discarded PostgreSQL stderr, so the actual
cause is unknown; source inspection is not a substitute diagnosis. Bounded,
mode600 private failure capture is being prepared and independently reviewed.
The attempt consumed its permission. Another run needs fresh exact-source and
disposable-target authority; shared local, production and activation holds remain.

The fresh approved `993c62949`/`pika_assignment_list_bd4b1eb551ad` attempt also
passed complete001–258 replay but failed rollback verification. This time bounded
private mode0600 stderr capture confirmed the invalid parent-move fixture at
`scripts/check-contextual-test-owner-grading.sql:268`: it changes classroom_id
without changing the gradebook category, and the retained147/207 trigger correctly
rejects that cross-classroom category. The intended PT409 assertion is not reached.
The private SDK parentApply/Restore setup has the analogous source issue; it was
not executed. Correct those fixtures using matching existing categories and exact
restoration, never weaken the product invariant. Exact owned cleanup, global
inventory/ports and whole canonical preservation passed again. Native acceptance
remains absent; permission is consumed, no retry occurred and the gate is inert.
Types/closed-engine/SDK/cancellation still need evidence after source correction,
focused checks, targeted review and fresh exact-source disposable permission.

The source correction uses a strictly selected existing destination default
category while moving the Test parent. Its nested PT409 rollback then compares
the full original Test row, including category and timestamp. Private SDK setup
requires both default-category baselines, moves parent/category together and
restores the original default category. A captured before/after academic graph
assertion verifies the exact original category identity and unchanged category/
work rows even after an Apply failure. Only the fixed Test's valid `updated_at`
is omitted from that committed comparison because the retained039 trigger always
updates it; no other Test field or graph row is omitted. Pure corruption tests
and the injected SDK driver reject an incorrect restored category. These are
source/mock checks, not native SQL execution or acceptance. The entry gate stays
inert; no fresh rehearsal, shared-local/production write or rollout is authorized.

Current source integration preserves main's independently sealed migration258
student session-status projection and renames the unchanged owner grading SQL
to259. Complete-chain guards must verify both exact tails; prior001–258 native
receipts remain historical, not evidence for the new001–259 candidate. The
fixture correction changes proof setup, not product authorization or triggers.
Main79a6f7994 records another task's separately approved production001–258
application and polling release; this task performs no production operation.

The fresh approved `cebc37d9d`/`pika_assignment_list_aee0568126a9` rehearsal
passed complete001–259 history, corrected product rollback/ACL contracts and
genuine CLI types identical to the committed generated types. It then stopped
in the private SDK `startLearners` setup: a hard-coded draft revision1 assertion
observed19. Migration244 allocates revisions from a global sequence; rollback
proofs do not reset sequence allocations. The driver must validate and capture
the actual safe positive revision, not require1 or reset the sequence. This
does not establish a product defect. Closed-engine contracts, remaining owner
SDK cases and cancellation were not reached; native acceptance remains absent.
Exact owned teardown, global inventory/ports and whole canonical preservation
passed. Permission is consumed, no retry occurred and entry gates are inert.
No shared-local/production database, deployment or activation operation occurred.

The authorized source-only driver correction now validates a positive safe
integer and retains the exact product revision in the frozen observed attempt.
Regression mocks reproduce revision19, preserve19/37 and1/MAX_SAFE_INTEGER
through the closed-engine preparation manifest, reject seven invalid forms for
either learner, and prohibit a second Start dispatch after success or failure.
The existing full mock SDK/restoration path also starts at19/37. No sequence,
SQL, product writer, identity binding, cap or execution gate changed. These checks
do not establish native acceptance; a new rehearsal needs fresh exact-source
and target permission after targeted review.

The fresh approved `a3c5b389a`/`pika_assignment_list_ef9c8ece7a72` rehearsal
passed complete001–259 history, product rollback/ACL contracts, genuine CLI
types identical and the closed-engine privilege/restoration/rollback/held
schedules. It stopped during SDK acceptance in `rosterRestore`: the bounded
private diagnostic is `pal_membership_generation_closed`. The fixture commits
enrollment deletion, then attempts to insert the same enrollment id. Retained168
marks the membership generation removed on DELETE and deliberately forbids
reactivation of that id. Do not weaken this product privacy/lifecycle invariant.
Correct the scenario's lifecycle-aware fixture and restoration design before
targeted review and another fresh exact-candidate rehearsal; source mocks did
not model this trigger effect. Remaining SDK acceptance, observed PostgREST
hoisting and cancellation were not completed. Exact owned teardown, global
inventory/ports, whole canonical rows/settings/cron/resources and sourcefreeze
passed; cleanupFailures is empty. Permission is consumed, entry flags are inert
and all seven private hashes match reviewed sources. PR1569 remains draft;
the overall goal remains paused. No automatic retry, source correction, shared
local/production database change, deployment, account/provider or activation
operation occurred in this attempt.

## Task-scoped workflow authority — 2026-10-11

The owner explicitly delegated reasonable approvals to accelerate this task.
Implementation/fixture corrections, offline checks, isolated disposable
rehearsals, review extensions, draft publication and normal protected main merge
may proceed without repetitive approval prompts. Each disposable attempt still
requires a fresh exact source/target binding, accepted immutable preflight,
exclusive execution and settled cleanup evidence; consumed receipts are never
reused. This does not relax product privacy/security invariants, independent
review, required CI/PR Gate, or exact-target authorization for shared local or
production migration application. Deployment, provider/account/plan operations
and admission/home/page/cohort/cutover activation remain held. Escalate material
product decisions or credible exposure/data-loss risk rather than auto-approving
them. This is a task-specific authority record, not a global repository policy.

The source-only roster fixture correction now reenrolls with one fixed fresh
generation after a committed deletion, preserving the original removed identity.
Uncommitted deletion restores nothing and leaves the exact original active row.
Full18-table graph equality accepts only the exact enrollment ID replacement,
old active→removed state and one scoped active successor with a valid novel
opaque Pal reference. It retains all academic work, timestamps, attendance marks
and non-target identities; it never reopens/deletes retained identity evidence
or invokes maintenance bypass. Operational archive revision counters continue
advancing through their ordinary triggers and are not reset. Regression mocks
reproduce the old generation-closure failure, reject16 lifecycle/work corruptions
and cover precommit Apply, committed postguard failure and failed Restore.
Existing SDK denial, transport, cancellation and settlement checks remain;
success uses31/32 fixed frames. Product/schema/generated types are unchanged.
These are source/mock checks only; targeted review and genuine native evidence
remain required before readiness.

## Native acceptance — 2026-10-11

The subsequent exact `d714cb2f4e6b72303a1a5d14140f5aaa500c8754` rehearsal on
`pika_assignment_list_01067ea3558c` passed with `nativeVerified:true` and no
cleanup failures. Complete001–259 history, rollback/ACL contracts, genuine CLI
types identical, closed-engine privilege restoration and held schedules, real
SDK owner grading/clear/return/disclosure and six committed authority denials,
PostgREST hoisting and actual8s57014 cancellation all passed. Cancellation
preserved the whole fixture, restored the catalog and left zero RPC backends.
The roster scenario restored its precise allowed fresh-generation successor,
preserving retained removed identity evidence and all academic work.
Exact owned teardown, global inventory/ports and whole canonical app database
rows/settings/cron/resources preservation passed. Entry flags are inert again;
all seven private hashes match reviewed source. Prior failed attempts above are
retained history and are superseded for acceptance by this successful run.

Native evidence applies to the exact tested source; subsequent factual
documentation needs its own delta review and byte-equivalence check before
reuse. Required stable-head CI/PR Gate and normal protected main merge remain.
No shared-local/production migration, deployment, account/provider or cohort/UI
activation occurred. Batch2 and the overall goal remain open; authenticated
signed-manual-provenance token-route coverage belongs to the later integrated
application rehearsal, not the seeded-metadata proof.
