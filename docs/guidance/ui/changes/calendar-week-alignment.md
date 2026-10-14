# Week lesson alignment and current-day outline

Owner request 2026-10-14: Week lessons should start consistently near the top;
outline the entire current day's card and remove the visible Today label.
Follow-up: clicking the card's lesson content starts editing, replacing the
separate Edit/Add action.
Second follow-up: hide the visible No class label, use muted non-class cards,
and vertically center short lesson content.
Third follow-up: strengthen the non-class signal with diagonal hatching.
Fourth follow-up: class days share one surface; reserve hatching for non-class
days and the blue outline for today. LessonCalendar extends its Week composition
to remove alternating backgrounds; existing LessonDayCell state styling is reused.

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
| Lesson alignment/current day | LessonDayCell agenda | extend | Center short reading content; longer content expands from the top |
| Non-class appearance | Semantic subdued surface/text tokens | reuse | Muted background/date treatment with preserved actions |
| Non-class texture | LessonDayCell non-class state | extend | Owner-requested diagonal hatching distinguishes days without another visible label |
| Content editing target | Button | reuse | Native keyboard/focus behavior over the lesson content area |
| Date presentation | Button and existing day dialog | reuse | Existing keyboard and presentation behavior |
| Executable reference | Pattern Lab Calendar | reuse | Both role examples render the production owner |

Non-class days use a muted semantic surface and date text. No class is hidden
visually and remains the card's accessible description. Short lessons and empty
placeholders center within the existing date-rail height; long content expands
the row and stays at its top padding. The editor retains its top alignment.
The inset outline does not change current-day geometry.
Teachers click lesson text or empty lesson space to edit. A native Button is
positioned behind the preview, providing keyboard access and a full content
target without wrapping rich-text links in a button. Preview links remain
independently navigable. Dates and events retain their separate actions;
students, archived classrooms and weekends remain read-only. Escape restores
focus to the content target. No visible edit/add action remains.
No adjacent refactor is required; no experimental pattern or promotion needed.

Risk profile none; follow-up review risk standard (editing entry interaction). Coordinator owns
codex/calendar-week-alignment. Startup storage healthy, 316 GB available;
weekly allowance 75% remaining (account-wide). Small implementation handled
directly. Initial fast-tier medium review was clean; the interaction follow-up
uses one general-tier medium reviewer with a 10-minute target, 30-minute per-reviewer/60-minute session hard limits, at most seven
launches and four remediation batches. Per-task token telemetry unknown.

Verification: 49 focused Calendar/DayCell tests pass; TypeScript, lint (existing
warnings), architecture, UI/design policies and Pika audit pass. Playwright
captures and measured alignment pass for both roles × both viewports × both
themes on the production ClassroomPageClient fixture with intercepted reads.
Pattern Lab adds event, empty, edit/Escape focus-return and day-dialog checks.
Evidence: output/playwright/real-{role}-{viewport}-{theme}.png and calendar-*;
local URL http://localhost:3015, captured 2026-10-14 with fixed Toronto current
date. No backend writes. Checklist reviewed: yes; keyboard covered: yes;
semantic state tested: yes; manual follow-up: none.
Follow-up evidence adds real content/empty-area clicks, keyboard Enter and
Escape focus-return in every teacher viewport/theme; student clicks stay
read-only. Pattern Lab copy and its regression reflect content-driven editing.

The initial focused gate hit unrelated CI Tart-host subprocess timing failures;
serial verification passed all 1,034 tests and remaining gates. Two capture-driver mistakes
(historical reference date and student synthetic identity) were corrected;
neither required product changes. Gallery screenshots with sticky-navigation
occlusion are supplemental; the eight real-owner captures are final evidence.

Second follow-up verification: non-class status is the article's accessible
description and its label is not visible. Browser measurements confirm centered
short previews and top-aligned long content for all eight role/viewport/theme
combinations; edit/Escape/keyboard/read-only checks still pass. The latest
fixture screenshots and geometry are in output/playwright/real-* and
muted-card-evidence.log. Scope remains presentation-only.

Third follow-up: a feature-owned CSS module adds a repeating diagonal hatch only
to Week non-class cards. Stripe color uses the existing border-strong token at
35% opacity; spacing and line thickness derive from the control-spacing token.
No new design tokens, shared component or general status convention are added.
Muted date text remains above AA contrast even on stripe pixels (light 6.22:1,
dark 4.64:1, calculated from the current token values and sRGB compositing).
The existing Pattern Lab Calendar renders the pattern through its production
owner. Eight role/viewport/theme captures refreshed; editing, reading, centering
and the current-day outline remain verified.
