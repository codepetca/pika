# Pika Session Log

Rolling recent session log for AI/human handoffs. Keep this file small; full historical session history lives in `.ai/JOURNAL-ARCHIVE.md`.

**Rules:**
- Append one concise entry for meaningful work, then immediately run `node scripts/trim-session-log.mjs` in the same change.
- CI allows at most 60 entries; the trim step compacts to the latest 40 entries by default so there is headroom for future appends.
- Use `node scripts/trim-session-log.mjs --check` to verify the log is within the 60-entry cap.
- Keep enough recent entries for weekly automations to inspect roughly the last week of work.
- Use `.ai/JOURNAL-ARCHIVE.md` only for historical investigation.

## 2026-06-04 — Teacher lesson calendar cache audit

**Completed:**
- Added a shared teacher lesson-plan range cache helper with classroom-prefix invalidation.
- Routed teacher calendar and markdown-panel lesson-plan reads through the helper.
- Invalidated teacher lesson-plan caches after single autosaves and markdown bulk/no-op saves to avoid stale remount or refresh reads.
- Added focused teacher calendar tests for cached remount reuse and post-autosave invalidation.
- Addressed PR review findings by marking markdown content stale after inline autosaves, surfacing malformed successful JSON as a load error, and covering markdown sidebar reload/error behavior.

**Validation:**
- `pnpm vitest run tests/components/TeacherLessonCalendarTab.test.tsx`
- `pnpm vitest run tests/components/TeacherLessonCalendarTab.test.tsx tests/components/StudentLessonCalendarTab.test.tsx tests/components/calendar-view-persistence.test.tsx`
- `pnpm test`
- `bash .codex/skills/pika-audit/scripts/audit.sh`
- `git diff --check`
- `pnpm lint`
- `pnpm build`

## 2026-06-04 — Announcement freshness audit

**Completed:**
- Made teacher and student announcement reloads enter loading state on classroom changes and ignore stale responses from older classroom reads.
- Reset the student announcement read-marker guard when the classroom changes so each classroom can mark its announcements read once.
- Added component regressions for hiding stale teacher announcements during a classroom switch and marking student announcements read once per classroom.
- Addressed PR review findings by keying displayed announcement state to the loaded classroom id, preventing one-frame stale paints and premature student read-marker POSTs during classroom switches.

**Validation:**
- `bash .codex/skills/pika-session-start/scripts/session_start.sh`
- `pnpm vitest run tests/components/AnnouncementsMarkdown.test.tsx`
- `pnpm vitest run tests/components/AnnouncementsMarkdown.test.tsx tests/api/teacher/announcements.test.ts tests/api/teacher/announcements-id.test.ts tests/api/student/announcements.test.ts tests/components/StudentNotificationsProvider.test.tsx`
- `pnpm test`
- `bash .codex/skills/pika-audit/scripts/audit.sh`
- `git diff --check`
- `pnpm lint`
- `pnpm build`

## 2026-06-04 — Resource sidebar freshness audit

**Completed:**
- Added a shared client helper for teacher and student classroom resource reads, cache keys, and cross-role invalidation after teacher saves.
- Made teacher and student resource sidebars ignore stale responses from older classroom reads and only render content for the classroom that actually finished loading.
- Added sidebar regressions for hiding stale teacher/student resources during classroom switches and invalidating student resource cache after a teacher save.
- Addressed PR review feedback by scoping pending teacher resource autosave drafts and save completions to their classroom id so blur/unload saves and stale in-flight saves cannot corrupt the newly selected classroom state.

**Validation:**
- `bash .codex/skills/pika-session-start/scripts/session_start.sh`
- `pnpm vitest run tests/components/ClassResourcesSidebar.test.tsx`
- `pnpm vitest run tests/components/ClassResourcesSidebar.test.tsx tests/components/ResourcesTab.test.tsx tests/api/teacher/resources.test.ts tests/api/student/resources.test.ts`
- `bash .codex/skills/pika-audit/scripts/audit.sh`
- `git diff --check`
- `pnpm lint`
- `pnpm build`
- `pnpm test`

## 2026-06-04 — Classwork materials freshness audit

**Completed:**
- Made the student assignments/materials/surveys tab reset loaded state on classroom changes, hide previous classroom classwork while the next classroom loads, and ignore stale classwork responses.
- Guarded teacher classwork summary loads and rendered teacher classwork only from data loaded for the current classroom so older assignment/material/survey/class-day reads cannot overwrite or remain interactive under a new classroom shell.
- Added component regressions for active student classroom switches, stale teacher classwork load completion after switching classrooms, and hiding already-loaded teacher classwork while the next classroom loads.
- Addressed PR review feedback by requiring the selected teacher assignment workspace to belong to the currently loaded classroom before loading details, exposing workspace props, or accepting stale detail completions.

**Validation:**
- `bash .codex/skills/pika-session-start/scripts/session_start.sh`
- `pnpm vitest run tests/components/StudentAssignmentsTab.test.tsx tests/components/TeacherClassroomView.test.tsx`
- `pnpm vitest run tests/api/teacher/materials.test.ts tests/api/student/materials.test.ts tests/components/StudentAssignmentsTab.test.tsx tests/components/TeacherClassroomView.test.tsx`
- `bash .codex/skills/pika-audit/scripts/audit.sh`
- `git diff --check`
- `pnpm lint`
- `pnpm build`
- `pnpm test`

## 2026-06-04 — Classroom shell freshness audit

**Completed:**
- Reset the classroom page shell's local query state from the new server-provided search params when the classroom route changes so old assignment/test/student detail params cannot leak into the next classroom.
- Made the teacher roster tab cache repeated roster reads, hide old roster rows while the next classroom loads, and ignore stale roster responses after classroom switches.
- Scoped roster mutation completions to the classroom that started them and invalidated roster cache entries after counselor, add, upload, and removal changes.
- Added regressions for stale test detail query params on classroom rerender plus stale/pending roster loads during classroom switches.
- Addressed PR review feedback by deriving new-classroom query params synchronously before child props are computed and by invalidating originating-classroom roster caches before guarding UI updates after mutation completions.

**Validation:**
- `bash .codex/skills/pika-session-start/scripts/session_start.sh`
- `pnpm vitest run tests/components/TeacherRosterTab.test.tsx`
- `pnpm vitest run tests/components/TeacherRosterTab.test.tsx tests/components/ClassroomPageClientAssignmentsEditMode.test.tsx`
- `pnpm vitest run tests/components/TeacherRosterTab.test.tsx tests/components/ClassroomPageClientAssignmentsEditMode.test.tsx tests/api/teacher/roster.test.ts tests/api/teacher/roster-add.test.ts tests/api/teacher/roster-bulk-delete.test.ts tests/api/teacher/roster-rosterId.test.ts tests/api/teacher/roster-upload-csv.test.ts`
- `bash .codex/skills/pika-audit/scripts/audit.sh`
- `git diff --check`
- `pnpm lint`
- `pnpm build`
- `pnpm test`

## 2026-06-04 — Teacher settings freshness audit

**Completed:**
- Reset teacher settings local form state when the active classroom changes so stale names, join controls, syllabus settings, and blueprint dialog state do not carry into the next classroom.
- Guarded settings mutation completions with the originating classroom and form generation so late responses cannot overwrite a newly selected classroom, including switch-away-and-back cases.
- Added component regressions for classroom A to B settings rerenders, unchanged-title blur after a switch, and in-flight title saves resolving after switching away and back.

**Validation:**
- `pnpm vitest run tests/components/TeacherSettingsTab.test.tsx`
- `git diff --check`
- `pnpm lint`
- `pnpm build`
- `pnpm test`

## 2026-06-05 — Session-log trim guardrail

**Completed:**
- Added `node scripts/trim-session-log.mjs --check` so CI and agents can detect untrimmed session logs without modifying files.
- Updated session-log workflow guidance to require append-then-trim in the same change while keeping the 60-entry retention cap.
- Strengthened startup and trim-script tests so missed trims point directly to `node scripts/trim-session-log.mjs`.

**Validation:**
- `pnpm install --frozen-lockfile`
- `pnpm test tests/unit/trim-session-log.test.ts tests/unit/ai-startup-docs.test.ts`
- `node scripts/trim-session-log.mjs --check`
- `git diff --check`

## 2026-06-05 — Skill progression map refresh

**Completed:**
- Reviewed startup context, current repo invariants, and recent merged PR history before making recommendations.
- Collected evidence from merged PRs `#719`, `#724`, `#725`, `#726`, `#728`, `#729`, `#730`, `#731`, `#732`, `#733`, `#734`, `#735`, `#736`, plus self-review notes on `#709` and `#711`.
- Identified recurring themes around classroom freshness/cache invalidation, contract-boundary hardening, component regression testing, and Gradex integration follow-through.

**Validation:**
- `bash scripts/verify-env.sh` (fails: `node_modules` missing in this worktree)
- `gh pr list --state merged --limit 12 --json number,title,mergedAt,author,labels,url`
- `gh pr view <pr> --json number,title,mergedAt,files,reviews,url`
- `gh api graphql` against recent merged PR review metadata

## 2026-06-05 — Teacher attendance freshness guards

**Completed:**
- Added request-generation guards to `TeacherAttendanceTab` so stale classroom/date log responses cannot repaint the active teacher daily view after a classroom switch or date change.
- Reset teacher attendance local state on classroom changes so date/selection/loading state reinitializes against the next classroom instead of carrying the prior classroom forward.
- Added matching request-generation guards to `LogSummary` and created regression tests covering stale classroom summary responses plus stale teacher-log responses after a classroom switch.

**Validation:**
- `git diff --check`
- `pnpm vitest run tests/components/TeacherAttendanceTab.test.tsx tests/components/LogSummary.test.tsx` (fails in this worktree: `vitest` command unavailable because dependencies are not installed)

## 2026-06-06 — Gradebook action consistency audit

**Completed:**
- Split the Gradebook floating action controls so score-display mode has its own secondary SplitButton and selected-student email actions only appear after a student selection.
- Removed the actionable `Email (0)` empty state from the Gradebook tab to match roster-tab behavior.
- Renamed the Gradebook settings toggle to `Gradebook column controls` in ARIA/title/tooltip text so the action describes the column editor.
- Updated Gradebook component tests for the split score/email menus, selected-email visibility, and column-controls semantics.
- Addressed PR review feedback by covering the score-display SplitButton primary action, not only the dropdown radio path.

**Validation:**
- `bash .codex/skills/pika-session-start/scripts/session_start.sh`
- `bash .codex/skills/pika-ui-verify/scripts/ui_verify.sh 'classrooms/6d20a5cb-c497-4dc1-ac74-0637068c8a7f?tab=gradebook'`
- `bash .codex/skills/pika-ui-verify/scripts/ui_verify.sh 'classrooms/e80aa794-e2d6-4705-9da5-d08ab0fba861?tab=gradebook'`
- Manual Playwright screenshots for selected-email desktop, selected-email mobile, and selected-email dark mode.
- `git diff --check`
- `pnpm vitest run tests/components/TeacherGradebookTab.test.tsx`
- `pnpm lint`
- `pnpm build`

## 2026-06-06 — Teacher calendar cache audit

**Completed:**
- Routed `/teacher/calendar` classroom list reads through `fetchJSONWithCache` with a shared teacher-classrooms cache key.
- Reused the shared class-days client for cached class-day reads instead of raw page-level GETs.
- Invalidated classroom and class-day caches after calendar generation, class-day toggles, classroom creation, and classroom deletion.
- Added component coverage for cached classroom/class-day loads plus generation and toggle invalidation behavior.
- Addressed PR review feedback by moving classroom-list caching to a shared teacher-classrooms client, invalidating it from cross-route classroom mutations, and guarding `/teacher/calendar` against stale overlapping class-day responses.

**Validation:**
- `bash .codex/skills/pika-session-start/scripts/session_start.sh`
- `pnpm vitest run tests/components/TeacherCalendarPage.test.tsx`
- `pnpm vitest run tests/components/TeacherCalendarPage.test.tsx tests/contexts/ClassDaysContext.test.tsx tests/unit/request-cache.test.ts`
- `pnpm vitest run tests/components/TeacherCalendarPage.test.tsx tests/components/TeacherSettingsTab.test.tsx tests/components/TeacherClassroomsIndex.test.tsx tests/components/CreateClassroomModal.test.tsx tests/contexts/ClassDaysContext.test.tsx tests/unit/request-cache.test.ts`
- `git diff --check`
- `pnpm lint`
- `pnpm build`
- `pnpm test`

## 2026-06-06 — Teacher dashboard cache audit

**Completed:**
- Routed `/teacher/dashboard` classroom and attendance reads through shared `fetchJSONWithCache` helpers.
- Scoped the shared teacher-classrooms cache key by the active `/api/auth/me` user id and switched classroom-list invalidation to a prefix clear.
- Kept teacher dashboard entry-detail reads fresh instead of caching them because student entry edits have no teacher-side invalidation path.
- Invalidated dashboard attendance caches after roster upload, classroom creation, and classroom deletion.
- Added request-generation guards so stale attendance responses cannot repaint the dashboard after switching classrooms or after a roster-upload refresh.
- Added component coverage for cache usage, roster-upload invalidation, fresh entry-detail reads, and stale attendance responses.

**Validation:**
- `bash .codex/skills/pika-session-start/scripts/session_start.sh`
- `pnpm vitest run tests/components/TeacherDashboardPage.test.tsx tests/unit/request-cache.test.ts`
- `pnpm vitest run tests/components/TeacherDashboardPage.test.tsx tests/components/TeacherCalendarPage.test.tsx tests/components/CreateClassroomModal.test.tsx tests/components/TeacherClassroomsIndex.test.tsx tests/components/TeacherSettingsTab.test.tsx tests/unit/request-cache.test.ts`
- `pnpm vitest run tests/unit/teacher-classrooms-client.test.ts tests/components/TeacherDashboardPage.test.tsx tests/components/TeacherCalendarPage.test.tsx tests/unit/request-cache.test.ts`
- `git diff --check`
- `pnpm lint`
- `pnpm build`

## 2026-06-06 — Teacher blueprints cache audit

**Completed:**
- Routed `/teacher/blueprints` list and detail reads through a verified-user-scoped `fetchJSONWithCache` helper.
- Bypassed blueprint caching when `/api/auth/me` cannot verify a user id.
- Invalidated blueprint caches after metadata, content, planned-site, import, AI, merge, and create mutations.
- Addressed PR review feedback by also invalidating blueprint caches after course-package imports and blueprint instantiation from `CreateClassroomModal`.
- Added request-generation guards so stale blueprint detail responses cannot overwrite the active selection.
- Added component/unit coverage for scoped cache keys, stale detail responses, mutation invalidation, modal import/instantiate invalidation, and auth-scope cache bypass.

**Validation:**
- `bash .codex/skills/pika-session-start/scripts/session_start.sh` (initially failed on pre-existing blueprint component fixture gap)
- `pnpm vitest run tests/components/TeacherBlueprintsPage.test.tsx tests/unit/teacher-blueprints-client.test.ts tests/unit/request-cache.test.ts`
- `pnpm vitest run tests/components/TeacherBlueprintsPage.test.tsx tests/unit/teacher-blueprints-client.test.ts tests/components/CreateClassroomModal.test.tsx tests/components/TeacherSettingsTab.test.tsx tests/api/teacher/course-blueprints-route.test.ts tests/api/teacher/course-blueprint-publication-routes.test.ts tests/api/teacher/course-blueprint-instantiate.test.ts tests/unit/request-cache.test.ts`
- `git diff --check`
- `pnpm lint`
- `pnpm build`
- `pnpm test`

## 2026-06-06 — Student classrooms cache audit

**Completed:**
- Added a verified-user-scoped `student-classrooms` client for `/api/student/classrooms` repeated reads.
- Routed `/student/history` classroom list reads through the shared cache helper.
- Invalidated student classroom caches after joining from `/student/history` and `/join/[code]`.
- Added coverage for scoped list caching, auth-scope cache bypass, history-page cache usage, and join invalidation.

**Validation:**
- `bash .codex/skills/pika-session-start/scripts/session_start.sh`
- `pnpm vitest run tests/unit/student-classrooms-client.test.ts tests/components/StudentHistoryPage.test.tsx tests/components/JoinClassroomPage.test.tsx tests/unit/request-cache.test.ts`
- `pnpm vitest run tests/unit/student-classrooms-client.test.ts tests/components/StudentHistoryPage.test.tsx tests/components/JoinClassroomPage.test.tsx tests/components/StudentHistoryTab.test.tsx tests/components/StudentClassroomsIndex.test.tsx tests/api/student/classrooms.test.ts tests/api/student/classrooms-join.test.ts tests/api/student/classrooms-id.test.ts tests/unit/request-cache.test.ts`
- `git diff --check`
- `pnpm lint`
- `pnpm build`
- `pnpm test`

## 2026-06-06 — Teacher classroom index cache audit

**Completed:**
- Extended the shared teacher-classrooms client to cache active and archived classroom lists separately.
- Routed `TeacherClassroomsIndex` active refresh and archived-list loads through the shared helper instead of raw list fetches.
- Preserved prefix invalidation after archive, restore, delete, reorder, and create flows.
- Added coverage for separate active/archived cache keys and archived-view helper usage.

**Validation:**
- `bash .codex/skills/pika-session-start/scripts/session_start.sh`
- `pnpm vitest run tests/unit/teacher-classrooms-client.test.ts tests/components/TeacherClassroomsIndex.test.tsx tests/unit/request-cache.test.ts`
- `pnpm vitest run tests/unit/teacher-classrooms-client.test.ts tests/components/TeacherClassroomsIndex.test.tsx tests/components/TeacherCalendarPage.test.tsx tests/components/TeacherDashboardPage.test.tsx tests/components/CreateClassroomModal.test.tsx tests/components/TeacherSettingsTab.test.tsx tests/unit/request-cache.test.ts`
- `git diff --check`
- `pnpm lint`
- `pnpm build`
- `pnpm test`

## 2026-06-06 — Classroom blueprint modal cache audit

**Completed:**
- Routed `CreateClassroomModal` blueprint list loads through the shared `fetchTeacherBlueprints` cache helper instead of a raw `/api/teacher/course-blueprints` fetch.
- Kept import and instantiate mutation paths raw and preserved blueprint/classroom cache invalidation after successful mutations.
- Added a stale-load guard so a closed/reopened modal cannot have a prior blueprint list response wipe the current options.
- Addressed PR review feedback by bumping the list-load generation after blueprint imports so pending open-time list loads cannot erase imported options.
- Updated modal coverage for cached list loading, empty blueprint lists, mutation fetches, stale close/reopen responses, and import-while-list-load-is-pending races.

**Validation:**
- `bash .codex/skills/pika-session-start/scripts/session_start.sh`
- `pnpm vitest run tests/components/CreateClassroomModal.test.tsx tests/unit/teacher-blueprints-client.test.ts tests/unit/request-cache.test.ts`
- `pnpm vitest run tests/components/CreateClassroomModal.test.tsx tests/components/TeacherBlueprintsPage.test.tsx tests/unit/teacher-blueprints-client.test.ts tests/components/TeacherClassroomsIndex.test.tsx tests/components/TeacherCalendarPage.test.tsx tests/components/TeacherDashboardPage.test.tsx tests/unit/teacher-classrooms-client.test.ts tests/unit/request-cache.test.ts`
- `git diff --check`
- `pnpm lint`
- `pnpm build`
- `pnpm test`
- `bash .codex/skills/pika-audit/scripts/audit.sh`

## 2026-06-06 — Teacher quiz list freshness audit

**Completed:**
- Routed `TeacherQuizzesTab` list reads through `fetchJSONWithCache` with a zero TTL for in-flight GET dedupe.
- Added request-id and classroom guards so stale quiz list responses cannot repaint after classroom changes or newer reloads.
- Addressed PR review feedback by forcing mutation/update-triggered reloads to use one-off cache keys so they cannot attach to older pending passive reads.
- Addressed follow-up review feedback by letting quiz cards rely on the global quiz-update event instead of also calling a parent forced reload.
- Added component coverage for stale classroom-switch list responses and creation-while-initial-load-is-pending races while preserving existing mount, update-event, creation, selection, and delete behavior.

**Validation:**
- `bash .codex/skills/pika-session-start/scripts/session_start.sh`
- `pnpm vitest run tests/components/TeacherQuizzesTab.test.tsx tests/unit/request-cache.test.ts`
- `pnpm vitest run tests/components/TeacherQuizzesTab.test.tsx tests/components/QuizCard.test.tsx tests/components/QuizModal.test.tsx tests/components/QuizDetailPanel.test.tsx tests/components/TeacherTestsTab.test.tsx tests/api/teacher/quizzes-route.test.ts tests/api/teacher/quizzes-id.test.ts tests/api/teacher/quizzes-results.test.ts tests/unit/request-cache.test.ts`
- `git diff --check`
- `pnpm lint`
- `pnpm build`
- `bash .codex/skills/pika-audit/scripts/audit.sh`
- `pnpm test`

## 2026-06-06 — Student assessment freshness audit

**Completed:**
- Routed `StudentQuizzesTab` list reads through `fetchJSONWithCache` with zero-TTL in-flight dedupe and force-refresh keys after submit/back refreshes.
- Added list and detail request guards so stale student quiz/test list or selected-detail responses cannot repaint after classroom/type changes or newer reads.
- Reset selected assessment state when the classroom or assessment type changes.
- Added `StudentQuizResults` request guards and payload reset so stale result responses cannot win after `quizId` changes.
- Added component coverage for stale list, detail, and result response races.

**Validation:**
- `bash .codex/skills/pika-session-start/scripts/session_start.sh`
- `pnpm vitest run tests/components/StudentQuizzesTab.test.tsx tests/components/StudentQuizResults.test.tsx tests/unit/request-cache.test.ts`
- `pnpm vitest run tests/components/StudentQuizzesTab.test.tsx tests/components/StudentQuizResults.test.tsx tests/components/StudentQuizForm.test.tsx tests/api/student/quizzes.test.ts tests/api/student/quizzes-id.test.ts tests/api/student/quizzes-results.test.ts tests/api/student/quizzes-respond.test.ts tests/api/student/tests-route.test.ts tests/api/student/tests-id.test.ts tests/api/student/tests-results.test.ts tests/api/student/tests-respond.test.ts tests/api/student/tests-session-status.test.ts tests/api/student/tests-focus-events.test.ts tests/unit/request-cache.test.ts`
- `git diff --check`
- `pnpm lint`
- `pnpm build`
- `bash .codex/skills/pika-audit/scripts/audit.sh`
- `pnpm test`

## 2026-06-06 — Quiz detail freshness audit

**Completed:**
- Added request-scope guards to `QuizDetailPanel` draft, test-document detail, and results loads so stale responses cannot repaint after selected assessment, classroom, route base, or assessment-type changes.
- Reset result payload and invalidated in-flight load/save revisions when the selected assessment scope changes.
- Added save contexts so pending debounced saves can still persist their original assessment without applying stale draft state to the currently selected panel.
- Added component coverage for stale draft, test-detail document, results, same-id assessment-type switch, selected-assessment save-response races, and pending debounced save persistence across assessment switches.

**Validation:**
- `bash .codex/skills/pika-session-start/scripts/session_start.sh`
- `pnpm vitest run tests/components/QuizDetailPanel.test.tsx tests/components/QuizResultsView.test.tsx tests/components/TeacherQuizzesTab.test.tsx tests/components/TeacherTestsTab.test.tsx tests/api/teacher/quizzes-results.test.ts tests/api/teacher/tests-results.test.ts tests/unit/request-cache.test.ts`
- `git diff --check`
- `pnpm lint`
- `pnpm build`
- `bash .codex/skills/pika-audit/scripts/audit.sh`
- `pnpm test`
- `pnpm vitest run tests/components/QuizDetailPanel.test.tsx`

## 2026-06-06 — Survey detail freshness audit

**Completed:**
- Added request-id and selected-survey guards to teacher survey authoring detail loads, teacher survey results loads, and student survey detail/results loads.
- Scoped already-loaded teacher/student survey detail and result payloads to the active selected survey so old survey content is hidden immediately on selection changes.
- Reset student survey result payloads while a new selected survey or result request is loading.
- Kept selected survey detail/results reads raw for freshness and guarded stale responses explicitly.
- Added component coverage for stale teacher survey detail/results responses, stale student survey detail/results responses, and already-loaded old detail/results after survey switches.

**Validation:**
- `bash .codex/skills/pika-session-start/scripts/session_start.sh`
- `pnpm vitest run tests/components/TeacherSurveyWorkspace.test.tsx tests/components/TeacherSurveyResultsPane.test.tsx tests/components/StudentSurveyPanel.test.tsx`
- `git diff --check`
- `pnpm lint`
- `bash .codex/skills/pika-audit/scripts/audit.sh`
- `pnpm build`
- `pnpm test`

## 2026-06-07 — Student exam reload-resume e2e coverage

**Completed:**
- Added a focused Playwright student exam-mode flow that starts an open-response test, waits for draft autosave, reloads the browser, reopens the test, and verifies the draft resumes.
- Asserted reload telemetry is recorded as route-exit activity while window/full-screen exit telemetry remains unchanged.

**Validation:**
- `bash .codex/skills/pika-session-start/scripts/session_start.sh` (initially failed until `pnpm install` restored `node_modules`; rerun via `bash scripts/verify-env.sh` passed)
- `pnpm exec playwright test e2e/student-exam-mode.spec.ts --project=chromium-desktop -g "resumes an in-progress"`
- `pnpm lint`

## 2026-06-08 — Classroom sidebar history tightening

**Completed:**
- Changed first-level classroom sidebar navigation to replace the current history entry instead of pushing a lateral tab entry.
- Changed the Classwork sidebar reset path to clear selected assignment state with replace for both teacher and student nav.
- Added regression coverage for generic sidebar tab replacement and the Classwork selection-clear replace behavior while preserving existing in-tab workspace push coverage.

**Validation:**
- `pnpm exec vitest run tests/components/NavItems.test.tsx tests/components/ClassroomPageClientAssignmentsEditMode.test.tsx tests/components/TeacherClassroomView.test.tsx tests/components/TeacherTestsTab.test.tsx tests/components/TeacherQuizzesTab.test.tsx`
- `pnpm lint`
- `bash .codex/skills/pika-ui-verify/scripts/ui_verify.sh classrooms`
- Headless Playwright check: Daily → Classwork → assignment detail → Back returned to Classwork summary.
- `pnpm test -- tests/components/NavItems.test.tsx tests/components/ClassroomPageClientAssignmentsEditMode.test.tsx tests/components/TeacherClassroomView.test.tsx tests/components/TeacherTestsTab.test.tsx tests/components/TeacherQuizzesTab.test.tsx` (ran the full suite due script argument handling; only failed the pre-existing `TeacherGradebookTab.test.tsx` timeout)

## 2026-06-08 — Quiz individual responses freshness audit

**Completed:**
- Scoped `QuizIndividualResponses` loaded responders, questions, stats, load errors, and grading notices to the active assessment scope.
- Added request-id guards so stale individual-response result loads cannot overwrite after selected quiz/test id, API base, or assessment type changes.
- Guarded save/clear/suggest completion paths so old assessment grading callbacks cannot repaint notices or trigger parent refreshes after a selection switch.
- Added direct component coverage for stale result response overwrites and already-loaded old responses being hidden immediately on quiz switches.

**Validation:**
- `bash .codex/skills/pika-session-start/scripts/session_start.sh`
- `pnpm vitest run tests/components/QuizIndividualResponses.test.tsx tests/components/QuizDetailPanel.test.tsx`
- `git diff --check`
- `pnpm lint`
- `bash .codex/skills/pika-audit/scripts/audit.sh`
- `pnpm build`
- `pnpm vitest run tests/components/StudentAssignmentsTab.test.tsx tests/components/TeacherGradebookTab.test.tsx`
- `pnpm test`

## 2026-06-08 — Gradebook action consistency audit

**Completed:**
- Replaced the Gradebook score-display split button with the shared `SegmentedControl`, keeping score display as a two-state mode control instead of an action menu.
- Kept selected-student email actions as the only Gradebook split action, shown only when at least one valid selected student email exists.
- Updated Gradebook component coverage to assert score-display pressed state, absence of the old score-display action menu, and separation between score-display controls and selected-email menu actions.

**Validation:**
- `bash .codex/skills/pika-session-start/scripts/session_start.sh` (initial run hit a `TeacherGradebookTab` timeout; reran `pnpm vitest run tests/components/TeacherGradebookTab.test.tsx`, then `bash scripts/verify-env.sh` passed)
- `pnpm vitest run tests/components/TeacherGradebookTab.test.tsx`
- `bash .codex/skills/pika-ui-verify/scripts/ui_verify.sh 'classrooms/e80aa794-e2d6-4705-9da5-d08ab0fba861?tab=gradebook'`
- Manual loaded recaptures: `/tmp/pika-teacher-loaded.png`, `/tmp/pika-teacher-selected.png`, `/tmp/pika-teacher-mobile-loaded.png`
- `git diff --check`
- `pnpm lint`
- `pnpm build`
- `bash .codex/skills/pika-audit/scripts/audit.sh`
- `pnpm test` (one unrelated `StudentHistoryPage` concurrency failure; isolated rerun passed)
- `pnpm vitest run tests/components/StudentHistoryPage.test.tsx`
- `pnpm vitest run --sequence.concurrent=false`

## 2026-06-09 — Assignment returned-comment duplication fix

**Completed:**
- Stopped assignment AI grading from copying previously returned `feedback` into each new AI feedback result.
- Made the full assignment return route clear `teacher_feedback_draft` and AI suggestion fields after comments are sent as returned feedback.
- Added return-route coverage for clearing the comment draft and AI suggestion state.
- Fixed the stale teacher calendar component test by pinning `getTodayInToronto`; the test was clicking a past disabled date after June 8.

**Validation:**
- `bash .codex/skills/pika-session-start/scripts/session_start.sh` (failed on reproducible baseline `tests/components/TeacherCalendarPage.test.tsx` class-day toggle assertion before this branch's edits)
- `pnpm vitest run tests/components/TeacherCalendarPage.test.tsx tests/api/teacher/assignments-id-return.test.ts tests/api/teacher/assignments-id-feedback-return.test.ts tests/unit/ai-grading.test.ts tests/api/teacher/assignments-auto-grade.test.ts`
- `pnpm vitest run tests/api/teacher/assignments-id-return.test.ts tests/api/teacher/assignments-id-feedback-return.test.ts tests/unit/ai-grading.test.ts tests/api/teacher/assignments-auto-grade.test.ts`
- `pnpm test`
- `pnpm lint`
- `pnpm exec tsc --noEmit`

## 2026-06-08 — Assignment AI grading pane refresh

**Completed:**
- Refreshed the mounted selected-student assignment grading pane when a background assignment AI grading run completes, avoiding a full page refresh.
- Applied the same pane refresh to the legacy synchronous batch auto-grade path.
- Added classroom-view coverage that asserts a mounted grading pane receives a refresh-key bump after background AI grading completion.

**Validation:**
- `bash .codex/skills/pika-session-start/scripts/session_start.sh` (worktree rerun failed in baseline verification only: `LoginClient.test.tsx` two failures and `crypto.test.ts` password hash timeout; prior hub startup run failed different unrelated tests)
- `pnpm vitest run tests/components/TeacherClassroomView.test.tsx`
- `pnpm lint`
- `bash .codex/skills/pika-ui-verify/scripts/ui_verify.sh classrooms`

## 2026-06-08 — FAB subshell standardization

**Completed:**
- Added a standardized `floatingAction` split-button slot to `TeacherWorkSurfaceActionBar`.
- Migrated teacher Classwork, Tests, Gradebook, Roster, and Announcements FAB clusters to one split action per first-level tab/workspace, moving secondary toggles/actions into the split menu.
- Consolidated selected-assignment pane switching, survey visibility/edit actions, gradebook score display/column/email actions, roster CSV/remove/email actions, and announcement creation into standardized split menus.
- Left Calendar/Attendance unchanged because their FAB controls are date/view navigation rather than action menus.
- Deferred product quiz removal to a later pass; Tests remain in scope.

**Validation:**
- `pnpm exec tsc --noEmit`
- `pnpm lint`
- `pnpm exec vitest run tests/components/TeacherClassroomView.test.tsx tests/components/TeacherTestsTab.test.tsx tests/components/TeacherGradebookTab.test.tsx tests/components/TeacherRosterTab.test.tsx tests/components/TeacherWorkSurfaceActionBar.test.tsx tests/components/ClassroomPageClientAssignmentsEditMode.test.tsx`
- `pnpm build`
- `E2E_BASE_URL=http://localhost:3001 pnpm e2e:auth`
- Visual verification screenshots for teacher Classwork, Tests, Gradebook, Roster, Announcements, plus student Classwork sanity check.

## 2026-06-08 — Product quiz removal

**Completed:**
- Removed teacher and student `/api/*/quizzes` product routes, quiz override route, teacher quiz tab, quiz card/modal components, and matching route/component tests.
- Made the student assessment tab and shared legacy-named quiz components operate against tests by default while preserving test database compatibility.
- Removed quizzes from gradebook output, course blueprint package import/export, blueprint AI targets, classroom blueprint source loading, and course-site grading summaries.
- Renamed the teacher assessment update browser event from the old quiz name to a tests-specific event.
- Updated AI routing, architecture, course blueprint package, and teacher work-surface docs so quizzes are no longer described as an active product surface.
- PR self-review tightened remaining blueprint and actual-site paths so legacy quiz assessments are not cloned or rendered.

**Validation:**
- `pnpm lint`
- `pnpm test --run tests/components/TeacherTestsTab.test.tsx tests/components/QuizDetailPanel.test.tsx tests/components/StudentQuizzesTab.test.tsx tests/components/StudentQuizResults.test.tsx tests/components/StudentQuizForm.test.tsx`
- `pnpm test` (301 files / 2655 tests)
- Post-review focused checks for blueprint/test paths and isolated `StudentHistoryPage` flake rerun.
- `bash .codex/skills/pika-ui-verify/scripts/ui_verify.sh "classrooms"`
- `bash .codex/skills/pika-ui-verify/scripts/ui_verify.sh "classrooms/e80aa794-e2d6-4705-9da5-d08ab0fba861?tab=tests"`
- `bash .codex/skills/pika-ui-verify/scripts/ui_verify.sh "classrooms/e80aa794-e2d6-4705-9da5-d08ab0fba861?tab=gradebook"`

## 2026-06-08 — Legacy quiz UI naming cleanup

**Completed:**
- Created `codex/legacy-quiz-naming-cleanup` from `origin/main` after PR #758.
- Renamed remaining legacy quiz-named UI component implementations and component tests to test-named files.
- Left old `Quiz*`/`StudentQuizzesTab` files as thin compatibility wrappers around the new `Test*` implementations.
- Updated active app imports and component test mocks to use the new test-named modules.
- Preserved database/type/API compatibility names such as `quizzes`, `QuizQuestion`, and `quiz` response payload keys for a later contract-level pass.

**Validation:**
- `bash .codex/skills/pika-session-start/scripts/session_start.sh`
- `pnpm test tests/components/StudentTestsTab.test.tsx tests/components/TestDetailPanel.test.tsx tests/components/StudentTestForm.test.tsx tests/components/StudentTestResults.test.tsx tests/components/TestResultsView.test.tsx tests/components/TestIndividualResponses.test.tsx tests/components/TeacherTestsTab.test.tsx tests/components/ClassroomPageClientAssignmentsEditMode.test.tsx`
- `pnpm lint`
- `pnpm test` (301 files / 2655 tests)
- `pnpm build`

## 2026-06-09 — Main to production release sync

**Completed:**
- Ran the repository `pika-main-to-production-merge` workflow to merge latest `main` into `production`.
- Created and merged PR #760: https://github.com/codepetca/pika/pull/760.
- Stabilized the calendar class-day toggle test by mocking Toronto today so it no longer depends on the real current date.
- Fast-forwarded the local production worktree to `origin/production` at `feb050be1281f8ba1d8c1fc8249f912353a4fe0a`.

**Validation:**
- `pnpm vitest run tests/components/TeacherCalendarPage.test.tsx`
- GitHub PR #760 checks: `Test & Build`, `Check UI Import Policy`, `Check No dark: Classes in App Code`, Vercel status all passed.

## 2026-06-09 — Legacy quiz contract transition

**Completed:**
- Created `codex/legacy-quiz-contract-cleanup` from `origin/main`.
- Audited remaining internal `quiz` / `quizzes` references across migrations, API payloads, shared types, server/lib code, UI wrappers, tests, and docs.
- Added dual `test`/`tests` plus legacy `quiz`/`quizzes` response keys to active `/api/*/tests` endpoints.
- Updated active test clients to prefer `test`/`tests` response keys with legacy fallback.
- Added test-named type aliases and `@/lib/tests` helper exports, then migrated active test routes/components to those names.
- Removed unused one-line legacy UI wrappers (`Quiz*`, `StudentQuiz*`, `StudentQuizzesTab`) and updated architecture/UI guidance.
- Left production schema, migrations, legacy DB tables, gradebook legacy fields, and blueprint schema compatibility unchanged.

**Validation:**
- `pnpm exec tsc --noEmit`
- `pnpm vitest run tests/api/teacher/tests-route.test.ts tests/api/teacher/tests-id-route.test.ts tests/api/teacher/tests-results.test.ts tests/api/student/tests-route.test.ts tests/api/student/tests-id.test.ts tests/api/student/tests-results.test.ts tests/api/student/tests-session-status.test.ts tests/components/TeacherTestsTab.test.tsx tests/components/StudentTestsTab.test.tsx tests/components/TestDetailPanel.test.tsx tests/components/StudentTestForm.test.tsx tests/components/StudentTestResults.test.tsx tests/components/TestIndividualResponses.test.tsx`
- `pnpm lint`
- `pnpm build`
- `node scripts/trim-session-log.mjs && node scripts/trim-session-log.mjs --check`
- `pnpm vitest run tests/unit/ai-startup-docs.test.ts`
- `pnpm test` (301 files / 2655 tests)

## 2026-06-09 — Roster summary pane removal

**Completed:**
- Created `codex/remove-roster-summary` from `origin/main`.
- Removed the teacher roster tab's right-side inspector pane and fallback `Roster Summary` panel.
- Kept roster row selection behavior for existing single-student and bulk roster actions.
- Added a component regression test asserting the roster summary inspector and resize separator are absent.

**Validation:**
- `bash .codex/skills/pika-session-start/scripts/session_start.sh` (includes `pnpm test`, 301 files / 2655 tests)
- `pnpm test tests/components/TeacherRosterTab.test.tsx`
- `pnpm lint`
- `E2E_BASE_URL=http://localhost:3001 bash .codex/skills/pika-ui-verify/scripts/ui_verify.sh 'classrooms/6d20a5cb-c497-4dc1-ac74-0637068c8a7f?tab=roster'`
- Live Playwright DOM check: no `Roster Summary`, no `Resize Roster panes` separator, roster scroll pane visible.
- `pnpm build`

## 2026-06-09 — Legacy quiz internal test naming pass

**Completed:**
- Merged PR #762 (`Clean up legacy quiz test contracts`) into `main`.
- Created `codex/legacy-quiz-internal-test-names` from the merged `origin/main`.
- Continued the safe internal naming transition by moving active `/tests` route/test type imports to `Test*` aliases.
- Updated active `/api/*/tests` assertions and the return-visibility integration test to read `test`/`tests` first while preserving explicit legacy `quiz`/`quizzes` equality checks.
- Added test-named mock factories (`createMockTest`, `createMockTestQuestion`, `createMockTestResponse`) over the legacy DB-shaped contracts.
- Migrated `TestDetailPanel` component test fixtures to test-named aliases/helpers without changing the component prop contract or schema-shaped `quiz_id` fields.

**Validation:**
- `bash .codex/skills/pika-session-start/scripts/session_start.sh` (includes `pnpm test`, 301 files / 2655 tests)
- `pnpm exec tsc --noEmit`
- `pnpm lint`
- `pnpm vitest run tests/api/teacher/tests-route.test.ts tests/api/teacher/tests-id-route.test.ts tests/api/student/tests-route.test.ts tests/api/student/tests-id.test.ts tests/api/student/tests-results.test.ts tests/api/student/tests-session-status.test.ts tests/api/integration/test-return-visibility-flow.test.ts tests/components/TestResultsView.test.tsx tests/components/TestDetailPanel.test.tsx tests/hooks/useDraftMode.test.ts tests/components/StudentTestsTab.test.tsx`
- `node scripts/trim-session-log.mjs && node scripts/trim-session-log.mjs --check`

## 2026-06-09 — Legacy quiz student Tests state naming pass

**Completed:**
- Created `codex/legacy-quiz-ui-state-names` from the merged `origin/main`.
- Renamed active `StudentTestsTab` local state, refs, handlers, and selected-detail object keys from quiz-oriented names to test-oriented names.
- Preserved legacy API compatibility response keys (`quiz`, `quizzes`) and existing child component `quizId` prop contracts.
- Did not touch database schema, migrations, RPCs, storage paths, or production API route contracts.

**Validation:**
- `bash .codex/skills/pika-session-start/scripts/session_start.sh` (includes `pnpm test`, 301 files / 2655 tests)
- `pnpm exec tsc --noEmit`
- `pnpm vitest run tests/components/StudentTestsTab.test.tsx`
- `pnpm vitest run tests/components/StudentTestForm.test.tsx tests/components/StudentTestResults.test.tsx`
- `pnpm lint`

## 2026-06-09 — Legacy quiz teacher Tests state naming pass

**Completed:**
- Created `codex/legacy-quiz-teacher-state-names` from merged `origin/main`.
- Renamed `ClassroomPageClient` teacher Tests parent state from `selectedQuiz`/`handleSelectQuiz` to `selectedTest`/`handleSelectTest`.
- Renamed the local pending-delete object key from `quiz` to `test` for active Tests deletion state.
- Preserved legacy `quizId` query cleanup and existing child component/API compatibility contracts.
- Did not touch database schema, migrations, RPCs, storage paths, or production API route contracts.

**Validation:**
- `bash .codex/skills/pika-session-start/scripts/session_start.sh` (includes `pnpm test`, 301 files / 2655 tests)
- `pnpm exec tsc --noEmit`
- `pnpm vitest run tests/components/ClassroomPageClientAssignmentsEditMode.test.tsx tests/components/TeacherTestsTab.test.tsx`
- `pnpm lint`

## 2026-06-09 — Legacy quiz component prop alias pass

**Completed:**
- Created `codex/legacy-quiz-prop-aliases` from merged `origin/main`.
- Added test-named component prop aliases while preserving legacy compatibility props:
  `testId` for `StudentTestForm`, `StudentTestResults`, and `TestIndividualResponses`; `test`/`onTestUpdate` for `TestDetailPanel`.
- Migrated active app callers in `StudentTestsTab`, `TeacherTestsTab`, `TeacherTestPreviewPage`, and `TestDetailPanel` to test-named props.
- Left legacy `quizId`, `quiz`, and `onQuizUpdate` props supported for existing tests/hidden callers.
- Did not touch database schema, migrations, RPCs, storage paths, API payload keys, or DB-shaped `quiz_id` fields.

**Validation:**
- `bash .codex/skills/pika-session-start/scripts/session_start.sh` (includes `pnpm test`, 301 files / 2655 tests)
- `pnpm exec tsc --noEmit`
- `pnpm vitest run tests/components/StudentTestsTab.test.tsx tests/components/StudentTestForm.test.tsx tests/components/StudentTestResults.test.tsx tests/components/TestIndividualResponses.test.tsx tests/components/TestDetailPanel.test.tsx tests/components/TeacherTestsTab.test.tsx tests/components/ClassroomPageClientAssignmentsEditMode.test.tsx`
- `pnpm lint`

## 2026-06-09 — Legacy quiz component test prop migration pass

**Completed:**
- Created `codex/legacy-quiz-test-prop-tests` from merged `origin/main`.
- Migrated direct component tests for `StudentTestForm`, `StudentTestResults`, `TestIndividualResponses`, and `TestDetailPanel` to active `testId`, `test`, and `onTestUpdate` props.
- Added narrow compatibility assertions for legacy `quizId`, `quiz`, and `onQuizUpdate` aliases so fallback support remains intentional.
- Updated the `TeacherTestsTab` mock of `TestDetailPanel` to model the active test-named prop contract instead of accepting legacy aliases.
- Did not touch production runtime code, database schema, migrations, RPCs, storage paths, API payload keys, or DB-shaped `quiz_id` fields.

**Validation:**
- `bash .codex/skills/pika-session-start/scripts/session_start.sh` (includes `pnpm test`, 301 files / 2655 tests before edits)
- `pnpm vitest run tests/components/StudentTestForm.test.tsx tests/components/StudentTestResults.test.tsx tests/components/TestIndividualResponses.test.tsx tests/components/TestDetailPanel.test.tsx tests/components/TeacherTestsTab.test.tsx`
- `pnpm exec tsc --noEmit`
- `pnpm lint`
- `node scripts/trim-session-log.mjs && node scripts/trim-session-log.mjs --check`
- `pnpm test` (301 files / 2662 tests)

## 2026-06-09 — Session log trim buffer

**Completed:**
- Split the session-log trim policy into a 60-entry CI cap and a 40-entry default retention target.
- Preserved `--check --keep` compatibility without adding another public flag.
- Updated startup guidance and trim tests so agents compact below the CI boundary after appending.

**Validation:**
- `node scripts/trim-session-log.mjs && node scripts/trim-session-log.mjs --check` (kept 40 of 61 entries; cap 60)
- `pnpm test tests/unit/trim-session-log.test.ts tests/unit/ai-startup-docs.test.ts`

## 2026-06-09 — Remove trim --max flag

**Completed:**
- Removed the public `--max` option from `scripts/trim-session-log.mjs`.
- Kept the default trim target at 40 entries and the default check cap at 60 entries.
- Preserved legacy `--check --keep N` compatibility for explicit check caps.
- Added coverage that `--max` is rejected and no longer appears in usage text.

**Validation:**
- `pnpm test tests/unit/trim-session-log.test.ts tests/unit/ai-startup-docs.test.ts`
- `node scripts/trim-session-log.mjs --check`

## 2026-06-09 — Legacy quiz TestDetailPanel internal rename pass

**Completed:**
- Created `codex/legacy-quiz-test-detail-internals` from merged `origin/main`.
- Renamed `TestDetailPanel` component-local runtime internals from legacy quiz names to test/assessment names:
  resolved assessment object, update notifier, request scope `testId`, defaults ref, loaded-draft guard, and detail load callback.
- Preserved public compatibility props (`quiz`, `onQuizUpdate`), API response fallback (`data.quiz`), legacy markdown helpers, inactive legacy quiz-mode UI fallbacks, and DB-shaped `quiz_id` fields.
- Did not touch database schema, migrations, RPCs, storage paths, API payload contracts, or production compatibility response keys.

**Validation:**
- `bash .codex/skills/pika-session-start/scripts/session_start.sh` (includes `pnpm test`, 301 files / 2659 tests before edits)
- `pnpm vitest run tests/components/TestDetailPanel.test.tsx tests/components/TeacherTestsTab.test.tsx`
- `pnpm exec tsc --noEmit`
- `pnpm lint`
- `node scripts/trim-session-log.mjs && node scripts/trim-session-log.mjs --check`
- `pnpm test` (301 files / 2659 tests)
