# Pika Session Log

Rolling recent session log for AI/human handoffs. Keep this file small; full historical session history lives in `.ai/JOURNAL-ARCHIVE.md`.

**Rules:**
- Append one concise entry for meaningful work at the end of a session.
- Run `node scripts/trim-session-log.mjs` after appending to keep only the latest 20 entries.
- Use `.ai/JOURNAL-ARCHIVE.md` only for historical investigation.

## 2026-05-23 — Gradebook Final column resize

**Completed:**
- Made the Final grade column resizable from the separator line before it.
- Kept the Final column width synchronized across header, student rows, and summary rows.
- Added keyboard-accessible resize coverage for the Final column.

**Validation:**
- `pnpm test tests/components/TeacherGradebookTab.test.tsx`
- `pnpm lint`
- `bash .codex/skills/pika-ui-verify/scripts/ui_verify.sh 'classrooms/e285be41-5add-4baf-8ac7-d476ec365cad?tab=gradebook'`
- Playwright Final separator drag check on the seeded gradebook page

## 2026-05-23 — Gradebook split FAB actions

**Completed:**
- Replaced the gradebook floating score/settings controls with a split-button FAB.
- Moved Show % / Show Raw into the split menu and kept Settings as the no-selection primary action.
- Added selected-student actions for default email, Gmail, Outlook, and copying selected student emails.
- Refactored the shared SplitButton menu options to support checked states, leading icons, and dividers; gradebook uses those shared props for the score/email grouping.

**Validation:**
- `bash .codex/skills/pika-session-start/scripts/session_start.sh`
- `pnpm test tests/ui/SplitButton.test.tsx tests/components/TeacherGradebookTab.test.tsx`
- `pnpm test`
- `pnpm lint`
- `pnpm build`
- `bash .codex/skills/pika-ui-verify/scripts/ui_verify.sh 'classrooms/e285be41-5add-4baf-8ac7-d476ec365cad?tab=gradebook'`
- Playwright checks for unselected and selected gradebook action menus, including checked score state and divider count

## 2026-05-24 — Student exam away-focus e2e

**Completed:**
- Added focused Playwright coverage for a student active test away/focus restoration cycle.
- Verified the open-response draft stays visible and mounted after focus returns.
- Asserted student focus telemetry records one away/focus event in both API detail and the visible exam summary.

**Validation:**
- `bash .codex/skills/pika-session-start/scripts/session_start.sh` (first run failed until dependencies were installed and session log was trimmed)
- `bash scripts/verify-env.sh`
- `pnpm exec playwright test e2e/student-exam-mode.spec.ts --project=chromium-desktop`
- `pnpm lint`

## 2026-05-23 — Roster delete action in FAB menu

**Completed:**
- Moved roster removal from the details pane into the floating roster actions dropdown.
- Added an atomic roster removal RPC plus a bulk-delete action route so selected multi-row removal is one server-side operation.
- Updated the existing single-row DELETE route to use the same atomic roster removal path.
- Added component coverage for opening the roster FAB dropdown, choosing Remove student/students, and confirming deletion.
- Updated retry behavior so failed bulk deletion keeps the full selected set pending instead of retrying partial client-side deletes.

**Validation:**
- `pnpm test tests/components/TeacherRosterTab.test.tsx`
- `pnpm lint`
- `pnpm test tests/components/TeacherRosterTab.test.tsx tests/api/teacher/roster-rosterId.test.ts`
- `pnpm test tests/components/TeacherRosterTab.test.tsx tests/api/teacher/roster-rosterId.test.ts tests/api/teacher/roster-bulk-delete.test.ts tests/unit/roster-removal-migration.test.ts tests/unit/migration-filenames.test.ts`
- `psql 'postgresql://postgres:postgres@127.0.0.1:54322/postgres' -v ON_ERROR_STOP=1 -f supabase/migrations/071_atomic_roster_bulk_removal.sql`
- `select public.remove_classroom_roster_entries_atomic('00000000-0000-0000-0000-000000000000'::uuid, array[]::uuid[])`
- `git diff --check`
- Targeted Playwright screenshot: `/tmp/pika-roster-multi-delete-dropdown.png`
- `E2E_BASE_URL=http://127.0.0.1:3100 bash .codex/skills/pika-ui-verify/scripts/ui_verify.sh 'classrooms/e285be41-5add-4baf-8ac7-d476ec365cad?tab=roster'`
- Playwright screenshots: `/tmp/pika-roster-dropdown.png`, `/tmp/pika-roster-remove-confirm.png`, `/tmp/pika-roster-dropdown-dark.png`

## 2026-05-24 — Atomic selected test-work delete

**Completed:**
- Added migration `072_atomic_test_work_bulk_delete.sql` with `delete_student_test_attempts_atomic(p_test_id, p_student_ids)`.
- Added a bulk selected test-work delete route that validates all selected students are enrolled and calls one RPC.
- Updated the teacher Tests selected-delete flow to POST once instead of looping per-student DELETE calls.
- Added API, migration, and component coverage for success, validation, missing-RPC guidance, and retry-safe failure state.

**Validation:**
- `pnpm test tests/api/teacher/tests-student-attempts-bulk-delete.test.ts tests/unit/test-work-bulk-delete-migration.test.ts tests/components/TeacherTestsTab.test.tsx`
- `pnpm test tests/api/teacher/tests-student-attempt-delete.test.ts tests/api/teacher/tests-student-attempts-bulk-delete.test.ts tests/unit/test-work-bulk-delete-migration.test.ts tests/unit/migration-filenames.test.ts`
- `pnpm lint`
- `supabase migration list --local`
- `supabase db lint --local --fail-on error` (passes; existing warning on `public.unsubmit_test_attempts_atomic` unused parameter)
- `supabase migration up --local`
- `supabase db query --local "select public.delete_student_test_attempts_atomic('00000000-0000-0000-0000-000000000001'::uuid, array['00000000-0000-0000-0000-000000000002'::uuid]) as result;"`
- `pnpm build`
- `pnpm test`
- `bash .codex/skills/pika-ui-verify/scripts/ui_verify.sh 'classrooms/e285be41-5add-4baf-8ac7-d476ec365cad?tab=tests'`
- Focused Playwright screenshot: `/tmp/pika-test-work-bulk-delete-dialog.png`

## 2026-05-25 — Assignment submission requirements MVP

**Completed:**
- Added assignment-level structured submission requirements for `repo_link`, `link`, and `image` with Supabase tables, RLS, and private image storage.
- Added student artifact APIs and UI checklist; required artifacts now gate submission and can feed grading/repo-review flows.
- Added account-level GitHub identity storage/validation and reused it for repo requirements.
- Added teacher assignment modal controls for adding, editing, ordering, and removing requirements.
- Added blueprint assignment markdown support via `### Submission Requirements`, plus blueprint storage and classroom instantiation into assignment requirements.
- Removed server-side fetching of arbitrary public-link artifacts; generic links are format-validated only.
- Blocked invalid/inaccessible submitted artifacts from satisfying required submission gates.
- Added atomic requirement replacement RPC so teacher requirement edits cannot partially delete student artifacts.
- Preserved existing requirement IDs on teacher edits so student artifacts remain attached; refreshed screenshot signed URLs from storage paths.
- Added screenshot replacement cleanup for replaced files and failed DB writes.
- Folded the atomic replacement RPC into the base assignment submission requirements migration and removed the unapplied follow-up migration.
- Returned and rendered structured artifacts in the teacher individual work pane so artifact-only submissions do not appear empty.
- Merged structured artifacts with rich-text artifacts in the teacher assignment roster instead of replacing rich-text artifacts.
- Preserved inaccessible/invalid GitHub username validation state when saving account-level identity from repo artifacts.
- Fixed background assignment AI grading run creation so artifact-only submissions are queued instead of being skipped as empty.

**Follow-up:**
- Add teacher-side image storage cleanup when a submission requirement is deleted. The DB cascade removes related `assignment_submission_artifacts` rows, but image objects referenced by those rows are not currently removed from storage in that delete path.

**Validation:**
- `bash .codex/skills/pika-session-start/scripts/session_start.sh`
- `supabase migration up --local`
- `pnpm exec tsc --noEmit`
- `pnpm lint`
- `pnpm test`

## 2026-05-25 — Assignment artifact storage cleanup follow-up

**Completed:**
- Added best-effort teacher-side cleanup for `assignment-artifacts` image objects when image submission requirements are removed.
- Added best-effort cleanup for image artifact objects after teacher assignment deletion succeeds.
- Preserved storage objects when an image requirement is edited/reordered/renamed with the same requirement ID and type.
- Added chunked Storage `remove()` calls with failure logging that does not fail successful teacher mutations.

**Validation:**
- `bash .codex/skills/pika-session-start/scripts/session_start.sh`
- `pnpm test tests/api/teacher/assignments-id.test.ts`
- `pnpm test tests/lib/assignment-submission-artifacts.test.ts tests/api/assignment-docs/artifacts.test.ts`
- `pnpm lint`
- `pnpm build`
- `pnpm build`
- `pnpm exec vitest run tests/unit/assignment-submission-validation.test.ts`
- `pnpm exec vitest run tests/lib/assignment-submission-artifacts.test.ts tests/unit/assignment-submission-validation.test.ts`
- `pnpm exec vitest run tests/unit/assignment-submission-validation.test.ts tests/lib/assignment-submission-requirements.test.ts tests/lib/assignment-submission-artifacts.test.ts tests/api/assignment-docs/artifacts.test.ts`
- `psql 'postgresql://postgres:postgres@127.0.0.1:54322/postgres' -v ON_ERROR_STOP=1 -c "begin;" -c "with target_assignment as (select id from public.assignments limit 1), replaced as (select r.* from target_assignment t cross join lateral public.replace_assignment_submission_requirements_atomic(t.id, '[{\"type\":\"link\",\"label\":\"Smoke public link\",\"required\":true,\"position\":0}]'::jsonb) r) select count(*) as replaced_count from replaced;" -c "rollback;"`
- `psql 'postgresql://postgres:postgres@127.0.0.1:54322/postgres' -v ON_ERROR_STOP=1 -c "select has_function_privilege('anon', 'public.replace_assignment_submission_requirements_atomic(uuid, jsonb)', 'execute') as anon_execute, has_function_privilege('authenticated', 'public.replace_assignment_submission_requirements_atomic(uuid, jsonb)', 'execute') as authenticated_execute, has_function_privilege('service_role', 'public.replace_assignment_submission_requirements_atomic(uuid, jsonb)', 'execute') as service_role_execute;"`
- `bash .codex/skills/pika-ui-verify/scripts/ui_verify.sh 'classrooms/e285be41-5add-4baf-8ac7-d476ec365cad?tab=assignments'`
- Focused Playwright screenshots: `/tmp/pika-teacher-requirements-modal.png`, `/tmp/pika-student-requirements-checklist-clean.png`
- `pnpm test tests/unit/migration-filenames.test.ts`
- `pnpm test tests/unit/assignment-submission-validation.test.ts tests/components/TeacherStudentWorkPanel.test.tsx tests/api/teacher/assignments-id.test.ts tests/api/assignment-docs/artifacts.test.ts tests/lib/assignment-submission-requirements.test.ts tests/lib/assignment-submission-artifacts.test.ts`
- `git diff --check`
- `bash .codex/skills/pika-ui-verify/scripts/ui_verify.sh 'classrooms/e285be41-5add-4baf-8ac7-d476ec365cad?tab=assignments'`
- Focused Playwright screenshot: `/tmp/pika-teacher-artifact-content-pane.png`
- `pnpm exec vitest run tests/lib/assignment-ai-grading-runs.test.ts tests/unit/ai-grading.test.ts`
- `pnpm exec tsc --noEmit`
- `pnpm lint`
- `pnpm test`

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
