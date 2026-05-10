# Pika Session Log

Rolling recent session log for AI/human handoffs. Keep this file small; full historical session history lives in `.ai/JOURNAL-ARCHIVE.md`.

**Rules:**
- Append one concise entry for meaningful work at the end of a session.
- Run `node scripts/trim-session-log.mjs` after appending to keep only the latest 20 entries.
- Use `.ai/JOURNAL-ARCHIVE.md` only for historical investigation.

## 2026-05-08 — Shared assessment status indicator mapping

**Completed:**
- Added `AssessmentStatusIndicator` with centralized student-work status display mappings for assignments, test grading rows, and gradebook assessment details.
- Replaced local status/icon switches in the assignment student table, teacher test grading table, and gradebook student inspector.
- Preserved the assignment resubmitted chip and submitted-test unsubmit button while routing both through the shared status mapping.

**Validation:**
- `pnpm test tests/components/AssessmentStatusIndicator.test.tsx tests/components/AssessmentStatusIcon.test.tsx tests/components/TeacherAssignmentStudentTable.test.tsx tests/components/TeacherTestsTab.test.tsx tests/components/TeacherGradebookTab.test.tsx`
- `pnpm lint`
- `pnpm build`
- `E2E_BASE_URL=http://localhost:3003 pnpm e2e:auth`
- `git diff --check`
- Pika UI verification script for `/classrooms/491562df-96cd-4d21-8dc5-cff996396d41?tab=gradebook` on port 3003:
  - `/tmp/pika-teacher.png`
  - `/tmp/pika-student.png`
  - `/tmp/pika-teacher-mobile.png`

## 2026-05-06 — Simplify Syllabus tab embed

**Completed:**
- Removed the published-state top Course site/Syllabus card from teacher and student Syllabus tabs.
- Published Syllabus now opens directly to the embedded in-Pika course syllabus frame.
- Kept unpublished teacher/student fallback states so teachers can still reach Course Website Settings when there is no published site.

**Validation:**
- `bash scripts/verify-env.sh`
- `pnpm test tests/components/ResourcesTab.test.tsx`
- `pnpm lint`
- `pnpm build`
- Pika UI verification for Syllabus on `/classrooms/751b1dfb-ec79-46fc-b4f6-24f97911ecea?tab=resources`:
  - `/tmp/pika-teacher.png`
  - `/tmp/pika-student.png`
  - `/tmp/pika-teacher-mobile.png`

## 2026-05-06 — Fill Syllabus main content frame

**Completed:**
- Updated teacher and student Syllabus tabs so the published embed container fills the available main content width and height instead of using a centered max-width wrapper.
- Preserved stable mobile height for the iframe so the course syllabus remains usable inside the classroom shell.

**Validation:**
- `pnpm test tests/components/ResourcesTab.test.tsx`
- `pnpm lint`
- `pnpm build`
- Pika UI verification for Syllabus on `/classrooms/751b1dfb-ec79-46fc-b4f6-24f97911ecea?tab=resources`:
  - `/tmp/pika-teacher.png`
  - `/tmp/pika-student.png`
  - `/tmp/pika-teacher-mobile.png`

## 2026-05-07 — Strip Syllabus framing and simplify generated content

**Completed:**
- Removed the published Syllabus iframe wrapper/card from teacher and student classroom tabs so the iframe renders directly in the main content area.
- Simplified `/actual/[slug]` by removing the Grading summary, Resources section, and Current Lesson Sequence.
- Reduced Classwork rows to assignment title plus approximate course weight only.

**Validation:**
- `bash scripts/verify-env.sh`
- `pnpm test tests/components/ResourcesTab.test.tsx tests/lib/server/course-sites.test.ts`
- `pnpm lint`
- `pnpm build`
- Pika UI verification for Syllabus on `/classrooms/751b1dfb-ec79-46fc-b4f6-24f97911ecea?tab=resources`:
  - `/tmp/pika-teacher.png`
  - `/tmp/pika-student.png`
  - `/tmp/pika-teacher-mobile.png`
- Standalone syllabus screenshots:
  - `/tmp/pika-actual-syllabus.png`
  - `/tmp/pika-actual-syllabus-mobile.png`

## 2026-05-07 — Match actual syllabus to blueprint-style overview

**Completed:**
- Confirmed the in-Pika course overview comes from `classrooms.course_overview_markdown`, which is seeded from `course_blueprints.overview_markdown` when a classroom is created from a blueprint and then editable per classroom in Settings.
- Reworked `/actual/[slug]` into a simplified syllabus page with header, Course Overview when present, optional Test Docs, and one Assignments list using A/Q/T labels plus course-weight percentages.
- Removed the unused Resources publish toggle from Public Syllabus settings and renamed remaining teacher/student-facing course-site labels to syllabus language.

**Validation:**
- `pnpm test tests/components/ResourcesTab.test.tsx tests/components/TeacherSettingsTab.test.tsx tests/lib/server/course-sites.test.ts tests/lib/validations/teacher.test.ts tests/api/teacher/classrooms-id.test.ts`
- `pnpm lint`
- `pnpm build`
- `git diff --check`
- Pika UI verification for Syllabus on `/classrooms/751b1dfb-ec79-46fc-b4f6-24f97911ecea?tab=resources`:
  - `/tmp/pika-teacher.png`
  - `/tmp/pika-student.png`
  - `/tmp/pika-teacher-mobile.png`
- Settings screenshot for Public Syllabus labels:
  - `/tmp/pika-settings-teacher-full.png`

## 2026-05-07 — Harden student log summary privacy

**Completed:**
- Added direct-identifier redaction for nightly student log summary prompts.
- Built summary redaction maps from the full classroom roster plus entry authors.

## 2026-05-08 — Skill progression evidence review

**Completed:**
- Reviewed startup guidance, recent session continuity, and the latest merged PRs/review notes to identify repeated engineering friction.
- Anchored next-skill recommendations to concrete recent patterns: post-PR coverage gate fixes, multi-pass UI verification, UI/API invariant drift, privacy redaction gaps, and migration rollout compatibility work.

**Validation:**
- Reviewed `.ai/CURRENT.md`, `docs/ai-instructions.md`, `docs/dev-workflow.md`, `.ai/SESSION-LOG.md`
- Reviewed GitHub PRs `#559` through `#565` plus PR review notes for `#561` and `#563`
- Sent OpenAI summary requests with `store: false` and removed model-output snippets from parse errors.
- Added prompt/payload regression coverage for roster names and common direct identifiers.

**Validation:**
- `PIKA_WORKTREE=/Users/stew/Repos/.worktrees/pika/student-log-summary-privacy bash .codex/skills/pika-session-start/scripts/session_start.sh`
- `pnpm exec vitest tests/unit/log-summary.test.ts tests/api/cron/nightly-log-summaries.test.ts`
- `pnpm lint`
- `pnpm test`
- `pnpm build`

## 2026-05-06 — Center floating action cluster in shell content

**Completed:**
- Added a shared shell CSS variable for the main content center based on current left and right panel widths.
- Updated the teacher work-surface floating action cluster to center on that shell variable on desktop and animate with the shell timing.
- Added focused coverage for the desktop centering contract.

**Validation:**
- `pnpm test tests/components/TeacherWorkSurfaceActionBar.test.tsx tests/components/ThreePanelProvider.test.tsx`
- `pnpm lint`
- `pnpm build`
- Pika UI verification on port 3001:
  - `/tmp/pika-teacher.png`
  - `/tmp/pika-student-today.png`
  - `/tmp/pika-teacher-mobile.png`
  - `/tmp/pika-teacher-expanded.png`

## 2026-05-06 — Keep calendar date in action bar

**Completed:**
- Removed the pinned app-header title labels from teacher classroom tabs.
- Kept the calendar date navigator in the PageActionBar left slot and removed the obsolete calendar titlebar docking path.
- Left non-calendar teacher action bars without static tab labels.
- Added mobile-only spacing so the fixed calendar control cluster does not overlap the left-side date navigator.

**Validation:**
- `pnpm test tests/components/TeacherWorkSurfaceActionBar.test.tsx tests/components/ClassroomPageClientAssignmentsEditMode.test.tsx tests/components/TeacherAttendanceTab.test.tsx tests/components/TeacherQuizzesTab.test.tsx tests/components/TeacherTestsTab.test.tsx tests/components/TeacherGradebookTab.test.tsx`
- `pnpm lint`
- `pnpm build`
- Pika UI verification on port 3001:
  - `/tmp/pika-teacher-calendar-desktop.png`
  - `/tmp/pika-teacher.png`
  - `/tmp/pika-student.png`
  - `/tmp/pika-teacher-mobile.png`
  - `/tmp/pika-teacher-attendance-labels.png`

## 2026-05-07 — Make edit controls icon-only

**Completed:**
- Removed visible `Edit` text from shared teacher edit-mode controls and the selected-test workspace edit toggle.
- Kept accessible names and titles on the icon-only pencil buttons.
- Added focused coverage that the shared edit toggle remains named `Edit` without visible button text.

**Validation:**
- `PIKA_WORKTREE=/Users/stew/Repos/.worktrees/pika/fab-rail-centering bash .codex/skills/pika-session-start/scripts/session_start.sh`
- `pnpm test tests/components/TeacherEditModeControls.test.tsx tests/components/TeacherClassroomsIndex.test.tsx tests/components/TeacherClassroomView.test.tsx tests/components/TeacherTestsTab.test.tsx tests/components/TeacherQuizzesTab.test.tsx tests/components/TeacherAttendanceTab.test.tsx`
- `pnpm lint`
- `pnpm build`
- Visual verification on port 3001:
  - `/tmp/pika-teacher-tests-edit-icon.png`
  - `/tmp/pika-teacher-selected-test-edit-icon.png`
  - `/tmp/pika-teacher-classrooms-edit-icon.png`

## 2026-05-07 — Shorten assessment new labels

**Completed:**
- Changed teacher quiz and test summary action labels from `New Quiz` and `New Test` to `New`.
- Kept the plus icon visible so the action reads as `+ New`.
- Updated focused quiz/test component coverage for the shorter accessible button name.

**Validation:**
- `pnpm test tests/components/TeacherQuizzesTab.test.tsx tests/components/TeacherTestsTab.test.tsx`
- `pnpm lint`
- `pnpm build`
- Visual verification on port 3001:
  - `/tmp/pika-teacher-tests-new-label.png`
  - `/tmp/pika-teacher.png`
  - `/tmp/pika-student.png`
  - `/tmp/pika-teacher-mobile.png`

## 2026-05-07 — Add create action tooltips

**Completed:**
- Added contextual tooltips to the compact teacher summary `+ New` buttons for assignments, quizzes, and tests.
- Kept the visible button labels unchanged and preserved the assignment button's accessible name.
- Updated the assignment action-bar test to assert the fixed floating cluster without depending on the tooltip-adjusted DOM parent chain.

**Validation:**
- `pnpm test tests/components/TeacherQuizzesTab.test.tsx tests/components/TeacherTestsTab.test.tsx tests/components/TeacherClassroomView.test.tsx`
- `pnpm lint`
- `pnpm build`
- Pika UI verification on port 3001 for assignments, quizzes, and tests.
- Hover screenshots:
  - `/tmp/pika-teacher-assignments-new-tooltip.png`
  - `/tmp/pika-teacher-quizzes-new-tooltip.png`
  - `/tmp/pika-teacher-tests-new-tooltip.png`

## 2026-05-07 — Hide classroom view labels outside edit mode

**Completed:**
- Made the teacher classroom list Active/Archived segmented toggle icon-only until classroom edit mode is enabled.
- Preserved accessible button names while the toggle is icon-only.
- Added focused test coverage for the icon-only versus labeled edit-mode states.

**Validation:**
- `bash scripts/verify-env.sh`
- `pnpm test tests/components/TeacherClassroomsIndex.test.tsx`
- `pnpm lint`
- `pnpm build`
- Visual verification on port 3010:
  - `/tmp/pika-classrooms-toggle-teacher-desktop.png`
  - `/tmp/pika-classrooms-toggle-teacher-desktop-edit.png`
  - `/tmp/pika-classrooms-toggle-teacher-mobile.png`
  - `/tmp/pika-classrooms-toggle-teacher-mobile-edit.png`
  - `/tmp/pika-classrooms-student-mobile.png`

## 2026-05-07 — Add classroom view toggle tooltips

**Completed:**
- Added styled app tooltips to icon-only segmented controls.
- Placed icon-only segmented control tooltips above the trigger so the bottom classroom view toggle remains visible on hover.
- Removed the native title fallback from segmented buttons.

**Validation:**
- `pnpm test tests/components/TeacherClassroomsIndex.test.tsx`
- `pnpm lint`
- `pnpm build`
- Visual hover verification on port 3011:
  - `/tmp/pika-classrooms-toggle-active-tooltip.png`
  - `/tmp/pika-classrooms-toggle-archived-tooltip.png`

## 2026-05-10 — Add student exam-mode e2e coverage

**Completed:**
- Added a focused Playwright flow for student test exam mode.
- Seeds a unique active open-response test through existing teacher APIs against the shared seeded teacher/student classroom.
- Verifies test start, transient window loss without lock, sustained window loss with content obscuring and interaction blocking, restoration, and open-response draft preservation after reload/restart.

**Validation:**
- `bash scripts/verify-env.sh`
- `pnpm exec playwright test e2e/student-exam-mode.spec.ts`
- `pnpm lint`

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
