# Borderless content cards

Owner request and approval: 2026-10-16, remove Classwork/Test list outlines and
other decorative card outlines, and remember this design choice.

- Reference: the approved borderless classroom shell and workspace panels in
  `DESIGN.md`, plus real-owner Content surfaces and teacher work-item frames
  in `/pattern-lab`.
- Scope: shared `Card`/`EmptyState`, teacher Classwork/Test/Survey frames,
  student Classwork/Test actions, classroom cards, announcement cards,
  blueprint content cards, and decorative calendar/workspace frames.
- Primary signal: semantic surface tone and spacing; retain existing quiet
  elevation. Hover and selection use surface changes.
- Exclusions: field/control borders, table rules, focus rings, warning/error
  indicators, and active drag indicators. No workflow or interaction changes.
- Roles/viewports/themes: teacher and student; desktop 1440×900 and mobile
  390×844; light and dark.
- States: default, draft/muted, hover, selected, and keyboard focus. Existing
  status and active-drag treatments remain functional exceptions.
- Composite accessibility: semantics and handlers unchanged; verify keyboard
  focus and selected state. No new composite behavior.
- Stable guidance: followed and clarified by this explicit owner preference;
  experimental pattern introduced: no; human promotion needed: no.

| Need | Existing candidate | Decision | Reason |
|---|---|---|---|
| Content surfaces | `Card` and `EmptyState` | extend | Borderless default for every tone |
| Teacher work items | `TeacherWorkItemCardFrame` | extend | One shared frame serves assignments, tests, surveys |
| Student work items | Existing Classwork actions and `StudentTestListItem` | extend | Remove decoration while retaining Button focus/semantics |
| Other content cards | Existing classroom, announcement, blueprint owners | reuse | Keep feature composition and remove decorative outlines |

No new card abstraction: teacher and student metadata/action behavior still
differs. Later extraction requires genuinely shared behavior and a stable API,
as described in the teacher work-surface canon.

## Verification evidence

Playwright captures and reproducible capture code live in the owning worktree's
ignored `output/playwright/` directory. Capture date: 2026-10-16. Routes:
`/pattern-lab?role=teacher` and `/pattern-lab?role=student`. The capture script
checks computed border widths, keyboard focus visibility, selected-test
semantics, and viewport overflow in the declared matrix. Teacher work-item and
student Test examples render production owners; the student Classwork example
is a composition fixture, supplemented by the actual Classwork component suite.
The PR records the verified implementation SHA and local-check results.

Final local evidence: 24 focused captures/checks passed, with unobscured gallery
navigation during capture; all eight intentionally refreshed Mac/Linux Pattern
Lab contract baselines passed. Focused suite: 259 files/3,443 tests passed, with
three timing-sensitive failures in two suites. Both suites passed on isolated
reruns (3 purge-dialog tests and all 51 offline CI-host tests); unchanged source
coverage was reused. TypeScript, lint (existing warnings only), architecture,
UI policy, and design policy passed. The audit's composite-test warning is a
heuristic false positive for className-only edits; no semantic/handler changes
or policy weakening were introduced. Fixed-head independent review follows.

### CI baseline correction

The first GitHub run exposed omitted student-header baselines and a Linux capture
font mismatch. The stock Playwright Noble container resolved `system-ui` to
WenQuanYi Zen Hei; adding the existing Ubuntu `fonts-dejavu-core` capture-runtime
package resolves it to DejaVu Sans, matching the GitHub runner. No application
font, dependency, test threshold, or test behavior changes. Regenerated four
Linux teacher-contract baselines plus all eight Mac/Linux student-header
baselines. The four Mac teacher-contract baselines retain their prior evidence.

All eight corrected Linux captures compare successfully against actual GitHub
run38922863858 artifacts using Playwright's existing 100-pixel / 1% / 0.2
threshold settings; desktop captures are pixel-identical. Eight Linux snapshot
cases and four Mac header cases pass. Captures were visually inspected before
accepting the correction. Local comparison receipt:
`output/playwright/ci-baseline-font-comparison.json`. The prior claim of eight
passing captures described that local runtime, not equivalence to GitHub fonts.
