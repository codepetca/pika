# Pika Session Log

Rolling recent session log for AI/human handoffs. Keep this file small; full historical session history lives in `.ai/JOURNAL-ARCHIVE.md`.

**Rules:**
- Append one concise entry for meaningful work, then immediately run `node scripts/trim-session-log.mjs` in the same change.
- CI allows at most 60 entries; the trim step compacts to the latest 40 entries by default so there is headroom for future appends.
- Use `node scripts/trim-session-log.mjs --check` to verify the log is within the 60-entry cap.
- Keep enough recent entries for weekly automations to inspect roughly the last week of work.
- The trim step appends removed entries to `.ai/JOURNAL-ARCHIVE.md`, so trimming never loses history.
- Use `.ai/JOURNAL-ARCHIVE.md` only for historical investigation.

## 2026-06-14 — Individual test response fixture wording

**Completed:**
- Renamed `TestIndividualResponses` current-surface test helper and stale/current fixture ids from quiz wording to test wording.
- Updated stale-response test descriptions to say selected test changes.
- Preserved explicit legacy `quizId` alias coverage and left runtime compatibility props unchanged.
- No schema, API payload, or production code changes.

**Validation:**
- `bash .codex/skills/pika-session-start/scripts/session_start.sh`
- `pnpm exec tsc --noEmit`
- `pnpm test tests/components/TestIndividualResponses.test.tsx`
- `pnpm lint`
- `pnpm test`

## 2026-06-14 — Arbitrary quiz fixture wording cleanup

**Completed:**
- Renamed arbitrary announcement and lesson-calendar fixture copy from Quiz wording to Test wording.
- Updated the generic dev-flow risk checklist example from quiz status to test status.
- Left schema, API compatibility keys, gradebook category fields, and legacy alias coverage unchanged.
- No production schema or runtime contract changes.

**Validation:**
- `bash .codex/skills/pika-session-start/scripts/session_start.sh`
- `pnpm exec tsc --noEmit`
- `pnpm test tests/api/teacher/announcements.test.ts tests/unit/announcements.test.ts tests/components/LessonCalendar.test.tsx tests/components/LessonDayCell.test.tsx`
- `pnpm lint`
- `pnpm test` (first run hit unrelated component timeout failures; failed files passed on isolated rerun)
- `pnpm test`

## 2026-06-14 — Student tests response fixture keys

**Completed:**
- Updated `StudentTestsTab` test fixtures to use current `tests`/`test` response keys by default.
- Added explicit legacy `quiz`/`quizzes` response-key fallback coverage for the student tests component.
- Left DB-shaped `quiz_id` question fields and legacy `student-quiz-action-footer` test id unchanged.
- No production code, schema, or API contract changes.

**Validation:**
- `bash .codex/skills/pika-session-start/scripts/session_start.sh`
- `pnpm exec tsc --noEmit`
- `pnpm test tests/components/StudentTestsTab.test.tsx` (first run hit an unrelated exam-mode timeout after the new fallback test passed; rerun passed)
- `pnpm lint`
- `pnpm test`

## 2026-06-14 — Test detail response fixture keys

**Completed:**
- Updated `TestDetailPanel` test fixtures to use current `test` response keys by default.
- Added explicit legacy `quiz` response-key fallback coverage for teacher test detail payloads.
- Preserved legacy `quiz`/`onQuizUpdate` prop alias coverage and the stale same-id quiz assessment scenario.
- No production code, schema, or API contract changes.

**Validation:**
- `bash .codex/skills/pika-session-start/scripts/session_start.sh`
- `pnpm exec tsc --noEmit`
- `pnpm test tests/components/TestDetailPanel.test.tsx`
- `pnpm lint`
- `pnpm test`

## 2026-06-16 — Legacy quiz contract cleanup plan

**Completed:**
- Added `docs/guidance/legacy-quiz-contract-cleanup.md` to inventory remaining internal `quiz` / `quizzes` references by category.
- Documented what can still be safely renamed versus what requires payload, gradebook, course package, or schema migration planning.
- Added routing from `docs/ai-instructions.md` and the architecture assessments section so future passes load the cleanup guide.
- No production schema, API payload, or runtime behavior changes.

**Validation:**
- `bash .codex/skills/pika-session-start/scripts/session_start.sh`
- `pnpm test tests/unit/ai-startup-docs.test.ts tests/unit/ui-guidance-docs.test.ts tests/unit/course-blueprint-package-docs.test.ts`
- `pnpm lint`
- `pnpm test`

## 2026-06-16 — Legacy quiz markdown fixture clarity

**Completed:**
- Updated `tests/lib/quiz-markdown.test.ts` so the suite explicitly describes legacy quiz markdown compatibility.
- Replaced arbitrary `Intro Quiz` fixture titles with `Legacy Check-in` while preserving the intentional `# Quiz` legacy markdown format.
- Left production markdown helpers, schema, API payloads, and runtime behavior unchanged.

**Validation:**
- `bash .codex/skills/pika-session-start/scripts/session_start.sh`
- `pnpm test tests/lib/quiz-markdown.test.ts`
- `pnpm lint`
- `pnpm test`

## 2026-06-16 — Test AI gold-set fixture wording

**Completed:**
- Renamed the active Test AI grading gold-set title from `Intro CS Concepts Quiz` to `Intro CS Concepts Test`.
- Verified the old fixture wording is gone from scripts/tests/source docs.
- Left AI grading logic, schema, API payloads, and runtime contracts unchanged.

**Validation:**
- `bash .codex/skills/pika-session-start/scripts/session_start.sh`
- `pnpm tsx scripts/measure-ai-grading-prompts.ts`
- `pnpm lint`
- `pnpm test`

## 2026-06-19 — Skill progression map refresh

**Completed:**
- Reviewed recent merged PRs and review evidence to identify the next engineering skills worth deepening.
- Anchored recommendations to the June 8-16, 2026 PR cluster around legacy quiz-to-test contract cleanup and classroom-switch race-condition fixes.
- Found that the strongest recurring review signals were stale async state during classroom navigation and compatibility gaps during naming-contract migration.

**Validation:**
- `bash .codex/skills/pika-session-start/scripts/session_start.sh --orient-only`
- `gh pr list --repo codepetca/pika --state merged --limit 15 --json number,title,mergedAt,url`
- `gh api graphql` review scan across recent merged PRs

## 2026-06-19 — Dev-flow skill upgrades

**Completed:**
- Implemented the three skill improvements as repo guidance updates instead of a separate process layer.
- Strengthened `docs/guidance/dev-flow-risk-checklists.md` with explicit route-owner identity, stale-response guards, and A-then-B regression expectations for workspace-state work.
- Expanded `docs/guidance/schema-rollout-checklist.md` and `docs/guidance/legacy-quiz-contract-cleanup.md` to require explicit migration slices, new-contract-first readers, and listed surviving legacy aliases.
- Expanded `docs/guidance/component-refactor-checklist.md` to require sliced refactors with grep/test exit criteria.
- Wired the new checks into `.codex/prompts/session-start.md`, `.codex/prompts/audit.md`, and `.codex/prompts/tdd.md`.

**Validation:**
- `git diff -- docs/guidance/dev-flow-risk-checklists.md docs/guidance/schema-rollout-checklist.md docs/guidance/component-refactor-checklist.md docs/guidance/legacy-quiz-contract-cleanup.md .codex/prompts/session-start.md .codex/prompts/audit.md .codex/prompts/tdd.md`
- `sed -n '1,220p' .codex/prompts/tdd.md`

## 2026-06-09 — Classroom theme colors

**Completed:**
- Created `codex/classroom-theme-colors` in a dedicated worktree.
- Added a `theme_color` classroom field with deterministic backfill/default migration and centralized palette helpers.
- Threaded classroom theme colors through teacher, student, and blueprint classroom APIs.
- Added color recognition affordances in teacher/student classroom lists, classroom dropdown/header, and teacher settings.
- Added teacher settings controls for changing the classroom color.
- Rebasing checkpoint: stashed the uncommitted implementation, rebased `codex/classroom-theme-colors` onto `origin/main`, restored the stash without conflicts, and confirmed `079_classroom_theme_color.sql` remains the next migration after `origin/main`'s `078`.
- Repeat rebase checkpoint: fetched `origin/main`; branch was already up to date, stash restored without conflicts, and `079_classroom_theme_color.sql` still follows `origin/main`'s `078` with no duplicate migration prefix.
- Pre-PR self-review fix: kept the student classroom list query tolerant of the pre-migration schema but shaped the JSON response to avoid returning every classroom column.
- Design revision after PR review: removed dot/swatch marker elements, themed the classroom appbar through the header surface/bottom rule, and kept classroom list recognition on existing card borders.
- Final PR update: rebased the revised design commit onto the latest `origin/main`; migration `079_classroom_theme_color.sql` remained correctly sequenced.
- Palette variant update: extended each classroom color to paired light/dark accents, kept the stored value as one palette key, and used CSS theme variables so the appbar/list/settings treatment adapts by mode.
- Default color update: new classrooms and blueprint-instantiated classrooms now choose the least-used active teacher classroom color before repeating.
- Performance follow-up: narrowed student and teacher classroom list queries to rendered fields instead of full classroom rows, with legacy fallbacks when `theme_color` is unavailable during rollout.
- Duplicate-color follow-up: changed existing-classroom migration backfill to assign per-teacher ordered palette positions, changed new-classroom default selection to seed among least-used colors, and added list hydration fallback colors for pre-migration local data.
- UI follow-up: fixed classroom card/settings theme border specificity so existing edges visibly render classroom colors instead of the generic border utility.
- Classroom list card follow-up: added a subtle classroom-accent card surface gradient to teacher/student classroom list cards and drag previews so classroom color is apparent beyond the edge.
- Gradient follow-up: extended classroom gradients farther into list cards and the classroom appbar while keeping the tint subtle.
- Appbar underline follow-up: removed the classroom-colored appbar underline so the active classroom header is identified by the subtle gradient only, with the normal neutral border retained.
- Final gradient/settings follow-up: removed colored list-card edge accents, extended card/appbar gradients further, changed settings color options so every swatch shows its gradient and only the selected option has the accent edge plus label, and propagated saved classroom changes to the page shell so the appbar updates without refresh.
- Left-edge follow-up: restored the classroom accent edge on the appbar left side and classroom card left side while keeping the appbar bottom border neutral and retaining the extended gradients.
- Hover follow-up: changed classroom list card hover/focus feedback from an inner button fill to a full-card classroom-accent outline.
- Bottom-controls follow-up: made the classroom list bottom edit control shell chromeless so the pencil sits on the page without a visible card surface.
- Appbar logo follow-up: changed the Pika logo to a classroom-accent masked mark only when an active classroom theme is present, leaving the normal brand image on unthemed appbars.
- Appbar logo alignment follow-up: normalized brand and classroom logo rendering into the same fixed centered box and removed the appbar left accent edge now that the logo carries the classroom color.
- Classroom card hover follow-up: replaced the full-card hover outline with a subtle whole-card lift and panel shadow increase.
- Appbar logo revert follow-up: removed the classroom-colored Pika logo variant and restored the classroom accent edge on the appbar left side.

**Validation:**
- `bash .codex/skills/pika-session-start/scripts/session_start.sh` (after `pnpm install`; includes `pnpm test`, 301 files / 2655 tests)
- `pnpm test tests/unit/classroom-theme.test.ts tests/lib/validations/teacher.test.ts tests/api/teacher/classrooms.test.ts tests/api/teacher/classrooms-id.test.ts tests/api/student/classrooms.test.ts tests/api/student/classrooms-id.test.ts tests/api/teacher/course-blueprint-instantiate.test.ts tests/components/TeacherClassroomsIndex.test.tsx tests/components/StudentClassroomsIndex.test.tsx tests/components/ClassroomDropdown.test.tsx tests/components/TeacherSettingsTab.test.tsx`
- `pnpm lint`
- `pnpm test` (302 files / 2669 tests)
- `pnpm build`
- `pnpm e2e:auth`
- Playwright screenshots under `/tmp/pika-classroom-theme/` for teacher/student classroom lists, teacher/student detail headers, and teacher settings in light/dark modes.
- Post-rebase: `pnpm test tests/unit/classroom-theme.test.ts tests/lib/validations/teacher.test.ts tests/api/teacher/classrooms.test.ts tests/api/teacher/classrooms-id.test.ts tests/api/student/classrooms.test.ts tests/api/student/classrooms-id.test.ts tests/api/teacher/course-blueprint-instantiate.test.ts tests/components/TeacherClassroomsIndex.test.tsx tests/components/StudentClassroomsIndex.test.tsx tests/components/ClassroomDropdown.test.tsx tests/components/TeacherSettingsTab.test.tsx`
- Post-rebase: `pnpm lint`
- Repeat post-rebase: `pnpm test tests/unit/classroom-theme.test.ts tests/lib/validations/teacher.test.ts tests/api/teacher/classrooms.test.ts tests/api/teacher/classrooms-id.test.ts tests/api/student/classrooms.test.ts tests/api/student/classrooms-id.test.ts tests/api/teacher/course-blueprint-instantiate.test.ts tests/components/TeacherClassroomsIndex.test.tsx tests/components/StudentClassroomsIndex.test.tsx tests/components/ClassroomDropdown.test.tsx tests/components/TeacherSettingsTab.test.tsx`
- Repeat post-rebase: `pnpm lint`
- Pre-PR: `pnpm test tests/unit/classroom-theme.test.ts tests/lib/validations/teacher.test.ts tests/api/teacher/classrooms.test.ts tests/api/teacher/classrooms-id.test.ts tests/api/student/classrooms.test.ts tests/api/student/classrooms-id.test.ts tests/api/teacher/course-blueprint-instantiate.test.ts tests/components/TeacherClassroomsIndex.test.tsx tests/components/StudentClassroomsIndex.test.tsx tests/components/ClassroomDropdown.test.tsx tests/components/TeacherSettingsTab.test.tsx`
- Pre-PR: `pnpm lint`
- Pre-PR: `pnpm build`
- Design revision: `pnpm test tests/unit/classroom-theme.test.ts tests/lib/validations/teacher.test.ts tests/api/teacher/classrooms.test.ts tests/api/teacher/classrooms-id.test.ts tests/api/student/classrooms.test.ts tests/api/student/classrooms-id.test.ts tests/api/teacher/course-blueprint-instantiate.test.ts tests/components/AppHeader.test.tsx tests/components/TeacherClassroomsIndex.test.tsx tests/components/StudentClassroomsIndex.test.tsx tests/components/ClassroomDropdown.test.tsx tests/components/TeacherSettingsTab.test.tsx`
- Design revision: `pnpm lint`
- Design revision: `pnpm build`
- Design revision visual verification: `E2E_BASE_URL=http://localhost:3002 bash .codex/skills/pika-ui-verify/scripts/ui_verify.sh classrooms`; plus Playwright screenshots for teacher/student classroom detail and teacher settings in light/dark mode under `/tmp/pika-classroom-theme-appbar-*.png`.
- Final post-rebase: `pnpm test tests/unit/classroom-theme.test.ts tests/lib/validations/teacher.test.ts tests/api/teacher/classrooms.test.ts tests/api/teacher/classrooms-id.test.ts tests/api/student/classrooms.test.ts tests/api/student/classrooms-id.test.ts tests/api/teacher/course-blueprint-instantiate.test.ts tests/components/AppHeader.test.tsx tests/components/TeacherClassroomsIndex.test.tsx tests/components/StudentClassroomsIndex.test.tsx tests/components/ClassroomDropdown.test.tsx tests/components/TeacherSettingsTab.test.tsx`
- Final post-rebase: `pnpm lint`
- Palette variant update: `pnpm test tests/unit/classroom-theme.test.ts tests/api/teacher/classrooms.test.ts tests/lib/server/course-blueprints.test.ts tests/components/AppHeader.test.tsx tests/components/TeacherSettingsTab.test.tsx`
- Palette variant update: `pnpm test tests/unit/classroom-theme.test.ts tests/lib/validations/teacher.test.ts tests/api/teacher/classrooms.test.ts tests/api/teacher/classrooms-id.test.ts tests/api/student/classrooms.test.ts tests/api/student/classrooms-id.test.ts tests/api/teacher/course-blueprint-instantiate.test.ts tests/lib/server/course-blueprints.test.ts tests/components/AppHeader.test.tsx tests/components/TeacherClassroomsIndex.test.tsx tests/components/StudentClassroomsIndex.test.tsx tests/components/ClassroomDropdown.test.tsx tests/components/TeacherSettingsTab.test.tsx`
- Palette variant update: `pnpm lint`
- Palette variant update: `pnpm build`
- Palette variant visual verification: `E2E_BASE_URL=http://localhost:3002 bash .codex/skills/pika-ui-verify/scripts/ui_verify.sh classrooms`; targeted screenshots in `/tmp/pika-classroom-theme-variants-*.png`; Playwright computed-style check confirmed light appbar accent `#2563eb` and dark appbar accent `#60a5fa`.
- Performance follow-up: `pnpm test tests/api/student/classrooms.test.ts tests/unit/server-classroom-order.test.ts tests/lib/server/classroom-order.test.ts tests/api/teacher/classrooms.test.ts`
- Performance follow-up: `pnpm test tests/unit/classroom-theme.test.ts tests/lib/validations/teacher.test.ts tests/api/teacher/classrooms.test.ts tests/api/teacher/classrooms-id.test.ts tests/api/student/classrooms.test.ts tests/api/student/classrooms-id.test.ts tests/api/teacher/course-blueprint-instantiate.test.ts tests/lib/server/course-blueprints.test.ts tests/unit/server-classroom-order.test.ts tests/lib/server/classroom-order.test.ts tests/components/AppHeader.test.tsx tests/components/TeacherClassroomsIndex.test.tsx tests/components/StudentClassroomsIndex.test.tsx tests/components/ClassroomDropdown.test.tsx tests/components/TeacherSettingsTab.test.tsx`
- Performance follow-up: `pnpm lint`
- Performance follow-up: `pnpm build`
- Duplicate-color follow-up: `supabase db query --local --output json "<read-only CTE verification>"` confirmed same-teacher classrooms get Blue then Teal before repeating.
- Duplicate-color follow-up: `pnpm test tests/unit/classroom-theme.test.ts tests/unit/classroom-theme-migration.test.ts tests/unit/server-classrooms.test.ts tests/api/teacher/classrooms.test.ts tests/api/student/classrooms.test.ts tests/api/student/classrooms-id.test.ts tests/components/TeacherClassroomsIndex.test.tsx tests/components/StudentClassroomsIndex.test.tsx tests/components/ClassroomDropdown.test.tsx tests/components/AppHeader.test.tsx tests/components/TeacherSettingsTab.test.tsx`
- Duplicate-color follow-up: `pnpm test tests/unit/classroom-theme.test.ts tests/unit/classroom-theme-migration.test.ts tests/unit/server-classrooms.test.ts tests/lib/validations/teacher.test.ts tests/api/teacher/classrooms.test.ts tests/api/teacher/classrooms-id.test.ts tests/api/student/classrooms.test.ts tests/api/student/classrooms-id.test.ts tests/api/teacher/course-blueprint-instantiate.test.ts tests/lib/server/course-blueprints.test.ts tests/unit/server-classroom-order.test.ts tests/lib/server/classroom-order.test.ts tests/components/AppHeader.test.tsx tests/components/TeacherClassroomsIndex.test.tsx tests/components/StudentClassroomsIndex.test.tsx tests/components/ClassroomDropdown.test.tsx tests/components/TeacherSettingsTab.test.tsx`
- Duplicate-color follow-up: `pnpm lint`
- Duplicate-color follow-up: `pnpm build`
- Duplicate-color visual verification: `E2E_BASE_URL=http://localhost:3002 bash .codex/skills/pika-ui-verify/scripts/ui_verify.sh classrooms`; Playwright computed-style check confirmed the local test list renders Blue and Teal card-edge colors for the two teacher classrooms.
- Classroom list card follow-up: `pnpm test tests/components/TeacherClassroomsIndex.test.tsx tests/components/StudentClassroomsIndex.test.tsx tests/components/ClassroomDropdown.test.tsx tests/unit/classroom-theme.test.ts tests/unit/server-classrooms.test.ts`
- Classroom list card follow-up: `pnpm test tests/unit/classroom-theme.test.ts tests/unit/classroom-theme-migration.test.ts tests/unit/server-classrooms.test.ts tests/lib/validations/teacher.test.ts tests/api/teacher/classrooms.test.ts tests/api/teacher/classrooms-id.test.ts tests/api/student/classrooms.test.ts tests/api/student/classrooms-id.test.ts tests/api/teacher/course-blueprint-instantiate.test.ts tests/lib/server/course-blueprints.test.ts tests/unit/server-classroom-order.test.ts tests/lib/server/classroom-order.test.ts tests/components/AppHeader.test.tsx tests/components/TeacherClassroomsIndex.test.tsx tests/components/StudentClassroomsIndex.test.tsx tests/components/ClassroomDropdown.test.tsx tests/components/TeacherSettingsTab.test.tsx`
- Classroom list card follow-up: `pnpm lint`
- Classroom list card follow-up: `pnpm build` after clearing stale generated `.next` output from an overlapping dev-server build.
- Classroom list card visual verification: `E2E_BASE_URL=http://localhost:3002 bash .codex/skills/pika-ui-verify/scripts/ui_verify.sh classrooms`; Playwright computed-style check confirmed list cards render classroom-color gradients.
- Gradient follow-up: `pnpm test tests/components/TeacherClassroomsIndex.test.tsx tests/components/StudentClassroomsIndex.test.tsx tests/components/AppHeader.test.tsx tests/unit/classroom-theme.test.ts`
- Gradient follow-up: `pnpm lint`
- Gradient follow-up: `pnpm build`
- Gradient visual verification: `E2E_BASE_URL=http://localhost:3002 bash .codex/skills/pika-ui-verify/scripts/ui_verify.sh classrooms`; Playwright computed-style check confirmed appbar gradient stops at 22%/78% and card gradient stops at 18%/62%.
- Appbar underline follow-up: `pnpm test tests/components/AppHeader.test.tsx`
- Appbar underline follow-up: `pnpm test tests/unit/classroom-theme.test.ts tests/unit/classroom-theme-migration.test.ts tests/unit/server-classrooms.test.ts tests/lib/validations/teacher.test.ts tests/api/teacher/classrooms.test.ts tests/api/teacher/classrooms-id.test.ts tests/api/student/classrooms.test.ts tests/api/student/classrooms-id.test.ts tests/api/teacher/course-blueprint-instantiate.test.ts tests/lib/server/course-blueprints.test.ts tests/unit/server-classroom-order.test.ts tests/lib/server/classroom-order.test.ts tests/components/AppHeader.test.tsx tests/components/TeacherClassroomsIndex.test.tsx tests/components/StudentClassroomsIndex.test.tsx tests/components/ClassroomDropdown.test.tsx tests/components/TeacherSettingsTab.test.tsx`
- Appbar underline follow-up: `pnpm lint`
- Appbar underline follow-up: `pnpm build`
- Appbar underline visual verification: `E2E_BASE_URL=http://localhost:3002 bash .codex/skills/pika-ui-verify/scripts/ui_verify.sh classrooms`; Playwright computed-style check confirmed header gradient remains, box-shadow is `none`, and the bottom border is neutral.
- Final gradient/settings follow-up: `pnpm test tests/components/TeacherSettingsTab.test.tsx tests/components/ClassroomPageClientAssignmentsEditMode.test.tsx tests/components/TeacherClassroomsIndex.test.tsx tests/components/StudentClassroomsIndex.test.tsx tests/components/AppHeader.test.tsx tests/unit/classroom-theme.test.ts`
- Final gradient/settings follow-up: `pnpm test tests/unit/classroom-theme.test.ts tests/unit/classroom-theme-migration.test.ts tests/unit/server-classrooms.test.ts tests/lib/validations/teacher.test.ts tests/api/teacher/classrooms.test.ts tests/api/teacher/classrooms-id.test.ts tests/api/student/classrooms.test.ts tests/api/student/classrooms-id.test.ts tests/api/teacher/course-blueprint-instantiate.test.ts tests/lib/server/course-blueprints.test.ts tests/unit/server-classroom-order.test.ts tests/lib/server/classroom-order.test.ts tests/components/AppHeader.test.tsx tests/components/TeacherClassroomsIndex.test.tsx tests/components/StudentClassroomsIndex.test.tsx tests/components/ClassroomDropdown.test.tsx tests/components/TeacherSettingsTab.test.tsx tests/components/ClassroomPageClientAssignmentsEditMode.test.tsx`
- Final gradient/settings follow-up: `pnpm lint`
- Final gradient/settings follow-up: `pnpm build`
- Final gradient/settings visual verification: `E2E_BASE_URL=http://localhost:3002 bash .codex/skills/pika-ui-verify/scripts/ui_verify.sh classrooms`; Playwright screenshots `/tmp/pika-classroom-theme-no-edge-extended-card.png`, `/tmp/pika-classroom-theme-settings-swatches-before.png`, `/tmp/pika-classroom-theme-settings-swatches-after.png`, and `/tmp/pika-classroom-theme-no-edge-extended-appbar.png`; computed-style check confirmed list cards have neutral 1px left borders, all settings options have gradients, only the selected option has a 4px accent edge, and the appbar changed from Blue to Teal without refresh.
- Left-edge follow-up: `pnpm test tests/components/AppHeader.test.tsx tests/components/TeacherClassroomsIndex.test.tsx tests/components/StudentClassroomsIndex.test.tsx tests/components/TeacherSettingsTab.test.tsx tests/components/ClassroomPageClientAssignmentsEditMode.test.tsx tests/unit/classroom-theme.test.ts`
- Left-edge follow-up: `pnpm lint`
- Left-edge follow-up: `pnpm build`
- Left-edge visual verification: `E2E_BASE_URL=http://localhost:3002 bash .codex/skills/pika-ui-verify/scripts/ui_verify.sh classrooms`; Playwright screenshots `/tmp/pika-classroom-theme-left-edge-cards.png` and `/tmp/pika-classroom-theme-left-edge-appbar.png`; computed-style check confirmed 4px accent left borders on classroom cards and appbar, neutral card top borders, neutral appbar bottom border, and no appbar box-shadow underline.
- Hover follow-up: `pnpm test tests/components/TeacherClassroomsIndex.test.tsx tests/components/StudentClassroomsIndex.test.tsx tests/components/AppHeader.test.tsx tests/unit/classroom-theme.test.ts`
- Hover follow-up: `pnpm lint`
- Hover follow-up: `pnpm build`
- Hover visual verification: `E2E_BASE_URL=http://localhost:3002 bash .codex/skills/pika-ui-verify/scripts/ui_verify.sh classrooms`; Playwright screenshots `/tmp/pika-classroom-theme-card-outline-before.png` and `/tmp/pika-classroom-theme-card-outline-hover.png`; computed-style check confirmed hover changes the full card outline while the inner button background stays transparent.
- Bottom-controls follow-up: `pnpm test tests/components/TeacherClassroomsIndex.test.tsx tests/components/TeacherWorkSurfaceActionBar.test.tsx`
- Bottom-controls follow-up: `pnpm lint`
- Bottom-controls follow-up: `pnpm build`
- Bottom-controls visual verification: `E2E_BASE_URL=http://localhost:3002 bash .codex/skills/pika-ui-verify/scripts/ui_verify.sh classrooms`; reviewed `/tmp/pika-teacher.png`, `/tmp/pika-teacher-mobile.png`, and `/tmp/pika-student.png`; dark-mode screenshot `/tmp/pika-classroom-bottom-controls-dark.png`; computed-style check confirmed the classroom bottom controls have transparent background, no shadow, no backdrop blur, and zero padding.
- Appbar logo follow-up: `pnpm test tests/components/AppHeader.test.tsx tests/unit/classroom-theme.test.ts`
- Appbar logo follow-up: `pnpm lint`
- Appbar logo follow-up: `pnpm build`
- Appbar logo visual verification: `E2E_BASE_URL=http://localhost:3002 bash .codex/skills/pika-ui-verify/scripts/ui_verify.sh classrooms`; targeted classroom screenshots `/tmp/pika-classroom-logo-light.png` and `/tmp/pika-classroom-logo-dark.png`; computed-style check confirmed the masked logo uses the light classroom accent in light mode and the dark classroom accent in dark mode.
- Appbar logo alignment follow-up: `pnpm test tests/components/AppHeader.test.tsx tests/unit/classroom-theme.test.ts`
- Appbar logo alignment follow-up: `pnpm lint`
- Appbar logo alignment follow-up: `pnpm build`
- Appbar logo alignment visual verification: `E2E_BASE_URL=http://localhost:3002 bash .codex/skills/pika-ui-verify/scripts/ui_verify.sh classrooms`; targeted screenshot `/tmp/pika-classroom-logo-centered-light.png`; computed geometry check confirmed the brand and classroom logo boxes share the same vertical center offset in the 48px appbar and themed appbars have `0px` left border width.
- Classroom card hover follow-up: `pnpm test tests/components/TeacherClassroomsIndex.test.tsx tests/components/StudentClassroomsIndex.test.tsx`
- Classroom card hover follow-up: `pnpm lint`
- Classroom card hover follow-up: `pnpm build`
- Classroom card hover visual verification: `E2E_BASE_URL=http://localhost:3002 bash .codex/skills/pika-ui-verify/scripts/ui_verify.sh classrooms`; targeted screenshots `/tmp/pika-classroom-hover-elevation-before.png` and `/tmp/pika-classroom-hover-elevation-after.png`; computed-style check confirmed no outline, `translateY(-1px)`, and increased shadow on hover.
- Appbar logo revert follow-up: `pnpm test tests/components/AppHeader.test.tsx tests/unit/classroom-theme.test.ts`
- Appbar logo revert follow-up: `pnpm lint`
- Appbar logo revert follow-up: `pnpm build`
- Appbar logo revert visual verification: `E2E_BASE_URL=http://localhost:3002 bash .codex/skills/pika-ui-verify/scripts/ui_verify.sh classrooms`; targeted screenshot `/tmp/pika-classroom-appbar-brand-logo-left-edge.png`; computed-style check confirmed the appbar uses the brand image, has no masked logo, and renders a 4px classroom-accent left border.
- Bright palette follow-up: updated classroom theme labels/colors to a brighter set (Sky, Mint, Lime, Sunshine, Coral, Grape, Aqua, Peach) while keeping stored theme keys stable.
- Bright palette follow-up: `pnpm test tests/unit/classroom-theme.test.ts tests/components/TeacherSettingsTab.test.tsx tests/components/AppHeader.test.tsx tests/components/TeacherClassroomsIndex.test.tsx tests/components/StudentClassroomsIndex.test.tsx`
- Bright palette follow-up: `pnpm lint`
- Bright palette follow-up: `pnpm build`
- Bright palette visual verification: `E2E_BASE_URL=http://localhost:3002 bash .codex/skills/pika-ui-verify/scripts/ui_verify.sh classrooms`; reviewed `/tmp/pika-teacher.png`, `/tmp/pika-teacher-mobile.png`, and `/tmp/pika-student.png`; targeted settings screenshots `/tmp/pika-settings-light.png` and `/tmp/pika-settings-dark.png` confirmed brighter palette swatches and appbar gradients remain legible in light and dark mode.
- Full-border follow-up: replaced the classroom-color left edge on classroom list cards and the classroom appbar with a 1px classroom-color border on all sides, keeping the existing gradients.
- Full-border follow-up: `pnpm test tests/components/AppHeader.test.tsx tests/components/TeacherClassroomsIndex.test.tsx tests/components/StudentClassroomsIndex.test.tsx tests/components/SortableClassroomRow.test.tsx tests/components/TeacherSettingsTab.test.tsx tests/components/ClassroomPageClientAssignmentsEditMode.test.tsx tests/unit/classroom-theme.test.ts`
- Full-border follow-up: `bash .codex/skills/pika-audit/scripts/audit.sh`
- Full-border follow-up: `pnpm lint`
- Full-border follow-up: `pnpm build`
- Full-border visual verification: `E2E_BASE_URL=http://localhost:3002 bash .codex/skills/pika-ui-verify/scripts/ui_verify.sh classrooms` and `E2E_BASE_URL=http://localhost:3002 bash .codex/skills/pika-ui-verify/scripts/ui_verify.sh classrooms/ddb6fbe4-66b3-46cf-9efa-21cb4f2a5218`; computed-style check confirmed teacher classroom cards and the appbar all render 1px accent-colored borders on top/right/bottom/left.
- Full-border post-rebase: rebased cleanly onto `origin/main`; migration `079_classroom_theme_color.sql` remains next after main's `078_assignment_gradex_run_metadata.sql` with no duplicate migration prefixes.
- Gradient-only follow-up: removed classroom-colored border overrides from classroom cards and the appbar, leaving the existing classroom gradients as the sole classroom color signal on those surfaces.
- Gradient-only follow-up: `pnpm test tests/components/AppHeader.test.tsx tests/components/TeacherClassroomsIndex.test.tsx tests/components/StudentClassroomsIndex.test.tsx tests/components/SortableClassroomRow.test.tsx tests/unit/classroom-theme.test.ts`
- Gradient-only follow-up: `bash .codex/skills/pika-audit/scripts/audit.sh`
- Gradient-only follow-up: `pnpm lint`
- Gradient-only follow-up: `pnpm build`
- Gradient-only visual verification: `E2E_BASE_URL=http://localhost:3002 bash .codex/skills/pika-ui-verify/scripts/ui_verify.sh classrooms` and `E2E_BASE_URL=http://localhost:3002 bash .codex/skills/pika-ui-verify/scripts/ui_verify.sh classrooms/ddb6fbe4-66b3-46cf-9efa-21cb4f2a5218`; computed-style check confirmed card/header borders are neutral while gradients remain.

## 2026-06-13 — API auth-boundary negative coverage

**Completed:**
- Continued the systems/UI audit program with the API authorization-boundary slice.
- Added negative teacher ownership and student enrollment coverage for legacy `GET /api/teacher/class-days`.
- Added matching negative coverage for canonical `GET /api/classrooms/[classroomId]/class-days`.
- Added teacher-side `GET /api/student/tests/[id]/history` coverage for non-owned tests and students outside the test classroom.
- Confirmed the existing routes already block these paths before downstream class-day/history data reads; no production route changes were needed.

**Validation:**
- `pnpm vitest run tests/api/teacher/class-days.test.ts tests/api/classrooms-class-days.test.ts tests/api/student/tests-history.test.ts` (18 tests)
- `git diff --check`
- `pnpm lint`
- `bash .codex/skills/pika-audit/scripts/audit.sh`
- `pnpm build`
- `pnpm vitest run --sequence.concurrent=false` (303 files / 2690 tests)

## 2026-06-20 — Pika logo dark-token cleanup

**Completed:**
- Continued the systems/UI audit program with a bounded UI consistency slice.
- Moved the Pika logo dark-mode filter out of component-local `dark:` utility classes and into `src/styles/tokens.css` as `--pika-logo-filter`.
- Updated `PikaLogo` to use the semantic `pika-logo` class.
- Removed the obsolete `PikaLogo` `dark:` exception from the active design guidance.
- Added AppHeader regression coverage that asserts the logo uses the tokenized class and no component-level `dark:` utilities.
- Addressed subagent review feedback by matching Tailwind's previous composed filter order for the dark-mode logo token.

**Validation:**
- `rg -n "dark:" src/app src/components --glob '*.tsx' --glob '*.ts'` returned no matches.
- `pnpm vitest run tests/components/AppHeader.test.tsx`
- `pnpm vitest run tests/unit/ui-guidance-docs.test.ts tests/unit/ai-startup-docs.test.ts tests/components/AppHeader.test.tsx`
- `pnpm lint`
- `bash .codex/skills/pika-audit/scripts/audit.sh`
- `pnpm build`
- Visual verification: `bash .codex/skills/pika-ui-verify/scripts/ui_verify.sh classrooms`; reviewed `/tmp/pika-teacher.png`, `/tmp/pika-teacher-mobile.png`, and `/tmp/pika-student.png`.
- Additional visual verification for role/viewport/theme matrix: reviewed `/tmp/pika-student-desktop.png`, `/tmp/pika-teacher-dark.png`, `/tmp/pika-teacher-mobile-dark.png`, `/tmp/pika-student-dark.png`, and `/tmp/pika-student-mobile-dark.png`.
- Post-review fix validation: `pnpm vitest run tests/components/AppHeader.test.tsx tests/unit/ui-guidance-docs.test.ts`, `git diff --check`, `pnpm lint`, `bash .codex/skills/pika-audit/scripts/audit.sh`, `pnpm build`.
- Post-review visual verification: reviewed `/tmp/pika-teacher-dark-after-review.png` and `/tmp/pika-student-mobile-dark-after-review.png`.

## 2026-06-20 — Historical design-system dark-mode examples cleanup

**Completed:**
- Continued the systems/UI audit program with a docs-only UI guidance consistency slice.
- Updated the historical `docs/design-system.md` dark-mode section so it points to semantic tokens instead of raw theme-switching utility examples.
- Added UI guidance regression coverage to keep that historical section aligned with semantic-token guidance.
- Addressed subagent review feedback by tightening the regression test to match exact semantic-token class examples.

**Validation:**
- `pnpm vitest run tests/unit/ui-guidance-docs.test.ts`
- `git diff --check`
- `pnpm lint`
- `bash .codex/skills/pika-audit/scripts/audit.sh`
- Post-review fix validation: `pnpm vitest run tests/unit/ui-guidance-docs.test.ts`, `git diff --check`, `pnpm lint`, `bash .codex/skills/pika-audit/scripts/audit.sh`

## 2026-06-20 — Browser Supabase access audit guard

**Completed:**
- Continued the bounded systems/UI audit program with the browser-side Supabase access slice.
- Audited non-API/non-server source imports and confirmed current direct Supabase runtime usage is limited to server-rendered classroom pages and the shared server client module; `src/lib/user-profile.ts` uses a type-only Supabase import.
- Added static regression coverage that fails if a browser-reachable module imports `@/lib/supabase` or `@supabase/supabase-js` at runtime.
- Addressed subagent review feedback by changing the guard from a direct client-file scan to a TypeScript-AST runtime import graph rooted at every `use client` source file, while allowing type-only Supabase imports and catching static imports, dynamic imports, and `require()` calls.
- No production UI or runtime behavior changed.

**Validation:**
- `rg -n "@/lib/supabase|@supabase/supabase-js|getSupabaseClient|getServiceRoleClient" src/app src/components src/hooks src/lib src/ui --glob '*.{ts,tsx}' --glob '!src/app/api/**' --glob '!src/lib/server/**'`
- `pnpm test tests/unit/browser-supabase-access.test.ts tests/unit/api-route-standards.test.ts tests/unit/supabase.test.ts`
- `git diff --check`
- `pnpm lint`
- `bash .codex/skills/pika-audit/scripts/audit.sh`
- `pnpm build`

## 2026-06-20 — Student notification read-cache audit

**Completed:**
- Continued the bounded systems/UI audit program with the client read-cache drift slice.
- Audited client GET reads for repeated classroom-scoped requests and identified student notification reads as a concrete fix-now item.
- Wrapped `StudentNotificationsProvider` notification GETs in `fetchJSONWithCache` with a short classroom-scoped TTL so same-classroom mounts/focus reads dedupe.
- Invalidated the classroom notification cache when local notification helpers mark/decrement counts and before explicit `refresh()` so quick remounts or manual refreshes cannot replay stale pre-action counts.
- Added regression coverage for simultaneous same-classroom provider reads, explicit refresh freshness, and post-local-update remount freshness.
- No UI layout or styling changed.

**Validation:**
- `pnpm test tests/components/StudentNotificationsProvider.test.tsx`
- `git diff --check`
- `pnpm lint`
- `bash .codex/skills/pika-audit/scripts/audit.sh`
- `pnpm build`

## 2026-06-20 — Composite widget accessibility audit

**Completed:**
- Continued the bounded systems/UI audit program with the composite-widget accessibility slice.
- Audited shared menu/listbox widgets and identified a concrete fix-now issue in the `useDropdownNav` consumers: closed account/classroom dropdown surfaces stayed exposed in the accessibility tree, and Escape/outside close did not return focus to the trigger.
- Added a trigger ref and focus restoration path to `useDropdownNav` for Escape, outside click, and trigger-close behavior.
- Marked closed `UserMenu` and `ClassroomDropdown` menu/listbox surfaces with `aria-hidden` while preserving their existing visual transitions.
- Added semantic regression coverage for closed menus being unavailable by role and focus restoration after Escape/outside close.

**Accessibility checklist:**
- checklist reviewed: yes
- keyboard behavior covered: yes
- semantic state covered by tests: yes
- remaining manual follow-up: none

**Validation:**
- `pnpm test tests/components/ClassroomDropdown.test.tsx tests/components/UserMenu.test.tsx`
- `git diff --check`
- `pnpm lint`
- `bash .codex/skills/pika-audit/scripts/audit.sh`
- `pnpm build`
- `bash .codex/skills/pika-ui-verify/scripts/ui_verify.sh classrooms`; reviewed `/tmp/pika-teacher.png`, `/tmp/pika-student.png`, and `/tmp/pika-teacher-mobile.png`.
- Additional open-state visual verification: reviewed `/tmp/pika-user-menu-open.png` and `/tmp/pika-classroom-dropdown-open.png`.
- `pnpm test` (308 files / 2742 tests)

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
