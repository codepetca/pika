# Pika Session Log

Rolling recent session log for AI/human handoffs. Keep this file small; full historical session history lives in `.ai/JOURNAL-ARCHIVE.md`.

**Rules:**
- Append one concise entry for meaningful work at the end of a session.
- Run `node scripts/trim-session-log.mjs` after appending to keep only the latest 20 entries.
- Use `.ai/JOURNAL-ARCHIVE.md` only for historical investigation.

## 2026-05-05 — Retire large journal from default workflow

**Completed:**
- Moved the full AI session history to `.ai/JOURNAL-ARCHIVE.md`.
- Added `.ai/SESSION-LOG.md` as the small rolling handoff log and `scripts/trim-session-log.mjs` to cap recent entries.
- Updated startup/end-session guidance and the weekly simplification automation to use the session log instead of the large journal.
- Made the trim script resolve default paths from the script repo rather than process cwd.
- Added regression coverage for startup token budget, no default journal tailing, and session-log trimming.

**Validation:**
- `pnpm test tests/unit/ai-startup-docs.test.ts tests/unit/trim-session-log.test.ts`
- `pnpm test`
- `pnpm lint`

## 2026-05-05 — Harden selected-student exam lifecycle mutations

**Completed:**
- Added atomic database functions for test close/finalize, unsubmit, and per-student test-work deletion.
- Routed whole-test close, selected return finalization, selected unsubmit, and student-work delete through atomic RPCs.
- Added atomic selected-student return marking so existing attempts are marked returned and missing returned attempts are created in one database function.
- Changed grading finalization to avoid invalid blank multiple-choice response rows; missing MC responses continue to score as zero by absence.
- Updated route and integration coverage for selected-only finalization and RPC migration fallbacks.

**Validation:**
- `pnpm test tests/lib/finalize-test-attempts.test.ts tests/api/teacher/tests-unsubmit.test.ts tests/api/teacher/tests-student-attempt-delete.test.ts tests/api/teacher/tests-return.test.ts tests/api/teacher/tests-id-route.test.ts tests/api/teacher/tests-student-access.test.ts`
- `pnpm test tests/api/integration/test-return-visibility-flow.test.ts tests/api/student/tests-attempt.test.ts tests/api/student/tests-respond.test.ts tests/api/student/tests-route.test.ts tests/api/student/tests-id.test.ts tests/api/student/tests-results.test.ts tests/api/student/tests-session-status.test.ts tests/api/teacher/tests-results.test.ts tests/api/teacher/tests-route.test.ts tests/unit/test-student-access.test.ts`
- `pnpm lint`
- `pnpm test:coverage`

## 2026-05-05 — Rebase selected-student exam access onto main

**Completed:**
- Rebasing `codex/selected-student-exam-access` onto `origin/main` completed.
- Resolved conflicts in `.ai/JOURNAL-ARCHIVE.md` and `AssignmentModal.tsx` by preserving main's schedule-validation behavior and the branch's maximized creation-modal behavior.
- Restored the temporary pre-rebase stash and dropped it.
- Confirmed migrations are sequential after `origin/main` migration `059`: `060`, `061`, `062`, and uncommitted `063`.

**Validation:**
- `pnpm test tests/components/AssignmentModal.test.tsx tests/lib/finalize-test-attempts.test.ts tests/api/teacher/tests-unsubmit.test.ts tests/api/teacher/tests-student-attempt-delete.test.ts tests/api/teacher/tests-return.test.ts tests/api/teacher/tests-id-route.test.ts tests/api/teacher/tests-student-access.test.ts tests/api/integration/test-return-visibility-flow.test.ts`
- `pnpm lint`

## 2026-05-06 — Independent split-pane scrolling

**Completed:**
- Added an opt-in viewport constraint to `AppShell` and enabled it for active desktop teacher split-pane workspaces.
- Bounded the gapped teacher workspace split at desktop sizes without changing resize handlers or inspector-width state.
- Moved overflowing table/content regions inside the affected split panes so attendance, roster, gradebook, assignment review, and test grading can scroll panes independently.

**Validation:**
- `bash scripts/verify-env.sh`
- `pnpm test -- tests/components/TeacherWorkspaceSplit.test.tsx tests/components/TeacherClassroomView.test.tsx tests/components/TeacherTestsTab.test.tsx tests/components/TeacherGradebookTab.test.tsx` (ran full suite: 249 files, 2091 tests)
- `pnpm lint`
- Pika UI verification for `/classrooms/751b1dfb-ec79-46fc-b4f6-24f97911ecea?tab=attendance`:
  - `/tmp/pika-attendance-teacher.png`
  - `/tmp/pika-attendance-student.png`
  - `/tmp/pika-attendance-teacher-mobile.png`
- Focused teacher split screenshots:
  - `/tmp/pika-gradebook-teacher.png`
  - `/tmp/pika-roster-teacher.png`
  - `/tmp/pika-assignment-split-teacher.png`
  - `/tmp/pika-test-grading-split-teacher.png`
- Playwright assertion pass confirmed no document-level vertical scroll on the affected desktop split routes and a 126px resize-handle movement after drag.

## 2026-05-06 — Make assignment edit mode modal-close ephemeral

**Completed:**
- Cleared teacher assignment edit mode whenever the assignment create/edit modal exits.
- Preserved modal-internal updates that intentionally keep the modal open.
- Added regression coverage for closing the create assignment modal after starting summary edit mode.

**Validation:**
- `PIKA_WORKTREE=/Users/stew/Repos/.worktrees/pika/assignment-actionbar-spacer bash .codex/skills/pika-session-start/scripts/session_start.sh`
- `pnpm test tests/components/TeacherClassroomView.test.tsx`
- `pnpm test tests/components/AssignmentModal.test.tsx tests/components/ClassroomPageClientAssignmentsEditMode.test.tsx tests/components/TeacherClassroomView.test.tsx`
- `pnpm lint`
- `git diff --check`
- Pika UI verification on the shared assignments page:
  - `/tmp/pika-teacher.png`
  - `/tmp/pika-student.png`
  - `/tmp/pika-teacher-mobile.png`
- Focused Playwright flow: toggled assignment edit mode, opened New assignment, closed the create modal, confirmed Edit returned to `aria-pressed="false"`, and cleaned up the temporary draft.
  - `/tmp/pika-assignment-edit-mode-before-create-modal.png`
  - `/tmp/pika-assignment-create-modal-before-close-ephemeral.png`
  - `/tmp/pika-assignment-edit-mode-after-create-close.png`

## 2026-05-06 — Align calendar controls with floating tab pattern

**Completed:**
- Moved the classroom calendar date navigator and Week/Month/All selector into the shared centered floating action cluster.
- Replaced the teacher calendar markdown-sidebar icon with the shared Edit control and kept student calendar without teacher edit chrome.
- Set the teacher calendar title-bar label to `Calendar` and added mobile spacing so the wrapped teacher FAB does not cover the calendar header.
- Follow-up: stacked the Week/Month/All selector below the date navigator, with teacher Edit beside the lower selector row.
- Follow-up: moved teacher Edit into the date navigator row and aligned it to the row's right edge while keeping Week/Month/All below.
- Follow-up: moved teacher Edit into its own right-side floating FAB, kept the center FAB focused on date + view mode, and added bottom calendar padding so the last table row does not end at the viewport edge.
- Made the mobile teacher edit FAB icon-only with an accessible label so the long All-date range does not collide with the right FAB.
- Follow-up: replaced the far-right edit FAB with an inline Edit control beside Week/Month/All and added scroll docking so the calendar date navigator moves into the app header after scrolling, leaving a shorter selector/Edit floating cluster.
- Rebase follow-up: rebased `codex/calendar-fab-pattern` onto latest `origin/main` without conflicts; branch has no added migrations to resequence and duplicate migration prefix check was clean.

**Validation:**
- `pnpm lint`
- `pnpm test tests/components/calendar-view-persistence.test.tsx tests/components/StudentLessonCalendarTab.test.tsx tests/components/LessonCalendar.test.tsx`
- `pnpm build`
- `pnpm test`
- Pika UI verification script for teacher/student calendar capture:
  - `/tmp/pika-teacher.png`
  - `/tmp/pika-student.png`
  - `/tmp/pika-teacher-mobile.png`
- Manual Playwright screenshots after role-specific classroom routing and loaded-state waits:
  - `/tmp/pika-teacher-calendar-week.png`
  - `/tmp/pika-teacher-calendar-mobile-week-2.png`
  - `/tmp/pika-teacher-calendar-mobile-all-2.png`
  - `/tmp/pika-student-calendar-mobile-week.png`
  - `/tmp/pika-student-calendar-mobile-all.png`
  - `/tmp/pika-teacher-calendar-dark.png`
- Follow-up validation:
  - `pnpm lint`
  - `pnpm test tests/components/calendar-view-persistence.test.tsx tests/components/StudentLessonCalendarTab.test.tsx tests/components/LessonCalendar.test.tsx`
  - `pnpm build`
  - `/tmp/pika-teacher-calendar-selector-below.png`
  - `/tmp/pika-teacher-calendar-mobile-selector-below.png`
  - `/tmp/pika-teacher-calendar-mobile-all-selector-below.png`
  - `/tmp/pika-student-calendar-mobile-selector-below.png`
  - `/tmp/pika-student-calendar-mobile-all-selector-below.png`
- Edit-row follow-up validation:
  - `pnpm lint`
  - `pnpm test tests/components/calendar-view-persistence.test.tsx tests/components/StudentLessonCalendarTab.test.tsx tests/components/LessonCalendar.test.tsx`
  - `pnpm build`
  - `/tmp/pika-teacher-calendar-edit-top-right.png`
  - `/tmp/pika-teacher-calendar-mobile-edit-top-right.png`
  - `/tmp/pika-teacher-calendar-mobile-all-edit-top-right.png`
  - `/tmp/pika-student-calendar-mobile-edit-top-right.png`
- Independent-FAB/bottom-buffer follow-up validation:
  - `pnpm lint`
  - `pnpm test tests/components/calendar-view-persistence.test.tsx tests/components/LessonCalendar.test.tsx tests/components/StudentLessonCalendarTab.test.tsx tests/components/TeacherEditModeControls.test.tsx`
  - `pnpm build`
  - `/tmp/pika-teacher.png`
  - `/tmp/pika-teacher-mobile-compact-edit-loaded.png`
  - `/tmp/pika-teacher-calendar-mobile-all-bottom-compact-edit.png`
  - `/tmp/pika-teacher-calendar-desktop-all-bottom.png`
  - `/tmp/pika-student-calendar-valid.png`
  - `/tmp/pika-student-calendar-mobile-all-bottom-buffer.png`
  - `/tmp/pika-teacher-calendar-320-all-compact-edit.png`
- Scroll-docked date follow-up validation:
  - `pnpm lint`
  - `pnpm test tests/components/calendar-view-persistence.test.tsx tests/components/LessonCalendar.test.tsx tests/components/StudentLessonCalendarTab.test.tsx tests/components/TeacherEditModeControls.test.tsx`
  - `pnpm test tests/components/ClassroomPageClientAssignmentsEditMode.test.tsx tests/components/TeacherClassroomView.test.tsx`
  - `pnpm build`
  - `/tmp/pika-calendar-scroll-teacher-initial-desktop.png`
  - `/tmp/pika-calendar-scroll-teacher-scrolled-desktop.png`
  - `/tmp/pika-calendar-scroll-teacher-initial-mobile.png`
  - `/tmp/pika-calendar-scroll-teacher-scrolled-mobile.png`
  - `/tmp/pika-calendar-scroll-student-scrolled-mobile.png`
- Rebase validation:
  - `pnpm lint`
  - `pnpm test tests/components/calendar-view-persistence.test.tsx tests/components/LessonCalendar.test.tsx tests/components/StudentLessonCalendarTab.test.tsx tests/components/TeacherEditModeControls.test.tsx tests/components/ClassroomPageClientAssignmentsEditMode.test.tsx tests/components/TeacherClassroomView.test.tsx`
  - `pnpm build`
  - `git -C "$PIKA_WORKTREE" diff --name-only --diff-filter=A origin/main -- supabase/migrations`
  - duplicate migration prefix check returned no output

## 2026-05-06 — Make classroom log summaries cron-only

**Completed:**
- Removed on-demand OpenAI generation from the teacher log-summary API; it now only returns fresh cached nightly summaries.
- Added `summary_status` so the Daily pane can show pending nightly summaries separately from dates with no logs.
- Filtered nightly log-summary cron work to active classrooms with logs and clarified that removed `entry_summaries` are distinct from active classroom/day `log_summaries`.

**Validation:**
- `pnpm exec vitest tests/api/cron/nightly-log-summaries.test.ts tests/api/teacher/log-summary.test.ts`
- `pnpm lint`
- `bash scripts/verify-env.sh`
- Pika UI verification script for `/classrooms/751b1dfb-ec79-46fc-b4f6-24f97911ecea?tab=attendance` on port 3001:
  - `/tmp/pika-teacher.png`
  - `/tmp/pika-student.png`
  - `/tmp/pika-teacher-mobile.png`

## 2026-05-06 — Speed up Daily student log cycling

**Completed:**
- Added a batched `history_preview` payload to the teacher logs API, capped at five entries per student.
- Rendered selected-day and preview history immediately when a teacher selects a student, while refreshing exact history through a short-lived client cache.
- Filtered blank/absent entries out of the history pane so absent selected days do not render empty selected-date blocks.

**Validation:**
- `pnpm exec vitest tests/api/teacher/logs.test.ts tests/api/teacher/student-history.test.ts tests/components/StudentLogHistory.test.tsx`
- `pnpm lint`
- `bash scripts/verify-env.sh`
- Pika UI verification script for `/classrooms/751b1dfb-ec79-46fc-b4f6-24f97911ecea?tab=attendance` on port 3001:
  - `/tmp/pika-teacher.png`
  - `/tmp/pika-student.png`
  - `/tmp/pika-teacher-mobile.png`
- Targeted selected-history screenshots:
  - `/tmp/pika-teacher-selected-history.png`
  - `/tmp/pika-teacher-mobile-selected-history.png`

## 2026-05-06 — Make deselected Daily table full-width

**Completed:**
- Changed the Daily tab so the deselected state is a full-width student table instead of a split summary pane.
- Added a one-line `Log` column in the full-width table with ellipsis overflow and native title text for the full day log.
- Kept selected students in the split history view, and restored the full-width log table after row deselection.

**Validation:**
- `pnpm exec vitest tests/components/TeacherAttendanceTab.test.tsx tests/components/StudentLogHistory.test.tsx tests/api/teacher/logs.test.ts`
- `pnpm lint`
- `bash scripts/verify-env.sh`
- Pika UI verification script for `/classrooms/751b1dfb-ec79-46fc-b4f6-24f97911ecea?tab=attendance` on port 3001:
  - `/tmp/pika-teacher.png`
  - `/tmp/pika-student.png`
  - `/tmp/pika-teacher-mobile.png`
- Targeted Daily screenshots:
  - `/tmp/pika-teacher-desktop-daily-log-table.png`
  - `/tmp/pika-teacher-desktop-daily-selected.png`
  - `/tmp/pika-teacher-desktop-daily-deselected.png`
  - `/tmp/pika-teacher-mobile-daily-log-table.png`
  - `/tmp/pika-teacher-mobile-daily-selected.png`
  - `/tmp/pika-teacher-mobile-daily-deselected.png`

## 2026-05-06 — Polish Daily row deselection

**Completed:**
- Added Escape-key deselection while a Daily student row is selected.
- Removed the first-render split flash by setting the gapped inspector width CSS variable immediately, before the window-size hook resolves.
- Added regression coverage for Escape deselection and first-render gapped split sizing.

**Validation:**
- `pnpm exec vitest tests/components/TeacherAttendanceTab.test.tsx tests/components/TeacherWorkspaceSplit.test.tsx`
- `pnpm lint`
- `bash scripts/verify-env.sh`
- Pika UI verification script for `/classrooms/751b1dfb-ec79-46fc-b4f6-24f97911ecea?tab=attendance` on port 3001:
  - `/tmp/pika-teacher.png`
  - `/tmp/pika-student.png`
  - `/tmp/pika-teacher-mobile.png`
- Targeted transition screenshots:
  - `/tmp/pika-teacher-esc-before-select.png`
  - `/tmp/pika-teacher-select-immediate-split.png`
  - `/tmp/pika-teacher-after-escape-deselect.png`

## 2026-05-06 — Deselect Daily row on outside click

**Completed:**
- Added outside-click deselection for the selected Daily workspace while preserving clicks inside the table/history split.
- Kept row clicks, Escape, and keyboard table deselection flowing through the same deselect handler.
- Re-ran visual verification against this worktree on port 3002 after finding port 3001 belonged to another checkout.

**Validation:**
- `pnpm exec vitest tests/components/TeacherAttendanceTab.test.tsx`
- `pnpm lint`
- `bash scripts/verify-env.sh`
- Pika UI verification script for `/classrooms/751b1dfb-ec79-46fc-b4f6-24f97911ecea?tab=attendance` on port 3002:
  - `/tmp/pika-teacher.png`
  - `/tmp/pika-student.png`
  - `/tmp/pika-teacher-mobile.png`
- Targeted outside-click screenshots:
  - `/tmp/pika-teacher-outside-click-selected.png`
  - `/tmp/pika-teacher-outside-click-deselected.png`

## 2026-05-06 — Smooth Daily selection transitions

**Completed:**
- Added short opacity/transform entry animations for the full-width Daily table, selected split workspace, and history inspector pane.
- Added reduced-motion CSS so those animations are disabled for users who request less motion.
- Replaced the Daily initial-load state flag with a ref to avoid a redundant same-date refetch that could clear selection immediately after a row click.

**Validation:**
- `pnpm exec vitest tests/components/TeacherAttendanceTab.test.tsx`
- `pnpm lint`
- `bash scripts/verify-env.sh`
- Pika UI verification script for `/classrooms/751b1dfb-ec79-46fc-b4f6-24f97911ecea?tab=attendance` on port 3002:
  - `/tmp/pika-teacher.png`
  - `/tmp/pika-student.png`
  - `/tmp/pika-teacher-mobile.png`
- Targeted animation screenshots and computed CSS check:
  - `/tmp/pika-teacher-daily-animated-selected.png`
  - `/tmp/pika-teacher-daily-animated-deselected.png`

## 2026-05-06 — Pre-PR review fixes for log previews

**Completed:**
- Rebased the branch onto `origin/main` after `Constrain split-pane workspace scrolling` landed.
- Kept main's split-pane scroll containment while preserving the Daily selection animations and outside-click deselection.
- Reworked `history_preview` to use a service-role-only database RPC with a lateral query so the preview cap is truly five entries per student, not a shared global limit.

**Validation:**
- `pnpm exec vitest tests/api/teacher/logs.test.ts`
- `pnpm exec vitest tests/api/teacher/logs.test.ts tests/components/StudentLogHistory.test.tsx tests/components/TeacherAttendanceTab.test.tsx tests/api/cron/nightly-log-summaries.test.ts tests/api/teacher/log-summary.test.ts tests/components/TeacherWorkspaceSplit.test.tsx`
- `bash scripts/verify-env.sh --full`
- Re-ran Pika UI verification on port 3002 after adding the RPC deployment-order fallback:
  - `/tmp/pika-teacher.png`
  - `/tmp/pika-student.png`
  - `/tmp/pika-teacher-mobile.png`
- Re-ran targeted Daily selected/deselected browser check:
  - `/tmp/pika-teacher-daily-animated-selected.png`
  - `/tmp/pika-teacher-daily-animated-deselected.png`

## 2026-05-06 — Restore Daily class summary placement

**Completed:**
- Restored the cached class log summary in the deselected Daily state as a full-width panel below the full-width student log table.
- Kept the selected-student state focused on the split table/history pane, with the class summary hidden until deselection.
- Added regression coverage so the class summary remains visible in the deselected table state and disappears during student-history selection.

**Validation:**
- `pnpm exec vitest tests/components/TeacherAttendanceTab.test.tsx tests/api/teacher/log-summary.test.ts`
- `pnpm lint && pnpm build`
- Pika UI verification script for `/classrooms/751b1dfb-ec79-46fc-b4f6-24f97911ecea?tab=attendance` on port 3002:
  - `/tmp/pika-teacher.png`
  - `/tmp/pika-student.png`
  - `/tmp/pika-teacher-mobile.png`
- Targeted Daily class summary screenshots/check:
  - `/tmp/pika-teacher-summary-restored.png`
  - `/tmp/pika-teacher-daily-summary-selected.png`
  - `/tmp/pika-teacher-daily-summary-deselected.png`

## 2026-05-06 — Fix PR coverage gate

**Completed:**
- Investigated the failed GitHub CI run on the first PR commit.
- Found the failure was a per-file coverage threshold miss for `src/app/api/teacher/log-summary/route.ts`.
- Added route tests for classroom-not-found, entry-stats failure, and entry-count failure to cover the cron-only summary endpoint error branches.

**Validation:**
- `pnpm run test:coverage`
- `pnpm lint`

## 2026-05-06 — Restrict nightly log summaries to class days

**Completed:**
- Tightened `/api/cron/nightly-log-summaries` eligibility so AI summaries only run for unarchived classrooms with entries on yesterday, yesterday inside the classroom semester range, and an explicit `class_days.is_class_day = true` row.
- Added a per-classroom eligibility recheck before the OpenAI call to keep the guard close to generation.
- Added cron route tests for outside-semester and non-class-day cases and asserted they do not call OpenAI.

**Validation:**
- `pnpm vitest run tests/api/cron/nightly-log-summaries.test.ts`
- `pnpm lint`
- `pnpm test -- tests/api/cron/nightly-log-summaries.test.ts` (ran full suite: 251 files, 2110 tests)

## 2026-05-06 — Fix cron coverage gate

**Completed:**
- Addressed the latest CI failure for `src/app/api/cron/nightly-log-summaries/route.ts` per-file coverage.
- Added cron route tests for entry discovery errors, class-day discovery errors, and eligibility recheck skip paths.

**Validation:**
- `pnpm vitest run tests/api/cron/nightly-log-summaries.test.ts`
- `pnpm run test:coverage`
- `pnpm lint`

## 2026-05-07 — Allow late assignment submissions with repo metadata

**Completed:**
- Fixed assignment submit validation so saved repo metadata counts as submittable work, matching the student editor's Submit button rule.
- Made the student assignment editor flush pending repo URL/GitHub username edits before calling the submit endpoint.
- Added regression coverage for a past-due repo-only assignment submission.

**Validation:**
- `bash scripts/verify-env.sh`
- `pnpm test -- tests/api/assignment-docs/submit.test.ts` (ran full suite: 251 files, 2119 tests)
- `pnpm test -- tests/unit/assignments.test.ts` (ran full suite: 251 files, 2119 tests)
- `pnpm lint`
- `pnpm build`

## 2026-05-07 — Compact MC answer review

**Completed:**
- Added a shared compact multiple-choice option review component that preserves original option order and uses a fixed check/X gutter.
- Replaced the separate student/correct answer blocks in returned student test results and teacher test grading with the compact full-option list.
- Put unanswered MC state in the short question meta line as `No answer`.

**Validation:**
- `pnpm vitest run tests/components/StudentQuizResults.test.tsx tests/components/TestStudentGradingPanel.test.tsx`
- `pnpm lint`
- `pnpm build`
- Visual screenshots on port 3003:
  - `/tmp/pika-compact-mc-teacher.png`
  - `/tmp/pika-compact-mc-teacher-mobile.png`
  - `/tmp/pika-compact-mc-student-mobile.png`
- `pnpm test`

## 2026-05-06 — Separate Materials and Syllabus branch

**Completed:**
- Created isolated branch/worktree `codex/materials-syllabus` from `origin/main`, separate from the existing `codex/classwork-tab` exploration.
- Renamed visible Assignments navigation to Classwork and Resources navigation to Syllabus while keeping existing query-tab compatibility.
- Added ungraded Classwork Materials with teacher CRUD APIs/UI, student read UI/API, and a `classwork_materials` migration.
- Replaced the Resources tab surface with a syllabus/course-site entry point that opens a published course site or points teachers to Course Website Settings.
- Renamed teacher-facing "Actual Course Website" copy to "Course Website" in Settings.
- Added a simplified public syllabus grading summary to `/actual/[slug]`, including category weights and per-item approximate course weights from gradebook settings plus point values.
- Embedded the published syllabus inside the Pika Syllabus tab for teachers and students, with an `Open External` action for the standalone `/actual/<slug>` page.

**Validation:**
- `bash scripts/verify-env.sh`
- `pnpm test tests/api/teacher/materials.test.ts tests/api/student/materials.test.ts tests/components/ResourcesTab.test.tsx tests/components/NavItems.test.tsx tests/components/StudentAssignmentsTab.test.tsx tests/components/TeacherClassroomView.test.tsx tests/components/ClassroomPageClientAssignmentsEditMode.test.tsx`
- `pnpm lint`
- `pnpm test`
- `pnpm build`
- `pnpm test`
- Pika UI verification for Classwork and Syllabus on `/classrooms/751b1dfb-ec79-46fc-b4f6-24f97911ecea`:
  - `/tmp/pika-teacher.png`
  - `/tmp/pika-student.png`
  - `/tmp/pika-teacher-mobile.png`
- Focused Playwright screenshots:
  - `/tmp/pika-classwork-new-menu.png`
  - `/tmp/pika-material-dialog.png`
  - `/tmp/pika-course-website-settings.png`
  - `/tmp/pika-actual-syllabus-grading.png`
  - `/tmp/pika-actual-syllabus-grading-mobile.png`
  - Re-ran Syllabus tab visual verification after embedding the preview:
    - `/tmp/pika-teacher.png`
    - `/tmp/pika-student.png`
    - `/tmp/pika-teacher-mobile.png`

## 2026-05-06 — Rebase materials branch and align Announcements action

**Completed:**
- Rebasing `codex/materials-syllabus` onto `origin/main` completed cleanly, leaving the branch at `0 0` ahead/behind.
- Resequenced the new classwork materials migration from `064_classwork_materials.sql` to `065_classwork_materials.sql` after `origin/main` added `064_teacher_log_history_preview_rpc.sql`.
- Moved the Announcements teacher create action into the shared centered floating work-surface action cluster and removed the old bottom `New Announcement` button.

**Validation:**
- `pnpm lint`
- `pnpm test tests/api/teacher/announcements.test.ts tests/api/teacher/announcements-id.test.ts tests/api/student/announcements.test.ts`
- `pnpm build`
- `git diff --check`
- Duplicate migration prefix check
- Pika UI verification for Announcements on `/classrooms/751b1dfb-ec79-46fc-b4f6-24f97911ecea?tab=announcements`:
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
