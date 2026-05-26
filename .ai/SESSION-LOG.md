# Pika Session Log

Rolling recent session log for AI/human handoffs. Keep this file small; full historical session history lives in `.ai/JOURNAL-ARCHIVE.md`.

**Rules:**
- Append one concise entry for meaningful work at the end of a session.
- Run `node scripts/trim-session-log.mjs` after appending to keep only the latest 20 entries.
- Use `.ai/JOURNAL-ARCHIVE.md` only for historical investigation.

## 2026-05-21 — Developer feedback idempotent last-seen fix

**Completed:**
- Updated the developer feedback candidate upsert so duplicate classroom/date reruns preserve `last_seen_at` and `last_seen_date`.
- Tightened the migration regression test to cover ranking timestamp preservation, not just count preservation.

**Validation:**
- `pnpm test tests/unit/developer-log-feedback.test.ts tests/api/cron/nightly-log-summaries.test.ts`
- `pnpm lint`
- `pnpm build`
- `git diff --check`

## 2026-05-21 — Developer feedback migration filename

**Completed:**
- Renamed the developer feedback migration from the timestamped Supabase filename to Pika's sequential migration convention: `070_developer_feedback_candidates.sql`.
- Updated the migration regression test to read the renamed file.

**Validation:**
- `pnpm test tests/unit/developer-log-feedback.test.ts`
- Migration duplicate-prefix check
- Migration filename convention check

## 2026-05-21 — Migration filename CI guard

**Completed:**
- Added a Vitest guard for Supabase migration filenames so CI rejects non-`NNN_snake_case.sql` files.
- The guard also rejects duplicate migration prefixes and gaps in the numeric sequence.

**Validation:**
- `bash .codex/skills/pika-session-start/scripts/session_start.sh`
- `pnpm test tests/unit/migration-filenames.test.ts`
- `pnpm test tests/unit/migration-filenames.test.ts tests/unit/ai-startup-docs.test.ts`
- `pnpm lint`
- `git diff --check`

## 2026-05-22 — Assignment student list scroll persistence

**Completed:**
- Persisted assignment student-list scroll memory to session storage for the teacher assignment workspace.
- Made scroll restoration run across the next layout frames so split-pane refreshes and route reloads do not leave the list at the top.
- Added hook regression coverage for session-backed scroll restoration after remount.

**Validation:**
- `bash .codex/skills/pika-session-start/scripts/session_start.sh`
- `pnpm test tests/hooks/useScrollPositionMemory.test.tsx`
- `pnpm test tests/components/TeacherClassroomView.test.tsx tests/components/TeacherAssignmentStudentTable.test.tsx`
- `pnpm lint`
- `pnpm test`
- `E2E_BASE_URL=http://localhost:3001 bash .codex/skills/pika-ui-verify/scripts/ui_verify.sh "classrooms/e285be41-5add-4baf-8ac7-d476ec365cad?tab=assignments&assignmentId=1bd43274-afe7-472c-90c9-5b704d83e4b2&assignmentStudentId=e0d9c4e7-2a88-4428-bd15-ba87f2d935b7"`
- Targeted Playwright long-list check: selected Student65 and reloaded; `scrollTop` remained `1500`.

## 2026-05-23 — Draft question sync helper

**Completed:**
- Refactored quiz/test draft question syncing to use a shared helper in `src/lib/server/assessment-drafts.ts` (keeps behavior + error strings the same, reduces drift risk).
- Added unit coverage for the quiz sync insert-failure path.
- Draft PR: https://github.com/codepetca/pika/pull/619

**Validation:**
- `bash scripts/verify-env.sh`
- `pnpm test tests/unit/assessment-drafts.test.ts`
- `pnpm test`
- `pnpm lint`

## 2026-05-22 — Gradebook identity column fixes

**Completed:**
- Defaulted the gradebook ID column to hidden while keeping it available in settings.
- Added a strong separator after the last rendered identity column, including the First-only case.
- Replaced fixed identity widths/sticky offsets with resizable First, Last, and ID column widths.

**Validation:**
- `bash .codex/skills/pika-session-start/scripts/session_start.sh`
- `pnpm test tests/components/TeacherGradebookTab.test.tsx`
- `pnpm test`
- `pnpm lint`
- `pnpm build`
- `bash .codex/skills/pika-ui-verify/scripts/ui_verify.sh 'classrooms/e285be41-5add-4baf-8ac7-d476ec365cad?tab=gradebook'`
- Playwright first-only separator and drag check on the seeded gradebook page

## 2026-05-23 — Gradebook Final column separator

**Completed:**
- Added a strong separator before the Final grade column across gradebook header, student, and summary rows.
- Covered the separator with focused gradebook component expectations.

**Validation:**
- `bash .codex/skills/pika-session-start/scripts/session_start.sh`
- `pnpm test tests/components/TeacherGradebookTab.test.tsx`
- `pnpm lint`
- `bash .codex/skills/pika-ui-verify/scripts/ui_verify.sh 'classrooms/e285be41-5add-4baf-8ac7-d476ec365cad?tab=gradebook'`

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
