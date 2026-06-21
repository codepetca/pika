# Pika Session Log

Rolling recent session log for AI/human handoffs. Keep this file small; full historical session history lives in `.ai/JOURNAL-ARCHIVE.md`.

**Rules:**
- Append one concise entry for meaningful work, then immediately run `node scripts/trim-session-log.mjs` in the same change.
- CI allows at most 60 entries; the trim step compacts to the latest 40 entries by default so there is headroom for future appends.
- Use `node scripts/trim-session-log.mjs --check` to verify the log is within the 60-entry cap.
- Keep enough recent entries for weekly automations to inspect roughly the last week of work.
- Use `.ai/JOURNAL-ARCHIVE.md` only for historical investigation.

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
