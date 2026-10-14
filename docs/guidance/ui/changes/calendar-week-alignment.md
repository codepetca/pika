# Week lesson alignment and current-day outline

Owner request 2026-10-14: Week lessons should start consistently near the top;
outline the entire current day's card and remove the visible Today label.

Surface/reference: shared LessonDayCell agenda, owner-approved Week composition
in calendar-week-agenda.md and executable teacher/student Pattern Lab Calendar.
Roles: teacher/student. Viewports: desktop 1440×900, mobile 390×844.
Themes: light/dark. States: short/empty lesson, non-class day, event, current day,
teacher editing, keyboard focus and day presentation. Primary signal: full inset
primary outline for the current day. Exclusions: Month/Term, data, date logic,
new dependencies and new shared patterns. Composite widgets are reused; their
contracts remain unchanged. Current date retains aria-current="date" semantics.

| Need | Existing candidate | Decision | Reason |
| --- | --- | --- | --- |
| Lesson alignment/current day | LessonDayCell agenda | extend | Keep lesson body first in its content column |
| Edit action | IconButton | reuse | Named tooltip, focus and full touch target in date rail |
| Date presentation | Button and existing day dialog | reuse | Existing keyboard and presentation behavior |
| Executable reference | Pattern Lab Calendar | reuse | Both role examples render the production owner |

Move No class and the teacher edit/add action into the date rail. Lessons and
empty placeholders start at the row's top padding regardless of editability or
class-day status. The inset outline does not change current-day geometry.
No adjacent refactor is required; no experimental pattern or promotion needed.

Risk profile none; review risk low (localized presentation). Coordinator owns
codex/calendar-week-alignment. Startup storage healthy, 316 GB available;
weekly allowance 75% remaining (account-wide). Small implementation handled
directly; independent review will use one fast-tier medium reviewer, 10-minute
target, 30-minute per-reviewer/60-minute session hard limits, at most seven
launches and four remediation batches. Per-task token telemetry unknown.

Verification: 47 focused Calendar/DayCell tests pass; TypeScript, lint (existing
warnings), architecture, UI/design policies and Pika audit pass. Playwright
captures and measured alignment pass for both roles × both viewports × both
themes on the production ClassroomPageClient fixture with intercepted reads.
Pattern Lab adds event, empty, edit/Escape focus-return and day-dialog checks.
Evidence: output/playwright/real-{role}-{viewport}-{theme}.png and calendar-*;
local URL http://localhost:3015, captured 2026-10-14 with fixed Toronto current
date. No backend writes. Checklist reviewed: yes; keyboard covered: yes;
semantic state tested: yes; manual follow-up: none.

The initial focused gate hit unrelated CI Tart-host subprocess timing failures;
serial verification is being used to reduce load. Two capture-driver mistakes
(historical reference date and student synthetic identity) were corrected;
neither required product changes. Gallery screenshots with sticky-navigation
occlusion are supplemental; the eight real-owner captures are final evidence.
