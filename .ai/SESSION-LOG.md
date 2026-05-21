# Pika Session Log

Rolling recent session log for AI/human handoffs. Keep this file small; full historical session history lives in `.ai/JOURNAL-ARCHIVE.md`.

**Rules:**
- Append one concise entry for meaningful work at the end of a session.
- Run `node scripts/trim-session-log.mjs` after appending to keep only the latest 20 entries.
- Use `.ai/JOURNAL-ARCHIVE.md` only for historical investigation.

## 2026-05-19 — Survey open-state question-count refresh

**Completed:**
- Fixed the selected-survey action bar so adding, deleting, or markdown-syncing survey questions updates the parent survey `questions_count` immediately.
- Added regression coverage for a draft survey becoming openable after its first question is added in the edit modal.

**Validation:**
- `pnpm test tests/components/TeacherClassroomView.test.tsx tests/components/TeacherSurveyWorkspace.test.tsx`
- `pnpm lint`
- `pnpm build`
- `E2E_BASE_URL=http://localhost:3030 bash /Users/stew/Repos/pika/.codex/skills/pika-ui-verify/scripts/ui_verify.sh 'classrooms/5fcf845d-220d-4321-8409-5afe9e9459c3?tab=assignments'`
- Targeted Playwright smoke created a temporary draft survey, confirmed `Open poll` was disabled before adding a question and enabled after adding the first question in the modal, then deleted the temporary survey. Screenshot: `/tmp/pika-survey-question-count-enabled.png`.

## 2026-05-19 — Survey PR merge prep

**Completed:**
- Rebasing/push left GitHub CI blocked only by the rolling session-log size check.
- Trimmed `.ai/SESSION-LOG.md` back under the documented 20-entry limit before merging PR #595.

**Validation:**
- `pnpm test tests/unit/ai-startup-docs.test.ts`

## 2026-05-19 — Survey creation preview option

**Completed:**
- Added a Preview mode to the teacher survey authoring modal with a student-style response layout for multiple-choice, text, and link questions.
- Kept preview responses local to the modal so teachers can click through the survey without saving anything.
- Added regression coverage for opening preview and selecting an option without issuing a survey PATCH.

**Validation:**
- `bash /Users/stew/Repos/.worktrees/pika/survey-preview/.codex/skills/pika-session-start/scripts/session_start.sh`
- `pnpm test tests/components/TeacherSurveyWorkspace.test.tsx`
- `pnpm lint`
- `pnpm build`
- `E2E_BASE_URL=http://localhost:3003 bash /Users/stew/Repos/.worktrees/pika/survey-preview/.codex/skills/pika-ui-verify/scripts/ui_verify.sh classrooms`
- Targeted Playwright screenshots/assertions: `/tmp/pika-survey-preview-teacher.png`, `/tmp/pika-survey-preview-teacher-mobile.png`; temporary survey fixtures were deleted afterward.

## 2026-05-19 — Teacher Daily date picker arrows

**Completed:**
- Removed the previous/next arrow buttons from the teacher Daily date picker while keeping the date label picker plus Last class and Today controls.
- Added a regression test asserting the Daily picker no longer renders `Previous day` or `Next day` buttons.

**Validation:**
- `bash /Users/stew/Repos/.worktrees/pika/remove-daily-date-arrows/.codex/skills/pika-session-start/scripts/session_start.sh`
- `pnpm vitest run tests/components/TeacherAttendanceTab.test.tsx`
- `pnpm lint`
- `E2E_BASE_URL=http://localhost:3017 bash /Users/stew/Repos/.worktrees/pika/remove-daily-date-arrows/.codex/skills/pika-ui-verify/scripts/ui_verify.sh 'classrooms/5fcf845d-220d-4321-8409-5afe9e9459c3?tab=attendance'`
- Warmed desktop screenshot: `/tmp/pika-teacher-final.png`; teacher desktop/mobile confirmed no forward/back date arrows, student mobile unaffected.
- `pnpm test`

## 2026-05-19 — Assignment preview Escape handling

**Completed:**
- Reviewed merged assignment markdown/modal work and found the nested instructions preview could let Escape reach the underlying assignment editor dialog.
- Updated the assignment editor dialog close handler so an open instructions preview is treated as the top modal and closes first.
- Added regression coverage that Escape closes the preview while keeping the assignment editor open.

**Validation:**
- `bash scripts/verify-env.sh`
- `pnpm test tests/components/AssignmentModal.test.tsx`
- `pnpm lint`
- `pnpm build`
- `E2E_BASE_URL=http://localhost:3003 bash /Users/stew/Repos/.worktrees/pika/assignment-preview-escape/.codex/skills/pika-ui-verify/scripts/ui_verify.sh 'classrooms/5fcf845d-220d-4321-8409-5afe9e9459c3?tab=assignments'`
- Targeted Playwright screenshots/assertions: `/tmp/pika-assignment-instructions-preview.png`, `/tmp/pika-assignment-modal-after-preview-escape.png`.
- `E2E_BASE_URL=http://localhost:3001 pnpm e2e:auth`
- `E2E_BASE_URL=http://localhost:3001 bash /Users/stew/Repos/.worktrees/pika/assignment-markdown-modal/.codex/skills/pika-ui-verify/scripts/ui_verify.sh 'classrooms/5fcf845d-220d-4321-8409-5afe9e9459c3?tab=assignments'`
- Additional modal screenshots:
  - `/tmp/pika-teacher-assignment-markdown-modal.png`
  - `/tmp/pika-teacher-assignment-markdown-modal-mobile.png`

## 2026-05-15 — Assignment creation modal flow

**Completed:**
- Reworked the assignment modal into a narrower, more vertical authoring flow.
- Kept title and due date on the same form row and removed due-date previous/next arrow controls.
- Made assignment instructions always use the markdown editor toolbar.
- Moved rendered markdown into a separate `Assignment Preview` dialog opened by a Preview button.
- Updated assignment modal tests for the new preview dialog and always-visible markdown tools.

**Validation:**
- `pnpm lint`
- `pnpm test tests/components/AssignmentModal.test.tsx`
- `E2E_BASE_URL=http://localhost:3001 bash /Users/stew/Repos/.worktrees/pika/assignment-markdown-modal/.codex/skills/pika-ui-verify/scripts/ui_verify.sh 'classrooms/5fcf845d-220d-4321-8409-5afe9e9459c3?tab=assignments'`
- Additional modal screenshots:
  - `/tmp/pika-assignment-modal-desktop.png`
  - `/tmp/pika-assignment-modal-mobile.png`
  - `/tmp/pika-assignment-preview-dialog.png`

## 2026-05-16 — Assignment modal top row tightening

**Completed:**
- Removed the visible assignment modal header above the title field.
- Moved the post/schedule split button into the same first row as title and due date.
- Shortened compact title/date/action widths so the same-row layout holds on mobile.

**Validation:**
- `pnpm lint`
- `pnpm test tests/components/AssignmentModal.test.tsx`
- `E2E_BASE_URL=http://localhost:3001 bash /Users/stew/Repos/.worktrees/pika/assignment-markdown-modal/.codex/skills/pika-ui-verify/scripts/ui_verify.sh 'classrooms/5fcf845d-220d-4321-8409-5afe9e9459c3?tab=assignments'`
- Additional modal screenshots:
  - `/tmp/pika-assignment-modal-desktop.png`
  - `/tmp/pika-assignment-modal-mobile.png`
  - `/tmp/pika-assignment-preview-dialog.png`

## 2026-05-17 — Assignment modal close placement

**Completed:**
- Moved the assignment modal close button to an absolute upper-right corner position with minimal modal-edge padding.
- Removed the close button from the title/due/action row.
- Tightened the title input max width and matched compact due-date and post split-button widths.
- Removed the reserved right-side content padding so the close button no longer consumes modal content width.
- Made the close button borderless while keeping the same absolute corner hit target.
- Updated the assignment instructions preview to a narrower student-content render: no footer Close button, no draft-only subtitle, and direct markdown output.

**Validation:**
- `pnpm lint`
- `pnpm test tests/components/AssignmentModal.test.tsx`
- `E2E_BASE_URL=http://localhost:3001 bash /Users/stew/Repos/.worktrees/pika/assignment-markdown-modal/.codex/skills/pika-ui-verify/scripts/ui_verify.sh 'classrooms/5fcf845d-220d-4321-8409-5afe9e9459c3?tab=assignments'`
- Additional modal screenshots:
  - `/tmp/pika-assignment-modal-desktop.png`
  - `/tmp/pika-assignment-modal-mobile.png`
  - `/tmp/pika-assignment-preview-dialog.png`

## 2026-05-18 — Shared creation modal shell

**Completed:**
- Extracted `CreationModalShell` and `CreationModalTopRow` for assignment-style creation flows.
- Reused the shared creation shell in assignment creation while keeping scheduling, autosave, and markdown behavior feature-local.
- Applied the same title-first, no-visible-header, absolute-close, top-row primary-action creation UI to quiz/test and survey creation.
- Added a dedicated survey creation modal so the shared creation shell fits the upstream survey workspace flow after creation.
- Kept quiz/test and survey edit/settings modals compact instead of forcing them into the creation shell.
- Added experimental UI guidance for the shared creation shell candidate.

**Validation:**
- `bash /Users/stew/Repos/.worktrees/pika/creation-modal-shell/.codex/skills/pika-session-start/scripts/session_start.sh`
- `pnpm lint`
- `pnpm exec tsc --noEmit`
- `pnpm test tests/components/AssignmentModal.test.tsx tests/components/QuizModal.test.tsx tests/components/SurveyModal.test.tsx tests/components/SurveyCreationModal.test.tsx tests/components/TeacherQuizzesTab.test.tsx tests/components/TeacherTestsTab.test.tsx tests/components/TeacherClassroomView.test.tsx tests/unit/ai-startup-docs.test.ts`
- `pnpm build`
- `E2E_BASE_URL=http://localhost:3000 pnpm e2e:auth`
- `E2E_BASE_URL=http://localhost:3000 bash /Users/stew/Repos/.worktrees/pika/creation-modal-shell/.codex/skills/pika-ui-verify/scripts/ui_verify.sh classrooms`
- Additional modal screenshots:
  - `/tmp/pika-assignment-create-desktop.png`
  - `/tmp/pika-test-create-desktop.png`
  - `/tmp/pika-survey-create-desktop.png`
  - `/tmp/pika-assignment-create-mobile.png`
  - `/tmp/pika-test-create-mobile.png`
  - `/tmp/pika-survey-create-mobile.png`
- UI verification on `http://localhost:3001`:
  - `E2E_BASE_URL=http://localhost:3001 bash /Users/stew/Repos/.worktrees/pika/fix-released-assignment-scheduling/.codex/skills/pika-ui-verify/scripts/ui_verify.sh classrooms`
  - Targeted live-assignment editor screenshot: `/tmp/pika-live-assignment-editor.png`

## 2026-05-16 — Native worktree AI guidance

**Completed:**
- Removed the per-session worktree environment variable requirement from live AI startup docs, Codex prompts/skills, and Claude command docs.
- Updated the startup, audit, and UI verification helper scripts to resolve the current git root directly.
- Kept the hub guardrail: branch work must happen in a dedicated worktree, not `$HOME/Repos/pika`.
- Removed remaining old worktree wording from live AI workflow docs.
- Made the audit helper fail loudly when run outside a git checkout.
- Added regression coverage for session-start rejecting the hub checkout and audit rejecting non-git directories.
- Removed legacy env exports from `scripts/pika`, the parity challenge helper, and the production merge worktree-root override.
- Sanitized tracked historical logs so repo-wide legacy env-var searches are clean.
- Changed future Pika worktree creation to `$HOME/.codex/worktrees/pika/<worktree-name>` while leaving existing `$HOME/Repos/.worktrees/pika` checkouts resolvable.
- Updated the production merge helper to reuse an already registered `production` worktree, otherwise create future production checkouts under `$HOME/.codex/worktrees/pika`.

**Validation:**
- `bash scripts/verify-env.sh` from the hub before edits
- `pnpm install --offline` in the docs worktree to recreate local dependency links
- `pnpm test -- tests/unit/ai-startup-docs.test.ts` (Vitest ran the full suite: 268 files / 2244 tests passed)
- `pnpm test tests/unit/ai-startup-docs.test.ts` (7 tests)
- `bash -n scripts/pika scripts/run-teacher-tests-parity-challenge.sh .codex/skills/pika-main-to-production-merge/scripts/merge_main_into_production.sh .codex/skills/pika-audit/scripts/audit.sh .codex/skills/pika-session-start/scripts/session_start.sh .codex/skills/pika-ui-verify/scripts/ui_verify.sh`
- `scripts/pika ls`
- Exact legacy worktree env-var search across the repo returned no matches

## 2026-05-19 — Codex worktree flow simplification

**Completed:**
- Simplified the canonical workflow so new named Pika worktrees live under `$HOME/.codex/worktrees/pika/<worktree-name>`, while Codex Desktop app-managed worktrees under `$HOME/.codex/worktrees/<id>/pika` are explicitly valid.
- Updated cleanup guidance to resolve the registered worktree path from `git worktree list --porcelain` before removing it, so new and legacy worktrees clean up correctly.
- Replaced stale Claude production-merge guidance with the shared production worktree helper flow.
- Added regression coverage for the worktree-location distinction, path-discovered cleanup, and production-merge helper routing.

**Validation:**
- `pnpm test tests/unit/ai-startup-docs.test.ts`
- `bash -n scripts/pika scripts/wt-add.sh scripts/run-teacher-tests-parity-challenge.sh .codex/skills/pika-main-to-production-merge/scripts/merge_main_into_production.sh .codex/skills/pika-audit/scripts/audit.sh .codex/skills/pika-session-start/scripts/session_start.sh .codex/skills/pika-ui-verify/scripts/ui_verify.sh`
- `scripts/pika ls`
- `git diff --check`
- Legacy worktree env-var and stale workflow phrase scans returned no live-source matches.

## 2026-05-19 — Workflow friction automation

**Completed:**
- Created the active weekly `Pika Workflow Friction Review` Codex automation as a report-only review of recent workflow friction and guidance drift.
- Updated the active `Weekly Pika Simplification` automation prompt to use the native worktree flow and stop relying on project-specific worktree environment variables.
- Confirmed both automation configs were written under `/Users/stew/.codex/automations`.

**Validation:**
- Read back `/Users/stew/.codex/automations/weekly-pika-simplification/automation.toml`.
- Read back `/Users/stew/.codex/automations/pika-workflow-friction-review/automation.toml`.

## 2026-05-19 — Remove student legacy quizzes nav plumbing

**Completed:**
- Removed legacy `activeQuizzesCount` from student sidebar notification state and the `/api/student/notifications` response.
- Kept the student assessment sidebar focused on Tests and added coverage that no student Quizzes nav item is rendered.
- Added coverage that legacy `?tab=quizzes` URLs fall back to the default student Today tab and clear quiz-specific params.

**Validation:**
- `bash .codex/skills/pika-session-start/scripts/session_start.sh`
- `pnpm test tests/components/NavItems.test.tsx tests/components/StudentNotificationsProvider.test.tsx tests/api/student/notifications.test.ts tests/components/ClassroomPageClientAssignmentsEditMode.test.tsx`
- `pnpm lint`
- `bash .codex/skills/pika-ui-verify/scripts/ui_verify.sh "classrooms/5fcf845d-220d-4321-8409-5afe9e9459c3?tab=today"`
- Additional student sidebar screenshot: `/tmp/pika-student-desktop-expanded.png`
- `pnpm test`
- `pnpm build`

## 2026-05-20 — Student test total points label

**Completed:**
- Added a student test overview label under the selected test title, showing question count and total points as `pts total`.
- Rendered the label before the student starts a test and at the top of the active test attempt.
- Added component coverage that the total-points label appears before start and during the attempt.

**Validation:**
- `bash scripts/verify-env.sh`
- `pnpm test -- tests/components/StudentQuizzesTab.test.tsx` (Vitest ran the full suite: 272 files / 2263 tests passed)
- `pnpm lint`
- `pnpm e2e:auth`
- `pnpm e2e:verify assessment-ux-parity`
- `bash .codex/skills/pika-ui-verify/scripts/ui_verify.sh "classrooms/5fcf845d-220d-4321-8409-5afe9e9459c3?tab=tests"`
- Additional selected student test screenshots:
  - `/tmp/pika-student-test-before-start.png`
  - `/tmp/pika-student-test-active.png`
  - `/tmp/pika-student-test-before-start-mobile.png`
  - `/tmp/pika-student-test-active-mobile.png`

## 2026-05-20 — Freeze submitted assignment timing

**Completed:**
- Added submitted-aware assignment timing copy so submitted work freezes against `submitted_at` instead of continuing to count overdue time from the current date.
- Updated student assignment cards and the standalone student assignment editor header to use the submitted-aware timing helper.
- Added unit and component coverage for submitted timing, including late submissions freezing at the actual submission timestamp.

**Validation:**
- `pnpm test tests/unit/assignments.test.ts tests/components/StudentAssignmentsTab.test.tsx`
- `pnpm lint`
- `bash .codex/skills/pika-ui-verify/scripts/ui_verify.sh "classrooms/5fcf845d-220d-4321-8409-5afe9e9459c3?tab=assignments"`
- Reviewed `/tmp/pika-teacher.png`, `/tmp/pika-student.png`, and `/tmp/pika-teacher-mobile.png`
- `pnpm test`

## 2026-05-20 — Remove assignment repo submission option

**Completed:**
- Removed the separate student `Repo` action and GitHub repo metadata dialog from the assignment editor.
- Stopped student assignment saves from writing `repo_url` / `github_username`; repo links now live in editor content as artifacts.
- Changed submission validation so repo metadata alone is not submittable work.
- Updated repo analysis target resolution to fall back to pasted GitHub repo artifacts and infer the GitHub username from the repo owner when no legacy username is present.
- Kept teacher assignment artifact and repo-analysis surfaces working with pasted repo artifacts.
- Hid the unfinished repository marking section from the teacher grading inspector and removed the batch repo-analysis action while leaving backend repo artifact extraction/analysis plumbing in place for a later rebuild.

**Validation:**
- `pnpm test tests/components/StudentAssignmentsTab.test.tsx tests/components/StudentAssignmentEditor.feedback-card.test.tsx tests/unit/assignment-repo-targets.test.ts tests/api/teacher/assignments-artifact-repo-run.test.ts tests/api/assignment-docs/submit.test.ts tests/unit/assignments.test.ts`
- `pnpm test tests/components/TeacherStudentWorkPanel.test.tsx tests/components/TeacherClassroomView.test.tsx`
- `pnpm lint`
- `pnpm build`
- `pnpm test`
- `bash .codex/skills/pika-ui-verify/scripts/ui_verify.sh "classrooms/5fcf845d-220d-4321-8409-5afe9e9459c3?tab=assignments"`
- Additional assignment screenshots: `/tmp/pika-student-assignment-editor.png`, `/tmp/pika-teacher-assignment-workspace.png`
- Additional hidden-repo marking screenshots: `/tmp/pika-teacher-assignment-workspace-hidden-repo.png`, `/tmp/pika-teacher-assignment-actions-hidden-repo.png`
- `git diff --check`

## 2026-05-20 — Assignment repo follow-up

**Completed:**
- Changed assignment repo target resolution so pasted repo artifacts in current submission content take precedence over legacy `assignment_docs.repo_url` metadata.
- Kept legacy repo metadata as a fallback only, leaving `repo_url`/`github_username` as deprecated fields for now.
- Added unit coverage for artifact-over-legacy repo target precedence.
- Trimmed the rolling session log to satisfy the 20-entry startup guard.

**Validation:**
- `pnpm test tests/unit/assignment-repo-targets.test.ts`
- `pnpm test tests/unit/ai-startup-docs.test.ts tests/unit/assignment-repo-targets.test.ts`
- `pnpm lint`
- `git diff --check`
- `bash scripts/verify-env.sh`

## 2026-05-20 — Assignment AI draft comment refresh fix

**Completed:**
- Prevented stale `ai_feedback_suggestion` values from being merged back into teacher comment drafts after a newer manual edit.
- Manual assignment comment saves and sent comments now clear consumed AI suggestion metadata so refreshes load the teacher-edited draft as the source of truth.
- Added UI and API coverage for edited AI comments, single-student saves, and selected-student comment saves.

**Validation:**
- `bash .codex/skills/pika-session-start/scripts/session_start.sh`
- `pnpm test tests/components/TeacherStudentWorkPanel.test.tsx tests/api/teacher/assignments-id-grade.test.ts tests/api/teacher/assignments-grade-selected.test.ts`
- `pnpm test tests/components/TeacherStudentWorkPanel.test.tsx tests/api/teacher/assignments-id-grade.test.ts tests/api/teacher/assignments-grade-selected.test.ts tests/api/teacher/assignments-id-feedback-return.test.ts`
- `pnpm lint`
- `pnpm test`
- `bash .codex/skills/pika-ui-verify/scripts/ui_verify.sh "classrooms/5fcf845d-220d-4321-8409-5afe9e9459c3?tab=assignments"`
- Reviewed `/tmp/pika-teacher.png`, `/tmp/pika-student.png`, `/tmp/pika-teacher-mobile.png`, and `/tmp/pika-teacher-assignment-detail.png`
- `pnpm build`

## 2026-05-21 — Gradebook scroll containment

**Completed:**
- Fixed the teacher gradebook matrix so its table panel fills the workspace and owns both horizontal and vertical overflow.
- Removed the flush table wrapper that clipped horizontal overflow before the gradebook scroll pane could expose it.
- Kept the gradebook viewport-constrained in both grades and settings modes so long student lists and many assessment columns remain reachable.

**Validation:**
- `bash .codex/skills/pika-session-start/scripts/session_start.sh`
- `pnpm test tests/components/TeacherGradebookTab.test.tsx`
- `pnpm lint`
- Mocked long-grid Playwright check with 48 students and 32 assessment columns; verified `gradebook-student-scroll-pane` can scroll on both axes and captured `/tmp/pika-gradebook-scroll-after.png` and `/tmp/pika-gradebook-settings-scroll-after.png`.
- `E2E_BASE_URL=http://localhost:3001 bash .codex/skills/pika-ui-verify/scripts/ui_verify.sh "classrooms/5fcf845d-220d-4321-8409-5afe9e9459c3?tab=gradebook"`
- Reviewed `/tmp/pika-teacher.png`, `/tmp/pika-student.png`, and `/tmp/pika-teacher-mobile.png`.

## 2026-05-21 — Returned assignment timing freeze

**Completed:**
- Fixed returned assignment timing so student-facing labels freeze against preserved `submitted_at` even after teacher return clears `is_submitted`.
- Added regression coverage for returned late work with `is_submitted: false`, preserved `submitted_at`, and `returned_at`.
- Rebuilt the fix on a fresh branch from current `origin/main` to avoid carrying stale already-merged commits.

**Validation:**
- `bash .codex/skills/pika-session-start/scripts/session_start.sh`
- `pnpm test tests/unit/assignments.test.ts tests/components/StudentAssignmentsTab.test.tsx`
- `pnpm seed`
- `pnpm e2e:auth`
- `bash .codex/skills/pika-ui-verify/scripts/ui_verify.sh "classrooms/85d6177d-f695-4df2-bbad-2946876d8e16?tab=assignments"`
- Reviewed `/tmp/pika-student.png`, `/tmp/pika-teacher-mobile.png`, and `/tmp/pika-teacher-loaded.png`.
- `pnpm test`
