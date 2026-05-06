# Pika Session Log

Rolling recent session log for AI/human handoffs. Keep this file small; full historical session history lives in `.ai/JOURNAL-ARCHIVE.md`.

**Rules:**
- Append one concise entry for meaningful work at the end of a session.
- Run `node scripts/trim-session-log.mjs` after appending to keep only the latest 20 entries.
- Use `.ai/JOURNAL-ARCHIVE.md` only for historical investigation.

## 2026-05-03 — Align classroom view toggle with FAB buttons

**Completed:**
- Replaced the custom Active/Archived classroom view pills with the shared `SegmentedControl`.
- Moved the Active/Archived toggle to the left of the `New` button when classroom edit mode is enabled.
- Added coverage for the edit-mode control ordering.

**Validation:**
- `pnpm test tests/components/TeacherClassroomsIndex.test.tsx`
- `pnpm lint`
- Pika UI verification script for `/classrooms` on port 3003:
  - `/tmp/pika-teacher.png`
  - `/tmp/pika-student.png`
  - `/tmp/pika-teacher-mobile.png`
- Manual Playwright screenshots:
  - `/tmp/pika-classrooms-teacher-default.png`
  - `/tmp/pika-classrooms-teacher-mobile-default.png`
  - `/tmp/pika-teacher-edit.png`
  - `/tmp/pika-teacher-mobile-edit.png`

## 2026-05-03 — Move classroom view toggle to bottom center

**Completed:**
- Moved the Active/Archived classroom view segmented control out of the top FAB cluster.
- Rendered the view toggle fixed at the bottom center while classroom edit mode is enabled.
- Kept `New` and `Edit` in the centered top FAB cluster.
- Added bottom padding in edit mode so fixed controls do not cover classroom cards.

**Validation:**
- `pnpm test tests/components/TeacherClassroomsIndex.test.tsx`
- `pnpm lint`
- Pika UI verification script for `/classrooms` on port 3003:
  - `/tmp/pika-teacher.png`
  - `/tmp/pika-student.png`
  - `/tmp/pika-teacher-mobile.png`
- Manual Playwright screenshots:
  - `/tmp/pika-classrooms-teacher-default.png`
  - `/tmp/pika-classrooms-teacher-mobile-default.png`
  - `/tmp/pika-teacher-edit.png`
  - `/tmp/pika-teacher-mobile-edit.png`

## 2026-05-03 — Always show classroom view toggle

**Completed:**
- Kept the Active/Archived classroom view toggle visible at the bottom center in both normal and edit modes.
- Preserved Edit as the gate for classroom drag handles and row archive actions.
- Stopped resetting the classroom view to Active when turning Edit off.
- Added coverage for the always-visible view toggle and retained Archived selection after edit mode is disabled.

**Validation:**
- `pnpm test tests/components/TeacherClassroomsIndex.test.tsx`
- `pnpm lint`
- Pika UI verification script for `/classrooms` on port 3003:
  - `/tmp/pika-teacher.png`
  - `/tmp/pika-student.png`
  - `/tmp/pika-teacher-mobile.png`
- Manual Playwright screenshots:
  - `/tmp/pika-classrooms-teacher-default.png`
  - `/tmp/pika-classrooms-teacher-mobile-default.png`
  - `/tmp/pika-teacher-edit.png`
  - `/tmp/pika-teacher-mobile-edit.png`

## 2026-05-03 — Clear classroom edit mode on escape and page restore

**Completed:**
- Added Escape handling to turn classroom edit mode off and clear any drag state.
- Added `pageshow` handling so browser page restore after refresh/back-forward does not leave edit mode enabled.
- Added component coverage for Escape and page-restore edit-mode clearing.

**Validation:**
- `pnpm test tests/components/TeacherClassroomsIndex.test.tsx`
- `pnpm lint`
- Pika UI verification script for `/classrooms` on port 3003:
  - `/tmp/pika-teacher.png`
  - `/tmp/pika-student.png`
  - `/tmp/pika-teacher-mobile.png`
- Manual Playwright interaction check:
  - Escape clears classroom edit mode.
  - `pageshow` clears classroom edit mode.
  - `/tmp/pika-classrooms-after-edit-clear.png`

## 2026-05-04 — Move classroom create action below list

**Completed:**
- Removed `New` from the top classroom FAB cluster so the cluster now only contains `Edit`.
- Rendered `New` below the classroom list when there are no active classrooms or classroom edit mode is enabled.
- Hid `New` after the first active classroom exists while edit mode is off.
- Updated component coverage for the new create-button visibility and placement.

**Validation:**
- `pnpm test tests/components/TeacherClassroomsIndex.test.tsx`
- `pnpm lint`
- Pika UI verification script for `/classrooms` on port 3003:
  - `/tmp/pika-teacher.png`
  - `/tmp/pika-student.png`
  - `/tmp/pika-teacher-mobile.png`
- Manual Playwright screenshots:
  - `/tmp/pika-classrooms-teacher-default.png`
  - `/tmp/pika-classrooms-teacher-mobile-default.png`
  - `/tmp/pika-teacher-edit.png`
  - `/tmp/pika-teacher-mobile-edit.png`

## 2026-05-04 — Split announcements from resources tab

**Completed:**
- Added a dedicated `Announcements` classroom tab for teachers and students.
- Moved announcement feeds into the new tab and made `Resources` show only class resources.
- Routed unread announcement activity to the Announcements nav item.
- Updated calendar announcement links, layout route keys, UI gallery links, and focused coverage.

**Validation:**
- `pnpm test tests/components/ResourcesTab.test.tsx tests/components/NavItems.test.tsx tests/unit/layout-config.test.ts tests/components/ThreePanelProvider.test.tsx tests/components/ClassroomPageClientAssignmentsEditMode.test.tsx`
- `pnpm lint`
- `pnpm build`
- `pnpm test`
- Pika UI verification script on port 3010:
  - `classrooms/491562df-96cd-4d21-8dc5-cff996396d41?tab=resources`
  - `classrooms/491562df-96cd-4d21-8dc5-cff996396d41?tab=announcements`
- Manual Playwright student captures for the student-accessible classroom:
  - `/tmp/pika-student-resources-accessible.png`
  - `/tmp/pika-student-announcements-accessible.png`
- Manual mobile drawer captures:
  - `/tmp/pika-teacher-mobile-drawer.png`
  - `/tmp/pika-student-mobile-drawer.png`

## 2026-05-04 — Make message popup background solid

**Completed:**
- Changed global app message popup tones to use the solid semantic surface background.
- Kept tone-specific border and text colors for info, success, and warning messages.
- Added test coverage so success messages keep `bg-surface` instead of the translucent success background token.

**Validation:**
- `pnpm test tests/ui/AppMessage.test.tsx tests/ui/StatusPrimitives.test.tsx`
- `pnpm lint`
- Manual Playwright screenshots on `http://localhost:3100/verify-signup?email=teacher%40example.com`:
  - `/tmp/pika-message-popup-light.png`
  - `/tmp/pika-message-popup-dark.png`
- Computed popup backgrounds verified as opaque:
  - Light: `rgb(255, 255, 255)`
  - Dark: `rgb(17, 24, 39)`

## 2026-04-30 — Refresh assignment counts after return

**Completed:**
- Fixed the teacher assignment list card counts staying stale after returning selected assignment work.
- Invalidated and reloaded the teacher assignment summary cache after a successful batch return, while preserving the current workspace content.
- Added component coverage for a resubmitted student changing the summary card from `1/31` to `0/31` after return.

**Validation:**
- `pnpm test tests/components/TeacherClassroomView.test.tsx`
- `pnpm test tests/api/teacher/assignments.test.ts tests/api/teacher/assignments-id-return.test.ts`
- `pnpm lint`
- `pnpm test`
- Pika UI verification script for `/classrooms`:
  - `/tmp/pika-teacher.png`
  - `/tmp/pika-student.png`
  - `/tmp/pika-teacher-mobile.png`
- Manual Playwright screenshots for assignment lists:
  - `/tmp/pika-teacher-assignments.png`
  - `/tmp/pika-student-assignments.png`

## 2026-05-06 — Tighten assignment edit chrome and modal height

**Completed:**
- Hid the app-header `Assignments` title while teacher assignment summary edit mode is active, leaving the floating assignment action cluster as the working control surface.
- Made the assignment create/edit modal use the near-full viewport panel in both modes.
- Removed the visible modal header row, kept an accessible hidden dialog title, and moved the close button into the form action row.
- Let the assignment instructions editor and preview flex into the added modal height.
- Fixed calendar clicks on unreleased assignments so the editor modal clears the stale `assignmentId` route selection and does not reopen after close.

**Validation:**
- `PIKA_WORKTREE=/Users/stew/Repos/.worktrees/pika/assignment-actionbar-spacer bash .codex/skills/pika-session-start/scripts/session_start.sh`
- `pnpm test tests/components/AssignmentModal.test.tsx tests/components/ClassroomPageClientAssignmentsEditMode.test.tsx tests/components/TeacherClassroomView.test.tsx`
- `pnpm lint`
- Focused Playwright calendar flow: clicked unreleased assignment from Calendar, closed the editor modal, confirmed it stayed closed at `?tab=assignments`.
- Pika UI verification on shared assignment page:
  - `/tmp/pika-teacher.png`
  - `/tmp/pika-student.png`
  - `/tmp/pika-teacher-mobile.png`
- Focused Playwright screenshots:
  - `/tmp/pika-assignment-edit-modal.png`
  - `/tmp/pika-assignment-create-modal.png`
  - `/tmp/pika-assignment-edit-modal-mobile.png`

## 2026-05-05 — Make exam documents visibly clickable

**Completed:**
- Added a right chevron affordance to active student exam-mode document rows.
- Matched the same document-row affordance in the teacher test preview.
- Added focused component coverage for the student document-row chevron.

**Validation:**
- `pnpm test tests/components/StudentQuizzesTab.test.tsx`
- `pnpm lint`
- Pre-edit startup verification: `PIKA_WORKTREE=/Users/stew/Repos/.worktrees/pika/issue-548-doc-chevron bash scripts/verify-env.sh`
- Pika UI verification script on `http://localhost:3002/classrooms`:
  - `/tmp/pika-teacher.png`
  - `/tmp/pika-student.png`
  - `/tmp/pika-teacher-mobile.png`
- Targeted Playwright screenshots:
  - `/tmp/pika-student-exam-docs-chevron.png`
  - `/tmp/pika-teacher-test-preview-docs-chevron.png`

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
