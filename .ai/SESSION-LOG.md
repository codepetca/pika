# Pika Session Log

Rolling recent session log for AI/human handoffs. Keep this file small; full historical session history lives in `.ai/JOURNAL-ARCHIVE.md`.

**Rules:**
- Append one concise entry for meaningful work at the end of a session.
- Run `node scripts/trim-session-log.mjs` after appending to keep only the latest 20 entries.
- Use `.ai/JOURNAL-ARCHIVE.md` only for historical investigation.

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

## 2026-05-19 — Multiple-choice survey option cap

**Completed:**
- Raised the multiple-choice survey option cap from 6 to 50 in the shared survey validation.
- Added a boundary unit test that accepts the configured maximum and rejects one option beyond it.

**Validation:**
- `PIKA_WORKTREE=/Users/stew/Repos/.worktrees/pika/survey-experience-cleanup bash /Users/stew/Repos/pika/.codex/skills/pika-session-start/scripts/session_start.sh`
- `pnpm test tests/unit/surveys.test.ts tests/api/teacher/surveys-questions-route.test.ts tests/api/teacher/surveys-questions-id.test.ts`
- `pnpm lint`
- `pnpm build`

## 2026-05-19 — Survey open-state question-count refresh

**Completed:**
- Fixed the selected-survey action bar so adding, deleting, or markdown-syncing survey questions updates the parent survey `questions_count` immediately.
- Added regression coverage for a draft survey becoming openable after its first question is added in the edit modal.

**Validation:**
- `pnpm test tests/components/TeacherClassroomView.test.tsx tests/components/TeacherSurveyWorkspace.test.tsx`
- `pnpm lint`
- `pnpm build`
- `E2E_BASE_URL=http://localhost:3030 PIKA_WORKTREE=/Users/stew/Repos/.worktrees/pika/survey-experience-cleanup bash /Users/stew/Repos/pika/.codex/skills/pika-ui-verify/scripts/ui_verify.sh 'classrooms/5fcf845d-220d-4321-8409-5afe9e9459c3?tab=assignments'`
- Targeted Playwright smoke created a temporary draft survey, confirmed `Open poll` was disabled before adding a question and enabled after adding the first question in the modal, then deleted the temporary survey. Screenshot: `/tmp/pika-survey-question-count-enabled.png`.

## 2026-05-19 — Survey PR merge prep

**Completed:**
- Rebasing/push left GitHub CI blocked only by the rolling session-log size check.
- Trimmed `.ai/SESSION-LOG.md` back under the documented 20-entry limit before merging PR #595.

**Validation:**
- `pnpm test tests/unit/ai-startup-docs.test.ts`

## 2026-05-19 — Survey creation preview option

**Completed:**
- Added a Preview mode to the teacher survey authoring modal with a student-style response layout for multiple-choice, text, and link questions.
- Kept preview responses local to the modal so teachers can click through the survey without saving anything.
- Added regression coverage for opening preview and selecting an option without issuing a survey PATCH.

**Validation:**
- `PIKA_WORKTREE=/Users/stew/Repos/.worktrees/pika/survey-preview bash /Users/stew/Repos/.worktrees/pika/survey-preview/.codex/skills/pika-session-start/scripts/session_start.sh`
- `pnpm test tests/components/TeacherSurveyWorkspace.test.tsx`
- `pnpm lint`
- `pnpm build`
- `E2E_BASE_URL=http://localhost:3003 PIKA_WORKTREE=/Users/stew/Repos/.worktrees/pika/survey-preview bash /Users/stew/Repos/.worktrees/pika/survey-preview/.codex/skills/pika-ui-verify/scripts/ui_verify.sh classrooms`
- Targeted Playwright screenshots/assertions: `/tmp/pika-survey-preview-teacher.png`, `/tmp/pika-survey-preview-teacher-mobile.png`; temporary survey fixtures were deleted afterward.
