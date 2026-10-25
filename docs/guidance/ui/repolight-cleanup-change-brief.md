# RepoLight cleanup adoption

2026-10-24 · Bounded extension of existing deletion dialogs.

Reference owners: `ClassroomPurgeDialog`, `StudentPurgeDialog` and the selected
assignment's existing `ConfirmDialog` in `TeacherClassroomView`. Retain the current
irreversible warning, typed classroom/student confirmation, danger action, modal
focus/Escape behavior and saved-operation recovery. Do not create a new cleanup
shell, shared primitive or automatic destructive action.

| Need | Existing candidate | Decision | Reason |
| --- | --- | --- | --- |
| Classroom cleanup reservation | `ClassroomPurgeDialog` | extend | Additive server eligibility can permit explicit reservation while final deletion remains unavailable. |
| Removed membership cleanup waiting | `StudentPurgeDialog` | extend | Display the server's known remote-report wait state beside existing progress; unknown scope blockers stay blocked. |
| Assignment delete confirmation | Existing `ConfirmDialog` and handler | extend | Keep a pending remote-cleanup response visible and retry the same explicit operation ID; close only on verified success. |
| Confirmation inputs/buttons/status | `FormField`, `Input`, `Button`, dialog owners from `@/ui` | reuse | Existing semantics, target sizes and focus treatment already govern this flow. |

Primary signal: existing textual progress and danger action. Pending remote-report
cleanup means local deletion has not completed. Keep `deletion_available=false`
visible in that meaning; `can_reserve_cleanup=true` permits only the explicit
confirmed reservation workflow. Unknown/cold unsupported scopes remain blocked.
Reads and renders must not mint operation IDs, reserve or advance deletion.

Assignment retry identity and any revision guard must follow the server-owned
request/response contract. A pending409 must never close the dialog, remove a row,
navigate to summary, send feedback, grade or claim success. Retrying must replay the
same target-bound operation; a changed target invalidates old responses. Closing a
dialog must not turn a later response into completion for another target.

Required verification: teacher, desktop1440×900/mobile390×844, light/dark; typed
confirmation empty/exact, eligible reservation despite finalization blocked,
remote pending, explicit retry, uncertain response/replay, hard blocker, completed,
owner/target change and keyboard focus/Escape. Student role: no new deletion UI;
verify the existing access boundary. Root owns screenshots against the current
production dialog references before final acceptance.

Composite review: existing dialog/input/button owners are reused. Focus and state
semantics need focused interaction tests; no new composite keyboard model is added.
Only exact server-declared waiting/eligibility states are actionable. This brief
adds no API, migration, provider, publication or deletion authority beyond the
already confirmed feature workflow.

## Approved report-only removed-membership boundary

Root approved a separate `Remove repository reports` action. The production owner
is `TeacherRosterTab`'s existing rightmost More actions menu. Read-only paginated
`GET /api/teacher/classrooms/[id]/repolight-cleanup` must confirm removed targets
before the action appears. Every page is authorized; any failed/repeated page
invalidates the whole projection. There is no automatic reservation or advancement.

`StudentRepositoryReportCleanupDialog` composes existing `ContentDialog`,
`FormField`, `Select`, `Input` and `Button` owners (`reuse`); the roster menu action is a narrow feature extension (`extend`). The feature-owned report-only
presentation is a domain component (`create`), composed from those existing owners;
it is not a new shared primitive or provider framework.
No generic student purge UI is revived. The explicit report-only operation uses
`scope:repolight_only`, `academic_preserved:true` and Pal/Bara `out_of_scope`.
Those fields say other providers are untouched, not absent. Completion means
repository reports removed; it never means academic data removed, full classroom
cleanup completed or rejoining authorized. Its callback refreshes report discovery
only, independently of the existing full cleanup completion callback.

Pattern Lab: `/pattern-lab?role=teacher#repository-report-cleanup`, selector
`#repository-report-cleanup`, action `Preview report cleanup`. It renders the real
feature-owned dialog content with fixed synthetic pending/completed states and no
API/provider calls. Root owns final desktop/mobile light/dark screenshots.
