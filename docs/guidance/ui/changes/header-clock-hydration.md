# Header clock hydration

Surface: shared application header, including exam and fullscreen clocks.
Approved reference: Pattern Lab application headers (Classrooms and classroom/exam examples), owned by `AppHeader`/`AppShell`; stable UI canon §3d. Existing coordinator baseline screenshots and minute-boundary hydration receipts establish the unchanged presentation and failure.

Roles: teacher and student. Viewports: desktop and mobile. Themes: light and dark.
States: initial server render, hydration across a Toronto minute/date boundary, exam mode, fullscreen, ticking, unmount. Primary signal: existing Toronto date/time text and tabular numbers.
Exclusions: layout, density, clock visibility, fullscreen/exam logic, navigation, auth, deadline logic, placeholders, warning suppression, global providers, or new visual patterns. Composite widget accessibility review: no new widget; preserve existing focus and nodes.

| Need | Existing candidate | Decision | Reason |
|---|---|---|---|
| Clock rendering and formatting | AppHeader | extend | Accept a serializable timestamp shared by server and first client render; refresh wall time after mount. |
| Prop transport | AppShell and existing server page/layout owners | extend | Forward the timestamp through current ownership. |
| Visual treatment | Pattern Lab application headers | reuse | Keep markup, tokens, visibility, and geometry identical. |

Regression: deterministic SSR→hydrateRoot across minute and Toronto midnight boundaries must preserve the header/clock DOM nodes and report no recoverable errors; mount refresh, 60-second ticks and cleanup remain active. Coordinator owns both-role visual matrix and final policy checks. Pattern Lab fixture timestamps remain deterministic while mounted clocks resume live wall time.

## Focused verification

On base `c88abe16bb2acc5942f7b5430e296ea3bd09c37f`, the regression failed before the repair with three recoverable hydration errors at the minute boundary and four at Toronto midnight, including full root regeneration. After the repair: nine affected Vitest files / 91 tests passed; scoped Next lint passed without warnings/errors; `git diff --check` passed. The regression verifies immediate post-mount current time, 60-second ticks, preserved header/clock nodes, no recoverable errors, and zero remaining timers after unmount. Server owner tests cover both classroom roles and both utility layouts. Production source audit covers all three classrooms-index return branches; only header-free loading/error/not-found shells use the zero sentinel. Pattern Lab headers and synthetic fixtures use the fixed October 5 snapshot and refresh normally after mount.

Final both-role visual acceptance and full focused/policy/type checks remain coordinator-owned; this receipt does not claim browser verification.

## Combined classroom recovery composition (2026-10-06)

PR #1496 depends on the reviewed classroom first-read recovery source in PR #1491.
Reuse the existing AppShell/AppHeader clock and classroom recovery owners; extend
the server timestamp transport to the new student enrollment-error return. The
required `initialNow` contract remains mandatory. Both Pattern Lab recovery and
experimental dialog registrations/tests remain present. Existing role, viewport,
theme and motion acceptance applies to the combined source, including error,
pending retry and recovery. No promotion or production scaffold is included.

Regression: the server page's failed enrollment branch must supply its captured
clock timestamp. This failed with undefined before the correction and passed
after supplying `initialNow={Date.now()}`. Existing SSR-to-hydration minute/date
boundary tests verify preserved clock nodes and resumed live ticks.
