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

Reuse existing finite verification machinery. No new permission framework,
per-route rollout flags, database tables or verification platform are needed.
Generated database types must come from the actual CLI, never a handwritten
claim about replayed schema.

Canonical local249+, production257+, reset/seed/history repair, promotion,
account/plan changes, provider/AI/billing work and quota/admission/home/page/cohort
cutover remain held. Prior native permissions are consumed; another actual
rehearsal needs fresh exact-source disposable-target authority. Ordinary source
implementation, independent review and protected main PR merge are authorized,
but merging still requires the complete evidence and final-head CI/PR Gate.
