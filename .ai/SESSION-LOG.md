# Pika Session Log

Rolling recent session log for AI/human handoffs. Keep this file small; full historical session history lives in `.ai/JOURNAL-ARCHIVE.md`.

**Rules:**
- Append one concise entry for meaningful work at the end of a session.
- Run `node scripts/trim-session-log.mjs` after appending to keep only the latest 60 entries.
- Keep enough recent entries for weekly automations to inspect roughly the last week of work.
- Use `.ai/JOURNAL-ARCHIVE.md` only for historical investigation.

## 2026-05-27 — Phase two systems and UI audit fixes

**Completed:**
- Blocked teacher entry detail reads across classroom ownership boundaries.
- Gated snapshot list/file APIs behind the UI gallery flag plus authentication, and marked them dynamic.
- Made student notification active-test counts respect selected-student availability and grading closure.
- Required archived-classroom ownership checks for test AI grading run ticks.
- Removed the roster tab's dead global right-sidebar route and aligned selected-student email actions with the gradebook pattern.
- Updated focused API/component coverage for each fixed audit finding.

**Validation:**
- `bash .codex/skills/pika-session-start/scripts/session_start.sh`
- `pnpm test tests/api/teacher/entry-id.test.ts`
- `pnpm test tests/api/snapshots-list.test.ts tests/api/snapshots-filename.test.ts`
- `pnpm test tests/api/teacher/test-auto-grade-runs.test.ts tests/api/student/notifications.test.ts tests/components/TeacherRosterTab.test.tsx tests/unit/layout-config.test.ts`
- `pnpm test tests/components/ThreePanelProvider.test.tsx tests/unit/layout-config.test.ts`
- `pnpm lint`
- `pnpm test`
- `pnpm build`
- `bash .codex/skills/pika-ui-verify/scripts/ui_verify.sh 'classrooms/e80aa794-e2d6-4705-9da5-d08ab0fba861?tab=roster'`
- Browser selected-row screenshots: `/tmp/pika-roster-selected-desktop.png`, `/tmp/pika-roster-selected-mobile.png`, `/tmp/pika-roster-selected-email-menu-desktop.png`, `/tmp/pika-roster-selected-email-menu-mobile.png`

## 2026-05-27 — Phase three audit fixes

**Completed:**
- Added shared selected-student enrollment validation for teacher test mutation routes.
- Blocked test AI auto-grade run creation and open-response grade clearing when any selected student is outside the test classroom.
- Normalized teacher settings controls toward `@/ui` primitives: shared segmented section switcher, cards, `FormField`, `Input`, `Select`, and a FormField-compatible textarea.
- Fixed the syllabus lesson-plan visibility select's accessible label and added settings switcher coverage.

**Validation:**
- `bash .codex/skills/pika-session-start/scripts/session_start.sh`
- `pnpm test tests/components/TeacherSettingsTab.test.tsx tests/api/teacher/tests-auto-grade.test.ts tests/api/teacher/tests-clear-open-grades.test.ts tests/unit/test-student-access.test.ts`
- `pnpm lint`
- `bash .codex/skills/pika-ui-verify/scripts/ui_verify.sh 'classrooms/e80aa794-e2d6-4705-9da5-d08ab0fba861?tab=settings&section=general'`
- Browser screenshots: `/tmp/pika-settings-general-full-desktop.png`, `/tmp/pika-settings-general-full-mobile.png`, `/tmp/pika-settings-class-days-desktop.png`, `/tmp/pika-settings-class-days-mobile.png`, `/tmp/pika-settings-general-dark-desktop.png`
- `pnpm test tests/api/teacher/tests-auto-grade.test.ts tests/api/teacher/tests-clear-open-grades.test.ts tests/unit/test-student-access.test.ts`
- `pnpm build`
- `pnpm test tests/components/TeacherStudentWorkPanel.test.tsx`
- `pnpm test`

## 2026-05-27 — Daily log history selected date clarity

**Completed:**
- Changed the teacher Daily student-log inspector to keep entries in newest-first chronological order instead of pinning the selected entry above newer logs.
- Highlighted the selected date in place with a selected-card treatment and bold date label.
- Added an in-order highlighted `No log for this date.` row for selected dates without a student log.
- Added focused component coverage for chronological selected entries, empty selected dates, and removal of the old `Selected date -` label.

**Validation:**
- `bash .codex/skills/pika-session-start/scripts/session_start.sh`
- `pnpm test tests/components/StudentLogHistory.test.tsx tests/components/TeacherAttendanceTab.test.tsx`
- `pnpm lint`
- `pnpm test`
- `pnpm test tests/unit/ai-startup-docs.test.ts`
- `git diff --check`
- `pnpm build`
- `bash .codex/skills/pika-ui-verify/scripts/ui_verify.sh 'classrooms/e80aa794-e2d6-4705-9da5-d08ab0fba861?tab=attendance'`
- Browser screenshots: `/tmp/pika-teacher-daily-selected-history.png`, `/tmp/pika-teacher-daily-empty-selected-history.png`

## 2026-05-27 — Phase four audit fixes

**Completed:**
- Added selected-student classroom enrollment validation to the teacher test return route before availability checks, finalization, response reads, or the return RPC.
- Scoped teacher test result aggregation and open-response stats to currently enrolled classroom students.
- Normalized the shared feedback dialog to use `@/ui` primitives for the dialog import, category segmented control, and submit button.
- Updated focused API and integration coverage for selected test return/results enrollment scoping.

**Validation:**
- `bash .codex/skills/pika-session-start/scripts/session_start.sh`
- `pnpm test tests/api/teacher/tests-return.test.ts tests/api/teacher/tests-results.test.ts`
- `pnpm test tests/api/integration/test-return-visibility-flow.test.ts`
- `pnpm lint`
- `bash .codex/skills/pika-ui-verify/scripts/ui_verify.sh classrooms`
- Feedback dialog screenshots: `/tmp/pika-feedback-teacher-desktop-light-idle.png`, `/tmp/pika-feedback-teacher-desktop-light-error.png`, `/tmp/pika-feedback-teacher-desktop-light-submitting.png`, `/tmp/pika-feedback-teacher-desktop-light-success.png`, `/tmp/pika-feedback-teacher-mobile-dark-idle.png`, `/tmp/pika-feedback-student-desktop-dark-idle.png`, `/tmp/pika-feedback-student-mobile-light-error.png`
- `pnpm test`
- `pnpm build`

## 2026-05-27 — Test results enrolled response query

**Completed:**
- Loaded classroom enrollments before teacher test response reads.
- Scoped the service-role `test_responses` query to current classroom `student_id`s and skipped the query when no students are enrolled.
- Kept the defensive in-memory response filter and updated route coverage to assert the scoped response query.

**Validation:**
- `bash .codex/skills/pika-session-start/scripts/session_start.sh`
- `pnpm vitest run tests/api/teacher/tests-results.test.ts`
- `pnpm vitest run tests/api/teacher/tests-results.test.ts tests/api/integration/test-return-visibility-flow.test.ts`
- `pnpm lint`
- `pnpm build`
- `pnpm test`

## 2026-05-27 — Required submission artifact display

**Completed:**
- Preserved structured required-submission artifacts as first-class teacher table items before adding free-floating content artifacts.
- Added requirement title/metadata to teacher artifact display objects so student detail cards show labels like `Published demo` instead of generic `Public link`.
- Highlighted required-submission artifact pills/cards and kept ordinary content-extracted artifacts visually regular.
- Added regression coverage for multi-artifact teacher rows, required-submission labels, and student detail artifact titles.

**Validation:**
- `bash .codex/skills/pika-session-start/scripts/session_start.sh`
- `pnpm test tests/lib/assignment-submission-requirements.test.ts tests/api/teacher/assignments-id.test.ts tests/components/AssignmentArtifactsCell.test.tsx tests/components/TeacherStudentWorkPanel.test.tsx -- --testTimeout=10000`
- `pnpm test tests/components/AssignmentArtifactsCell.test.tsx tests/components/TeacherStudentWorkPanel.test.tsx -- --testTimeout=10000`
- `pnpm lint`
- `pnpm test`
- `bash .codex/skills/pika-ui-verify/scripts/ui_verify.sh 'classrooms/e80aa794-e2d6-4705-9da5-d08ab0fba861?tab=assignments&assignmentId=34d744b5-2644-4ca1-baf2-e86270d0590a&assignmentStudentId=d8f8a040-c511-4da2-98a8-be5bca37e1a6'`
- Browser screenshots: `/tmp/pika-teacher-details-artifacts.png`, `/tmp/pika-student-loaded.png`, `/tmp/pika-teacher-mobile.png`

## 2026-05-27 — Next systems/UI audit slice

**Completed:**
- Hardened student test document snapshot access to respect draft status, selected-student availability, submitted work, grading lock state, and returned work.
- Scoped student test result aggregates to currently enrolled students whose attempts have been returned.
- Kept returned assignment grade/feedback fields visible while stripping teacher-only draft feedback and AI suggestion fields.
- Added accessible names for student survey link/text responses, student open-response test answers, and teacher announcement body textareas.

**Validation:**
- `bash .codex/skills/pika-session-start/scripts/session_start.sh`
- `pnpm vitest run tests/api/student/tests-documents-snapshot.test.ts tests/api/student/tests-results.test.ts tests/unit/assignments.test.ts tests/api/student/assignments.test.ts tests/components/StudentSurveyPanel.test.tsx tests/components/StudentQuizForm.test.tsx tests/components/AnnouncementsMarkdown.test.tsx`
- `pnpm vitest run tests/api/integration/test-return-visibility-flow.test.ts --reporter=verbose`
- `pnpm lint`
- `pnpm build`
- `bash .codex/skills/pika-ui-verify/scripts/ui_verify.sh 'classrooms/e80aa794-e2d6-4705-9da5-d08ab0fba861?tab=announcements'`
- `bash .codex/skills/pika-ui-verify/scripts/ui_verify.sh 'classrooms/e80aa794-e2d6-4705-9da5-d08ab0fba861?tab=assignments'`
- `bash .codex/skills/pika-ui-verify/scripts/ui_verify.sh 'classrooms/e80aa794-e2d6-4705-9da5-d08ab0fba861?tab=tests'`
- UI screenshots reviewed from `/tmp/pika-teacher.png`, `/tmp/pika-student.png`, and `/tmp/pika-teacher-mobile.png` for each tab run.
- `pnpm test`
- `bash scripts/verify-env.sh`

## 2026-05-27 — Student quiz/survey result enrollment scoping

**Completed:**
- Scoped student quiz result aggregates to current classroom enrollments before aggregating class responses.
- Scoped student survey result aggregates and text/link response lists to current classroom enrollments.
- Kept defensive in-memory filtering after scoped Supabase `.in('student_id', ...)` response reads.
- Added API regressions that include stale/unenrolled response rows and assert enrolled-only result payloads.

**Validation:**
- `bash .codex/skills/pika-session-start/scripts/session_start.sh`
- `pnpm vitest run tests/api/student/quizzes-results.test.ts tests/api/student/surveys-route.test.ts --reporter=verbose`
- `pnpm lint`
- `pnpm build`
- `pnpm test`
- `git diff --check`

## 2026-05-27 — Assessment authoring accessibility audit

**Completed:**
- Added accessible names for quiz/test question prompts, options, answer keys, sample solutions, correct-answer radios, remove buttons, markdown editors, and quiz delete controls.
- Replaced the assessment workspace mode strip with the shared tab-style `TeacherWorkSurfaceModeBar`.
- Wired the shared mode bar tabs to labelled `tabpanel` content after PR review flagged the incomplete ARIA tab pattern.
- Fixed a narrow mobile overlap in the test question accordion header after visual review.
- Added focused component coverage for mode tab semantics and authoring control names.

**Validation:**
- `bash .codex/skills/pika-session-start/scripts/session_start.sh`
- `pnpm vitest run tests/components/QuizDetailPanel.test.tsx tests/components/TeacherSurveyWorkspace.test.tsx tests/components/TeacherWorkSurfaceModeBar.test.tsx --reporter=verbose`
- `pnpm exec tsc --noEmit --pretty false`
- `pnpm lint`
- `pnpm build`
- `pnpm test`
- `git diff --check`
- `E2E_BASE_URL=http://localhost:3015 bash .codex/skills/pika-ui-verify/scripts/ui_verify.sh 'classrooms/e80aa794-e2d6-4705-9da5-d08ab0fba861?tab=tests'`
- `E2E_BASE_URL=http://localhost:3015 bash .codex/skills/pika-ui-verify/scripts/ui_verify.sh 'classrooms/e80aa794-e2d6-4705-9da5-d08ab0fba861?tab=tests&testId=210e30d4-f085-4c86-94d3-ee14bb66fd03&testMode=authoring'`
- `E2E_BASE_URL=http://localhost:3015 bash .codex/skills/pika-ui-verify/scripts/ui_verify.sh 'classrooms/e80aa794-e2d6-4705-9da5-d08ab0fba861?tab=assignments'`
- Reviewed screenshots: `/tmp/pika-test-question-editor-teacher-fixed.png`, `/tmp/pika-test-question-editor-teacher-mobile-fixed.png`, `/tmp/pika-survey-code-editor-teacher.png`, `/tmp/pika-survey-code-editor-teacher-mobile.png`, plus teacher/student/teacher-mobile captures from the verifier.

## 2026-05-27 — Teacher assessment enrollment scoping

**Completed:**
- Scoped teacher quiz result aggregates and responder hydration to current classroom enrollments.
- Scoped teacher survey result aggregates, text/link responses, and responder hydration to current classroom enrollments.
- Scoped teacher quiz and survey list response stats to enrolled student IDs before counting respondents.
- Added paginated enrollment ID loading to avoid Supabase row-cap truncation.
- Added fail-closed enrollment/response-stat query handling and regressions with stale/unenrolled response rows.

**Validation:**
- `bash .codex/skills/pika-session-start/scripts/session_start.sh`
- `pnpm vitest run tests/api/teacher/quizzes-results.test.ts tests/api/teacher/quizzes-route.test.ts tests/api/teacher/surveys-route.test.ts tests/api/teacher/surveys-results.test.ts --reporter=verbose`
- `pnpm exec tsc --noEmit --pretty false`
- `pnpm lint`
- `pnpm run test:coverage`
- `pnpm build`
- `git diff --check`

## 2026-05-27 — Assignment return enrollment validation

**Completed:**
- Validated selected student enrollment before loading or mutating assignment return docs.
- Skipped assignment doc reads/updates for selected students who are no longer enrolled.
- Preserved unavailable-student response semantics while adding explicit not-enrolled counts and ids.
- Added regressions for enrollment query failures, fully unenrolled selections, and stale existing assignment docs.

**Validation:**
- `bash .codex/skills/pika-session-start/scripts/session_start.sh`
- `pnpm vitest run tests/api/teacher/assignments-id-return.test.ts --reporter=verbose`
- `pnpm exec tsc --noEmit --pretty false`
- `pnpm lint`
- `pnpm run test:coverage`
- `pnpm build`
- `git diff --check`

## 2026-05-27 — Assignment repo target enrollment validation

**Completed:**
- Validated current classroom enrollment before teacher repo-target override reads, deletes, or saves.
- Failed closed on enrollment query errors and returned the existing not-enrolled bad request for stale students.
- Added API coverage for unenrolled overrides, enrollment query failures, enrolled override saves, and override resets.

**Validation:**
- `bash .codex/skills/pika-session-start/scripts/session_start.sh`
- `pnpm vitest run tests/api/teacher/assignments-repo-targets-studentId.test.ts tests/api/teacher/assignments-artifact-repo-run.test.ts --reporter=verbose`
- `pnpm exec tsc --noEmit --pretty false`
- `pnpm lint`
- `pnpm run test:coverage`
- `pnpm build`
- `git diff --check`

## 2026-05-27 — Test response enrollment validation

**Completed:**
- Validated the response student remains enrolled before teacher response grading updates.
- Validated the response student remains enrolled before manual AI grade suggestions or reference-cache writes.
- Bound response grade updates to the validated `student_id` as well as response and test ids.
- Added API regressions for stale response students and enrollment validation failures in both routes.

**Validation:**
- `bash .codex/skills/pika-session-start/scripts/session_start.sh`
- `pnpm vitest run tests/api/teacher/tests-responses-grade.test.ts tests/api/teacher/tests-ai-suggest.test.ts --reporter=verbose`
- `pnpm exec tsc --noEmit --pretty false`
- `pnpm lint`
- `pnpm run test:coverage`
- `pnpm build`
- `git diff --check`

## 2026-05-27 — Required submission highlight polish

**Completed:**
- Removed the visible `R` marker from required-submission artifact pills in the teacher assignment student table.
- Kept required artifact pills/cards blue without the primary outline treatment, including a stronger full-pill fill in the teacher student table.
- Renamed the student work content section from `Submitted artifacts` to `Required submissions`.
- Removed per-card `Required submission`/`Optional submission` labels from the content area and added dashed missing cards for unmet required submissions.

**Validation:**
- `bash .codex/skills/pika-session-start/scripts/session_start.sh`
- `pnpm test tests/components/AssignmentArtifactsCell.test.tsx tests/components/TeacherStudentWorkPanel.test.tsx`
- `pnpm test tests/components/AssignmentArtifactsCell.test.tsx`
- `pnpm lint`
- `bash .codex/skills/pika-ui-verify/scripts/ui_verify.sh 'classrooms/e80aa794-e2d6-4705-9da5-d08ab0fba861?tab=assignments&assignmentId=4ff75b59-3189-4240-ac5a-dd3e750467bf&assignmentStudentId=d8f8a040-c511-4da2-98a8-be5bca37e1a6'`
- Screenshots reviewed: `/tmp/pika-teacher-ready.png`, `/tmp/pika-teacher-content.png`, `/tmp/pika-teacher-content-mobile.png`, `/tmp/pika-student.png`, `/tmp/pika-pr671-required-pill-table.png`

## 2026-05-27 — Test focus telemetry selected access validation

**Completed:**
- Added selected-student availability validation before student test focus telemetry response reads or inserts.
- Blocked focus telemetry when a teacher has closed access for the selected student, while preserving legacy behavior if the availability table is absent.
- Allowed focus telemetry when a student-specific open override applies to a globally closed test.
- Added API regressions for selected access closure/open overrides, availability lookup failures, missing availability table fallback, and successful active telemetry logging.

**Validation:**
- `bash .codex/skills/pika-session-start/scripts/session_start.sh`
- `pnpm vitest run tests/api/student/tests-focus-events.test.ts --reporter=verbose`
- `pnpm exec tsc --noEmit --pretty false`
- `pnpm lint`
- `pnpm run test:coverage`
- `pnpm build`
- `git diff --check`

## 2026-05-28 — Assignment list stats enrollment scoping

**Completed:**
- Scoped teacher assignment list stats to currently enrolled classroom students.
- Reused `getClassroomStudentIds()` for paginated enrollment ids and total student count.
- Bulk-loaded assignment docs by assignment ids and enrolled student ids, chunking large `.in()` filters to avoid oversized PostgREST URLs while preserving the `teacher_cleared_at` missing-column fallback.
- Added regressions for withdrawn-student docs, large-roster chunking, fallback scoping, zero-enrollment stats, and enrollment lookup failures.

**Validation:**
- `pnpm vitest run tests/api/teacher/assignments.test.ts --reporter=verbose`
- `pnpm exec tsc --noEmit --pretty false`
- `pnpm lint`
- `pnpm test -- --runInBand`
- `pnpm build`
- `pnpm vitest run --coverage --no-file-parallelism --reporter=dot`
- `git diff --check`

## 2026-05-29 — Skill progression map from PR review patterns

**Completed:**
- Reviewed recent merged PRs #665-#676 plus nearby audit-fix PRs for recurring review and self-review themes.
- Identified repeat hotspots around enrollment-scoped authorization, PostgREST query sizing/pagination, accessibility semantics, and verification depth.
- Wrote a concrete next-skill map anchored to those PR and review patterns for the automation memory.

**Validation:**
- `bash scripts/verify-env.sh` (failed only because `node_modules` is absent in this worktree)
- `gh pr list --state merged --limit 12 --json number,title,mergedAt,url,author,reviewDecision`
- `gh api graphql` against recent merged PR reviews

## 2026-05-30 — Shared enrollment and list-stat guardrails

**Completed:**
- Added shared chunked/paged Supabase row loading in [`src/lib/server/query-chunks.ts`](/Users/stew/.codex/worktrees/f558/pika/src/lib/server/query-chunks.ts) to centralize filter chunking and stable pagination.
- Added shared classroom enrollment validation in [`src/lib/server/classroom-enrollment-validation.ts`](/Users/stew/.codex/worktrees/f558/pika/src/lib/server/classroom-enrollment-validation.ts) and routed test enrollment checks through it.
- Replaced duplicated list-stat loading logic in teacher quizzes, surveys, and tests routes with the shared loader.
- Replaced duplicated classroom enrollment validation in assignment auto-grade and assignment repo-target routes with the shared validator.
- Added focused regression coverage for chunked/paged row loading and 51-student enrollment validation boundaries.

**Validation:**
- `git diff --check`
- Static readback of all touched server routes and new tests
- Full test/lint/build not run because `node_modules` is absent in this worktree

## 2026-05-30 — Accessibility and validation audit gates

**Completed:**
- Reviewed the shared guardrail refactor and found no blocking route/runtime issues on static inspection.
- Added the governed composite-widget accessibility checklist in [`docs/guidance/ui/composite-widget-accessibility.md`](/Users/stew/.codex/worktrees/f558/pika/docs/guidance/ui/composite-widget-accessibility.md).
- Wired the new checklist into the UI canon, design guidance, and audit prompt/skill docs.
- Extended the Pika audit script to flag missing changed-test coverage for risky server/runtime work and composite-widget UI work, plus emit reminder output for required validation reporting.
- Fixed one audit false positive by limiting the `manual-catch` violation to unwrapped route files instead of any wrapped route helper catch.
- Added doc/prompt regression coverage in [`tests/unit/ui-guidance-docs.test.ts`](/Users/stew/.codex/worktrees/f558/pika/tests/unit/ui-guidance-docs.test.ts).

**Validation:**
- `bash .codex/skills/pika-audit/scripts/audit.sh`
- `git diff --check`
- Full Vitest/lint/build still not run because `node_modules` is absent in this worktree

## 2026-05-30 — Validation pass completed

**Completed:**
- Installed worktree dependencies with `pnpm install --frozen-lockfile`.
- Ran focused validation for the new guardrail and guidance work.
- Fixed one over-strict unit-test expectation in [`tests/unit/query-chunks.test.ts`](/Users/stew/.codex/worktrees/f558/pika/tests/unit/query-chunks.test.ts) after confirming the loader legitimately re-applies filter chunks across pagination pages.
- Fixed one TypeScript build issue in [`src/lib/server/query-chunks.ts`](/Users/stew/.codex/worktrees/f558/pika/src/lib/server/query-chunks.ts) by adding an explicit recursive return type for the internal `visit` helper.

**Validation:**
- `pnpm install --frozen-lockfile`
- `pnpm vitest run tests/unit/query-chunks.test.ts tests/unit/classroom-enrollment-validation.test.ts tests/unit/ui-guidance-docs.test.ts tests/api/teacher/assignments-auto-grade.test.ts --reporter=verbose`
- `bash .codex/skills/pika-audit/scripts/audit.sh`
- `pnpm lint`
- `pnpm build`
- `git diff --check`

## 2026-05-30 — Path-aware audit test matching

**Completed:**
- Tightened the audit heuristic in [`audit.sh`](/Users/stew/.codex/worktrees/f558/pika/.codex/skills/pika-audit/scripts/audit.sh) so risky API changes require relevant changed tests under `tests/api` or `tests/integration`, while `src/lib/server/*` can still be satisfied by `tests/lib` or `tests/unit`.
- Kept composite-widget matching scoped to `tests/components`, `tests/ui`, or `tests/integration`.
- Added fixture-based regression tests in [`tests/unit/ai-startup-docs.test.ts`](/Users/stew/.codex/worktrees/f558/pika/tests/unit/ai-startup-docs.test.ts) proving that:
  - a risky API change plus an unrelated unit test now fails audit,
  - the same risky API change plus a relevant API test passes audit.
- Updated audit guidance assertions in [`tests/unit/ui-guidance-docs.test.ts`](/Users/stew/.codex/worktrees/f558/pika/tests/unit/ui-guidance-docs.test.ts).

**Validation:**
- `pnpm vitest run tests/unit/ai-startup-docs.test.ts tests/unit/ui-guidance-docs.test.ts --reporter=verbose`
- `bash .codex/skills/pika-audit/scripts/audit.sh`
- `git diff --check`

## 2026-05-30 — Audit message alignment

**Completed:**
- Fixed the minor audit messaging mismatch so `missing-risk-tests` now reports path-specific expectations that match the actual rule:
  - API routes mention `tests/api` / `tests/integration`
  - server modules mention `tests/api` / `tests/integration` / `tests/lib` / `tests/unit`

**Validation:**
- `pnpm vitest run tests/unit/ai-startup-docs.test.ts tests/unit/ui-guidance-docs.test.ts --reporter=verbose`
- `bash .codex/skills/pika-audit/scripts/audit.sh`
- `git diff --check`

## 2026-05-28 — Test list stats enrollment scoping

**Completed:**
- Scoped teacher test list respondent, submission, and availability stats to paginated current classroom enrollments.
- Added chunked stats loaders for test questions, attempts, responses, availability overrides, and draft overlays to avoid oversized Supabase `.in()` filters on large test lists or rosters.
- Returned a clear 500 when classroom enrollment loading fails instead of reporting empty stats.
- Applied assessment draft overlays only to draft tests so active/closed list rows match canonical test metadata.
- Added regressions for enrollment failures, current-enrollment scoping, 51x51 chunking, and stale draft overlays.

**Validation:**
- `pnpm vitest run tests/api/teacher/tests-route.test.ts --reporter=verbose`
- `pnpm exec tsc --noEmit --pretty false`
- `pnpm lint`
- `pnpm test`
- `pnpm build`
- `pnpm vitest run --coverage --no-file-parallelism --reporter=dot`
- `git diff --check`

## 2026-05-28 — Quiz list stats chunked pagination

**Completed:**
- Added chunked and paginated quiz question and response stats loading for teacher quiz lists.
- Ordered paged quiz stat reads by stable row id to prevent offset pagination skips or duplicates.
- Preserved enrolled-student scoping while preventing large quiz lists or rosters from exceeding Supabase `.in()` and default row-limit behavior.
- Chunked assessment draft overlay reads and pinned the existing active-quiz overlay behavior to match quiz detail parity.
- Returned a clear 500 when quiz question stat loading fails instead of silently reporting zero questions.
- Added regressions for stat load failures, 51x51 filter chunking, paginated stat rows, and active-list draft overlays.

**Validation:**
- `bash .codex/skills/pika-session-start/scripts/session_start.sh`
- `pnpm vitest run tests/api/teacher/quizzes-route.test.ts --reporter=verbose`
- `pnpm exec tsc --noEmit --pretty false`
- `pnpm lint`
- `pnpm test`
- `pnpm build`
- `pnpm vitest run --coverage --no-file-parallelism --reporter=dot`
- `git diff --check`

## 2026-05-28 — Survey list stats chunked pagination

**Completed:**
- Added chunked and paginated survey question and response stats loading for teacher survey lists.
- Ordered paged survey stat reads by stable row id to prevent offset pagination skips or duplicates.
- Preserved current-enrollment scoping for respondent counts while avoiding oversized Supabase `.in()` filters for large survey lists and rosters.
- Returned a clear 500 when survey question stat loading fails instead of silently reporting zero questions.
- Added regressions for missing-surveys migration fallback, base list failures, list ordering, zero-enrollment skips, stat load failures, 51x51 filter chunking, and paginated stat rows.

**Validation:**
- `bash .codex/skills/pika-session-start/scripts/session_start.sh`
- `pnpm vitest run tests/api/teacher/surveys-route.test.ts --reporter=verbose`
- `pnpm exec tsc --noEmit --pretty false`
- `pnpm lint`
- `pnpm test`
- `pnpm build`
- `pnpm vitest run --coverage --no-file-parallelism --reporter=dot`
- `git diff --check`

## 2026-05-29 — Workflow guardrails for detached HEAD and weekly evidence

**Completed:**
- Raised the default session-log retention from 20 to 60 entries and updated startup/workflow docs to preserve roughly a week of evidence for weekly automations.
- Made session-start report `detached HEAD` explicitly and updated follow-workflow plus commit/PR prompts to handle detached checkouts safely.
- Removed the stale `$PIKA_WORKTREE` assumption from the weekly Pika e2e coverage automation prompt and aligned it with `git rev-parse --show-toplevel`.
- Added workflow-doc tests for detached-HEAD wording and the larger session-log retention default.

**Validation:**
- `node scripts/trim-session-log.mjs --help`
- Detached fixture run: `bash .codex/skills/pika-session-start/scripts/session_start.sh` reported `Checkout: detached HEAD at <sha>`
- `rg -n '\$PIKA_WORKTREE|detached HEAD|latest 60 entries' .ai .claude .codex docs scripts tests /Users/stew/.codex/automations/pika-e2e-coverage-builder/automation.toml`
- `git diff --check`
- `pnpm test tests/unit/ai-startup-docs.test.ts tests/unit/trim-session-log.test.ts` could not run because this checkout is missing `node_modules` and `vitest`

## 2026-05-30 — Simplify test schema-drift error shims

**Completed:**
- Extracted shared PostgREST error text normalization for schema-drift helpers in `src/lib/server/tests.ts`.
- Added unit coverage for `details`/`hint` handling and case-insensitive matches.

**Validation:**
- `bash scripts/verify-env.sh`
- `pnpm vitest run tests/unit/server-access.test.ts tests/unit/test-student-access.test.ts`
- `pnpm test`
- `pnpm lint`

**PR:**
- https://github.com/codepetca/pika/pull/677

## 2026-05-30 — Gradebook bulk-read hardening

**Completed:**
- Added chunked and paginated loaders for teacher gradebook roster, profile, assignment doc, quiz, and test related reads.
- Scoped assignment docs to currently enrolled students at query time so withdrawn-student docs cannot consume pages or affect current gradebook data.
- Returned clear 500 responses for non-migration read failures that were previously swallowed into empty gradebook rows.
- Preserved the `assignment_docs.teacher_cleared_at` missing-column fallback and optional test-table missing-table shims.
- Added regressions for 51x51 filter chunking, >1000 related-row pagination, selected students beyond the first roster page, assignment-doc scoping, related-row failures, and migration fallbacks.
- After rebasing onto the latest `main`, updated the assignment repo-target API test harness to match the shared chunked enrollment validator query shape.
- Fixed PR review follow-up: legacy databases without `quiz_questions.correct_option` or `quiz_student_scores` now render the gradebook with quiz scoring/overrides empty instead of failing the route.

**Validation:**
- `pnpm vitest run tests/api/teacher/gradebook.test.ts --reporter=verbose`
- `pnpm vitest run tests/api/teacher/assignments-repo-targets-studentId.test.ts --reporter=verbose`
- `pnpm exec tsc --noEmit --pretty false`
- `pnpm lint`
- `pnpm test`
- `pnpm build`
- `pnpm vitest run --coverage --no-file-parallelism --reporter=dot`
- `git diff --check`

## 2026-05-30 — Quiz and survey results bulk-read hardening

**Completed:**
- Routed teacher quiz and survey result response reads through the shared chunked, paginated Supabase loader.
- Scoped result reads by assessment id and currently enrolled student ids at query time while preserving stale-row filtering as a defensive guard.
- Routed responder user/profile hydration through chunked, paginated reads and returned explicit 500s on hydration failures instead of silently dropping names or emails.
- Added stable response ordering and responder id tie-breaks.
- Added route regressions for 51-student chunking, >1000 response-row pagination, stale unenrolled rows, and responder hydration failures.

**Validation:**
- `bash .codex/skills/pika-session-start/scripts/session_start.sh`
- `pnpm vitest run tests/api/teacher/quizzes-results.test.ts --reporter=verbose`
- `pnpm vitest run tests/api/teacher/surveys-results.test.ts --reporter=verbose`
- `pnpm exec tsc --noEmit --pretty false`
- `pnpm lint`
- `pnpm test`
- `pnpm build`
- `pnpm vitest run --coverage --no-file-parallelism --reporter=dot`
- `git diff --check`

## 2026-05-30 — Test results bulk-read hardening

**Completed:**
- Routed teacher test result reads through chunked, paginated loaders for roster, responses, student availability, attempts, users, profiles, and focus events.
- Scoped test result reads by test id and currently enrolled student ids at query time while retaining defensive enrollment filtering.
- Preserved legacy `test_attempts` return-column and closure-column fallbacks, including databases that are missing both sets of columns.
- Returned explicit 500 responses for availability, user, profile, and focus-event load failures instead of silently rendering partial result data.
- Preserved exact roster totals from the paginated enrollment helper and added deterministic student tie-break ordering.
- Added route regressions for roster pagination beyond 1000 students, 51-student filter chunking, >1000 response-row pagination, availability migration fallback, attempt schema fallbacks, and hydration/focus failures.

**Validation:**
- `bash .codex/skills/pika-session-start/scripts/session_start.sh`
- `pnpm vitest run tests/api/teacher/tests-results.test.ts --reporter=verbose`
- `pnpm exec tsc --noEmit --pretty false`
- `pnpm lint`
- `pnpm test`
- `pnpm build`
- `pnpm vitest run --coverage --no-file-parallelism --reporter=dot`
- `git diff --check`

## 2026-05-30 — Attendance export bulk-read hardening

**Completed:**
- Added a shared server attendance report loader for teacher attendance and CSV export routes.
- Routed class-day, enrollment, profile, and entry reads through chunked, paginated loaders.
- Scoped attendance entry reads by classroom id and currently enrolled student ids so stale withdrawn-student entries cannot consume pages or affect exports.
- Returned explicit 500s for student profile hydration failures instead of rendering blank names after a failed read.
- Added deterministic student ordering by email with id tie-breaks.
- Added API regressions for >1000-student roster pagination, 51-student profile/entry chunking, dense entry pagination, stale-entry scoping, and profile failure handling.

**Validation:**
- `bash .codex/skills/pika-session-start/scripts/session_start.sh`
- `pnpm vitest run tests/api/teacher/attendance.test.ts tests/api/teacher/export-csv.test.ts --reporter=verbose`
- `pnpm exec tsc --noEmit --pretty false`
- `pnpm lint`
- `pnpm test`
- `pnpm build`
- `pnpm vitest run --coverage --no-file-parallelism --reporter=dot`
- `git diff --check`

## 2026-05-30 — Teacher logs bulk-read hardening

**Completed:**
- Extracted the paginated classroom roster/profile loader into a neutral server helper shared by attendance/export and teacher logs.
- Routed teacher logs roster, profile, and selected-date entry reads through chunked, paginated Supabase loaders.
- Scoped selected-date log entries by currently enrolled student ids at query time so stale withdrawn-student entries cannot consume pages or appear in teacher logs.
- Returned an explicit 500 for student profile hydration failures instead of silently rendering blank names after a failed read.
- Chunked history-preview RPC calls and bounded the missing-RPC fallback to per-student batches.
- Added API regressions for >1000-student roster pagination, 51-student profile/entry chunking, dense selected-date entry pagination, stale-entry scoping, profile failure handling, and history-preview RPC fallback.

**Validation:**
- `bash .codex/skills/pika-session-start/scripts/session_start.sh`
- `pnpm vitest run tests/api/teacher/logs.test.ts --reporter=verbose`
- `pnpm exec tsc --noEmit --pretty false`
- `pnpm lint`
- `pnpm test`
- `pnpm build`
- `pnpm vitest run --coverage --no-file-parallelism --reporter=dot`
- `git diff --check`

## 2026-05-30 — Nightly log summary bulk-read hardening

**Completed:**
- Routed nightly log-summary active-classroom discovery through paginated entry reads.
- Chunked class-day filtering for discovered classroom ids.
- Loaded per-classroom enrollments before summary entries and scoped summary entry reads to currently enrolled students.
- Paged enrollment, roster-name, and selected entry reads, and chunked student profile hydration.
- Returned skip/failure for required profile reads instead of generating summaries with incomplete redaction context.
- Added cron regressions for active-entry pagination, 51-classroom class-day chunking, scoped dense entry pagination, stale withdrawn-student exclusion, profile chunking, and profile-read failures.

**Validation:**
- `bash .codex/skills/pika-session-start/scripts/session_start.sh`
- `pnpm vitest run tests/api/cron/nightly-log-summaries.test.ts --reporter=verbose`
- `pnpm exec tsc --noEmit --pretty false`
- `pnpm lint`
- `pnpm test`
- `pnpm build`
- `pnpm vitest run --coverage --no-file-parallelism --reporter=dot`
- `git diff --check`

## 2026-05-31 — Teacher assignment detail bulk-read hardening

**Completed:**
- Routed teacher assignment detail enrollment reads through pagination.
- Chunked and paged student profile, assignment doc, doc-history, and structured submission artifact reads.
- Scoped assignment docs to currently enrolled student ids so withdrawn-student docs cannot consume pages or drive artifact/history hydration.
- Returned explicit 500s for profile, doc, history, and artifact read failures instead of rendering partial detail data.
- Added regressions for >1000-student detail pagination, 51-student chunking, stale withdrawn-student doc exclusion, dense history pagination, read-failure handling, and artifact helper chunking/pagination.
- Addressed subagent review follow-up by tightening paged-table mocks so missing filtered columns no longer pass rows through.

**Validation:**
- `bash .codex/skills/pika-session-start/scripts/session_start.sh`
- `pnpm test tests/api/teacher/assignments-id.test.ts tests/lib/assignment-submission-artifacts.test.ts tests/unit/query-chunks.test.ts -- --runInBand`
- `pnpm exec tsc --noEmit`
- `pnpm lint`
- `pnpm test`
- `pnpm build`
- `pnpm test:coverage`
- `git diff --check`

## 2026-05-31 — Student assessment results bulk-read hardening

**Completed:**
- Routed student quiz, survey, and test result question reads through paginated loaders.
- Chunked and paged classroom-scoped quiz/survey response aggregation by currently enrolled student ids.
- Chunked and paged returned-student test attempt discovery and returned test response aggregation.
- Paged current-student quiz/test response reads used for visibility, response maps, and returned test detail summaries.
- Preserved defense-in-depth filtering so stale or unenrolled student responses cannot affect aggregate result payloads.
- Returned explicit 500s for current-student response read failures instead of treating failed reads as empty work.
- Updated route and integration tests for paged Supabase mocks, dense result pagination, 51-student chunking, stale-response exclusion, and read-failure handling.

**Validation:**
- `pnpm test tests/api/student/quizzes-results.test.ts tests/api/student/surveys-route.test.ts tests/api/student/tests-results.test.ts -- --runInBand`
- `pnpm test tests/api/integration/test-return-visibility-flow.test.ts -- --runInBand`
- `pnpm exec tsc --noEmit`
- `pnpm lint`
- `pnpm test`
- `pnpm build`
- `git diff --check`

## 2026-05-31 — Student notification count hardening

**Completed:**
- Routed student notification assignment, assignment-doc, test, response, attempt, selected-access, announcement, and announcement-read queries through paginated or chunked Supabase reads.
- Scoped dense notification child reads by current student/user ids so stale same-id rows for other users cannot affect counts.
- Counted returned assignment feedback as unread when return timestamps are newer than the student's last view, and refreshed `viewed_at` when the returned work is opened.
- Counted closed tests reopened for the selected student by loading active and closed test candidates and passing the real status into effective-access checks.
- Changed student test submission notifications to decrement one active-test notification instead of clearing all active-test notifications.
- Added regressions for dense pagination/chunking, wrong-user scoping, returned-feedback notifications, reopened closed tests, child-read failures, and client decrement semantics.
- Addressed subagent review follow-up by making the reopened-closed-test regression use the filter-aware paged mock and assert the `status in (active, closed)` query.

**Validation:**
- `bash .codex/skills/pika-session-start/scripts/session_start.sh`
- `pnpm test tests/api/student/notifications.test.ts tests/api/assignment-docs/assignment-docs-id.test.ts tests/components/StudentNotificationsProvider.test.tsx -- --runInBand`
- `pnpm test tests/components/StudentQuizzesTab.test.tsx -- --runInBand`
- `pnpm test tests/api/student/notifications.test.ts -- --runInBand`
- `pnpm exec tsc --noEmit`
- `pnpm lint`
- `pnpm test`
- `pnpm build`
- `pnpm test:coverage`
- `git diff --check`

## 2026-05-31 — History cleanup cron hardening

**Completed:**
- Scheduled `/api/cron/cleanup-history` as a daily repo-managed Vercel cron and documented both current cron schedules.
- Routed expired-classroom, assignment, assignment-doc, test, and test-attempt discovery through paged/chunked Supabase reads.
- Kept history cleanup scoped through classrooms whose `end_date` is older than the 30-day Toronto cutoff.
- Added cleanup for `test_attempt_history` alongside existing assignment doc history cleanup.
- Preserved chunked deletes for history tables and returned explicit 500s for each read/delete failure path.
- Rebuilt cleanup cron tests with filter-aware paged mocks and regressions for dense parent chunking, child result pagination, assignmentless test cleanup, retention boundary behavior, and all read/delete errors.
- Addressed subagent review follow-ups by aligning cron configuration docs and proving child-table pagination for >1000 docs/attempts under a single parent.

**Validation:**
- `bash .codex/skills/pika-session-start/scripts/session_start.sh`
- `pnpm test tests/api/cron/cleanup-history.test.ts -- --runInBand`
- `pnpm exec tsc --noEmit`
- `pnpm lint`
- `pnpm test`
- `pnpm build`
- `pnpm test:coverage`
- `git diff --check`

## 2026-05-31 — Gradebook FAB layering consistency

**Completed:**
- Removed the teacher Gradebook action bar's local `z-[70]` floating-cluster override so it uses the shared teacher work-surface FAB layer.
- Lowered Gradebook sticky table header/body z-index tiers so table chrome remains below the shared FAB and global overlays retain priority.
- Added component coverage for the Gradebook floating cluster, table sticky layers, and settings-mode header layering.

**Validation:**
- `pnpm test tests/components/TeacherGradebookTab.test.tsx tests/components/TeacherRosterTab.test.tsx tests/components/TeacherTestsTab.test.tsx tests/components/TeacherWorkSurfaceActionBar.test.tsx tests/ui/SplitButton.test.tsx`
- `pnpm lint`
- `pnpm exec tsc --noEmit --pretty false`
- `pnpm test`
- `pnpm build`
- `git diff --check`
- `E2E_BASE_URL=http://localhost:3016 bash .codex/skills/pika-ui-verify/scripts/ui_verify.sh 'classrooms/e80aa794-e2d6-4705-9da5-d08ab0fba861?tab=gradebook'`
- Reviewed screenshots: `/tmp/pika-teacher.png`, `/tmp/pika-student.png`, `/tmp/pika-teacher-mobile.png`, `/tmp/pika-gradebook-email-menu-desktop.png`, `/tmp/pika-gradebook-email-menu-mobile.png`, `/tmp/pika-gradebook-settings-desktop.png`

## 2026-05-31 — Student survey FAB cluster consistency

**Completed:**
- Extracted the shared floating action cluster layout used by teacher work surfaces.
- Kept teacher work-surface action bars on the shared cluster through the existing wrapper.
- Routed student survey response/results actions through the shared cluster so desktop centering follows `--main-content-center-x` like other classroom FABs.
- Added component coverage for the student survey FAB layer and main-content centering class.
- Created and cleaned up a temporary active survey for visual verification.

**Validation:**
- `bash .codex/skills/pika-session-start/scripts/session_start.sh`
- `bash scripts/verify-env.sh`
- `pnpm test tests/components/StudentSurveyPanel.test.tsx tests/components/TeacherWorkSurfaceActionBar.test.tsx`
- `pnpm lint`
- `pnpm exec tsc --noEmit --pretty false`
- `pnpm test`
- `pnpm build`
- `git diff --check`
- `E2E_BASE_URL=http://localhost:3017 bash .codex/skills/pika-ui-verify/scripts/ui_verify.sh 'classrooms/e80aa794-e2d6-4705-9da5-d08ab0fba861?tab=assignments&surveyId=5fc24952-20e0-4512-93f5-8c3800826e5f'`
- Reviewed screenshots: `/tmp/pika-teacher.png`, `/tmp/pika-student.png`, `/tmp/pika-teacher-mobile.png`, `/tmp/pika-student-survey-fab-desktop.png`, `/tmp/pika-student-survey-response-form-desktop.png`, `/tmp/pika-student-survey-response-form-mobile.png`

## 2026-05-31 — Classroom bottom controls FAB consistency

**Completed:**
- Extended `FloatingActionCluster` with a bottom placement for full-width floating controls.
- Migrated the teacher classroom index edit/view bottom bar off its local fixed chrome and onto the shared floating cluster.
- Added safe-area-aware bottom placement for mobile classroom controls while preserving the existing centered desktop width.
- Added component coverage for the migrated bottom bar class contract.

**Validation:**
- `bash .codex/skills/pika-session-start/scripts/session_start.sh`
- `pnpm test tests/components/TeacherClassroomsIndex.test.tsx tests/components/TeacherWorkSurfaceActionBar.test.tsx`
- `pnpm lint`
- `pnpm exec tsc --noEmit --pretty false`
- `pnpm test`
- `pnpm build`
- `git diff --check`
- `E2E_BASE_URL=http://localhost:3018 bash .codex/skills/pika-ui-verify/scripts/ui_verify.sh classrooms`
- Reviewed screenshots: `/tmp/pika-teacher.png`, `/tmp/pika-student.png`, `/tmp/pika-teacher-mobile.png`, `/tmp/pika-classrooms-edit-desktop.png`, `/tmp/pika-classrooms-edit-mobile.png`

## 2026-05-31 — Assignment status badge consistency

**Completed:**
- Moved assignment status badge and icon helpers from raw Tailwind palette classes to semantic design tokens.
- Made the assignment badge helper own the shared pill shape so student assignment list and editor badges stay aligned.
- Added the shared status badge to the embedded student assignment editor header, which is the route students use from the assignments tab.
- Added tests that assert semantic badge/icon contracts and reject raw palette utilities.
- Used a read-only subagent audit to confirm the live editor route and screenshot path before visual verification.

**Validation:**
- `bash .codex/skills/pika-session-start/scripts/session_start.sh`
- `pnpm test tests/unit/assignments.test.ts tests/components/StudentAssignmentsTab.test.tsx tests/components/StudentAssignmentEditor.feedback-card.test.tsx`
- `pnpm lint`
- `pnpm exec tsc --noEmit --pretty false`
- `pnpm test`
- `pnpm build`
- `git diff --check`
- `E2E_BASE_URL=http://localhost:3019 pnpm e2e:auth`
- `E2E_BASE_URL=http://localhost:3019 pnpm e2e:verify assessment-ux-parity`
- Reviewed screenshots: `/tmp/pika-assignment-list-desktop.png`, `/tmp/pika-assignment-editor-desktop.png`, `/tmp/pika-assignment-list-mobile.png`, `/tmp/pika-assignment-editor-mobile.png`, `artifacts/assessment-ux-parity/student-assignments-reference.png`

## 2026-05-31 — Class-days shared loader cache

**Completed:**
- Added a shared client loader for classroom class-days backed by `fetchJSONWithCache`.
- Routed `ClassDaysProvider` and fallback `useClassDays` reads through the shared loader to dedupe concurrent consumers.
- Routed the teacher assignments summary class-days read through the same loader so non-OK class-days responses do not cache empty successes.
- Invalidated the class-days cache on explicit provider refresh, class-days update events, and teacher calendar generate/toggle mutations.
- Added latest-request guards so an older class-days response cannot overwrite state after a forced refresh.
- Added direct context/hook coverage for cache deduplication, forced refresh, stale response ordering, update-event invalidation, failed responses, and avoiding double-fetches inside the provider.

**Validation:**
- `bash .codex/skills/pika-session-start/scripts/session_start.sh`
- `pnpm test tests/contexts/ClassDaysContext.test.tsx tests/components/TeacherAttendanceTab.test.tsx tests/components/StudentTodayTabHistory.test.tsx tests/components/StudentLessonCalendarTab.test.tsx`
- `pnpm lint`
- `pnpm exec tsc --noEmit --pretty false`
- `pnpm test`
- `pnpm build`
- `git diff --check`

## 2026-05-31 — Student exam-mode e2e telemetry coverage

**Completed:**
- Extended the existing student exam-mode Playwright flow for sustained window loss.
- Asserted that a sustained resize records a window/full-screen exit and does not increment route-exit telemetry.
- Preserved existing checks for content locking, restoration, and open-response draft survival.

**Validation:**
- `VITEST_MAX_WORKERS=4 bash scripts/verify-env.sh`
- `E2E_BASE_URL=http://localhost:3100 pnpm exec playwright test e2e/student-exam-mode.spec.ts -g "locks content only after sustained window loss"`
- `pnpm lint`

## 2026-05-31 — PageActionBar mobile menu focus

**Completed:**
- Added explicit focus management for the shared `PageActionBar` mobile overflow menu.
- Connected the overflow trigger to its menu with `aria-controls`.
- Moved focus to the first enabled menu item on open, added arrow/Home/End menu navigation, and restored focus to the trigger on Escape, outside close, and item selection.
- Added component coverage for trigger/menu relationships, focus movement, keyboard navigation, and focus restoration.

**Validation:**
- `bash .codex/skills/pika-session-start/scripts/session_start.sh`
- `pnpm test tests/components/PageActionBar.test.tsx tests/ui/SplitButton.test.tsx`
- `pnpm lint`
- `pnpm exec tsc --noEmit --pretty false`
- `pnpm test`
- `pnpm build`
- `git diff --check`
- `E2E_BASE_URL=http://localhost:3021 bash .codex/skills/pika-ui-verify/scripts/ui_verify.sh teacher/dashboard`
- Manual Playwright mobile menu check: focus moved from `Course blueprints` to `Open classroom` with ArrowDown, Escape returned focus to `Open actions menu`, and the menu closed.
- Reviewed screenshots: `/tmp/pika-teacher.png`, `/tmp/pika-student.png`, `/tmp/pika-teacher-mobile.png`, `/tmp/pika-page-actionbar-menu-mobile-viewport.png`, `/tmp/pika-page-actionbar-menu-mobile-keyboard.png`

## 2026-05-31 — SplitButton menu focus

**Completed:**
- Hardened the shared `SplitButton` menu with focus-on-open, arrow/Home/End navigation over enabled items, and focus restoration to the opener on Escape, outside close, and item selection.
- Added semantic component coverage for disabled-item skipping, wraparound keyboard movement, Escape close behavior, and selection focus restoration.
- Addressed review follow-ups so parent rerenders from menu focus/hover do not reset keyboard focus, existing modal actions still restore focus normally, and `DialogPanel` moves focus into modal dialogs even when they open after async menu work.
- Verified the teacher tests tab visually after the shared primitive change.

**Validation:**
- `bash .codex/skills/pika-session-start/scripts/session_start.sh`
- `pnpm test tests/ui/SplitButton.test.tsx`
- `pnpm test tests/ui/SplitButton.test.tsx tests/components/TeacherTestsTab.test.tsx tests/components/TeacherClassroomView.test.tsx -- --runInBand --testTimeout=10000`
- `pnpm test tests/ui/SplitButton.test.tsx tests/ui/Dialog.test.tsx tests/components/AssignmentModal.test.tsx tests/components/TeacherTestsTab.test.tsx tests/components/TeacherClassroomView.test.tsx -- --runInBand --testTimeout=10000`
- `pnpm test tests/ui/Dialog.test.tsx tests/ui/SplitButton.test.tsx tests/components/CreateClassroomModal.test.tsx tests/components/AssignmentModal.test.tsx tests/components/TeacherTestsTab.test.tsx tests/components/TeacherClassroomView.test.tsx -- --runInBand --testTimeout=10000`
- `pnpm lint`
- `pnpm build`
- `bash .codex/skills/pika-audit/scripts/audit.sh`
- `E2E_BASE_URL=http://localhost:3022 bash .codex/skills/pika-ui-verify/scripts/ui_verify.sh 'classrooms/e80aa794-e2d6-4705-9da5-d08ab0fba861?tab=tests'`
- Reviewed screenshots: `/tmp/pika-teacher.png`, `/tmp/pika-student.png`, `/tmp/pika-teacher-mobile.png`

## 2026-05-31 — Assignment list stats pagination

**Completed:**
- Routed teacher assignment list stats reads through the shared chunked/paged Supabase loader.
- Preserved the legacy fallback for databases without `assignment_docs.teacher_cleared_at`.
- Added a dense 2,500-row stats regression so list stats cannot silently stop at Supabase's default page.

**Validation:**
- `bash .codex/skills/pika-session-start/scripts/session_start.sh`
- `pnpm test tests/api/teacher/assignments.test.ts tests/unit/query-chunks.test.ts -- --runInBand`
- `pnpm lint`
- `pnpm build`
- `bash .codex/skills/pika-audit/scripts/audit.sh`

## 2026-05-31 — Student entries broad-read cap

**Completed:**
- Added a default cap for broad `/api/student/entries` reads that span all active classrooms.
- Preserved classroom-scoped no-limit history behavior so attendance history surfaces do not mark older entries absent.
- Added API coverage for broad default limiting, explicit broad limit capping, classroom-scoped no-limit behavior, and explicit classroom limits.

**Validation:**
- `bash .codex/skills/pika-session-start/scripts/session_start.sh`
- `pnpm test tests/api/student/entries.test.ts -- --runInBand`
- `pnpm lint`
- `pnpm build`
- `bash .codex/skills/pika-audit/scripts/audit.sh`
- `git diff --check`

## 2026-05-31 — Teacher test authoring URL mode

**Completed:**
- Made `testMode=authoring` open the teacher test editor instead of silently falling back to grading.
- Updated test workspace navigation so Edit Test and newly created tests write authoring mode, while editor close returns the URL to grading mode.
- Routed teacher test list/detail reads through `fetchJSONWithCache` to satisfy the client-read audit gate.
- Added component coverage for authoring deep links, editor close URL repair, Edit Test URL state, and Browser Back from authoring to grading.

**Validation:**
- `bash .codex/skills/pika-session-start/scripts/session_start.sh`
- `pnpm test tests/components/TeacherTestsTab.test.tsx -- --runInBand --testTimeout=10000`
- `pnpm test tests/components/TeacherTestsTab.test.tsx tests/ui/Dialog.test.tsx -- --runInBand --testTimeout=10000`
- `pnpm lint`
- `pnpm build`
- `bash .codex/skills/pika-audit/scripts/audit.sh`
- `git diff --check`
- `E2E_BASE_URL=http://localhost:3024 bash .codex/skills/pika-ui-verify/scripts/ui_verify.sh 'classrooms/e80aa794-e2d6-4705-9da5-d08ab0fba861?tab=tests'`
- Manual Playwright screenshots for `testMode=authoring`: `/tmp/pika-teacher-authoring.png`, `/tmp/pika-teacher-authoring-mobile.png`

## 2026-05-31 — Teacher assignment passive sidebar removal

**Completed:**
- Disabled the external right sidebar for teacher assignment summary and workspace route keys.
- Stopped rendering the classroom route's passive assignment sidebar fallback for teacher assignments.
- Added coverage so teacher assignments match the tests work-surface rule: no external sidebar until an integrated workspace inspector is active.
- Fixed review feedback so disabled right-sidebar routes clear stale mobile right-drawer state.

**Validation:**
- `bash .codex/skills/pika-session-start/scripts/session_start.sh`
- `pnpm test tests/unit/layout-config.test.ts tests/components/ThreePanelProvider.test.tsx tests/components/ClassroomPageClientAssignmentsEditMode.test.tsx -- --runInBand --testTimeout=10000`
- `pnpm lint`
- `pnpm build`
- `bash .codex/skills/pika-audit/scripts/audit.sh`
- `git diff --check`
- `E2E_BASE_URL=http://localhost:3025 bash .codex/skills/pika-ui-verify/scripts/ui_verify.sh 'classrooms/e80aa794-e2d6-4705-9da5-d08ab0fba861?tab=assignments'`
- Reviewed screenshots: `/tmp/pika-teacher.png`, `/tmp/pika-student.png`, `/tmp/pika-teacher-mobile.png`, `/tmp/pika-teacher-assignments-loaded.png`

## 2026-05-31 — UI sidebar guidance cleanup

**Completed:**
- Updated `docs/core/design.md` so the classroom shell treats `RightSidebar` as optional route-level chrome, not a default details pane.
- Clarified the teacher work-surface canon: assignments/quizzes/tests should use integrated `TeacherWorkspaceSplit` inspectors only when active work justifies side-by-side panes.
- Promoted the teacher workspace split audit language from proposed extraction to the current structural primitive and discouraged external right-sidebar substitutes for teacher work surfaces.

**Validation:**
- `bash .codex/skills/pika-session-start/scripts/session_start.sh`
- `pnpm test tests/unit/ai-startup-docs.test.ts tests/unit/layout-config.test.ts -- --runInBand`
- `bash .codex/skills/pika-audit/scripts/audit.sh`
- `git diff --check`

## 2026-05-31 — Composite widget audit relevance

**Completed:**
- Tightened the `missing-a11y-tests` audit guardrail so composite-widget changes require a changed semantic test that matches or references the changed component.
- Kept the allowed test locations scoped to `tests/components`, `tests/ui`, or `tests/integration`.
- Added fixture coverage for the bypass case where an unrelated component test changed beside a composite-widget component.
- Addressed review feedback by making the no-changed-test path report `missing-a11y-tests` cleanly on Bash 3.2 and by avoiding loose content-reference matches for generic stems such as `button`.
- Addressed follow-up review feedback by matching generic component stems against changed test filenames case-insensitively, with a `button.tsx` / `Button.test.tsx` regression fixture.
- Tightened that follow-up so generic stems require exact changed test filename matches, avoiding false positives such as `page.tsx` passing through `PageActionBar.test.tsx`.

**Validation:**
- `bash .codex/skills/pika-session-start/scripts/session_start.sh`
- `pnpm test tests/unit/ai-startup-docs.test.ts tests/unit/ui-guidance-docs.test.ts -- --runInBand`
- `pnpm lint`
- `pnpm build`
- `bash .codex/skills/pika-audit/scripts/audit.sh`
- `git diff --check`

## 2026-05-31 — Upload image route standardization

**Completed:**
- Replaced legacy direct `getSession()` handling in `/api/upload-image` with `requireAuth()`.
- Converted upload-image validation and storage failure branches from manual `{ error }` responses to `ApiError` throws handled by `withErrorHandler`.
- Updated API tests to cover wrapper-mapped authentication and `requireAuth` user-id filename scoping.
- Addressed review feedback by preserving the malformed-session no-id guard before building storage filenames.

**Validation:**
- `bash .codex/skills/pika-session-start/scripts/session_start.sh`
- `pnpm test tests/api/upload-image.test.ts tests/unit/api-route-standards.test.ts -- --runInBand`
- `bash .codex/skills/pika-audit/scripts/audit.sh`
- `git diff --check`
- `pnpm lint`
- `pnpm build`

## 2026-05-31 — Student lesson calendar cache reuse

**Completed:**
- Routed student lesson calendar assignment reads through the shared `student-assignments:<classroomId>` cache key.
- Routed student lesson calendar announcement reads through the shared `student-announcements:<classroomId>` cache key.
- Routed student lesson calendar lesson-plan reads through a range-specific `student-lesson-plans:<classroomId>:<start>:<end>` cache key.
- Added remount coverage proving the calendar reuses cached lesson plans, assignments, and announcements.
- Addressed review feedback by isolating per-endpoint load failures and strengthening remount coverage to wait for completed cached data.

**Validation:**
- `bash .codex/skills/pika-session-start/scripts/session_start.sh`
- `pnpm test tests/components/StudentLessonCalendarTab.test.tsx tests/unit/request-cache.test.ts -- --runInBand`
- `bash .codex/skills/pika-audit/scripts/audit.sh`
- `git diff --check`
- `pnpm lint`
- `pnpm build`

## 2026-05-31 — Student history cache reuse

**Completed:**
- Added a shared student entries client helper that caches `/api/student/entries` reads by classroom and optional limit.
- Routed classroom student history and standalone student history class-day/entry reads through shared cached helpers.
- Routed the today tab’s entry history refresh through the shared student entries cache and invalidated classroom entry caches after successful saves.
- Added component coverage proving student history remounts reuse cached class days and entries, plus save invalidation coverage in today-tab history tests.
- Addressed PR review feedback by clearing stale history rows after failed reloads, cancelling stale history requests after classroom changes, and invalidating/updating entry caches on save conflicts without caching partial conflict payloads as full history rows.
- Spawned new read-only audit tracks for accessibility/mobile consistency, API standardization, classroom action surfaces, and client caching/freshness.

**Validation:**
- `pnpm vitest run tests/components/StudentHistoryTab.test.tsx tests/components/StudentTodayTabHistory.test.tsx`
- `bash .codex/skills/pika-audit/scripts/audit.sh`
- `git diff --check`
- `pnpm lint`
- `pnpm build`

## 2026-05-31 — Gradebook cache invalidation after grading

**Completed:**
- Added a shared `invalidateGradebookForClassroom()` helper for `gradebook:<classroomId>:` cache keys.
- Routed the gradebook detail refresh path through the helper.
- Invalidated gradebook caches when assignment grade-update events arrive, including auto-grade paths that refresh without a full doc payload.
- Invalidated gradebook caches after test grading row updates, batch auto-grade completion, batch return, unsubmit, and attempt deletion refreshes.
- Added focused component coverage for assignment and test grade-update invalidation.

**Validation:**
- `bash .codex/skills/pika-session-start/scripts/session_start.sh`
- `pnpm vitest run tests/hooks/useGradebookData.test.ts tests/components/TeacherClassroomView.test.tsx tests/components/TeacherTestsTab.test.tsx`
- `bash .codex/skills/pika-audit/scripts/audit.sh`
- `git diff --check`
- `pnpm lint`
- `pnpm build`
