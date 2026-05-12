# Pika Session Log

Rolling recent session log for AI/human handoffs. Keep this file small; full historical session history lives in `.ai/JOURNAL-ARCHIVE.md`.

**Rules:**
- Append one concise entry for meaningful work at the end of a session.
- Run `node scripts/trim-session-log.mjs` after appending to keep only the latest 20 entries.
- Use `.ai/JOURNAL-ARCHIVE.md` only for historical investigation.

## 2026-05-08 — Add class log summary controls

**Completed:**
- Confirmed the Vercel nightly log summary cron remains `0 6 * * *` (06:00 UTC: 1:00am EST / 2:00am EDT).
- Added a floating attendance action control to show or hide the bottom Class Log Summary card.
- Added a drag/keyboard resize handle for the visible Class Log Summary card.
- Kept the log summary data component unchanged and scoped behavior to teacher attendance presentation state.

**Validation:**
- `PIKA_WORKTREE=/Users/stew/Repos/.worktrees/pika/log-summary-panel-controls bash .codex/skills/pika-session-start/scripts/session_start.sh`
- `pnpm test tests/components/TeacherAttendanceTab.test.tsx`
- `pnpm lint`
- `pnpm build`
- Visual verification on port 3000:
  - `/tmp/pika-log-summary-teacher-visible.png`
  - `/tmp/pika-log-summary-teacher-hidden.png`
  - `/tmp/pika-log-summary-teacher-expanded.png`
  - `/tmp/pika-log-summary-teacher-populated.png`
  - `/tmp/pika-log-summary-teacher-mobile.png`
  - `/tmp/pika-log-summary-student-mobile.png`

## 2026-05-08 — Extract assignment lifecycle invariants

**Completed:**
- Added shared assignment release-state helpers for draft/live/scheduled visibility in `src/lib/assignments.ts`.
- Moved student assignment visibility behind the shared helper while preserving the server import path.
- Centralized future scheduled-release due-date validation and migrated assignment update/release routes plus scheduling UI callers.
- Added release-state and future schedule validation tests, including malformed `released_at` fail-closed behavior.

**Validation:**
- `PIKA_WORKTREE=/Users/stew/.codex/worktrees/53f9/pika bash .codex/skills/pika-session-start/scripts/session_start.sh`
- `pnpm vitest run tests/unit/assignments.test.ts tests/lib/assignment-schedule-validation.test.ts tests/api/assignment-docs/submit.test.ts tests/api/teacher/assignments-id.test.ts tests/api/teacher/assignments-draft.test.ts tests/components/AssignmentModal.test.tsx tests/components/StudentAssignmentsTab.test.tsx`
- `pnpm vitest run tests/components/SortableAssignmentCard.test.tsx tests/components/TeacherClassroomView.test.tsx tests/api/student/assignments.test.ts tests/api/integration/assignment-draft-flow.test.ts tests/api/student/notifications.test.ts`
- `pnpm lint`
- `pnpm build`
- `pnpm test`

## 2026-05-08 — Open assignment invariant PR

**Completed:**
- Created branch `codex/assignment-lifecycle-invariants`.
- Committed assignment lifecycle invariant extraction as `37cd562`.
- Opened draft PR #570 and added `codex` plus `codex-automation` labels.
- Posted a self-review comment with no blocking findings.

**Validation:**
- PR checks showed Vercel skipped by ignored build step, with preview comments passing.

## 2026-05-08 — Unblock assignment invariant merge

**Completed:**
- Rebasing PR #570 onto `origin/main` exposed a CI branch-coverage failure in `src/lib/assignments.ts`.
- Added focused release-state coverage for malformed comparison dates so the fail-safe `Date.now()` branch is exercised.
- Kept the assignment lifecycle implementation behavior-preserving.

**Validation:**
- `PIKA_WORKTREE=/Users/stew/.codex/worktrees/53f9/pika bash .codex/skills/pika-session-start/scripts/session_start.sh`
- `pnpm vitest run tests/unit/assignments.test.ts`
- `pnpm run test:coverage`
- `pnpm lint`
- Targeted mocked-data captures for the shared indicator in the gradebook inspector:
  - `/tmp/pika-assessment-status-indicator-gradebook-desktop.png`
  - `/tmp/pika-assessment-status-indicator-gradebook-mobile.png`

## 2026-05-08 — Gradebook edit weight label

**Completed:**
- Changed the edit-mode gradebook row label from `Weights` to `Weight`.
- Updated focused gradebook component assertions for the singular label.

**Validation:**
- `pnpm test tests/components/TeacherGradebookTab.test.tsx`
- `pnpm lint`
- `PIKA_WORKTREE=/Users/stew/Repos/.worktrees/pika/gradebook-assessment-matrix E2E_BASE_URL=http://localhost:3003 bash .codex/skills/pika-ui-verify/scripts/ui_verify.sh 'classrooms/751b1dfb-ec79-46fc-b4f6-24f97911ecea?tab=gradebook&gradebookSection=settings'`
- Visual captures:
  - `/tmp/pika-teacher.png`
  - `/tmp/pika-teacher-mobile.png`
  - `/tmp/pika-student.png`

## 2026-05-11 — Fix stale student log date

**Completed:**
- Fixed Student Today autosave so a stale mounted tab rechecks the current Toronto date before building the save payload.
- Cleared stale entry identity/version state when the mounted date rolls over, preventing first/new saves from targeting an old day.
- Added a regression test for a tab mounted on May 6 that saves after today advances to May 11.

**Validation:**
- `bash scripts/verify-env.sh`
- `pnpm vitest run tests/components/StudentTodayTabHistory.test.tsx`
- `pnpm lint`
- `pnpm vitest run tests/api/student/entries.test.ts tests/components/StudentTodayTabHistory.test.tsx tests/unit/timezone.test.ts`
- `pnpm test`

## 2026-05-09 — Test markdown creation defaults

**Completed:**
- New teacher tests now open directly in the edit dialog's Code view after creation.
- The created-test Code view starts with markdown editing enabled, so no separate `Edit Markdown` click is required.
- Draft summary/title changes from markdown now patch the parent tests list state immediately and survive in-flight list refreshes.
- Added an `Edit Test` option to the selected-test actions dropdown to open the edit modal from the grading workspace.
- Removed the standalone selected-test pen toggle and later removed the selected-test `Manage Attempts` option plus its row-level attempt-delete mode.
- Removed the standalone tests-list pen toggle; list reordering now lives behind the tests-list gear FAB, which toggles drag handles and card-level trash buttons.
- Moved whole-test deletion to the tests-list gear mode as a trash icon on each test card, using the existing confirmation flow.
- Changed the selected-test actions dropdown delete option to `Delete Selected`, targeting selected student test work only and disabled until one or more student rows are selected.
- Added a confirmation dialog before selected-test `Open All`/batch-open access updates run.
- Removed the standalone selected-assignment pen toggle from the grading workspace.
- Added `Edit Assignment` and `Delete Assignment` to the selected-assignment actions dropdown, with assignment deletion using the existing confirmation flow.
- Kept the selected-assignment actions dropdown accessible even when no students are selected; only the primary `AI Grade` action is disabled by empty selection.
- Added focused component coverage for markdown-first creation, editable markdown-only layout startup, title propagation back to the tests list, selected-workspace edit-menu launch, gear-mode card reorder/delete controls, selected-student work deletion, access-open confirmation, and the absence of selected-workspace attempt-management controls.
- Added focused component coverage for selected-assignment dropdown editing and deletion.

**Validation:**
- `bash .codex/skills/pika-session-start/scripts/session_start.sh`
- `pnpm test tests/components/TeacherTestsTab.test.tsx tests/components/QuizDetailPanel.test.tsx`
- `pnpm lint`
- `pnpm test`
- `pnpm build`
- `pnpm test tests/components/TeacherTestsTab.test.tsx`
- `pnpm test tests/components/TeacherClassroomView.test.tsx`
- `pnpm test tests/components/TeacherTestsTab.test.tsx`
- `pnpm lint`
- `pnpm build`
- `PIKA_WORKTREE=/Users/stew/Repos/.worktrees/pika/test-markdown-editor-default bash scripts/verify-env.sh`
- Visual verification:
  - `bash .codex/skills/pika-ui-verify/scripts/ui_verify.sh 'classrooms/751b1dfb-ec79-46fc-b4f6-24f97911ecea?tab=tests'`
  - `bash .codex/skills/pika-ui-verify/scripts/ui_verify.sh 'classrooms/751b1dfb-ec79-46fc-b4f6-24f97911ecea?tab=assignments'`
  - `E2E_BASE_URL=http://localhost:3001 bash .codex/skills/pika-ui-verify/scripts/ui_verify.sh 'classrooms/751b1dfb-ec79-46fc-b4f6-24f97911ecea?tab=tests'`
  - `/tmp/pika-teacher.png`
  - `/tmp/pika-student.png`
  - `/tmp/pika-teacher-mobile.png`
  - `/tmp/pika-created-test-code-view.png`
  - `/tmp/pika-applied-title-list.png`
  - `/tmp/pika-selected-test-actions-edit-test.png`
  - `/tmp/pika-test-list-actions-reorder.png`
  - `/tmp/pika-selected-test-actions-no-manage-attempts.png`
  - `/tmp/pika-open-all-confirm.png`
  - `/tmp/pika-delete-test-confirm.png`
  - `/tmp/pika-test-list-settings-gear-delete.png`
  - `/tmp/pika-selected-test-actions-delete-selected.png`
  - `/tmp/pika-delete-selected-test-work-confirm.png`
  - `/tmp/pika-selected-assignment-detail-after-wait.png`
  - `/tmp/pika-selected-assignment-actions-delete-loaded.png`
  - `/tmp/pika-delete-assignment-confirm.png`

## 2026-05-09 — Daily log summary collapse

**Completed:**
- Removed the Daily tab floating action cluster show/hide button for the class log summary.
- Changed the class log summary from hidden/shown to expanded/collapsed states.
- Double-clicking the bottom summary panel collapses it to a 40px bar labeled `Log Summary`.
- Double-clicking the collapsed bar restores the summary to the standard 180px height.
- Preserved handle resizing, including dragging upward from the collapsed bar to reopen and resize the panel.
- Added focused component coverage for double-click collapse/restore and drag-reopen behavior.

**Validation:**
- `pnpm test tests/components/TeacherAttendanceTab.test.tsx`
- `pnpm lint`
- `E2E_BASE_URL=http://localhost:3001 bash .codex/skills/pika-ui-verify/scripts/ui_verify.sh 'classrooms/751b1dfb-ec79-46fc-b4f6-24f97911ecea?tab=attendance'`
- Targeted visual captures:
  - `/tmp/pika-daily-log-summary-collapsed.png`
  - `/tmp/pika-daily-log-summary-drag-reopened.png`
- `pnpm build`

## 2026-05-10 — Submitted-aware test unsubmit action

**Completed:**
- Confirmed selected-student test-work deletion does not close/open student access; it deletes attempt data only and leaves `test_student_availability` unchanged.
- Changed the selected-test `Unsubmit Selected` action to enable only when selected rows include submitted work.
- Filtered batch unsubmit requests so mixed selections submit only the selected students whose work is currently submitted.
- Added focused component coverage for disabled no-submitted selection and mixed-selection submitted-only unsubmit requests.

**Validation:**
- `PIKA_WORKTREE=/Users/stew/Repos/.worktrees/pika/test-markdown-editor-default bash .codex/skills/pika-session-start/scripts/session_start.sh`
- `pnpm test tests/components/TeacherTestsTab.test.tsx`
- `pnpm lint`
- `PIKA_WORKTREE=/Users/stew/Repos/.worktrees/pika/test-markdown-editor-default E2E_BASE_URL=http://localhost:3001 bash .codex/skills/pika-ui-verify/scripts/ui_verify.sh 'classrooms/751b1dfb-ec79-46fc-b4f6-24f97911ecea?tab=tests'`
- Targeted visual captures:
  - `/tmp/pika-unsubmit-disabled-no-submitted-selected.png`
  - `/tmp/pika-unsubmit-enabled-submitted-selected.png`
- `pnpm build`

## 2026-05-10 — Test action menu counts

**Completed:**
- Added compact count badges to the selected-test dropdown items for `AI Grade`, `Unsubmit Selected`, `Return`, and `Delete Selected`.
- Counts now reflect the current selected rows and action eligibility: selected rows for AI grading/deletion, submitted selected rows for unsubmit, and closed/returnable selected rows for return.
- Added focused component assertions for the action menu count labels.

**Validation:**
- `PIKA_WORKTREE=/Users/stew/Repos/.worktrees/pika/test-markdown-editor-default bash .codex/skills/pika-session-start/scripts/session_start.sh`
- `pnpm test tests/components/TeacherTestsTab.test.tsx`
- `pnpm lint`
- `PIKA_WORKTREE=/Users/stew/Repos/.worktrees/pika/test-markdown-editor-default E2E_BASE_URL=http://localhost:3001 bash .codex/skills/pika-ui-verify/scripts/ui_verify.sh 'classrooms/751b1dfb-ec79-46fc-b4f6-24f97911ecea?tab=tests'`
- Targeted visual capture:
  - `/tmp/pika-test-action-menu-counts.png`
- `pnpm build`

## 2026-05-10 — Markdown-only test editor defaults

**Completed:**
- Made editable markdown-only test editor surfaces enter writable mode by default, including create-test Code view and existing-test Code view.
- Removed the markdown `Copy` and `Schema` toolbar actions from `QuizDetailPanel`.
- Removed the now-redundant `startMarkdownEditing` prop plumbing from the tests tab.
- Updated focused component coverage for default editable markdown-only layout and absent copy/schema actions.

**Validation:**
- `PIKA_WORKTREE=/Users/stew/Repos/.worktrees/pika/test-markdown-editor-default bash .codex/skills/pika-session-start/scripts/session_start.sh`
- `pnpm test tests/components/QuizDetailPanel.test.tsx tests/components/TeacherTestsTab.test.tsx`
- `pnpm lint`
- `pnpm test`
- `pnpm build`
- `PIKA_WORKTREE=/Users/stew/Repos/.worktrees/pika/test-markdown-editor-default bash .codex/skills/pika-ui-verify/scripts/ui_verify.sh 'classrooms/751b1dfb-ec79-46fc-b4f6-24f97911ecea?tab=tests'`
- Targeted visual capture:
  - `/tmp/pika-test-edit-code.png`

## 2026-05-11 — Trim session log for CI

**Completed:**
- Trimmed the rolling session log after PR work so it stays within the enforced 20-entry budget.

**Validation:**
- `pnpm test tests/unit/ai-startup-docs.test.ts`

## 2026-05-11 — Mixed classwork material ordering

**Completed:**
- Added material `position` migration and mixed assignment/material classwork ordering.
- Added teacher classwork reorder API for `{ type, id }` item lists.
- Moved classwork reorder persistence into transaction-backed Postgres RPC functions.
- Hardened classwork reorder requests to reject stale partial lists while preserving assignment-only reorder around material position slots.
- Made assignment/material create routes fail closed on unexpected mixed-order position lookup errors.
- Preserved existing material positions when the assignment Markdown bulk-save path rewrites assignment positions.
- Updated teacher classwork summary so materials are visually distinct and draggable in edit mode.
- Updated student classwork summary to render the same mixed order with distinct material cards.
- Refined material cards to use tint plus a left accent rail instead of an icon, keeping the Syllabus icon reserved for Syllabus.
- Documented the material card/order behavior in assignment UX guidance.

**Validation:**
- `PIKA_WORKTREE=/Users/stew/Repos/.worktrees/pika/classwork-material-order bash .codex/skills/pika-session-start/scripts/session_start.sh`
- `pnpm test tests/lib/classwork-order.test.ts tests/api/teacher/classwork-reorder.test.ts tests/api/teacher/materials.test.ts tests/api/student/materials.test.ts tests/api/teacher/assignments.test.ts tests/components/TeacherClassroomView.test.tsx tests/components/StudentAssignmentsTab.test.tsx`
- `pnpm lint`
- `pnpm test`
- `pnpm build`
- Post-iconless refinement:
  - `pnpm test tests/components/TeacherClassroomView.test.tsx tests/components/StudentAssignmentsTab.test.tsx`
  - `pnpm lint`
- Final pre-push validation:
  - `pnpm test tests/api/teacher/classwork-reorder.test.ts tests/components/TeacherClassroomView.test.tsx tests/components/StudentAssignmentsTab.test.tsx`
  - `pnpm lint`
  - `pnpm test`
  - `pnpm build`
- Transactional reorder fix:
  - `pnpm test tests/api/teacher/classwork-reorder.test.ts tests/api/teacher/assignments-reorder.test.ts tests/api/teacher/assignments-bulk.test.ts tests/api/teacher/assignments.test.ts tests/api/teacher/materials.test.ts tests/components/TeacherClassroomView.test.tsx tests/components/StudentAssignmentsTab.test.tsx`
  - `pnpm lint`
  - `pnpm build`
  - `supabase db lint --local --schema public --fail-on error` (existing unrelated warning: `public.unsubmit_test_attempts_atomic` unused `p_updated_by`)
  - `pnpm test`
- Visual verification:
  - `bash .codex/skills/pika-ui-verify/scripts/ui_verify.sh 'classrooms/491562df-96cd-4d21-8dc5-cff996396d41?tab=assignments'`
  - `/tmp/pika-teacher-material.png`
  - `/tmp/pika-student-material.png`
  - `/tmp/pika-teacher-material-dark.png`
  - `/tmp/pika-student-material-dark.png`
  - `/tmp/pika-teacher-material-tinted.png`
  - `/tmp/pika-student-material-tinted.png`
  - `/tmp/pika-student-material-tinted-dark.png`

## 2026-05-11 — Classwork migration filename resequence

**Completed:**
- Renamed the mixed classwork material ordering migration from a timestamped filename to the next numeric-leading Pika migration slot, `067_classwork_mixed_ordering.sql`.

**Validation:**
- `bash scripts/verify-env.sh` exposed an unrelated session-log length failure before trimming.
- `node scripts/trim-session-log.mjs`

## 2026-05-11 — Remove material card outline highlight

**Completed:**
- Removed the primary outline and left accent rail from teacher and student material cards while keeping the soft tint and `Material` label.
- Added component assertions to keep material cards on neutral borders without the primary rail.
- Updated assignment UX guidance to describe tint-based material differentiation.

**Validation:**
- `pnpm test tests/components/TeacherClassroomView.test.tsx tests/components/StudentAssignmentsTab.test.tsx`
- `pnpm lint`
- `pnpm build`
- `bash .codex/skills/pika-ui-verify/scripts/ui_verify.sh 'classrooms/491562df-96cd-4d21-8dc5-cff996396d41?tab=assignments'` captured the route but local DB state returned "Classroom not found".
- Supplemental CSS visual harness:
  - `/tmp/pika-material-no-outline-harness.png`
  - `/tmp/pika-material-no-outline-harness-dark.png`

## 2026-05-11 — Smooth material drag treatment

**Completed:**
- Removed the material card's hover transition while it is actively dragging so dnd-kit owns transform movement like assignment cards.
- Added a neutral drag-border option to the shared teacher work item frame and used it for material cards.

**Validation:**
- `pnpm test tests/components/TeacherClassroomView.test.tsx tests/components/TeacherWorkItemPrimitives.test.tsx`
- `pnpm lint`
- `pnpm build`
- Pika UI verify captured the target route but local DB state still returned "Classroom not found".
- Supplemental drag-state harness:
  - `/tmp/pika-material-drag-state-harness.png`

## 2026-05-11 — Restrict classwork reorder RPC execution

**Completed:**
- Added explicit `revoke all` from `public`, `anon`, and `authenticated` for the new classwork reorder RPCs.
- Granted both reorder RPCs only to `service_role`, matching the API route authorization boundary.
- Added a static migration regression test for the RPC grant contract.

**Validation:**
- `pnpm test tests/unit/classwork-migration-rpc-grants.test.ts tests/api/teacher/classwork-reorder.test.ts tests/api/teacher/assignments-reorder.test.ts`
- `pnpm lint`
- `supabase db lint --local --schema public --fail-on error` (existing unrelated warning: `public.unsubmit_test_attempts_atomic` unused `p_updated_by`)
- `pnpm build`

## 2026-05-11 — Add Daily quick date buttons

**Completed:**
- Added icon-only Daily tab quick-jump buttons for `Last class` and `Today` around the existing date picker arrows.
- Simplified the quick-jump icons to `UndoDot` for `Last class` and `CircleDot` for `Today`.
- Reused the existing Toronto date and class-day helpers so `Last class` targets the most recent class day before today.
- Added focused component coverage for moving from the last class date to today and back.
- Refreshed the Toronto `today` value on focus/visibility/interval and in quick-jump handlers so open tabs do not keep stale quick-jump dates after midnight.

**Validation:**
- `PIKA_WORKTREE=/Users/stew/Repos/.worktrees/pika/daily-tab-quick-date-buttons bash .codex/skills/pika-session-start/scripts/session_start.sh`
- `pnpm test tests/components/TeacherAttendanceTab.test.tsx`
- `pnpm lint`
- Added rollover coverage for `Today` and `Last class` quick jumps after the mocked Toronto date changes while the tab remains mounted.
- `PIKA_WORKTREE=/Users/stew/Repos/.worktrees/pika/daily-tab-quick-date-buttons bash .codex/skills/pika-ui-verify/scripts/ui_verify.sh 'classrooms/751b1dfb-ec79-46fc-b4f6-24f97911ecea?tab=attendance'`
- `E2E_BASE_URL=http://localhost:3002 PIKA_WORKTREE=/Users/stew/Repos/.worktrees/pika/daily-tab-quick-date-buttons bash .codex/skills/pika-ui-verify/scripts/ui_verify.sh 'classrooms/c4536d07-c76a-4a5b-a9c9-6340ed1678a9?tab=attendance'`
- `E2E_BASE_URL=http://localhost:3003 PIKA_WORKTREE=/Users/stew/Repos/.worktrees/pika/daily-tab-quick-date-buttons bash .codex/skills/pika-ui-verify/scripts/ui_verify.sh 'classrooms/c4536d07-c76a-4a5b-a9c9-6340ed1678a9?tab=attendance'`
- Tooltip hover checks:
  - `/tmp/pika-tooltip-last-class.png`
  - `/tmp/pika-tooltip-today.png`

## 2026-05-12 — Preserve teacher assignment student-list scroll

**Completed:**
- Preserved the teacher assignment workspace class-pane scroll position while selecting students from the left student table.
- Added regression coverage that remounts the left pane on student selection and verifies the stored scroll offset is restored.

**Validation:**
- `PIKA_WORKTREE=/Users/stew/Repos/.worktrees/pika/teacher-assignments-scroll bash .codex/skills/pika-session-start/scripts/session_start.sh`
- `pnpm test tests/components/TeacherClassroomView.test.tsx tests/components/TeacherAssignmentStudentTable.test.tsx`
- `pnpm lint`
- `pnpm test`
- `PIKA_WORKTREE=/Users/stew/Repos/.worktrees/pika/teacher-assignments-scroll E2E_BASE_URL=http://localhost:3000 bash .codex/skills/pika-ui-verify/scripts/ui_verify.sh 'classrooms/c4536d07-c76a-4a5b-a9c9-6340ed1678a9?tab=assignments&assignmentId=f2e7f53a-8399-42f7-9739-36a91fd837c1&assignmentStudentId=20d7927e-6c8d-4fe0-a31b-b3a4bd097f5e'`

## 2026-05-12 — Continue teacher assignment scroll handoff

**Completed:**
- Audited the dirty `codex/teacher-assignments-scroll` worktree after the prior Codex session died.
- Confirmed the assignment scroll fix preserves the class-pane scroll position before student selection and restores it after remount.
- Seeded local Supabase and refreshed Playwright auth so UI verification used a live local classroom instead of a stale missing-classroom route.

**Validation:**
- `PIKA_WORKTREE=/Users/stew/Repos/.worktrees/pika/teacher-assignments-scroll bash .codex/skills/pika-session-start/scripts/session_start.sh`
- `pnpm test tests/components/TeacherClassroomView.test.tsx tests/components/TeacherAttendanceTab.test.tsx tests/components/TeacherGradebookTab.test.tsx tests/components/TeacherTestsTab.test.tsx tests/components/TeacherAssignmentStudentTable.test.tsx`
- `pnpm lint`
- `pnpm build`
- `E2E_BASE_URL=http://localhost:3001 pnpm e2e:auth`
- `PIKA_WORKTREE=/Users/stew/Repos/.worktrees/pika/teacher-assignments-scroll E2E_BASE_URL=http://localhost:3001 bash .codex/skills/pika-ui-verify/scripts/ui_verify.sh 'classrooms/61164fb0-26d2-4862-abfe-5517ccdc685a?tab=assignments&assignmentId=9ff41b8e-bb7a-485b-a553-fb11dfd98545&assignmentStudentId=852830be-50b4-48fe-9b03-67e4d1d49a37'`
- Delayed loaded-state teacher desktop screenshot: `/tmp/pika-teacher-loaded.png`
