# Pika Session Log

Rolling recent session log for AI/human handoffs. Keep this file small; full historical session history lives in `.ai/JOURNAL-ARCHIVE.md`.

**Rules:**
- Append one concise entry for meaningful work at the end of a session.
- Run `node scripts/trim-session-log.mjs` after appending to keep only the latest 20 entries.
- Use `.ai/JOURNAL-ARCHIVE.md` only for historical investigation.

## 2026-05-26 — Split-button destructive action placement

**Completed:**
- Added a `destructive` split-button option flag and centralized menu rendering so destructive options appear last under a separator.
- Marked assignment delete, test-work delete, and roster removal split-button actions as destructive.
- Added focused SplitButton coverage for reordering a destructive option supplied before normal actions.
- Stabilized the assignment refresh test by waiting for the initial detail request before clicking refresh.

**Validation:**
- `bash .codex/skills/pika-session-start/scripts/session_start.sh`
- `pnpm test tests/ui/SplitButton.test.tsx tests/components/TeacherRosterTab.test.tsx tests/components/TeacherTestsTab.test.tsx tests/components/TeacherClassroomView.test.tsx`
- `pnpm lint`
- `E2E_BASE_URL=http://localhost:3001 bash .codex/skills/pika-ui-verify/scripts/ui_verify.sh classrooms`
- Playwright menu smoke: roster, assignment, and test action dropdowns all placed Remove/Delete last under a separator.
- Screenshots: `/tmp/pika-roster-actions-menu.png`, `/tmp/pika-assignment-actions-menu.png`, `/tmp/pika-test-actions-menu.png`
- `pnpm test`
- `pnpm test:coverage`

## 2026-05-26 — Critical risk fixes

**Completed:**
- Fixed `getTodayInToronto()` to format the current instant directly in `America/Toronto`, avoiding UTC-host double conversion.
- Added archived-classroom mutation guards for assignment grading, selected grading, return, feedback return, AI grading, AI grading ticks, repo target overrides, and artifact repo analysis.
- Preserved read-only assignment ownership checks for archived classrooms while adding a mutation-specific guard.
- Added regression coverage for the UTC-host Toronto date edge and archived assignment mutation rejection.

**Validation:**
- `bash .codex/skills/pika-session-start/scripts/session_start.sh`
- `pnpm test tests/unit/timezone.test.ts tests/unit/server-repo-review.test.ts tests/api/teacher/assignments-id-grade.test.ts tests/api/teacher/assignments-id-return.test.ts tests/api/teacher/assignments-auto-grade.test.ts tests/api/teacher/assignments-id-feedback-return.test.ts tests/api/teacher/assignments-artifact-repo-run.test.ts tests/api/teacher/assignment-auto-grade-runs.test.ts`
- `pnpm test tests/api/teacher/assignments-id-grade.test.ts tests/api/teacher/assignments-grade-selected.test.ts tests/api/teacher/assignments-id-return.test.ts tests/api/teacher/assignments-auto-grade.test.ts tests/api/teacher/assignments-id-feedback-return.test.ts tests/api/teacher/assignments-artifact-repo-run.test.ts tests/api/teacher/assignment-auto-grade-runs.test.ts tests/api/teacher/assignments-id.test.ts tests/api/teacher/assignments-id-students-studentId.test.ts`
- `bash .codex/skills/pika-audit/scripts/audit.sh`
- `pnpm lint`
- `pnpm test`
- `pnpm build`

## 2026-05-26 — Gradebook category settings retirement

**Completed:**
- Stopped the in-app gradebook route from loading legacy category settings that no longer affect final calculations.
- Kept per-assessment weight PATCH support and now rejects retired category-weight updates with a clear response.
- Updated published actual-course grading summaries to use the same per-assessment weights instead of `gradebook_settings`.
- Carried `gradebook_weight` through classroom blueprint source data for actual course site grading.

**Validation:**
- `bash .codex/skills/pika-session-start/scripts/session_start.sh`
- `pnpm test tests/api/teacher/gradebook.test.ts tests/unit/gradebook.test.ts`
- `pnpm test tests/components/TeacherGradebookTab.test.tsx tests/hooks/useGradebookData.test.ts`
- `pnpm test tests/api/teacher/gradebook.test.ts tests/unit/gradebook.test.ts tests/lib/server/course-sites.test.ts tests/lib/server/classroom-blueprint-source.test.ts`
- `pnpm tsc --noEmit`
- `bash .codex/skills/pika-audit/scripts/audit.sh`
- `git diff --check`
- `pnpm lint`
- `pnpm test`
- `pnpm build`

## 2026-05-26 — API route error-handler drift cleanup

**Completed:**
- Migrated the classroom reorder route and test clear-open-grades route from manual `try/catch` blocks to `withErrorHandler`.
- Preserved existing validation, access, and database error response behavior while centralizing auth/unknown error handling.
- Added a unit standards test that scans every API `route.ts` export and fails on unwrapped HTTP handlers, while allowing aliases to already wrapped handlers.

**Validation:**
- `pnpm test tests/api/teacher/tests-clear-open-grades.test.ts tests/api/teacher/classrooms-reorder.test.ts tests/unit/api-route-standards.test.ts`
- `bash .codex/skills/pika-audit/scripts/audit.sh`
- `git diff --check`
- `pnpm tsc --noEmit`
- `pnpm lint`
- `pnpm test`
- `pnpm build`

## 2026-05-26 — Gradebook assessment font weight cleanup

**Completed:**
- Reduced gradebook assessment column labels, score cells, summary score cells, and selected-student assessment detail rows to regular font weight.
- Kept student names and final marks emphasized so the gradebook still has clear scan anchors.

**Validation:**
- `pnpm test tests/components/TeacherGradebookTab.test.tsx`
- `pnpm lint`
- `git diff --check`
- `bash .codex/skills/pika-ui-verify/scripts/ui_verify.sh 'classrooms/e80aa794-e2d6-4705-9da5-d08ab0fba861?tab=gradebook'`
- Screenshots reviewed: `/tmp/pika-teacher.png`, `/tmp/pika-teacher-mobile.png`, `/tmp/pika-student.png`, `/tmp/pika-teacher-detail.png`, `/tmp/pika-teacher-dark.png`

## 2026-05-26 — Assignment unsubmit return-state guard

**Completed:**
- Added a shared assignment rule that only allows student unsubmit before the first teacher return.
- Blocked `/api/assignment-docs/[id]/unsubmit` from clearing submitted state after returned work, preserving teacher return queues for returned/resubmitted cycles.
- Updated student assignment action bars to hide `Unsubmit` when the returned submission state is no longer mutable.
- Moved repeated student assignment reads through `fetchJSONWithCache` with zero TTL so the audit pattern is satisfied without caching the first-view side effect.

**Validation:**
- `pnpm test tests/api/assignment-docs/unsubmit.test.ts tests/unit/assignments.test.ts tests/components/StudentAssignmentsTab.test.tsx`
- `pnpm test tests/api/assignment-docs tests/api/student/assignments.test.ts tests/components/StudentAssignmentsTab.test.tsx tests/components/StudentAssignmentEditor.feedback-card.test.tsx tests/unit/assignments.test.ts`
- `E2E_BASE_URL=http://localhost:3001 bash .codex/skills/pika-ui-verify/scripts/ui_verify.sh 'classrooms/e80aa794-e2d6-4705-9da5-d08ab0fba861?tab=assignments&assignmentId=71f8b37f-831b-4e90-89f9-f04981a97d6a'`
- Visual follow-up screenshots: `/tmp/pika-student-assignment-returned.png`, `/tmp/pika-teacher-assignment-loaded.png`
- `bash .codex/skills/pika-audit/scripts/audit.sh`
- `pnpm lint`
- `pnpm test`
- `pnpm build`

## 2026-05-26 — Mobile navigation drawer labels

**Completed:**
- Made the classroom mobile navigation drawer show tab labels beside icons even when the persisted desktop left rail is collapsed.
- Kept desktop collapsed-rail behavior icon-only with screen-reader labels and tooltips.
- Closed mobile drawer state when the viewport crosses to the desktop breakpoint so stale mobile state cannot affect the desktop rail.
- Added NavItems regression coverage for mobile-open labels and desktop-collapsed hidden labels.

**Validation:**
- `pnpm test tests/components/NavItems.test.tsx`
- `pnpm test tests/components/NavItems.test.tsx tests/components/ThreePanelProvider.test.tsx`
- `bash .codex/skills/pika-ui-verify/scripts/ui_verify.sh "classrooms/e80aa794-e2d6-4705-9da5-d08ab0fba861"`
- Playwright mobile drawer assertions for teacher and student labels.
- Screenshots: `/tmp/pika-teacher-mobile-menu.png`, `/tmp/pika-student-mobile-menu.png`
- `pnpm lint`
- `pnpm test`

## 2026-05-26 — Gradebook action cluster consistency

**Completed:**
- Replaced the gradebook all-purpose split-button with a focused floating action cluster: contextual email split-button, persistent score-display segmented control, and icon-only settings toggle.
- Kept email actions hidden until students are selected, matching the roster pattern and avoiding disabled placeholder actions.
- Updated gradebook component coverage for the new score-display, email, and settings controls.

**Validation:**
- `bash scripts/verify-env.sh`
- `pnpm vitest run tests/components/TeacherGradebookTab.test.tsx`
- `pnpm tsc --noEmit`
- `pnpm e2e:auth`
- `bash .codex/skills/pika-ui-verify/scripts/ui_verify.sh 'classrooms/e80aa794-e2d6-4705-9da5-d08ab0fba861?tab=gradebook'`
- Screenshots reviewed: `/tmp/pika-teacher.png`, `/tmp/pika-teacher-mobile.png`, `/tmp/pika-student.png`, `/tmp/pika-teacher-gradebook-selected.png`, `/tmp/pika-teacher-mobile-gradebook-selected.png`
- `pnpm lint`
- `pnpm test`
- `pnpm build`

## 2026-05-26 — Student test submit overwrite guard

**Completed:**
- Changed student test final submission to insert response rows instead of upserting over existing final answers.
- Mapped unique response conflicts to the existing "already responded" response and skipped attempt finalization after the conflict.
- Preserved the first-submit path for blank placeholder grading rows by deleting those placeholder rows by id before final insert.
- Added API coverage for insert-only submission, placeholder cleanup, unique-conflict handling, and conditional attempt finalization.

**Validation:**
- `bash .codex/skills/pika-session-start/scripts/session_start.sh`
- `pnpm test tests/api/student/tests-respond.test.ts`
- `pnpm tsc --noEmit`
- `pnpm test tests/api/student/tests-respond.test.ts tests/api/student/tests-attempt.test.ts tests/api/student/tests-id.test.ts tests/api/student/tests-route.test.ts tests/api/student/tests-session-status.test.ts tests/api/student/tests-results.test.ts tests/api/student/tests-history.test.ts tests/api/student/tests-focus-events.test.ts tests/api/teacher/tests-results.test.ts tests/api/teacher/tests-return.test.ts`
- `git diff --check`
- `pnpm lint`
- `pnpm test`
- `pnpm build`
- `bash .codex/skills/pika-audit/scripts/audit.sh`

## 2026-05-26 — Auth password handoff binding

**Completed:**
- Bound signup password creation and password reset confirmation to short-lived one-time handoff tokens issued only after code verification.
- Stored only hashed handoff tokens on `verification_codes`, with expiry and consumed timestamps guarded by a filtered update.
- Passed signup handoff tokens through `sessionStorage` instead of URL query strings and kept reset handoff tokens in page state.
- Added migration `076_add_auth_handoff_tokens.sql` plus auth API and crypto coverage for missing, invalid/reused, and valid token paths.

**Validation:**
- `bash .codex/skills/pika-session-start/scripts/session_start.sh`
- `pnpm test tests/unit/crypto.test.ts tests/api/auth/verify-signup.test.ts tests/api/auth/create-password.test.ts tests/api/auth/reset-password/verify.test.ts tests/api/auth/reset-password/confirm.test.ts`
- `pnpm tsc --noEmit`
- `pnpm test tests/api/auth`
- `git diff --check`
- `pnpm lint`
- `pnpm build`
- `pnpm test tests/unit/migration-filenames.test.ts`
- `pnpm test`
- `bash .codex/skills/pika-audit/scripts/audit.sh`

## 2026-05-26 — Request cache invalidation races

**Completed:**
- Added unit coverage for `fetchJSONWithCache` TTL reuse, in-flight dedupe, direct invalidation, prefix invalidation, and stale rejection races.
- Prevented invalidated pending requests from repopulating deleted cache entries after they resolve.
- Prevented invalidated pending rejections from deleting newer cached values for the same key.

**Validation:**
- `bash .codex/skills/pika-session-start/scripts/session_start.sh`
- `pnpm test tests/unit/request-cache.test.ts`
- `pnpm tsc --noEmit`
- `pnpm lint`
- `pnpm test`
- `pnpm build`
- `git diff --check`
- `bash .codex/skills/pika-audit/scripts/audit.sh`

## 2026-05-26 — Test grading mobile table fit

**Completed:**
- Constrained the teacher test grading student table on mobile/tablet by keeping actionable columns visible and moving telemetry columns to desktop widths.
- Added truncation for long student names and tightened mobile header spacing to avoid wrapped labels.
- Added component coverage for the responsive table constraints.

**Validation:**
- `bash .codex/skills/pika-session-start/scripts/session_start.sh`
- `pnpm test tests/components/TeacherTestsTab.test.tsx`
- `bash .codex/skills/pika-ui-verify/scripts/ui_verify.sh 'classrooms/e80aa794-e2d6-4705-9da5-d08ab0fba861?tab=tests&testId=210e30d4-f085-4c86-94d3-ee14bb66fd03&testMode=grading&testStudentId=d8f8a040-c511-4da2-98a8-be5bca37e1a6'`
- Screenshots reviewed: `/tmp/pika-teacher.png`, `/tmp/pika-teacher-mobile.png`, `/tmp/pika-student.png`
- Playwright overflow check: teacher mobile `documentScrollWidth=390`, `bodyScrollWidth=390`, viewport `390`
- `pnpm lint`
- `pnpm test`
- `pnpm build`
- `git diff --check`

## 2026-05-26 — Action bar viewport and menu coverage

**Completed:**
- Added direct `PageActionBar` coverage for desktop action groups, mobile overflow menu containers, menu ordering, destructive grouping, disabled items, selection close, Escape close, and outside-click close.
- Expanded teacher work-surface floating action cluster coverage for viewport max-width, fixed placement, visual chrome, floating center actions, and inline center actions.

**Validation:**
- `bash .codex/skills/pika-session-start/scripts/session_start.sh`
- `pnpm test tests/components/PageActionBar.test.tsx tests/components/TeacherWorkSurfaceActionBar.test.tsx tests/components/TeacherWorkSurfaceShell.test.tsx`
- `pnpm lint`
- `pnpm test`
- `pnpm build`
- `git diff --check`

## 2026-05-26 — Blueprint bulk sync stale-id guards

**Completed:**
- Rejected unknown blueprint assignment, assessment, and lesson template update IDs before bulk sync computes deletions.
- Rejected assessment updates outside the selected replacement type and rejected quiz/test type drift before deleting rows.
- Added regression coverage proving stale IDs fail with 400s and do not call the delete builder.

**Validation:**
- `bash .codex/skills/pika-session-start/scripts/session_start.sh`
- `pnpm test tests/lib/server/course-blueprints.test.ts tests/api/teacher/course-blueprints-route.test.ts`
- `git diff --check`
- `pnpm lint`
- `pnpm test`
- `pnpm build`

## 2026-05-26 — GitHub identity API coverage

**Completed:**
- Added focused API coverage for `GET/PATCH /api/account/github-identity`.
- Covered auth failures, null/saved identity loads, username normalization and format rejection, validation outcome persistence, missing storage 503s, and unexpected save failures.
- Asserted the Supabase upsert payload and `onConflict: 'user_id'` contract for saved GitHub identities.

**Validation:**
- `bash .codex/skills/pika-session-start/scripts/session_start.sh`
- `pnpm test tests/api/account/github-identity.test.ts`
- `git diff --check`
- `pnpm lint`
- `pnpm test tests/api/account/github-identity.test.ts tests/unit/api-route-standards.test.ts`
- `pnpm test`
- `pnpm build`

## 2026-05-26 — Archived gradebook mutation guards

**Completed:**
- Blocked gradebook assessment-weight PATCH requests when the classroom is archived while preserving read access.
- Blocked manual quiz override writes for archived classrooms by loading `archived_at` through the joined classroom relation.
- Added API regression coverage proving both archived paths return 403 before update/upsert work.

**Validation:**
- `bash .codex/skills/pika-session-start/scripts/session_start.sh`
- `pnpm test tests/api/teacher/gradebook.test.ts tests/api/teacher/gradebook-quiz-overrides.test.ts`
- `git diff --check`
- `pnpm lint`
- `pnpm test`
- `pnpm build`

## 2026-05-26 — Assignment duplicate-submit timestamp guard

**Completed:**
- Preserved the original `submitted_at` value when an already-submitted assignment doc receives a duplicate submit request.
- Kept fresh timestamps for first submissions and later resubmissions after the doc has been returned/unsubmitted.
- Added API regression coverage proving duplicate submit writes the first timestamp back instead of replacing it.

**Validation:**
- `bash .codex/skills/pika-session-start/scripts/session_start.sh`
- `pnpm test tests/api/assignment-docs/submit.test.ts`
- `git diff --check`
- `pnpm lint`
- `pnpm test`
- `pnpm build`

## 2026-05-26 — Gradebook settings clears hidden email selection

**Completed:**
- Cleared selected gradebook students whenever settings mode opens.
- Hid selected-student email actions while gradebook settings mode is active.
- Added component regression coverage for selecting a student, entering settings, and returning to grades without stale selection.

**Validation:**
- `bash .codex/skills/pika-session-start/scripts/session_start.sh`
- `pnpm test tests/components/TeacherGradebookTab.test.tsx`
- `bash .codex/skills/pika-ui-verify/scripts/ui_verify.sh 'classrooms/e80aa794-e2d6-4705-9da5-d08ab0fba861?tab=gradebook&gradebookSection=settings'`
- Browser regression screenshot: `/tmp/pika-teacher-gradebook-settings-after-selection.png`
- `git diff --check`
- `pnpm lint`
- `pnpm test`
- `pnpm build`

## 2026-05-26 — Selected test delete action

**Completed:**
- Added a destructive `Delete Test` action to the selected test workspace actions menu.
- Wired the selected-workspace delete action through the existing `onRequestDelete` callback, with the component's internal delete confirmation as fallback.
- Updated component coverage for the selected-test action menu and delete callback path.

**Validation:**
- `bash .codex/skills/pika-session-start/scripts/session_start.sh`
- `pnpm test tests/components/TeacherTestsTab.test.tsx`
- `bash .codex/skills/pika-ui-verify/scripts/ui_verify.sh 'classrooms/e80aa794-e2d6-4705-9da5-d08ab0fba861?tab=tests&testId=210e30d4-f085-4c86-94d3-ee14bb66fd03&testMode=grading'`
- Browser menu screenshot: `/tmp/pika-teacher-tests-delete-action-menu.png`
- `git diff --check`
- `pnpm lint`
- `pnpm test`
- `pnpm build`

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
