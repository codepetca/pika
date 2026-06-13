# Pika Session Log

Rolling recent session log for AI/human handoffs. Keep this file small; full historical session history lives in `.ai/JOURNAL-ARCHIVE.md`.

**Rules:**
- Append one concise entry for meaningful work, then immediately run `node scripts/trim-session-log.mjs` in the same change.
- CI allows at most 60 entries; the trim step compacts to the latest 40 entries by default so there is headroom for future appends.
- Use `node scripts/trim-session-log.mjs --check` to verify the log is within the 60-entry cap.
- Keep enough recent entries for weekly automations to inspect roughly the last week of work.
- Use `.ai/JOURNAL-ARCHIVE.md` only for historical investigation.

## 2026-06-14 — Legacy quiz server access names
## 2026-06-05 — Session-log trim guardrail

**Completed:**
- Added `node scripts/trim-session-log.mjs --check` so CI and agents can detect untrimmed session logs without modifying files.
- Updated session-log workflow guidance to require append-then-trim in the same change while keeping the 60-entry retention cap.
- Strengthened startup and trim-script tests so missed trims point directly to `node scripts/trim-session-log.mjs`.
## 2026-06-06 — Classroom blueprint modal cache audit

**Completed:**
- Routed `CreateClassroomModal` blueprint list loads through the shared `fetchTeacherBlueprints` cache helper instead of a raw `/api/teacher/course-blueprints` fetch.
- Kept import and instantiate mutation paths raw and preserved blueprint/classroom cache invalidation after successful mutations.
- Added a stale-load guard so a closed/reopened modal cannot have a prior blueprint list response wipe the current options.
- Addressed PR review feedback by bumping the list-load generation after blueprint imports so pending open-time list loads cannot erase imported options.
- Updated modal coverage for cached list loading, empty blueprint lists, mutation fetches, stale close/reopen responses, and import-while-list-load-is-pending races.

**Validation:**
- `bash .codex/skills/pika-session-start/scripts/session_start.sh`
- `pnpm vitest run tests/components/CreateClassroomModal.test.tsx tests/unit/teacher-blueprints-client.test.ts tests/unit/request-cache.test.ts`
- `pnpm vitest run tests/components/CreateClassroomModal.test.tsx tests/components/TeacherBlueprintsPage.test.tsx tests/unit/teacher-blueprints-client.test.ts tests/components/TeacherClassroomsIndex.test.tsx tests/components/TeacherCalendarPage.test.tsx tests/components/TeacherDashboardPage.test.tsx tests/unit/teacher-classrooms-client.test.ts tests/unit/request-cache.test.ts`
- `git diff --check`
- `pnpm lint`
- `pnpm build`
- `pnpm test`
- `bash .codex/skills/pika-audit/scripts/audit.sh`

## 2026-06-06 — Teacher quiz list freshness audit

**Completed:**
- Routed `TeacherQuizzesTab` list reads through `fetchJSONWithCache` with a zero TTL for in-flight GET dedupe.
- Added request-id and classroom guards so stale quiz list responses cannot repaint after classroom changes or newer reloads.
- Addressed PR review feedback by forcing mutation/update-triggered reloads to use one-off cache keys so they cannot attach to older pending passive reads.
- Addressed follow-up review feedback by letting quiz cards rely on the global quiz-update event instead of also calling a parent forced reload.
- Added component coverage for stale classroom-switch list responses and creation-while-initial-load-is-pending races while preserving existing mount, update-event, creation, selection, and delete behavior.

**Validation:**
- `bash .codex/skills/pika-session-start/scripts/session_start.sh`
- `pnpm vitest run tests/components/TeacherQuizzesTab.test.tsx tests/unit/request-cache.test.ts`
- `pnpm vitest run tests/components/TeacherQuizzesTab.test.tsx tests/components/QuizCard.test.tsx tests/components/QuizModal.test.tsx tests/components/QuizDetailPanel.test.tsx tests/components/TeacherTestsTab.test.tsx tests/api/teacher/quizzes-route.test.ts tests/api/teacher/quizzes-id.test.ts tests/api/teacher/quizzes-results.test.ts tests/unit/request-cache.test.ts`
- `git diff --check`
- `pnpm lint`
- `pnpm build`
- `bash .codex/skills/pika-audit/scripts/audit.sh`
- `pnpm test`

## 2026-06-06 — Student assessment freshness audit

**Completed:**
- Routed `StudentQuizzesTab` list reads through `fetchJSONWithCache` with zero-TTL in-flight dedupe and force-refresh keys after submit/back refreshes.
- Added list and detail request guards so stale student quiz/test list or selected-detail responses cannot repaint after classroom/type changes or newer reads.
- Reset selected assessment state when the classroom or assessment type changes.
- Added `StudentQuizResults` request guards and payload reset so stale result responses cannot win after `quizId` changes.
- Added component coverage for stale list, detail, and result response races.

**Validation:**
- `bash .codex/skills/pika-session-start/scripts/session_start.sh`
- `pnpm vitest run tests/components/StudentQuizzesTab.test.tsx tests/components/StudentQuizResults.test.tsx tests/unit/request-cache.test.ts`
- `pnpm vitest run tests/components/StudentQuizzesTab.test.tsx tests/components/StudentQuizResults.test.tsx tests/components/StudentQuizForm.test.tsx tests/api/student/quizzes.test.ts tests/api/student/quizzes-id.test.ts tests/api/student/quizzes-results.test.ts tests/api/student/quizzes-respond.test.ts tests/api/student/tests-route.test.ts tests/api/student/tests-id.test.ts tests/api/student/tests-results.test.ts tests/api/student/tests-respond.test.ts tests/api/student/tests-session-status.test.ts tests/api/student/tests-focus-events.test.ts tests/unit/request-cache.test.ts`
- `git diff --check`
- `pnpm lint`
- `pnpm build`
- `bash .codex/skills/pika-audit/scripts/audit.sh`
- `pnpm test`

## 2026-06-06 — Quiz detail freshness audit

**Completed:**
- Added request-scope guards to `QuizDetailPanel` draft, test-document detail, and results loads so stale responses cannot repaint after selected assessment, classroom, route base, or assessment-type changes.
- Reset result payload and invalidated in-flight load/save revisions when the selected assessment scope changes.
- Added save contexts so pending debounced saves can still persist their original assessment without applying stale draft state to the currently selected panel.
- Added component coverage for stale draft, test-detail document, results, same-id assessment-type switch, selected-assessment save-response races, and pending debounced save persistence across assessment switches.

**Validation:**
- `bash .codex/skills/pika-session-start/scripts/session_start.sh`
- `pnpm vitest run tests/components/QuizDetailPanel.test.tsx tests/components/QuizResultsView.test.tsx tests/components/TeacherQuizzesTab.test.tsx tests/components/TeacherTestsTab.test.tsx tests/api/teacher/quizzes-results.test.ts tests/api/teacher/tests-results.test.ts tests/unit/request-cache.test.ts`
- `git diff --check`
- `pnpm lint`
- `pnpm build`
- `bash .codex/skills/pika-audit/scripts/audit.sh`
- `pnpm test`
- `pnpm vitest run tests/components/QuizDetailPanel.test.tsx`

## 2026-06-06 — Survey detail freshness audit

**Completed:**
- Added request-id and selected-survey guards to teacher survey authoring detail loads, teacher survey results loads, and student survey detail/results loads.
- Scoped already-loaded teacher/student survey detail and result payloads to the active selected survey so old survey content is hidden immediately on selection changes.
- Reset student survey result payloads while a new selected survey or result request is loading.
- Kept selected survey detail/results reads raw for freshness and guarded stale responses explicitly.
- Added component coverage for stale teacher survey detail/results responses, stale student survey detail/results responses, and already-loaded old detail/results after survey switches.

**Validation:**
- `bash .codex/skills/pika-session-start/scripts/session_start.sh`
- `pnpm vitest run tests/components/TeacherSurveyWorkspace.test.tsx tests/components/TeacherSurveyResultsPane.test.tsx tests/components/StudentSurveyPanel.test.tsx`
- `git diff --check`
- `pnpm lint`
- `bash .codex/skills/pika-audit/scripts/audit.sh`
- `pnpm build`
- `pnpm test`

## 2026-06-07 — Student exam reload-resume e2e coverage

**Completed:**
- Added a focused Playwright student exam-mode flow that starts an open-response test, waits for draft autosave, reloads the browser, reopens the test, and verifies the draft resumes.
- Asserted reload telemetry is recorded as route-exit activity while window/full-screen exit telemetry remains unchanged.

**Validation:**
- `bash .codex/skills/pika-session-start/scripts/session_start.sh` (initially failed until `pnpm install` restored `node_modules`; rerun via `bash scripts/verify-env.sh` passed)
- `pnpm exec playwright test e2e/student-exam-mode.spec.ts --project=chromium-desktop -g "resumes an in-progress"`
- `pnpm lint`

## 2026-06-08 — Classroom sidebar history tightening

**Completed:**
- Changed first-level classroom sidebar navigation to replace the current history entry instead of pushing a lateral tab entry.
- Changed the Classwork sidebar reset path to clear selected assignment state with replace for both teacher and student nav.
- Added regression coverage for generic sidebar tab replacement and the Classwork selection-clear replace behavior while preserving existing in-tab workspace push coverage.

**Validation:**
- `pnpm exec vitest run tests/components/NavItems.test.tsx tests/components/ClassroomPageClientAssignmentsEditMode.test.tsx tests/components/TeacherClassroomView.test.tsx tests/components/TeacherTestsTab.test.tsx tests/components/TeacherQuizzesTab.test.tsx`
- `pnpm lint`
- `bash .codex/skills/pika-ui-verify/scripts/ui_verify.sh classrooms`
- Headless Playwright check: Daily → Classwork → assignment detail → Back returned to Classwork summary.
- `pnpm test -- tests/components/NavItems.test.tsx tests/components/ClassroomPageClientAssignmentsEditMode.test.tsx tests/components/TeacherClassroomView.test.tsx tests/components/TeacherTestsTab.test.tsx tests/components/TeacherQuizzesTab.test.tsx` (ran the full suite due script argument handling; only failed the pre-existing `TeacherGradebookTab.test.tsx` timeout)

## 2026-06-08 — Quiz individual responses freshness audit

**Completed:**
- Scoped `QuizIndividualResponses` loaded responders, questions, stats, load errors, and grading notices to the active assessment scope.
- Added request-id guards so stale individual-response result loads cannot overwrite after selected quiz/test id, API base, or assessment type changes.
- Guarded save/clear/suggest completion paths so old assessment grading callbacks cannot repaint notices or trigger parent refreshes after a selection switch.
- Added direct component coverage for stale result response overwrites and already-loaded old responses being hidden immediately on quiz switches.

**Validation:**
- `bash .codex/skills/pika-session-start/scripts/session_start.sh`
- `pnpm vitest run tests/components/QuizIndividualResponses.test.tsx tests/components/QuizDetailPanel.test.tsx`
- `git diff --check`
- `pnpm lint`
- `bash .codex/skills/pika-audit/scripts/audit.sh`
- `pnpm build`
- `pnpm vitest run tests/components/StudentAssignmentsTab.test.tsx tests/components/TeacherGradebookTab.test.tsx`
- `pnpm test`

## 2026-06-08 — Gradebook action consistency audit

**Completed:**
- Replaced the Gradebook score-display split button with the shared `SegmentedControl`, keeping score display as a two-state mode control instead of an action menu.
- Kept selected-student email actions as the only Gradebook split action, shown only when at least one valid selected student email exists.
- Updated Gradebook component coverage to assert score-display pressed state, absence of the old score-display action menu, and separation between score-display controls and selected-email menu actions.

**Validation:**
- `bash .codex/skills/pika-session-start/scripts/session_start.sh` (initial run hit a `TeacherGradebookTab` timeout; reran `pnpm vitest run tests/components/TeacherGradebookTab.test.tsx`, then `bash scripts/verify-env.sh` passed)
- `pnpm vitest run tests/components/TeacherGradebookTab.test.tsx`
- `bash .codex/skills/pika-ui-verify/scripts/ui_verify.sh 'classrooms/e80aa794-e2d6-4705-9da5-d08ab0fba861?tab=gradebook'`
- Manual loaded recaptures: `/tmp/pika-teacher-loaded.png`, `/tmp/pika-teacher-selected.png`, `/tmp/pika-teacher-mobile-loaded.png`
- `git diff --check`
- `pnpm lint`
- `pnpm build`
- `bash .codex/skills/pika-audit/scripts/audit.sh`
- `pnpm test` (one unrelated `StudentHistoryPage` concurrency failure; isolated rerun passed)
- `pnpm vitest run tests/components/StudentHistoryPage.test.tsx`
- `pnpm vitest run --sequence.concurrent=false`

## 2026-06-09 — Assignment returned-comment duplication fix

**Completed:**
- Stopped assignment AI grading from copying previously returned `feedback` into each new AI feedback result.
- Made the full assignment return route clear `teacher_feedback_draft` and AI suggestion fields after comments are sent as returned feedback.
- Added return-route coverage for clearing the comment draft and AI suggestion state.
- Fixed the stale teacher calendar component test by pinning `getTodayInToronto`; the test was clicking a past disabled date after June 8.

**Validation:**
- `bash .codex/skills/pika-session-start/scripts/session_start.sh` (failed on reproducible baseline `tests/components/TeacherCalendarPage.test.tsx` class-day toggle assertion before this branch's edits)
- `pnpm vitest run tests/components/TeacherCalendarPage.test.tsx tests/api/teacher/assignments-id-return.test.ts tests/api/teacher/assignments-id-feedback-return.test.ts tests/unit/ai-grading.test.ts tests/api/teacher/assignments-auto-grade.test.ts`
- `pnpm vitest run tests/api/teacher/assignments-id-return.test.ts tests/api/teacher/assignments-id-feedback-return.test.ts tests/unit/ai-grading.test.ts tests/api/teacher/assignments-auto-grade.test.ts`
- `pnpm test`
- `pnpm lint`
- `pnpm exec tsc --noEmit`

## 2026-06-08 — Assignment AI grading pane refresh

**Completed:**
- Refreshed the mounted selected-student assignment grading pane when a background assignment AI grading run completes, avoiding a full page refresh.
- Applied the same pane refresh to the legacy synchronous batch auto-grade path.
- Added classroom-view coverage that asserts a mounted grading pane receives a refresh-key bump after background AI grading completion.

**Validation:**
- `bash .codex/skills/pika-session-start/scripts/session_start.sh` (worktree rerun failed in baseline verification only: `LoginClient.test.tsx` two failures and `crypto.test.ts` password hash timeout; prior hub startup run failed different unrelated tests)
- `pnpm vitest run tests/components/TeacherClassroomView.test.tsx`
- `pnpm lint`
- `bash .codex/skills/pika-ui-verify/scripts/ui_verify.sh classrooms`

## 2026-06-08 — FAB subshell standardization

**Completed:**
- Added a standardized `floatingAction` split-button slot to `TeacherWorkSurfaceActionBar`.
- Migrated teacher Classwork, Tests, Gradebook, Roster, and Announcements FAB clusters to one split action per first-level tab/workspace, moving secondary toggles/actions into the split menu.
- Consolidated selected-assignment pane switching, survey visibility/edit actions, gradebook score display/column/email actions, roster CSV/remove/email actions, and announcement creation into standardized split menus.
- Left Calendar/Attendance unchanged because their FAB controls are date/view navigation rather than action menus.
- Deferred product quiz removal to a later pass; Tests remain in scope.

**Validation:**
- `pnpm exec tsc --noEmit`
- `pnpm lint`
- `pnpm exec vitest run tests/components/TeacherClassroomView.test.tsx tests/components/TeacherTestsTab.test.tsx tests/components/TeacherGradebookTab.test.tsx tests/components/TeacherRosterTab.test.tsx tests/components/TeacherWorkSurfaceActionBar.test.tsx tests/components/ClassroomPageClientAssignmentsEditMode.test.tsx`
- `pnpm build`
- `E2E_BASE_URL=http://localhost:3001 pnpm e2e:auth`
- Visual verification screenshots for teacher Classwork, Tests, Gradebook, Roster, Announcements, plus student Classwork sanity check.

## 2026-06-08 — Product quiz removal

**Completed:**
- Removed teacher and student `/api/*/quizzes` product routes, quiz override route, teacher quiz tab, quiz card/modal components, and matching route/component tests.
- Made the student assessment tab and shared legacy-named quiz components operate against tests by default while preserving test database compatibility.
- Removed quizzes from gradebook output, course blueprint package import/export, blueprint AI targets, classroom blueprint source loading, and course-site grading summaries.
- Renamed the teacher assessment update browser event from the old quiz name to a tests-specific event.
- Updated AI routing, architecture, course blueprint package, and teacher work-surface docs so quizzes are no longer described as an active product surface.
- PR self-review tightened remaining blueprint and actual-site paths so legacy quiz assessments are not cloned or rendered.

**Validation:**
- `pnpm lint`
- `pnpm test --run tests/components/TeacherTestsTab.test.tsx tests/components/QuizDetailPanel.test.tsx tests/components/StudentQuizzesTab.test.tsx tests/components/StudentQuizResults.test.tsx tests/components/StudentQuizForm.test.tsx`
- `pnpm test` (301 files / 2655 tests)
- Post-review focused checks for blueprint/test paths and isolated `StudentHistoryPage` flake rerun.
- `bash .codex/skills/pika-ui-verify/scripts/ui_verify.sh "classrooms"`
- `bash .codex/skills/pika-ui-verify/scripts/ui_verify.sh "classrooms/e80aa794-e2d6-4705-9da5-d08ab0fba861?tab=tests"`
- `bash .codex/skills/pika-ui-verify/scripts/ui_verify.sh "classrooms/e80aa794-e2d6-4705-9da5-d08ab0fba861?tab=gradebook"`

## 2026-06-08 — Legacy quiz UI naming cleanup

**Completed:**
- Created `codex/legacy-quiz-naming-cleanup` from `origin/main` after PR #758.
- Renamed remaining legacy quiz-named UI component implementations and component tests to test-named files.
- Left old `Quiz*`/`StudentQuizzesTab` files as thin compatibility wrappers around the new `Test*` implementations.
- Updated active app imports and component test mocks to use the new test-named modules.
- Preserved database/type/API compatibility names such as `quizzes`, `QuizQuestion`, and `quiz` response payload keys for a later contract-level pass.

**Validation:**
- `bash .codex/skills/pika-session-start/scripts/session_start.sh`
- `pnpm test tests/components/StudentTestsTab.test.tsx tests/components/TestDetailPanel.test.tsx tests/components/StudentTestForm.test.tsx tests/components/StudentTestResults.test.tsx tests/components/TestResultsView.test.tsx tests/components/TestIndividualResponses.test.tsx tests/components/TeacherTestsTab.test.tsx tests/components/ClassroomPageClientAssignmentsEditMode.test.tsx`
- `pnpm lint`
- `pnpm test` (301 files / 2655 tests)
- `pnpm build`

## 2026-06-09 — Main to production release sync

**Completed:**
- Ran the repository `pika-main-to-production-merge` workflow to merge latest `main` into `production`.
- Created and merged PR #760: https://github.com/codepetca/pika/pull/760.
- Stabilized the calendar class-day toggle test by mocking Toronto today so it no longer depends on the real current date.
- Fast-forwarded the local production worktree to `origin/production` at `feb050be1281f8ba1d8c1fc8249f912353a4fe0a`.

**Validation:**
- `pnpm vitest run tests/components/TeacherCalendarPage.test.tsx`
- GitHub PR #760 checks: `Test & Build`, `Check UI Import Policy`, `Check No dark: Classes in App Code`, Vercel status all passed.

## 2026-06-09 — Legacy quiz contract transition

**Completed:**
- Created `codex/legacy-quiz-contract-cleanup` from `origin/main`.
- Audited remaining internal `quiz` / `quizzes` references across migrations, API payloads, shared types, server/lib code, UI wrappers, tests, and docs.
- Added dual `test`/`tests` plus legacy `quiz`/`quizzes` response keys to active `/api/*/tests` endpoints.
- Updated active test clients to prefer `test`/`tests` response keys with legacy fallback.
- Added test-named type aliases and `@/lib/tests` helper exports, then migrated active test routes/components to those names.
- Removed unused one-line legacy UI wrappers (`Quiz*`, `StudentQuiz*`, `StudentQuizzesTab`) and updated architecture/UI guidance.
- Left production schema, migrations, legacy DB tables, gradebook legacy fields, and blueprint schema compatibility unchanged.

**Validation:**
- `pnpm exec tsc --noEmit`
- `pnpm vitest run tests/api/teacher/tests-route.test.ts tests/api/teacher/tests-id-route.test.ts tests/api/teacher/tests-results.test.ts tests/api/student/tests-route.test.ts tests/api/student/tests-id.test.ts tests/api/student/tests-results.test.ts tests/api/student/tests-session-status.test.ts tests/components/TeacherTestsTab.test.tsx tests/components/StudentTestsTab.test.tsx tests/components/TestDetailPanel.test.tsx tests/components/StudentTestForm.test.tsx tests/components/StudentTestResults.test.tsx tests/components/TestIndividualResponses.test.tsx`
- `pnpm lint`
- `pnpm build`
- `node scripts/trim-session-log.mjs && node scripts/trim-session-log.mjs --check`
- `pnpm vitest run tests/unit/ai-startup-docs.test.ts`
- `pnpm test` (301 files / 2655 tests)

## 2026-06-09 — Roster summary pane removal

**Completed:**
- Created `codex/remove-roster-summary` from `origin/main`.
- Removed the teacher roster tab's right-side inspector pane and fallback `Roster Summary` panel.
- Kept roster row selection behavior for existing single-student and bulk roster actions.
- Added a component regression test asserting the roster summary inspector and resize separator are absent.

**Validation:**
- `bash .codex/skills/pika-session-start/scripts/session_start.sh` (includes `pnpm test`, 301 files / 2655 tests)
- `pnpm test tests/components/TeacherRosterTab.test.tsx`
- `pnpm lint`
- `E2E_BASE_URL=http://localhost:3001 bash .codex/skills/pika-ui-verify/scripts/ui_verify.sh 'classrooms/6d20a5cb-c497-4dc1-ac74-0637068c8a7f?tab=roster'`
- Live Playwright DOM check: no `Roster Summary`, no `Resize Roster panes` separator, roster scroll pane visible.
- `pnpm build`

## 2026-06-09 — Legacy quiz internal test naming pass

**Completed:**
- Merged PR #762 (`Clean up legacy quiz test contracts`) into `main`.
- Created `codex/legacy-quiz-internal-test-names` from the merged `origin/main`.
- Continued the safe internal naming transition by moving active `/tests` route/test type imports to `Test*` aliases.
- Updated active `/api/*/tests` assertions and the return-visibility integration test to read `test`/`tests` first while preserving explicit legacy `quiz`/`quizzes` equality checks.
- Added test-named mock factories (`createMockTest`, `createMockTestQuestion`, `createMockTestResponse`) over the legacy DB-shaped contracts.
- Migrated `TestDetailPanel` component test fixtures to test-named aliases/helpers without changing the component prop contract or schema-shaped `quiz_id` fields.

**Validation:**
- `bash .codex/skills/pika-session-start/scripts/session_start.sh` (includes `pnpm test`, 301 files / 2655 tests)
- `pnpm exec tsc --noEmit`
- `pnpm lint`
- `pnpm vitest run tests/api/teacher/tests-route.test.ts tests/api/teacher/tests-id-route.test.ts tests/api/student/tests-route.test.ts tests/api/student/tests-id.test.ts tests/api/student/tests-results.test.ts tests/api/student/tests-session-status.test.ts tests/api/integration/test-return-visibility-flow.test.ts tests/components/TestResultsView.test.tsx tests/components/TestDetailPanel.test.tsx tests/hooks/useDraftMode.test.ts tests/components/StudentTestsTab.test.tsx`
- `node scripts/trim-session-log.mjs && node scripts/trim-session-log.mjs --check`

## 2026-06-09 — Legacy quiz student Tests state naming pass

**Completed:**
- Created `codex/legacy-quiz-ui-state-names` from the merged `origin/main`.
- Renamed active `StudentTestsTab` local state, refs, handlers, and selected-detail object keys from quiz-oriented names to test-oriented names.
- Preserved legacy API compatibility response keys (`quiz`, `quizzes`) and existing child component `quizId` prop contracts.
- Did not touch database schema, migrations, RPCs, storage paths, or production API route contracts.

**Validation:**
- `bash .codex/skills/pika-session-start/scripts/session_start.sh` (includes `pnpm test`, 301 files / 2655 tests)
- `pnpm exec tsc --noEmit`
- `pnpm vitest run tests/components/StudentTestsTab.test.tsx`
- `pnpm vitest run tests/components/StudentTestForm.test.tsx tests/components/StudentTestResults.test.tsx`
- `pnpm lint`

## 2026-06-09 — Legacy quiz teacher Tests state naming pass

**Completed:**
- Created `codex/legacy-quiz-teacher-state-names` from merged `origin/main`.
- Renamed `ClassroomPageClient` teacher Tests parent state from `selectedQuiz`/`handleSelectQuiz` to `selectedTest`/`handleSelectTest`.
- Renamed the local pending-delete object key from `quiz` to `test` for active Tests deletion state.
- Preserved legacy `quizId` query cleanup and existing child component/API compatibility contracts.
- Did not touch database schema, migrations, RPCs, storage paths, or production API route contracts.

**Validation:**
- `bash .codex/skills/pika-session-start/scripts/session_start.sh` (includes `pnpm test`, 301 files / 2655 tests)
- `pnpm exec tsc --noEmit`
- `pnpm vitest run tests/components/ClassroomPageClientAssignmentsEditMode.test.tsx tests/components/TeacherTestsTab.test.tsx`
- `pnpm lint`

## 2026-06-09 — Legacy quiz component prop alias pass

**Completed:**
- Created `codex/legacy-quiz-prop-aliases` from merged `origin/main`.
- Added test-named component prop aliases while preserving legacy compatibility props:
  `testId` for `StudentTestForm`, `StudentTestResults`, and `TestIndividualResponses`; `test`/`onTestUpdate` for `TestDetailPanel`.
- Migrated active app callers in `StudentTestsTab`, `TeacherTestsTab`, `TeacherTestPreviewPage`, and `TestDetailPanel` to test-named props.
- Left legacy `quizId`, `quiz`, and `onQuizUpdate` props supported for existing tests/hidden callers.
- Did not touch database schema, migrations, RPCs, storage paths, API payload keys, or DB-shaped `quiz_id` fields.

**Validation:**
- `bash .codex/skills/pika-session-start/scripts/session_start.sh` (includes `pnpm test`, 301 files / 2655 tests)
- `pnpm exec tsc --noEmit`
- `pnpm vitest run tests/components/StudentTestsTab.test.tsx tests/components/StudentTestForm.test.tsx tests/components/StudentTestResults.test.tsx tests/components/TestIndividualResponses.test.tsx tests/components/TestDetailPanel.test.tsx tests/components/TeacherTestsTab.test.tsx tests/components/ClassroomPageClientAssignmentsEditMode.test.tsx`
- `pnpm lint`

## 2026-06-09 — Legacy quiz component test prop migration pass

**Completed:**
- Created `codex/legacy-quiz-test-prop-tests` from merged `origin/main`.
- Migrated direct component tests for `StudentTestForm`, `StudentTestResults`, `TestIndividualResponses`, and `TestDetailPanel` to active `testId`, `test`, and `onTestUpdate` props.
- Added narrow compatibility assertions for legacy `quizId`, `quiz`, and `onQuizUpdate` aliases so fallback support remains intentional.
- Updated the `TeacherTestsTab` mock of `TestDetailPanel` to model the active test-named prop contract instead of accepting legacy aliases.
- Did not touch production runtime code, database schema, migrations, RPCs, storage paths, API payload keys, or DB-shaped `quiz_id` fields.

**Validation:**
- `bash .codex/skills/pika-session-start/scripts/session_start.sh` (includes `pnpm test`, 301 files / 2655 tests before edits)
- `pnpm vitest run tests/components/StudentTestForm.test.tsx tests/components/StudentTestResults.test.tsx tests/components/TestIndividualResponses.test.tsx tests/components/TestDetailPanel.test.tsx tests/components/TeacherTestsTab.test.tsx`
- `pnpm exec tsc --noEmit`
- `pnpm lint`
- `node scripts/trim-session-log.mjs && node scripts/trim-session-log.mjs --check`
- `pnpm test` (301 files / 2662 tests)

## 2026-06-09 — Session log trim buffer

**Completed:**
- Split the session-log trim policy into a 60-entry CI cap and a 40-entry default retention target.
- Preserved `--check --keep` compatibility without adding another public flag.
- Updated startup guidance and trim tests so agents compact below the CI boundary after appending.

**Validation:**
- `node scripts/trim-session-log.mjs && node scripts/trim-session-log.mjs --check` (kept 40 of 61 entries; cap 60)
- `pnpm test tests/unit/trim-session-log.test.ts tests/unit/ai-startup-docs.test.ts`

## 2026-06-09 — Remove trim --max flag

**Completed:**
- Removed the public `--max` option from `scripts/trim-session-log.mjs`.
- Kept the default trim target at 40 entries and the default check cap at 60 entries.
- Preserved legacy `--check --keep N` compatibility for explicit check caps.
- Added coverage that `--max` is rejected and no longer appears in usage text.

**Validation:**
- `pnpm test tests/unit/trim-session-log.test.ts tests/unit/ai-startup-docs.test.ts`
- `node scripts/trim-session-log.mjs --check`

## 2026-06-09 — Legacy quiz TestDetailPanel internal rename pass

**Completed:**
- Created `codex/legacy-quiz-test-detail-internals` from merged `origin/main`.
- Renamed `TestDetailPanel` component-local runtime internals from legacy quiz names to test/assessment names:
  resolved assessment object, update notifier, request scope `testId`, defaults ref, loaded-draft guard, and detail load callback.
- Preserved public compatibility props (`quiz`, `onQuizUpdate`), API response fallback (`data.quiz`), legacy markdown helpers, inactive legacy quiz-mode UI fallbacks, and DB-shaped `quiz_id` fields.
- Did not touch database schema, migrations, RPCs, storage paths, API payload contracts, or production compatibility response keys.

**Validation:**
- `bash .codex/skills/pika-session-start/scripts/session_start.sh` (includes `pnpm test`, 301 files / 2659 tests before edits)
- `pnpm vitest run tests/components/TestDetailPanel.test.tsx tests/components/TeacherTestsTab.test.tsx`
- `pnpm exec tsc --noEmit`
- `pnpm lint`
- `node scripts/trim-session-log.mjs && node scripts/trim-session-log.mjs --check`
- `pnpm test` (301 files / 2659 tests)

## 2026-06-10 — Legacy quiz TestDetailPanel fixture cleanup pass

**Completed:**
- Created `codex/legacy-quiz-test-fixtures` from merged `origin/main`.
- Renamed pure `TestDetailPanel` component-test fixtures from legacy quiz-shaped local names to test/assessment names.
- Updated fake test ids and route expectations in stale-load/autosave cases from `quiz-*` to `test-*` where they are not DB fields or API compatibility payload keys.
- Preserved intentional compatibility coverage for legacy `quiz`/`onQuizUpdate` props, API `quiz` response fallbacks, DB-shaped `quiz_id` fields, and the same-id legacy `assessment_type: 'quiz'` race case.
- Did not touch production runtime code, database schema, migrations, RPCs, storage paths, or API payload contracts.

**Validation:**
- `bash .codex/skills/pika-session-start/scripts/session_start.sh` (includes `pnpm test`, 301 files / 2662 tests before edits)
- `pnpm vitest run tests/components/TestDetailPanel.test.tsx`
- `pnpm exec tsc --noEmit`
- `pnpm lint`
- `pnpm test` (301 files / 2662 tests)

## 2026-06-10 — Tests selected-student grading pane scrollbar fix

**Completed:**
- Created `codex/tests-selected-student-scrollbar` from `origin/main`.
- Fixed the selected Tests grading inspector scroll container so it fills the right pane as a flex child and clips horizontal overflow.
- Confirmed the issue was not in `TeacherWorkspaceSplit`; the gapped split pane width was correct, but the inspector's inner scroll node could size to content inside `TestWorkspacePaneFrame`.
- Added a focused `TeacherTestsTab` assertion for the inspector scroll container sizing and overflow classes.
- Kept the change scoped to the selected Tests grading pane layout; no FAB/action-cluster work was touched.

**Validation:**
- `bash .codex/skills/pika-session-start/scripts/session_start.sh` (includes `pnpm test`, 301 files / 2662 tests before edits)
- `pnpm exec tsc --noEmit`
- `pnpm lint`
- `pnpm test tests/components/TeacherTestsTab.test.tsx tests/components/TeacherWorkspaceSplit.test.tsx tests/components/TestStudentGradingPanel.test.tsx`
- `E2E_BASE_URL=http://localhost:3001 pnpm e2e:auth`
- `E2E_BASE_URL=http://localhost:3001 bash .codex/skills/pika-ui-verify/scripts/ui_verify.sh 'classrooms/e80aa794-e2d6-4705-9da5-d08ab0fba861?tab=tests&testId=91d01b50-807d-43ac-a5db-018c9645ac94&testMode=grading&testStudentId=d8f8a040-c511-4da2-98a8-be5bca37e1a6'`
- Playwright desktop forced-scroll check: right pane scroll node `rightDeltaPx: 0` while vertically overflowing (`scrollHeight 956`, `clientHeight 504`).

## 2026-06-10 — Legacy quiz utility alias pass

**Completed:**
- Created `codex/legacy-quiz-utility-aliases` from merged `origin/main`.
- Moved the primary assessment utility implementation from `src/lib/quizzes.ts` to `src/lib/assessments.ts`, leaving `src/lib/quizzes.ts` as a compatibility re-export shim.
- Moved server assessment access helpers from `src/lib/server/quizzes.ts` to `src/lib/server/assessments.ts`, adding assessment-named exports while preserving quiz-named aliases.
- Pointed active imports in test/markdown/draft helpers at `@/lib/assessments` and `@/lib/server/assessments`.
- Added assessment-named mock factories and moved active Tests component tests to `createMockTest*` helpers while keeping legacy `createMockQuiz*` helpers for compatibility tests.
- Renamed focused utility tests from quiz-named files to assessment-named files.
- Did not touch production schema, migrations, API payload contracts, storage/RPC paths, or DB-shaped `quiz_id` fields.

**Validation:**
- `bash .codex/skills/pika-session-start/scripts/session_start.sh` (includes `pnpm test`, 301 files / 2662 tests before edits)
- `pnpm vitest run tests/lib/assessments.test.ts tests/unit/assessments.test.ts tests/unit/server-assessments.test.ts tests/unit/server-access.test.ts tests/components/StudentTestForm.test.tsx tests/components/TeacherTestsTab.test.tsx tests/lib/quiz-markdown.test.ts tests/unit/assessment-drafts.test.ts`
- `pnpm exec tsc --noEmit`
- `pnpm lint`
- `pnpm vitest run tests/components/AssignmentModal.test.tsx` (reran after one unrelated full-suite timing failure)
- `pnpm test` (301 files / 2662 tests)

## 2026-06-12 — Startup orient-only mode and fast verify-env

**Completed:**
- Added `--orient-only` / `--read-only` support to `.codex/skills/pika-session-start/scripts/session_start.sh` so report-only and docs-only runs can load startup context without mutating `.env.local` or running `verify-env.sh`.
- Changed `scripts/verify-env.sh` so the default path stops after environment and dependency checks; test execution now requires `--tests` or `--full`.
- Updated startup guidance in `.ai/START-HERE.md`, `.codex/prompts/session-start.md`, `.claude/commands/session-start.md`, `AGENTS.md`, and the `pika-session-start` skill to document the read-only startup path and the new verify-env modes.
- Extended `tests/unit/ai-startup-docs.test.ts` to lock the non-mutating orient-only behavior, the fast default `verify-env.sh` path, and the startup-doc references.

**Validation:**
- `pnpm install --frozen-lockfile`
- `pnpm test tests/unit/trim-session-log.test.ts tests/unit/ai-startup-docs.test.ts`
- `node scripts/trim-session-log.mjs --check`
- `git diff --check`

## 2026-06-05 — Skill progression map refresh

**Completed:**
- Reviewed startup context, current repo invariants, and recent merged PR history before making recommendations.
- Collected evidence from merged PRs `#719`, `#724`, `#725`, `#726`, `#728`, `#729`, `#730`, `#731`, `#732`, `#733`, `#734`, `#735`, `#736`, plus self-review notes on `#709` and `#711`.
- Identified recurring themes around classroom freshness/cache invalidation, contract-boundary hardening, component regression testing, and Gradex integration follow-through.

**Validation:**
- `bash scripts/verify-env.sh` (fails: `node_modules` missing in this worktree)
- `gh pr list --state merged --limit 12 --json number,title,mergedAt,author,labels,url`
- `gh pr view <pr> --json number,title,mergedAt,files,reviews,url`
- `gh api graphql` against recent merged PR review metadata

## 2026-06-05 — Teacher attendance freshness guards

**Completed:**
- Exported the assessment access result type from `src/lib/server/assessments.ts` as `AssessmentAccessResult`.
- Updated assessment access not-found errors from quiz wording to assessment wording.
- Updated server access unit tests to exercise assessment-named helpers as the primary path.
- Kept legacy `assertTeacherOwnsQuiz`, `assertStudentCanAccessQuiz`, and `quiz` result fields covered as compatibility aliases.
- Did not change API response shapes, database tables, schema, migrations, RPCs, storage paths, or persisted `quiz_id` fields.

**Validation:**
- `bash .codex/skills/pika-session-start/scripts/session_start.sh`
- `pnpm exec tsc --noEmit`
- `pnpm test tests/unit/server-access.test.ts`
- `pnpm lint`
- `pnpm test`

## 2026-06-13 — Student exam-mode transient focus e2e

**Completed:**
- Added a focused Playwright e2e case covering transient blur/focus restoration during an active student exam.
- Verified the open-response draft stays visible, exam lock overlays do not appear, and focus telemetry records a zero-second away restoration.
- Reused the existing exam-mode API setup and cleanup helpers; no schema, app logic, or seeded data changes.

**Validation:**
- `bash .codex/skills/pika-session-start/scripts/session_start.sh`
- `pnpm exec playwright test e2e/student-exam-mode.spec.ts -g "keeps a transient away restoration" --project=chromium-desktop`
- `pnpm lint`

## 2026-06-14 — Teacher Tests payload type names

**Completed:**
- Added current-key local response types in `TeacherTestsTab` for teacher test list and results payloads.
- Kept legacy `quiz` and `quizzes` fields documented as compatibility fallbacks in those local types.
- Updated `TeacherTestsTab` component fixtures so current `test` results and create payloads are the default.
- Added explicit legacy `quiz` results-payload fallback coverage.
- Did not change API response shapes, route contracts, schema, migrations, RPCs, storage paths, or persisted `quiz_id` fields.

**Validation:**
- `bash .codex/skills/pika-session-start/scripts/session_start.sh`
- `pnpm exec tsc --noEmit`
- `pnpm test tests/components/TeacherTestsTab.test.tsx`
- `pnpm lint`
- `pnpm test`

## 2026-06-14 — Assessment utility fixture naming
## 2026-06-06 — Teacher classroom index cache audit

**Completed:**
- Updated generic assessment utility comments and local parameter names from quiz wording to assessment wording.
- Switched generic `tests/unit/assessments.test.ts` cases to use test-shaped fixtures for response eligibility, result visibility, editing, activation, and aggregation.
- Left explicit legacy quiz alias/status coverage on `createMockQuiz` where the test is intentionally about quiz compatibility.
- Did not change API response shapes, route contracts, schema, migrations, RPCs, storage paths, or persisted `quiz_id` fields.

**Validation:**
- `bash .codex/skills/pika-session-start/scripts/session_start.sh`
- `pnpm exec tsc --noEmit`
- `pnpm test tests/unit/assessments.test.ts`
- `pnpm lint`
- `pnpm test`

## 2026-06-14 — Production release sync

**Completed:**
- Merged latest `origin/main` into `production` through protected PR #795.
- Verified required GitHub checks passed before merging.
- Synced the local production worktree to `origin/production` at `f483bbcbdc055fef379b655d6162b03c5fee073e`.
- Risk profile: runtime-platform.
- Model recommendation: GPT-5 Codex - protected-branch release orchestration with CI and worktree synchronization.

**Validation:**
- `bash scripts/verify-env.sh`
- `bash .codex/skills/pika-main-to-production-merge/scripts/merge_main_into_production.sh`
- `gh run watch 27520948663 --repo codepetca/pika --interval 15 --exit-status`
- `gh pr merge 795 --repo codepetca/pika --merge --delete-branch`
- `git -C /Users/stew/Repos/.worktrees/pika/production merge --ff-only origin/production`

## 2026-06-14 — Draft hook assessment option names

**Completed:**
- Renamed the primary `useDraftMode` options from `quizId`/`quizTitle` to `assessmentId`/`assessmentTitle`.
- Kept legacy `quizId`/`quizTitle` option aliases for compatibility and added focused test coverage for them.
- Updated hook comments, examples, and tests to use assessment/test wording by default.
- Left DB-shaped `quiz_id` question fields and draft route contracts unchanged.

**Validation:**
- `bash .codex/skills/pika-session-start/scripts/session_start.sh`
- `pnpm exec tsc --noEmit`
- `pnpm test tests/hooks/useDraftMode.test.ts`
- `pnpm lint`
- `pnpm test`

## 2026-06-14 — Assessment draft sync error wording

**Completed:**
- Renamed `syncAssessmentQuestionsFromDraft` failure messages from quiz-question wording to assessment-question wording.
- Updated nearby generic assessment draft helper comments to avoid quiz/test route wording.
- Updated the focused unit assertion for the renamed insert failure message.
- Left compatibility exports, `AssessmentDraftType = 'quiz' | 'test'`, `quiz_questions`, `quiz_id`, route contracts, and persisted payload shapes unchanged.

**Validation:**
- `bash .codex/skills/pika-session-start/scripts/session_start.sh`
- `pnpm exec tsc --noEmit`
- `pnpm test tests/unit/assessment-drafts.test.ts`
- `pnpm lint`
- `pnpm test`

## 2026-06-14 — Current test fixture wording cleanup

**Completed:**
- Renamed server assessment visibility unit-test descriptions and locals from quiz wording to assessment wording.
- Updated `StudentTestResults` current-surface test fixtures to use `test-1` and `Test not found` while preserving the explicit legacy `quizId` alias test.
- Updated the flagged-question helper file comment from test/quiz taking to test taking.
- Did not change runtime behavior, schema, API payloads, compatibility aliases, or persisted `quiz_id` fields.

**Validation:**
- `bash .codex/skills/pika-session-start/scripts/session_start.sh`
- `pnpm exec tsc --noEmit`
- `pnpm test tests/unit/server-assessments.test.ts tests/components/StudentTestResults.test.tsx tests/lib/flag-questions.test.ts`
- `pnpm lint`
- `pnpm test` (first run hit an unrelated `StudentLessonCalendarTab.test.tsx` timeout; isolated rerun passed)
- `pnpm test`

## 2026-06-14 — Teacher work-surface docs test wording

**Completed:**
- Updated stable teacher work-surface guidance from assignments/quizzes/tests to assignments/tests.
- Removed active teacher quiz authoring/state-machine references from the canon.
- Updated the work-surface audit and stable guidance index to match the active Tests product surface.
- Left the explicit legacy drift row for tests/quizzes shell paths because it documents drift to avoid copying.

**Validation:**
- `bash .codex/skills/pika-session-start/scripts/session_start.sh`
- `pnpm test tests/unit/ui-guidance-docs.test.ts tests/unit/ai-startup-docs.test.ts`
- `pnpm lint`
- `pnpm test`

## 2026-06-14 — Individual test response fixture wording

**Completed:**
- Renamed `TestIndividualResponses` current-surface test helper and stale/current fixture ids from quiz wording to test wording.
- Updated stale-response test descriptions to say selected test changes.
- Preserved explicit legacy `quizId` alias coverage and left runtime compatibility props unchanged.
- No schema, API payload, or production code changes.

**Validation:**
- `bash .codex/skills/pika-session-start/scripts/session_start.sh`
- `pnpm exec tsc --noEmit`
- `pnpm test tests/components/TestIndividualResponses.test.tsx`
- `pnpm lint`
- `pnpm test`

## 2026-06-14 — Arbitrary quiz fixture wording cleanup

**Completed:**
- Renamed arbitrary announcement and lesson-calendar fixture copy from Quiz wording to Test wording.
- Updated the generic dev-flow risk checklist example from quiz status to test status.
- Left schema, API compatibility keys, gradebook category fields, and legacy alias coverage unchanged.
- No production schema or runtime contract changes.

**Validation:**
- `bash .codex/skills/pika-session-start/scripts/session_start.sh`
- `pnpm exec tsc --noEmit`
- `pnpm test tests/api/teacher/announcements.test.ts tests/unit/announcements.test.ts tests/components/LessonCalendar.test.tsx tests/components/LessonDayCell.test.tsx`
- `pnpm lint`
- `pnpm test` (first run hit unrelated component timeout failures; failed files passed on isolated rerun)
- `pnpm test`

## 2026-06-14 — Student tests response fixture keys

**Completed:**
- Updated `StudentTestsTab` test fixtures to use current `tests`/`test` response keys by default.
- Added explicit legacy `quiz`/`quizzes` response-key fallback coverage for the student tests component.
- Left DB-shaped `quiz_id` question fields and legacy `student-quiz-action-footer` test id unchanged.
- No production code, schema, or API contract changes.

**Validation:**
- `bash .codex/skills/pika-session-start/scripts/session_start.sh`
- `pnpm exec tsc --noEmit`
- `pnpm test tests/components/StudentTestsTab.test.tsx` (first run hit an unrelated exam-mode timeout after the new fallback test passed; rerun passed)
- `pnpm lint`
- `pnpm test`

## 2026-06-14 — Test detail response fixture keys

**Completed:**
- Updated `TestDetailPanel` test fixtures to use current `test` response keys by default.
- Added explicit legacy `quiz` response-key fallback coverage for teacher test detail payloads.
- Preserved legacy `quiz`/`onQuizUpdate` prop alias coverage and the stale same-id quiz assessment scenario.
- No production code, schema, or API contract changes.

**Validation:**
- `bash .codex/skills/pika-session-start/scripts/session_start.sh`
- `pnpm exec tsc --noEmit`
- `pnpm test tests/components/TestDetailPanel.test.tsx`
- `pnpm lint`
- `pnpm test`

## 2026-06-16 — Legacy quiz contract cleanup plan

**Completed:**
- Added `docs/guidance/legacy-quiz-contract-cleanup.md` to inventory remaining internal `quiz` / `quizzes` references by category.
- Documented what can still be safely renamed versus what requires payload, gradebook, course package, or schema migration planning.
- Added routing from `docs/ai-instructions.md` and the architecture assessments section so future passes load the cleanup guide.
- No production schema, API payload, or runtime behavior changes.

**Validation:**
- `bash .codex/skills/pika-session-start/scripts/session_start.sh`
- `pnpm test tests/unit/ai-startup-docs.test.ts tests/unit/ui-guidance-docs.test.ts tests/unit/course-blueprint-package-docs.test.ts`
- `pnpm lint`
- `pnpm test`

## 2026-06-16 — Legacy quiz markdown fixture clarity

**Completed:**
- Updated `tests/lib/quiz-markdown.test.ts` so the suite explicitly describes legacy quiz markdown compatibility.
- Replaced arbitrary `Intro Quiz` fixture titles with `Legacy Check-in` while preserving the intentional `# Quiz` legacy markdown format.
- Left production markdown helpers, schema, API payloads, and runtime behavior unchanged.

**Validation:**
- `bash .codex/skills/pika-session-start/scripts/session_start.sh`
- `pnpm test tests/lib/quiz-markdown.test.ts`
- `pnpm lint`
- `pnpm test`

## 2026-06-16 — Test AI gold-set fixture wording

**Completed:**
- Renamed the active Test AI grading gold-set title from `Intro CS Concepts Quiz` to `Intro CS Concepts Test`.
- Verified the old fixture wording is gone from scripts/tests/source docs.
- Left AI grading logic, schema, API payloads, and runtime contracts unchanged.

**Validation:**
- `bash .codex/skills/pika-session-start/scripts/session_start.sh`
- `pnpm tsx scripts/measure-ai-grading-prompts.ts`
- `pnpm lint`
- `pnpm test`

## 2026-06-19 — Skill progression map refresh

**Completed:**
- Reviewed recent merged PRs and review evidence to identify the next engineering skills worth deepening.
- Anchored recommendations to the June 8-16, 2026 PR cluster around legacy quiz-to-test contract cleanup and classroom-switch race-condition fixes.
- Found that the strongest recurring review signals were stale async state during classroom navigation and compatibility gaps during naming-contract migration.

**Validation:**
- `bash .codex/skills/pika-session-start/scripts/session_start.sh --orient-only`
- `gh pr list --repo codepetca/pika --state merged --limit 15 --json number,title,mergedAt,url`
- `gh api graphql` review scan across recent merged PRs

## 2026-06-19 — Dev-flow skill upgrades

**Completed:**
- Implemented the three skill improvements as repo guidance updates instead of a separate process layer.
- Strengthened `docs/guidance/dev-flow-risk-checklists.md` with explicit route-owner identity, stale-response guards, and A-then-B regression expectations for workspace-state work.
- Expanded `docs/guidance/schema-rollout-checklist.md` and `docs/guidance/legacy-quiz-contract-cleanup.md` to require explicit migration slices, new-contract-first readers, and listed surviving legacy aliases.
- Expanded `docs/guidance/component-refactor-checklist.md` to require sliced refactors with grep/test exit criteria.
- Wired the new checks into `.codex/prompts/session-start.md`, `.codex/prompts/audit.md`, and `.codex/prompts/tdd.md`.

**Validation:**
- `git diff -- docs/guidance/dev-flow-risk-checklists.md docs/guidance/schema-rollout-checklist.md docs/guidance/component-refactor-checklist.md docs/guidance/legacy-quiz-contract-cleanup.md .codex/prompts/session-start.md .codex/prompts/audit.md .codex/prompts/tdd.md`
- `sed -n '1,220p' .codex/prompts/tdd.md`

## 2026-06-09 — Classroom theme colors

**Completed:**
- Created `codex/classroom-theme-colors` in a dedicated worktree.
- Added a `theme_color` classroom field with deterministic backfill/default migration and centralized palette helpers.
- Threaded classroom theme colors through teacher, student, and blueprint classroom APIs.
- Added color recognition affordances in teacher/student classroom lists, classroom dropdown/header, and teacher settings.
- Added teacher settings controls for changing the classroom color.
- Rebasing checkpoint: stashed the uncommitted implementation, rebased `codex/classroom-theme-colors` onto `origin/main`, restored the stash without conflicts, and confirmed `079_classroom_theme_color.sql` remains the next migration after `origin/main`'s `078`.
- Repeat rebase checkpoint: fetched `origin/main`; branch was already up to date, stash restored without conflicts, and `079_classroom_theme_color.sql` still follows `origin/main`'s `078` with no duplicate migration prefix.
- Pre-PR self-review fix: kept the student classroom list query tolerant of the pre-migration schema but shaped the JSON response to avoid returning every classroom column.
- Design revision after PR review: removed dot/swatch marker elements, themed the classroom appbar through the header surface/bottom rule, and kept classroom list recognition on existing card borders.
- Final PR update: rebased the revised design commit onto the latest `origin/main`; migration `079_classroom_theme_color.sql` remained correctly sequenced.
- Palette variant update: extended each classroom color to paired light/dark accents, kept the stored value as one palette key, and used CSS theme variables so the appbar/list/settings treatment adapts by mode.
- Default color update: new classrooms and blueprint-instantiated classrooms now choose the least-used active teacher classroom color before repeating.
- Performance follow-up: narrowed student and teacher classroom list queries to rendered fields instead of full classroom rows, with legacy fallbacks when `theme_color` is unavailable during rollout.
- Duplicate-color follow-up: changed existing-classroom migration backfill to assign per-teacher ordered palette positions, changed new-classroom default selection to seed among least-used colors, and added list hydration fallback colors for pre-migration local data.
- UI follow-up: fixed classroom card/settings theme border specificity so existing edges visibly render classroom colors instead of the generic border utility.
- Classroom list card follow-up: added a subtle classroom-accent card surface gradient to teacher/student classroom list cards and drag previews so classroom color is apparent beyond the edge.
- Gradient follow-up: extended classroom gradients farther into list cards and the classroom appbar while keeping the tint subtle.
- Appbar underline follow-up: removed the classroom-colored appbar underline so the active classroom header is identified by the subtle gradient only, with the normal neutral border retained.
- Final gradient/settings follow-up: removed colored list-card edge accents, extended card/appbar gradients further, changed settings color options so every swatch shows its gradient and only the selected option has the accent edge plus label, and propagated saved classroom changes to the page shell so the appbar updates without refresh.
- Left-edge follow-up: restored the classroom accent edge on the appbar left side and classroom card left side while keeping the appbar bottom border neutral and retaining the extended gradients.
- Hover follow-up: changed classroom list card hover/focus feedback from an inner button fill to a full-card classroom-accent outline.
- Bottom-controls follow-up: made the classroom list bottom edit control shell chromeless so the pencil sits on the page without a visible card surface.
- Appbar logo follow-up: changed the Pika logo to a classroom-accent masked mark only when an active classroom theme is present, leaving the normal brand image on unthemed appbars.
- Appbar logo alignment follow-up: normalized brand and classroom logo rendering into the same fixed centered box and removed the appbar left accent edge now that the logo carries the classroom color.
- Classroom card hover follow-up: replaced the full-card hover outline with a subtle whole-card lift and panel shadow increase.
- Appbar logo revert follow-up: removed the classroom-colored Pika logo variant and restored the classroom accent edge on the appbar left side.

**Validation:**
- `bash .codex/skills/pika-session-start/scripts/session_start.sh` (after `pnpm install`; includes `pnpm test`, 301 files / 2655 tests)
- `pnpm test tests/unit/classroom-theme.test.ts tests/lib/validations/teacher.test.ts tests/api/teacher/classrooms.test.ts tests/api/teacher/classrooms-id.test.ts tests/api/student/classrooms.test.ts tests/api/student/classrooms-id.test.ts tests/api/teacher/course-blueprint-instantiate.test.ts tests/components/TeacherClassroomsIndex.test.tsx tests/components/StudentClassroomsIndex.test.tsx tests/components/ClassroomDropdown.test.tsx tests/components/TeacherSettingsTab.test.tsx`
- `pnpm lint`
- `pnpm test` (302 files / 2669 tests)
- `pnpm build`
- `pnpm e2e:auth`
- Playwright screenshots under `/tmp/pika-classroom-theme/` for teacher/student classroom lists, teacher/student detail headers, and teacher settings in light/dark modes.
- Post-rebase: `pnpm test tests/unit/classroom-theme.test.ts tests/lib/validations/teacher.test.ts tests/api/teacher/classrooms.test.ts tests/api/teacher/classrooms-id.test.ts tests/api/student/classrooms.test.ts tests/api/student/classrooms-id.test.ts tests/api/teacher/course-blueprint-instantiate.test.ts tests/components/TeacherClassroomsIndex.test.tsx tests/components/StudentClassroomsIndex.test.tsx tests/components/ClassroomDropdown.test.tsx tests/components/TeacherSettingsTab.test.tsx`
- Post-rebase: `pnpm lint`
- Repeat post-rebase: `pnpm test tests/unit/classroom-theme.test.ts tests/lib/validations/teacher.test.ts tests/api/teacher/classrooms.test.ts tests/api/teacher/classrooms-id.test.ts tests/api/student/classrooms.test.ts tests/api/student/classrooms-id.test.ts tests/api/teacher/course-blueprint-instantiate.test.ts tests/components/TeacherClassroomsIndex.test.tsx tests/components/StudentClassroomsIndex.test.tsx tests/components/ClassroomDropdown.test.tsx tests/components/TeacherSettingsTab.test.tsx`
- Repeat post-rebase: `pnpm lint`
- Pre-PR: `pnpm test tests/unit/classroom-theme.test.ts tests/lib/validations/teacher.test.ts tests/api/teacher/classrooms.test.ts tests/api/teacher/classrooms-id.test.ts tests/api/student/classrooms.test.ts tests/api/student/classrooms-id.test.ts tests/api/teacher/course-blueprint-instantiate.test.ts tests/components/TeacherClassroomsIndex.test.tsx tests/components/StudentClassroomsIndex.test.tsx tests/components/ClassroomDropdown.test.tsx tests/components/TeacherSettingsTab.test.tsx`
- Pre-PR: `pnpm lint`
- Pre-PR: `pnpm build`
- Design revision: `pnpm test tests/unit/classroom-theme.test.ts tests/lib/validations/teacher.test.ts tests/api/teacher/classrooms.test.ts tests/api/teacher/classrooms-id.test.ts tests/api/student/classrooms.test.ts tests/api/student/classrooms-id.test.ts tests/api/teacher/course-blueprint-instantiate.test.ts tests/components/AppHeader.test.tsx tests/components/TeacherClassroomsIndex.test.tsx tests/components/StudentClassroomsIndex.test.tsx tests/components/ClassroomDropdown.test.tsx tests/components/TeacherSettingsTab.test.tsx`
- Design revision: `pnpm lint`
- Design revision: `pnpm build`
- Design revision visual verification: `E2E_BASE_URL=http://localhost:3002 bash .codex/skills/pika-ui-verify/scripts/ui_verify.sh classrooms`; plus Playwright screenshots for teacher/student classroom detail and teacher settings in light/dark mode under `/tmp/pika-classroom-theme-appbar-*.png`.
- Final post-rebase: `pnpm test tests/unit/classroom-theme.test.ts tests/lib/validations/teacher.test.ts tests/api/teacher/classrooms.test.ts tests/api/teacher/classrooms-id.test.ts tests/api/student/classrooms.test.ts tests/api/student/classrooms-id.test.ts tests/api/teacher/course-blueprint-instantiate.test.ts tests/components/AppHeader.test.tsx tests/components/TeacherClassroomsIndex.test.tsx tests/components/StudentClassroomsIndex.test.tsx tests/components/ClassroomDropdown.test.tsx tests/components/TeacherSettingsTab.test.tsx`
- Final post-rebase: `pnpm lint`
- Palette variant update: `pnpm test tests/unit/classroom-theme.test.ts tests/api/teacher/classrooms.test.ts tests/lib/server/course-blueprints.test.ts tests/components/AppHeader.test.tsx tests/components/TeacherSettingsTab.test.tsx`
- Palette variant update: `pnpm test tests/unit/classroom-theme.test.ts tests/lib/validations/teacher.test.ts tests/api/teacher/classrooms.test.ts tests/api/teacher/classrooms-id.test.ts tests/api/student/classrooms.test.ts tests/api/student/classrooms-id.test.ts tests/api/teacher/course-blueprint-instantiate.test.ts tests/lib/server/course-blueprints.test.ts tests/components/AppHeader.test.tsx tests/components/TeacherClassroomsIndex.test.tsx tests/components/StudentClassroomsIndex.test.tsx tests/components/ClassroomDropdown.test.tsx tests/components/TeacherSettingsTab.test.tsx`
- Palette variant update: `pnpm lint`
- Palette variant update: `pnpm build`
- Palette variant visual verification: `E2E_BASE_URL=http://localhost:3002 bash .codex/skills/pika-ui-verify/scripts/ui_verify.sh classrooms`; targeted screenshots in `/tmp/pika-classroom-theme-variants-*.png`; Playwright computed-style check confirmed light appbar accent `#2563eb` and dark appbar accent `#60a5fa`.
- Performance follow-up: `pnpm test tests/api/student/classrooms.test.ts tests/unit/server-classroom-order.test.ts tests/lib/server/classroom-order.test.ts tests/api/teacher/classrooms.test.ts`
- Performance follow-up: `pnpm test tests/unit/classroom-theme.test.ts tests/lib/validations/teacher.test.ts tests/api/teacher/classrooms.test.ts tests/api/teacher/classrooms-id.test.ts tests/api/student/classrooms.test.ts tests/api/student/classrooms-id.test.ts tests/api/teacher/course-blueprint-instantiate.test.ts tests/lib/server/course-blueprints.test.ts tests/unit/server-classroom-order.test.ts tests/lib/server/classroom-order.test.ts tests/components/AppHeader.test.tsx tests/components/TeacherClassroomsIndex.test.tsx tests/components/StudentClassroomsIndex.test.tsx tests/components/ClassroomDropdown.test.tsx tests/components/TeacherSettingsTab.test.tsx`
- Performance follow-up: `pnpm lint`
- Performance follow-up: `pnpm build`
- Duplicate-color follow-up: `supabase db query --local --output json "<read-only CTE verification>"` confirmed same-teacher classrooms get Blue then Teal before repeating.
- Duplicate-color follow-up: `pnpm test tests/unit/classroom-theme.test.ts tests/unit/classroom-theme-migration.test.ts tests/unit/server-classrooms.test.ts tests/api/teacher/classrooms.test.ts tests/api/student/classrooms.test.ts tests/api/student/classrooms-id.test.ts tests/components/TeacherClassroomsIndex.test.tsx tests/components/StudentClassroomsIndex.test.tsx tests/components/ClassroomDropdown.test.tsx tests/components/AppHeader.test.tsx tests/components/TeacherSettingsTab.test.tsx`
- Duplicate-color follow-up: `pnpm test tests/unit/classroom-theme.test.ts tests/unit/classroom-theme-migration.test.ts tests/unit/server-classrooms.test.ts tests/lib/validations/teacher.test.ts tests/api/teacher/classrooms.test.ts tests/api/teacher/classrooms-id.test.ts tests/api/student/classrooms.test.ts tests/api/student/classrooms-id.test.ts tests/api/teacher/course-blueprint-instantiate.test.ts tests/lib/server/course-blueprints.test.ts tests/unit/server-classroom-order.test.ts tests/lib/server/classroom-order.test.ts tests/components/AppHeader.test.tsx tests/components/TeacherClassroomsIndex.test.tsx tests/components/StudentClassroomsIndex.test.tsx tests/components/ClassroomDropdown.test.tsx tests/components/TeacherSettingsTab.test.tsx`
- Duplicate-color follow-up: `pnpm lint`
- Duplicate-color follow-up: `pnpm build`
- Duplicate-color visual verification: `E2E_BASE_URL=http://localhost:3002 bash .codex/skills/pika-ui-verify/scripts/ui_verify.sh classrooms`; Playwright computed-style check confirmed the local test list renders Blue and Teal card-edge colors for the two teacher classrooms.
- Classroom list card follow-up: `pnpm test tests/components/TeacherClassroomsIndex.test.tsx tests/components/StudentClassroomsIndex.test.tsx tests/components/ClassroomDropdown.test.tsx tests/unit/classroom-theme.test.ts tests/unit/server-classrooms.test.ts`
- Classroom list card follow-up: `pnpm test tests/unit/classroom-theme.test.ts tests/unit/classroom-theme-migration.test.ts tests/unit/server-classrooms.test.ts tests/lib/validations/teacher.test.ts tests/api/teacher/classrooms.test.ts tests/api/teacher/classrooms-id.test.ts tests/api/student/classrooms.test.ts tests/api/student/classrooms-id.test.ts tests/api/teacher/course-blueprint-instantiate.test.ts tests/lib/server/course-blueprints.test.ts tests/unit/server-classroom-order.test.ts tests/lib/server/classroom-order.test.ts tests/components/AppHeader.test.tsx tests/components/TeacherClassroomsIndex.test.tsx tests/components/StudentClassroomsIndex.test.tsx tests/components/ClassroomDropdown.test.tsx tests/components/TeacherSettingsTab.test.tsx`
- Classroom list card follow-up: `pnpm lint`
- Classroom list card follow-up: `pnpm build` after clearing stale generated `.next` output from an overlapping dev-server build.
- Classroom list card visual verification: `E2E_BASE_URL=http://localhost:3002 bash .codex/skills/pika-ui-verify/scripts/ui_verify.sh classrooms`; Playwright computed-style check confirmed list cards render classroom-color gradients.
- Gradient follow-up: `pnpm test tests/components/TeacherClassroomsIndex.test.tsx tests/components/StudentClassroomsIndex.test.tsx tests/components/AppHeader.test.tsx tests/unit/classroom-theme.test.ts`
- Gradient follow-up: `pnpm lint`
- Gradient follow-up: `pnpm build`
- Gradient visual verification: `E2E_BASE_URL=http://localhost:3002 bash .codex/skills/pika-ui-verify/scripts/ui_verify.sh classrooms`; Playwright computed-style check confirmed appbar gradient stops at 22%/78% and card gradient stops at 18%/62%.
- Appbar underline follow-up: `pnpm test tests/components/AppHeader.test.tsx`
- Appbar underline follow-up: `pnpm test tests/unit/classroom-theme.test.ts tests/unit/classroom-theme-migration.test.ts tests/unit/server-classrooms.test.ts tests/lib/validations/teacher.test.ts tests/api/teacher/classrooms.test.ts tests/api/teacher/classrooms-id.test.ts tests/api/student/classrooms.test.ts tests/api/student/classrooms-id.test.ts tests/api/teacher/course-blueprint-instantiate.test.ts tests/lib/server/course-blueprints.test.ts tests/unit/server-classroom-order.test.ts tests/lib/server/classroom-order.test.ts tests/components/AppHeader.test.tsx tests/components/TeacherClassroomsIndex.test.tsx tests/components/StudentClassroomsIndex.test.tsx tests/components/ClassroomDropdown.test.tsx tests/components/TeacherSettingsTab.test.tsx`
- Appbar underline follow-up: `pnpm lint`
- Appbar underline follow-up: `pnpm build`
- Appbar underline visual verification: `E2E_BASE_URL=http://localhost:3002 bash .codex/skills/pika-ui-verify/scripts/ui_verify.sh classrooms`; Playwright computed-style check confirmed header gradient remains, box-shadow is `none`, and the bottom border is neutral.
- Final gradient/settings follow-up: `pnpm test tests/components/TeacherSettingsTab.test.tsx tests/components/ClassroomPageClientAssignmentsEditMode.test.tsx tests/components/TeacherClassroomsIndex.test.tsx tests/components/StudentClassroomsIndex.test.tsx tests/components/AppHeader.test.tsx tests/unit/classroom-theme.test.ts`
- Final gradient/settings follow-up: `pnpm test tests/unit/classroom-theme.test.ts tests/unit/classroom-theme-migration.test.ts tests/unit/server-classrooms.test.ts tests/lib/validations/teacher.test.ts tests/api/teacher/classrooms.test.ts tests/api/teacher/classrooms-id.test.ts tests/api/student/classrooms.test.ts tests/api/student/classrooms-id.test.ts tests/api/teacher/course-blueprint-instantiate.test.ts tests/lib/server/course-blueprints.test.ts tests/unit/server-classroom-order.test.ts tests/lib/server/classroom-order.test.ts tests/components/AppHeader.test.tsx tests/components/TeacherClassroomsIndex.test.tsx tests/components/StudentClassroomsIndex.test.tsx tests/components/ClassroomDropdown.test.tsx tests/components/TeacherSettingsTab.test.tsx tests/components/ClassroomPageClientAssignmentsEditMode.test.tsx`
- Final gradient/settings follow-up: `pnpm lint`
- Final gradient/settings follow-up: `pnpm build`
- Final gradient/settings visual verification: `E2E_BASE_URL=http://localhost:3002 bash .codex/skills/pika-ui-verify/scripts/ui_verify.sh classrooms`; Playwright screenshots `/tmp/pika-classroom-theme-no-edge-extended-card.png`, `/tmp/pika-classroom-theme-settings-swatches-before.png`, `/tmp/pika-classroom-theme-settings-swatches-after.png`, and `/tmp/pika-classroom-theme-no-edge-extended-appbar.png`; computed-style check confirmed list cards have neutral 1px left borders, all settings options have gradients, only the selected option has a 4px accent edge, and the appbar changed from Blue to Teal without refresh.
- Left-edge follow-up: `pnpm test tests/components/AppHeader.test.tsx tests/components/TeacherClassroomsIndex.test.tsx tests/components/StudentClassroomsIndex.test.tsx tests/components/TeacherSettingsTab.test.tsx tests/components/ClassroomPageClientAssignmentsEditMode.test.tsx tests/unit/classroom-theme.test.ts`
- Left-edge follow-up: `pnpm lint`
- Left-edge follow-up: `pnpm build`
- Left-edge visual verification: `E2E_BASE_URL=http://localhost:3002 bash .codex/skills/pika-ui-verify/scripts/ui_verify.sh classrooms`; Playwright screenshots `/tmp/pika-classroom-theme-left-edge-cards.png` and `/tmp/pika-classroom-theme-left-edge-appbar.png`; computed-style check confirmed 4px accent left borders on classroom cards and appbar, neutral card top borders, neutral appbar bottom border, and no appbar box-shadow underline.
- Hover follow-up: `pnpm test tests/components/TeacherClassroomsIndex.test.tsx tests/components/StudentClassroomsIndex.test.tsx tests/components/AppHeader.test.tsx tests/unit/classroom-theme.test.ts`
- Hover follow-up: `pnpm lint`
- Hover follow-up: `pnpm build`
- Hover visual verification: `E2E_BASE_URL=http://localhost:3002 bash .codex/skills/pika-ui-verify/scripts/ui_verify.sh classrooms`; Playwright screenshots `/tmp/pika-classroom-theme-card-outline-before.png` and `/tmp/pika-classroom-theme-card-outline-hover.png`; computed-style check confirmed hover changes the full card outline while the inner button background stays transparent.
- Bottom-controls follow-up: `pnpm test tests/components/TeacherClassroomsIndex.test.tsx tests/components/TeacherWorkSurfaceActionBar.test.tsx`
- Bottom-controls follow-up: `pnpm lint`
- Bottom-controls follow-up: `pnpm build`
- Bottom-controls visual verification: `E2E_BASE_URL=http://localhost:3002 bash .codex/skills/pika-ui-verify/scripts/ui_verify.sh classrooms`; reviewed `/tmp/pika-teacher.png`, `/tmp/pika-teacher-mobile.png`, and `/tmp/pika-student.png`; dark-mode screenshot `/tmp/pika-classroom-bottom-controls-dark.png`; computed-style check confirmed the classroom bottom controls have transparent background, no shadow, no backdrop blur, and zero padding.
- Appbar logo follow-up: `pnpm test tests/components/AppHeader.test.tsx tests/unit/classroom-theme.test.ts`
- Appbar logo follow-up: `pnpm lint`
- Appbar logo follow-up: `pnpm build`
- Appbar logo visual verification: `E2E_BASE_URL=http://localhost:3002 bash .codex/skills/pika-ui-verify/scripts/ui_verify.sh classrooms`; targeted classroom screenshots `/tmp/pika-classroom-logo-light.png` and `/tmp/pika-classroom-logo-dark.png`; computed-style check confirmed the masked logo uses the light classroom accent in light mode and the dark classroom accent in dark mode.
- Appbar logo alignment follow-up: `pnpm test tests/components/AppHeader.test.tsx tests/unit/classroom-theme.test.ts`
- Appbar logo alignment follow-up: `pnpm lint`
- Appbar logo alignment follow-up: `pnpm build`
- Appbar logo alignment visual verification: `E2E_BASE_URL=http://localhost:3002 bash .codex/skills/pika-ui-verify/scripts/ui_verify.sh classrooms`; targeted screenshot `/tmp/pika-classroom-logo-centered-light.png`; computed geometry check confirmed the brand and classroom logo boxes share the same vertical center offset in the 48px appbar and themed appbars have `0px` left border width.
- Classroom card hover follow-up: `pnpm test tests/components/TeacherClassroomsIndex.test.tsx tests/components/StudentClassroomsIndex.test.tsx`
- Classroom card hover follow-up: `pnpm lint`
- Classroom card hover follow-up: `pnpm build`
- Classroom card hover visual verification: `E2E_BASE_URL=http://localhost:3002 bash .codex/skills/pika-ui-verify/scripts/ui_verify.sh classrooms`; targeted screenshots `/tmp/pika-classroom-hover-elevation-before.png` and `/tmp/pika-classroom-hover-elevation-after.png`; computed-style check confirmed no outline, `translateY(-1px)`, and increased shadow on hover.
- Appbar logo revert follow-up: `pnpm test tests/components/AppHeader.test.tsx tests/unit/classroom-theme.test.ts`
- Appbar logo revert follow-up: `pnpm lint`
- Appbar logo revert follow-up: `pnpm build`
- Appbar logo revert visual verification: `E2E_BASE_URL=http://localhost:3002 bash .codex/skills/pika-ui-verify/scripts/ui_verify.sh classrooms`; targeted screenshot `/tmp/pika-classroom-appbar-brand-logo-left-edge.png`; computed-style check confirmed the appbar uses the brand image, has no masked logo, and renders a 4px classroom-accent left border.
- Bright palette follow-up: updated classroom theme labels/colors to a brighter set (Sky, Mint, Lime, Sunshine, Coral, Grape, Aqua, Peach) while keeping stored theme keys stable.
- Bright palette follow-up: `pnpm test tests/unit/classroom-theme.test.ts tests/components/TeacherSettingsTab.test.tsx tests/components/AppHeader.test.tsx tests/components/TeacherClassroomsIndex.test.tsx tests/components/StudentClassroomsIndex.test.tsx`
- Bright palette follow-up: `pnpm lint`
- Bright palette follow-up: `pnpm build`
- Bright palette visual verification: `E2E_BASE_URL=http://localhost:3002 bash .codex/skills/pika-ui-verify/scripts/ui_verify.sh classrooms`; reviewed `/tmp/pika-teacher.png`, `/tmp/pika-teacher-mobile.png`, and `/tmp/pika-student.png`; targeted settings screenshots `/tmp/pika-settings-light.png` and `/tmp/pika-settings-dark.png` confirmed brighter palette swatches and appbar gradients remain legible in light and dark mode.
- Full-border follow-up: replaced the classroom-color left edge on classroom list cards and the classroom appbar with a 1px classroom-color border on all sides, keeping the existing gradients.
- Full-border follow-up: `pnpm test tests/components/AppHeader.test.tsx tests/components/TeacherClassroomsIndex.test.tsx tests/components/StudentClassroomsIndex.test.tsx tests/components/SortableClassroomRow.test.tsx tests/components/TeacherSettingsTab.test.tsx tests/components/ClassroomPageClientAssignmentsEditMode.test.tsx tests/unit/classroom-theme.test.ts`
- Full-border follow-up: `bash .codex/skills/pika-audit/scripts/audit.sh`
- Full-border follow-up: `pnpm lint`
- Full-border follow-up: `pnpm build`
- Full-border visual verification: `E2E_BASE_URL=http://localhost:3002 bash .codex/skills/pika-ui-verify/scripts/ui_verify.sh classrooms` and `E2E_BASE_URL=http://localhost:3002 bash .codex/skills/pika-ui-verify/scripts/ui_verify.sh classrooms/ddb6fbe4-66b3-46cf-9efa-21cb4f2a5218`; computed-style check confirmed teacher classroom cards and the appbar all render 1px accent-colored borders on top/right/bottom/left.
- Full-border post-rebase: rebased cleanly onto `origin/main`; migration `079_classroom_theme_color.sql` remains next after main's `078_assignment_gradex_run_metadata.sql` with no duplicate migration prefixes.
- Gradient-only follow-up: removed classroom-colored border overrides from classroom cards and the appbar, leaving the existing classroom gradients as the sole classroom color signal on those surfaces.
- Gradient-only follow-up: `pnpm test tests/components/AppHeader.test.tsx tests/components/TeacherClassroomsIndex.test.tsx tests/components/StudentClassroomsIndex.test.tsx tests/components/SortableClassroomRow.test.tsx tests/unit/classroom-theme.test.ts`
- Gradient-only follow-up: `bash .codex/skills/pika-audit/scripts/audit.sh`
- Gradient-only follow-up: `pnpm lint`
- Gradient-only follow-up: `pnpm build`
- Gradient-only visual verification: `E2E_BASE_URL=http://localhost:3002 bash .codex/skills/pika-ui-verify/scripts/ui_verify.sh classrooms` and `E2E_BASE_URL=http://localhost:3002 bash .codex/skills/pika-ui-verify/scripts/ui_verify.sh classrooms/ddb6fbe4-66b3-46cf-9efa-21cb4f2a5218`; computed-style check confirmed card/header borders are neutral while gradients remain.

## 2026-06-13 — API auth-boundary negative coverage

**Completed:**
- Continued the systems/UI audit program with the API authorization-boundary slice.
- Added negative teacher ownership and student enrollment coverage for legacy `GET /api/teacher/class-days`.
- Added matching negative coverage for canonical `GET /api/classrooms/[classroomId]/class-days`.
- Added teacher-side `GET /api/student/tests/[id]/history` coverage for non-owned tests and students outside the test classroom.
- Confirmed the existing routes already block these paths before downstream class-day/history data reads; no production route changes were needed.

**Validation:**
- `pnpm vitest run tests/api/teacher/class-days.test.ts tests/api/classrooms-class-days.test.ts tests/api/student/tests-history.test.ts` (18 tests)
- `git diff --check`
- `pnpm lint`
- `bash .codex/skills/pika-audit/scripts/audit.sh`
- `pnpm build`
- `pnpm vitest run --sequence.concurrent=false` (303 files / 2690 tests)

## 2026-06-20 — Pika logo dark-token cleanup

**Completed:**
- Continued the systems/UI audit program with a bounded UI consistency slice.
- Moved the Pika logo dark-mode filter out of component-local `dark:` utility classes and into `src/styles/tokens.css` as `--pika-logo-filter`.
- Updated `PikaLogo` to use the semantic `pika-logo` class.
- Removed the obsolete `PikaLogo` `dark:` exception from the active design guidance.
- Added AppHeader regression coverage that asserts the logo uses the tokenized class and no component-level `dark:` utilities.
- Addressed subagent review feedback by matching Tailwind's previous composed filter order for the dark-mode logo token.

**Validation:**
- `rg -n "dark:" src/app src/components --glob '*.tsx' --glob '*.ts'` returned no matches.
- `pnpm vitest run tests/components/AppHeader.test.tsx`
- `pnpm vitest run tests/unit/ui-guidance-docs.test.ts tests/unit/ai-startup-docs.test.ts tests/components/AppHeader.test.tsx`
- `pnpm lint`
- `bash .codex/skills/pika-audit/scripts/audit.sh`
- `pnpm build`
- Visual verification: `bash .codex/skills/pika-ui-verify/scripts/ui_verify.sh classrooms`; reviewed `/tmp/pika-teacher.png`, `/tmp/pika-teacher-mobile.png`, and `/tmp/pika-student.png`.
- Additional visual verification for role/viewport/theme matrix: reviewed `/tmp/pika-student-desktop.png`, `/tmp/pika-teacher-dark.png`, `/tmp/pika-teacher-mobile-dark.png`, `/tmp/pika-student-dark.png`, and `/tmp/pika-student-mobile-dark.png`.
- Post-review fix validation: `pnpm vitest run tests/components/AppHeader.test.tsx tests/unit/ui-guidance-docs.test.ts`, `git diff --check`, `pnpm lint`, `bash .codex/skills/pika-audit/scripts/audit.sh`, `pnpm build`.
- Post-review visual verification: reviewed `/tmp/pika-teacher-dark-after-review.png` and `/tmp/pika-student-mobile-dark-after-review.png`.

## 2026-06-20 — Historical design-system dark-mode examples cleanup

**Completed:**
- Continued the systems/UI audit program with a docs-only UI guidance consistency slice.
- Updated the historical `docs/design-system.md` dark-mode section so it points to semantic tokens instead of raw theme-switching utility examples.
- Added UI guidance regression coverage to keep that historical section aligned with semantic-token guidance.
- Addressed subagent review feedback by tightening the regression test to match exact semantic-token class examples.

**Validation:**
- `pnpm vitest run tests/unit/ui-guidance-docs.test.ts`
- `git diff --check`
- `pnpm lint`
- `bash .codex/skills/pika-audit/scripts/audit.sh`
- Post-review fix validation: `pnpm vitest run tests/unit/ui-guidance-docs.test.ts`, `git diff --check`, `pnpm lint`, `bash .codex/skills/pika-audit/scripts/audit.sh`

## 2026-06-20 — Browser Supabase access audit guard

**Completed:**
- Continued the bounded systems/UI audit program with the browser-side Supabase access slice.
- Audited non-API/non-server source imports and confirmed current direct Supabase runtime usage is limited to server-rendered classroom pages and the shared server client module; `src/lib/user-profile.ts` uses a type-only Supabase import.
- Added static regression coverage that fails if a browser-reachable module imports `@/lib/supabase` or `@supabase/supabase-js` at runtime.
- Addressed subagent review feedback by changing the guard from a direct client-file scan to a TypeScript-AST runtime import graph rooted at every `use client` source file, while allowing type-only Supabase imports and catching static imports, dynamic imports, and `require()` calls.
- No production UI or runtime behavior changed.

**Validation:**
- `rg -n "@/lib/supabase|@supabase/supabase-js|getSupabaseClient|getServiceRoleClient" src/app src/components src/hooks src/lib src/ui --glob '*.{ts,tsx}' --glob '!src/app/api/**' --glob '!src/lib/server/**'`
- `pnpm test tests/unit/browser-supabase-access.test.ts tests/unit/api-route-standards.test.ts tests/unit/supabase.test.ts`
- `git diff --check`
- `pnpm lint`
- `bash .codex/skills/pika-audit/scripts/audit.sh`
- `pnpm build`

## 2026-06-20 — Student notification read-cache audit

**Completed:**
- Continued the bounded systems/UI audit program with the client read-cache drift slice.
- Audited client GET reads for repeated classroom-scoped requests and identified student notification reads as a concrete fix-now item.
- Wrapped `StudentNotificationsProvider` notification GETs in `fetchJSONWithCache` with a short classroom-scoped TTL so same-classroom mounts/focus reads dedupe.
- Invalidated the classroom notification cache when local notification helpers mark/decrement counts and before explicit `refresh()` so quick remounts or manual refreshes cannot replay stale pre-action counts.
- Added regression coverage for simultaneous same-classroom provider reads, explicit refresh freshness, and post-local-update remount freshness.
- No UI layout or styling changed.

**Validation:**
- `pnpm test tests/components/StudentNotificationsProvider.test.tsx`
- `git diff --check`
- `pnpm lint`
- `bash .codex/skills/pika-audit/scripts/audit.sh`
- `pnpm build`

## 2026-06-20 — Composite widget accessibility audit

**Completed:**
- Continued the bounded systems/UI audit program with the composite-widget accessibility slice.
- Audited shared menu/listbox widgets and identified a concrete fix-now issue in the `useDropdownNav` consumers: closed account/classroom dropdown surfaces stayed exposed in the accessibility tree, and Escape/outside close did not return focus to the trigger.
- Added a trigger ref and focus restoration path to `useDropdownNav` for Escape, outside click, and trigger-close behavior.
- Marked closed `UserMenu` and `ClassroomDropdown` menu/listbox surfaces with `aria-hidden` while preserving their existing visual transitions.
- Added semantic regression coverage for closed menus being unavailable by role and focus restoration after Escape/outside close.

**Accessibility checklist:**
- checklist reviewed: yes
- keyboard behavior covered: yes
- semantic state covered by tests: yes
- remaining manual follow-up: none

**Validation:**
- `pnpm test tests/components/ClassroomDropdown.test.tsx tests/components/UserMenu.test.tsx`
- `git diff --check`
- `pnpm lint`
- `bash .codex/skills/pika-audit/scripts/audit.sh`
- `pnpm build`
- `bash .codex/skills/pika-ui-verify/scripts/ui_verify.sh classrooms`; reviewed `/tmp/pika-teacher.png`, `/tmp/pika-student.png`, and `/tmp/pika-teacher-mobile.png`.
- Additional open-state visual verification: reviewed `/tmp/pika-user-menu-open.png` and `/tmp/pika-classroom-dropdown-open.png`.
- `pnpm test` (308 files / 2742 tests)

## 2026-06-21 — Teacher exam telemetry E2E coverage

**Completed:**
- Added a focused Playwright teacher exam-mode flow that creates an active open-response test, has the seeded student generate one route-exit attempt, one window/full-screen exit, and one away/focus event, then verifies the teacher grading row distinguishes those telemetry categories.
- Reused existing teacher/student storage state setup and API-backed test creation/cleanup patterns; no app logic, migrations, or dependencies changed.
- Selected this flow because student exam-mode E2E already covered lock/restoration/draft preservation, while teacher-side telemetry visibility remained a bounded exam-mode coverage gap.

**Validation:**
- `bash scripts/verify-env.sh`
- `E2E_BASE_URL=http://localhost:3101 pnpm exec playwright test e2e/teacher-exam-mode.spec.ts --project=chromium-desktop`
- `pnpm lint`
- Note: `E2E_BASE_URL=http://127.0.0.1:3101 ...` failed in auth setup with teacher login `Failed to fetch`; rerunning on `localhost:3101` passed.

## 2026-06-21 — Teacher telemetry E2E review fix

**Completed:**
- Addressed review feedback on PR #815 by loosening the teacher grading-row away-duration assertion so valid one-away-session durations above nine seconds do not make the E2E flaky.
- Kept the API-side `away_total_seconds >= 1` assertion as the source of truth for nonzero away time.

**Validation:**
- `E2E_BASE_URL=http://localhost:3101 pnpm exec playwright test e2e/teacher-exam-mode.spec.ts --project=chromium-desktop`
- `pnpm lint`
- `git diff --check`
- `bash .codex/skills/pika-audit/scripts/audit.sh`
- `pnpm test`
- `pnpm build`

## 2026-06-21 — Stale async classroom-state audit

**Completed:**
- Continued the bounded systems/UI audit with the stale async classroom/workspace state slice.
- Fixed `StudentLessonCalendarTab` so lesson plans, assignments, announcements, and max-date state clear on classroom changes and only current classroom request ids can write visible state.
- Fixed `TeacherTestsTab` so the tests list and selected/grading workspace state reset on classroom changes, and late `/api/teacher/tests?classroom_id=...` responses cannot repaint the newly selected classroom with old-classroom tests.
- Added regression coverage for late classroom A responses arriving after a switch to classroom B in both student calendar and teacher tests flows.
- Addressed subagent review feedback by clearing owner-scoped teacher test modal/action state on classroom changes, including delete/edit/batch/status/access/return/unsubmit/delete-work pending state, and by ignoring late create-test responses from a previous classroom.
- Addressed follow-up subagent review feedback by guarding create-test completion with a request id so an old classroom create cannot clear the current classroom's in-flight create state.

**Workspace-state checklist:**
- owner identity: classroom id
- late responses ignored: yes, request id plus current classroom id checks
- state clears immediately on owner change: yes, for calendar data and teacher tests workspace state
- owner-scoped action state clears immediately on owner change: yes
- current-owner create busy state protected from old requests: yes
- cache boundary checked: yes, classroom-scoped cache keys invalidated in tests
- remaining manual follow-up: none

**Validation:**
- `pnpm test tests/components/StudentLessonCalendarTab.test.tsx tests/components/TeacherTestsTab.test.tsx`
- `git diff --check`
- `pnpm lint`
- `bash .codex/skills/pika-audit/scripts/audit.sh`
- `pnpm test`
- `pnpm build`
- `bash .codex/skills/pika-ui-verify/scripts/ui_verify.sh "classrooms"`; reviewed `/tmp/pika-teacher.png`, `/tmp/pika-student.png`, and `/tmp/pika-teacher-mobile.png`.

## 2026-06-22 — Teacher tests workspace navigation extraction

**Completed:**
- Started the bounded architecture/UI improvement goal with a behavior-preserving TeacherTestsTab decomposition slice.
- Extracted controlled/uncontrolled tests workspace selection, workspace mode, selected grading student, and URL search-param mutation into `useTestWorkspaceNavigation`.
- Kept grading data loading, business actions, modal state, and workspace side effects in `TeacherTestsTab`.
- Added hook contract coverage for list defaults, grading navigation, authoring student-param cleanup, workspace clearing, and controlled-prop precedence.
- Added a parent `TeacherTestsTab` regression proving grading row selection still writes `testStudentId` through search params.

**Refactor checklist:**
- boundary: workspace navigation/search-param state only
- shell or behavior extraction: behavior extraction for local navigation state, no UI shell change
- business logic moved: none
- visible behavior intended to change: none
- remaining decomposition: teacher tests grading/list/action state still intentionally stays in the parent for future slices

**Validation:**
- `pnpm test tests/hooks/useTestWorkspaceNavigation.test.ts tests/components/TeacherTestsTab.test.tsx`
- `git diff --check`
- `pnpm lint`
- `bash .codex/skills/pika-audit/scripts/audit.sh`
- `pnpm test`
- `pnpm build`
- `bash .codex/skills/pika-ui-verify/scripts/ui_verify.sh "classrooms"`; reviewed `/tmp/pika-teacher.png`, `/tmp/pika-student.png`, and `/tmp/pika-teacher-mobile.png`.

## 2026-06-22 — Teacher tests list-state extraction

**Completed:**
- Continued the bounded architecture/UI improvement goal with the next behavior-preserving TeacherTestsTab decomposition slice.
- Extracted classroom-owned tests-list loading, visible-list ownership, event reload handling, request freshness checks, and selected-draft summary patching into `useTeacherTestList`.
- Moved shared selected-test summary patching into `src/lib/test-summary-patch.ts` so the hook and parent mutations use the same behavior.
- Kept rendering, routing, grading rows, mutations, dialogs, batch actions, and workspace mode state in `TeacherTestsTab`.
- Added hook-level coverage for current-classroom loads, hiding prior-classroom data while loading, late response rejection, matching update-event reloads, and draft-summary patching.
- Updated the parent component regression for visible list reload after `TEACHER_TESTS_UPDATED_EVENT`.

**Workspace-state checklist:**
- owner identity: classroom id
- late responses ignored: yes, request id plus current classroom id checks in the hook
- state clears immediately on owner change: visible tests are hidden when loaded owner differs from current classroom
- A-after-B regression: covered in `tests/hooks/useTeacherTestList.test.ts` and parent coverage remains in `TeacherTestsTab.test.tsx`
- visible behavior intended to change: none

**Validation:**
- `pnpm exec tsc --noEmit --pretty false`
- `pnpm test tests/hooks/useTeacherTestList.test.ts tests/components/TeacherTestsTab.test.tsx`
- `pnpm lint`
- `git diff --check`
- `bash .codex/skills/pika-audit/scripts/audit.sh`
- `pnpm test`
- `pnpm build`

## 2026-06-22 — Teacher test results normalization

**Completed:**
- Continued the bounded architecture/UI improvement goal with a behavior-preserving legacy contract cleanup slice.
- Moved teacher test results payload normalization from `TeacherTestsTab` into `readTeacherTestResultsFromPayload` in `src/lib/test-api-contract.ts`.
- Kept current `test` payload keys preferred while retaining the legacy `quiz` fallback for compatibility.
- Exported typed teacher grading student/question result shapes from the contract helper and kept UI state, fetch ownership, grading actions, and rendering in `TeacherTestsTab`.
- Added contract tests for current-key preference, legacy fallback, active run/error passthrough, question summary mapping, and unknown-status filtering.
- Strengthened the parent `TeacherTestsTab` legacy fallback regression to prove the normalized results request still loads without the generic results error.

**Compatibility checklist:**
- What widened: no API payload, query, or schema widened; only client-side normalization moved to a helper.
- Fallback: legacy `quiz` detail key remains supported through `readTestFromPayload`.
- Migration dependency: none; no schema or server contract changed.
- Intended payload regression: `tests/lib/test-api-contract.test.ts` covers current `test` preference and legacy `quiz` fallback.
- Legacy aliases still alive: `quiz`/`quizzes` response aliases and fallback readers remain intentionally alive.
- Visible behavior intended to change: none.

**Validation:**
- `pnpm exec tsc --noEmit --pretty false`
- `pnpm test tests/lib/test-api-contract.test.ts tests/components/TeacherTestsTab.test.tsx`
- `pnpm lint`
- `git diff --check`
- `bash .codex/skills/pika-audit/scripts/audit.sh`
- `pnpm test`
- `pnpm build`

## 2026-06-22 — Cached API JSON helper

**Completed:**
- Continued the bounded architecture/UI improvement goal with a typed client API/cache helper slice.
- Added `fetchJSON` and `fetchCachedJSON` to `src/lib/request-cache.ts` so repeated client reads can share JSON parsing, API error payload handling, and cache TTL wiring.
- Migrated `useTeacherTestList`, `useGradebookData`, and `StudentNotificationsProvider` from inline cached fetcher lambdas to the typed helper.
- Kept `fetchJSONWithCache` intact for existing custom fetcher callers and left API payload shape unchanged.
- Added request-cache coverage for successful JSON parsing, API error precedence, fallback errors for non-JSON failures, and cached helper reuse.
- Updated hook/component tests for the new helper call shape without changing visible UI behavior.
- Addressed independent review by preserving JSON parse rejection for successful malformed responses and adding `init` passthrough coverage.

**Cache/helper checklist:**
- API schema or payload changed: no
- Cache key semantics changed: no
- TTL behavior changed: no; callers keep existing `0`, `60_000`, and notification TTL values
- Error behavior changed: no; `{ error: string }` payloads still win over fallback messages
- Successful malformed JSON behavior changed: no; successful parse failures still reject instead of caching `null`
- Existing custom fetcher support: retained through `fetchJSONWithCache`
- Visible behavior intended to change: none

**Validation:**
- `pnpm exec tsc --noEmit --pretty false`
- `pnpm test tests/unit/request-cache.test.ts tests/hooks/useTeacherTestList.test.ts tests/hooks/useGradebookData.test.ts tests/components/StudentNotificationsProvider.test.tsx`
- `pnpm test tests/components/TeacherTestsTab.test.tsx`
- `pnpm lint`
- `git diff --check`
- `bash .codex/skills/pika-audit/scripts/audit.sh`
- `pnpm test`
- `pnpm build`

## 2026-06-22 — Teacher classroom access helper reuse

**Completed:**
- Continued the bounded architecture/UI improvement goal with a Supabase route/query helper consolidation slice.
- Extended `assertTeacherOwnsClassroom` to include classroom `title` and accept an optional existing service-role client, preserving the default helper call shape.
- Reused the helper in read-only teacher routes that previously duplicated `classrooms.select('teacher_id')` ownership checks: attendance, export CSV, log summary, logs, and student history.
- Kept each route's current response style, status codes, payloads, and downstream query shape unchanged.
- Added helper-level coverage proving the shared classroom access helper returns `title` and reuses a provided Supabase client.

**Route/query helper checklist:**
- Schema or migration changed: no
- Browser-side Supabase access changed: no
- Authorization semantics changed: no; 404 not found and 403 forbidden still come from the same ownership predicate
- Payload shape changed: no
- Supabase query count changed: no intended extra queries; migrated routes pass their existing service client into the helper
- Visible behavior intended to change: none

**Validation:**
- `pnpm test tests/unit/server-access.test.ts tests/api/teacher/attendance.test.ts tests/api/teacher/export-csv.test.ts tests/api/teacher/log-summary.test.ts tests/api/teacher/logs.test.ts tests/api/teacher/student-history.test.ts`
- `pnpm exec tsc --noEmit --pretty false`
- `pnpm lint`
- `git diff --check`
- `bash .codex/skills/pika-audit/scripts/audit.sh`

## 2026-06-22 — Paged Supabase test helper

**Completed:**
- Continued the bounded architecture/UI improvement goal with a test mock simplification slice.
- Extracted the duplicated paged Supabase table/query-log mock from teacher attendance and export CSV API tests into `tests/support/paged-supabase.ts`.
- Updated both route suites to use `createPagedQueryLog` and `mockPagedTable` from the shared support helper.
- Kept production code, route behavior, mock behavior, and assertions unchanged.

**Test mock checklist:**
- Production code changed: no
- Test behavior changed: no intended behavior change; affected tests still cover pagination, chunking, and query scoping
- Helper scope: paged `select().in().order().range()` mocks only
- Broad migration attempted: no; only identical local duplicates were consolidated

**Validation:**
- `pnpm test tests/api/teacher/attendance.test.ts tests/api/teacher/export-csv.test.ts`
- `pnpm exec tsc --noEmit --pretty false`
- `pnpm lint`
- `git diff --check`
- `bash .codex/skills/pika-audit/scripts/audit.sh`

## 2026-06-23 — Gradebook action surface

**Completed:**
- Continued the bounded architecture/UI improvement goal with the canonical classroom action-surface slice.
- Replaced the Gradebook tab's custom split-button floating action with the shared teacher work-surface action cluster: a standalone score/email primary action plus a quiet icon menu.
- Preserved existing Gradebook behavior: score display toggles when no students are selected, selected-student email remains the primary action, and column controls stay in the actions menu.
- Added optional radio semantics to `TeacherWorkSurfaceActionItem` so mutually exclusive score display menu items expose `menuitemradio` while column controls remain `menuitemcheckbox`.
- Added focused component coverage for Gradebook menu semantics and shared action-cluster checked roles.
- Addressed independent review by including `menuitemradio` items in shared menu keyboard focus management and covering arrow/Home/End focus behavior.

**UI verification:**
- Teacher desktop light: default, open menu, selected email action
- Teacher mobile light: default
- Teacher desktop dark: default, open menu
- Student: n/a; changed surface is teacher-only
- Composite widget checklist reviewed: yes
- Keyboard behavior covered by existing shared menu handling: yes
- Semantic state covered by tests: yes
- Remaining manual follow-up: none

**Validation:**
- `pnpm test tests/components/TeacherGradebookTab.test.tsx tests/components/TeacherWorkSurfaceActionCluster.test.tsx`
- `pnpm exec tsc --noEmit --pretty false`
- `pnpm lint`
- `bash .codex/skills/pika-audit/scripts/audit.sh && git diff --check`
- `pnpm test`
- `pnpm build`

## 2026-06-23 — Roster action surface

**Completed:**
- Continued the bounded architecture/UI improvement goal with the next canonical classroom action-surface slice.
- Replaced the Roster tab's custom split-button floating action with the shared teacher work-surface action cluster: a standalone Students primary action plus a quiet icon menu.
- Preserved existing Roster behavior: the primary action still opens Add Students, selected-student email actions remain in the Roster actions menu, and removal actions stay destructive menu items.
- Updated focused Roster component tests to assert the shared action-cluster shape without changing roster management behavior.
- Addressed independent review by keeping the compact visual label while exposing the primary action as `Add students` for assistive technology.

**UI verification:**
- Teacher desktop light: default, open menu, selected-student menu
- Teacher mobile light: default
- Teacher desktop dark: default, open menu
- Student: n/a; changed surface is teacher-only
- Composite widget checklist reviewed: yes
- Keyboard behavior covered by shared menu handling: yes
- Semantic state covered by tests: yes
- Remaining manual follow-up: none

**Validation:**
- `pnpm test tests/components/TeacherRosterTab.test.tsx tests/components/TeacherWorkSurfaceActionCluster.test.tsx`
- `pnpm exec tsc --noEmit --pretty false`
- `pnpm lint`
- `bash .codex/skills/pika-audit/scripts/audit.sh && git diff --check`
- `pnpm test`
- `pnpm build`

## 2026-06-23 — Announcements action surface

**Completed:**
- Continued the bounded architecture/UI improvement goal with the final legacy classroom action-surface caller.
- Replaced the Announcements tab's custom split-button floating action with the shared teacher work-surface action cluster: a standalone New primary action plus a quiet icon menu.
- Removed the unused `floatingAction` and `floatingActionStatus` compatibility path from `TeacherWorkSurfaceActionBar`.
- Preserved existing Announcements behavior: the primary action still starts a new announcement, the action menu still exposes Announcement, and composer/editor Post/Schedule split buttons remain unchanged.
- Updated focused Announcements component coverage and wrapped teacher renders in `TooltipProvider` to match the app shell used by the shared icon menu.

**UI verification:**
- Teacher desktop light: default, open menu
- Teacher mobile light: default, open menu
- Teacher desktop dark: default, open menu
- Student: n/a; changed surface is teacher-only
- Composite widget checklist reviewed: yes
- Keyboard behavior covered by shared menu handling: yes
- Semantic state covered by tests: yes
- Remaining manual follow-up: none

**Validation:**
- `pnpm test tests/components/AnnouncementsMarkdown.test.tsx tests/components/TeacherWorkSurfaceActionBar.test.tsx tests/components/TeacherWorkSurfaceActionCluster.test.tsx`
- `pnpm exec tsc --noEmit --pretty false`
- `pnpm lint`
- `git diff --check`
- `bash .codex/skills/pika-audit/scripts/audit.sh`
- `pnpm e2e:auth`
- Playwright screenshots: `/tmp/pika-announcements-action-desktop-light-default.png`, `/tmp/pika-announcements-action-desktop-light-menu.png`, `/tmp/pika-announcements-action-mobile-light-default.png`, `/tmp/pika-announcements-action-mobile-light-menu.png`, `/tmp/pika-announcements-action-desktop-dark-default.png`, `/tmp/pika-announcements-action-desktop-dark-menu.png`
- `pnpm test`
- `pnpm build`

## 2026-06-23 — Student assignments cached JSON

**Completed:**
- Continued the bounded architecture/UI improvement goal with a client read-cache consistency slice.
- Replaced `StudentAssignmentsTab`'s three manual cached GET fetchers with the shared `fetchCachedJSON` helper for assignments, materials, and surveys.
- Preserved existing cache keys, 20s TTLs, request-id stale response guard, classroom-change clearing, and optional survey fallback behavior.
- Kept the slice non-visual: no layout, copy, or interaction changes.

**Validation:**
- `bash scripts/verify-env.sh`
- `pnpm test tests/components/StudentAssignmentsTab.test.tsx tests/unit/request-cache.test.ts`
- `pnpm exec tsc --noEmit --pretty false`
- `pnpm lint`
- `git diff --check`
- `bash .codex/skills/pika-audit/scripts/audit.sh`
- `pnpm test`
- `pnpm build`

## 2026-06-23 — Student calendar cached JSON

**Completed:**
- Continued the bounded architecture/UI improvement goal with another client read-cache consistency slice.
- Replaced `StudentLessonCalendarTab`'s manual cached GET fetchers with the shared `fetchCachedJSON` helper for lesson plans, assignments, and announcements.
- Preserved existing cache keys, 20s TTLs, request-id/classroom stale response guard, and per-resource fallback behavior.
- Kept the slice non-visual: no layout, copy, or interaction changes.

**Validation:**
- `bash scripts/verify-env.sh`
- `pnpm test tests/components/StudentLessonCalendarTab.test.tsx tests/unit/request-cache.test.ts`
- `pnpm exec tsc --noEmit --pretty false`
- `pnpm lint`
- `git diff --check`
- `bash .codex/skills/pika-audit/scripts/audit.sh`
- `pnpm test`
- `pnpm build`

## 2026-06-23 — Announcements cached JSON

**Completed:**
- Continued the bounded architecture/UI improvement goal with a client read-cache consistency slice for announcements.
- Replaced teacher and student announcement manual cached GET fetchers with the shared `fetchCachedJSON` helper.
- Preserved existing cache keys, 20s TTLs, request-id stale response guards, and mutation cache invalidation.
- Added a focused teacher announcement remount regression to prove the cache key is reused.
- Kept the slice non-visual: no layout, copy, or interaction changes.

**Validation:**
- `bash scripts/verify-env.sh`
- `pnpm test tests/components/AnnouncementsMarkdown.test.tsx tests/unit/request-cache.test.ts`
- `pnpm exec tsc --noEmit --pretty false`
- `pnpm lint`
- `git diff --check`
- `bash .codex/skills/pika-audit/scripts/audit.sh`
- `pnpm test`
- `pnpm build`

## 2026-06-23 — Teacher classroom cached JSON

**Completed:**
- Continued the bounded architecture/UI improvement goal with a small client read-cache consistency slice in the teacher classroom assignments view.
- Replaced the assignments, materials, and surveys summary GET loaders with `fetchCachedJSON`, preserving cache keys, 20s TTLs, error messages, survey fallback, and stale classroom/request guards.
- Left selected-assignment detail loading on `fetchJSONWithCache` because its short TTL and refresh-counter key are intentional.
- Kept the slice non-visual: no layout, copy, or interaction changes.

**Validation:**
- `bash scripts/verify-env.sh`
- `pnpm vitest run tests/components/TeacherClassroomView.test.tsx`
- `pnpm exec tsc --noEmit`
- `pnpm lint`
- `git diff --check`
- `bash .codex/skills/pika-audit/scripts/audit.sh`
- `pnpm test`
- `pnpm build`

## 2026-06-24 — Teacher lesson calendar cached JSON

**Completed:**
- Continued the bounded architecture/UI improvement goal with another client read-cache consistency slice.
- Replaced `TeacherLessonCalendarTab`'s manual cached assignment and announcement GET fetchers with `fetchCachedJSON`.
- Preserved existing cache keys, 20s TTLs, stale classroom guards, assignment-update invalidation, and non-visual behavior.

**Validation:**
- `bash scripts/verify-env.sh`
- `pnpm vitest run tests/components/TeacherLessonCalendarTab.test.tsx tests/unit/request-cache.test.ts`
- `pnpm exec tsc --noEmit`
- `pnpm lint`
- `git diff --check`
- `bash .codex/skills/pika-audit/scripts/audit.sh`
- `pnpm test`
- `pnpm build`

## 2026-06-24 — Student log history cached JSON

**Completed:**
- Continued the bounded architecture/UI improvement goal with a small client read-cache consistency slice.
- Replaced `StudentLogHistory`'s latest and load-more manual cached history GET fetchers with `fetchCachedJSON`.
- Preserved existing cache keys, 60s TTL, pagination URL params, loading behavior, and error handling.
- Added a focused regression proving the load-more history page is reused from cache on a repeated request.

**Validation:**
- `bash scripts/verify-env.sh`
- `pnpm vitest run tests/components/StudentLogHistory.test.tsx tests/unit/request-cache.test.ts`
- `pnpm exec tsc --noEmit`
- `pnpm lint`
- `git diff --check`
- `bash .codex/skills/pika-audit/scripts/audit.sh`
- `pnpm test`
- `pnpm build`
- Rebased `codex/action-cluster-classwork` onto `origin/main` and resolved the `TeacherTestsTab.test.tsx` helper import conflict by keeping `createMockTest` plus the branch's `Classroom` typing.
- Verified the rebased branch with `pnpm test tests/components/TeacherClassroomView.test.tsx tests/components/TeacherWorkSurfaceActionCluster.test.tsx tests/components/TeacherTestsTab.test.tsx` and `pnpm exec tsc --noEmit --pretty false`.

## 2026-06-10 — Classwork content modal consistency

**Completed:**
- Created `codex/classwork-content-modals` worktree and implemented a shared classwork modal shell for assignments, materials, surveys, and announcements.
- Added scheduled release support for materials and hid future-scheduled materials from students.
- Added survey due dates with reusable `soft` / `hard` due policy handling; hard due blocks student submissions/amendments after the due date, soft due leaves the survey open.
- Added survey due/policy controls to create, edit, and teacher workspace flows; student survey UI now shows due state.
- Moved announcement create/edit into the shared modal shell while keeping announcements in their existing tab.
- Added migration `079_add_survey_due_policy.sql` for `surveys.due_at` and `surveys.due_policy`.

**Validation:**
- `pnpm lint`
- `pnpm build`
- `pnpm test` (301 files / 2666 tests)
- `bash .codex/skills/pika-ui-verify/scripts/ui_verify.sh 'classrooms/e80aa794-e2d6-4705-9da5-d08ab0fba861?tab=assignments'`
- Manual Playwright modal screenshots: `/tmp/pika-material-modal.png`, `/tmp/pika-survey-modal.png`, `/tmp/pika-announcement-modal.png`

## 2026-06-11 — Classwork modal top-row alignment follow-up

**Completed:**
- Added a reusable `ClassworkContentModalTopRow` to the shared classwork modal shell so title, metadata, preview/tools, and primary actions live in the same top modal area.
- Moved assignment, material, survey create/edit, and announcement modal title/action rows onto the shared top row.
- Widened survey modals to the classwork modal width and kept due date/time plus soft/hard policy controls aligned in the top row on desktop, with stacked mobile behavior.
- Removed duplicate bottom action clusters where the top row now owns modal actions.

**Validation:**
- `E2E_BASE_URL=http://localhost:3001 bash .codex/skills/pika-ui-verify/scripts/ui_verify.sh classrooms`
- Manual Playwright screenshots: `/tmp/pika-modal-assignment.png`, `/tmp/pika-modal-material.png`, `/tmp/pika-modal-survey.png`, `/tmp/pika-modal-announcement.png`, `/tmp/pika-modal-survey-mobile.png`, `/tmp/pika-modal-assignment-mobile.png`
- `pnpm test tests/components/AssignmentModal.test.tsx tests/components/SurveyCreationModal.test.tsx tests/components/SurveyModal.test.tsx tests/components/AnnouncementsMarkdown.test.tsx tests/components/TeacherClassroomView.test.tsx`
- `pnpm lint`
- `pnpm build`

## 2026-06-12 — Classwork modal top-line template

**Completed:**
- Added assignment-style top-line template helpers: `ClassworkModalTopLine`, `ClassworkModalTopLineField`, `ClassworkModalPreviewButton`, and `ClassworkModalSplitAction`.
- Migrated assignment, material, survey create/edit, and announcement modals onto the new template API.
- Converted material posting to use the same post/schedule split action pattern as assignment and announcement.
- Kept modal-specific scheduling and save behavior outside the template so the shared layer owns layout/anatomy rather than business logic.

**Validation:**
- `bash scripts/verify-env.sh` before edits: completed with baseline failures in `tests/components/AssignmentModal.test.tsx` call count and `tests/unit/ai-startup-docs.test.ts` timeout.
- `pnpm exec tsc --noEmit --pretty false`
- `pnpm test tests/components/AssignmentModal.test.tsx tests/components/SurveyCreationModal.test.tsx tests/components/SurveyModal.test.tsx tests/components/AnnouncementsMarkdown.test.tsx tests/components/TeacherClassroomView.test.tsx`
- `pnpm lint`
- `pnpm build`
- `E2E_BASE_URL=http://localhost:3001 bash .codex/skills/pika-ui-verify/scripts/ui_verify.sh classrooms`
- Manual Playwright screenshots: `/tmp/pika-template-assignment-modal.png`, `/tmp/pika-template-material-modal.png`, `/tmp/pika-template-survey-modal.png`, `/tmp/pika-template-announcement-modal.png`, `/tmp/pika-template-material-mobile-modal.png`

## 2026-06-12 — Classwork modal action color policy

**Completed:**
- Added an `intent` policy to `ClassworkModalSplitAction` so publish actions resolve to green `success` and non-publish primary actions remain blue.
- Migrated assignment, material, and announcement publish split buttons to the shared publish intent.
- Kept survey create/save actions blue because they create or save survey setup rather than immediately publishing content.
- Made scheduled announcement creation use the same publish color treatment.

**Validation:**
- `pnpm exec tsc --noEmit --pretty false`
- `pnpm test tests/components/AssignmentModal.test.tsx tests/components/SurveyCreationModal.test.tsx tests/components/SurveyModal.test.tsx tests/components/AnnouncementsMarkdown.test.tsx tests/components/TeacherClassroomView.test.tsx`
- `pnpm lint`
- `pnpm build`
- `E2E_BASE_URL=http://localhost:3001 bash .codex/skills/pika-ui-verify/scripts/ui_verify.sh classrooms`
- Manual Playwright screenshots: `/tmp/pika-policy-assignment-modal.png`, `/tmp/pika-policy-material-modal.png`, `/tmp/pika-policy-survey-modal.png`, `/tmp/pika-policy-announcement-modal.png`, `/tmp/pika-policy-material-mobile-modal.png`

## 2026-06-12 — Classwork modal autosave consistency

**Completed:**
- Added shared classwork modal save status UI and a reusable `useClassworkAutosave` hook.
- Moved material drafts to autosave, removed the manual `Save Draft` action, and kept material post/schedule controls in the shared top-line shell.
- Moved survey create/edit settings to autosave, removed manual save/create setup actions, and kept survey due date/time plus soft/hard due mode in the shared top-line shell.
- Fixed the Material action-menu create path so a newly created material draft opens in the modal after the draft is created.

**Validation:**
- `pnpm exec tsc --noEmit --pretty false`
- `pnpm test tests/components/TeacherClassroomView.test.tsx tests/components/SurveyCreationModal.test.tsx tests/components/SurveyModal.test.tsx tests/components/AssignmentModal.test.tsx`
- `pnpm lint`
- `pnpm build`
- `git diff --check`
- `E2E_BASE_URL=http://localhost:3001 bash .codex/skills/pika-ui-verify/scripts/ui_verify.sh classrooms`
- Manual Playwright screenshots: `/tmp/pika-autosave-assignment-modal.png`, `/tmp/pika-autosave-material-modal.png`, `/tmp/pika-autosave-survey-modal.png`, `/tmp/pika-autosave-material-mobile.png`, `/tmp/pika-autosave-survey-mobile.png`

## 2026-06-12 — Rebase classwork modal branch

**Completed:**
- Rebasing `codex/classwork-content-modals` onto `origin/main` completed.
- Resolved conflicts in `TeacherClassroomView.tsx` and `TeacherClassroomView.test.tsx` by preserving main's `New Classwork` action-cluster UI and wiring Material creation to the autosave draft-open flow.
- Confirmed migration numbering: `origin/main` ends at `078`, branch keeps `079_add_survey_due_policy.sql`, and no duplicate migration prefixes exist.

**Validation:**
- `bash scripts/verify-env.sh`
- `pnpm exec tsc --noEmit --pretty false`
- `pnpm test tests/components/TeacherClassroomView.test.tsx tests/components/SurveyCreationModal.test.tsx tests/components/SurveyModal.test.tsx tests/components/AssignmentModal.test.tsx`
- `pnpm lint`
- `pnpm build`
- `git diff --check`

## 2026-06-13 — Tighten classwork modal template usage

**Completed:**
- Removed the Delete action from the Material authoring modal; delete remains available from classwork list/card controls.
- Added shared modal wrappers for survey due fields and non-split primary actions so Survey create/edit uses the same top-line template API as Assignment and Material.
- Kept Survey without Preview/Post controls because survey content editing/opening is handled by the survey workspace flow rather than a content preview modal.

**Validation:**
- `pnpm exec tsc --noEmit --pretty false`
- `pnpm test tests/components/TeacherClassroomView.test.tsx tests/components/SurveyCreationModal.test.tsx tests/components/SurveyModal.test.tsx tests/components/AssignmentModal.test.tsx`
- `pnpm lint`
- `pnpm build`
- `git diff --check`
- `E2E_BASE_URL=http://localhost:3001 pnpm e2e:auth`
- `E2E_BASE_URL=http://localhost:3001 bash .codex/skills/pika-ui-verify/scripts/ui_verify.sh classrooms`
- Manual Playwright screenshots: `/tmp/pika-consistency-assignment-modal.png`, `/tmp/pika-consistency-material-modal.png`, `/tmp/pika-consistency-survey-modal.png`, `/tmp/pika-consistency-material-mobile.png`, `/tmp/pika-consistency-survey-mobile.png`
