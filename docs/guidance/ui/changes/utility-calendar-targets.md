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
390×844, both themes and normal/reduced motion (8 cases), plus 375, 768, 1024,
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
Required 8 cases and 5 boundary widths were captured. All 167 enabled dates in
each case measured at least 44px in both dimensions, with no overlap or root
and month-card overflow. 2171 centered-scroll native hit checks passed. Native
Tab reached the next enabled date with visible canonical focus. Transitions
were 0.15s normally and 0s reduced. June remained reachable with nonzero actual
scroll. All 181 date names/disabled-state records matched the baseline exactly.

Representative measurements: 1440 desktop 60px; 390 mobile 47.140625px;
375 mobile 45px; 768 sidebar boundary 57.140625px; constrained 1024 content
93.703125px. The 1024 card occupies one row because two fully padded seven-day
cards cannot fit beside the sidebar. Root visual acceptance remains pending.
A 375 initial hit probe encountered the Next development badge over February
22 near the viewport bottom; the unchanged target passed centered-scroll hit
verification. The initial failure is retained in candidate/cases.json.
Below verified boundary widths, month cards retain their own overflow scroller
rather than exporting oversized minimum button tracks to the utility root.
