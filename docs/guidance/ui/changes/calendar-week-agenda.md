# Calendar Week lesson agenda

Owner selected concept A on 2026-10-11 and requested implementation for teachers and students, keeping Month and Term unchanged. Prototype evidence: `/Users/stew/.codex/visualizations/2026/10/11/01a12a93-1a8c-7ed0-a906-1eab3ca18157/vertical-week`.

Surface: shared lesson Calendar, Week only. Reference: selected A, Pattern Lab Calendar production owners, shared date navigation/selection controls and classroom shell. Stable foundations followed; this calendar-specific composition is owner-approved. It does not promote a general agenda pattern into the shared UI canon.

Roles: teacher/student. Viewports: 1440×900 and 390×844. Themes: light/dark. States: empty, short/long content, Today, weekend/non-class, due items, announcements, editing, keyboard focus, day presentation, date/view navigation, archived/read-only, Markdown preference. Primary signal: blue Today/date selection, with restrained alternating surfaces. Exclusions: assistant, new data sources, test/material aggregation, inferred holiday names, API/migration/auth changes, Month/Term normalization or redesign.

| Need | Existing candidate | Decision | Reason |
| --- | --- | --- | --- |
| Shared shell and course context | ClassroomPageClient | reuse | Scope remains within Calendar content |
| Date/view controls and Markdown sidebar | CalendarActionBar and calendar tab controllers | reuse | Keep labels, persisted view, date bounds and editor ownership |
| Lesson/event rendering and editing | LessonDayCell | extend | Agenda layout needs full-width content and explicit editing while grid remains the default |
| Week composition | LessonCalendar | extend | Seven ordered days in one continuous vertical agenda |
| Reference fixtures | Pattern Lab Calendar mockups | extend | Deterministic executable evidence of the chosen composition |

Existing source visibility, assignment due dates and announcement routing are preserved. Weekend events become readable individual links in Week; weekends remain noneditable. Configured non-class weekdays remain editable for teachers. No holiday is inferred from a jurisdiction calendar: class-days are authoritative. Student lesson bodies are reading content rather than edit buttons. Teacher inline Markdown editing retains the existing mutation queue/callbacks; More actions retains the actual sidebar.

Month and Term keep the default grid cell, dimensions, expansion, plain-text rules and controls. Date controls remain visible while scrolling Week. Composite review: existing date/view and day-dialog widgets reused; shared Button targets/focus; editor Escape returns to its action; no nested links inside lesson-preview buttons in the agenda.

Verification: focused component and policy checks, real ClassroomPageClient fixture browser coverage for both roles × both viewports × both themes, empty/long/event/editor and date/view controls, Month/Term regression evidence. No hosted classroom writes. Risk profile none; review risk standard (localized application interaction), one Sol medium independent fixed-SHA reviewer. Usage at start 98% weekly remaining; DeepSeek pause honored. Current writer owns codex/calendar-week-agenda in /Users/stew/.codex/worktrees/vertical-week-prototypes/pika.

Implementation evidence: component regression worker delivered 37 passing calendar tests (initial 12 red, 25 existing green; final 3.04s), with one brief clarification that non-class weekdays remain editable. Coordinator also verified real owner controls and the executable Pattern Lab teacher fixture; affected suite 89 tests passed plus the teacher sidebar/view regression. TypeScript, lint (existing warnings), architecture, UI/design policies and Pika audit pass. Removed obsolete Week raw-size/native-button exceptions, without adding new exceptions. Composite checklist reviewed: yes; keyboard behavior covered: yes; semantic state covered by tests: yes; manual follow-up: none.

Visual evidence lives beside the selected prototype in `output/playwright/implemented-*`: both roles × desktop/mobile × light/dark, long/empty/no-class/event states, teacher edit, date presentation, Month/Term and Week date navigation. Reads and inline writes were intercepted on the real ClassroomPageClient fixture; no hosted write occurred. A screenshot timing issue and mobile sticky-header overlap were caught and corrected. Editor autofocus retains the shared editor's caret-at-end behavior. Initial broad concurrent checks hit unchanged runner/timing failures; serial focused checks resolved those, and a fixture content-type error was corrected before publication.

Review ledger: standard risk; one initial full-diff Sol medium reviewer, native fresh context, fixed base/head; target 10 minutes, hard per-reviewer 30 minutes and total review session 60 minutes; maximum four batched remediation waves, seven launches, one final integration wave only if needed. Exact revisions, verdict and timing are recorded in the PR/lifecycle receipt; no redundant final review if clean and unchanged. Worker token/usage telemetry unknown; initial weekly allowance 98% remaining is account-wide. Coordinator verification and integration required no source conflict; worker handled only the two assigned test files.
