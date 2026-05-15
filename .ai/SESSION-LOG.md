# Pika Session Log

Rolling recent session log for AI/human handoffs. Keep this file small; full historical session history lives in `.ai/JOURNAL-ARCHIVE.md`.

**Rules:**
- Append one concise entry for meaningful work at the end of a session.
- Run `node scripts/trim-session-log.mjs` after appending to keep only the latest 20 entries.
- Use `.ai/JOURNAL-ARCHIVE.md` only for historical investigation.

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

## 2026-05-14 — Exit detection visibility

**Completed:**
- Rebasing checked `main` against `origin/main` and created worktree branch `codex/exit-detected-alert`.
- Rebased `codex/exit-detected-alert` onto `origin/main` at `43b57445`.
- Added a student exam-mode header pulse when the exits count increases, without pulsing on initial load.
- Kept the student header pulse from sticking if the exits count is reset while the pulse timer is active.
- Added a persistent cancellable teacher `Exit detected` alert for newly increased exits in test grading, targeting the first affected student row.
- Highlighted unreviewed student rows with amber emphasis and made nonzero exit counts render as amber badges.
- Cleared unreviewed row highlighting when the teacher clicks the alert or selects the affected row.

**Validation:**
- `bash scripts/verify-env.sh`
- `pnpm test tests/components/TeacherTestsTab.test.tsx tests/components/AppHeader.test.tsx`
- `pnpm test`
- `pnpm lint`
- `pnpm build`
- `E2E_BASE_URL=http://localhost:3002 pnpm e2e:auth`
- `E2E_BASE_URL=http://localhost:3002 pnpm e2e:verify assessment-ux-parity`
- Targeted Playwright screenshots:
  - `/tmp/pika-exit-alert-teacher.png`
  - `/tmp/pika-exit-pulse-student.png`
  - Chrome smoke:
  - Teacher on `localhost:3002`: temporary active test loaded in grading, polled a student focus exit, showed `Exit detected`, and clicking the alert selected the student/cleared the banner.
  - Student on `127.0.0.1:3002`: temporary active test started in exam mode and showed the exits indicator in Chrome.
  - Temporary test was deleted after the smoke.
  - Screenshots:
    - `/tmp/pika-chrome-smoke-teacher-alert.png`
    - `/tmp/pika-chrome-smoke-teacher-clicked.png`
    - `/tmp/pika-chrome-smoke-student-pulse.png`

## 2026-05-15 — Released assignment scheduling controls

**Completed:**
- Removed post/schedule split controls from the live assignment editor while keeping normal edit autosave/close behavior.
- Guarded assignment scheduling hook actions so live assignments do not attempt post, schedule, or revert-to-draft requests.
- Added regression coverage for live assignment edits saving without release fields and for live assignments exposing no scheduling actions.

**Validation:**
- `pnpm test tests/hooks/useAssignmentScheduling.test.ts tests/components/AssignmentModal.test.tsx`
- `pnpm lint`
- `pnpm test tests/api/teacher/assignments-id.test.ts tests/lib/assignment-schedule-validation.test.ts tests/unit/assignments.test.ts`
- `pnpm test`
- `pnpm build`
- UI verification on `http://localhost:3001`:
  - `PIKA_WORKTREE=/Users/stew/Repos/.worktrees/pika/fix-released-assignment-scheduling E2E_BASE_URL=http://localhost:3001 bash /Users/stew/Repos/.worktrees/pika/fix-released-assignment-scheduling/.codex/skills/pika-ui-verify/scripts/ui_verify.sh classrooms`
  - Targeted live-assignment editor screenshot: `/tmp/pika-live-assignment-editor.png`

## 2026-05-17 — Student exam-mode route-exit e2e

**Completed:**
- Added focused Playwright coverage for an active student test that blocks Home navigation, records route-exit telemetry, and preserves an autosaved open-response draft.
- Reused the existing student exam-mode e2e setup and cleanup helpers; no app logic or migrations changed.
- Environment setup required ignored symlinks for shared `node_modules` and `.env.local`.

**Validation:**
- `bash scripts/verify-env.sh`
- `pnpm lint`
- `pnpm exec tsc --noEmit --pretty false`
- `pnpm exec playwright test e2e/student-exam-mode.spec.ts --project=chromium-desktop` failed because the sandbox denied Next.js listening on `0.0.0.0:3000`.
- `HOSTNAME=127.0.0.1 E2E_BASE_URL=http://127.0.0.1:3020 pnpm exec playwright test e2e/student-exam-mode.spec.ts --project=chromium-desktop` failed for the same `listen EPERM` restriction on `0.0.0.0:3020`.

## 2026-05-17 — Exam route-exit e2e review fix

**Completed:**
- Tightened the student exam-mode route-exit e2e telemetry assertion so it scopes to the test documents pane instead of matching any visible `Exits` badge.
- Confirmed the narrow Playwright spec now runs successfully in the current environment.

**Validation:**
- `pnpm lint`
- `pnpm exec tsc --noEmit --pretty false`
- `pnpm exec playwright test e2e/student-exam-mode.spec.ts --project=chromium-desktop`

## 2026-05-15 — Assignment markdown modal

**Completed:**
- Moved teacher assignment-list markdown editing out of the right sidebar and into an `Edit Markdown` modal.
- Added `Edit Markdown` to the assignment summary FAB split-button dropdown when markdown is enabled.
- Reused the existing assignment markdown parse/save path, warning flow, and bulk sync API.
- Updated assignment markdown tests for explicit dropdown-driven modal opening.

**Validation:**
- `bash scripts/verify-env.sh`
- `pnpm test tests/components/ClassroomPageClientAssignmentsEditMode.test.tsx tests/components/TeacherClassroomView.test.tsx tests/api/teacher/assignments-bulk.test.ts`
- `pnpm lint`
- `pnpm build`
- `pnpm test`
- `E2E_BASE_URL=http://localhost:3001 pnpm e2e:auth`
- `PIKA_WORKTREE=/Users/stew/Repos/.worktrees/pika/assignment-markdown-modal E2E_BASE_URL=http://localhost:3001 bash /Users/stew/Repos/.worktrees/pika/assignment-markdown-modal/.codex/skills/pika-ui-verify/scripts/ui_verify.sh 'classrooms/5fcf845d-220d-4321-8409-5afe9e9459c3?tab=assignments'`
- Additional modal screenshots:
  - `/tmp/pika-teacher-assignment-markdown-modal.png`
  - `/tmp/pika-teacher-assignment-markdown-modal-mobile.png`

## 2026-05-15 — Assignment creation modal flow

**Completed:**
- Reworked the assignment modal into a narrower, more vertical authoring flow.
- Kept title and due date on the same form row and removed due-date previous/next arrow controls.
- Made assignment instructions always use the markdown editor toolbar.
- Moved rendered markdown into a separate `Assignment Preview` dialog opened by a Preview button.
- Updated assignment modal tests for the new preview dialog and always-visible markdown tools.

**Validation:**
- `pnpm lint`
- `pnpm test tests/components/AssignmentModal.test.tsx`
- `PIKA_WORKTREE=/Users/stew/Repos/.worktrees/pika/assignment-markdown-modal E2E_BASE_URL=http://localhost:3001 bash /Users/stew/Repos/.worktrees/pika/assignment-markdown-modal/.codex/skills/pika-ui-verify/scripts/ui_verify.sh 'classrooms/5fcf845d-220d-4321-8409-5afe9e9459c3?tab=assignments'`
- Additional modal screenshots:
  - `/tmp/pika-assignment-modal-desktop.png`
  - `/tmp/pika-assignment-modal-mobile.png`
  - `/tmp/pika-assignment-preview-dialog.png`

## 2026-05-16 — Assignment modal top row tightening

**Completed:**
- Removed the visible assignment modal header above the title field.
- Moved the post/schedule split button into the same first row as title and due date.
- Shortened compact title/date/action widths so the same-row layout holds on mobile.

**Validation:**
- `pnpm lint`
- `pnpm test tests/components/AssignmentModal.test.tsx`
- `PIKA_WORKTREE=/Users/stew/Repos/.worktrees/pika/assignment-markdown-modal E2E_BASE_URL=http://localhost:3001 bash /Users/stew/Repos/.worktrees/pika/assignment-markdown-modal/.codex/skills/pika-ui-verify/scripts/ui_verify.sh 'classrooms/5fcf845d-220d-4321-8409-5afe9e9459c3?tab=assignments'`
- Additional modal screenshots:
  - `/tmp/pika-assignment-modal-desktop.png`
  - `/tmp/pika-assignment-modal-mobile.png`
  - `/tmp/pika-assignment-preview-dialog.png`

## 2026-05-17 — Assignment modal close placement

**Completed:**
- Moved the assignment modal close button to an absolute upper-right corner position with minimal modal-edge padding.
- Removed the close button from the title/due/action row.
- Tightened the title input max width and matched compact due-date and post split-button widths.
- Removed the reserved right-side content padding so the close button no longer consumes modal content width.
- Made the close button borderless while keeping the same absolute corner hit target.
- Updated the assignment instructions preview to a narrower student-content render: no footer Close button, no draft-only subtitle, and direct markdown output.

**Validation:**
- `pnpm lint`
- `pnpm test tests/components/AssignmentModal.test.tsx`
- `PIKA_WORKTREE=/Users/stew/Repos/.worktrees/pika/assignment-markdown-modal E2E_BASE_URL=http://localhost:3001 bash /Users/stew/Repos/.worktrees/pika/assignment-markdown-modal/.codex/skills/pika-ui-verify/scripts/ui_verify.sh 'classrooms/5fcf845d-220d-4321-8409-5afe9e9459c3?tab=assignments'`
- Additional modal screenshots:
  - `/tmp/pika-assignment-modal-desktop.png`
  - `/tmp/pika-assignment-modal-mobile.png`
  - `/tmp/pika-assignment-preview-dialog.png`
## 2026-05-14 — Survey experience cleanup

**Completed:**
- Removed the back-to-Classwork link from student and teacher survey detail surfaces.
- Removed dynamic-survey labels from student cards/detail and teacher cards/detail, and renamed the teacher settings checkbox without the dynamic wording.
- Covered the earlier submit-gated survey results behavior before the follow-up timing split below.
- Aligned survey creation with test creation by making `New Survey` title-only in the shared full-screen assessment setup modal; survey options remain in compact edit/settings.

**Validation:**
- `bash scripts/verify-env.sh`
- `pnpm test tests/api/student/surveys-route.test.ts tests/components/SurveyModal.test.tsx tests/components/TeacherSurveyWorkspace.test.tsx tests/components/StudentAssignmentsTab.test.tsx`
- `pnpm test tests/components/SurveyModal.test.tsx tests/components/QuizModal.test.tsx tests/components/TeacherClassroomView.test.tsx`
- `pnpm lint`
- `pnpm build`
- `bash .codex/skills/pika-ui-verify/scripts/ui_verify.sh 'classrooms/5fcf845d-220d-4321-8409-5afe9e9459c3?tab=assignments&surveyId=c1341f92-b133-4d8a-bfcf-a1409e3ef0ba'` (temporary local survey removed after screenshots)
- Extra settings screenshot: `/tmp/pika-teacher-survey-settings.png`
- Creation parity screenshots: `/tmp/pika-new-test-modal.png`, `/tmp/pika-new-survey-modal.png`

## 2026-05-14 — Hide quiz classroom feature

**Completed:**
- Removed the Quizzes item from teacher/student classroom nav, UI gallery links, snapshot coverage, and assessment parity capture.
- Made legacy `tab=quizzes` classroom URLs fall back to the role default tab and clear stale `quizId` params.
- Hid quiz publishing/blueprint choices from settings and blueprint editor UI; normalized published/planned site configs to keep quizzes unpublished.

**Validation:**
- `pnpm test tests/components/NavItems.test.tsx tests/unit/layout-config.test.ts tests/components/ThreePanelProvider.test.tsx tests/components/ClassroomPageClientAssignmentsEditMode.test.tsx tests/lib/course-site-publishing.test.ts tests/components/TeacherBlueprintsPage.test.tsx tests/components/TeacherSettingsTab.test.tsx`
- `pnpm test tests/components/SurveyModal.test.tsx tests/api/student/surveys-route.test.ts tests/components/TeacherSurveyWorkspace.test.tsx tests/components/StudentAssignmentsTab.test.tsx tests/components/TeacherClassroomView.test.tsx tests/components/TeacherTestsTab.test.tsx tests/components/StudentQuizzesTab.test.tsx tests/components/TeacherQuizzesTab.test.tsx tests/lib/course-blueprint-package.test.ts tests/lib/server/course-sites.test.ts tests/lib/server/course-blueprints.test.ts`
- `pnpm lint`
- `pnpm build`
- `E2E_BASE_URL=http://localhost:3001 PIKA_WORKTREE=/Users/stew/Repos/.worktrees/pika/survey-experience-cleanup bash /Users/stew/Repos/pika/.codex/skills/pika-ui-verify/scripts/ui_verify.sh 'classrooms/5fcf845d-220d-4321-8409-5afe9e9459c3?tab=assignments'`
- Extra screenshots/assertions: `/tmp/pika-student-desktop.png`, `/tmp/pika-teacher-settings-no-quiz.png`; Playwright confirmed `Quizzes` links are absent for both roles and legacy quiz URLs redirect to `attendance`/`today`.

## 2026-05-14 — Survey poll/results timing split

**Completed:**
- Added independent selected-survey controls for poll visibility (`Poll hidden/open/closed`) and result visibility (`Results hidden/visible`).
- Allowed enrolled students to view survey class results before submitting when results are visible and the survey is open or closed; drafts and hidden/future polls stay unavailable.
- Kept open surveys answerable for unsubmitted students even when class results are already visible.

**Validation:**
- `pnpm test tests/api/student/surveys-route.test.ts tests/components/TeacherSurveyWorkspace.test.tsx tests/components/StudentSurveyPanel.test.tsx tests/components/StudentAssignmentsTab.test.tsx tests/unit/surveys.test.ts`
- `pnpm test tests/components/SurveyModal.test.tsx`
- `pnpm lint`
- `pnpm build`
- `E2E_BASE_URL=http://localhost:3001 PIKA_WORKTREE=/Users/stew/Repos/.worktrees/pika/survey-experience-cleanup bash /Users/stew/Repos/pika/.codex/skills/pika-ui-verify/scripts/ui_verify.sh 'classrooms/5fcf845d-220d-4321-8409-5afe9e9459c3?tab=assignments'`
- Targeted screenshots/assertions: `/tmp/pika-survey-teacher-controls.png`, `/tmp/pika-survey-student-results-before-submit.png`, `/tmp/pika-survey-teacher-mobile-controls.png`.

## 2026-05-14 — Direct survey draft creation

**Completed:**
- Changed `New > Survey` to create an untitled draft immediately and open the selected-survey workspace directly.
- Defaulted newly created surveys to visual question editing instead of markdown/code mode.
- Added inline title editing from the selected survey header; generated backend titles display as `Untitled` until the teacher enters a title.
- Let the teacher survey POST endpoint generate `Untitled yyyy-MM-dd HH:mm:ss` when the title is blank or omitted.

**Validation:**
- `pnpm test tests/api/teacher/surveys-route.test.ts tests/components/TeacherClassroomView.test.tsx tests/components/TeacherSurveyWorkspace.test.tsx tests/components/SurveyModal.test.tsx tests/api/student/surveys-route.test.ts tests/components/StudentSurveyPanel.test.tsx`
- `pnpm lint`
- `pnpm build`
- `pnpm test` (known unrelated full-suite issue: `tests/components/TeacherGradebookTab.test.tsx` timed out/failed under load; isolated file passes)
- `pnpm test tests/components/TeacherGradebookTab.test.tsx`
- `E2E_BASE_URL=http://localhost:3003 PIKA_WORKTREE=/Users/stew/Repos/.worktrees/pika/survey-experience-cleanup bash /Users/stew/Repos/pika/.codex/skills/pika-ui-verify/scripts/ui_verify.sh 'classrooms/5fcf845d-220d-4321-8409-5afe9e9459c3?tab=assignments'`
- Targeted screenshots/assertions: `/tmp/pika-direct-survey-create-desktop.png`, `/tmp/pika-direct-survey-create-mobile.png`.

## 2026-05-14 — Shared test/survey editable title creation

**Completed:**
- Changed `New Test` to create an untitled draft immediately and open the visual test authoring modal, removing the title-only modal step.
- Added shared untitled-title helpers and a shared editable assessment title control used by both test and survey authoring.
- Saved test title edits into the assessment draft so activation preserves the teacher-entered title.
- Kept generated backend titles displayed as `Untitled` in both survey and test creation surfaces until the teacher enters a title.

**Validation:**
- `pnpm test tests/api/teacher/tests-route.test.ts tests/api/teacher/surveys-route.test.ts tests/components/TeacherTestsTab.test.tsx tests/components/QuizDetailPanel.test.tsx tests/components/TeacherSurveyWorkspace.test.tsx tests/components/TeacherClassroomView.test.tsx`
- `pnpm lint`
- `pnpm build`
- `E2E_BASE_URL=http://localhost:3005 PIKA_WORKTREE=/Users/stew/Repos/.worktrees/pika/survey-experience-cleanup bash /Users/stew/Repos/pika/.codex/skills/pika-ui-verify/scripts/ui_verify.sh 'classrooms/5fcf845d-220d-4321-8409-5afe9e9459c3?tab=tests'`
- Targeted screenshots/assertions: `/tmp/pika-direct-test-create-desktop.png`, `/tmp/pika-direct-test-create-mobile.png`, `/tmp/pika-shared-survey-title-desktop.png`, `/tmp/pika-shared-survey-title-mobile.png`.

## 2026-05-14 — Survey response length field removal

**Completed:**
- Removed the visible `Max characters` control from the survey question edit card for short-text and link questions.
- Kept the existing/default `response_max_chars` value in save payloads so existing survey response limits remain compatible.

**Validation:**
- `bash scripts/verify-env.sh`
- `pnpm test tests/components/TeacherSurveyWorkspace.test.tsx`
- `pnpm lint`
- `pnpm build`
- Targeted Playwright screenshot/assertion: `/tmp/pika-survey-no-max-characters.png`.

## 2026-05-14 — Test modal header title placement

**Completed:**
- Moved the editable test title into the test creation/edit modal header where the fixed `Test` label was.
- Display generated untitled test drafts as `Untitled Test` in the editable test title control.
- Kept the same draft-backed title save path by portaling the existing `QuizDetailPanel` title editor into the modal header.

**Validation:**
- `pnpm test tests/components/TeacherTestsTab.test.tsx tests/components/QuizDetailPanel.test.tsx`
- `pnpm lint`
- `pnpm build`
- `E2E_BASE_URL=http://localhost:3005 PIKA_WORKTREE=/Users/stew/Repos/.worktrees/pika/survey-experience-cleanup bash /Users/stew/Repos/pika/.codex/skills/pika-ui-verify/scripts/ui_verify.sh 'classrooms/5fcf845d-220d-4321-8409-5afe9e9459c3?tab=tests'`
- Targeted screenshots/assertions: `/tmp/pika-test-title-header-desktop.png`, `/tmp/pika-test-title-header-mobile.png`.

## 2026-05-14 — Survey selected-card results pane

**Completed:**
- Moved teacher survey results out of the authoring modal and into the selected survey Pika pane.
- Moved teacher survey settings/actions into the selected-survey floating action bar: edit, code, poll visibility, results visibility, response editing, delete.
- Changed survey cards to select the survey results pane instead of opening the authoring modal directly.
- Updated student survey behavior so visible results render first, unsubmitted students can still open the response form, and submitted students get an edit-response FAB when response editing is allowed.
- Fixed URL-selected survey modal state so the teacher action-bar edit/code buttons can open the authoring modal without being immediately cleared by the URL selection effect.

**Validation:**
- `pnpm test tests/components/TeacherClassroomView.test.tsx tests/components/TeacherSurveyWorkspace.test.tsx tests/components/StudentSurveyPanel.test.tsx tests/components/StudentAssignmentsTab.test.tsx`
- `pnpm lint`
- `pnpm build`
- `E2E_BASE_URL=http://localhost:3005 PIKA_WORKTREE=/Users/stew/Repos/.worktrees/pika/survey-experience-cleanup bash /Users/stew/Repos/pika/.codex/skills/pika-ui-verify/scripts/ui_verify.sh 'classrooms/5fcf845d-220d-4321-8409-5afe9e9459c3?tab=assignments'`
- Targeted Playwright screenshots/assertions: `/tmp/pika-teacher-survey-results-pane.png`, `/tmp/pika-teacher-survey-authoring-no-results.png`, `/tmp/pika-student-survey-results-respond.png`, `/tmp/pika-student-survey-results-edit.png`, `/tmp/pika-student-survey-edit-form.png`.

## 2026-05-14 — Survey cleanup resumed validation

**Completed:**
- Resumed the survey cleanup worktree after an interrupted startup verification run.
- Confirmed the real worktree branch remained `codex/survey-experience-cleanup`.
- Loaded startup and UI guidance context without making further code changes.

**Validation:**
- `pnpm test` — 268 test files and 2235 tests passed.
- `git diff --check`

## 2026-05-14 — Rebased survey cleanup onto origin/main

**Completed:**
- Stashed dirty work, fetched `origin/main`, and rebased `codex/survey-experience-cleanup`.
- Re-applied local changes and resolved the single conflict in `src/app/classrooms/[classroomId]/TeacherClassroomView.tsx`.
- Kept upstream assignment split-pane behavior and branch survey results/action-bar behavior together.
- Confirmed no branch-added Supabase migrations needed resequencing.
- Dropped the temporary `pre-rebase-main-20260514-131209` stash after validation.

**Validation:**
- `pnpm lint`
- `pnpm test tests/components/TeacherClassroomView.test.tsx tests/components/TeacherSurveyWorkspace.test.tsx tests/components/StudentSurveyPanel.test.tsx tests/components/StudentAssignmentsTab.test.tsx tests/components/ClassroomPageClientAssignmentsEditMode.test.tsx`
- `pnpm build`
- `git diff --check`

## 2026-05-14 — Survey creation modal title focus

**Completed:**
- Fixed routed classroom state so creating a survey keeps the new survey authoring modal open instead of immediately clearing it.
- Added an auto-edit path for newly created survey titles.
- Displayed generated survey titles as `Untitled Survey` in authoring and selected the full title text on creation so teachers can replace it immediately.
- Kept unchanged generated title blur from saving a literal `Untitled Survey`.

**Validation:**
- `pnpm test tests/components/TeacherClassroomView.test.tsx tests/components/TeacherSurveyWorkspace.test.tsx`
- `pnpm lint`
- `pnpm build`
- `E2E_BASE_URL=http://localhost:3006 PIKA_WORKTREE=/Users/stew/Repos/.worktrees/pika/survey-experience-cleanup bash /Users/stew/Repos/pika/.codex/skills/pika-ui-verify/scripts/ui_verify.sh 'classrooms/5fcf845d-220d-4321-8409-5afe9e9459c3?tab=assignments'`
- Targeted Playwright screenshot/assertion: `/tmp/pika-survey-create-modal-title-selected.png`.

## 2026-05-14 — Teacher selected-survey split actions

**Completed:**
- Replaced the selected-survey teacher floating controls with a compact `SplitButton`.
- Kept `Edit survey` as the primary action and moved poll open/close, results visibility, response editing, and delete into the action menu.
- Added optional per-option styling to `SplitButton` so destructive menu actions can be shown distinctly.
- Updated the teacher classroom test coverage to assert the new selected-survey action menu behavior and PATCH flow.

**Validation:**
- `pnpm test tests/components/TeacherClassroomView.test.tsx`
- `pnpm lint`
- `pnpm build`
- `E2E_BASE_URL=http://localhost:3021 PIKA_WORKTREE=/Users/stew/Repos/.worktrees/pika/survey-experience-cleanup bash /Users/stew/Repos/pika/.codex/skills/pika-ui-verify/scripts/ui_verify.sh 'classrooms/5fcf845d-220d-4321-8409-5afe9e9459c3?tab=assignments&surveyId=167609a8-2111-482f-8be2-7bb74a8f548f'`
- Targeted Playwright screenshots/assertions: `/tmp/pika-survey-teacher-final.png`, `/tmp/pika-survey-actions-open.png`; temporary survey fixture was deleted afterward.

## 2026-05-14 — Teacher selected-survey icon controls

**Completed:**
- Replaced the selected-survey split button with direct icon buttons for poll open/close, results visibility, and edit survey.
- Made the poll state action prominent with play/stop icons and primary/danger treatment.
- Removed the selected-survey response-editing action and moved `Editable responses` into the survey authoring modal.
- Updated tests for the direct icon controls and the editable-response setting PATCH flow.

**Validation:**
- `pnpm test tests/components/TeacherClassroomView.test.tsx tests/components/TeacherSurveyWorkspace.test.tsx`
- `pnpm lint`
- `pnpm build`
- `E2E_BASE_URL=http://localhost:3022 PIKA_WORKTREE=/Users/stew/Repos/.worktrees/pika/survey-experience-cleanup bash /Users/stew/Repos/pika/.codex/skills/pika-ui-verify/scripts/ui_verify.sh 'classrooms/5fcf845d-220d-4321-8409-5afe9e9459c3?tab=assignments&surveyId=47927a72-ffe7-45d8-a51d-9f60bd9696d6'`
- Targeted Playwright screenshots/assertions: `/tmp/pika-survey-icon-controls.png`, `/tmp/pika-survey-edit-modal-settings.png`; temporary survey fixture was deleted afterward.

## 2026-05-14 — Survey hidden-results and live-change copy

**Completed:**
- Replaced the hidden-results selected-survey icon with a slashed graph icon instead of an eye-off icon.
- Renamed the survey response-editing setting to `Allow live changes`.
- Moved `Allow live changes` onto the same survey authoring modal header row as the title, Code, and Delete controls.

**Validation:**
- `pnpm test tests/components/TeacherClassroomView.test.tsx tests/components/TeacherSurveyWorkspace.test.tsx`
- `pnpm lint`
- `pnpm build`
- `E2E_BASE_URL=http://localhost:3023 PIKA_WORKTREE=/Users/stew/Repos/.worktrees/pika/survey-experience-cleanup bash /Users/stew/Repos/pika/.codex/skills/pika-ui-verify/scripts/ui_verify.sh 'classrooms/5fcf845d-220d-4321-8409-5afe9e9459c3?tab=assignments&surveyId=b04fcfbf-1071-4d14-af9f-592c35a9f02a'`
- Targeted Playwright screenshots/assertions: `/tmp/pika-survey-hidden-results-icon.png`, `/tmp/pika-survey-edit-modal-live-changes-row.png`; temporary survey fixture was deleted afterward.

## 2026-05-14 — Survey question autosave controls

**Completed:**
- Removed the per-question `Save` button from survey authoring.
- Added debounced automatic saving for edited survey question type, prompt, and options, with blur flushing for immediate persistence.
- Kept failed autosave attempts retryable instead of suppressing the same payload after a transient error.
- Moved the per-question delete action inline with the prompt row.
- Updated selected-survey controls to use test-style green unlock/red lock icons for poll state and green/red color for visible/hidden results.

**Validation:**
- `bash scripts/verify-env.sh`
- `pnpm test tests/components/TeacherClassroomView.test.tsx`
- `pnpm test tests/components/TeacherSurveyWorkspace.test.tsx`
- `pnpm lint`
- `pnpm build`
- `E2E_BASE_URL=http://localhost:3024 PIKA_WORKTREE=/Users/stew/Repos/.worktrees/pika/survey-experience-cleanup bash /Users/stew/Repos/pika/.codex/skills/pika-ui-verify/scripts/ui_verify.sh 'classrooms/5fcf845d-220d-4321-8409-5afe9e9459c3?tab=assignments&surveyId=619428d0-644e-4f13-9681-bb0954e266b1'`
- Targeted Playwright screenshots/assertions: `/tmp/pika-survey-question-autosave-delete-inline.png`, `/tmp/pika-survey-question-autosaved.png`; confirmed `saveButtonCount: 0`, observed question PATCH on blur, and deleted the temporary survey fixture afterward.
- `E2E_BASE_URL=http://localhost:3027 PIKA_WORKTREE=/Users/stew/Repos/.worktrees/pika/survey-experience-cleanup bash /Users/stew/Repos/pika/.codex/skills/pika-ui-verify/scripts/ui_verify.sh 'classrooms/5fcf845d-220d-4321-8409-5afe9e9459c3?tab=assignments&surveyId=a7b4279f-d18e-4277-b4de-b1950e24e892'`
- Targeted Playwright screenshots/assertions: `/tmp/pika-survey-locked-controls.png`, `/tmp/pika-survey-hidden-results-control.png`; restored the seeded active survey to `show_results: true`.

## 2026-05-15 — Survey results card cleanup

**Completed:**
- Removed the separate title/status card from the teacher selected-survey results pane.
- Removed the selected-survey workspace parent border/background so survey results sit directly on the page.
- Moved the survey title into the results card and removed the aggregate responded-count line from results.
- Added shared survey option result bars that place percentages inside the indicator bars for teacher and student results.
- Stabilized the generated-title focus test with an explicit wait after the all-file startup run exposed a focus timing flake.

**Validation:**
- `PIKA_WORKTREE=/Users/stew/Repos/.worktrees/pika/survey-experience-cleanup bash /Users/stew/Repos/pika/.codex/skills/pika-session-start/scripts/session_start.sh` — one focus-timing test failed during the full suite before edits; the isolated test passed afterward and was stabilized.
- `pnpm test tests/components/TeacherSurveyResultsPane.test.tsx tests/components/StudentSurveyPanel.test.tsx tests/components/TeacherClassroomView.test.tsx`
- `pnpm test tests/components/TeacherSurveyWorkspace.test.tsx tests/components/TeacherSurveyResultsPane.test.tsx tests/components/StudentSurveyPanel.test.tsx tests/components/TeacherClassroomView.test.tsx`
- `pnpm lint`
- `pnpm build`
- `E2E_BASE_URL=http://localhost:3028 PIKA_WORKTREE=/Users/stew/Repos/.worktrees/pika/survey-experience-cleanup bash /Users/stew/Repos/pika/.codex/skills/pika-ui-verify/scripts/ui_verify.sh 'classrooms/5fcf845d-220d-4321-8409-5afe9e9459c3?tab=assignments&surveyId=a7b4279f-d18e-4277-b4de-b1950e24e892'`
- Targeted Playwright screenshots/assertions: `/tmp/pika-survey-results-bars.png`, `/tmp/pika-survey-results-card-teacher.png`, `/tmp/pika-survey-results-card-student.png`; temporary multiple-choice survey response rows were deleted afterward.
