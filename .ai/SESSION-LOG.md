# Pika Session Log

Rolling recent session log for AI/human handoffs. Keep this file small; full historical session history lives in `.ai/JOURNAL-ARCHIVE.md`.

**Rules:**
- Append one concise entry for meaningful work, then immediately run `node scripts/trim-session-log.mjs` in the same change.
- CI allows at most 60 entries; the trim step compacts to the latest 40 entries by default so there is headroom for future appends.
- Use `node scripts/trim-session-log.mjs --check` to verify the log is within the 60-entry cap.
- Keep enough recent entries for weekly automations to inspect roughly the last week of work.
- Use `.ai/JOURNAL-ARCHIVE.md` only for historical investigation.

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
- `bash scripts/verify-env.sh --help`
- `bash .codex/skills/pika-session-start/scripts/session_start.sh --help`
- `pnpm vitest run tests/unit/ai-startup-docs.test.ts`
- `bash .codex/skills/pika-session-start/scripts/session_start.sh --orient-only`
- `bash scripts/verify-env.sh`
- `bash .codex/skills/pika-session-start/scripts/session_start.sh`
- `git diff --check`

## 2026-06-12 — Skill progression workflow hardening

**Completed:**
- Added a new UI acceptance brief guide so non-trivial UI work records the target surface, reference, roles, viewports, themes, states, primary signal, and out-of-scope treatments before coding.
- Added schema rollout and component refactor checklists to make migration/query-shape PRs and large TSX extraction PRs declare rollout risk, fallback expectations, and shared-component boundaries up front.
- Updated AI routing, session-start, issue-worker, agent-role, UI canon, and UI verification guidance so the acceptance brief plus role/viewport/theme/state verification matrix are part of the default workflow.
- Added explicit specialist-skill trigger guidance for `product-design:get-context`, `pika-ui-verify`, `supabase:supabase-postgres-best-practices`, and `vercel:react-best-practices`.

**Validation:**
- Reviewed diffs for `docs/ai-instructions.md`, `.codex/prompts/session-start.md`, `docs/guides/ai-ui-testing.md`, `.codex/prompts/ui-verify.md`, `.codex/skills/pika-ui-verify/SKILL.md`, `docs/core/agents.md`, `docs/issue-worker.md`, and the new guidance docs.
- `node scripts/trim-session-log.mjs`
- `node scripts/trim-session-log.mjs --check`

## 2026-06-09 — Classwork action chooser pilot

**Completed:**
- Added a reusable teacher work-surface action cluster with menu and icon-menu buttons for contextual FAB-style action areas.
- Replaced the Classwork summary split button with `New Classwork` as a chooser for Assignment, Material, and Survey.
- Moved `Edit list controls` and `Edit Markdown` behind a separate icon-only `Classwork options` pencil menu.
- Renamed list management to `Organize classwork` and added `Done Organizing`.
- Aligned Tests with the same action-cluster pattern: direct `New Test`, icon-only `Test options` pencil menu, `Organize tests`, and `Done Organizing`.
- Updated the classroom list pencil control accessibility/tooltip language to `Organize classrooms`.
- Removed subtitles from the Classwork/Test dropdown menus and switched the Assignment menu icon to the Classwork `ClipboardList` icon.
- Switched the Material menu icon to Lucide `Paperclip`.
- Deferred the organize-mode jiggle animation after visual review; no jiggle code ships in this PR.
- Updated Classwork tests to exercise the new chooser/options menu semantics.
- Fixed the PR CI failure in `StudentHistoryPage.test.tsx` by waiting for the async history-loading effect before asserting class-day and entry fetch calls.
- Addressed review feedback by disabling the Classwork/Test options icon buttons in archived/read-only classrooms instead of opening dead disabled menus.
- Replaced Classwork/Test options dropdowns with direct pencil organize toggles and moved Classwork markdown editing to a separate `Code` icon button shown only while organize mode is active and markdown editing is enabled.
- Moved selected Assignment/Test edit actions out of their subshell dropdowns into direct pencil icon buttons beside the primary selected-item FABs.
- Split the selected Assignment layout control out of the AI Grade split button into a standalone cycle button showing paired pane icons (`Menu`, `Percent`, `SquareMenu`).
- Removed the visible number from the selected Assignment layout cycle button so it is icon-only.

**Validation:**
- `bash .codex/skills/pika-session-start/scripts/session_start.sh`
- `pnpm test tests/components/TeacherWorkSurfaceActionCluster.test.tsx tests/components/TeacherClassroomView.test.tsx`
- `pnpm test tests/components/TeacherClassroomView.test.tsx tests/components/TeacherWorkSurfaceActionCluster.test.tsx tests/components/SortableAssignmentCard.test.tsx tests/components/TeacherWorkItemPrimitives.test.tsx`
- `pnpm test tests/components/TeacherTestsTab.test.tsx tests/components/TeacherClassroomsIndex.test.tsx tests/components/TeacherClassroomView.test.tsx tests/components/TeacherWorkSurfaceActionCluster.test.tsx tests/components/SortableAssignmentCard.test.tsx tests/components/TeacherWorkItemPrimitives.test.tsx`
- `pnpm lint`
- `pnpm build`
- `pnpm test tests/components/StudentHistoryPage.test.tsx`
- `pnpm run test:coverage`
- `npx tsc --noEmit`
- `pnpm lint`
- `NEXT_PUBLIC_SUPABASE_URL=https://placeholder.supabase.co NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=placeholder-publishable-key SUPABASE_SECRET_KEY=placeholder-secret-key SESSION_SECRET=placeholder-session-secret-at-least-32-chars-long pnpm build`
- `pnpm test tests/components/TeacherClassroomView.test.tsx tests/components/TeacherTestsTab.test.tsx`
- `npx tsc --noEmit`
- `pnpm lint`
- `bash .codex/skills/pika-ui-verify/scripts/ui_verify.sh 'classrooms/e80aa794-e2d6-4705-9da5-d08ab0fba861?tab=assignments'`
- `bash .codex/skills/pika-ui-verify/scripts/ui_verify.sh 'classrooms/e80aa794-e2d6-4705-9da5-d08ab0fba861?tab=tests'`
- `pnpm test tests/components/TeacherClassroomView.test.tsx tests/components/TeacherWorkSurfaceActionCluster.test.tsx`
- `pnpm test tests/components/TeacherClassroomView.test.tsx tests/components/TeacherTestsTab.test.tsx tests/components/TeacherWorkSurfaceActionCluster.test.tsx`
- `npx tsc --noEmit`
- `pnpm lint`
- `bash .codex/skills/pika-ui-verify/scripts/ui_verify.sh 'classrooms/e80aa794-e2d6-4705-9da5-d08ab0fba861?tab=assignments'`
- `bash .codex/skills/pika-ui-verify/scripts/ui_verify.sh 'classrooms/e80aa794-e2d6-4705-9da5-d08ab0fba861?tab=tests'`
- Playwright screenshot: active Classwork organize mode with pencil toggle selected and Markdown code button visible.
- Playwright screenshots: teacher/student/mobile Classwork verify flow, Classwork pencil menu/organize mode, Tests pencil menu/organize mode, classroom list organize mode, and mobile Tests/classroom organize states.
- Playwright screenshots confirmed compact no-subtitle Classwork and Tests dropdown menus.
- Playwright screenshot confirmed the Classwork menu renders the Material paperclip icon.
- `pnpm test tests/components/TeacherClassroomView.test.tsx tests/components/TeacherTestsTab.test.tsx tests/components/TeacherWorkSurfaceActionCluster.test.tsx`
- `npx tsc --noEmit`
- `pnpm lint`
- `E2E_BASE_URL=http://localhost:3100 bash .codex/skills/pika-ui-verify/scripts/ui_verify.sh 'classrooms/e80aa794-e2d6-4705-9da5-d08ab0fba861?tab=assignments&assignmentId=71f8b37f-831b-4e90-89f9-f04981a97d6a&assignmentStudentId=d8f8a040-c511-4da2-98a8-be5bca37e1a6'`
- `E2E_BASE_URL=http://localhost:3100 bash .codex/skills/pika-ui-verify/scripts/ui_verify.sh 'classrooms/e80aa794-e2d6-4705-9da5-d08ab0fba861?tab=tests&testId=91d01b50-807d-43ac-a5db-018c9645ac94&testMode=grading'`
- Playwright screenshots confirmed selected Assignment/Test subshell action areas show a separate pencil edit button beside the primary split FAB on desktop and mobile.
- `pnpm test tests/components/TeacherClassroomView.test.tsx tests/components/TeacherWorkSurfaceActionCluster.test.tsx`
- `npx tsc --noEmit`
- `pnpm lint`
- `E2E_BASE_URL=http://localhost:3100 bash .codex/skills/pika-ui-verify/scripts/ui_verify.sh 'classrooms/e80aa794-e2d6-4705-9da5-d08ab0fba861?tab=assignments&assignmentId=71f8b37f-831b-4e90-89f9-f04981a97d6a&assignmentStudentId=d8f8a040-c511-4da2-98a8-be5bca37e1a6'`
- Playwright screenshots confirmed the selected Assignment layout cycle button renders the students+grading and content+grading icon pairs cleanly on desktop/mobile.
- `pnpm test tests/components/TeacherClassroomView.test.tsx tests/components/TeacherWorkSurfaceActionCluster.test.tsx`
- `npx tsc --noEmit`
- `pnpm lint`
- Playwright screenshot confirmed the selected Assignment layout cycle button has no visible number/index label.

## 2026-06-12 — Assignment Layout Tooltip Copy

- Changed the selected Assignment layout cycle tooltip to the concise copy `Toggle Layout`.
- Left the accessible button label unchanged so screen reader users still hear the current layout context.
- Verified with `bash scripts/verify-env.sh`, `pnpm exec tsc --noEmit --pretty false`, and `pnpm test tests/components/TeacherClassroomView.test.tsx`.
- Playwright hover screenshot confirmed the tooltip renders exactly `Toggle Layout` and the previous dynamic `Layout: … Next: …` copy is gone.

## 2026-06-12 — Action Cluster PR Rebase

- Rebased `codex/action-cluster-classwork` onto `origin/main` and resolved the `TeacherTestsTab.test.tsx` helper import conflict by keeping `createMockTest` plus the branch's `Classroom` typing.
- Verified the rebased branch with `pnpm test tests/components/TeacherClassroomView.test.tsx tests/components/TeacherWorkSurfaceActionCluster.test.tsx tests/components/TeacherTestsTab.test.tsx` and `pnpm exec tsc --noEmit --pretty false`.

## 2026-06-13 — Weekly Simplification: Test Response Normalization

- Selected the student test-taking response normalization path in `src/lib/test-attempts.ts` as the hotspot because it handled several legacy payload shapes with duplicated coercion branches used by both form and API routes.
- Refactored the parser into explicit typed and legacy coercion helpers without changing behavior, and added unit coverage for fallback object shapes, CRLF normalization, and required non-blank open responses.
- Verified with `bash scripts/verify-env.sh` and `pnpm test` (full Vitest suite: 302 files, 2671 tests).
- PR: https://github.com/codepetca/pika/pull/779

## 2026-06-12 — Legacy quiz API compatibility contract helper

**Completed:**
- Created `codex/legacy-quiz-contract-compat` from current `origin/main`.
- Inventoried remaining `quiz` / `quizzes` references and separated persisted/database contracts from active Tests API compatibility aliases.
- Added `src/lib/test-api-contract.ts` to centralize the active Tests API `{ test, quiz }` and `{ tests, quizzes }` compatibility payloads.
- Updated student and teacher Tests API routes to use the shared compatibility helper without changing response shape.
- Added canonical `assessment` success data to `src/lib/server/assessments.ts` while preserving the legacy `quiz` alias.
- Trimmed redundant `docs/ai-instructions.md` wording after the rebased `origin/main` startup-doc changes exceeded the enforced default startup context budget.
- Did not touch production schema, migrations, RPCs, storage paths, gradebook contracts, course blueprint contracts, or DB-shaped `quiz_id` fields.

**Validation:**
- `bash .codex/skills/pika-session-start/scripts/session_start.sh`
- `pnpm vitest run tests/lib/test-api-contract.test.ts tests/unit/server-access.test.ts tests/api/teacher/tests-route.test.ts tests/api/teacher/tests-id-route.test.ts tests/api/teacher/tests-results.test.ts tests/api/student/tests-route.test.ts tests/api/student/tests-id.test.ts tests/api/student/tests-results.test.ts tests/api/student/tests-session-status.test.ts`
- `pnpm exec tsc --noEmit`
- `pnpm lint`
- `pnpm vitest run tests/unit/ai-startup-docs.test.ts tests/unit/ui-guidance-docs.test.ts`
- `pnpm test` (303 files / 2672 tests)
- `git diff --check`

## 2026-06-13 — Legacy quiz client response readers

**Completed:**
- Created `codex/legacy-quiz-client-readers` from current `origin/main`.
- Added `readTestFromPayload` and `readTestsFromPayload` to `src/lib/test-api-contract.ts` so active client code reads current Tests API keys first and legacy quiz keys only as compatibility fallback.
- Replaced scattered `data.test ?? data.quiz` and `data.tests || data.quizzes || []` reads in teacher/student Tests UI, test document sync flows, the teacher preview page, and the assessment URL-state e2e helper.
- Expanded `tests/lib/test-api-contract.test.ts` to cover current-key preference, legacy fallback, and empty payload behavior.
- Did not change server payloads, schema, migrations, RPCs, storage paths, gradebook contracts, course blueprint contracts, or DB-shaped `quiz_id` fields.

**Validation:**
- `bash .codex/skills/pika-session-start/scripts/session_start.sh`
- `pnpm vitest run tests/lib/test-api-contract.test.ts tests/components/TeacherTestsTab.test.tsx tests/components/StudentTestsTab.test.tsx tests/components/TestDetailPanel.test.tsx tests/components/StudentTestForm.test.tsx tests/components/StudentTestResults.test.tsx`
- `pnpm exec tsc --noEmit`
- `pnpm lint`
- `pnpm test` (303 files / 2676 tests)
- `git diff --check`

## 2026-06-13 — Student Today stale classroom load guard

**Completed:**
- Reestablished the systems/UI audit goal and continued the active client freshness slice.
- Guarded `StudentTodayTab` entry and lesson-plan async responses by request id and classroom id so late responses from a previous classroom cannot overwrite the current classroom view.
- Passed the loaded classroom id through `onLessonPlanLoad` and made `ClassroomPageClient` ignore stale lesson-plan updates.
- Added regression coverage for switching from classroom A to classroom B before classroom A's entries and lesson plan resolve.
- Updated the adjacent `ClassroomPageClientAssignmentsEditMode` mock to use the new lesson-plan callback contract.
- Addressed subagent PR review feedback by storing the Today sidebar lesson plan with its classroom id so classroom route changes synchronously hide stale previous-classroom plan content.
- Added parent-level regression coverage for clearing the Student Today sidebar plan when the classroom route changes.

**Validation:**
- `bash .codex/skills/pika-session-start/scripts/session_start.sh`
- `pnpm vitest run tests/components/StudentTodayTabHistory.test.tsx`
- `pnpm vitest run tests/components/ClassroomPageClientAssignmentsEditMode.test.tsx`
- `pnpm vitest run tests/components/StudentTodayTabHistory.test.tsx tests/components/ClassroomPageClientAssignmentsEditMode.test.tsx`
- `git diff --check`
- `pnpm lint`
- `bash .codex/skills/pika-audit/scripts/audit.sh`
- `pnpm build`
- `pnpm vitest run --sequence.concurrent=false` (303 files / 2673 tests)
- Subagent PR review found one P2 stale sidebar display gap.
- `pnpm vitest run tests/components/StudentTodayTabHistory.test.tsx tests/components/ClassroomPageClientAssignmentsEditMode.test.tsx` (after review fix; 32 tests)
- `git diff --check`
- `pnpm lint`
- `bash .codex/skills/pika-audit/scripts/audit.sh`
- `pnpm build`
- `pnpm vitest run --sequence.concurrent=false` (303 files / 2674 tests)

## 2026-06-13 — Legacy quiz type contract cleanup

**Completed:**
- Inverted the shared assessment type definitions so active `TestAssessment*`, `StudentTest*`, and `TestFocus*` names are canonical in `src/types/index.ts`.
- Kept legacy `Quiz*` type exports as compatibility aliases/interfaces for DB-shaped and older contract code.
- Updated assessment utilities and server access helpers to consume canonical Test/Assessment type names while preserving legacy exports and response shapes.
- Moved the active TeacherTestsTab component test from `QuizWithStats` to `TestAssessmentWithStats`.

**Validation:**
- `bash .codex/skills/pika-session-start/scripts/session_start.sh`
- `pnpm exec tsc --noEmit`
- `pnpm lint`
- `pnpm test tests/unit/assessments.test.ts tests/lib/assessments.test.ts tests/lib/test-api-contract.test.ts tests/components/TeacherTestsTab.test.tsx`
- `pnpm test` (303 files / 2678 tests)
- `git diff --check`

## 2026-06-13 — Teacher lesson calendar stale classroom load guard

**Completed:**
- Continued the systems/UI audit client freshness track after PR #780.
- Guarded teacher lesson calendar lesson-plan, assignment, announcement, and markdown async loads so late responses from a previous classroom cannot update the current classroom view.
- Tagged loaded lesson plans, assignments, and announcements with the classroom id they belong to, so previously loaded classroom data is hidden while the next classroom loads.
- Added regression coverage for both late stale responses after a classroom change and immediate hiding of previous-classroom data while the next classroom is pending.
- Addressed subagent PR review feedback by clearing/reloading open markdown sidebar content when the classroom changes and blocking saves while markdown content is not associated with the current classroom.
- Guarded late autosave PUT responses before they can retag or mutate visible lesson-plan state after the teacher switches classrooms.

**Validation:**
- `bash .codex/skills/pika-session-start/scripts/session_start.sh`
- `pnpm vitest run tests/components/TeacherLessonCalendarTab.test.tsx`
- `git diff --check`
- `pnpm lint`
- `bash .codex/skills/pika-audit/scripts/audit.sh`
- `pnpm build`
- `pnpm vitest run --sequence.concurrent=false` (303 files / 2682 tests)
- Subagent PR review found stale open-sidebar markdown and late autosave response gaps.
- `pnpm vitest run tests/components/TeacherLessonCalendarTab.test.tsx` (after review fixes; 8 tests)
- `git diff --check`
- `pnpm lint`
- `bash .codex/skills/pika-audit/scripts/audit.sh`
- `pnpm build`
- `pnpm vitest run --sequence.concurrent=false` (303 files / 2684 tests)

## 2026-06-13 — Legacy quiz server draft helper names

**Completed:**
- Added assessment-named primary draft helpers in `src/lib/server/assessment-drafts.ts`: `AssessmentDraftContent`, `AssessmentDraftQuestion`, `validateAssessmentDraftContent`, `buildAssessmentDraftContentFromRows`, and `syncAssessmentQuestionsFromDraft`.
- Kept legacy `QuizDraft*`, `validateQuizDraftContent`, `buildQuizDraftContentFromRows`, and `syncQuizQuestionsFromDraft` exports as compatibility aliases.
- Updated internal markdown/course-blueprint typing and assessment draft unit tests to prefer assessment-named helpers.
- Did not change database tables, persisted `quiz_id` fields, route payload shapes, migrations, RPCs, or storage paths.

**Validation:**
- `bash .codex/skills/pika-session-start/scripts/session_start.sh`
- `pnpm exec tsc --noEmit`
- `pnpm test tests/unit/assessment-drafts.test.ts tests/lib/quiz-markdown.test.ts tests/lib/server/course-blueprints.test.ts tests/lib/server/course-sites.test.ts`
- `pnpm lint`
- `git diff --check`

## 2026-06-13 — Legacy quiz markdown helper aliases

**Completed:**
- Added assessment-named markdown helper exports in `src/lib/quiz-markdown.ts`: `assessmentToMarkdown`, `markdownToAssessment`, and `AssessmentMarkdown*` types.
- Kept `quizToMarkdown`, `markdownToQuiz`, and `QuizMarkdown*` exports as compatibility aliases.
- Updated active `TestDetailPanel` markdown editing code to import and call the assessment-named helpers.
- Expanded markdown unit coverage for the new helper names and alias compatibility.
- Did not change markdown format text, route payloads, schema, migrations, RPCs, storage paths, or persisted `quiz_id` fields.

**Validation:**
- `bash .codex/skills/pika-session-start/scripts/session_start.sh`
- `pnpm exec tsc --noEmit`
- `pnpm lint`
- `pnpm test tests/lib/quiz-markdown.test.ts tests/components/TestDetailPanel.test.tsx tests/unit/assessment-drafts.test.ts`
- `git diff --check`

## 2026-06-13 — Legacy quiz assessment helper names

**Completed:**
- Added assessment-named primary helper exports in `src/lib/assessments.ts` for status labels/badges, assessment type resolution, option validation, activation checks, edit policy, and focus-summary aggregation.
- Updated `src/lib/tests.ts` to re-export test helpers from the assessment-named helpers instead of quiz-named aliases.
- Updated active internal callers in markdown parsing and assessment draft validation to import `validateAssessmentOptions`.
- Kept all legacy quiz-named helper exports as compatibility aliases and added alias coverage.
- Updated test activation validation copy from quiz wording to test wording.

**Validation:**
- `bash .codex/skills/pika-session-start/scripts/session_start.sh`
- `pnpm exec tsc --noEmit`
- `pnpm test tests/unit/assessments.test.ts tests/lib/assessments.test.ts tests/lib/quiz-markdown.test.ts tests/unit/assessment-drafts.test.ts tests/components/TestDetailPanel.test.tsx`
- `pnpm lint`
- `pnpm test`
- `git diff --check`

## 2026-06-13 — Legacy quiz grading payload reader

**Completed:**
- Normalized `TestStudentGradingPanel` results payloads into a canonical `test` field.
- Used the shared Tests API reader so current `test` payloads are preferred while legacy `quiz` payloads still work as fallback.
- Updated grading panel fixtures to use the current `test` key and added explicit legacy `quiz` fallback coverage.
- Did not change API response shapes, route contracts, schema, migrations, RPCs, storage paths, or persisted `quiz_id` fields.

**Validation:**
- `bash .codex/skills/pika-session-start/scripts/session_start.sh`
- `pnpm exec tsc --noEmit`
- `pnpm test tests/components/TestStudentGradingPanel.test.tsx tests/lib/test-api-contract.test.ts`
- `pnpm lint`
- `pnpm test`
- `git diff --check`

## 2026-06-13 — Student Tests payload type names

**Completed:**
- Renamed local `StudentTestsTab` response type aliases so current `test` and `tests` payload fields are primary.
- Collapsed duplicated session-status test/quiz summary shapes into one current `StudentTestSessionStatusSummary`.
- Kept legacy `quiz` and `quizzes` fields in the local types as documented compatibility fallbacks.
- Did not change runtime behavior, API response shapes, schema, migrations, RPCs, storage paths, or persisted `quiz_id` fields.

**Validation:**
- `bash .codex/skills/pika-session-start/scripts/session_start.sh`
- `pnpm exec tsc --noEmit`
- `pnpm test tests/components/StudentTestsTab.test.tsx tests/lib/test-api-contract.test.ts`
- `pnpm lint`
- `pnpm test`
- `git diff --check`

## 2026-06-14 — Teacher exam access lifecycle e2e

**Completed:**
- Added a focused Playwright teacher exam-mode flow covering draft test activation, opening all student access, closing all student access, and summary card open/closed access counts.
- The spec creates a single open-response draft test through existing teacher API routes, selects a seeded classroom with enrolled students, drives lifecycle transitions through the teacher grading workspace UI, and deletes its test record in cleanup.
- Risk profile: exam-mode.
- Model recommendation: GPT-5 Codex - e2e coverage task with repo-specific Playwright and API setup.

**Validation:**
- `bash scripts/verify-env.sh`
- `pnpm exec playwright test e2e/teacher-exam-mode.spec.ts --project=chromium-desktop`
- `pnpm lint`

## 2026-06-14 — Legacy quiz server access names

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
