# Pika Session Log

Rolling recent session log for AI/human handoffs. Keep this file small; full historical session history lives in `.ai/JOURNAL-ARCHIVE.md`.

**Rules:**
- Append one concise entry for meaningful work, then immediately run `node scripts/trim-session-log.mjs` in the same change.
- CI allows at most 60 entries; the trim step compacts to the latest 40 entries by default so there is headroom for future appends.
- Use `node scripts/trim-session-log.mjs --check` to verify the log is within the 60-entry cap.
- Keep enough recent entries for weekly automations to inspect roughly the last week of work.
- The trim step appends removed entries to `.ai/JOURNAL-ARCHIVE.md`, so trimming never loses history.
- Use `.ai/JOURNAL-ARCHIVE.md` only for historical investigation.

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

## 2026-06-13 — Standardize survey due picker UI

**Completed:**
- Reused the assignment `DateActionBar` due-date button for survey creation due dates.
- Added a matching action-bar time picker button for survey due time in the shared classwork modal shell.
- Propagated disabled state through the shared date picker and assignment form.
- Updated the `TeacherClassroomView` test mock for the shared action-bar button class export.

**Validation:**
- `pnpm exec tsc --noEmit --pretty false`
- `pnpm test tests/components/TeacherClassroomView.test.tsx tests/components/SurveyCreationModal.test.tsx tests/components/SurveyModal.test.tsx tests/components/AssignmentModal.test.tsx`
- `pnpm lint`
- `pnpm build`
- `git diff --check`
- `E2E_BASE_URL=http://localhost:3001 pnpm e2e:auth`
- `E2E_BASE_URL=http://localhost:3001 bash .codex/skills/pika-ui-verify/scripts/ui_verify.sh classrooms`
- Manual Playwright screenshots: `/tmp/pika-modal-assignment-desktop.png`, `/tmp/pika-modal-material-desktop.png`, `/tmp/pika-modal-survey-desktop.png`, `/tmp/pika-modal-announcement-desktop.png`, `/tmp/pika-modal-survey-mobile.png`, `/tmp/pika-modal-material-mobile.png`

## 2026-06-14 — Remove survey due mode

**Completed:**
- Removed the Survey `Due mode` selector from creation, settings, and workspace due controls.
- Kept survey due dates informational while open; student response/update behavior now relies on the `Allow students to update answers while open` checkbox.
- Added a Preview action to the survey setup modal that flushes autosave and opens the existing survey workspace preview mode.
- Removed the hard-due response block from the student survey response API.

**Validation:**
- `pnpm exec tsc --noEmit --pretty false`
- `pnpm test tests/components/SurveyCreationModal.test.tsx tests/components/SurveyModal.test.tsx tests/components/TeacherSurveyWorkspace.test.tsx tests/unit/surveys.test.ts tests/api/student/surveys-route.test.ts tests/components/TeacherClassroomView.test.tsx`
- `pnpm lint`
- `pnpm build`
- `git diff --check`
- `E2E_BASE_URL=http://localhost:3001 pnpm e2e:auth`
- `E2E_BASE_URL=http://localhost:3001 bash .codex/skills/pika-ui-verify/scripts/ui_verify.sh classrooms`
- Manual Playwright screenshots: `/tmp/pika-survey-no-due-mode-desktop.png`, `/tmp/pika-survey-no-due-mode-mobile.png`, `/tmp/pika-survey-no-due-mode-dark.png`, `/tmp/pika-survey-preview-workspace.png`

## 2026-06-14 — Make survey setup Preview student-facing

**Completed:**
- Changed the survey setup Preview handoff to open a student-only preview surface instead of the full teacher authoring workspace.
- Added a preview-only mode to `TeacherSurveyWorkspace` that renders `TeacherSurveyPreview` without due settings, live-change controls, code, delete, or save-due actions.
- Added a small close control in the modal chrome so teachers can dismiss the student preview without adding teacher controls inside the preview card.
- Added component and classroom regression coverage for the preview-only handoff.

**Validation:**
- `pnpm exec tsc --noEmit --pretty false`
- `pnpm test tests/components/TeacherSurveyWorkspace.test.tsx tests/components/SurveyCreationModal.test.tsx tests/components/TeacherClassroomView.test.tsx`
- `pnpm lint`
- `pnpm build`
- `git diff --check`
- `E2E_BASE_URL=http://localhost:3003 bash .codex/skills/pika-ui-verify/scripts/ui_verify.sh classrooms`
- Manual Playwright screenshots: `/tmp/pika-survey-student-preview-desktop.png`, `/tmp/pika-survey-student-preview-mobile.png`, `/tmp/pika-survey-student-preview-dark.png`
- Note: `E2E_BASE_URL=http://localhost:3001 pnpm e2e:auth` was attempted earlier and failed because the login button stayed disabled in the auth setup flow; existing `.auth` storage states were valid for visual verification.

## 2026-06-16 — Remove classwork modal Preview actions

**Completed:**
- Removed the shared `ClassworkModalPreviewButton` from the classwork modal shell/template.
- Removed top-line Preview actions and dead preview state/dialog code from assignment, material, survey setup, and announcement modals.
- Removed the survey setup preview-only handoff path while keeping the survey authoring workspace's internal Preview mode.
- Updated component/classroom regression tests to assert setup modals no longer expose Preview.

**Validation:**
- `pnpm exec tsc --noEmit --pretty false`
- `pnpm test tests/components/SurveyCreationModal.test.tsx tests/components/TeacherClassroomView.test.tsx tests/components/TeacherSurveyWorkspace.test.tsx tests/components/AssignmentModal.test.tsx tests/components/AnnouncementsMarkdown.test.tsx`
- `pnpm lint`
- `pnpm build`
- `git diff --check`
- `E2E_BASE_URL=http://localhost:3004 bash .codex/skills/pika-ui-verify/scripts/ui_verify.sh classrooms`
- Manual Playwright screenshots: `/tmp/pika-no-preview-assignment-modal.png`, `/tmp/pika-no-preview-material-modal.png`, `/tmp/pika-no-preview-survey-modal.png`, `/tmp/pika-no-preview-announcement-modal.png`, `/tmp/pika-no-preview-survey-mobile.png`

## 2026-06-17 — Unify survey create/edit modal

**Completed:**
- Reworked `SurveyCreationModal` so survey creation immediately opens the full survey authoring workspace inside the shared classwork modal shell instead of handing off to a second editor.
- Reused the same survey modal for edit actions, with the shared title/save/status/due/posting top line owning survey metadata and poll open/schedule/close actions.
- Embedded `TeacherSurveyWorkspace` below the shared top line, hid its duplicate title/due settings, and kept question authoring, code, preview, and delete controls in the survey workspace area.
- Fixed the workspace load callback dependencies with refs so parent question-count updates do not cause repeated survey reloads.
- Updated classroom and survey-modal tests to cover the inline survey workspace create flow and autosaved title changes.

**Validation:**
- `pnpm exec tsc --noEmit --pretty false`
- `pnpm test tests/components/SurveyCreationModal.test.tsx tests/components/TeacherClassroomView.test.tsx tests/components/TeacherSurveyWorkspace.test.tsx tests/components/AssignmentModal.test.tsx tests/components/AnnouncementsMarkdown.test.tsx`
- `pnpm lint`
- `pnpm build`
- `git diff --check`
- `E2E_BASE_URL=http://localhost:3004 bash .codex/skills/pika-ui-verify/scripts/ui_verify.sh classrooms`
- Manual Playwright screenshots: `/tmp/pika-unified-survey-create-modal.png`, `/tmp/pika-unified-survey-edit-modal.png`, `/tmp/pika-unified-survey-create-mobile.png`

## 2026-06-22 — Fix survey schedule PR review findings

**Completed:**
- Fixed survey rescheduling so active scheduled surveys can update `opens_at` without being rejected as an invalid active-to-active transition.
- Made teacher survey create/update tolerant of a deployment window before `surveys.due_at` and `surveys.due_policy` are present in PostgREST schema cache by retrying without the new due fields.
- Added regression coverage for active survey rescheduling and due-column fallback behavior.

**Validation:**
- `pnpm vitest run tests/api/teacher/surveys-route.test.ts tests/api/teacher/surveys-id-route.test.ts tests/components/TeacherClassroomView.test.tsx`
- `pnpm lint`
- `git diff --check`
- `bash scripts/verify-env.sh --tests`

## 2026-06-24 — Rebase classwork modal PR onto main

**Completed:**
- Rebasing `codex/classwork-content-modals` onto current `origin/main` completed after resolving `TeacherAnnouncementsSection` conflicts around the announcement action menu and shared classwork modal imports.
- Renamed the survey due migration from `079_add_survey_due_policy.sql` to `080_add_survey_due_policy.sql` because `origin/main` now owns `079_classroom_theme_color.sql`.
- Restored the local PR review fixes after the rebase.

**Validation:**
- `pnpm vitest run tests/api/teacher/surveys-route.test.ts tests/api/teacher/surveys-id-route.test.ts tests/components/TeacherClassroomView.test.tsx tests/components/AnnouncementsMarkdown.test.tsx`
- `pnpm lint`
- `git diff --check`
- `git diff --cached --check`

## 2026-06-24 — Rebase classwork modal PR after main advanced

**Completed:**
- Rebasing `codex/classwork-content-modals` onto the latest `origin/main` completed cleanly after main advanced again.
- Restored the local survey review-fix patch and kept the survey due migration at `080_add_survey_due_policy.sql`.

**Validation:**
- `pnpm vitest run tests/api/teacher/surveys-route.test.ts tests/api/teacher/surveys-id-route.test.ts tests/components/TeacherClassroomView.test.tsx tests/components/AnnouncementsMarkdown.test.tsx`
- `pnpm lint`
- `git diff --check`
- `git diff --cached --check`

## 2026-07-11 — Rebase classwork modal PR onto latest main

**Completed:**
- Recreated the feature worktree and rebased all 12 classwork modal commits onto current `origin/main` without content conflicts.
- Confirmed `080_add_survey_due_policy.sql` remains sequential after main's `079_classroom_theme_color.sql`, with no duplicate migration prefixes.

**Validation:**
- `pnpm vitest run tests/components/TeacherClassroomView.test.tsx` (49 passed)
- `pnpm lint`
- `git diff --check origin/main...HEAD`
