# Pika Session Log

Rolling recent session log for AI/human handoffs. Keep this file small; full historical session history lives in `.ai/JOURNAL-ARCHIVE.md`.

**Rules:**
- Append one concise entry for meaningful work at the end of a session.
- Run `node scripts/trim-session-log.mjs` after appending to keep only the latest 20 entries.
- Use `.ai/JOURNAL-ARCHIVE.md` only for historical investigation.

## 2026-05-13 — Teacher test grading closed-access refresh

**Completed:**
- Stopped the teacher tests grading workspace from starting the background grade poll when every student has closed effective access.
- Reused the same effective-access helper for polling decisions, batch action counts, and row access icons.
- Added regression coverage for an active test whose access is closed for all students so the `Refreshing grades` status does not appear.

**Validation:**
- `PIKA_WORKTREE=/Users/stew/Repos/.worktrees/pika/close-test-refresh-notice bash .codex/skills/pika-session-start/scripts/session_start.sh`
- `pnpm test tests/components/TeacherTestsTab.test.tsx`
- `pnpm lint`
- `PIKA_WORKTREE=/Users/stew/Repos/.worktrees/pika/close-test-refresh-notice E2E_BASE_URL=http://localhost:3001 bash .codex/skills/pika-ui-verify/scripts/ui_verify.sh 'classrooms/5fcf845d-220d-4321-8409-5afe9e9459c3?tab=tests'`
- Closed selected test workspace browser check after 16.5s: no `Refreshing grades` status and no console errors; screenshots `/tmp/pika-teacher-closed-test-workspace.png` and `/tmp/pika-teacher-closed-test-selected-student.png`
- `pnpm test`

## 2026-05-13 — Selected test pane scrolling

**Completed:**
- Updated the selected teacher test grading workspace to frame the grading table and response inspector with the same full-height pane pattern used by assignment workspaces.
- Made the student grading table fill the left pane and keep its own scroll container.
- Made the selected student response inspector keep its own right-pane scroll container.
- Added regression coverage for the selected test grading pane scroll containers.

**Validation:**
- `PIKA_WORKTREE=/Users/stew/Repos/.worktrees/pika/test-pane-scroll bash .codex/skills/pika-session-start/scripts/session_start.sh`
- `pnpm test tests/components/TeacherTestsTab.test.tsx`
- `pnpm lint`
- `E2E_BASE_URL=http://localhost:3001 PIKA_WORKTREE=/Users/stew/Repos/.worktrees/pika/test-pane-scroll bash .codex/skills/pika-ui-verify/scripts/ui_verify.sh 'classrooms/5fcf845d-220d-4321-8409-5afe9e9459c3?tab=tests&testId=92120fed-7145-4118-a8ad-117e7962d679&testMode=grading&testStudentId=23977f0b-efb8-4408-98cb-2e6887c4fd7e'`
- DOM scroll check: window stayed at `scrollY=0`, left table pane filled the workspace, right inspector reported `overflow-y: auto` with independent scroll.
- Temporary sample tests were seeded for the visual capture and removed afterward; the shared classroom test list returned to empty.
- `pnpm test`

## 2026-05-13 — Teacher test student arrow navigation

**Completed:**
- Put the selected teacher test grading student list on the shared `KeyboardNavigableTable` and `DataTable` primitives used by assignment student tables.
- Extended `KeyboardNavigableTable` so it can own scroll-pane props like `className`, `data-testid`, and `onScroll` while preserving its arrow-key selection behavior.
- Added regression coverage for moving the selected test student with ArrowDown and ArrowUp.

**Validation:**
- `PIKA_WORKTREE=/Users/stew/Repos/.worktrees/pika/test-arrow-key-navigation bash .codex/skills/pika-session-start/scripts/session_start.sh`
- `pnpm test tests/components/TeacherTestsTab.test.tsx tests/components/DataTable.test.tsx tests/components/TeacherAssignmentStudentTable.test.tsx`
- `pnpm lint`
- `E2E_BASE_URL=http://localhost:3001 PIKA_WORKTREE=/Users/stew/Repos/.worktrees/pika/test-arrow-key-navigation bash .codex/skills/pika-ui-verify/scripts/ui_verify.sh 'classrooms/5fcf845d-220d-4321-8409-5afe9e9459c3?tab=tests&testId=88a8b3b5-7559-417e-8d16-c53175a3d692&testMode=grading&testStudentId=23977f0b-efb8-4408-98cb-2e6887c4fd7e'`
- Browser smoke check: clicked the selected student row, pressed ArrowDown, and confirmed the URL, selected row, and grading inspector moved from Student1 to Student2.
- Temporary verification test `88a8b3b5-7559-417e-8d16-c53175a3d692` was deleted after screenshots and browser checks.
- `pnpm build`
- `pnpm test`

## 2026-05-13 — Chrome plugin UI verification guidance

**Completed:**
- Documented Playwright as the required final path for E2E tests, UI verification scripts, and screenshot artifacts.
- Clarified that Chrome plugin checks are supplemental for exploratory debugging, browser-profile behavior, remote auth, extension, cookie, and interactive inspection cases.
- Updated the AI routing doc, UI testing guide, testing strategy, and Codex UI verification prompt.

**Validation:**
- `PIKA_WORKTREE=/Users/stew/Repos/.worktrees/pika/chrome-ui-guidance bash .codex/skills/pika-session-start/scripts/session_start.sh`
- `pnpm test tests/unit/ai-startup-docs.test.ts tests/unit/ui-guidance-docs.test.ts tests/unit/ui-guidance-candidate-script.test.ts`

## 2026-05-13 — Classroom list edit control placement

**Completed:**
- Moved the teacher classroom list edit pen from the top floating cluster into the bottom controls beside the Active/Archived segmented toggle.
- Removed the no-longer-needed top padding on the classroom list and updated the focused component test to assert the new bottom placement.

**Validation:**
- `PIKA_WORKTREE=/Users/stew/Repos/.worktrees/pika/classroom-list-edit-pen bash .codex/skills/pika-session-start/scripts/session_start.sh`
- `pnpm test tests/components/TeacherClassroomsIndex.test.tsx`
- `pnpm lint`
- `E2E_BASE_URL=http://localhost:3001 PIKA_WORKTREE=/Users/stew/Repos/.worktrees/pika/classroom-list-edit-pen bash .codex/skills/pika-ui-verify/scripts/ui_verify.sh classrooms`
- Extra teacher edit-mode captures: `/tmp/pika-teacher-edit.png`, `/tmp/pika-teacher-mobile-edit.png`

## 2026-05-13 — Classwork surveys

**Completed:**
- Added surveys as ungraded Classwork items with draft/active/closed status, classwork ordering, and teacher/student API routes.
- Added survey question types for multiple choice, short text, and link responses, including response validation and link normalization.
- Added a dynamic responses toggle so students can update answers while an active survey remains open.
- Fixed the responded-student status priority so dynamic surveys remain updateable even when class results are visible.
- Added teacher survey creation/settings, question editing, class results, survey cards, and student survey cards/response form/results support.
- Added the Supabase migration `068_surveys_classwork.sql` for surveys, questions, responses, RLS, and mixed classwork ordering RPC support.
- Kept Classwork assignment/material loading resilient if the surveys endpoint is unavailable before the migration is applied.
- Rebased the worktree onto `origin/main` and resequenced the survey migration after `067_classwork_mixed_ordering.sql`.

**Validation:**
- `bash scripts/verify-env.sh`
- `pnpm test tests/unit/surveys.test.ts tests/lib/classwork-order.test.ts tests/unit/classwork-migration-rpc-grants.test.ts`
- `pnpm test tests/components/StudentAssignmentsTab.test.tsx tests/components/TeacherClassroomView.test.tsx tests/unit/surveys.test.ts`
- `pnpm test tests/unit/surveys.test.ts tests/components/StudentAssignmentsTab.test.tsx tests/components/TeacherClassroomView.test.tsx`
- `pnpm lint`
- `pnpm test -- --maxWorkers=4`
- `pnpm build`
- `git rev-list --left-right --count origin/main...HEAD` -> `0 0`
- Migration prefix duplicate check returned no duplicates.
- `E2E_BASE_URL=http://localhost:3000 pnpm e2e:auth`
- Standard UI verify for live teacher/student Classwork pages:
  - `/tmp/pika-teacher.png`
  - `/tmp/pika-student.png`
  - `/tmp/pika-teacher-mobile.png`
- Mocked survey UI verification for migration-independent teacher/student survey states:
  - `/tmp/pika-survey-teacher-classwork.png`
  - `/tmp/pika-survey-teacher-modal.png`
  - `/tmp/pika-survey-teacher-workspace.png`
  - `/tmp/pika-survey-student-classwork.png`
  - `/tmp/pika-survey-student-form.png`

## 2026-05-13 — Quiz and survey source editors

**Completed:**
- Generalized the test editor-only/markdown-only authoring layout so quizzes can use the same modal Code toggle flow without test documents.
- Added quiz markdown source serialization/parsing and draft source persistence for AI-friendly quiz authoring.
- Added a survey Code view with markdown serialization/parsing for multiple-choice, short-text, and link questions, including title/results/dynamic settings.
- Let survey question POST/PATCH accept explicit `position` so markdown apply preserves source order.
- Added route, parser, and component coverage for the new quiz/survey source authoring paths.

**Validation:**
- `pnpm test tests/lib/quiz-markdown.test.ts tests/unit/surveys.test.ts tests/components/QuizDetailPanel.test.tsx tests/components/TeacherQuizzesTab.test.tsx tests/api/teacher/surveys-questions-route.test.ts tests/api/teacher/surveys-questions-id.test.ts`
- `pnpm lint`
- `pnpm build`
- `pnpm test`
- `PIKA_WORKTREE=/Users/stew/Repos/.worktrees/pika/surveys-classwork bash /Users/stew/Repos/pika/.codex/skills/pika-ui-verify/scripts/ui_verify.sh 'classrooms/5fcf845d-220d-4321-8409-5afe9e9459c3?tab=assignments'`
- Additional teacher screenshots:
  - `/tmp/pika-quiz-edit-modal.png`
  - `/tmp/pika-quiz-code-modal.png`
  - `/tmp/pika-survey-code.png`

## 2026-05-13 — Survey setup parity

**Completed:**
- Extracted a shared assessment setup dialog shell and routed quiz/test setup plus survey setup through it.
- Updated new survey creation to use the same full-screen assessment setup frame as quiz/test creation.
- After creating a survey, route the teacher directly into the new survey workspace with Code authoring selected.
- Added component coverage for survey setup chrome and the created-survey Code-mode handoff.

**Validation:**
- `pnpm test tests/components/QuizModal.test.tsx tests/components/SurveyModal.test.tsx tests/components/TeacherSurveyWorkspace.test.tsx`
- `pnpm lint`
- `pnpm build`
- `pnpm test`
- `PIKA_WORKTREE=/Users/stew/Repos/.worktrees/pika/surveys-classwork E2E_BASE_URL=http://localhost:3001 bash /Users/stew/Repos/pika/.codex/skills/pika-ui-verify/scripts/ui_verify.sh 'classrooms/5fcf845d-220d-4321-8409-5afe9e9459c3?tab=assignments'`
- Additional teacher screenshots:
  - `/tmp/pika-survey-create-modal.png`
  - `/tmp/pika-survey-create-modal-mobile.png`
  - `/tmp/pika-survey-created-code.png`

## 2026-05-13 — Survey workspace modal routing

**Completed:**
- Changed teacher survey cards and `surveyId` routes to open `TeacherSurveyWorkspace` in a dialog over the Classwork summary instead of replacing the main content pane.
- Kept survey creation handoff to Code mode while returning the pane selection/cookie to the Classwork summary.
- Added regression coverage for card-opened and routed survey modals preserving the classwork list behind the dialog.

**Validation:**
- `pnpm test tests/components/TeacherClassroomView.test.tsx tests/components/TeacherSurveyWorkspace.test.tsx tests/components/SurveyModal.test.tsx`
- `pnpm lint`
- `pnpm build`
- `pnpm test`
- `PIKA_WORKTREE=/Users/stew/Repos/.worktrees/pika/surveys-classwork E2E_BASE_URL=http://localhost:3001 bash /Users/stew/Repos/pika/.codex/skills/pika-ui-verify/scripts/ui_verify.sh 'classrooms/5fcf845d-220d-4321-8409-5afe9e9459c3?tab=assignments'`
- Additional survey modal screenshots:
  - `/tmp/pika-survey-modal-desktop.png`
  - `/tmp/pika-survey-modal-mobile.png`

## 2026-05-13 — Survey setup form parity

**Completed:**
- Extracted the shared quiz/test setup body into `AssessmentSetupForm` with the common title field, footer actions, and checkbox control.
- Routed both `QuizModal` and `SurveyModal` through the shared setup form so survey creation matches quiz/test creation structure.
- Removed the survey-specific settings box from creation; survey options now sit in the same plain form rhythm as the quiz/test controls.

**Validation:**
- `pnpm test tests/components/QuizModal.test.tsx tests/components/SurveyModal.test.tsx`
- `pnpm lint`
- `pnpm build`
- `pnpm test`
- `PIKA_WORKTREE=/Users/stew/Repos/.worktrees/pika/surveys-classwork E2E_BASE_URL=http://localhost:3002 bash /Users/stew/Repos/pika/.codex/skills/pika-ui-verify/scripts/ui_verify.sh 'classrooms/5fcf845d-220d-4321-8409-5afe9e9459c3?tab=assignments'`
- Additional survey creation screenshots:
  - `/tmp/pika-survey-create-shared-desktop.png`
  - `/tmp/pika-survey-create-shared-mobile.png`

## 2026-05-13 — Student survey review fixes

**Completed:**
- Preserved saved link responses as `question_type: 'link'` in the student survey detail payload.
- Removed classmate `student_id` values from student-visible survey result responses.
- Added API regression coverage for link response discriminants and student result payload privacy.

**Validation:**
- `bash scripts/verify-env.sh`
- `pnpm test tests/api/student/surveys-route.test.ts`
- `pnpm lint`

## 2026-05-14 — Survey review follow-up fixes

**Completed:**
- Trimmed the rolling session log and shortened the new survey feature entry to restore startup-budget tests.
- Reserved survey positions when assignment markdown bulk-save recomputes assignment positions.
- Replaced the assignment-preserve reorder RPC in the survey migration so it skips both material and survey positions.

**Validation:**
- `pnpm test tests/unit/ai-startup-docs.test.ts tests/api/teacher/assignments-bulk.test.ts tests/api/teacher/assignments-reorder.test.ts tests/unit/classwork-migration-rpc-grants.test.ts`
- `bash scripts/verify-env.sh`
- `pnpm lint`
- `pnpm build`

## 2026-05-14 — Announcement calendar titles

**Completed:**
- Added nullable announcement titles with shared normalization and a 60-character limit.
- Wired title create/edit through teacher announcement APIs and UI, and displayed titles on teacher/student announcement cards.
- Updated calendar announcement pills and focused-day presentation to use titles with truncation, falling back to `Announcement` or `Scheduled`.

**Validation:**
- `pnpm test tests/unit/announcements.test.ts tests/api/teacher/announcements.test.ts tests/api/teacher/announcements-id.test.ts tests/components/LessonDayCell.test.tsx tests/components/AnnouncementsMarkdown.test.tsx tests/components/LessonCalendar.test.tsx`
- `pnpm lint`
- `pnpm test`
- `pnpm build`
- `PIKA_WORKTREE=/Users/stew/Repos/.worktrees/pika/announcement-calendar-title bash .codex/skills/pika-ui-verify/scripts/ui_verify.sh 'classrooms/5fcf845d-220d-4321-8409-5afe9e9459c3?tab=calendar'`
- Additional screenshots:
  - `/tmp/pika-teacher-titled-announcement.png`
  - `/tmp/pika-student-titled-announcement.png`
  - `/tmp/pika-teacher-announcement-title-form.png`

## 2026-05-14 — Interactive announcement calendar popups

**Completed:**
- Added an opt-in interactive mode to the shared tooltip wrapper so hoverable/clickable content is available without changing normal tooltip behavior.
- Enabled interactive popup behavior for calendar announcement tooltips, including weekend announcement indicators.
- Verified markdown links inside announcement popups remain reachable when moving the pointer from the calendar pill into the popup.

**Validation:**
- `pnpm test tests/components/LessonDayCell.test.tsx`
- `pnpm exec tsc --noEmit --pretty false`
- `pnpm test tests/components/LessonCalendar.test.tsx tests/components/AnnouncementsMarkdown.test.tsx`
- `pnpm lint`
- `pnpm build`
- `PIKA_WORKTREE=/Users/stew/Repos/.worktrees/pika/announcement-calendar-title bash .codex/skills/pika-ui-verify/scripts/ui_verify.sh 'classrooms/5fcf845d-220d-4321-8409-5afe9e9459c3?tab=calendar'`
- Targeted Playwright hover/click-actionability check with screenshot:
  - `/tmp/pika-announcement-popup-link-hover.png`

## 2026-05-14 — Announcement composer sizing

**Completed:**
- Increased teacher announcement create/edit textareas from 3 to 6 rows with a 10rem minimum height.
- Enabled vertical resize and autogrow behavior from textarea scroll height for longer announcement drafts.
- Added component coverage for the larger resizable creation textarea.

**Validation:**
- `PIKA_WORKTREE=/Users/stew/Repos/.worktrees/pika/announcement-calendar-title bash /Users/stew/Repos/pika/.codex/skills/pika-session-start/scripts/session_start.sh`
- `pnpm test tests/components/AnnouncementsMarkdown.test.tsx tests/api/teacher/announcements.test.ts tests/api/teacher/announcements-id.test.ts`
- `pnpm lint`
- `pnpm build`
- `PIKA_WORKTREE=/Users/stew/Repos/.worktrees/pika/announcement-calendar-title bash .codex/skills/pika-ui-verify/scripts/ui_verify.sh 'classrooms/5fcf845d-220d-4321-8409-5afe9e9459c3?tab=announcements'`
- Additional screenshots:
  - `/tmp/pika-announcement-create-textarea.png`
  - `/tmp/pika-announcement-create-textarea-mobile.png`

## 2026-05-14 — Announcement newest-first ordering

**Completed:**
- Added a shared newest-first announcement sorter based on `created_at`.
- Updated teacher announcement display so scheduled announcements no longer jump ahead of newer published announcements.
- Applied the same client-side newest-first display ordering for student announcements.

**Validation:**
- `pnpm test tests/unit/announcements.test.ts tests/components/AnnouncementsMarkdown.test.tsx tests/api/teacher/announcements.test.ts tests/api/student/announcements.test.ts`
- `pnpm lint`
- `pnpm build`
- `E2E_BASE_URL=http://localhost:3001 PIKA_WORKTREE=/Users/stew/Repos/.worktrees/pika/announcement-calendar-title bash .codex/skills/pika-ui-verify/scripts/ui_verify.sh 'classrooms/5fcf845d-220d-4321-8409-5afe9e9459c3?tab=announcements'`
- Targeted ordering screenshots:
  - `/tmp/pika-announcements-newest-first.png`
  - `/tmp/pika-student-announcements-newest-first.png`

## 2026-05-14 — Announcement title placeholder

**Completed:**
- Added an opt-in hidden-label mode to `FormField` so labels remain available to assistive tech without being visually shown.
- Removed the visible `Title` label above announcement title fields and changed the placeholder to `Title (optional)`.
- Applied the behavior to both create and edit announcement title inputs.

**Validation:**
- `pnpm test tests/components/AnnouncementsMarkdown.test.tsx tests/unit/announcements.test.ts`
- `pnpm lint`
- `pnpm build`
- `E2E_BASE_URL=http://localhost:3001 PIKA_WORKTREE=/Users/stew/Repos/.worktrees/pika/announcement-calendar-title bash .codex/skills/pika-ui-verify/scripts/ui_verify.sh 'classrooms/5fcf845d-220d-4321-8409-5afe9e9459c3?tab=announcements'`
- Targeted composer screenshot:
  - `/tmp/pika-announcement-title-placeholder.png`

## 2026-05-14 — Announcement composer ordering and split button

**Completed:**
- Moved the teacher announcement composer above the existing announcement list so the draft/new announcement area always stays at the top.
- Replaced the local hand-rolled Post/Schedule control with the shared `@/ui` `SplitButton`.
- Kept the existing schedule date/time picker by opening it from the shared split button's `Schedule...` menu item.

**Validation:**
- `pnpm test tests/components/AnnouncementsMarkdown.test.tsx tests/ui/SplitButton.test.tsx tests/unit/announcements.test.ts`
- `pnpm lint`
- `pnpm build`
- `E2E_BASE_URL=http://localhost:3005 PIKA_WORKTREE=/Users/stew/Repos/.worktrees/pika/announcement-calendar-title bash .codex/skills/pika-ui-verify/scripts/ui_verify.sh 'classrooms/5fcf845d-220d-4321-8409-5afe9e9459c3?tab=announcements'`
- Targeted composer screenshots:
  - `/tmp/pika-announcement-composer-top-splitbutton.png`
  - `/tmp/pika-announcement-composer-top-splitbutton-mobile.png`

## 2026-05-14 — Classroom list footer cleanup

**Completed:**
- Removed the classroom `New` action from archived view, including edit mode and the empty archived state.
- Hid the Active/Archived classroom view segmented control outside classroom edit mode.
- Restyled the fixed classroom footer as a classroom-card-width card with the view control centered and the edit icon anchored to the right edge.
- Removed the footer card outline while preserving the floating surface and shadow.
- Reset the classroom list back to Active whenever classroom edit mode is turned off from Archived view.
- Updated classroom index component tests for the new edit-mode-only view toggle behavior.

**Validation:**
- `bash .codex/skills/pika-session-start/scripts/session_start.sh`
- `pnpm test tests/components/TeacherClassroomsIndex.test.tsx tests/components/StudentClassroomsIndex.test.tsx`
- `pnpm lint`
- `PIKA_WORKTREE=/Users/stew/Repos/.worktrees/pika/classroom-list-footer-edit-mode E2E_BASE_URL=http://localhost:3001 bash .codex/skills/pika-ui-verify/scripts/ui_verify.sh classrooms`
- `PIKA_WORKTREE=/Users/stew/Repos/.worktrees/pika/classroom-list-footer-edit-mode E2E_BASE_URL=http://localhost:3010 bash .codex/skills/pika-ui-verify/scripts/ui_verify.sh classrooms`
- `npx playwright screenshot http://localhost:3010/classrooms /tmp/pika-teacher-footer-no-outline.png --load-storage .auth/teacher.json --viewport-size 1440,900 --wait-for-timeout 3000`
- Targeted Playwright flow: Edit → Archived → Edit off, confirmed `groupVisible=false` and `activeClassroomVisible=true`.
- Additional Playwright screenshots:
  - `/tmp/pika-teacher-edit.png`
  - `/tmp/pika-teacher-archived-edit.png`
  - `/tmp/pika-teacher-archived-view.png`
  - `/tmp/pika-teacher-edit-right.png`
  - `/tmp/pika-teacher-footer-no-outline.png`
  - `/tmp/pika-teacher-archived-exit-active.png`

## 2026-05-14 — Assignment workspace split-pane toggle

**Completed:**
- Replaced the assignment workspace class/individual segmented control with one cycling split-pane button for Students + grading, Content + grading, and Students + content.
- Updated the cycle button to show a compact numbered view indicator: `1` + grade icon, `2` + content icon, and `3` + table icon.
- Persisted the selected assignment pane view in browser session storage while keeping pane resizing on the shared teacher workspace split primitive.
- Added regression coverage for view cycling, session restore, and the updated panel composition.

**Validation:**
- `pnpm test tests/unit/assignment-grading-layout.test.ts tests/components/TeacherClassroomView.test.tsx tests/components/TeacherStudentWorkPanel.test.tsx`
- `pnpm test tests/components/TeacherClassroomView.test.tsx tests/unit/assignment-grading-layout.test.ts`
- `pnpm lint`
- `pnpm build`
- `E2E_BASE_URL=http://localhost:3100 pnpm e2e:auth`
- `PIKA_WORKTREE=/Users/stew/Repos/.worktrees/pika/student-assignment-split-views E2E_BASE_URL=http://localhost:3100 bash /Users/stew/Repos/.worktrees/pika/student-assignment-split-views/.codex/skills/pika-ui-verify/scripts/ui_verify.sh 'classrooms/5fcf845d-220d-4321-8409-5afe9e9459c3?tab=assignments'`
- Additional selected-workspace screenshots:
  - `/tmp/pika-assignment-view-1-students-grading.png`
  - `/tmp/pika-assignment-view-2-content-grading.png`
  - `/tmp/pika-assignment-view-3-students-content.png`
  - `/tmp/pika-assignment-mobile-view-1.png`
  - `/tmp/pika-assignment-mobile-view-2.png`
  - `/tmp/pika-assignment-desktop-1-students-grading-icons.png`
  - `/tmp/pika-assignment-desktop-2-content-grading-icons.png`
  - `/tmp/pika-assignment-desktop-3-students-content-icons.png`
  - `/tmp/pika-assignment-mobile-1-students-grading-icons.png`
  - `/tmp/pika-assignment-mobile-2-content-grading-icons.png`
  - `/tmp/pika-assignment-mobile-3-students-content-icons.png`
  - `/tmp/pika-assignment-desktop-1-students-grading-simple-icons-loaded.png`
  - `/tmp/pika-assignment-desktop-2-content-grading-simple-icons-loaded.png`
  - `/tmp/pika-assignment-desktop-3-students-content-simple-icons-loaded.png`
  - `/tmp/pika-assignment-mobile-1-students-grading-simple-icons-loaded.png`
  - `/tmp/pika-assignment-mobile-2-content-grading-simple-icons-loaded.png`
  - `/tmp/pika-assignment-mobile-3-students-content-simple-icons-loaded.png`
  - `/tmp/pika-assignment-desktop-1-students-grading-numbered-indicator.png`
  - `/tmp/pika-assignment-desktop-2-content-grading-numbered-indicator.png`
  - `/tmp/pika-assignment-desktop-3-students-content-numbered-indicator.png`
  - `/tmp/pika-assignment-mobile-1-students-grading-numbered-indicator.png`
  - `/tmp/pika-assignment-mobile-2-content-grading-numbered-indicator.png`
  - `/tmp/pika-assignment-mobile-3-students-content-numbered-indicator.png`
