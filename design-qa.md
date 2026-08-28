# Attendance Product Design QA

## Comparison Target

- Source visual truth: `docs/guidance/ui/evidence/attendance-actions-2026-08-27/approved-design-reference.png` for the selected hierarchy, plus the user's explicit interaction revisions through 2026-08-28 (checkbox selection and persistent selected-student menu restored; inline three-state corrections retained; QR Undo retained; Check-in time retained; visible `Status` header label removed)
- Primary implementation screenshots:
  - `docs/guidance/ui/evidence/attendance-actions-2026-08-27/teacher-desktop-light-default.png`
  - `docs/guidance/ui/evidence/attendance-actions-2026-08-27/teacher-desktop-light-manual-with-undo.png`
  - `docs/guidance/ui/evidence/attendance-actions-2026-08-27/teacher-desktop-light-selected-menu.png`
- Additional responsive/theme evidence: all `teacher-desktop-*` and `teacher-mobile-*` captures in the same evidence directory
- Route: `/e2e-fixtures/teacher-live-attendance`
- Role: teacher; student is not applicable to this teacher-only surface
- States: default, a manual correction to a QR check-in with Undo, one checked student with the selected-student menu open, internally scrolled/sorted roster, and Attendance hours dialog

## Dimensions and Normalization

- Source: 1486 x 1059 pixels, generated design board containing stacked default and selected examples; no CSS viewport or device-density metadata exists.
- Desktop implementation: 1440 x 900 CSS pixels and image pixels at device scale factor 1.
- Mobile implementation: 390 x 844 CSS pixels and image pixels at device scale factor 1.
- Full-view comparison: `docs/guidance/ui/evidence/attendance-actions-2026-08-27/qa-full-default.png`; the source was scaled to 900 px high and placed beside the unscaled 1440 x 900 default implementation.
- Focused default comparison: `docs/guidance/ui/evidence/attendance-actions-2026-08-27/qa-focus-default.png`; the 1486 x 529 source default crop and 1440 x 529 implementation crop are placed side by side without density scaling.
- Focused selected comparison: `docs/guidance/ui/evidence/attendance-actions-2026-08-27/qa-focus-selected-menu.png`; the 1486 x 529 source selected crop and 1440 x 529 implementation selected-menu crop are placed side by side without density scaling.
- Revised interaction comparison: `docs/guidance/ui/evidence/attendance-actions-2026-08-27/qa-focus-revision.png`; the full source board was scaled to 900 px high and placed beside the unscaled 1440 x 900 implementation selected-menu state, with the user's explicit Attendance revisions treated as authoritative where they supersede the generated image.
- The source is an exploration board rather than a browser capture, so comparisons judge hierarchy and component treatment rather than false pixel precision.

## Findings

No actionable P0, P1, or P2 mismatch remains.

- Fonts and typography: the implementation uses Pika's production font stack, weights, and compact table type scale. The generated source typography is illustrative; hierarchy, legibility, and truncation behavior are consistent with the shared work surface.
- Spacing and layout rhythm: the centered cluster, quiet edges, tight roster, and table border/radius match the selected hierarchy. The date arrows directly touch the date segment. At 390 px, nonessential session context is visually condensed and session commands/utilities collapse to one compact icon menu without overlap.
- Colors and visual tokens: semantic Pika surface, text, focus, attendance-status, light, and dark tokens render consistently. The active state is full-strength while the other two status choices remain visible at lower emphasis; icons and `aria-pressed` ensure the control does not rely on color alone.
- Image quality and asset fidelity: the work surface requires no photographic or generated product asset. Production Lucide icons replace the generated board's illustrative icons and remain optically consistent with the existing Pika icon family; no handcrafted SVG, CSS art, emoji, or placeholder imagery was introduced.
- Copy and content: the implementation preserves Attendance-specific terms (`Show QR`, `Open attendance`, `Close attendance`, `Present`, `Late`, `Absent`, `Restore QR check-in`, and `Attendance hours`) and does not import Test terminology. `Check-in` contains the Toronto-local QR check-in time and is visually empty when the student has no QR check-in.
- Icons and affordances: every icon action has an explicit accessible name and tooltip. The selectable date contains no dropdown chevron. The persistent selected-student menu uses Attendance terms and remains disabled until selection. Row status controls use the green/check, yellow/clock, and red/x mapping, and the trailing header keeps only the matching sortable counts without a visible `Status` label.
- Responsiveness and accessibility: desktop/mobile light/dark captures have no document overflow. All direct controls meet the 44 px `min-h-control` target and use the canonical focus-visible treatment. The three-state control supplies a named group, named pressed-state buttons, roving focus, and Arrow/Home/End behavior. Mobile session and utility menus retain all actions.
- Interaction/runtime check: checkbox selection, select-all semantics, the selected-student menu, direct row status changes, QR Undo visibility, status sorting, internal scrolling/sticky header, mobile session menu, utilities, and Attendance hours were exercised in Chromium. Browser console and page errors were collected and remained empty in all four projects.

## Comparison History

### Pass 5 — checkbox selection restored, passed

- Restored row and select-all checkboxes plus the persistent selected-student actions menu, disabled until selection and labeled with the selected count when enabled.
- Removed the superseded whole-roster Present/Late/Absent buttons while retaining the per-student three-state control, Check-in time, and QR correction Undo.
- Removed only the visible `Status` header text; the accessible sortable Present/Late/Absent counts remain in the trailing header.
- The first selected-state capture included a transient success message over the centered controls. The capture sequence now waits for that message to dismiss before recording the selected menu, eliminating a misleading overlap from the evidence.
- Focused source/implementation comparison plus the refreshed desktop/mobile light/dark matrix found no actionable P0/P1/P2 issue. All four Chromium projects passed with no browser or page errors.

### Pass 4 — whole-roster interaction revision, passed but superseded by Pass 5

- Removed the earlier checkbox/selected-student menu interaction at the user's direction.
- Added confirmed whole-roster Present/Late/Absent actions to the centered cluster and immediate inline three-state row corrections.
- Replaced Source with QR Check-in time and retained the original signed QR event projection so a staff correction can expose Undo without losing the QR status/time across refresh.
- The first visual pass used a persistent high-contrast ring on every active row status. It was visually noisy across a dense roster, so the selected state was refined to full-strength semantic color plus icon while inactive choices remain visibly muted; keyboard focus continues to use the shared focus-visible ring.
- The mobile context label was visually condensed while preserving the grid slot after a centering assertion caught that hiding the entire grid item shifted the primary cluster. The final matrix confirms mathematical centering and no overlap.
- No actionable P0/P1/P2 issue remains in the revised desktop/mobile light/dark matrix.

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

None required. The generated reference uses wider illustrative roster columns and static status labels, while production intentionally retains the compact, resizable Pika roster and replaces static labels with direct three-state controls per the user's revision.

final result: passed
