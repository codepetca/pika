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

## 2026-09-04 — Rebase fixed-width Test student actions for merge

- Rebased PR #1195 after the Tests edit-action PR merged. The selected-Test toolbar retains the reviewed fixed-width Student actions control so switching to the selected-count label does not shift the layout.
- Retained current rolling history; the UI and browser patches apply cleanly over current main. Focused checks, targeted integration review, and fresh exact-head CI precede the authorized merge.

## 2026-09-04 — Rebase Gradebook score overrides for merge

- Rebased PR #1201 after the earlier Gradebook toggle and Tests toolbar PRs merged. The later approved Gradebook design remains authoritative: desktop keeps the class matrix with a pinned Avg row, the action bar shows Class Average and Median, one button switches `%` and `x/y`, mobile stays per-student, and stored assessment/final overrides retain their undo and grade-band behavior.
- Kept migration 157 because current main ends at 156; the still-open atomic-enrollment PR also using 157 must be resequenced when it is handled later. No migration was applied. Focused checks, full migration replay in CI, high-risk integration review, and fresh exact-head gates precede the authorized merge.
- High-risk review found that polymorphic assessment IDs could leave overrides behind when an assignment or test was deleted. The correction adds database-owned, type-scoped cleanup triggers for every delete path, skips side effects during exact purge/archive maintenance ordering, and adds a rollback-only ephemeral database harness covering authenticated assignment deletion, atomic test deletion, type isolation, Final preservation, and helper privileges.
- Targeted re-review confirmed the cleanup boundary and found stale archive database-harness totals. The same correction batch now counts the new current/v2 resource and revision trigger, verifies its actor/restore contract, and protects those expectations with a unit regression. The v2 count and metadata assertion remain conditional so the harness still validates its intentional migration-105 compatibility replay.
- The first exact-head database run replayed migration 157 successfully, then the generated-type check exposed the two wrapped legacy helpers as public functions. The correction gives them short stable names and moves them into the private schema before the public wrappers are recreated, avoiding PostgreSQL identifier truncation and keeping internal helpers out of the generated public API.

## 2026-09-04 — Center Daily dates when relative context is hidden

- Daily now removes the empty subtitle row when the saved relative-date display preference is off, so the date fills the existing selector height and remains vertically centered. The relative-date-on state still reserves its subtitle row across past, present and future navigation to prevent layout movement.
- Reused the shared `DateNavigator` and existing Daily preference/menu behavior in the live teacher surface and Pattern Lab references. Arrow controls, date-picker behavior, accessible labels, focus behavior and hit targets are unchanged; student surfaces are not affected.
- Component and Pattern Lab regressions cover hidden, restored and persisted states. The focused gate passes 18 files / 229 tests plus architecture, UI/design policy, TypeScript and lint. Desktop/mobile light/dark browser interactions pass and their hidden-state captures were inspected. Risk profile: none; no schema, data, API, dependency or deployment change.
- The first exact-head CI run exposed an existing rollout-doc assertion that still expected production migrations through 151 after the active context advanced to 156. Updated that test-only expectation to the current production record; application behavior remains unchanged. PR returned to draft before the correction and requires targeted re-review plus fresh exact-head CI.

## 2026-09-04 — Require class-day setup in the classroom wizard

- Removed the blank-classroom deferral option from the creation wizard. All classroom creation paths now require the teacher to choose the actual first class day before Create is enabled.
- Replaced the inferred Monday-Friday range label and warning block with the concise field guidance `You can modify class days later in Settings.` The existing post-creation reminder remains as failure recovery for classrooms that still have no calendar.
- Component, TypeScript and browser checks pass; teacher light-desktop and dark-mobile screenshots confirm the simplified dialog, required/selected date states and responsive layout. Student creation remains unavailable by role. No migration, hosted data, deployment, commit or PR action was performed.

## 2026-09-04 — Open the native first-day picker from the wizard

- Entering the classroom calendar step now immediately invokes the browser's native picker for First day of class from the originating Next-button gesture. Unsupported or restricted browsers retain the focused native date input as the fallback; no custom embedded calendar was introduced.
- A semantic component regression verifies picker invocation and focus. The full focused gate passes 42 files / 609 tests plus architecture, UI/design policy, TypeScript and lint; the eight-check browser flow, cross-role screenshot pass and Pika audit pass. Existing teacher desktop/mobile light/dark layouts remain unchanged. No migration, hosted data, deployment, commit or PR action was performed.

## 2026-09-04 — Make wizard calendar inputs fully clickable and readable

- Removed the visible required stars from First day of class and Last day of class while retaining semantic required state and Create-button validation. Each field now layers the native date input across the complete control, so clicking anywhere opens the calendar and typing directly is unavailable.
- Selected dates display in long form such as `September 9, 2026`; the underlying ISO values still drive the API. The existing immediate native-picker opening and progressive last-day reveal remain. Focus rings transfer to the readable control and a Lucide calendar icon preserves the familiar affordance.
- Component, TypeScript, UI/design policy and the eight-check browser flow pass. Teacher desktop light and mobile dark selected-date states were visually inspected, including the open native calendar; the browser console has no errors. No migration, hosted data, deployment, commit or PR action was performed.

## 2026-09-04 — Progressively reveal the last class day

- Simplified the calendar step to begin with only `First day of class`; removed its heading, subtitle and helper text. Selecting the first day now reveals an editable, five-month-prefilled `Last day of class` with `You can modify this later in Settings.`
- The chosen last day is sent through blank and Blueprint classroom creation, and Create remains disabled until both dates are present. Semantic component coverage and the eight-check classroom-creation browser contract verify the hidden/revealed states, generated default and required fields.
- Focused gate passes 42 files / 608 tests plus architecture, UI/design policy, TypeScript and lint. Teacher desktop/mobile light/dark states were visually inspected and the browser console had no errors; student creation is not applicable. No migration, hosted data, deployment, commit or PR action was performed.

## 2026-09-04 — Default class end dates to fixed term boundaries

- Replaced the rolling five-month end-date estimate with fixed school-term boundaries based on the teacher-selected first class day: January through June defaults to June 30, while July through December defaults to January 31 of the following year. A June 30 start advances to the following January 31 so the editable range remains valid.
- The shared helper keeps classroom creation and the matching Settings setup aligned. Component and browser coverage explicitly verify January 1, 2027 → June 30, 2027 and November 30, 2026 → January 31, 2027.
- The full focused gate passes 42 files / 610 tests plus architecture, UI/design policy, TypeScript and lint; the audit and eight-check browser flow also pass. Teacher desktop light and mobile dark selected-date states were visually inspected with no console errors; student creation is not applicable. No migration, hosted data, deployment, commit or PR action was performed.

## 2026-09-04 — Restore the post-creation class-day review notice

- Newly created classrooms now open with a teacher-only `Review class days` warning even when weekday generation succeeded. Its guidance reads `Review holidays, PA days, and other non-class days.`; `Review now` opens Settings > Class Days and clears the one-time URL flag.
- The existing missing-calendar recovery state remains stronger: it continues to show `Set up class days` when no dates exist. Normal classroom opens are unchanged, and blueprint review navigation carries the same class-day review reminder.
- The full focused gate passes 42 files / 612 tests plus architecture, UI/design policy, TypeScript and lint; the audit and eight-check creation flow also pass. The live notice and destination were exercised at desktop/light and mobile/dark with no browser-console errors. Student view is not applicable because students cannot create classrooms. No migration, hosted data, deployment, commit or PR action was performed.

## 2026-09-04 — Wait for a click before opening the first-day picker

- Removed the programmatic native-calendar launch when the classroom wizard enters the First day of class step. The full-control date input remains focused for keyboard accessibility and opens its native picker only after a deliberate click.
- Component coverage verifies that step entry does not call `showPicker()` and that clicking the field does. Desktop/light and mobile/dark entry states were visually inspected with no picker overlay and no browser-console errors; student creation is not applicable.
- The full focused gate passes 42 files / 612 tests plus architecture, UI/design policy, TypeScript and lint; the audit and eight-check classroom wizard flow also pass. No schema, data, API, dependency, hosted action, deployment, commit or PR is included.

## 2026-09-04 — Keep the first-day selector neutral on step entry

- Moved calendar-step entry focus from the hidden native date input to an accessible `Choose class dates` group, removing the premature blue input outline while preserving screen-reader context. The standard Pika focus treatment still appears when the teacher deliberately clicks or tabs into the date control.
- Updated semantic coverage verifies group focus, neutral input state and deliberate picker invocation. Desktop and mobile states were visually inspected in dark mode; the existing light-theme input treatment is unchanged. Student creation is not applicable.
- The full focused gate passes 42 files / 612 tests plus architecture, UI/design policy, TypeScript and lint; the audit and eight-check wizard flow also pass. No schema, data, API, dependency, hosted action, deployment, commit or PR is included.

## 2026-09-04 — Make class-day toggles respond immediately

- Changed Settings > Class Days to update each clicked date optimistically instead of waiting for the PATCH response. Only the affected date is temporarily disabled while saving, preventing duplicate requests without blocking edits to other dates.
- Successful saves replace the optimistic value with the server result and retain the existing cross-tab cache refresh. Failed or malformed saves restore the prior state and show the existing inline error feedback.
- Added semantic component coverage for immediate `aria-pressed` state, per-date pending state, duplicate-click prevention and failure rollback. The full focused gate passes 43 files / 614 tests plus architecture, UI/design policy, TypeScript and lint; the Pika audit passes. Teacher desktop/mobile light and desktop dark screenshots were inspected; student settings are unavailable by role. Composite-widget checklist reviewed: keyboard behavior remains native-button behavior, semantic state is covered by tests, and no manual follow-up remains. No schema, data, API, dependency, hosted action, deployment, commit or PR is included.

## 2026-09-04 — Review classroom class-day setup draft

- Rebased the complete classroom class-day setup change onto current main and opened draft PR #1203. The product diff remained equivalent across the rebase; only append-only session history required reconciliation.
- Independent Terra/high review found one merge-blocking equal-date range gap and one stale contextual-calendar guide. Remediation batch 1 now requires Last day to be strictly after First day, exposes a next-day native minimum and inline semantic error, handles non-OK class-day setup responses through the existing saved-classroom recovery path, and documents weekday-only draft generation.
- The post-remediation focused gate passes 43 files / 615 tests plus architecture, UI/design policy, TypeScript and lint; the eight-check wizard browser verifier and Pika audit pass. Playwright teacher/student desktop/mobile page captures remain clean; the invalid state is covered semantically. Composite checklist reviewed: native keyboard behavior is unchanged, invalid/pending/pressed state is tested, and no manual follow-up remains. Targeted re-review cleared the remediation with no new finding. Exact-head CI exposed one stale current-main assertion expecting production migrations 001–151 after CURRENT advanced to verified 001–156, followed by a stale blueprint browser flow that omitted the now-required dates; both minimal test-only corrections were independently reviewed and passed exact-head CI.
- Final cumulative review then found that one successful class-day toggle refresh could temporarily replace another date's still-pending optimistic value. Extended remediation batch 4 now preserves each pending date while accepting refreshed settled values, with a real `ClassDaysProvider` two-request race test. The focused gate passes 45 files / 620 tests, Pika audit passes, and teacher desktop/mobile light/dark captures remain clean; student editing is unavailable by role. Targeted concurrency review and final exact-head CI remain. No merge, deployment, migration or hosted data action was performed.

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
