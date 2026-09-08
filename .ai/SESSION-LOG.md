# Pika Session Log

Rolling recent session log for AI/human handoffs. Keep this file small; full historical session history lives in `.ai/JOURNAL-ARCHIVE.md`.

**Rules:**
- Append one concise entry for meaningful work, then immediately run `node scripts/trim-session-log.mjs` in the same change.
- Start each entry heading with a valid ISO date (`## YYYY-MM-DD ...`) so retention can identify the latest entries.
- CI allows at most 60 entries; the trim step compacts to the latest 40 entries by default so there is headroom for future appends.
- Use `node scripts/trim-session-log.mjs --check` to reject empty entries and verify the log is chronological and within the 60-entry cap.
- Keep enough recent entries for weekly automations to inspect roughly the last week of work.
- The trim step appends removed entries to `.ai/JOURNAL-ARCHIVE.md`, so trimming never loses history.
- Use `.ai/JOURNAL-ARCHIVE.md` only for historical investigation.

## 2026-09-05 — Use override terminology in Daily attendance

- Updated the Daily attendance row undo affordance in the live teacher surface and Pattern Lab from “Undo manual change” to “Undo override,” including accessible labels and hover tooltips. Updated focused component and browser assertions; batch “Revert manual changes” wording remains unchanged.
- Focused tests, architecture/UI/design policy, TypeScript, lint, and the full Pattern Lab visual matrix passed across teacher/student, desktop/mobile, and light/dark states. Risk profile: none; no schema, data, API, dependency, or layout change.

## 2026-09-05 — Place Daily Log before scan time

- Reordered the Daily attendance table in the live teacher surface and Pattern Lab so Log appears before Time of scan and the Present/Late/Absent status bubbles. The mobile inline check-in time and existing sticky status/undo columns remain intact.
- Added order regressions to component and browser verification. Focused tests, architecture/UI/design policy, TypeScript, lint, Pika audit, and the full Pattern Lab visual matrix pass across teacher/student, desktop/mobile, and light/dark states. Risk profile: none; no schema, data, API, dependency, or attendance behavior change.

## 2026-09-05 — Restore local development on Node 24

- The local launcher initially exposed a Next dev-runtime failure while rendering `/login`: `tailwind.config.ts` used CommonJS `require` in an ESM-loaded config. Replaced it with the typed ESM import for `@tailwindcss/typography`, committed locally as `7b14f8c8`, and verified `/login` returns HTTP 200 on port 3001.
- Focused checks pass 44 files / 616 tests plus architecture, UI/design policy, TypeScript and lint. The fix is intentionally unpushed; final PR rebase/review/CI/merge remains deferred until the model reset.

## 2026-09-06 — Keep announcement scheduling visible near the viewport bottom

- Changed the teacher announcement create and edit schedule pickers to open above their Post/Save action row, preventing the date/time panel from falling below the viewport. Added component regressions asserting both pickers use upward placement.
- Focused checks pass 14 files / 165 tests, plus architecture, UI/design policy, TypeScript and lint. Playwright visual verification covered teacher schedule-open desktop/mobile in light/dark and student desktop/mobile announcement states; all rendered within the viewport with no visible overflow.
- Risk profile: none. No schema, data, API, dependency, deployment or merge action is included.

## 2026-09-06 — Add centered roster Student Actions menu

- Added the gradebook's shared centered `Student Actions` menu to the teacher roster. It stays disabled with no selection, changes to the selected count, and exposes only `Copy emails (primary)` and `Copy emails (secondary)`; secondary copy remains disabled when no selected student has a secondary address.
- Removed primary-email, copy-all, Gmail, and Outlook commands from the roster More actions menu, leaving roster management actions there. Added focused coverage for menu placement, labels, clipboard behavior, selected-count state, and provider-command removal.
- Focused checks pass 13 files / 158 tests plus architecture, UI/design policy, TypeScript and lint. Playwright verification passes teacher desktop/mobile light/dark default states, selected/open menu states, and the student route redirects to the student Today surface because roster is teacher-only. No schema, API, dependency, hosted data, deployment, or feature-inventory change.

## 2026-09-06 — Stabilize roster Student Actions width

- Matched the roster Student Actions trigger to the existing fixed-width Tests/gradebook treatment with `w-36`, keeping the centered cluster stable when the label changes from `Student Actions` to a selected count.
- Added regression assertions for the fixed width in both no-selection and selected states. Focused roster tests pass 28 tests; the focused gate passes 13 files / 158 tests plus architecture, UI/design policy, TypeScript and lint.
- Rechecked the live teacher roster at desktop and mobile widths in light and dark themes, including selected and open-menu states. Both trigger states measure 144px and the open menu remains contained. No schema, API, dependency, hosted data, deployment, or feature-inventory change.

## 2026-09-06 — Fix roster secondary-email imports

- Renamed the visible roster secondary-email column and import previews to `Email(2nd)`. Manual Add Students entries now recognize a fourth email as the secondary address when no student number is supplied; CSV uploads accept both the five-column student-number format and the four-column format without one, persisting `counselor_email` in both cases.
- The Add Students and CSV success flows now return the active roster refresh promise so the newly saved secondary address is visible after the modal completes, while stale classroom callbacks remain fenced. Added parser, modal, API, and roster refresh regressions.
- Focused checks pass 19 files / 224 tests plus architecture, UI/design policy, TypeScript and lint. Playwright verification covers the teacher roster at desktop/mobile light/dark, direct secondary-email preview, selected Student Actions, and the reduced More actions menu; student view is n/a because roster management is teacher-only. No schema, migration, dependency, hosted data, deployment, or feature-inventory change.

## 2026-09-06 — Relaunch local Pika development server

- Relaunched the current Pika worktree with the governed local-dev launcher. Port 3000 remains occupied by another local app, so Pika is running at `http://localhost:3001`; `/login` returns HTTP 200 and the server remains running.
- Fixed the existing Tailwind config's Node 24/ESM startup incompatibility by importing the typography plugin instead of calling CommonJS `require`. TypeScript and diff checks pass; no product behavior, schema, migration, hosted data, or deployment changed.

## 2026-09-06 — Show Email(2nd) at medium roster widths

- Fixed the roster `Email(2nd)` column's responsive `<colgroup>` definition so it is visible at the same medium breakpoint as the main email column. At the open 877px in-app roster view, the full header and secondary-email edit controls now appear instead of the column being collapsed by its remaining `lg` rule.
- Added the responsive-column regression assertion. Focused checks pass 19 files / 224 tests plus architecture, UI/design policy, TypeScript and lint; the in-app browser recheck shows the corrected column without layout overflow. No schema, migration, dependency, hosted data, deployment, or feature-inventory change.

## 2026-09-06 — Space roster secondary-email label

- Updated the visible secondary-email wording from `Email(2nd)` to `Email (2nd)` across the roster table, row editor, add-student preview, CSV guidance, and upload confirmation, with matching test fixtures and accessibility assertions.
- Focused checks pass 19 files / 224 tests plus architecture, UI/design policy, TypeScript and lint. Authenticated visual verification shows `Email (2nd)` in the teacher desktop and mobile roster views with no overflow; the student route correctly redirects to Today because roster management is teacher-only. No schema, migration, dependency, hosted data, deployment, or feature-inventory change.

## 2026-09-06 — Normalize omitted roster student numbers

- Normalized missing or blank student numbers in CSV uploads to `null`, matching stored roster rows so an unchanged four-column CSV does not trigger a false overwrite confirmation.
- Added a regression for an existing row with no student number and a matching secondary email. The focused gate passes 19 files / 225 tests plus architecture, UI/design policy, TypeScript and lint; the Pika audit and diff checks pass. No schema, UI, dependency, hosted data, deployment, or feature-inventory change.

## 2026-09-06 — Improve Add Students roster guidance

- Add Students now parses roster text as it is typed, shows the number of students ready to add, and presents malformed lines as compact warning guidance with actionable copy. Removed the redundant preview step so valid rows can be submitted directly. Added the requested example placeholder and moved format instructions into a shared question-mark tooltip beside the field label.
- Reused the existing `IconButton`, `Tooltip`, Lucide `CircleHelp`, and semantic warning tokens; no new shared component or Pattern Lab pattern. Teacher-only surface; verified desktop/mobile and light/dark warning states, with student view n/a because the modal is teacher-only.
- Focused component/parser tests pass 28/28; the focused gate passes 167 tests plus architecture, UI/design policy, TypeScript and lint. Add Students E2E and direct browser interaction checks pass. Visual captures were inspected for tooltip placement, responsive containment, and live warning/count states. Risk profile: none; no schema, data, API, dependency, deployment or merge action.

## 2026-09-06 — Simplify Add Students format help

- Removed the repeated example from the Add Students tooltip and formatted the remaining guidance as three lines: one student per line, `First Last Email [ID] [Email 2]`, and `ID and Email2 are optional`. The placeholder remains the concrete example.
- Reused the existing `IconButton` and `Tooltip`; widened the shared tooltip prop to accept formatted React content without changing existing callers. Focused tests, the full focused gate, teacher/student route captures, and a direct desktop tooltip assertion pass. No schema, data, API, dependency, deployment or merge action.

## 2026-09-06 — Soften Add Students live warnings

- Removed the warning summary sentence and promoted each line-level roster message to readable body size. Reserved a compact warning slot below the textarea so the ready count and action buttons remain stable when guidance appears or clears.
- Reused the existing semantic warning treatment and live status behavior. Component tests, the full focused gate, teacher/student route captures, and desktop/mobile warning and valid-state browser checks pass. No schema, data, API, dependency, deployment or merge action.

## 2026-09-06 — Remove Add Students action divider

- Removed the horizontal divider above the Add Students modal action buttons while preserving the existing button spacing, labels, focus behavior, and submit/cancel semantics.
- Focused checks pass 1,552 tests plus architecture, UI/design policy, TypeScript and lint. Teacher desktop/mobile, student route, and a direct mobile modal capture were inspected; no overflow or spacing regression was visible. No schema, data, API, dependency, deployment or merge action.

## 2026-09-06 — Space and emphasize roster tooltip format

- Added vertical spacing between the three roster-help lines and emphasized `First Last Email [ID] [Email 2]` with semibold text. The optional-fields note remains on its own line.
- Reused the existing tooltip content owner and shared spacing/type tokens. Focused tests, the full focused gate, and direct desktop/mobile browser assertions for line separation, font weight, and containment pass. No schema, data, API, dependency, deployment or merge action.

## 2026-09-06 — Label roster tooltip fields

- Updated the emphasized roster format line to `[First name] [Last name] [Email] [ID] [Email 2]`, italicizing only `ID` and `Email 2` while retaining the existing line spacing and optional-fields note.
- Focused tests, the full focused gate, route-level teacher/student captures, and direct desktop/mobile browser assertions for exact labels, italic styling, and containment pass. No schema, data, API, dependency, deployment or merge action.

## 2026-09-06 — Highlight Add Students problem lines

- Replaced per-line validation advice with one generic guidance line, `Use this format: Jane Doe email@example.com`, removed the `Line 1:`/`Line 2:` warning rows, and made each invalid input line amber in the textarea. Valid rows and the live ready count remain unchanged.
- Reused the existing semantic warning tokens and native textarea behavior with a scroll-synced visual text layer. Focused tests, the full focused gate, route-level captures, and direct desktop/mobile browser checks pass. No schema, data, API, dependency, deployment or merge action; changes remain saved in the feature worktree and are not committed.

## 2026-09-06 — Remove Add Students ready-count copy

- Removed the `x students ready to add` status line from the Add Students modal while keeping live roster parsing, amber invalid-line highlighting, and the enabled/disabled Add button behavior unchanged.
- Focused tests, the full focused gate, the refreshed-session live modal check, and teacher/student route captures pass. No schema, data, API, dependency, deployment or merge action; changes remain saved in the feature worktree and are not committed.

## 2026-09-06 — Resize Add Students input area

- Increased the student-information textarea from 8 to 12 visible lines and tightened the existing action-area spacing from `mt-6 pt-4` to `mt-4 pt-2`. The reserved validation area and button behavior remain unchanged.
- Focused tests, the full focused gate, refreshed-session desktop/mobile modal checks, and teacher/student route captures pass with no overflow. No schema, data, API, dependency, deployment or merge action; changes remain saved in the feature worktree and are not committed.

## 2026-09-06 — Review roster live-validation PR

- Published draft #1207 at d594758c. The independent review found classic-scrollbar mirror misalignment and touch-inaccessible format help. One correction batch measures the textarea client area, adds opt-in tap/click help with a button description, and connects validation advice to the input.
- Added reproducible browser coverage for wrapped roster caret placement, bottom scrolling, and touch opening/dismissal; the scenario passes. Shared-control keyboard/description regressions and a deterministic Pattern Lab help example cover the tooltip extension. Targeted and final independent review precede ready-state CI; no merge is authorized by this PR/review request.

## 2026-09-06 — Mirror calendar items in student Daily panels

- Added shared Toronto date mapping for assignments and announcements so the student Daily Today and Last class panels use the same dates as Calendar. Published announcements use `created_at`; future scheduled announcements use `scheduled_for` when applicable.
- Reused the existing student lesson-plan viewer and announcement renderer, adding date-matched assignment cards, announcement content and navigation back to Classwork or all Announcements. Teacher Daily behavior is unchanged; empty and loading states remain intact.
- Added focused coverage for calendar date mapping and both student date panels. Focused tests pass 5 files / 64 tests; TypeScript, lint, design policy and production build pass. Lint retains one pre-existing `TestDetailPanel` hook warning. Browser verification covered student desktop/mobile light/dark populated states and the existing teacher/student classroom surfaces; no schema, dependency, hosted-data or deployment change.

## 2026-09-06 — Limit student Daily history to five past logs

- Student Daily now requests a six-entry history window and renders at most five entries before today, preserving today’s log plus the five most recent past logs. The broader student History page and API behavior remain unchanged.
- Added a regression covering an overfilled response so stale cache data cannot surface a sixth past log. Focused checks pass 24 files / 278 tests plus architecture, UI policy, design policy, TypeScript and lint. The UI verification script passes on the current classroom-list fixture; the local auth fixture no longer has a classroom for populated-route verification.
- Excluded entries dated on non-class days from that same list, with a regression covering a weekend entry. Final focused checks pass 24 files / 279 tests plus architecture, UI policy, design policy, TypeScript and lint.
- Added class-day-driven empty placeholders: the latest five prior class days now appear in history, with “No log submitted” for missed logs; non-class days remain excluded. Final focused checks pass 24 files / 279 tests plus architecture, UI policy, design policy, TypeScript and lint.

## 2026-09-06 — Show ten past class-day logs in student Daily history

- Expanded student Daily history from five to ten prior class days, still excluding non-class days and preserving empty “No log submitted” rows for missed class days. Today remains the separate current-day editor.
- Updated the history boundary regression and all request/cache fixtures to use today plus ten past entries. Focused checks pass 24 files / 280 tests plus architecture, UI policy, design policy, TypeScript and lint; the Pika audit passes.
- Playwright verification passed student desktop/mobile light/dark captures and teacher desktop/mobile unchanged-state captures. The current seeded classroom has only five past class days, so the ten-row boundary is covered by the focused fixture. Composite-widget checklist reviewed: keyboard behavior remains covered, scheduled semantics have a role/name regression, and no manual follow-up remains. No schema, dependency, hosted-data or deployment change.

## 2026-09-07 — Integrate class-day setup for the sequential merge queue

- Coordinator released PR #1203 after #1209 merged. Rebased onto main `68b3a58c`; class-day source and concurrency remediation remain patch-equivalent. Current main already supplies the typography ESM fix; removed the duplicate import produced by replay and retained main's configuration exactly. Updated the architecture summary to match weekday-only generation and compacted combined session history after the focused gate identified its cap.
- Sole writer remains `codex/classroom-class-days`. The authorized post-hold pass uses existing clean reviews plus one bounded Terra/high cumulative integration review, focused tests and teacher/student browser/visual checks before fresh final-SHA CI and merge to main. Risk profile: workspace-state. No new migration or production action is included.

## 2026-09-07 — Cover class-day review from secondary creation entry points

- The resumed integration reviewer identified that blank classroom creation from Teacher Dashboard and Teacher Calendar did not navigate into the class-day review notice. Reused the existing Classroom page notice and creation redirect; both legacy callbacks now open the created classroom with the review flag, while Blueprint completion retains its in-modal handoff. No new visual composition or component contract is introduced.
- Four regression cases first failed for empty/populated Dashboard and Calendar entry points. The correction is verified with the existing Blueprint handoff tests, focused gate and mocked browser creation through both entry pages. The declared matrix is teacher desktop/mobile light/dark, existing notice/Settings destination as reference; student remains regression-only behind the existing role gate. One targeted cumulative re-review follows this second integration batch before readiness.

## 2026-09-07 — Remediate student Daily calendar and history review findings

- Rebased draft PR #1208 onto current main and resolved its two independent-review findings in one batch. Student Daily now tracks assignments and announcements independently, preserves successful snapshots when one source fails, exposes per-source retry controls, and ignores stale responses after classroom switches.
- Daily history now retrieves the classroom entry set before selecting today and the ten most recent prior class days. Non-class entries can no longer consume the retrieval cap; missed class days remain visible as empty rows and non-class days remain excluded.
- Added regressions for partial calendar failure/retry, stale source races, and eleven non-class entries preceding ten valid class-day logs. The Pika audit passes; focused checks pass 24 files / 284 tests plus architecture, UI/design policy, TypeScript and lint. Playwright verification passes student desktop/mobile light/dark default and source-error states plus teacher desktop/mobile regression views. No schema, dependency, hosted-data or deployment change.
- The cumulative integration pass found four additional boundaries. Added a reactive Toronto-day clock so midnight reloads the editor, history, Today and Last class without carrying content; lesson-plan sources now preserve snapshots and expose retry; scheduled announcements remap when publication time arrives; and successful retries restore focus to the active Daily plan region.
- Added fake-time midnight and publication-boundary coverage plus Today/Last-class failure recovery and focus regressions. Final local checks pass 24 files / 289 tests, the Pika audit, and student desktop/mobile light/dark plus combined lesson-plan-error and teacher regression captures. The extended review remains bounded to one final targeted reviewer before readiness.
- The final targeted review identified browser timer overflow for publication dates more than 24.8 days away and blocking refresh treatment for an existing Last-class snapshot. Publication waits now clamp to the platform limit and re-arm until the exact boundary; Last class keeps its keyed snapshot visible while the shared refresh indicator communicates retry activity.
- Long-range fake-timer and success-to-failed-retry-to-recovery snapshot tests pass. The final focused gate passes 24 files / 291 tests plus architecture, UI/design policy, TypeScript and lint; the Pika audit and refreshed student/teacher desktop/mobile captures pass. One final authorized review launch is required on the stable correction SHA.

## 2026-09-07 — Respect classroom Achievements visibility for Pal overlays

- Task/branch: `codex/fix-disabled-achievement-celebration`. Moved ambient Pal rendering from the persistent layout into the classroom's effective Achievements gate; retained the learner provider and index-page presentation. No reward acknowledgement occurs merely because a classroom disables Achievements.
- Regression coverage: disabled/enabled/global-off states, pending reward refresh, classroom transition, and modal cleanup; 52 focused component tests pass. Visual fixture with the real classroom client and pending early-start reward verified student desktop/mobile and light/dark, enabled/disabled (eight captures in local `output/playwright`). Teacher is n/a: student-only surfaces. Reuses Pal host layers, feature-visibility policy, and ModalLayer; no design/style changes or new pattern. Composite checklist reviewed; keyboard/semantic tests retained, no manual follow-up.
- Required focused validation and draft-first independent review follow. No schema changes, migrations, or deployment.

- Queue release: rebase onto main after #1208, preserving its Daily/calendar/error/rollover behavior. Prior reviewed SHA and CI were clean; repeat focused/visual checks and one bounded integration review before the authorized main merge.

## 2026-09-07 — Wider calendar announcement tooltips (#1210)

Doubled announcement content width from 14rem to 28rem on desktop, including weekday/weekend chips; mobile sizing and shared Tooltip behavior retained. Original focused checks and teacher/student desktop/mobile light/dark screenshots passed. Queue release authorized merge after #1211; rebased onto current main, preserving calendar loading/timer/history changes and interaction guards. Only archive-history overlap required resolution; retained main history and this entry. Final integration review and exact-head checks recorded in PR.

## 2026-09-07 — Production review: isolate Gradebook override identities

- Cumulative production review found that assignment and test overrides sharing an assessment UUID collided in the server's lookup map.
- Added assessment type to override lookup keys while preserving the separate calculated-score maps.
- Three API regressions failed before the fix and passed afterward: distinct overrides for both types and each one-sided override; assertions cover cells, student details, final grades, and class averages.
- No schema or UI changes. Migration 157 remains a separately controlled rollout.

## 2026-09-07 — Archive compatibility across migration157 rollout

- Production promotion review identified an app/schema ordering gap in archive export, deletion inventory, and restore.
- Read the deployed v2 resource contract and accept only the full table set or the exact pre157 set. Export manifests and completion counts preserve the database snapshot contract; deletion inventory avoids the absent override table.
- Restore permits archives with empty override data on schema156 but rejects non-empty overrides before staging or storage reservations. Schema/catalog mismatches and contract-read errors still fail closed.
- Added regression coverage for both schema versions, strict contract reads, archive export, inventory, and restore. No migration applied; schema157 remains separately authorized.
- Rebased PR #1195 after the Tests edit-action PR merged. The selected-Test toolbar retains the reviewed fixed-width Student actions control so switching to the selected-count label does not shift the layout.
- Retained current rolling history; the UI and browser patches apply cleanly over current main. Focused checks, targeted integration review, and fresh exact-head CI precede the authorized merge.

## 2026-09-07 — Resume browser security PR completion

- Owner authorized final review, required CI and merge of #1202 to main. Rebased onto `daa70b88` without conflicts; no migrations were added or changed. This task remains sole writer of `codex/global-browser-security-headers`; the active merge-coordinator task owns a separate archive compatibility branch and production promotion.
- Final integration review uses one Sol/high reviewer against a detached fixed commit while local focused checks run. Risk profile: runtime-platform. Earlier security/compatibility reviews and browser evidence remain applicable; final reviewed SHA, check results and merge evidence are recorded in the PR. Production rollout is separate.
- PR #1189's first exact-head CI run passed Test & Build and all database contracts, then failed the browser matrix because two existing Course Guide scenarios still asserted the retired Edit guide flow and Curriculum overview section heading across four viewports. Returned the PR to draft before correction; the unrelated student API timeout was flaky and passed on retry.
- Updated only those experience-matrix expectations to cover the shared More menu, Edit, Edit with Markdown, Guide options, the absence of Resources, the simplified Course guide heading, and the existing save-error state. Both affected scenarios pass against this branch on an isolated local port; no runtime source changed in this correction.
- Targeted independent review found one non-blocking role-boundary gap in the student matrix: it still excluded the retired direct buttons instead of the new More trigger. The corrected assertion excludes More actions and the removed Resources heading for students. One correction batch is in use; a final integration check and fresh focused/exact-head CI are required before readiness or merge. No production or database action was taken.

## 2026-09-07 — Preserve the dormant contextual enrollment foundation handoff

- After user-authorized merge of dev-only prototype PR #1178 at `f4f6ba32`, started compatibility batch C on `codex/contextual-enrollment-access`. Added dormant exact-pair identity selection and a pure join policy covering owner self-join, existing membership, verified-code-only admission, archive/enrollment/roster/open-join rules and malformed evidence. Contextual pair selection is explicitly a candidate, never final authorization.
- No live route imports the new modules. Existing join/list/roster behavior and role guards are unchanged; no migration, cohort, environment setting, production rollout or new access exists. Adoption is blocked on a schema-backed guess limiter, one atomic revalidating membership transaction, concurrency/failure evidence and separately migrated list/roster consumers.
- Red-first contract tests pass. Focused gate passes 13 files / 123 tests plus architecture, UI/design policy, TypeScript and lint. No specialized runtime profile; independent review risk high because this defines a future authorization boundary. Use Sol/high security plus Terra/high compatibility review before any merge decision; full access epic remains incomplete.

## 2026-09-07 — Correct PPZ3C Online first class day

- Production inventory resolved the exact active classroom and found four generated class days plus two lesson-plan mutation heads before the corrected September 8, 2026 start; no Daily logs, summaries, lesson plans, manual attendance marks, Bara occurrences, or PAL events exist in the affected range.
- Added a replay-safe, fail-closed one-time migration that verifies the inventoried identity and data before deleting those six rows and changing only the classroom start date. The no-op replay path and full fixture success path pass locally; focused checks pass 10 files / 90 tests plus architecture, TypeScript, and lint. Production remains unchanged pending reviewed-PR completion and the separately authorized linked migration application.
- Initial high-risk review found the production branch lacked committed replay evidence and that already-validated class-day/Daily writes could recreate pre-start data after the correction. Added an exact owner assertion, production-shaped rollback harness, CI execution, and narrow database guards that reject future pre-September-8 class-day or Daily-entry writes only for the corrected classroom. The harness, database lint, and focused gate pass; production remains unchanged.
- Targeted review found the first harness incorrectly depended on seeded users/classrooms that fresh CI does not provide. Replaced cloning with explicit minimal fixtures and exercised absent target, missing target, owner drift, success, and post-correction write rejection through the migration-owned private operation. The corrected rollback harness, database lint, and focused gate pass.
- Final integration review found lesson-plan saves could still recreate pre-start plans or mutation heads. Extended the exact-classroom guard and rollback assertions to both tables, rebased onto current main, and reran the full correction harness successfully. This is the third and final remediation batch; production remains unchanged pending stable-head review and CI.
- Exact-head CI passed the PPZ3C migration harness but its warning-level database lint required explicit UUID casts for the two migration constants. Added those casts; the warning-free lint, rollback harness, and full focused gate now pass locally. Production remains unchanged.

## 2026-09-07 — Preserve the Roster actions and email labels handoff

- Aligned the live teacher Roster controls with the approved operational-page composition: the centered primary action is now the shared icon-only `+` Add students control, while the trailing ghost More actions menu owns Add from CSV and the existing selection-dependent roster commands.
- Renamed the roster contact columns and related UI copy to Email (main) and Email (secondary), including manual-add/CSV dialogs, edit labels, copy actions and conflict feedback. Data contracts remain unchanged; the legacy `counselor_email` field still stores the secondary address.
- Focused component/API coverage passes 52 tests; type, design/UI policy and the Pika audit pass. Browser verification covers teacher desktop/mobile, light/dark, default/open/focus states plus student-route exclusion; menu focus, Escape return and viewport containment were inspected. Risk profile none; use one Terra/high reviewer for the standard-risk UI/state diff. No schema, migration, dependency, hosted data or deployment changes.

## 2026-09-07 — Preserve the atomic enrollment and guess-limit handoff

- Began the next dormant compatibility-C slice from merged main on `codex/atomic-enrollment-foundation`. Authored unapplied migration 157 after shared local history revealed another active branch owns 155–156: a private schema-backed 10-minute limiter (12 actor attempts, 3 actor-plus-invitation attempts) and a service-only code-join transaction that locks/revalidates the exact classroom, denies self/archive/closed/roster conflicts, and atomically writes roster lineage, enrollment, profile and optional verified Pal evidence.
- Added a dormant server adapter that normalizes invitation codes, derives opaque HMAC keys with `SESSION_SECRET`, validates least-data RPC results and fails unavailable on migration/contract drift. No live route imports it; current authentication, join/list/roster behavior, UI, cohorts, flags and production access remain unchanged.
- Added red-first unit contracts, a rollback-only database fixture and a randomized multi-connection harness for duplicate joins, policy races, join/archive ordering and exact concurrent limiter capacity; wired both into ephemeral CI. Focused checks pass 98 tests plus architecture, workflow, UI/design policy, TypeScript and lint. Migration 157 has not been applied or behaviorally run because no exact local target/file authorization exists; generated types and database verification remain pending that separate approval.
- Initial high-risk review used Sol/high for security/concurrency and Terra/high for architecture/compatibility (2 launches, one full-diff wave). Accepted blockers cover actor-limit row amplification, strict Pal construction/envelopes, charged-attempt survival on rollback, cross-class global-profile overwrite, stale generated types and guidance tests, plus static/catalog and actor-cap evidence gaps. Correction batch 1 makes the limiter actor-first with indexed bounded cleanup, builds Pal evidence in the adapter, closes the SQL envelope, creates profiles only when missing, contains membership writes in a rollback subtransaction while retaining the limiter charge, and strengthens runtime/static contracts. Generated types and actual database execution remain blocked on #1187 sources plus exact local migration-157 authorization.
- Targeted Sol/high remediation review (launch 3) found three additional blockers in batch 1: unsupported `jsonb_object_length`, a cleanup/request lock cycle, and rejoin rejection when a legitimate same-source Pal event has a new occurrence timestamp. Correction batch 2 uses supported exact-object comparisons, moves stale cleanup to a separate bounded service-only `SKIP LOCKED` function, and verifies stable Pal identity/source fields while allowing timestamp drift. The rollback fixture now covers valid-event rejoin plus cross-source collision. Static/adapter/guidance tests pass 11; migration execution and generated types remain pending the same dependency/authorization gate.
- Targeted Sol/high remediation review launch 4 cleared those three corrections and found one P2: explicit NULL bypassed the cleanup batch bound because `LIMIT NULL` is unbounded. Correction batch 3 rejects NULL and adds rollback assertions for NULL/zero/oversized inputs plus exact small-batch behavior. This reaches the default three-batch limit; reserve launch 5 for cumulative integration after #1187, authorized local migration 157, generated types and database harnesses are complete.
- Owner then authorized local application of the exact migration 157. Because #1187 is still open but local history already contains its 155–156, created an unpushed temporary integration worktree containing exact #1187 head plus #1193; checksum `482f9a99f6315ed4013cb33ddb01a0abe1232d5eb57bb281853989217c7692b5` matched the reviewed 157 file. Verified target `supabase_db_pika`/54322 and a 157-only dry run, then applied 157 once; authorization is consumed. Local history is 001–157, database lint has zero findings, rollback and concurrency harnesses pass with all synthetic fixtures removed, and generated types match. Integrated only 157's generated entries into #1193 and removed the temporary RPC cast. No hosted migration, route adoption, cohort, deployment or production change occurred.

## 2026-09-07 — Rebase atomic enrollment after prerequisite merge

- Rebased PR #1193 onto current main after #1187 merged. Main now owns migrations 155–158, so the enrollment source migration moved from 157 to 159 with its SQL unchanged. The earlier exact local authorization was consumed by the former 157 filename; the current local history is therefore evidence of the SQL behavior, not a clean 159 lineage replay. No migration was reapplied, repaired, reset, or promoted.
- Updated current enrollment guidance, harness messages, and static contracts to migration 159. A clean ephemeral replay, focused/type checks, the reserved fifth and final cumulative reviewer launch, and exact-head CI remain before readiness. Hosted application, route adoption, cohort activation, deployment, and production access remain unapproved.

## 2026-09-07 — Bind atomic enrollment responses to the requested classroom

- The reserved fifth cumulative Sol/high review found one merge-blocking response-boundary gap and one stale migration comment. Under the owner-approved review-budget extension, remediation batch 4 models exact created and already-enrolled success variants, models each failure code/status envelope, canonicalizes and binds the returned classroom UUID to the server-requested classroom, and rejects malformed or cross-class success as unavailable. Regression coverage proves wrong-classroom and inconsistent-status responses fail closed.
- Corrected the installed function comment to migration 159 and bound it with a static assertion. The three targeted suites pass 11 tests. One targeted security review and, if clean, one final cumulative review remain under the explicit extension; no local/hosted migration, route adoption, cohort, deployment, or production change occurred.

## 2026-09-08 — Make the Gradebook percent control a true toggle

- Kept the Gradebook `%` label visible in both states: pressed displays percentages and unpressed displays raw `x/y` marks. Added the requested `Show %` tooltip and explicit `aria-pressed` state.
- Updated the live Gradebook and Pattern Lab semantic coverage. Focused checks pass 21 files / 232 tests plus architecture, UI/design policy, TypeScript and lint; the Pika audit and 67 directly affected tests pass. Teacher desktop/mobile light/dark and on/off/hover states were visually inspected. Student view is not applicable because Gradebook is teacher-only.
- Composite-widget checklist reviewed: native button keyboard behavior is preserved, semantic pressed state is covered by tests, and no manual follow-up remains. Risk profile: none; no schema, data, API, dependency, or new shared component.

## 2026-09-08 — Rebase atomic enrollment after Gradebook toggle

- Rebased PR #1193 onto main `6dbc2fcf` after #1219 merged. Preserved main's Gradebook toggle and resolved only the shared continuity journal; migration 159, the enrollment adapter, generated types, database harnesses, CI wiring, and their tests are unchanged by range comparison.
- The previously reviewed exact-head CI was green before main advanced. Focused verification and fresh ready-PR CI must pass on the rebased head before merge. No reviewer launch, migration application, hosted change, route adoption, cohort, deployment, or production rollout occurred.
