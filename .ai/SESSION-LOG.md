# Pika Session Log

Rolling recent session log for AI/human handoffs. Keep this file small; full historical session history lives in `.ai/JOURNAL-ARCHIVE.md`.

**Rules:**
- Append one concise entry for meaningful work, then immediately run `node scripts/trim-session-log.mjs` in the same change.
- CI allows at most 60 entries; the trim step compacts to the latest 40 entries by default so there is headroom for future appends.
- Use `node scripts/trim-session-log.mjs --check` to verify the log is within the 60-entry cap.
- Keep enough recent entries for weekly automations to inspect roughly the last week of work.
- The trim step appends removed entries to `.ai/JOURNAL-ARCHIVE.md`, so trimming never loses history.
- Use `.ai/JOURNAL-ARCHIVE.md` only for historical investigation.

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
- `pnpm test`
- `pnpm build`

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

## 2026-07-11 — Teacher-ready blueprint classroom rollover

**Completed:**
- Preserved assignment due timing as Toronto-local offsets from the source classroom start date.
- Made assignments and tests created from blueprints explicitly unpublished for teacher review.
- Added a realistic blueprint-to-classroom acceptance regression covering resources, assignments, submission requirements, tests/questions, lesson plans, relative due dates, and excluded student records.
- Added migration 080 and course-package v3 support to preserve assignment/test point scales, gradebook weights, and final-grade inclusion, including validation and backward-compatible defaults for older packages.
- Documented the classroom rollover contract.

**Validation:**
- Blueprint-focused Vitest suite (36/36 passed)
- `pnpm lint`
- `pnpm build`
- Pika audit

## 2026-07-13 — Blueprint architecture stabilization

**Completed:**
- Split published classroom syllabus loading from the teacher-authoring blueprint extractor, with explicit public projections that exclude classroom ownership and draft assessment content.
- Kept draft tests in reusable blueprints and batched test-question/draft loading to remove the per-test query loop.
- Preserved fractional assignment/test points and negative relative due offsets through Markdown, course-package bundle, and tar round trips.
- Scoped blueprint grading metadata parsing to the test header so matching prompt content is not stripped or interpreted as configuration.
- Updated migration 080 to use the runtime-compatible `numeric(6,2)` point scale and verified that 080 remains the next migration after `origin/main`.

**Validation:**
- `pnpm test` (311 files, 2,790 tests)
- `npx tsc --noEmit`
- `pnpm lint`
- Pika audit
- `git diff --check`

## 2026-07-13 — Atomic and observable blueprint round trips

**Completed:**
- Replaced compensating-delete package import, classroom capture, and classroom instantiation with single transactional RPC boundaries and a service-role-only idempotency/failure ledger.
- Added stable classroom and blueprint revision snapshots, including child-table triggers, final read checks, and transaction-time source locks to reject mixed-version write plans.
- Preserved assignment submission requirements during classroom capture and kept new classroom assignments/tests unpublished for teacher review.
- Added strict Zod write-plan/RPC response contracts, structured operation metrics, caller idempotency keys, failure metadata, and migration-required fail-closed behavior.
- Made generated class codes/default themes deterministic from the operation ID and added stable query tie-breakers so retries rebuild an identical write plan.
- Added ephemeral Supabase contract checks for malformed plans, child-write rollback, stale capture rejection, and successful replay; documented rollout, rollback, recovery, retention, privacy, and observability.

**Validation:**
- `pnpm test` (314 files, 2,808 tests)
- `pnpm build`
- `pnpm exec tsc --noEmit`
- `pnpm lint`
- Pika audit
- `bash -n scripts/check-atomic-blueprint-operations.sh`
- `git diff --check`
- Ephemeral Supabase migration/behavior check pending PR CI

## 2026-07-13 — Canonical classroom lifecycle and archive contracts

**Completed:**
- Added strict Zod-derived contracts for active, hot-archived, and cold-archived lifecycle states, with separate verified evidence for compaction and completed restore.
- Encoded the current 42-table classroom ownership graph, all restore dependencies, privacy classes, parent-first restore order, child-first cleanup order, and a deidentified Gradex allowlist.
- Added strict version 1 classroom archive and Gradex extract manifests with canonical file paths, row/byte counts, SHA-256 checksums, retention metadata, actor snapshots, managed storage descriptors, and restore preflight gates.
- Defined the existing course package as a reusable, student-free, non-recoverable artifact; defined private archive/Gradex destinations and referenced-only discovery for the three current source buckets.
- Added a read-only PostgreSQL catalog audit that fails on untracked/stale classroom resources, missing restore dependencies, or invalid selection keys, plus recovery, observability, compatibility, and production-canary guidance.
- Added the unfinished `epic-classroom-lifecycle-archives` entry to the append-only feature inventory so repository status reflects the remaining implementation and production verification work.
- Removed a duplicated architectural-direction section from `.ai/CURRENT.md` to keep the required startup context below its 16,000-character budget after adding the epic.
- No application runtime path, database migration, database row, storage object, dependency, or production environment changed.

**Validation:**
- `pnpm test`
- `pnpm exec tsc --noEmit`
- `pnpm lint`
- `pnpm build`
- `pnpm exec vitest run tests/lib/contracts/classroom-lifecycle.test.ts tests/lib/contracts/classroom-artifacts.test.ts` (15 tests)
- Read-only local catalog audit: `CLASSROOM_SCHEMA_AUDIT_DATABASE_URL=... pnpm exec tsx scripts/check-classroom-resource-schema.ts` (97 public foreign-key relationships)

## 2026-07-13 — Verified export-only classroom archives

**Completed:**
- Added migration 082 and a fail-closed teacher API for private, immutable, deterministic classroom archive exports without deleting any hot row or source object.
- Added idempotent snapshot/finalization RPCs, revision triggers for all 41 descendants, durable operation evidence, strict actor snapshots, 50 MB private archive/Gradex buckets, full upload read-back verification, and terminal/retry recovery behavior.
- Added canonical tar+gzip and NDJSON serialization with strict manifest, row/byte/checksum, actor, storage-object, content, and outer-artifact verification.
- Extended the 42-resource schema contract to audit actual primary keys and every direct actor foreign key; actor capture now uses only those explicit columns and rejects arbitrary user UUIDs in free text.
- Restricted storage discovery by source context: assignment artifacts from relational paths, submission images from embedded content, and test documents only from `tests.documents`.
- Added a server-only export enable flag plus teacher UUID allowlist, future-retention validation, structured privacy-safe metrics, database CI, recovery guidance, and adversarial regressions.
- Kept the archive epic unfinished: restore, Gradex extract generation, cold compaction, cleanup automation, teacher UI, and production canaries remain pending.

**Validation:**
- `pnpm test` (320 files, 2,844 tests)
- `pnpm lint`
- `pnpm build`
- `pnpm exec tsc --noEmit`
- Pika audit
- Fresh isolated Supabase replay through migrations 080/081/082
- Atomic blueprint database contract
- Verified archive database contract, including stale-source, terminal replay, unrelated-UUID privacy, retention, grants, and immutable metadata checks
- Classroom schema audit (102 public foreign-key relationships)
- `bash -n scripts/check-classroom-archive-database.sh`
- `git diff --check`

## 2026-07-13 — Resumable and version-aware classroom archive restore

**Completed:**
- Added migration 083 with cold tombstones outside the classroom ownership graph, bounded idempotent JSONB staging, conservative database-capacity preflight, concurrent-operation rejection, service-role-only RPCs, and one atomic 42-resource finalization transaction.
- Added strict archive decoding, source-to-target adapter selection, actor reconciliation, exact storage-reference matching, deterministic operation-scoped object paths, managed-reference rewriting, and outer/read-back checksum verification.
- Added a separately gated teacher restore endpoint requiring an enable flag, teacher UUID allowlist, idempotency key, and explicit database-budget setting; applying the migration alone does not expose restore or enable compaction.
- Preserved exact archived values by suppressing blueprint/archive touch triggers only inside the transaction-local restore context and restoring the archived revision explicitly; PostgreSQL records final referential-integrity evidence after inserts pass.
- Added rollback-only database coverage for capacity refusal, schema drift, unresolved actors, concurrent restores, expired-operation replacement, idempotent staging/completion, exact JSONB row equality, revision preservation, tombstone cleanup, and browser-role denial.
- Corrected restore concurrency so only unexpired snapshots block a replacement operation; expired operations can no longer strand a cold classroom while awaiting cleanup automation.
- Kept the archive epic unfinished: cold compaction, separate deidentified Gradex extract generation, cleanup automation, teacher UI, and production canaries remain pending. No production database, migration, row, or storage object was modified.

**Validation:**
- `pnpm test` (324 files, 2,866 tests)
- `pnpm exec tsc --noEmit`
- `pnpm lint`
- `pnpm build`
- Pika audit
- Fresh isolated Supabase replay through migrations 080/081/082/083 with matching source/copy migration hashes
- Verified export and restore database contracts executed as `service_role`
- Post-review focused restore suite (4 files, 21 tests) and fresh rollback-only restore canary, including expired-operation replacement
- Classroom schema audit (105 public foreign-key relationships)
- Supabase lint: one existing migration-082 false positive for the function-local `classroom_archive_actor_ids` temporary table; both executable database contracts pass
- `git diff --check`

## 2026-07-13 — Deidentified Gradex artifact transformer

**Completed:**
- Added a server-only pure transformer that derives a deterministic Gradex tar+gzip artifact only from a strictly verified classroom archive.
- Added explicit projections for every allowlisted assignment/test resource, per-extract HMAC relationship references, relative structured timestamps, shared direct-identifier redaction plus known-actor redaction, and exclusion of storage/external references.
- Added independent verification for canonical manifests/NDJSON, resource/content checksums, HMAC shapes, projected relationships, exact resource inventory, and zero detected direct identifiers.
- Capped version 1 extract retention at 90 days and documented that runtime operations, upload/finalization, deletion automation, and production canaries remain unfinished.

**Validation:**
- Focused Gradex, artifact-contract, and startup-policy suites (43 tests)
- `pnpm test`
- `pnpm exec tsc --noEmit`
- `pnpm lint`
- `pnpm build`

## 2026-07-13 — Durable Gradex operations and cleanup contract

**Completed:**
- Added stacked migration 084 with a service-role-only Gradex resource allowlist, idempotent begin/finalize/fail operations, immutable verified extract metadata, and a separate mutable retention-cleanup ledger.
- Serialized generation per immutable source archive, capped retention and file size, required exact resource counts and verification evidence, and scheduled older extracts immediately when superseded.
- Added lease-based cleanup claiming, stale-lease rejection, exponential retry, and durable deletion evidence without deleting audit metadata.
- Tightened final review invariants for typed verification evidence, bounded verification timestamps, conflicting finalization replays, failure metadata, and cleanup lease inputs.
- Kept the database contract unreachable from browser roles and added no API, cron, upload, deletion, or production execution path.

**Validation:**
- Fresh isolated Supabase replay through migration 084
- Expanded rollback-only service-role Gradex database contract
- Focused migration, transformer, artifact-contract, and startup-policy suites (47 tests)
- Full Vitest suite (326 files / 2,874 tests)
- `bash -n scripts/check-classroom-gradex-database.sh`
- `pnpm exec tsc --noEmit`
- `pnpm lint`
- Pika pre-commit audit

## 2026-07-13 — Gated Gradex runtime coordinator

**Completed:**
- Added a server-only coordinator that verifies immutable classroom archives before building Gradex extracts, then performs private no-overwrite upload, full read-back, independent integrity/privacy verification, and exact durable finalization.
- Added explicit enablement, teacher allowlisting, a minimum-strength HMAC secret, HMAC-key fingerprint request binding, deterministic operation paths, strict Zod RPC contracts, and privacy-safe metrics.
- Added safe replay, concurrent-upload reuse, terminal cleanup, and transient-finalization retry behavior without exposing any API, cron, or production execution path.
- Documented the runtime boundary and configuration while keeping deletion automation, cold compaction, teacher UI, and production canaries unfinished. No production database, migration, row, or storage object was modified.

**Validation:**
- Full Vitest suite (327 files / 2,889 tests)
- Focused archive/Gradex/runtime suites (4 files / 36 tests)
- `pnpm exec tsc --noEmit`
- `pnpm lint`
- `pnpm build`
- `git diff --check`

## 2026-07-13 — Doubly gated Gradex teacher trigger

**Completed:**
- Added a teacher-authenticated Gradex generation route requiring an explicit UUID idempotency key and a future deletion timestamp bounded by the 90-day artifact contract.
- Kept deployment fail-closed behind both the existing teacher coordinator allowlist and a separate exact source-archive canary flag/allowlist; no UI, cron, or automatic caller was added.
- Delegated generation, immutable archive ownership, transformation, storage, read-back, privacy verification, and durable finalization to the existing coordinator and migration 084 boundaries.
- Extended the rollback-only database contract and static migration guard to reject foreign-teacher and wrong-classroom archive requests without creating an operation.
- Updated environment, lifecycle, test, and current-context documentation. No production database, migration, row, storage object, or environment setting was modified.

**Validation:**
- Full Vitest suite (328 files / 2,899 tests)
- Focused trigger/coordinator/transformer/artifact/startup suites (5 files / 67 tests)
- Focused route/coordinator/migration suite after ownership review (3 files / 29 tests)
- `pnpm exec tsc --noEmit`
- `pnpm lint`
- `pnpm build`
- `bash -n scripts/check-classroom-gradex-database.sh`
- Local executable database contract unavailable because the running Supabase container predates migration 082; migrations were not applied or modified
- `git diff --check`

## 2026-07-13 — Verified Gradex retention cleanup runtime

**Completed:**
- Added a server-only, disabled-by-default cleanup coordinator over migration 084's lease claim, completion, and retry RPCs without adding an HTTP route, cron entry, or automatic caller.
- Bounded each invocation to 10 claims and strictly validated the private bucket, canonical teacher/classroom/extract path shape, extract id binding, claim uniqueness, attempts, and lease inputs with Zod.
- Required exact post-delete read-back evidence: only authoritative object-key absence can complete the current lease; missing buckets, present objects, uncertain Storage results, stale leases, and malformed RPC responses fail closed.
- Added durable per-claim retry recording, stale-lease non-mutation, independent failure containment, privacy-safe aggregate metrics, and idempotent already-absent handling.
- Updated environment, lifecycle, test, and current-context documentation. No production database, migration, row, storage object, route, schedule, or environment setting was modified.

**Validation:**
- Full Vitest suite (329 files / 2,915 tests)
- Focused cleanup/generation/transformer/artifact/migration/startup suites (6 files / 80 tests)
- `pnpm exec tsc --noEmit`
- `pnpm lint`
- `pnpm build`
- `git diff --check`

## 2026-07-13 — Manual Gradex cleanup canary trigger

**Completed:**
- Added a `CRON_SECRET`-authenticated GET/POST cleanup endpoint behind an independent disabled-by-default trigger gate while preserving the cleanup worker's separate gate.
- Bounded the manual canary to one claim per invocation and delegated lease, storage deletion, exact read-back, completion, and retry behavior to the existing cleanup coordinator.
- Kept durably recorded item retries healthy while returning `503` when any claim lacks durable retry evidence; responses expose no storage paths or content.
- Added tests that lock the route out of `vercel.json`; no schedule, UI caller, migration, dependency, production database, row, storage object, or environment setting was changed.
- Updated environment, lifecycle, test, and current-context documentation.

**Validation:**
- Full Vitest suite (330 files / 2,925 tests)
- Focused trigger/cleanup/extract/operations/artifact/startup suites (6 files / 85 tests)
- `pnpm exec tsc --noEmit`
- `pnpm lint`
- `pnpm build`
- Pika pre-commit audit
- `git diff --check`
