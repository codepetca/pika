# Utility calendar day targets

Surface: teacher `/teacher/calendar`, existing compact month cards in the utility shell.
Reference: DESIGN.md target/focus contracts; stable Core actions catalog entry and
actual `/pattern-lab?role=teacher` Buttons examples owned by `src/ui/Button.tsx`.
The executable reference was inspected before implementation with the development
`ENABLE_UI_GALLERY=true` flag. No new shared pattern or promotion is proposed.

| Need | Existing candidate | Decision | Reason |
|---|---|---|---|
| Date activation target and keyboard focus | `Button` | reuse | Native immediate action; preserves canonical minimum target, focus, disabled and motion contracts. |
| Multi-month arrangement and status colors | Existing utility calendar composition | extend | Wrap month cards using available content width; keep seven weekdays and existing domain colors. |

Teacher only. Student n/a: this route has no student owner. Verify 1440×900 and
390×844, both themes and normal/reduced motion (8 cases), plus 320, 360, 375, 768, 968, 1000, 1024,
1280 and 1536 width boundaries. States: class/non-class/weekend/holiday,
disabled past/outside-range, native Tab focus, nonzero scroll and final month.
Primary signal remains the existing date status background. Add no inspector,
new wizard controls, overlays, schema changes or API behavior. Composite review:
ordinary native date buttons, no ARIA grid or roving-keyboard model introduced.
Preserve their current names and tab order; shared Button owns visible focus.

Source baseline `0052d874b122ca3270c5107f661a790091274721` reproduces desktop
36.5625px, mobile 43.140625px, 1024px viewport 24.375px, and 375px viewport
41px targets. Controlled GET fixture fixes January–June 2026 and only Date at
January 15; native timers and RAF remain real. No date activation is needed in
browser verification; non-GET API requests are blocked after local teacher login.

Owned files: calendar page, TeacherCalendarPage semantic regression tests, this
brief, session log/trim archive, and the narrow approved policy registry update
`scripts/ui-control-exceptions.json` (native button count 6→5 after canonical
Button replacement). No shared primitive or token owner changes.

Evidence: external `product-fluidity/utility-calendar-targets`, source bookends,
all target numeric rectangles/hit checks/nonoverlap, screenshots and hashes.
The first reference attempts/404 diagnostic are retained; two harness/environment
corrections resolved the missing gallery flag. Requested Sol medium; effective
model/attribution unknown. Publication and independent review belong to coordinator.

Verification: targeted 15 tests passed; focused checks selected the complete
incoming 38-path branch and passed 203 files / 2354 tests, architecture,
TypeScript, lint and both policies. Audit and diff whitespace checks passed.
Required 8 cases and 9 boundary widths were captured. All 167 enabled dates in
each case measured at least 44px in both dimensions, with no overlap or root
overflow. 2839 centered-scroll native hit checks passed. Native Tab reached the
next enabled date with visible canonical focus. Transitions were 0.15s normally
and 0s reduced. June's last date remained reachable with nonzero actual scroll in
every case. All 181 date names/disabled-state records matched the baseline.

Root visual iteration rejected the first candidate's avoidable growth (60px
at 1440 and 93.703125px at 1024). The final composition caps card growth,
keeps compact padding/gaps, and uses the existing Tailwind scale to ensure
seven 44px controls and six 2px gaps occupy a minimum 320px day grid.
Representative final measurements: 1440 desktop 50.84375px; 390 mobile
47.140625px; 375 mobile 45px; 1024 two 348px cards with 45.703125px targets;
1000 exact 44px targets; 968 one bounded card instead of undersized columns.

Additional 360/320 boundary probes found 139 overlapping target pairs at 320
in the intermediate composition. The final grid has a minimum width while
its card contains necessary horizontal scrolling: 8px at 360 and 48px at 320,
with no root overflow and no overlap. All dates pass centered hit testing.
Native Tab to January 17 at 320 automatically scrolled the month card by 40px;
the focused 44px control remained enabled, visibly focused and hit-testable.
At 375 and every larger verified width, month-card overflow is zero.

Evidence folders preserve baseline, rejected candidate, compact candidate,
failed small-boundary geometry, final-candidate (17 cases), and
final-small-keyboard. The initial 375 hit obstruction from the Next development
badge is retained; centered target checks pass without hiding the badge.
A compact capture launched before the restarted private server was ready,
returned connection-refused, and is retained as compact-candidate-start-failure.
Source correction batches: initial implementation, root compactness refinement,
and narrow-grid containment. Publication/review remain with the coordinator.
