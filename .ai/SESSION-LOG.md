# Pika Session Log

Rolling recent session log for AI/human handoffs. Keep this file small; full historical session history lives in `.ai/JOURNAL-ARCHIVE.md`.

**Rules:**
- Append one concise entry for meaningful work at the end of a session.
- Run `node scripts/trim-session-log.mjs` after appending to keep only the latest 60 entries.
- Keep enough recent entries for weekly automations to inspect roughly the last week of work.
- Use `.ai/JOURNAL-ARCHIVE.md` only for historical investigation.

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

## 2026-05-31 — Gradex assignment adapter payload foundation

**Completed:**
- Added a server-side Gradex assignment payload builder for Pika assignment grading.
- Produces both the Pika adapter request and the async Gradex `grading-runs` create request, plus local pseudonym mapping for the later polling slice.
- Sanitizes assignment text and submission text, pseudonymizes assignment/submission/student/grade refs with an HMAC salt, summarizes artifacts by type/count only, and keeps provider/model/tier selection as Gradex-owned `auto` settings.
- Added privacy and contract coverage proving raw Pika IDs, identity fields, raw history fields, repo identities, and raw URLs are excluded from the Gradex request.

**Validation:**
- `pnpm vitest run tests/lib/gradex-assignment-payload.test.ts`
- `pnpm exec tsc --noEmit`

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

## 2026-06-01 — AI grading egress sanitization

**Completed:**
- Added shared AI sanitization utilities for direct identifier redaction, roster-aware initials reuse, provider pseudonym refs, and egress allow-list validation.
- Kept log summary APIs compatible while routing their redaction helpers through the shared sanitizer.
- Sanitized assignment grading prompt fields, artifact metadata, and generated feedback, and added `store: false` to assignment grading OpenAI requests.
- Sanitized test grading prompt fields, answer references, student responses, and generated feedback, added `store: false`, and changed batch grading to send pseudonymous provider refs mapped back locally.
- Documented the AI grading egress contract for the upcoming GradeX adapter.

**Validation:**
- `pnpm test tests/unit/ai-sanitization.test.ts tests/unit/log-summary.test.ts tests/unit/ai-grading.test.ts tests/unit/ai-test-grading.test.ts tests/lib/ai-test-grading.test.ts`
- `pnpm test tests/api/teacher/assignments-auto-grade.test.ts tests/api/teacher/assignment-auto-grade-runs.test.ts tests/api/teacher/tests-ai-suggest.test.ts tests/api/teacher/tests-auto-grade.test.ts tests/api/teacher/test-auto-grade-runs.test.ts tests/lib/test-ai-grading-runs.test.ts tests/lib/assignment-ai-grading-runs.test.ts`
- `pnpm lint`
- `pnpm test` (one unrelated `StudentAssignmentsTab` modal test failed during the full run; rerunning that file passed)
- `pnpm test tests/components/StudentAssignmentsTab.test.tsx`
- `pnpm build`
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

## 2026-06-01 — Codex model recommendation workflow

**Completed:**
- Added a Codex model recommendation policy to `docs/ai-instructions.md`, including `5.3-spark` guidance and `5.5` reasoning-level guidance.
- Added a startup checklist reminder to state the recommendation before implementation.

**Validation:**
- `bash .codex/skills/pika-session-start/scripts/session_start.sh`
- `pnpm test tests/unit/ai-startup-docs.test.ts tests/unit/ui-guidance-docs.test.ts`
- `git diff --check`

## 2026-06-01 — Repo-review AI egress sanitization

**Completed:**
- Routed repo-review AI classification through provider refs, direct identifier redaction, and `store: false`.
- Routed repo-review feedback generation through classroom sanitization context with pseudonymous repo/student refs and sanitized evidence/warnings.
- Sanitized repo-review AI feedback before returning it for local persistence.
- Addressed review feedback by sanitizing heuristic fallback feedback when OpenAI is unavailable or fails.
- Sanitized daily log summary model output before cron persistence.

**Validation:**
- `pnpm test tests/unit/repo-review-ai.test.ts tests/unit/repo-review-analysis.test.ts tests/api/teacher/assignments-artifact-repo-run.test.ts`
- `pnpm test tests/unit/repo-review-ai.test.ts tests/unit/repo-review-analysis.test.ts tests/api/teacher/assignments-artifact-repo-run.test.ts tests/unit/log-summary.test.ts tests/api/cron/nightly-log-summaries.test.ts`
- `pnpm test tests/unit/repo-review-ai.test.ts`

## 2026-06-01 — Gradex egress sanitization alignment

**Completed:**
- Refactored the Gradex assignment payload builder to require Pika's standard AI sanitization context.
- Routed Gradex assignment title, instructions, and submission text through `sanitizeAiText` before Gradex payload construction.
- Kept Gradex-specific pseudonymous refs and local mappings while preserving extra raw-token hardening for Pika DB identifiers and bare `www.` URLs.
- Strengthened Gradex adapter tests for roster-name initials, required sanitization context, raw identifier exclusion, and Gradex-owned provider/model settings.

**Validation:**
- `pnpm test tests/lib/gradex-assignment-payload.test.ts tests/unit/ai-sanitization.test.ts tests/unit/ai-grading.test.ts tests/lib/assignment-ai-grading-runs.test.ts`
- `pnpm exec tsc --noEmit`
- `pnpm lint`

## 2026-06-01 — Snapshot gallery hardening phase-1 second pass

**Completed:**
- Added `requireSnapshotGalleryAccess()` in `src/lib/auth.ts` to gate snapshot endpoints to non-production teachers by default and allow production access only for `SNAPSHOT_GALLERY_ADMIN_EMAILS` allowlist entries.
- Replaced `requireAuth()` with snapshot-specific access check in `src/app/api/snapshots/list/route.ts` and `src/app/api/snapshots/[filename]/route.ts`.
- Updated snapshot API tests to mock and verify the new auth path.
- Added unit coverage for snapshot-gallery access gating in `tests/unit/auth.test.ts`.
- Added production admin allowlist env variable and clarified gallery security docs in `.env.example` and `docs/snapshot-gallery.md`.

**Validation:**
- `pnpm test tests/unit/auth.test.ts tests/api/snapshots-list.test.ts tests/api/snapshots-filename.test.ts`
- `pnpm lint`

## 2026-06-01 — Snapshot gallery production restriction finalized

**Completed:**
- Updated `requireSnapshotGalleryAccess()` to be strictly non-production only (no production allowlist fallback).
- Removed `SNAPSHOT_GALLERY_ADMIN_EMAILS` from `.env.example`.
- Updated snapshot gallery docs to reflect production-blocked policy.
- Adjusted `requireSnapshotGalleryAccess` unit tests accordingly (`tests/unit/auth.test.ts`).

**Validation:**
- `pnpm test tests/unit/auth.test.ts tests/api/snapshots-list.test.ts tests/api/snapshots-filename.test.ts`
- `pnpm lint`

## 2026-06-01 — Open join classroom access mode

**Completed:**
- Added `classrooms.join_policy` and `classroom_roster.join_source` migration defaults/checks.
- Added teacher Settings controls for `Roster` vs `Open join`, keeping `allow_enrollment` as the master join switch.
- Updated student join-by-code flow so roster mode remains strict, while open join asks for first/last name and self-creates the roster/profile/enrollment rows.
- Stamped manual roster adds as `manual`, CSV uploads as `csv`, and self-joins as `open_join`.
- Added an `Open join` roster badge and source detail field for teacher review.

**Validation:**
- `pnpm test tests/api/student/classrooms-join.test.ts tests/api/teacher/classrooms-id.test.ts tests/api/teacher/roster.test.ts tests/api/teacher/roster-add.test.ts tests/api/teacher/roster-upload-csv.test.ts tests/components/TeacherSettingsTab.test.tsx`
- `pnpm test`
- `pnpm test tests/components/TeacherRosterTab.test.tsx tests/components/TeacherSettingsTab.test.tsx tests/api/student/classrooms-join.test.ts tests/api/teacher/roster.test.ts`
- `pnpm lint`
- `pnpm build`
- Visual verification: Settings desktop/mobile/student screenshots via `pika-ui-verify`, plus mocked open-join roster desktop/mobile and student join form screenshots.

## 2026-06-01 — Open join settings toggle polish

**Completed:**
- Replaced the Settings join checkbox and right-aligned segmented control with matching left-aligned two-choice toggles.
- Updated the toggle states so `Allow`/`Roster` sit on the left and `Disallow`/`Open` sit on the right.

**Validation:**
- `pnpm test tests/components/TeacherSettingsTab.test.tsx`
- `pnpm test tests/unit/ai-startup-docs.test.ts`
- `pnpm lint`
- `pnpm build`
- Visual verification: Settings desktop/mobile/student screenshots via `pika-ui-verify`.

## 2026-06-01 — Joining tooltip copy consolidation

**Completed:**
- Moved the allow-new-students and join-mode explanatory copy into the `Joining` info tooltip.
- Left the Settings rows as compact `Allow / Disallow` and `Roster / Open` toggles.

**Validation:**
- `pnpm test tests/components/TeacherSettingsTab.test.tsx`
- `pnpm test tests/unit/ai-startup-docs.test.ts`
- `pnpm lint`
- `pnpm build`
- Visual verification: Settings desktop/mobile/student screenshots via `pika-ui-verify`.

## 2026-06-01 — Joining row copy refinement

**Completed:**
- Restored brief row-level copy for joining controls while keeping the tooltip concise.
- Added an X marker inside the off-side toggle thumb.
- Linked the roster-mode row copy to the classroom roster tab.
- Added focused coverage for the visible joining copy and roster link.

**Validation:**
- `pnpm test tests/components/TeacherSettingsTab.test.tsx`
- `pnpm test tests/components/TeacherSettingsTab.test.tsx tests/unit/ai-startup-docs.test.ts`
- `pnpm lint`
- `pnpm build`
- `git diff --check`
- `bash .codex/skills/pika-session-start/scripts/session_start.sh`
- Visual verification: Settings desktop/mobile/student screenshots via `pika-ui-verify`; checked the Disallow/X off state and restored the classroom to allowed.

## 2026-06-01 — Roster join row wording

**Completed:**
- Changed the roster-mode row copy to `Only students on roster can join.` with a lowercase `view roster` link.
- Matched the roster-mode row emphasis to the allow-new-joins row copy.
- Updated focused settings coverage for the new copy and link text.

**Validation:**
- `pnpm test tests/components/TeacherSettingsTab.test.tsx`
- `pnpm lint`
- `pnpm build`
- Visual verification: Settings desktop/mobile/student screenshots via `pika-ui-verify`.

## 2026-06-01 — Settings name and join-code controls

**Completed:**
- Renamed the Settings `Course Name` field to `Classroom name`, including validation and save messages.
- Replaced the separate `New code` button with a warning-colored refresh icon attached to the join-code control.
- Kept the join-code copy action on the code itself.
- Removed the regenerate-code confirmation dialog description so the title stands alone.
- Added focused coverage that the refresh icon opens the title-only confirmation dialog.

**Validation:**
- `pnpm test tests/components/TeacherSettingsTab.test.tsx`
- `pnpm lint`
- `pnpm build`
- Visual verification: Settings desktop/mobile/student screenshots via `pika-ui-verify`, plus a mobile confirmation-dialog screenshot after clicking the refresh icon.

## 2026-06-01 — Join copy affordance styling

**Completed:**
- Styled the join code and join URL copy buttons with primary underlined text so they read as clickable copy controls.
- Kept the warning refresh icon visually distinct from the copy actions.

**Validation:**
- `pnpm test tests/components/TeacherSettingsTab.test.tsx`
- `pnpm lint`
- `pnpm build`
- Visual verification: Settings desktop/mobile/student screenshots via `pika-ui-verify`.

## 2026-06-01 — Join copy highlighted controls

**Completed:**
- Reverted the link-like underlined text styling on the join code and URL.
- Highlighted the full join code and join URL controls with the existing subtle primary treatment so the whole textbox reads as clickable-to-copy.
- Left the warning refresh icon separate from the copy controls.

**Validation:**
- `pnpm test tests/components/TeacherSettingsTab.test.tsx`
- `pnpm lint`
- `pnpm build`
- Visual verification: Settings desktop/mobile/student screenshots via `pika-ui-verify`.

## 2026-06-01 — Regenerate join link layout

**Completed:**
- Changed the regenerate confirmation title to `Generate new join code and link?`.
- Moved the refresh icon into a separate warning button after the join URL copy control.
- Shortened the desktop join URL copy control so it no longer stretches across the row.
- Updated focused coverage for the new refresh button label and dialog title.

**Validation:**
- `pnpm test tests/components/TeacherSettingsTab.test.tsx`
- `pnpm lint`
- `pnpm build` after clearing stale `.next`
- Visual verification: Settings desktop/mobile/student screenshots via `pika-ui-verify`, plus a mobile confirmation-dialog screenshot.

## 2026-06-01 — Settings switch consistency

**Completed:**
- Replaced the settings page checkbox controls with a shared switch-row pattern.
- Simplified the joining rows so each switch sits on the left with short state copy on the right.
- Kept off states visually clear with the X thumb marker and muted switch styling.
- Updated focused settings coverage for the markdown display switch semantics.

**Validation:**
- `pnpm test tests/components/TeacherSettingsTab.test.tsx`
- `pnpm exec tsc --noEmit --pretty false`
- `pnpm lint`
- `pnpm build`
- `git diff --check`
- Visual verification: Settings desktop/mobile/student screenshots via `pika-ui-verify`, plus a full-page teacher screenshot for Public Syllabus switches.
- `bash scripts/verify-env.sh` still has an unrelated timeout in `tests/components/TeacherStudentWorkPanel.test.tsx`.

## 2026-06-01 — Settings switch off-state polish

**Completed:**
- Removed the X icon from settings switches.
- Made off and disabled switch thumbs use the neutral grey token while preserving the blue on state.
- Kept disabled switches on a neutral track with subtle opacity.

**Validation:**
- `pnpm test tests/components/TeacherSettingsTab.test.tsx`
- `pnpm exec tsc --noEmit --pretty false`
- `pnpm lint`
- `pnpm build`
- `git diff --check`
- Visual verification: Settings desktop/mobile/student screenshots via `pika-ui-verify`, plus a full-page teacher screenshot showing the off Public Syllabus switch.

## 2026-06-01 — Settings switch blue thumb restore

**Completed:**
- Restored the settings switch thumb to blue for off and disabled states.
- Kept the off/disabled track neutral and left the X icon removed.
- Removed whole-switch opacity so the thumb does not wash out.

**Validation:**
- `pnpm test tests/components/TeacherSettingsTab.test.tsx`
- `pnpm exec tsc --noEmit --pretty false`
- `pnpm lint`
- `pnpm build`
- `git diff --check`
- Visual verification: Settings desktop/mobile/student screenshots via `pika-ui-verify`, plus a full-page teacher screenshot showing the off Public Syllabus switch.

## 2026-06-01 — Gradex smoke runner

**Completed:**
- Added a Pika-owned `pnpm smoke:gradex` runner that builds sanitized sample assignment data, submits it to Gradex, polls the run, fetches item results, and maps Gradex compatibility output back to Pika grade-record fields.
- Added mocked HTTP tests for create/tick/poll/item mapping and sanitized sample assertions.
- Updated Gradex pseudonymous refs to avoid long hex-like tokens that Gradex rejects as raw identifier-shaped data.
- Lowercased generated Gradex artifact-summary text so it does not trip Gradex's likely-name submitted-text guard.

**Validation:**
- `bash scripts/verify-env.sh`
- `pnpm test tests/lib/gradex-smoke-runner.test.ts tests/lib/gradex-assignment-payload.test.ts`
- `pnpm exec tsc --noEmit`
- `pnpm lint`
- `pnpm smoke:gradex -- --dry-run`
- `pnpm smoke:gradex` reached Gradex run creation against the configured deployed API URL, then stopped because no `GRADEX_INTERNAL_TOKEN`/worker is configured to process the queued run.
- `GRADEX_API_URL=http://127.0.0.1:3001 GRADEX_API_KEY=... GRADEX_INTERNAL_TOKEN=... pnpm smoke:gradex` completed end-to-end against a controlled local Gradex dev server.

## 2026-06-02 — Daily log save and session hardening

**Completed:**
- Fixed the student daily-log autosave race where an older save response could mark newer, still-unsaved visible content as `Saved`.
- Added explicit daily-log handling for expired-session save responses so the entry remains `Unsaved`, shows a session-expired message, and redirects to login.
- Added silent daily-log draft recovery in `sessionStorage` so unsaved text typed before an expired-session redirect is restored after login, remains marked `Unsaved`, and automatically retries saving once the page reloads with an active session.
- Added a client-side authenticated-layout session watcher for classroom, student, and teacher pages to detect expired or wrong-role sessions while a stale page is still mounted.
- Added focused regression coverage for stale daily-log save responses, expired-session save redirects, draft recovery, and the session watcher.

**Validation:**
- `bash .codex/skills/pika-session-start/scripts/session_start.sh`
- `pnpm test tests/components/StudentTodayTabHistory.test.tsx tests/components/AuthSessionWatcher.test.tsx tests/api/student/entries.test.ts tests/api/auth/me.test.ts`
- `pnpm lint`
- `pnpm test` (303 files, 2656 tests)
- `pnpm build`
- `E2E_BASE_URL=http://localhost:3002 bash .codex/skills/pika-ui-verify/scripts/ui_verify.sh classrooms`
- Post-PR draft recovery rerun: `pnpm test tests/components/StudentTodayTabHistory.test.tsx tests/components/AuthSessionWatcher.test.tsx tests/components/AppHeader.test.tsx && pnpm lint && pnpm build`
- Post-PR restored-draft autosave rerun: `pnpm test tests/components/StudentTodayTabHistory.test.tsx tests/components/AuthSessionWatcher.test.tsx tests/components/AppHeader.test.tsx && pnpm lint && pnpm build`

## 2026-06-02 — Assignment artifact validation policy

**Completed:**
- Renamed the default generic submission artifact label from `Public link` to `Link` and changed student link inputs from `Public URL` to `URL`.
- Added link validation policy helpers for basic URL, reachable page, and expected-site checks using existing `validation_policy_json`.
- Added compact teacher controls for link requirement validation and carried validation status into teacher artifact displays.
- Extended generic link validation with safe URL normalization, DNS/private-host guards, host-first expected-domain rejection, bounded fetch checks, redirect caps, timeout handling, and soft `Needs review` results for inconclusive pages.
- Updated focused unit/component/API coverage for validation policy behavior, student status copy, teacher controls, and artifact metadata.

**Validation:**
- `bash .codex/skills/pika-session-start/scripts/session_start.sh`
- `pnpm test tests/unit/assignment-submission-validation.test.ts tests/lib/assignment-submission-requirements.test.ts tests/components/StudentAssignmentSubmissionChecklist.test.tsx tests/components/AssignmentModal.test.tsx tests/components/AssignmentArtifactsCell.test.tsx tests/api/teacher/assignments-id.test.ts`
- `pnpm lint`
- `pnpm build`
- `pnpm test` failed under concurrent build load with two unrelated 5s timeouts and one updated expectation; reran the failed tests successfully with `pnpm test tests/components/TeacherStudentWorkPanel.test.tsx tests/unit/ai-startup-docs.test.ts tests/api/teacher/assignments-id.test.ts`.
- Visual verification: `pika-ui-verify` classroom screenshots plus targeted teacher assignment link-policy and student submission checklist screenshots.

## 2026-06-02 — Artifact Save disabled when unchanged

**Completed:**
- Disabled student artifact `Save` buttons until the draft URL differs from the saved artifact.
- Included repo-link GitHub username changes in the same dirty-state check.
- Added component regressions for unchanged generic links and repo username edits.

**Validation:**
- `bash .codex/skills/pika-session-start/scripts/session_start.sh`
- `pnpm test tests/components/StudentAssignmentSubmissionChecklist.test.tsx`
- `pnpm lint`
- `pnpm build`
- `git diff --check`
- Visual verification: `pika-ui-verify` classroom screenshots plus targeted student assignment-detail screenshot confirming both unchanged artifact `Save` buttons are disabled.

## 2026-06-02 — Bound link reachability checks to validated DNS

**Completed:**
- Replaced generic server-side `fetch` for artifact link reachability with bounded `http`/`https` requests that connect to the already-validated public IP address.
- Preserved the submitted host in the `Host` header and HTTPS SNI while preventing a second uncontrolled DNS lookup during the actual request.
- Kept redirect, timeout, and body-size caps, and tightened response-body storage to the configured 24 KB limit.
- Added a regression proving reachable-link requests use the validated public IP while preserving original host metadata.

**Validation:**
- `bash .codex/skills/pika-session-start/scripts/session_start.sh`
- `pnpm test tests/unit/assignment-submission-validation.test.ts`
- `pnpm test tests/unit/assignment-submission-validation.test.ts tests/lib/assignment-submission-requirements.test.ts tests/components/StudentAssignmentSubmissionChecklist.test.tsx tests/components/AssignmentModal.test.tsx tests/components/AssignmentArtifactsCell.test.tsx tests/api/teacher/assignments-id.test.ts`
- `pnpm lint`
- `pnpm build`
- Rereview: no remaining findings in the updated link reachability path.

## 2026-06-02 — Assignment comment textbox clear

**Completed:**
- Cleared the teacher assignment comment draft UI after a successful Send comment action while keeping the returned comment visible in Comments Sent.
- Added component coverage for the send flow so the comment textbox must empty after a successful feedback return.
- Preserved selected students after applying comments or grades to selected students.
- Removed time-of-day from returned comment dates in the Comments Sent section.
- Removed the manual Refresh submissions button from the teacher assignments workspace action bar.
- Added hover-only scrollbar treatment to the teacher assignment class list, individual work, and inspector panes.

**Validation:**
- `bash .codex/skills/pika-session-start/scripts/session_start.sh`
- `pnpm test tests/components/TeacherStudentWorkPanel.test.tsx`
- `pnpm test tests/components/TeacherClassroomView.test.tsx tests/components/TeacherStudentWorkPanel.test.tsx`
- `pnpm lint`
- Visual verification: teacher assignment review desktop/mobile and student mobile screenshots via `pika-ui-verify`, mocked Playwright send-flow plus apply-comments/apply-grade screenshots confirming the textbox clears and selected students remain checked without writing to the dev database, a date-only Comments Sent screenshot, and a loaded assignment workspace screenshot confirming the refresh button is gone and scroll panes use hover-only scrollbars.

## 2026-06-02 — Snapshot gallery phase-2 hardening

**Completed:**
- Added server-side hardening for `/snapshots-gallery` in [`src/app/snapshots-gallery/page.tsx`](/Users/stew/.codex/worktrees/pika/snapshot-gallery-phase2/src/app/snapshots-gallery/page.tsx):
  - Gate for `ENABLE_UI_GALLERY === 'true'` with `notFound()`.
  - Enforce authenticated teacher access via `requireSnapshotGalleryAccess()`.
  - Redirect unauthenticated users to `/login` and 404 on authorization failures.
- Hardened snapshot client loading in [`src/app/snapshots-gallery/SnapshotGallery.tsx`](/Users/stew/.codex/worktrees/pika/snapshot-gallery-phase2/src/app/snapshots-gallery/SnapshotGallery.tsx):
  - Added non-OK HTTP response handling.
  - Added runtime payload-shape validation before rendering.
  - Added explicit error state and recoverable "no matching snapshots" filter-empty state.
- Added regression coverage for snapshot gallery client loading in [`tests/components/SnapshotGallery.test.tsx`](/Users/stew/.codex/worktrees/pika/snapshot-gallery-phase2/tests/components/SnapshotGallery.test.tsx).

**Validation:**
- `pnpm exec vitest run tests/components/SnapshotGallery.test.tsx tests/api/snapshots-list.test.ts tests/api/snapshots-filename.test.ts`
- `pnpm lint`
- `pnpm exec tsc --noEmit --pretty false`
- `pnpm build`
- `bash scripts/trim-session-log.mjs`

## 2026-06-02 — Gradex assignment adapter slice

**Completed:**
- Deployed Gradex production from merged `main` and re-ran the Pika Gradex smoke against `https://gradex-two.vercel.app`.
- Added feature-flagged Pika assignment grading integration for Gradex: `GRADEX_ASSIGNMENT_GRADING_ENABLED=true` routes assignment auto-grade selections through background runs marked `gradex:pika-assignment-v1`.
- Added migration `078_assignment_gradex_run_metadata.sql` for storing Gradex run status metadata on Pika assignment AI grading runs.
- Added a server-side Gradex assignment processor that submits sanitized Pika payloads, stores the Gradex run ID, polls Gradex, and maps completed results back into Pika grade fields.
- Addressed PR review findings by adding Gradex transport retry handling, terminal-run unresolved item reconciliation, fetch timeouts, and a pseudonymous run idempotency marker in Gradex assignment metadata.
- Addressed re-review feedback by making Gradex submit/poll honor queued item `next_retry_at` backoff before making another remote request.
- Kept the existing Pika/OpenAI grading path as the default when the Gradex flag is off.

**Validation:**
- `bash scripts/verify-env.sh`
- `pnpm test tests/api/teacher/assignments-auto-grade.test.ts tests/api/teacher/assignment-auto-grade-runs.test.ts tests/lib/gradex-assignment-grading.test.ts tests/lib/assignment-ai-grading-runs.test.ts tests/lib/gradex-assignment-payload.test.ts tests/lib/gradex-smoke-runner.test.ts`
- `pnpm exec tsc --noEmit`
- `pnpm lint`
- `pnpm test tests/unit/migration-filenames.test.ts tests/unit/ai-startup-docs.test.ts tests/unit/trim-session-log.test.ts`
- `pnpm test tests/api/teacher/assignments-auto-grade.test.ts tests/api/teacher/assignment-auto-grade-runs.test.ts tests/lib/gradex-assignment-grading.test.ts tests/lib/assignment-ai-grading-runs.test.ts tests/lib/gradex-assignment-payload.test.ts tests/lib/gradex-smoke-runner.test.ts tests/unit/migration-filenames.test.ts`
- `pnpm smoke:gradex -- --dry-run`
- `GRADEX_API_URL=https://gradex-two.vercel.app GRADEX_INTERNAL_TOKEN= GRADEX_INTERNAL_SECRET= GRADEX_SMOKE_POLL_INTERVAL_MS=1000 GRADEX_SMOKE_POLL_ATTEMPTS=60 pnpm smoke:gradex`
- `pnpm build`

**Follow-up:**
- Apply migration 078 in the target Pika environment before enabling `GRADEX_ASSIGNMENT_GRADING_ENABLED`.
- Run a real Pika assignment UI smoke with Gradex enabled after the migration and env vars are present.

## 2026-06-03 — Gradex assignment UI cutover coverage

**Completed:**
- Confirmed the existing selected-students assignment `AI Grade` action uses the background assignment run path when Gradex assignment grading is enabled.
- Clarified the assignment auto-grade route branch as `shouldUseBackgroundRun`, covering both multi-student selections and Gradex-enabled assignment grading.
- Added a `TeacherClassroomView` regression for one selected student: the UI posts to assignment auto-grade, receives a Gradex-marked background run, polls/ticks it, clears the selection, and reports completion.
- Re-ran the live Pika-to-Gradex assignment smoke against `https://gradex-two.vercel.app`.

**Validation:**
- `bash scripts/verify-env.sh`
- `pnpm test tests/api/teacher/assignments-auto-grade.test.ts tests/components/TeacherClassroomView.test.tsx`
- `pnpm exec tsc --noEmit`
- `pnpm smoke:gradex:assignment`
- `pnpm lint`

## 2026-06-03 — Gradebook grade color bands

**Completed:**
- Added shared grade percentage text coloring in the teacher gradebook: below 50% uses danger text, 50% up to but not including 70% uses warning text, and 70% or higher remains default text.
- Applied the bands to assessment cells, final grades, summary rows, and the selected-student detail panel while keeping ungraded/hidden values muted.
- Persisted the gradebook email split button at zero selected students and moved `Show %` / `Show Raw` into its dropdown as radio-style menu items.
- Added component coverage for red, amber, exact-70 default, and default grade bands plus the persistent split-button score-display menu.

**Validation:**
- `bash .codex/skills/pika-session-start/scripts/session_start.sh`
- `pnpm test tests/components/TeacherGradebookTab.test.tsx`
- `pnpm lint`
- Visual verification: `pika-ui-verify` on `classrooms/e80aa794-e2d6-4705-9da5-d08ab0fba861?tab=gradebook` (teacher desktop, student mobile, teacher mobile) plus loaded table screenshots, open dropdown screenshot, and exact-70 boundary screenshot.

## 2026-06-03 — Gradebook summary red color fix

**Completed:**
- Moved grade color classes onto inner value spans in the gradebook final column, assessment Avg/Med summary cells, and final Avg/Med summary cells so they reliably override `DataTableCell`'s default text color.
- Added a regression proving below-50 student final marks and Avg/Med summary values render with `text-danger`, while 50-69.9 remains warning and exact 70 remains default.

**Validation:**
- `bash .codex/skills/pika-session-start/scripts/session_start.sh`
- `pnpm test tests/components/TeacherGradebookTab.test.tsx`
- `pnpm lint`
- Visual verification: targeted Playwright screenshots with intercepted below-50 final and Avg/Med summary values on teacher desktop/mobile, plus student mobile unaffected view.

## 2026-06-03 — PR 719 CI recovery

**Completed:**
- Diagnosed PR #719's failing GitHub Actions run as the `.ai/SESSION-LOG.md` bound test finding 64 entries instead of 60.
- Ran `node scripts/trim-session-log.mjs`, synced the PR branch with `origin/main`, and kept the merged session log at 60 entries.
- Pushed the updated `codex/clear-assignment-comment-input` branch; GitHub now reports the PR merge state as clean.

**Validation:**
- `pnpm test tests/unit/ai-startup-docs.test.ts`
- `pnpm test tests/components/TeacherClassroomView.test.tsx tests/components/TeacherStudentWorkPanel.test.tsx`
- `git diff --check`
