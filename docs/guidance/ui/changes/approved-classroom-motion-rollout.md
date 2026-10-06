# Approved classroom motion rollout — 2026-10-05

Owner: chat `01a10bfa-17e1-76d2-9483-af955a51a9fd`; branch
`codex/fluid-motion-rollout`, based on reviewed Daily pilot `b94b27670`.
The follow-up PR targets `main` and includes that reviewed baseline because
eligible repository CI runs only for `main`/`production` PRs. It depends on
#1481; the earlier reviewed PR heads remain unchanged. Review covers the full
main-relative candidate, with the incremental rollout identified separately.
Risk profile: `workspace-state`. Model recommendation: GPT-6.1 Sol — bounded
shared presentation with editor identity, focus and async-owner constraints.

## Human acceptance and scope

The owner answered **yes** to: “Do you approve the Daily motion direction for
wider adoption?” on 2026-10-05 in this chat. This accepts the restrained
200ms Daily inspector direction and its promotion into the shared UI canon.
It authorizes the previously agreed Teacher Classwork/Tests and Student
Classwork rollout. It does not authorize a dependency, merge or deployment.
Exact timing remains owned by semantic tokens, not copied literal durations.

Reference: the approved Daily production-owner disclosure demonstration in
Pattern Lab, `TeacherWorkspaceSplit` with the gapped variant and opt-in motion;
the existing Teacher Classwork/Tests work-surface shell; existing student
Classwork framing. Preserve Attendance table density and current pane geometry.

## Acceptance target

- Surfaces: Teacher Classwork, Teacher Tests grading, Student Classwork and the
  shared Pattern Lab reference.
- Roles: teacher and student. Viewports: desktop 1440×900 and mobile 390×844.
  Themes: light and dark. Motion: normal and reduced.
- States: summary, selected workspace entry, inspector disclosure/close,
  selected student switch, pointer and keyboard resize, focus, editing, refresh,
  failure/Retry, return to summary, changed item/classroom and late responses.
- Primary signal: selected work and its adjacent inspector. Entry may use quiet
  opacity; tables and text must not scale or fly across the screen.
- Controls and navigation respond immediately. No exit delay or timers that
  defer state, focus or content. Reduced motion is immediate. Active controls
  retain their keyboard contract; closed inspector content is inert and hidden
  from accessibility APIs.
- Existing workspace DOM, editor drafts, focus and scroll survive same-owner
  refresh, student switch and resize. Entry must not replay on metadata, typing,
  refresh or resize. Owner changes still clear prior data as required.
- Must not add: whitespace redesign, springs, decoration, animated loading
  loops, new controls, API/autosave changes, parent-tab workspace memory,
  dependencies, unrelated UI canon promotion or snapshot updates without review.
- Composite accessibility review: yes; keyboard, resize, inertness, focus return
  and semantic active/inactive states require evidence.

| Need | Existing candidate | Decision | Reason |
| --- | --- | --- | --- |
| Teacher inspector disclosure | TeacherWorkspaceSplit gapped opt-in motion | reuse | Approved Daily behavior with immediate drag and reduced-motion tokens |
| Classwork table continuity | TeacherClassroomView and TeacherStudentWorkPanel existing pane owners | extend | Keep the primary table outside selected-student panel loading; expose only its existing inspector presentation while preserving controller and three-pane modes |
| Layout-mode controller continuity | TeacherWorkspaceSplit gapped primary slot | extend | `primaryCollapsed` hides/inerts the primary and removes its divider while giving the existing inspector slot full width; the selected controller stays in the same React position across all three modes |
| Teacher workspace entry | Existing workspaceFrameClassName opt-in on Classwork/Tests owners | reuse | Apply quiet entry through the existing frame hook; generic shells and Roster/Gradebook/Survey entry stay unchanged |
| Student workspace entry | StudentAssignmentsTab existing selected-content frame | extend | Apply the same presentation without changing editor keys or routing |
| Shared entry presentation | Existing semantic motion tokens and shared UI boundary | extend | A narrow presentation-only contract for the two real entry adopters; no feature state |
| Reference and promotion | Pattern Lab real split demo/catalog and stable UI canon | extend | Record explicit owner acceptance and keep executable provenance |
| Tests Escape overlay guard | Daily's hidden-overlay-aware guard | reuse | A closed UserMenu must not block inspector dismissal; active overlays and editor typing keep their existing keyboard ownership |

Nearby duplicate feature entrance effects are refactor candidates only. Extract
an owner only when identical entry semantics are needed by the real adopters;
do not move feature loading, selection, submission or grading into `src/ui`.

## Verification and coordination

Required gate: `pnpm check:focused -- --base origin/main --max-workers 1`, UI
and design policy, Pika audit, meaningful interaction tests and both-role
Playwright screenshots/recordings. Measure local transition timing and inspect
intermediate frames; do not claim production INP or a before/after speedup.
Verify the cumulative source with the separately reviewed Student and Teacher
refresh-continuity PRs before goal completion. Keep their reviewed heads intact.

Coordinator owns canon, approval record, Pattern Lab documentation, integration,
Git/PR lifecycle and final acceptance. One GPT-6.1 Sol/high implementation worker
owns production motion, focused tests and browser evidence. Weekly allowance
47% remaining at this phase start; worker/coordinator token and active-time
telemetry unknown. DeepSeek automatic delegation remains paused through
2026-12-31. No recursive delegation. Heavy local checks run serially.

Evidence and final reviewed revision belong to the PR and the task's
`motion-rollout/` artifact directory. This brief records the design acceptance,
not technical completion.

Audit scope note: the scanner flags TeacherTestsTab's existing results fetch
with `cache: no-store`, byte-identical to the reviewed baseline. This rollout
preserves that authoritative grading read rather than introducing request-cache
behavior. Its new changes satisfy the composite-widget coverage check; the
legacy uncached-read report remains explicitly recorded for review.

Independent review batch: preserve the real grading inspector under the same
inner split/frame across Students + grading and Content + grading; hide its
unused primary slot without moving the subtree. Real-control regressions cover
textarea/scroller identity, selection, focus and scroll. Workspace entry is
explicitly applied through the existing scoped owners' frame-class hook.
