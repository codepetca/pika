# Selected tab visibility

Surface: canonical horizontal `Tabs`, shared by teacher and student workspaces.
Reference: approved Pattern Lab Selection controls; `src/ui/README.md` Composite
controls and `composite-control-conventions.md` narrow-width scrolling contract.
This extends existing scrolling behavior without changing its visual treatment.
Implementation assignment: GPT-6.1 Sol/medium (requested); effective runtime
telemetry unavailable. Risk: workspace-state (selection, focus and scroll).

Roles: teacher/student. Viewports: desktop/mobile. Themes: light/dark.
States: initial later-tab selection, owner remount with retained selection,
controlled selection, keyboard arrows/Home/End, resize, manual horizontal scroll,
unchanged rerender, normal/reduced motion, underline/connected variants and RTL.
Primary signal: existing selected label and underline/connected treatment, visible
inside the tab list. No extra controls, centering, page scrolling, delayed commands,
new animation, new dependency or feature-owned selection changes.
Composite checklist required: yes. Verify relationships, selected semantics,
roving focus, disabled-item skipping, visible focus and explicit labels.

| Need | Existing candidate | Decision | Reason |
| --- | --- | --- | --- |
| Keep selected tab visible | src/ui/Tabs.tsx | extend | Reveal selection locally on mount, selection/layout change without stealing focus |
| Panel identity and drafts | Existing caller state and TabPanel | reuse | Scrolling must not remount or redefine feature state |
| Reproducible reference | Pattern Lab Selection controls | extend | Fixed production-owner overflow example, no live API data |
| Visual selection and keyboard | Existing Tabs variants | reuse | Preserve approved semantics, tokens, targets and roving keyboard behavior |

Baseline: synthetic reads through the actual Blueprint client in the production-
blocked PR #1493 fixture; 8 viewport/theme/motion variants. Settings remains selected
when switching Blueprints, but the remounted mobile list resets to scrollLeft=0,
clipping that tab in all 4 mobile variants (300px list, 492px content). Desktop fits.
Zero mutation requests. This defect exists in the main shared owner; it is not
attributed to the unmerged motion or recovery changes. Evidence is in this chat's
visualization directory under `tab-selection-visibility/baseline.json` and PNGs.

Acceptance: minimal immediate horizontal movement of this tab list only. Fully
visible selections and manual browsing survive unrelated rerenders. Focus, outer
scroll, draft/input DOM, caret, tab/panel IDs, selection and disabled behavior remain
owned by their current callers. Resize/content layout changes reveal a clipped
selection; oversized labels receive bounded best-effort visibility without loops.
Test meaningful geometry regressions RED before implementation, then GREEN. Add
repeatable browser checks of both variants and roles across desktop/mobile,
light/dark, normal/reduced motion with screenshots and natural recordings. Actual
Blueprint owner switching is supplemental; a controlled client fixture does not
prove authentication, route shell, live outages or production performance.

Independent standard-risk review follows the draft-first stable-SHA lifecycle.
Merge and production deployment remain separate owner decisions. No new pattern
promotion is needed for this repair of the existing narrow-width scrolling contract.
