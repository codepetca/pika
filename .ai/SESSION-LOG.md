# Pika Session Log

Rolling recent session log for AI/human handoffs. Keep this file small; full historical session history lives in `.ai/JOURNAL-ARCHIVE.md`.

**Rules:**
- Append one concise entry for meaningful work at the end of a session.
- Run `node scripts/trim-session-log.mjs` after appending to keep only the latest 20 entries.
- Use `.ai/JOURNAL-ARCHIVE.md` only for historical investigation.

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
