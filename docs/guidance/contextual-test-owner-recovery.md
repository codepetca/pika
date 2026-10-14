# Contextual Test owner recovery and attempt reset

This dormant workflow group covers three existing endpoints, with no screen or
rollout-control change:

| Endpoint | Operation | Existing public result |
| --- | --- | --- |
| `POST /api/teacher/tests/[id]/unsubmit` | Unsubmit selected learner work | Unsubmitted, skipped and skipped-enrollment counts |
| `DELETE /api/teacher/tests/[id]/students/[studentId]/attempt` | Reset one learner's work | Deleted attempt, response, focus and AI-item counts |
| `POST /api/teacher/tests/[id]/students/attempts/bulk-delete` | Reset selected learner work | Success, requested/deleted-subject counts and the four row counts |

The shared complete-experience admission contract chooses the contextual path.
Absent or unmatched admission retains the legacy route. An admitted request never
falls back after an authorization, schema, transport or acknowledgement failure.
Classroom ownership, not the historical account-role value or Test creator,
authorizes the contextual owner operation. A self-enrolled owner is not a learner;
current nonowner members participate regardless of their historical role.

## Transaction contract

Reuse the existing seven-argument service-only `test_owner_workflow_v1`, the
current owner lock/fence protocol and migration244 attempt lifecycle writers.
No browser database access, permission framework or per-route rollout flag is
introduced. Each mutation proves the current owner, live actor, fixed parent,
Test source and current nonowner selection under the existing locks. Classroom
and Blueprint archive, membership change, purge/maintenance and queued/running
AI work remain mutation fences. Inspecting authority is not sufficient on its own.

Unsubmit keeps saved draft answers but deletes the selected learners' finalized
responses for subjects with attempts and clears submission, grading closure and
return state. Orphan finalized responses without an attempt retain the inherited
no-attempt behavior. It does not
reopen access or unlock started-Test questions. Preserve the existing partial
selection behavior: missing members are skipped; no eligible member is an invalid
selection. The bounded plan/final transaction pair binds eligible IDs and every
observed attempt's ID, draft revision and raw responses. A changed source is a
conflict, not permission to overwrite newer learner work.

The server builds normalized `teacher_unsubmit` snapshots and existing metrics.
History insertion is fenced within the final transaction, not performed through
an unfenced post-RPC table write. A history-only nested exception scope preserves
the existing best-effort contract: history failure must not roll back or misreport
successful unsubmit. The baseline inserts share one savepoint: one insertion
failure removes all newly inserted baselines, not the successful unsubmit.
Authority, validation and attempt mutations are outside that
exception scope. History counters are internal acknowledgements, not new UI copy.

Reset requires every requested subject to be a current nonowner member. A mixed
invalid selection fails without deleting valid subjects. Reuse the established
writers for exact selected attempts, their cascading history, finalized responses,
focus events and historical AI items. Preserve no-work replay and row counters;
do not delete availability, Test questions/documents or unrelated learner work.
Restart after reset must receive a fresh attempt/revision; old saves cannot bind it.

Use the established finite request/body/SQL/acknowledgement budgets, at most100
selected identities, exact operation/actor/parent witnesses and strict counter
validation. Do not retry mutations or compensate uncertain acknowledgements.
Returned-results disclosure remains governed by the existing learner transaction;
unsubmit/reset retract the relevant returned work without introducing a new
`show_results` policy.

## Acceptance and remaining scope

Source preparation is not native verification. Before readiness require focused
route/service/validation tests, real disposable full-chain SQL and SDK checks,
rollback/ACL/CAS/contention, actual cancellation and settled backends, complete
fixture preservation/restoration/cleanup, independent security/compatibility
review, then final-reviewed-head CI and PR Gate. Reuse the existing finite native
engine; mocks establish only offline behavior. No shared or production migration,
provider operation or activation is implied by disposable acceptance.

Unpublish, whole-Test deletion, legacy screen adoption, Surveys, Gradebook/returned
Grades, existing grading-job authorization and integrated release proof remain
separate work. Completing this group does not finish Tests, batch2 or the goal.
Teaching/Joined, page/cohort admission and cutover remain dormant until the
foundation and integrated release gates are complete.
