# Week calendar card refinement

Owner-approved final direction, 2026-10-14: uniform class-day backgrounds,
solid muted non-class backgrounds without a visible No class label, a full
blue outline for today without a Today badge, centered short lesson content,
and click-to-edit lesson content for teachers. The hatching trial is removed.

Surface/reference: shared LessonCalendar Week agenda, approved composition in
calendar-week-agenda.md and executable teacher/student Pattern Lab Calendar.
Roles: teacher/student. Viewports: 1440×900 and 390×844. Themes: light/dark.
States: short/long/empty lesson, non-class day, current day, events, editing,
keyboard focus and day presentation. Primary signal: today's full inset blue
outline; non-class days use the existing subdued surface/text tokens.
Exclusions: Month/Term, data/date logic, new dependencies and new shared patterns.

| Need | Existing candidate | Decision | Reason |
| --- | --- | --- | --- |
| Week row backgrounds | LessonCalendar | extend | All class-day wrappers use bg-surface |
| Non-class/current-day state | LessonDayCell agenda | extend | bg-surface-3 for non-class cards; inset ring-primary for today |
| Short-content centering | LessonDayCell agenda | extend | Center inside date-rail height; long content expands from the top |
| Content editing target | Button | reuse | Native keyboard/focus contract over the lesson content area |
| Date presentation | Button and existing day dialog | reuse | Preserve existing presentation actions |
| Executable reference | Pattern Lab Calendar | reuse | Both examples render the production owner |

No class is hidden visually and remains the article's accessible description.
The current date retains aria-current="date". Teachers click lesson text or
empty lesson space to edit. A Button behind the rich preview provides keyboard
access without wrapping links. Dates, links and events keep separate actions.
Student/archive/weekend permissions are preserved; configured non-class weekdays
remain editable for teachers. Escape restores focus to the content target.
The editor and long reading content stay top-aligned. No visible edit/add action,
hatching, new design token or shared component remains.

Verification: 49 focused Calendar/DayCell tests, TypeScript, lint (existing
warnings), UI/design policies and Pika audit pass. Eight production-owner
Playwright captures and geometry checks verify identical class-day backgrounds,
distinct solid non-class surfaces, no hatching/visible No class/Today label,
short centering/long top alignment, current-day outline, teacher content/empty
clicks, Enter/Escape focus and student read-only behavior. Intercepted reads;
no backend writes. Evidence: output/playwright/flat-* and flat-day-evidence.log;
local URL http://localhost:3015, fixed Oct14 Toronto date.
Composite checklist reviewed: yes; keyboard/semantic checks: yes; follow-up: none
for implementation. No experimental pattern or promotion needed.

Coordinator owns codex/calendar-week-alignment. Risk profile none. The owner
authorized the additional final review on 2026-10-14 after the session-budget
checkpoint. Six review launches cover the implementation and follow-ups; the
final hatching-removal review found no code issues. Its outdated review-status
documentation finding is corrected here. Exact timing/token telemetry is unknown.
Current review and CI status, reviewed revisions, and detailed local evidence
are recorded in PR #1591, output/playwright/REVIEW.md and the PR lifecycle ledger.
