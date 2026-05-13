# Pika Session Log

Rolling recent session log for AI/human handoffs. Keep this file small; full historical session history lives in `.ai/JOURNAL-ARCHIVE.md`.

**Rules:**
- Append one concise entry for meaningful work at the end of a session.
- Run `node scripts/trim-session-log.mjs` after appending to keep only the latest 20 entries.
- Use `.ai/JOURNAL-ARCHIVE.md` only for historical investigation.

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

## 2026-05-12 — Student Today past log expansion

**Completed:**
- Removed the parent collapse control from the student Today past-log section.
- Changed the section to always show past logs, excluding the current Today entry.
- Added per-log expand/collapse behavior: collapsed entries use a two-line clamp with ellipsis and clicking the log reveals the full text.
- Split the student Today right pane into `Today` and `Last Class` lesson-plan sections, with the previous class day loaded from shared class-day state.
- Updated focused Today history component coverage for default visibility, per-entry toggling, empty past-log state, and sessionStorage caching.
- Added page-client coverage for the student Today sidebar showing both current and last-class lesson-plan content.

**Validation:**
- `PIKA_WORKTREE=/Users/stew/Repos/.worktrees/pika/today-log-history-expand bash .codex/skills/pika-session-start/scripts/session_start.sh`
- `pnpm test tests/components/StudentTodayTabHistory.test.tsx`
- `pnpm test tests/components/ClassroomPageClientAssignmentsEditMode.test.tsx tests/components/StudentTodayTabHistory.test.tsx`
- `pnpm lint`
- `git diff --check`
- Visual verification via temporary local harness after standard auth/seed path was blocked by local Supabase being down because Docker was not running:
  - `/tmp/pika-student-today-mobile.png`
  - `/tmp/pika-student-today-mobile-expanded.png`
- `PIKA_WORKTREE=/Users/stew/Repos/.worktrees/pika/today-log-history-expand bash .codex/skills/pika-ui-verify/scripts/ui_verify.sh 'classrooms/90c4fdd7-28c0-4474-998e-650eee270d57?tab=today'`
- Additional desktop student pane capture:
  - `/tmp/pika-student-today-desktop.png`

## 2026-05-12 — Student Today split pane and richer seed logs

**Completed:**
- Moved the student Today lesson-plan panel out of the global right sidebar and into a teacher-style gapped split workspace.
- Kept the Today and Last Class lesson-plan sections in a rounded right pane and rendered lesson-plan rich text flush, without the nested viewer border/padding.
- Disabled the external Today right sidebar route config and expanded the student Today history fetch/cache limit to 12 entries.
- Updated `seed` and `seed:fresh` to create 20 sample student logs across recent class days, including several long entries, and to seed lesson plans for both today and the last class.

**Validation:**
- `bash scripts/verify-env.sh`
- `pnpm test tests/components/ClassroomPageClientAssignmentsEditMode.test.tsx tests/components/StudentTodayTabHistory.test.tsx tests/unit/layout-config.test.ts`
- `pnpm lint`
- `pnpm seed:fresh`
- `pnpm e2e:auth`
- `PIKA_WORKTREE=/Users/stew/Repos/.worktrees/pika/today-log-history-expand bash .codex/skills/pika-ui-verify/scripts/ui_verify.sh 'classrooms/bdd3df5f-3596-4b8e-8acf-65004c9b2d66?tab=today'`
- Additional desktop student split capture: `/tmp/pika-student-today-desktop-split-final.png`
- `git diff --check`
- `pnpm build`

## 2026-05-12 — Student Today previous-day heading

**Completed:**
- Changed the student Today right-pane previous-class heading to show `Yesterday` when the previous class date is yesterday.
- Moved the formatted date next to the heading instead of pinning it to the far right of the pane.
- Kept the fallback copy as `Last class` for non-yesterday previous class days.

**Validation:**
- `pnpm test tests/components/ClassroomPageClientAssignmentsEditMode.test.tsx tests/components/StudentTodayTabHistory.test.tsx tests/unit/layout-config.test.ts`
- `pnpm lint`
- `git diff --check`
- `E2E_BASE_URL=http://localhost:3010 pnpm e2e:auth`
- `E2E_BASE_URL=http://localhost:3010 PIKA_WORKTREE=/Users/stew/Repos/.worktrees/pika/today-log-history-expand bash .codex/skills/pika-ui-verify/scripts/ui_verify.sh 'classrooms/bdd3df5f-3596-4b8e-8acf-65004c9b2d66?tab=today'`
- Additional desktop student split capture: `/tmp/pika-student-today-yesterday-desktop.png`
- `pnpm build`

## 2026-05-13 — Announcement markdown rendering

**Completed:**
- Added shared announcement markdown rendering with safe links, headings, lists, bold, italic, and inline code via the existing limited markdown parser.
- Updated teacher/student announcement tabs and calendar announcement previews/tooltips to render markdown without changing the database schema or API payload shape.
- Kept teacher announcement link clicks from entering edit mode.
- Updated architecture docs to record announcements as markdown text rather than Tiptap JSON.

**Validation:**
- `pnpm test tests/components/AnnouncementContent.test.tsx tests/components/AnnouncementsMarkdown.test.tsx tests/components/LessonDayCell.test.tsx tests/components/LessonCalendar.test.tsx`
- `pnpm lint`
- `bash scripts/verify-env.sh`
- `PIKA_WORKTREE=/Users/stew/Repos/.worktrees/pika/announcements-markdown E2E_BASE_URL=http://localhost:3001 bash .codex/skills/pika-ui-verify/scripts/ui_verify.sh 'classrooms/5fcf845d-220d-4321-8409-5afe9e9459c3?tab=announcements'`
- Additional loaded desktop teacher capture: `/tmp/pika-teacher-ready.png`

## 2026-05-13 — Teacher test list closed-access badge

**Completed:**
- Fixed teacher test list cards so an active test with access closed for every enrolled student displays a `Closed` badge instead of `Open`.
- Kept the underlying test lifecycle status unchanged and updated list access counts locally after open/close-all actions.
- Added focused utility and component coverage for the all-students-closed display case.

**Validation:**
- `PIKA_WORKTREE=/Users/stew/Repos/.worktrees/pika/fix-test-open-badge bash .codex/skills/pika-session-start/scripts/session_start.sh`
- `pnpm test tests/unit/quizzes.test.ts tests/components/TeacherTestsTab.test.tsx`
- `pnpm lint`
- `PIKA_WORKTREE=/Users/stew/Repos/.worktrees/pika/fix-test-open-badge E2E_BASE_URL=http://localhost:3001 bash .codex/skills/pika-ui-verify/scripts/ui_verify.sh 'classrooms/5fcf845d-220d-4321-8409-5afe9e9459c3?tab=tests'`

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
