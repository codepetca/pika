# Pika Session Log

Rolling recent session log for AI/human handoffs. Keep this file small; full historical session history lives in `.ai/JOURNAL-ARCHIVE.md`.

**Rules:**
- Append one concise entry for meaningful work, then immediately run `node scripts/trim-session-log.mjs` in the same change.
- Start each entry heading with a valid ISO date (`## YYYY-MM-DD ...`) so retention can identify the latest entries.
- CI allows at most 60 entries; the trim step compacts to the latest 40 entries by default so there is headroom for future appends.
- Use `node scripts/trim-session-log.mjs --check` to reject empty entries and verify the log is chronological and within the 60-entry cap.
- Keep enough recent entries for weekly automations to inspect roughly the last week of work.
- The trim step appends removed entries to `.ai/JOURNAL-ARCHIVE.md`, so trimming never loses history.
- Use `.ai/JOURNAL-ARCHIVE.md` only for historical investigation.

## 2026-08-21 — Adopt the minimal Pal level-up celebration

**Risk profile:** none — student-only presentation and reward-modal dismissal;
no schema, grading, assessment, workspace persistence, or hosted state changed.

**Implemented:**
- Pinned the reviewed public `@codepet/pal-widget@0.1.0-alpha.4` release.
- Enabled Pal's opt-in fireworks/brightness effect in Pika's existing
  host-managed reward modal and removed the normal Continue action.
- Preserved Pika ownership of dialog semantics, focus containment, Escape,
  backdrop dismissal, scroll lock, and reward acknowledgement. A failed
  acknowledgement keeps the modal visible and restores Pal's Retry action.
- Updated the Pal pilot integration contract and minimal title-presentation
  expectations.

**Verification:**
- Focused student Pal experience and widget theme-contract suites pass 17 tests;
  TypeScript, lint, architecture, design policy, UI policy, and diff checks pass.
- Playwright verification passed for the student modal on desktop/mobile in
  light/dark themes, including launch/linger visuals, Escape and backdrop
  acknowledgement, failure/retry, and reduced-motion suppression. Teacher view
  is not applicable because Pal reward layers mount only for students.
- Composite-widget accessibility checklist reviewed: keyboard behavior covered
  yes; semantic state covered by tests yes; remaining manual follow-up none.

## 2026-08-21 — Make teacher CLI hints invocation-aware

**Risk profile:** none — teacher CLI help and recovery text only; no application
runtime, schema, hosted environment, deployment, or database state changed.
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
- Derived the copy-pasteable command prefix from the global launcher's existing
  `PIKA_ORIGIN_PWD` handoff, so global runs print `pika ...` while package-script
  runs print `pnpm pika ...`.
- Applied the detected invocation consistently to help, usage errors, login and
  expired-session recovery, Blueprint follow-up, and Classroom undo hints.
- Replaced the stale `course pull/push/instantiate` error text with the current
  Blueprint commands while retaining newer proposal, apply, and delete commands.
- Added behavior-level regression coverage through both real entry points with
  a local mock API for help/errors, recovery, Next, and Undo output.

**Verification:**
- Focused CLI suite passes 8 tests; full suite passes 4,909 tests across 561 files.
- Lint, production build, architecture boundaries, and Pika pre-commit audit pass.

## 2026-08-21 — Center the first-login Pal reward

**Risk profile:** none — student-only reward-modal layout and regression coverage;
no reward timing, acknowledgement behavior, schema, hosted state, or auth changed.

**Completed:**
- Centered Pal's narrower celebration card inside Pika's wider modal panel while
  preserving the shared modal root, backdrop, focus, and dismissal behavior.
- Added a component regression assertion for the centering layout contract.

**Verification:**
- Full suite passes 4,911 tests across 562 files; TypeScript, lint, production
  build, design policy, and UI policy pass.
- Matched Playwright evidence passes on desktop/mobile in light/dark themes:
  the card moved from 112 px left of center on desktop and 35 px left on mobile
  to exactly centered in all four variants.

## 2026-08-21 — Enforce the native attendance production canary

**Risk profile:** runtime-platform — teacher/student authorization, signed event
ingress, unattended delivery/reconciliation workers, opaque QR entry tokens,
and one additive Supabase migration. No hosted configuration, deployment, or
database was changed.

**Implemented:**
- Added a fail-closed exact Pika teacher/classroom scope on top of the global
  attendance flag. Non-canary reads retain the disabled UI, and mutations stop
  before WorkOS identity resolution or attendance side effects.
- Bound the Pika classroom UUID into version-2 encrypted entry tokens and
  required canonical Base64URL encoding before student identity resolution.
- Added migration 129 with teacher/classroom-scoped schedule, reconciliation,
  outbox claim/health, and atomic event-ingress RPCs. Workers cannot lease
  non-canary work and Bara still receives only opaque contract references.
- Added the two required rollout variables, preflight validation, generated
  database types, operator documentation, and production sequence updates.
- Review remediation split preflight into explicit disabled `pre-enable` and
  enabled modes, verifies the configured classroom is active and still owned by
  the configured teacher, and repeats that ownership check before ingress or
  unattended worker activity.
- Database claims and event application hold an active-classroom row lock so a
  concurrent archive cannot race the runtime check; archived QR issuance and
  archived event application fail before Bara access or projection writes.
- Archived teacher session reads now return the disabled attendance view and
  policy reads stop before attendance storage. The rollout contract defines
  authorization at operation start: already-started work may settle after soft
  archive, while every new operation is rejected.

**Verification:**
- Focused canary/API/worker/token coverage passes; the clean local
  Supabase reset replayed migrations 001–129, generated types match, and the
  attendance SQL contract passes exact-pair, wrong-teacher, privilege, and
  cross-classroom checks. The contract behaviorally exercises scoped claims,
  reconciliation, rejected event atomicity, and a valid atomic event apply.
- The full repository suite passes all 4,932 tests across 564 files. TypeScript,
  lint, architecture, design policy, UI policy, and production build pass. The
  shared environment's non-loopback Bara URL correctly prevents the local-only
  cross-service rehearsal from running without explicit reconfiguration.

## 2026-08-21 — Retire unscoped attendance service capabilities

**Risk profile:** runtime-platform — production release review, Supabase RPC
capabilities, and rollout sequencing; attendance remains globally disabled.

**Completed:**
- Applied reviewed migration 129 to the authorized Pika production project and
  verified remote history plus the five scoped function/grant definitions.
- Opened the `main` to `production` release PR with attendance disabled.
- Added migration 130 to revoke service-role execution of the five superseded
  unscoped worker/event RPCs while retaining them for scoped security-definer
  wrappers and migration compatibility. Migration 130 remains unapplied and
  requires separate exact production authorization.
- Updated active rollout guidance to record migration 129 as applied, migration
  130 as the remaining database gate, and the lack of an isolated preview
  database for hosted load testing.
- Removed a duplicate production-only timezone mock so the release result
  matches `main` outside the intentional remediation.

**Verification:**
- Full Vitest passes 4,939 tests across 565 files, including the UI test that
  timed out once in the initial release CI run.
- TypeScript, lint, architecture, production build, focused privilege/docs
  contracts, and diff checks pass.
- The database-writing local contract was not run because applying migration
  130 locally requires separate exact authorization; the release PR's clean
  ephemeral database job is the required migration replay and privilege proof.

## 2026-08-21 — Route attendance RPC retirement through main

**Risk profile:** runtime-platform — linearizes the reviewed attendance
privilege migration and rollout guidance onto `main`; no hosted database,
deployment, environment variable, or attendance flag was changed.

**Completed:**
- Replayed the two reviewed release-remediation commits onto a dedicated branch
  from current `origin/main`, excluding the production-only calendar-test
  parity correction that was already absent from `main`.
- Preserved migration 130 as an unapplied, separately authorized rollout step
  and kept attendance globally disabled pending the exact-pair canary audit.

**Verification:**
- Focused migration and documentation coverage passes 3 tests.
- Full Vitest passes 4,939 tests across 565 files; TypeScript, lint,
  architecture boundaries, and the production build pass.
- The clean release CI already replayed migrations through 130 in an ephemeral
  Supabase database; no local or production migration application was run.

## 2026-08-21 — Restore the remembered-login contract

**Risk profile:** runtime-platform — Pika and WorkOS session lifetime,
cross-cookie identity binding, protected-route recovery, middleware headers,
and browser logout. No hosted configuration or deployment was changed.

**Implemented:**
- Replaced the WorkOS pilot's 12-hour compatibility cookie with one shared
  180-day Pika policy and set both the browser `Max-Age` and encrypted
  `iron-session` seal TTL, avoiding the library's otherwise hidden 14-day TTL.
- Versioned Pika sessions and bound WorkOS-authenticated sessions to the exact
  verified WorkOS user ID plus normalized email. Legacy, unbound, mismatched,
  or Pika-only sessions fail closed while the pilot is enabled.
- Added read-only silent restoration for an active WorkOS session. It recreates
  the Pika UUID/role mapping only from the existing exact
  `public.users.workos_user_id` link and never creates or relinks by email.
  Restoration explicitly suppresses student login telemetry so it performs no
  Pal outbox write or delivery attempt.
- Preserved protected deep links and query strings through reauthentication by
  injecting a middleware-owned request-path header, stripping inbound spoofed
  values, and validating every returned internal path.
- Routed browser logout through a CSRF-protected same-origin POST, Pika cookie
  destruction, and the WorkOS logout URL so the server-side WorkOS session is
  invalidated. The retained JSON compatibility endpoint now explicitly revokes
  the WorkOS session and clears local state even if provider revocation fails.
- Updated the WorkOS rollout gate and operator guidance for the 180-day cookie,
  an exact 180-day Dashboard absolute maximum, Preview/Production cutoff
  verification, and rollback. The local Bara configurator now consumes the
  shared duration constant instead of reintroducing the former 12-hour value.

**Verification:**
- Full Vitest passes 4,965 tests across 570 files. The full coverage run also
  passes and restores `src/lib/auth.ts` to 100% branch coverage. Lint, the clean
  production build, diff checks, and the Pika audit pass.
- Playwright verification passes for the normal login and silent-restoration
  states on desktop/mobile in light/dark themes. The pre-auth surface is shared
  by teacher and student; both required stored-role captures were run.
- The account menu now performs a user-activated POST directly, while `/logout`
  is an explicit confirmation fallback and cannot auto-submit after a
  cross-origin navigation. Its confirmation state was inspected in teacher
  desktop, student mobile, teacher mobile, and dark-theme captures with no
  overflow or readability issues.
- Live local protected requests preserve full safe paths and query strings in
  `/login?next=...`. The shared `.env.local` was not modified; the local server
  used a process-only `WORKOS_COOKIE_MAX_AGE=15552000` override.
- Composite accessibility checklist reviewed: keyboard behavior remains native
  and unchanged, the restoration status is exposed through `role=status` with
  `aria-live`, semantic state is component-tested, and no manual follow-up
  remains.

## 2026-08-22 — Harden the legacy logout endpoint

**Risk profile:** runtime-platform — authentication logout CSRF protection; no
hosted configuration, deployment, database, or UI changed.

- Applied the existing exact-origin POST guard to `POST /api/auth/logout`
  before WorkOS session inspection, provider revocation, or local cookie
  destruction.
- Added regression coverage proving a cross-origin request returns 403 without
  invoking WorkOS or changing Pika and WorkOS authentication state.
- The test reproduced the prior behavior as a 200 response before the fix.
  After remediation, the focused authentication suite passes 112 tests across
  12 files; lint, Pika audit, and diff checks pass. Targeted security re-review
  reports no remaining blocker in the correction.

## 2026-08-22 — Preserve auth authority during rollback and Preview logout

**Risk profile:** runtime-platform — authentication rollback provenance and
logout CSRF origin validation; no hosted configuration, deployment, database,
or UI changed.

- Every new Pika session now records explicit password or WorkOS provenance.
  When the pilot is disabled, only current password-origin sessions remain
  valid; WorkOS mappings and ambiguous legacy seals fail closed instead of
  becoming independent credentials.
- Same-origin logout validation now trusts the origin serving the request,
  allowing Preview and custom aliases while retaining the canonical public URL
  solely for the WorkOS provider return destination.
- Regression tests reproduced all three prior failures before the fixes and
  cover password-session preservation, WorkOS-mapping rejection, and both
  logout endpoints on a non-canonical Preview origin.
- The focused auth surface passes 154 tests across 16 files. Full Vitest passes
  4,970 tests across 570 files; lint, architecture boundaries, Pika audit,
  diff checks, and the production build pass.

## 2026-08-22 — Make attendance recovery and credential smoke fail closed

**Risk profile:** runtime-platform — cross-service authentication, private
database state, and operator recovery; no hosted data, flags, configuration,
deployment, or production state changed.

- Normalized literal-null and all-null attendance outbox claim responses to a
  durable pending result, while sanitizing malformed composite diagnostics.
- Added migration 131 for private, service-role-only, canary-scoped smoke audit
  runs and replay nonces with rate limits and bounded nonce cleanup.
- Added production-only deployed Pika-to-Bara and Bara-to-Pika credential proof
  routes. The signed exchange is tenant, installation, teacher, classroom, and
  canary bound; it stores aggregate booleans and never mutates attendance data.
- Documented recovery invariants, production-only Preview skip rules, rollout
  ordering, and the explicit authorization boundary for migration/deployment.
- Local migration reset, generated-type parity, database privilege guard, full
  4,980-test suite, lint, and production build pass.
- Independent review corrections classify smoke audit ownership edges, bind
  callbacks to an active five-minute challenge, reject recovery idempotency
  drift, derive recovery time server-side, and repair the pre-enable rollout
  order. The same full verification passed after remediation.
- A subsequent independent PR review added audited recovery-page continuation
  so unchanged failures cannot starve later eligible events, and replaced the
  shared cron bearer with a dedicated smoke credential that is read only after
  the destination matches the configured canonical Pika production origin.

## 2026-08-22 — Close attendance recovery review-loop gaps

**Risk profile:** runtime-platform — deployed authentication smoke, bounded
operational state, and tenant deletion behavior; no hosted data, migration,
deployment, flag, credential, or production state changed.

- Made the deployed operator gate require HTTP 200 as well as a strict passing
  aggregate body, so pass-shaped 401/409/429/5xx responses cannot authorize
  rollout expansion.
- Made Preview reverse callbacks reject before configuration or database access
  and made the operator route fail closed when its dedicated credential is
  missing, short, or overlaps cron or either attendance HMAC secret.
- Bounded smoke-run and nonce retention to 100 expired rows of each kind per
  new challenge after 24 hours. Smoke-only evidence now cascades with an
  otherwise-authorized tenant deletion while active five-minute challenges
  remain protected.
- Added runtime database-guard coverage for retention cleanup and classroom
  deletion, plus focused route, runner, migration, and callback regressions.

## 2026-08-22 — Move attendance rollout preflight into deployed runtimes

**Risk profile:** runtime-platform — production cross-service authentication
and rollout gating; no hosted configuration, flags, deployment, or data changed.

- Made the Pika operator smoke run the complete pinned production environment
  audit inside Vercel before creating any smoke state, avoiding false evidence
  from locally downloaded Sensitive values that Vercel intentionally redacts.
- Bound each operator invocation to an explicit pre-enable or enabled mode and
  made Bara verify that mode against its deployed Convex integration flag before
  consuming nonce or callback state.
- Kept the proof aggregate-only, exact-canary scoped, authenticated, replay
  resistant, and non-mutating; updated rollout documentation and regression
  coverage for target drift, mode mismatch, and fail-before-smoke behavior.

## 2026-08-22 — Expose authenticated aggregate preflight diagnostics

**Risk profile:** runtime-platform — operator-only production rollout
diagnostics; no hosted configuration, flags, deployment, credential, attendance
event, or production data changed.

- Returned only fixed failed-check identifiers and aggregate pass/total counts
  after successful dedicated operator authentication when the deployed
  attendance environment preflight fails.
- Kept unauthorized responses diagnostic-free and preserved fail-before-state
  behavior, `no-store`, and `no-referrer` response controls.
- Normalized missing, short, overlapping, and incorrect operator credentials to
  the same private unauthorized response, preventing authentication-configuration
  disclosure before the deployed audit.
- Aligned the migration gate with hosted evidence that migration 131 is already
  recorded as applied: operators verify it and stop for fresh authorization if
  it is absent, but never dry-run or reapply it from this rollout flow.
- Swept every sibling attendance status, canary, roadmap, completion-audit, and
  recovery runbook so none still instructs operators to authorize or apply the
  already-recorded production migration 131; 42 focused documentation and
  startup guard tests pass.
- Added route and deployed-runtime regression coverage. The focused 24-test
  surface and the full 5,008-test suite, typecheck, production build, lint,
  architecture guard, and diff check pass.

## 2026-08-23 — Add teacher-scoped attendance entitlements

**Risk profile:** runtime-platform — service-only authorization, schedule
deactivation, cross-service rollout gating, and additive database schema; no
hosted migration, deployment, flag, entitlement, requeue, or production state
changed.

- Added an audited, idempotent teacher entitlement boundary keyed by stable
  Pika user ID. The global attendance flags remain kill switches, while the UI,
  teacher APIs, workers, outbox, reconciliation, and event ingress share the
  same fail-closed authorization predicate.
- Added stateful classroom deactivation: a higher-revision empty schedule
  cancels future intent, preserves open and historical sessions, and remains
  resumable until Bara acknowledges it. Expiry clamps future schedule delivery.
- Kept the existing exact Codepet Labs canary as the non-mutating deployed
  credential smoke and made the requested rollout scope an authenticated,
  audited preflight expectation instead of broadening the smoke payload.
- Added a dry-run-first, operation-id-bound service operator command and rollout
  documentation for enablement, revocation, rollback, Preview skip behavior,
  release order, and the production authorization boundary.
- Bara's 166-test suite, typecheck, and production build pass. Pika's full
  5,029-test suite, TypeScript check, production build, architecture guard,
  design guard, UI guard, and diff check pass. Local execution of migration 132
  and generated-type parity remain intentionally pending exact local-only
  authorization.

## 2026-08-23 — Repair attendance entitlement operator launch

**Risk profile:** runtime-platform — service-only entitlement operator
availability; no authorization binding, RPC payload, hosted entitlement, flag,
credential, or attendance state changed.

- Wrapped the existing operator body in an async entrypoint so the documented
  CommonJS `tsx` package command no longer fails compilation on top-level await.
- Added a subprocess regression that invokes the exact package script and proves
  it reaches argument validation instead of the transform failure.
- Verified the documented command against production in dry-run mode only; it
  read the current active revision 1 entitlement and emitted a disposable exact
  binding without executing an RPC.
- Focused tests, the full Vitest suite, lint, architecture guard, production
  build, and diff check pass.

## 2026-08-23 — Make student mobile attendance state obvious

**Risk profile:** student-facing attendance read UX — private tenant-scoped
status reads, bounded revalidation, and QR check-in confirmation; no migration,
hosted data, deployment, flag, entitlement, credential, or production state
changed.

- Added a signed-in-student-only attendance status endpoint and bounded batch
  reader for active enrolled classrooms. It preserves teacher entitlement and
  exact-canary scope and returns no token, roster, other-student, or arbitrary
  classroom data.
- Added a prominent mobile Today banner and compact classroom-index status for
  open check-in, plus the student's own present/late confirmation and Toronto
  timestamp. The banner remains informational and scanning the teacher's QR is
  still required.
- Invalidated the private client snapshot after successful or idempotent
  duplicate scans, linked back to the matching classroom, and bounded refreshes
  while suppressing stale prompts at the exact close time. Review remediation
  added forced boundary reads, bounded failure retries, next-day-close support,
  exact local close/confirmation validity timers, and Toronto-midnight rollover
  for closed confirmations even when status refreshes fail.
- Added unit, API, component, and teacher/student experience-matrix coverage for
  entitlement and classroom isolation, unavailable and closed states, mobile
  rendering, and duplicate-scan confirmation. Visual checks passed across
  desktop/mobile and light/dark student views plus the prescribed teacher and
  student smoke screenshots.
- The full 5,049-test suite plus two later boundary regressions, lint,
  TypeScript, production build, architecture,
  design, UI, Pika audit, browser matrix, and diff checks pass. Local database
  runtime/type-parity guards remain intentionally unavailable because the local
  schema does not include unapplied migration 132; no migration was applied
  without fresh authorization.

## 2026-08-23 — Refine the student classroom attendance signal

**Risk profile:** student-only visual refinement; no attendance behavior,
authorization, schema, flag, deployment, or production state changed.

- Replaced the classroom-list attendance sentence with an icon-only Lucide
  QR-scan indicator in the card's upper-right corner. The open indicator uses a
  restrained reduced-motion-safe pulse; confirmed attendance uses the existing
  static success icon. Full scanning instructions remain on Today.
- Kept a polite named status for assistive technology and preserved the entire
  classroom card as the only interaction on the index.
- Focused component tests, TypeScript, lint, Pika audit, and the six-test
  desktop/mobile light/dark browser matrix pass. Visual verification passed for
  teacher/student smoke views and the student open state in every required
  viewport/theme combination.

## 2026-08-23 — Compact and statically highlight student attendance prompts

**Risk profile:** student-only visual refinement; no attendance behavior,
authorization, schema, flag, deployment, or production state changed.

- Shortened the open-state Today banner to the single line “Scan QR for
  Attendance” beside the QR-scan icon while preserving the private confirmed
  Present/Late state and timestamp.
- Replaced the classroom-list pulse with a static semantic accent ring and soft
  highlight, and applied the same non-interactive emphasis to the compact Today
  status. No attendance indicator now uses looping motion.
- Focused component tests (13), TypeScript, lint, Pika audit, and the six-test
  desktop/mobile light/dark attendance browser matrix pass. Visual verification
  passed for student open/closed/confirmed states and teacher/student regression
  views without overflow.

## 2026-08-23 — Close student attendance confirmation and clock-skew review gaps

**Risk profile:** runtime-platform — student-only attendance read reconciliation
and expiry timing; no attendance mutation, schema migration, flag, entitlement,
deployment, credential, or production state changed.

- Preserved validated successful and idempotent check-in results in a
  student-and-classroom-scoped, in-memory handoff while the asynchronous record
  projection converges. The handoff lasts at most two minutes, polls no faster
  than every five seconds, and clears for unavailable, unenrolled, archived, or
  projection-confirmed classrooms.
- Added validated server time to the private attendance status contract and
  anchored client refresh and visibility deadlines to monotonic elapsed time,
  preventing ahead or behind mobile clocks from retaining or hiding prompts at
  the wrong instant.
- Added component and browser regressions for stale-open navigation after an
  idempotent duplicate scan, client clocks two hours ahead and behind, bounded
  reconciliation, cross-student isolation, and automatic disabled-scope hiding.
- Independent re-review found and remediation removed an SSR-to-POST identity
  race by binding the handoff to the route-authenticated student returned in the
  positive response. Cached status views also retain their original monotonic
  receipt so remounting cannot re-age server time near close or expiry.
- A final integration re-review found that the short-lived scan handoff could
  override a newly closed/scheduled/no-session projection. The handoff now only
  overlays a still-open projection and is capped at its server-authored close.
- A fresh security pass found the status snapshot lacked a response-to-session
  identity binding. Status views now carry the GET-authenticated student ID and
  every post-auth response carries the same binding; success or failure
  mismatches are rejected, cleared, and never cached or rendered.
- A subsequent fresh security pass bound that handoff to the exact attendance
  occurrence with a student-scoped one-way tag, so a later open occurrence in
  the same classroom cannot inherit an earlier confirmation. Initial transient
  read failures now retry single-flight every 15 seconds while remaining
  claim-free until a validated private snapshot arrives.
- Focused tests, TypeScript, the full Vitest suite, lint, production build,
  architecture/design/UI guards, Pika audit, and the six-test desktop/mobile
  light/dark attendance matrix pass. Visual artifacts were inspected. The local
  database-type guard remains unavailable because the existing local Supabase
  schema predates already-merged attendance migrations; no migration or type
  rewrite was performed without authorization, and CI must use ephemeral replay.

## 2026-08-24 — Hide the titlebar fullscreen control on mobile

**Risk profile:** none — responsive presentation only; fullscreen behavior,
authorization, data, schema, and deployment state are unchanged.

- Hid the shared titlebar fullscreen/maximize control below the existing `sm`
  breakpoint while preserving the same desktop control and keyboard shortcut.
- Added a focused AppHeader regression assertion for the responsive visibility
  contract.
- Focused component tests, lint, and the design-policy check pass. Playwright
  visual verification passed for teacher and student titlebars at 390px and
  1440px in light and dark themes, with no horizontal overflow.

## 2026-08-24 — Consolidate live-attendance center FAB

**Risk profile:** none — teacher-only attendance navigation and action layout;
no attendance behavior, API contract, schema, flag, entitlement, or deployment changed.

- Moved the live-attendance date navigator from the action-bar label slot into
  the center floating action cluster alongside session actions.
- Replaced the scheduled-state Open attendance text button with an accessible
  DoorOpen icon button and shared tooltip while preserving its command behavior,
  loading state, disabled state, and accessible name.
- Kept the open-state QR and Close actions icon-only below the `sm` breakpoint,
  with accessible names and keyboard-disclosed tooltips, and increased mobile
  action-bar clearance so the center FAB does not overlap the session summary.
- All 11 focused component tests, lint, design policy, and UI policy pass; the
  Pika audit found no violations. Playwright verification passed at exact 320px
  and 375px widths in
  light and dark modes, including keyboard tooltip disclosure; student is not
  applicable to this teacher-only surface.

## 2026-08-24 — Simplify attendance-hours guidance

**Risk profile:** none — teacher-only copy and contextual-help refinement; no
attendance behavior, API contract, schema, flag, entitlement, or deployment changed.

- Removed the attendance-hours dialog subtitle and moved the Closing day and
  automatic scheduling explanations into accessible help-icon tooltips.
- Kept both concise labels visible, preserved checkbox/select behavior, and
  retained shared semantic tokens, tooltip ownership, focus treatment, and
  minimum control targets.
- The focused dialog suite, lint, and UI policy checks pass. Playwright visual
  verification passed for teacher desktop/mobile, light/dark, and both hover or
  keyboard-focus tooltip states. Independent review found that touch taps do not
  open Radix tooltips, so each help icon now also toggles an accessible inline
  disclosure with verified first-tap open and second-tap dismissal. Disclosure
  state resets between dialog sessions so reopened settings remain concise.
  Student is not applicable to this teacher-only dialog.

## 2026-08-24 — Rebase and reverify attendance-hours guidance

**Risk profile:** workspace-state — rebased the existing teacher-only UI
refinement onto current `origin/main`; no product behavior, schema, migration,
flag, entitlement, or deployment state changed.

- Preserved current `main` behavior and archive lineage while replaying all
  three attendance-hours refinement commits. The only conflict was the
  generated continuity archive marker; no migration files were added or
  renamed, and no task stash was created.
- Focused component tests (7/7), lint, UI policy, design policy, continuity-log
  validation, and diff checks pass on the rebased worktree.
- Playwright verification passed for teacher desktop/mobile, light/dark,
  hover, keyboard-focus, and both touch-disclosure states. Student remains not
  applicable to this teacher-only dialog.
- Fresh rebased-head review found collapsed help buttons retained `aria-controls`
  references to absent disclosure elements. The relationships are now emitted
  only while expanded, with focused assertions covering both help controls.
- The remediated focused suite remains 7/7 passing; lint, UI policy, design
  policy, continuity-log validation, and diff checks pass.

## 2026-08-24 — Simplify teacher Daily class-log summary

**Risk profile:** none — teacher-only presentation refinement; summary loading,
content, resizing behavior, API contracts, schema, and student surfaces are unchanged.

- Removed the horizontal dividers from the expanded Class Log Summary resize
  handle, title row, and generated timestamp.
- Standardized summary content and state padding so the copy shares the title's
  left edge across ready, pending, empty, and error states, with a normal 8px
  title-to-copy gap.
- Removed the redundant Needs Attention label while preserving the warning dot
  and linked student name. The list retains a nonvisual accessible name and the
  decorative dot is hidden from assistive technology.
- Added the shared Toronto-aware `formatRelativeDateTimeInToronto` helper for
  `Today`, `Yesterday`, and compact older timestamps, including DST-boundary
  coverage, and adopted it for the generated-summary label.
- The focused component and timezone suites pass (34/34), the full Vitest suite
  passes (5,077/5,077), lint and the production build are clean apart from the
  existing WorkOS Edge-runtime warnings, and diff checks pass. Playwright visual
  verification passed for teacher desktop/mobile in light/dark themes using an
  isolated exact-class harness because the shared local environment has no
  Supabase test credentials. Student is not applicable to this teacher-only panel.

## 2026-08-24 — Verify the enabled attendance entitlement rollout

**Risk profile:** runtime-platform — authorized local database reset and
production signed smoke verification; no production migration, deployment,
flag, entitlement, cleanup, or attendance-data mutation was performed.

- Reset the shared local database and replayed migrations 001-132 from current
  `main`, repairing an older installed migration-131 smoke-function definition.
  The complete Bara attendance database contract now passes; local remains
  intentionally unseeded.
- Read-only production checks confirmed migrations 001-132 are recorded and
  the installed migration-131 smoke cleanup plus migration-132 entitlement
  contracts are present.
- An authorized pre-enable exact-canary diagnostic failed before smoke state
  with `attendance_disabled_for_preflight` and `attendance_scope_mode`, proving
  production had already advanced beyond the stale continuity record.
- The separately authorized deployed smoke then passed 4/4 in `enabled` mode
  with `teacher_entitlements` as current and target scope, proving canary scope,
  transition-queue health, and both signed Pika/Bara directions.

## 2026-08-25 — Adopt relative assignment timestamps

**Risk profile:** none — teacher/student assignment timestamp presentation only;
no assignment state, API contract, schema, persistence, or layout behavior changed.

- Adopted the shared Toronto-relative date formatter for the live teacher
  saved-version preview, student returned-feedback timestamps, and student
  submission labels. The unreferenced legacy `TeacherStudentWorkModal` remains
  unchanged rather than broadening this work into its unrelated audit debt.
- Preserved the student's exact saved-version date in the restore confirmation,
  where an unambiguous historical identifier remains more useful than relative copy.
- Focused teacher/student component and timezone tests pass (51/51), the full
  Vitest suite passes (5,079/5,079), and lint, build, architecture, design, UI,
  audit, continuity, and diff gates are clean apart from the existing WorkOS
  Edge-runtime build warnings. Playwright verification passed for the affected
  teacher/student compositions on desktop and mobile in light and dark themes
  using a temporary Pika-token harness because the shared local environment has
  no Supabase credentials; the harness was removed. The composite-widget
  checklist was reviewed: keyboard and semantic behavior are unchanged, with
  no remaining manual follow-up.

## 2026-08-25 — Reconcile attendance rollout documentation

**Risk profile:** none — documentation consistency only; no migration,
deployment, configuration, entitlement, smoke, or hosted data changed.

- Reconciled the adapter status, control runbooks, native-attendance roadmap,
  canary boundary, and completion audit with the verified production state:
  migrations through 132, enabled `teacher_entitlements`, and the passing 4/4
  deployed smoke.
- Preserved the exact pair as the signed-smoke scope, retained separate
  authorization for future changes, and replaced completed pre-enable steps
  with the remaining entitled-teacher workflow, UI, isolation, and pilot gates.
- Review remediation rewrote the operational-recovery procedure from the
  current enabled state and extended the rollout regression to cover the
  compact handoff plus production smoke instructions.
- Final remediation made the regression pin the runbook's dated 4/4 status and
  complete enabled production command, preventing a partial command or stale
  pre-enable block from satisfying the rollout-continuity gate.
- Rebased onto current `main`, retained its assignment timestamp work and
  canonical continuity history, then corrected the v1 guide's production
  preflight example to the enabled entitlement state and pinned the full command
  in regression coverage.
- Rereview hardened that regression to inspect fenced preflight commands
  independent of option order while allowing historical prose and preview-only
  pre-enable examples.
- Final parser remediation reconstructs individual continued commands across
  common shell fence labels, preventing cross-command false positives and
  catching reordered or equals-form stale production flags.
- With an explicitly extended review budget, replaced the growing shell parser
  with an exact single-purpose preflight-fence contract and labeled the
  migration-132 rollout sequence as completed audit history rather than future
  operator instructions.

## 2026-08-25 — Pin the student Pal companion on iPhone

**Risk profile:** none — student-only Pal companion placement; no academic
state, API contract, authentication, schema, or reward behavior changed.

**Model recommendation:** GPT-5.6 — localized host-layout work with
cross-browser verification and a bounded independent review.

- Made the Pika-owned companion host explicitly use a non-interactive
  bottom-right placement contract backed by Pika spacing/layer tokens and iOS
  safe-area insets.
- Added component and stylesheet contract coverage for the placement invariant
  while preserving the existing test-surface suppression and Pal failure
  boundary behavior.
- The focused suites pass (19/19), the full Vitest suite passes
  (5,081/5,081), and lint, TypeScript, architecture, design, UI, and diff gates
  are clean after rebasing onto current `main`.
- Playwright visual verification passed for student desktop/mobile in light and
  dark themes and for an iPhone 13 WebKit profile; teacher desktop/mobile were
  checked as unaffected. Chromium and WebKit pointer-drag probes both retained
  the same bottom-right rectangle at 16px from the viewport edges.

## 2026-08-25 — Verify entitled-teacher active-class readiness

**Risk profile:** runtime-platform — read-only production UI and aggregate
database verification; no production migration, deployment, entitlement,
configuration, flag, cleanup, or attendance-data mutation was performed.

- Confirmed the entitled teacher sees Attendance in the sole active production
  classroom and that its enabled policy plus opaque roster/schedule mapping are
  fully synced.
- Added the target-pinned, aggregate-only `attendance:pilot:readiness` operator.
  It emits no teacher, classroom, roster, or student identifiers and fails
  closed unless configured and unconfigured active classrooms both exist.
- The production run correctly reported
  `requires_at_least_two_active_classrooms` and
  `requires_unconfigured_active_classroom`; the save-isolation gate therefore
  remains open until a second intended active classroom exists or an exact
  temporary setup and restoration is separately authorized.
- Added focused readiness, service-role read-path, and operator-contract
  coverage. The full suite passes (5,085/5,085); lint, TypeScript, and the
  production build pass with only the existing WorkOS Edge-runtime warnings.
- Independent review found that separate REST reads could observe inconsistent
  states, an unconfigured Class mapping could mask a missing configured-Class
  mapping, the service-role transport was not operation-read-only, and output
  could expose unstable error or revision detail.
- Remediated those findings with proposed, unapplied migration 133: one stable
  aggregate SQL RPC, configured-Class mapping association, an exact RPC/teacher
  transport allowlist, stable operator failure codes, and database regression
  coverage. The final suite passes (5,089/5,089); lint, TypeScript, architecture
  boundaries, and the production build pass. Production remains through
  migration 132 and was not modified.
- Targeted re-review caught and fixed a database-test false positive where the
  allowed `roster_mappings` key matched a broad `roster_` leak substring. The
  assertion now requires exactly the eight aggregate keys with numeric values;
  migration 133 remains unapplied pending exact authorization.

## 2026-08-26 — Adopt Pal widget alpha.5

**Risk profile:** none — pinned widget package and compatibility assertions only;
no schema, API, persistence, authentication, or production state changed.

- Published and installed the immutable registry release
  `@codepet/pal-widget@0.1.0-alpha.5`; the `alpha` dist-tag resolves to alpha.5
  and the regenerated lockfile records its npm registry integrity rather than a
  temporary tarball path.
- Updated the package pin and compatibility assertions for concealed achievement
  titles and collectible-focused story celebrations. The Pika-owned reward modal
  now asserts `The Clockwork Lantern`, sketch art, and the absence of the retired
  `Story Keeper` title.
- Focused Pal integration tests pass (19/19), the registry-backed full Vitest
  suite passes (5,090/5,090), and frozen install, lint, TypeScript, architecture
  boundaries, and the production build pass.
- Playwright desktop (1440x900) and mobile (390x844) review confirmed the modal
  remains centered and responsive with the collectible-only presentation. The
  temporary unauthenticated review route was removed; teacher review is n/a
  because the integration is student-only.

## 2026-08-26 — Stabilize unsaved-grade action test

**Risk profile:** none — test synchronization only; no application behavior,
schema, API, persistence, authentication, or production state changed.

- Confirmed the intermittent `TeacherClassroomView` failure was an assertion
  race: the mocked grading panel renders before its passive effect reports the
  pending-grade state to the parent.
- Moved the panel predicate and all three disabled-action assertions into one
  `waitFor`, so the test awaits the observable contract instead of assuming
  effect timing.
- The focused test passes 20/20 repetitions, all 50 tests in the component file
  pass under coverage, the full 5,090-test coverage suite passes, and lint is
  clean.

**Model recommendation:** GPT-5.6 Sol for precise React effect and async-test
reasoning.

## 2026-08-26 — Improve mobile classroom navigation

**Risk profile:** none — shared classroom-shell navigation and responsive
presentation only; no API, schema, persistence, dependency, or hosted state changed.

- Added Pika's home affordance to the mobile classroom drawer as a distinct
  `All classrooms` navigation row beneath the `Navigation` heading, with its
  own surface, hover state, and focus ring. The desktop header logo is unchanged.
- Reclaimed the unused mobile header center column for the classroom selector,
  so the seeded `Test Classroom` label renders in full instead of collapsing to
  its first character.
- Added regression coverage for mobile layout ownership, drawer home navigation,
  blocked navigation, the Pika brand link, and active student exam mode hiding
  the mobile navigation while rejecting direct home-exit attempts.
- Full Vitest passes (5,096/5,096), lint, design policy, UI policy, and diff
  checks pass. Playwright visual verification passed for teacher and student,
  desktop and mobile, light and dark, including drawer-open and keyboard-focus
  states. Mobile captures had no horizontal overflow, and both roles navigated
  from the drawer to `/classrooms`.

## 2026-08-26 — Simplify the student Daily Log prompt

**Risk profile:** none — student-facing prompt copy and hierarchy only; no
editor, API, persistence, authentication, or teacher behavior changed.

- Removed the rotating reflection opener and fresh-start copy so the Daily Log
  shows only `What's your plan for today?` as its primary prompt.
- Kept the existing rich-text writing area, placeholder, focus behavior, and
  save state unchanged, per product direction.
- Focused Daily Log coverage passes 22/22; lint and UI policy pass. Playwright
  visual verification passed for student desktop/mobile in light/dark and for
  the unchanged teacher desktop/mobile views.

**Model recommendation:** GPT-5.6 for small, judgment-sensitive UI refinements.

## 2026-08-26 — Match the Pika logo to theme text

**Risk profile:** none — shared brand presentation only; no layout, API, schema,
persistence, authentication, dependency, or hosted state changed.

- Replaced the logo's warm dark-mode image filter with a semantic mask colored
  by `--color-text-default`, so the mark exactly matches primary text in light
  and dark themes.
- Preserved the logo's accessible image name and existing dimensions while
  updating shared-header regression coverage for the semantic token contract.
- Focused component and semantic-token tests pass (19/19); lint, design policy,
  diff checks, and the production build pass (with existing WorkOS Edge-runtime
  warnings).
- Playwright screenshots were visually reviewed for teacher and student
  contexts at desktop/mobile in light/dark. Authenticated routes were unavailable
  because the shared env lacks Supabase configuration, so the real shared header
  and logo were rendered in a temporary local verification route that was removed
  after capture.

- PR #1072 independent review found no implementation blockers. Initial CI
  exposed one stale `getByAltText` assertion in the mobile sidebar test; it now
  verifies the preserved accessible image role and name, and the focused header
  plus sidebar suite passes (11/11).

**Model recommendation:** GPT-5.6 Sol for exact semantic-theme and visual review.

## 2026-08-26 — Leave missing student Today lesson plans blank

**Risk profile:** none — student-facing empty-state copy only; no lesson-plan
data, loading behavior, API, schema, persistence, or teacher UI changed.

- Removed the `No lesson plan for today` and missing previous-class lesson-plan
  messages from the student Today sidebar while preserving its Today/Yesterday
  headings, dates, real lesson content, loading state, and no-previous-class copy.
- Updated the classroom-page regression coverage to assert both empty lesson
  messages remain absent after a classroom route change.
- The focused 30-test component suite, lint, and environment verification pass.
  Playwright review of the exact sidebar component passed at desktop/mobile in
  light/dark with no overflow or browser console errors; the temporary review
  route was removed after capture. Teacher review is n/a because the changed
  sidebar is student-only.

**Model recommendation:** GPT-5.6 for a narrow, copy-only UI refinement.

## 2026-08-26 — Pin student Achievements navigation to the bottom

**Risk profile:** none — student classroom navigation ordering and layout only;
no API, schema, persistence, dependency, or hosted state changed.

- Moved the student-only Achievements destination out of the primary classroom
  navigation cluster and pinned it to the bottom of the desktop sidebar and
  mobile navigation drawer. Teacher navigation remains unchanged.
- Added regression coverage for the complete student navigation order, active
  `aria-current` state, and the bottom-placement class.
- Full Vitest passes (5,096/5,096). Focused navigation/sidebar tests pass
  (16/16), lint, design policy, Pika audit, and diff checks pass.
- Playwright visual verification passed for student and teacher, desktop and
  mobile, light and dark. The active Achievements link stays inside the viewport
  at the bottom edge with no horizontal overflow.
- Composite-widget checklist reviewed: keyboard behavior is unchanged; semantic
  active state is covered by tests; remaining manual follow-up: none.

**Model recommendation:** GPT-5.6 Sol for the small shared-shell layout change
and bounded PR review.

## 2026-08-26 — Move student check-in status into Today side card

**Risk profile:** none — student Today-tab composition only; no attendance
logic, API, schema, persistence, authentication, or hosted state changed.

- Moved the existing `StudentAttendanceStatus` banner from above the daily-log
  editor into the right-side lesson-plan card's `Today` section. The signed-in
  student identity and classroom-scoped status selection remain unchanged.
- Kept the open state as the one-line `Scan QR for Attendance` prompt and
  simplified confirmation to one line: `Checked in at 9:07 AM`. The visible
  Present/Late taxonomy, timezone suffix, and secondary confirmation line were
  removed from this student surface.
- Added focused coverage proving the attendance hook receives the signed-in
  student and the rendered status is contained by the `Today` side-card
  section. A dedicated mobile inspector keeps the side card before the Daily
  Log in both visual and assistive-technology reading order below `lg`, while
  desktop keeps the Daily Log before the right-side inspector. Attendance
  status and Today-history regressions remain covered.
- Focused Vitest passes (82/82), lint and design policy pass. Playwright
  captures of the real component and side-card markup cover QR-open and
  confirmed states on desktop/mobile in light/dark with no banner overflow,
  wrapping, or legibility issues. The temporary visual
  fixture was removed; the authenticated app matrix was unavailable because
  the shared local environment has no Supabase URL or keys. Teacher UI is n/a
  because this composition renders only for the student Today workspace. A
  focused responsive-order capture also confirms Today-first stacking on
  mobile and the unchanged right-side placement on desktop.

**Model recommendation:** current model for a localized React composition and
visual-verification change.

## 2026-08-26 — Prevent the mobile Pika logo from flashing blank

**Risk profile:** none — shared brand rendering only; no navigation behavior,
layout, API, schema, persistence, dependency, or hosted state changed.

- Replaced the network-backed `/pika.png` CSS mask with the existing compact
  brand image embedded as a shared CSS data-URI token. This preserves semantic
  light/dark coloring while making the mask available on the first drawer paint.
- Added regression coverage for the inline mask contract and explicitly rejects
  restoring the delayed external mask.
- Full Vitest passes (5,097/5,097); focused header/sidebar tests pass (11/11).
  Lint, architecture, design policy, UI policy, Pika audit, diff checks, and the
  production build pass (with existing WorkOS Edge-runtime warnings).
- Playwright visual verification passed for teacher and student at desktop/mobile
  in light/dark. The mobile drawer was captured immediately after opening; the
  Pika mark is present in all four cold-open mobile captures with correct theme
  color and no overflow.
- PR CI exposed stale attendance-matrix assertions from the preceding Today-card
  merge. The test now targets the visible responsive inspector and the current
  one-line confirmation copy; its desktop/mobile, light/dark matrix passes (6/6).

**Model recommendation:** current frontier coding model for a narrow visual-load
regression with cross-role and cross-theme verification.

## 2026-08-27 — Replace archived Classroom action labels with icons

**Risk profile:** none — teacher archived-Classroom action presentation only;
no workflow, API, schema, persistence, dependency, or hosted state changed.

- Replaced the visible `Reuse` label with the Lucide copy-plus icon and the
  visible `Unarchive` label with the archive-restore icon. Both actions retain
  their accessible names and expose the original labels through shared
  hover/focus tooltips.
- Preserved primary/surface action hierarchy, loading feedback, disabled state,
  focus treatment, and the shared 44px minimum target.
- Focused component coverage passes (31/31), including icon identity, absence
  of visible label text, and tooltip behavior. Lint and design policy pass.
- Playwright visual verification passed for teacher desktop/mobile in
  light/dark, including hover and keyboard-focus tooltips, with no horizontal
  overflow. Student desktop/mobile light/dark captures confirm the actions
  remain absent. A temporary visual route was removed after capture because the
  shared local environment has no Supabase URL or keys.

**Model recommendation:** current model for a narrow, accessible UI refinement.

## 2026-08-27 — Return Pika logo navigation to active classrooms

**Risk profile:** none — localized teacher classroom-list state transition; no
layout, API, schema, persistence, authentication, or hosted state changed.

- Added a shared app-home selection event to the existing Pika logo navigation
  without changing its route, guarded-navigation behavior, or modifier clicks.
- Made the teacher classrooms index switch from Archived to Active when the logo
  selects Home while preserving Organize mode.
- Added semantic component coverage for the header signal, blocked navigation,
  and `aria-pressed` Active state, plus the exact interaction in the archived
  classroom Playwright matrix.
- Focused Vitest passes (42/42); lint, architecture, UI policy, Pika audit, and
  diff checks pass. Playwright passed for teacher/student boundaries and the
  teacher Archived-to-Active interaction at desktop/mobile in light/dark, with
  no overflow or visual regression.
- Composite-widget checklist reviewed: keyboard behavior unchanged and covered
  by the shared control; semantic state covered by tests; remaining manual
  follow-up none.
- CI twice exposed the unrelated in-app test-preview callback regression racing
  its own five-second `waitFor` under full-suite coverage load. The test keeps
  its five-second assertion deadline but now has a ten-second outer deadline.

**Model recommendation:** GPT-5.6 Terra at high reasoning for a standard-risk
application state-transition review.

## 2026-08-27 — Keep Daily class-log summaries minimal

**Risk profile:** runtime-platform — AI summary policy, untrusted-output boundary,
cached-summary compatibility, and a teacher unavailable state; no schema,
dependency, migration, deployment, or hosted state changed.

- Reframed the Daily class-log summary prompt as minimal triage instead of a
  general sentiment-and-themes summary.
- Required explicit facts only and prohibited inferred emotion, motivation,
  intent, diagnoses, causes, tone interpretation, embellishment, or constructed
  patterns.
- Restricted action items to explicit high-priority safety, wellbeing, serious
  incident, or participation-blocking concerns needing prompt teacher action.
  Routine difficulty, mild frustration, ordinary questions, incomplete work,
  neutral updates, achievements, and vague wording are excluded.
- PR review hardened the boundary: logs are JSON-serialized behind server-issued
  source references, the Responses API enforces a strict category-only schema,
  runtime validation rejects unknown/duplicate references and extra fields, and
  all visible wording is derived server-side.
- Versioned cached summaries retire legacy broad summaries instead of serving
  them as current, including stale and malformed historical shapes. The teacher
  sees concise unavailable copy for those dates.
- Successful model responses must now be complete and non-refusal before their
  schema-valid output can be accepted; incomplete and mixed refusal/output
  payloads fail closed.
- A committed, reproducible synthetic live-model matrix passed 5/5 explicit
  high-priority cases and 7/7 routine/vague exclusions with zero category or
  attribution mismatches. The evaluation pins the documented
  `gpt-5-nano-2025-08-07` snapshot and verifies the provider-returned model.
  The package evaluation command loads the shared `.env.local` directly and
  passes with no API key pre-exported in the shell.
  A forged log boundary stayed attributed to its submitting log and never to
  the targeted student.
- Focused unit, cron, teacher API, and component suites pass (65/65). Visual
  verification of the teacher unavailable state passed on desktop/mobile in
  light/dark with no overflow; student is n/a because the panel is teacher-only.
- Pika audit, lint, architecture, TypeScript, session-log, and diff checks pass.
  The remediated full suite passed 5,104/5,105 and hit one unrelated
  `TestDetailPanel` timing failure; that complete 43-test file passed immediately
  in isolation.

**Model recommendation:** GPT-5.6 Sol for the untrusted AI-output, attribution,
safety-threshold, cache-compatibility, and review remediation boundary.

## 2026-08-27 — Make the titlebar Classroom title static

**Risk profile:** none — shared titlebar interaction removal only; no API,
schema, persistence, authentication, dependency, or hosted state changed.

- Replaced the multi-Classroom selector in `AppHeader` with the same static,
  truncated Classroom title treatment used for a single Classroom. Clicking the
  title now has no behavior; the Pika logo remains the Home link to
  `/classrooms`.
- Removed the unused selector component, its switching/navigation guard
  plumbing, its focused test suite, and the now-stale UI/design exception
  registry entries. Added AppHeader coverage proving multiple Classrooms still
  render the current title without a selector or listbox and remain inert when
  clicked, plus shell/exam-source wiring contracts that prevent the removed
  callback from returning.
- Focused Vitest passes (54/54); lint, TypeScript, architecture, UI policy,
  design policy, Pika audit, and diff checks pass.
- Playwright rendered the real AppHeader for teacher and student at
  desktop/mobile in light/dark. All eight captures passed visual review with no
  overflow, truncation, alignment, or contrast regressions; direct browser
  clicks left the titlebar unchanged and desktop snapshots retained the linked
  Pika logo. The temporary visual harness was removed after capture because the
  shared local environment has no Supabase URL or keys.
- Composite-widget review: the Classroom dropdown was removed completely, so
  its menu keyboard/focus contract and exception entries are no longer
  applicable. Existing UserMenu and mobile navigation controls are unchanged.
- Independent PR review found no merge blockers. Its one P3 documentation
  finding was fixed by updating the shared-header comment from Classroom
  selector to Classroom title.

**Model recommendation:** GPT-5.6 Sol for a shared-shell behavior removal with
cross-role visual verification.
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

## 2026-07-05 — Test draft route simplification

**Completed:**
- Weekly Pika simplification selected the teacher test draft API route as the hotspot because it duplicated assessment draft creation/repair logic already available in `ensureAssessmentDraft`.
- Removed the route-local `ensureTestDraft` helper from `src/app/api/teacher/tests/[id]/draft/route.ts` and routed GET/PATCH through the shared assessment draft helper.
- Updated `tests/api/teacher/tests-draft-route.test.ts` to cover the shared helper path while preserving document validation and save behavior.
- Opened draft PR #834: https://github.com/codepetca/pika/pull/834
- Risk profile: workspace-state, because test draft preservation and repair are stateful editor concerns.

**Validation:**
- `bash scripts/verify-env.sh`
- `./node_modules/.bin/vitest run tests/api/teacher/tests-draft-route.test.ts`
- `bash .codex/skills/pika-audit/scripts/audit.sh`
- `./node_modules/.bin/vitest run`
- `pnpm test` was attempted but blocked before Vitest by pnpm ignored build-script approval (`@parcel/watcher`, `esbuild`, `unrs-resolver`).

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

## 2026-07-05 — Student exam access e2e coverage

**Completed:**
- Added one focused Playwright flow for student exam mode covering teacher-closed access during an in-progress open-response test.
- The test creates an active open-response test through existing teacher APIs, saves a student draft, closes and reopens that student's access, and verifies the draft is restored after reopening.
- Kept the patch to e2e coverage plus this continuity entry; no app logic, migrations, or dependencies changed.

**Validation:**
- `bash scripts/verify-env.sh`
- `corepack pnpm exec playwright test e2e/student-exam-mode.spec.ts --project=chromium-desktop --grep "preserves an open-response draft when teacher closes and reopens access"`
- `corepack pnpm lint`

## 2026-07-09 — Collaborator readiness: rulesets, CODEOWNERS, onboarding docs

**Completed:**
- Updated GitHub rulesets via API: `main` now requires a PR with 1 approving code-owner review plus the `Test & Build` status check (squash/rebase only); `production` mirrors the review + status-check requirements. Repo admins retain bypass.
- Added `.github/CODEOWNERS` (`* @armorup`) and `CONTRIBUTING.md` (collaborator setup, PR workflow, contribution permission note).
- README Getting Started rewritten: own-Supabase-per-developer with `supabase db push` (was stale "migrations 001–008 in dashboard"), required vs optional env split, seeded staging creds removed from docs.
- Marked shared `.env.local` symlink convention as maintainer-specific in `.ai/START-HERE.md` and `docs/dev-workflow.md`.
- Ran gitleaks over full history (1242 commits): no live secrets; flagged initial-commit README/tests 64-hex `SESSION_SECRET` example for precautionary rotation.
- PR: https://github.com/codepetca/pika/pull/835

**Validation:**
- `pnpm test tests/unit/ai-startup-docs.test.ts` (26/26 passed)
- `gh api repos/codepetca/pika/rulesets/{10460660,12273665}` confirmed new rules active

## 2026-07-09 — Archive trimmed session-log entries instead of deleting

**Completed:**
- Fixed `scripts/trim-session-log.mjs` so entries it removes from `.ai/SESSION-LOG.md` are appended to the bottom of `.ai/JOURNAL-ARCHIVE.md` (preserving entry markdown and chronological order) instead of being permanently deleted, matching the header claim that full history lives in the archive.
- Added `--archive <path>` and `--no-archive` flags; archiving is on by default and skipped when nothing is trimmed. A missing archive file is created with a minimal append-only header.
- Documented the archiving behavior in the generated session-log header rules and script usage text.
- Updated `tests/unit/trim-session-log.test.ts`: existing temp-path tests now pass explicit `--archive`/`--no-archive` (so they cannot write to the real archive), plus new coverage for appending to an existing archive, default-path archive creation, and no-op trims leaving the archive untouched.
- Note: entries trimmed between ~2026-05-05 and 2026-06-14 predate this fix; they are gone from the archive but recoverable from `.ai/SESSION-LOG.md` git history.

**Validation:**
- `pnpm test tests/unit/trim-session-log.test.ts` (8/8 passed)
- `pnpm test tests/unit/ai-startup-docs.test.ts`
- `node scripts/trim-session-log.mjs --check`
- `pnpm lint`

## 2026-07-09 — Remove stale staging environment references

**Completed:**
- Removed stale staging-environment references now that the staging Supabase environment is gone: README.md (seed `ENV_FILE` example, UI gallery wording, renamed the "Staging workflow" E2E section to a remote/preview workflow), docs/core/pilot-mvp.md (Environments section and manual cron trigger now reference Vercel preview deployments), docs/core/project-context.md, docs/core/tests.md, docs/semester-plan.md, docs/deployment/BREVO-SETUP.md, seed script headers (scripts/seed.ts, scripts/seed-gld2o.ts), and src/lib/email.ts comments.
- Kept the generic `ENV_FILE` mechanism (examples now use a pasteable `.env.custom.local`) and reworded remote-testing guidance to Vercel preview deployments.
- Left the seeded `GLD2O Staging` classroom title unchanged (test-data name, not an environment reference) and `.ai/JOURNAL-ARCHIVE.md` (historical archive).

**Validation:**
- `bash scripts/verify-env.sh`
- `grep -rni staging` (only seed-data classroom title and journal archive remain)
- `pnpm lint`
- `pnpm exec tsc --noEmit`

## 2026-07-11 — Collaborator-local env startup guidance

**Completed:**
- Aligned the remaining startup/env guidance drift so collaborator-owned `.env.local` files are explicitly valid outside the maintainer symlink setup.
- Updated `AGENTS.md`, `.ai/CURRENT.md`, `.codex/prompts/session-start.md`, `.claude/commands/session-start.md`, and `docs/core/project-context.md` to describe the maintainer symlink as the default on that machine, while allowing collaborators to copy `.env.example`.
- Replaced the `ai-startup-docs` invariant that enforced a universal symlink requirement with a dual-path check that requires both the maintainer shared-env path and collaborator-local setup guidance.
- No product code, runtime behavior, migrations, or dependencies changed.

**Validation:**
- `bash .codex/skills/pika-session-start/scripts/session_start.sh`
- `pnpm vitest run tests/unit/ai-startup-docs.test.ts`
- `git diff --check`
## 2026-07-10 — Bump GitHub Actions off deprecated Node 20

**Completed:**
- Bumped pinned action majors in ci.yml and ui-policy.yml to clear the "Node.js 20 is deprecated" runner warning: checkout v4→v7, setup-node v4→v6, pnpm/action-setup v4→v6, cache v4→v6, upload-artifact v4→v7.
- All step inputs used are stable across these majors (no removed inputs); relying on CI to validate.

**Validation:**
- CI `Test & Build` on the PR (self-validating workflow change)

## 2026-07-10 — Repo cleanup and /repo-tidy skill

**Completed:**
- Deleted 101 stale remote branches (95 merged/closed-PR + 6 from closing stalled PRs) and ~140 local branches; pruned phantom `origin/pr/672` ref.
- Removed 20 stale worktrees and 2 orphan directories; tagged 9 scratch-branch tips as `rescue/*` (local-only) before deleting.
- Closed stalled PRs #298, #323, #328, #341, #568, #739. Rescued uncommitted work from an unattended worktree into PR #838.
- Enabled `delete_branch_on_merge` on the repo so merged PR branches self-clean.
- Added `scripts/repo-tidy.sh` (read-only hygiene report) plus `/repo-tidy` command in `.claude/commands/` and `.codex/prompts/`, and documented it in `docs/dev-workflow.md`.

**Validation:**
- `bash scripts/repo-tidy.sh` (clean run against the tidied repo)
- `pnpm test tests/unit/ai-startup-docs.test.ts` (26/26 passed)
- `pnpm lint`

## 2026-07-10 — Issue backlog triage + CONTRIBUTING "Finding work" section

**Completed:**
- Triaged 61 open issues → 46. Closed 10 delivered-by-merged-PR (#86/#87/#88/#99/#144/#418/#431/#460/#523/#417), 2 duplicates (#451→#152, #366→#362), 1 abandoned (#252), 2 out-of-direction Clerk auth (#434/#449).
- Labeled all 46 survivors (0 unlabeled): 14 bug, 29 enhancement, 4 good-first-issue, 2 needs-triage (new label).
- Added a "Finding something to work on" section to CONTRIBUTING.md pointing collaborators at label filters and noting big ideas (e.g. gamification #205) vs ad-hoc feature work.

**Validation:**
- `gh issue list` label coverage check (0 unlabeled)

## 2026-07-10 — Auto-label new issues with needs-triage

**Completed:**
- Added .github/workflows/triage-label.yml: on issue `opened`, adds `needs-triage` if the issue has zero labels (leaves template/pre-labeled issues alone).
- Dependency-free (uses pre-installed gh CLI, no pinned actions) and least-privilege (`permissions: issues: write` only, over the repo's read-only default).

**Validation:**
- YAML parse check; workflow runs only on issue events (no CI impact to validate here)
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
