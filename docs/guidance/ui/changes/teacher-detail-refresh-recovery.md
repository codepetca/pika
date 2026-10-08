# Teacher assignment detail refresh recovery

Surface: existing teacher Classwork selected-student document/grading inspector. Risk: workspace-state, async-grading. Owner: classroomId + assignmentId + studentId. Scope: feature-owned read recovery, local form continuity and writer/read sequencing; preserve API grading/revision contract.

References: stable teacher work-surface canon and page-state conventions; executable /pattern-lab?role=teacher Page states and Continuous inspector. Coordinator captured and visually inspected both at baseline main5bf3dbac before source work. Evidence: external product-fluidity/teacher-detail-refresh-reference/{page-states.png,continuous-inspector.png,receipt.json}. Actual teacher failure baseline: teacher-detail-refresh-runtime.md; dirty/revision/protected-status analysis: teacher-detail-refresh-policy.md in the coordinator evidence directory.

| Need | Existing candidate | Decision | Reason |
|---|---|---|---|
| Initial pending/error/unavailable | PageState and Button from @/ui | reuse | Canonical named states, retry controls and alert semantics |
| Warm refresh continuity | TeacherStudentWorkPanel and TeacherWorkInspector | extend | Keep existing mounted grading inputs and pane geometry; inline bounded read feedback |
| Draft/revision/request ownership | useTeacherStudentWorkController | extend | Feature owns dirty snapshot, confirmed revision and read/write ordering |
| Workspace structure/motion | TeacherWorkSurfaceShell and TeacherWorkspaceSplit | reuse | Existing selection ladder, compact density and entry behavior remain |

Roles: teacher; student n/a because no student or shared owners change. Viewports:1440x900 and390x844. Themes:light/dark. Motion:normal/reduced. States:initial pending; transient initial rejection/retry; warm held refresh with focused dirty fields; repeat transient rejection; retry equal revision; changed remote revision conflict; protected401/403/404; changed owner/stale responses; writes in flight.

Primary signal: compact inline error with Try again while useful same-owner work stays mounted. No new animation, shell/card redesign, modal, overwrite/discard product controls, new primitive, dependency, backend/migration/provider calls. Reuse approved motion; no replay on refresh or retry. Composite review:yes existing inspector/split context; preserve its roles/keyboard/divider behavior, no new composite widget.

Acceptance: confirmed same-owner network/5xx (including body-download transport failure after HTTP200 headers) retains exact DOM, unsaved comment/scores/mode, caret/focus and inspector scroll. Pause writer dispatch during unresolved reads without disabling local text editing. Equal-revision retry preserves dirty baseline and local fields at response application time; changed revision retains draft and blocks writes, never silently rebases. Protected/unknown errors use generic unavailable and hide current protected content/actions. Bind full owner tuple, ignore stale reads and write acknowledgements. Defer same-owner refresh while mutations settle; queued refresh must then reevaluate acknowledged baseline. Initial safe Retry GET only and stable focus target. Keep parent dirty/busy reporting and stale-template exclusion. Preserve existing grading, feedback-return and AI contracts.

Tests: meaningful failing-before regressions for these user-visible state and sequencing guarantees, plus existing owner tests. Root browser matrix uses real TeacherClassroomView/controller with intercepted synthetic reads/writes and no backend/provider calls; screenshots + natural recordings, state/keyboard assertions and response timing. Root visually compares to reference and baseline. Required focused/UI/design checks and independent stable-SHA draft-first PR lifecycle. No merge or production authority.

## Completion integration — 2026-10-08

Combined with the approved assignment table/individual view change on main1dd532581. Reuse the two-view AssignmentWorkspaceViewToggle and persistent grading inspector; retain main's bounded AI polling and shared progress treatment. The controller reports classroom/assignment/student read ownership and write readiness to the parent. Pending, transient, unavailable, conflict, and mismatched-owner reads pause parent AI/Return menus and existing confirmations in both views; handlers recheck immediately before dispatch. Editing local fields remains available during safe same-owner refresh recovery.

The assignment workspace motion contract now asserts the approved Student table/Individual student workflow. Its draft, caret, scroller/inspector/workspace identity, no-extra-read, motion-duration/midpoint, resize, and containment assertions remain. Keyboard activation and44px toggle targets are explicitly verified. Source CI37506291029 failed eight variants at the obsolete Content + grading accessible-name expectation; no assertion threshold is relaxed.

Completion evidence is retained outside Git under pr-completion-20261008/next-completion/teacher-* with fixed source/main SHAs, commands, limitations, and visual review recorded in teacher-report.md. Students are n/a because affected controls and recovery owners are teacher-only. Independent review and PR operations belong to the coordinator.
