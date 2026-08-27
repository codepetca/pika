# Attendance Product Design QA

## Comparison Target

- Source visual truth: `docs/guidance/ui/evidence/attendance-actions-2026-08-27/approved-design-reference.png`
- Primary implementation screenshots:
  - `docs/guidance/ui/evidence/attendance-actions-2026-08-27/teacher-desktop-light-default.png`
  - `docs/guidance/ui/evidence/attendance-actions-2026-08-27/teacher-desktop-light-selected-menu.png`
- Additional responsive/theme evidence: all `teacher-desktop-*` and `teacher-mobile-*` captures in the same evidence directory
- Route: `/e2e-fixtures/teacher-live-attendance`
- Role: teacher; student is not applicable to this teacher-only surface
- States: default, one selected student, selected-student menu open, internally scrolled/sorted roster, and Attendance hours dialog

## Dimensions and Normalization

- Source: 1486 x 1059 pixels, generated design board containing stacked default and selected examples; no CSS viewport or device-density metadata exists.
- Desktop implementation: 1440 x 900 CSS pixels and image pixels at device scale factor 1.
- Mobile implementation: 390 x 844 CSS pixels and image pixels at device scale factor 1.
- Full-view comparison: `docs/guidance/ui/evidence/attendance-actions-2026-08-27/qa-full-default.png`; the source was scaled to 900 px high and placed beside the unscaled 1440 x 900 default implementation.
- Focused default comparison: `docs/guidance/ui/evidence/attendance-actions-2026-08-27/qa-focus-default.png`; the source default action/table-header crop was normalized to 1440 px wide and stacked with the implementation's 1440 px action/table-header crop.
- Focused selected comparison: `docs/guidance/ui/evidence/attendance-actions-2026-08-27/qa-focus-selected-menu.png`; the source selected action/menu crop was normalized to 1440 px wide and stacked with the implementation's selected-menu crop.
- The source is an exploration board rather than a browser capture, so comparisons judge hierarchy and component treatment rather than false pixel precision.

## Findings

No actionable P0, P1, or P2 mismatch remains.

- Fonts and typography: the implementation uses Pika's production font stack, weights, and compact table type scale. The generated source typography is illustrative; hierarchy, legibility, and truncation behavior are consistent with the shared work surface.
- Spacing and layout rhythm: the centered cluster, quiet edges, tight roster, table border/radius, and menu attachment match the selected hierarchy. The date arrows directly touch the date segment. At 390 px, session commands and student actions collapse to compact icon triggers without overlap.
- Colors and visual tokens: semantic Pika surface, text, focus, selection, attendance-status, light, and dark tokens render consistently. Disabled and selected states remain distinguishable without color alone.
- Image quality and asset fidelity: the work surface requires no photographic or generated product asset. Production Lucide icons replace the generated board's illustrative icons and remain optically consistent with the existing Pika icon family; no handcrafted SVG, CSS art, emoji, or placeholder imagery was introduced.
- Copy and content: the implementation preserves Attendance-specific terms (`Show QR`, `Open attendance`, `Close attendance`, `Present`, `Late`, `Absent`, `Clear mark`, and `Attendance hours`) and does not import Test terminology. `Show QR` is intentionally more precise than the exploration tooltip's illustrative wording.
- Icons and affordances: every icon action has an explicit accessible name; desktop icon actions expose tooltips. The selectable date contains no dropdown chevron. The selected-student chevron appears only on the menu trigger at desktop size.
- Responsiveness and accessibility: desktop/mobile light/dark captures have no document overflow. Composite menu items meet the 44 px `min-h-control` target and use the canonical inset visible-focus ring. Menu roles, disabled state, initial focus, arrow navigation, Escape dismissal, and focus restoration are covered. Mobile session and utility menus retain all actions.
- Interaction/runtime check: primary actions, status sorting, internal scrolling/sticky header, selected-student menu, mobile session menu, utilities, and Attendance hours were exercised in Chromium. Browser console and page errors were collected and remained empty in all four projects.

## Comparison History

### Pass 1 — blocked

- [P2] Mobile utility overlap at 390 px: the first browser pass showed the trailing Attendance utility button intercepting pointer input on the selected-student trigger.
- Fix: collapsed mobile QR/open/close commands into one centered session-actions icon menu, shortened the mobile student-actions trigger to its icon/count representation, and kept the full explicit controls on desktop.
- Verification after fix: `teacher-mobile-light-default.png`, `teacher-mobile-light-selected-menu.png`, `teacher-mobile-dark-default.png`, and `teacher-mobile-dark-selected-menu.png` show separated controls; Playwright confirmed all actions are clickable and present.

### Pass 2 — passed

- The default and selected focused comparison boards show the approved action hierarchy with production Pika tokens and Attendance semantics.
- The complete desktop/mobile light/dark matrix passed, including geometry assertions for mathematical centering and touching previous/date/next segments.
- The visual comparison found no P0/P1/P2 issue. A later independent code review identified a shared menu accessibility issue that was not visible at the full-view comparison scale.

### Pass 3 — passed after independent review

- [P1] Shared teacher work-surface menu rows were shorter than the 44 px direct-action target and lacked the canonical visible-focus treatment.
- Fix: added `min-h-control` and the Pika inset focus-visible ring to the shared menu item, plus a regression assertion for those classes while retaining semantic keyboard tests.
- [P2] The teacher work-surface audit still described Attendance selection placement as migration debt after this implementation removed the bottom bar.
- Fix: corrected the affected guidance to list Attendance as a stable adopter and `TeacherSelectionBar` as legacy compatibility with no production owner.
- Post-fix evidence: refreshed `teacher-desktop-*-selected-menu.png`, `teacher-mobile-*-selected-menu.png`, and `qa-focus-selected-menu.png` show the taller menu rows. The full four-project Playwright matrix passed again with no browser or page errors.
- No actionable P0/P1/P2 issue remains.

## Follow-up Polish

None required. The generated reference uses wider illustrative roster columns and status labels, while production intentionally retains the existing compact, resizable Pika roster and Daily-style status dots.

final result: passed
