# Pika Session Log

Rolling recent session log for AI/human handoffs. Keep this file small; full historical session history lives in `.ai/JOURNAL-ARCHIVE.md`.

**Rules:**
- Append one concise entry for meaningful work at the end of a session.
- Run `node scripts/trim-session-log.mjs` after appending to keep only the latest 20 entries.
- Use `.ai/JOURNAL-ARCHIVE.md` only for historical investigation.

## 2026-05-25 — Supabase RLS/Auth hardening for WorkOS

**Completed:**
- Added migration `075_auth_rls_hardening.sql` with `users.workos_user_id` unique mapping while preserving local UUID user IDs.
- Enabled RLS and explicit no-direct-access policies on announcements, announcement reads, gradebook settings, quiz score overrides, and report-card tables.
- Revoked direct public table/sequence/function grants from `anon` and `authenticated`, preserved `service_role`, and hardened migration-owner default privileges.
- Removed direct authenticated upload/delete storage policies for legacy public buckets while keeping public read behavior.
- Set stable `search_path` on existing public functions surfaced by Supabase security advisors.
- Updated architecture/AI guidance for the server-route authorization model and WorkOS posture.

**Validation:**
- `psql 'postgresql://postgres:postgres@127.0.0.1:54322/postgres' -v ON_ERROR_STOP=1 -1 -f supabase/migrations/075_auth_rls_hardening.sql`
- Metadata checks for RLS, grants, policies, default privileges, and WorkOS index.
- `supabase db lint --local --schema public,storage --fail-on none` (passes with pre-existing warnings only)
- `supabase db advisors --local --type security --level warn --fail-on none`
- `pnpm test tests/api/teacher/announcements.test.ts tests/api/teacher/announcements-id.test.ts tests/api/student/announcements.test.ts tests/api/teacher/gradebook.test.ts tests/api/teacher/gradebook-quiz-overrides.test.ts tests/unit/auth-rls-hardening-migration.test.ts tests/unit/migration-filenames.test.ts`
- `pnpm exec tsc --noEmit`
- `pnpm lint`
- `git diff --check`

## 2026-05-25 — Assignment artifact open behavior

**Completed:**
- Changed assignment artifact pills so a single artifact opens directly as an external link.
- Replaced the multi-artifact preview carousel with a narrow chooser dialog listing each artifact as a direct external link.
- Added component coverage for direct-link mode and the multi-artifact chooser.

**Validation:**
- `bash .codex/skills/pika-session-start/scripts/session_start.sh`
- `pnpm test -- tests/components/AssignmentArtifactsCell.test.tsx` (ran full suite; pass)
- `pnpm lint`
- `E2E_BASE_URL=http://localhost:3001 bash .codex/skills/pika-ui-verify/scripts/ui_verify.sh 'classrooms/e285be41-5add-4baf-8ac7-d476ec365cad?tab=assignments&assignmentId=f2bc083c-cec5-4b36-8659-603f84e11ff6'`
- Playwright interaction smoke: multi-artifact chooser opens; single-artifact row opens `https://github.com/codepetca/pika`
- Screenshot: `/tmp/pika-teacher-artifact-chooser.png`

## 2026-05-25 — Assignment student table artifact UX

**Completed:**
- Rebased `codex/assignment-artifact-open-behavior` onto `origin/main` after assignment submission requirements landed.
- Updated the teacher assignment student table to use compact `First`, `Last`, `Status`, and `Grade` columns with keyboard/pointer resize handles.
- Converted artifact cells to icon-number pills so the table shows repo/link/image type plus `1`, `2`, `3`, etc. without URL text.
- Changed artifact pill hover tooltips to show the full artifact set as a compact stacked list, with the hovered item highlighted.
- Kept single artifacts opening directly and multi-artifact rows opening the narrow chooser dialog.

**Validation:**
- `pnpm exec vitest run tests/components/AssignmentArtifactsCell.test.tsx tests/components/TeacherAssignmentStudentTable.test.tsx`
- `pnpm lint`
- `pnpm exec tsc --noEmit`
- `E2E_BASE_URL=http://localhost:3001 pnpm e2e:auth`
- `E2E_BASE_URL=http://localhost:3001 bash .codex/skills/pika-ui-verify/scripts/ui_verify.sh 'classrooms/e80aa794-e2d6-4705-9da5-d08ab0fba861?tab=assignments&assignmentId=34d744b5-2644-4ca1-baf2-e86270d0590a'`
- Playwright interaction smoke: first-column resize changed from `72` to `88`; first artifact pill text was `1`; chooser showed `4 work items`.
- Playwright hover smoke: artifact tooltip showed `4 artifacts` as a stacked list.
- Screenshots: `/tmp/pika-teacher-ready.png`, `/tmp/pika-teacher-mobile.png`, `/tmp/pika-student.png`, `/tmp/pika-teacher-artifact-icon-chooser.png`, `/tmp/pika-teacher-artifact-tooltip-list.png`

## 2026-05-25 — Assignment artifact hover dropdown links

**Completed:**
- Made assignment artifact hover lists interactive so the pointer can move from an artifact pill into the dropdown.
- Converted hover-list artifact rows into external links while preserving the existing pill-click chooser/direct-link behavior.
- Added component coverage for clicking a hover-list artifact without opening the chooser or bubbling to parent row handlers.

**Validation:**
- `bash .codex/skills/pika-session-start/scripts/session_start.sh`
- `pnpm test tests/components/AssignmentArtifactsCell.test.tsx`
- `pnpm lint`
- `bash .codex/skills/pika-ui-verify/scripts/ui_verify.sh 'classrooms/e80aa794-e2d6-4705-9da5-d08ab0fba861?tab=assignments&assignmentId=34d744b5-2644-4ca1-baf2-e86270d0590a'`
- Playwright hover smoke: hovered artifact pill, moved into dropdown link, verified trial click to `https://github.com/vercel/next.js/tree/canary`.
- Screenshots: `/tmp/pika-teacher-loaded.png`, `/tmp/pika-student.png`, `/tmp/pika-teacher-mobile.png`, `/tmp/pika-artifacts-hover.png`
- `pnpm test`

## 2026-05-26 — Nested GitHub artifact classification

**Completed:**
- Constrained inferred repo artifacts to root GitHub repository URLs only.
- Kept nested GitHub URLs such as `/tree`, `/blob`, and `/issues` classified as normal links.
- Preserved explicit structured `repo_link` artifacts and root GitHub repo links as repo artifacts.
- Moved root-repo detection into the shared GitHub helper, fixed exact GitHub host matching, and blocked known GitHub product routes such as `/orgs`, `/topics`, and `/settings` from repo detection.

**Validation:**
- `pnpm test tests/lib/assignment-artifacts.test.ts tests/unit/assignment-repo-targets.test.ts tests/components/AssignmentArtifactsCell.test.tsx`
- `pnpm test tests/lib/assignment-artifacts.test.ts tests/unit/select-and-github-repos.test.tsx tests/unit/assignment-repo-targets.test.ts tests/components/AssignmentArtifactsCell.test.tsx`
- `pnpm test tests/unit/assignment-submission-validation.test.ts tests/unit/repo-review.test.ts tests/unit/repo-review-validation.test.ts tests/api/assignment-docs/artifacts.test.ts`
- `pnpm lint`
- `pnpm test tests/components/TeacherStudentWorkPanel.test.tsx` after a full-suite timeout in that unrelated file
- `pnpm test tests/api/auth/verify-signup.test.ts` after a second full-suite timeout in that unrelated file
- `bash .codex/skills/pika-ui-verify/scripts/ui_verify.sh 'classrooms/e80aa794-e2d6-4705-9da5-d08ab0fba861?tab=assignments&assignmentId=34d744b5-2644-4ca1-baf2-e86270d0590a'`
- Playwright artifact smoke: root `github.com/codepetca/pika` stayed `Repo`; nested `github.com/vercel/next.js/tree/canary` rendered/clicked as `Link`.
- Screenshots: `/tmp/pika-teacher-artifact-types-loaded.png`, `/tmp/pika-artifact-link-hover.png`, `/tmp/pika-artifact-root-vs-link-hover.png`

## 2026-05-26 — Student daily log background refresh

**Completed:**
- Changed the student Today tab so sessionStorage history is only an instant preview, not the final source of truth.
- Added a direct capped background `/api/student/entries?limit=12` refresh on mount to update cross-device daily logs.
- Guarded the editor so an in-flight refresh cannot overwrite a local edit started by the student.
- Fixed the reverted-edit edge case so a refresh can apply server content after local text returns to the saved value.
- Updated StudentTodayTab history coverage for preview-first refresh and local-edit protection.

**Validation:**
- `pnpm test tests/components/StudentTodayTabHistory.test.tsx`
- `pnpm lint`
- `pnpm exec tsc --noEmit`
- `git diff --check`
- `E2E_BASE_URL=http://localhost:3003 bash .codex/skills/pika-ui-verify/scripts/ui_verify.sh 'classrooms/e80aa794-e2d6-4705-9da5-d08ab0fba861?tab=today'`
- Warm screenshots reviewed: `/tmp/pika-student-today-final.png`, `/tmp/pika-teacher-mobile-warm.png`

## 2026-05-26 — Teacher artifact table refresh

**Completed:**
- Added a refresh control to the teacher assignment workspace action bar so teachers can re-query selected assignment details after students submit structured artifacts.
- Kept the refresh scoped to the selected assignment detail endpoint that already merges structured submission artifacts into the student table artifact cells.
- Added component coverage confirming the action bar refresh performs a second assignment-detail fetch.

**Validation:**
- `pnpm test tests/components/TeacherClassroomView.test.tsx`
- `pnpm lint`
- `git diff --check`
- `bash .codex/skills/pika-ui-verify/scripts/ui_verify.sh 'classrooms/e80aa794-e2d6-4705-9da5-d08ab0fba861?tab=assignments&assignmentId=34d744b5-2644-4ca1-baf2-e86270d0590a'`
- Playwright screenshot after settled teacher load: `/tmp/pika-teacher-refresh-submissions.png`

## 2026-05-26 — Assignment modal title row cleanup

**Completed:**
- Moved assignment preview into the title row beside the title and due-date controls.
- Moved assignment autosave status into the title label row above the textbox.
- Removed the separate Instructions label above the markdown editor.
- Moved the required submissions editor above the instructions textarea.
- Compressed the required submissions empty state into a one-line card with an icon split button for Link, Repo, and Image submissions.
- Changed the primary split-button label to `+` plus the link icon and `link`.
- Removed the required-submissions `None` / item-count subline so the card header stays single-line.
- Hid the per-submission Label and Instructions captions while keeping accessible labels; new submissions show the default label inside the textbox and `Optional helper text` as the helper textbox placeholder.
- Made required-submission rows draggable from their grip handles and removed the up/down arrow reorder buttons.
- Stabilized required-submission sortable IDs so rows keep identity during drop animations.
- Guarded assignment autosave responses so older saves cannot replace newer local required-submission edits while a drag/reorder is in progress.
- Added a confirmation dialog before removing persisted required submissions; unsaved newly added rows still remove immediately.
- Switched the required-submissions add control to the shared green `SplitButton` success variant.
- Updated required-submission split add labels to read `+ Link`, `+ Repo`, and `+ Image` with each type icon after the label.
- Changed the required-submissions primary add label to `+ Add` and made that primary side open the type dropdown instead of defaulting to a link submission.
- Replaced the required-submissions image option camera glyph with Lucide's image icon.

**Validation:**
- `pnpm test tests/components/AssignmentModal.test.tsx`
- `pnpm test tests/ui/SplitButton.test.tsx tests/components/AssignmentModal.test.tsx`
- `pnpm lint`
- `git diff --check`
- `E2E_BASE_URL=http://localhost:3001 bash .codex/skills/pika-ui-verify/scripts/ui_verify.sh 'classrooms/e80aa794-e2d6-4705-9da5-d08ab0fba861?tab=assignments'`
- Modal screenshots: `/tmp/pika-assignment-modal-teacher.png`, `/tmp/pika-assignment-modal-teacher-mobile.png`
- Required submissions screenshots: `/tmp/pika-assignment-modal-required-submissions.png`, `/tmp/pika-assignment-modal-required-submissions-menu.png`, `/tmp/pika-assignment-modal-required-submissions-mobile.png`, `/tmp/pika-assignment-modal-required-submissions-menu-mobile.png`, `/tmp/pika-assignment-modal-required-submissions-added-desktop.png`, `/tmp/pika-assignment-modal-required-submissions-added-mobile.png`
- Final required submissions screenshots: `/tmp/pika-assignment-modal-required-submissions-final-desktop.png`, `/tmp/pika-assignment-modal-required-submissions-final-mobile.png`, `/tmp/pika-assignment-modal-required-submissions-final-menu.png`
- Drag smoke screenshot: `/tmp/pika-assignment-modal-required-submissions-dragged.png`
- Mobile draggable screenshot: `/tmp/pika-assignment-modal-required-submissions-draggable-mobile.png`
- Stable drag screenshots: `/tmp/pika-assignment-modal-required-submissions-stable-before.png`, `/tmp/pika-assignment-modal-required-submissions-stable-during.png`, `/tmp/pika-assignment-modal-required-submissions-stable-after.png`
- Settled student screenshot after UI verify timeout: `/tmp/pika-student-settled.png`
- Removal confirmation screenshots: `/tmp/pika-teacher-settled.png`, `/tmp/pika-assignment-modal-remove-required-submission-confirm.png`
- Green split button screenshot: `/tmp/pika-assignment-modal-green-submission-split-desktop.png`
- Updated green split button label screenshots: `/tmp/pika-assignment-modal-green-submission-split-label-desktop.png`, `/tmp/pika-assignment-modal-green-submission-split-label-mobile.png`
- Generic add dropdown screenshots: `/tmp/pika-assignment-modal-add-submission-dropdown-desktop.png`, `/tmp/pika-assignment-modal-add-submission-dropdown-mobile.png`
- Image icon dropdown screenshots: `/tmp/pika-assignment-modal-image-icon-dropdown-desktop.png`, `/tmp/pika-assignment-modal-image-icon-dropdown-mobile.png`

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
