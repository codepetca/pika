# Test calendar date

Owner request, 2026-10-13: optionally set the date a Test will be written and show it in the classroom Calendar. Confirmed calendar reminder only; no submission deadline or automatic access change. Publication and per-student availability retain their existing behavior.

Surface: Test authoring details and teacher/student Calendar Week, Month, Term, and day presentation. References: existing Test split authoring details, shared FormField/Input date controls, Calendar assignment/announcement links, and development Pattern Lab Calendar production owners. Roles: teacher and student. Matrix: 1440×900 and 390×844, light and dark. States: undated, dated, cleared, saving, failed save/retry, draft/published/closed, weekend, source failure/retry, classroom switch, navigation, keyboard focus, and date presentation. Primary signal: ordinary blue calendar item links with an explicit Test label. No new visual pattern, deadline enforcement, access gate, publish workflow, dependency, or calendar layout redesign. Composite review required for existing editor dialog focus and close/publish flush; date input keeps native semantics.

| Need | Existing candidate | Decision | Reason |
| --- | --- | --- | --- |
| Optional date entry | FormField and Input | reuse | Canonical labelled native date control and field error semantics |
| Metadata save feedback and recovery | SaveStatus and Button | reuse | Existing saved/saving/unsaved and retry actions |
| Authoring placement | TestDetailPanel | extend | Date belongs beside title and supporting metadata |
| Calendar date/event display | LessonCalendar and LessonDayCell | extend | Show Test links beside existing items in all views |
| Calendar reads/retry and navigation | Role calendar controllers and ClassroomPageClient | extend | Preserve source isolation, feature visibility, and exam navigation guards |

`tests.test_date` is a nullable calendar date (`YYYY-MM-DD`), interpreted as a classroom day without UTC conversion. It is saved separately from question drafts. Students receive dates only through their authorized Test list; teacher drafts remain visible only to teachers. Tests without a date add no calendar item. Changing or clearing the date never opens/closes a Test or changes a student's availability.

Persistence rollout: additive migration 263; existing records remain undated. Apply schema before deploying its date-aware readers/writers. Generated database contract must come from the branch schema. Archive full-row export/restore retains dates; older archives fill the nullable field with null. Course Blueprint reuse intentionally omits classroom-specific Test dates. Dormant contextual witnesses and full-row SQL guards must include the new field; their gates remain closed.

No generic component extraction is needed. Calendar source loading has similar role-specific orchestration; a later shared source owner would require preserving teacher lesson mutation and student visibility contracts, beyond this request.

Compact Month/Term grids use the shared control-size and spacing tokens for minimum column widths so every new Test link retains a 44×44 target, including weekends. The grid scrolls horizontally within the available canvas when its columns cannot fit. Week agenda composition is unchanged. Verify actual browser target sizes and scroll reachability rather than accepting class names as evidence.

Verification evidence and independent review are recorded in the session log and PR after completion.

Visual verification passed for both roles × desktop/mobile × light/dark, including Month/Term target measurements and scroll reachability. Date editor save, clear, failure, retry, and close passed with intercepted metadata writes. Shared composite-widget checklist reviewed: existing date/view controls and dialog owners retained; Test links remain individually named buttons, native date input retains its label/error association, and close waits for the date save. Keyboard/day navigation and safe detail selection are covered; no new composite keyboard model is introduced. Owner-approved isolated-local replay001–263, nullable date contract probe, preserved owner/learner native contracts, generated type generation/check, and TypeScript pass. Independent review and PR/CI remain. Original unpublish setup timed out at2500 rows; supplemental identical10000-row setup split into500-row statements passed all original assertions and caps. No shared or hosted database changes.

Review remediation: save invalidates the shared classroom Tests cache before
refresh notifications. Clear handles a focused edited date without its blur
saving that edit first; pointer and keyboard regressions pass. Migration263
now extends the archive normalizer explicitly for older Tests. The earlier
replay validates the initial revision only; corrected replay/types and targeted
independent review remain pending.
