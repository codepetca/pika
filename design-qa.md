# Attendance Product Design QA

## Comparison Target

- Source visual truth: `docs/guidance/ui/evidence/attendance-actions-2026-08-27/approved-design-reference.png` for the approved always-editable hierarchy, plus the user's explicit interaction revisions through 2026-08-28
- Primary implementation screenshots:
  - `docs/guidance/ui/evidence/attendance-actions-2026-08-27/teacher-desktop-light-default.png`
  - `docs/guidance/ui/evidence/attendance-actions-2026-08-27/teacher-desktop-light-manual-with-undo.png`
  - `docs/guidance/ui/evidence/attendance-actions-2026-08-27/teacher-desktop-light-selected-menu.png`
  - `docs/guidance/ui/evidence/attendance-actions-2026-08-27/teacher-desktop-light-no-hours.png`
- Additional responsive/theme evidence: all `teacher-desktop-*` and `teacher-mobile-*` captures in the same evidence directory
- Route: `/e2e-fixtures/teacher-live-attendance`
- Role: teacher; student is not applicable to this teacher-only surface
- States: default, QR correction with Undo, one checked student with the selected-student menu open, internally scrolled/sorted roster, Attendance hours dialog, and no-session-time fallback

## Dimensions and Normalization

- Source: 1440 x 900 CSS pixels and image pixels at device scale factor 1.
- Desktop implementation: 1440 x 900 CSS pixels and image pixels at device scale factor 1.
- Mobile implementation: 390 x 844 CSS pixels and image pixels at device scale factor 1.
- The source and implementation default captures were reviewed together at the same 1440 x 900 viewport and state. Additional captures were reviewed as a desktop/mobile, light/dark state matrix.
- The source remains an exploration rather than product authority, so comparisons judge approved hierarchy and component treatment while production retains Pika's real tokens, data density, permissions, and commands.

## Findings

No actionable P0, P1, or P2 mismatch remains.

- Fonts and typography: the implementation uses Pika's production font stack, weights, and compact table type scale. Hierarchy, legibility, and truncation behavior are consistent with the shared work surface.
- Spacing and layout rhythm: the content-sized clickable session range now joins the centered action cluster immediately after the date, while refresh remains quiet at the edge. The full `12:45 AM - 10:34 PM` example fits without crowding the QR, close, or selected-student controls. Row status targets are reduced to 32 px so the tight table padding produces visibly shorter rows. The date arrows directly touch the date segment. At 390 px, session context and commands condense into one compact menu without overlap.
- Colors and visual tokens: semantic Pika surface, text, focus, attendance-status, light, and dark tokens render consistently. The time control uses a subtle success surface while the session is open, without adding visible `Open` copy. The active row status is full-strength with a primary blue ring and subtle shadow; the other two choices remain discoverable at 12% opacity. Count pills and visible discs share a 28 px width on a 44 px direct-action grid.
- Copy and content: the implementation preserves Attendance-specific terms and does not import Test terminology. `Check-in` contains the Toronto-local QR check-in time and is visually empty when no QR check-in exists. The session range, Check-in, and QR expiry use uppercase `AM`/`PM`; the session range uses spaces around the dash.
- Icons and affordances: the old trailing Attendance hours icon is removed. The centered session range itself is a subtle button that opens Attendance hours; its accessible name still announces the open session state, and a clock button occupies the same centered slot when no range exists. The selectable date has no dropdown chevron. Row status controls are icon-free; remaining utility and menu icons use Pika's existing Lucide family with accessible names and tooltips.
- Selection and actions: checkbox selection remains independent from always-available row corrections. The persistent selected-student menu is disabled until selection and then exposes the selected count. Broad whole-roster status buttons and a manual-attendance mode toggle are absent.
- Responsiveness and accessibility: desktop/mobile light/dark captures have no document overflow. Row status controls preserve Pika's 44 x 44 direct-action target around the explicitly requested 28 px visual circle, while retaining named pressed states, visible focus rings, roving focus, and Arrow/Home/End behavior. Mobile keeps Attendance hours in the condensed action menu. The internal roster scroller retains sticky sortable/resizable headers.
- Interaction/runtime check: checkbox selection, select-all semantics, selected-student actions, direct row changes, QR Undo, status sorting, internal scrolling, mobile session menu, clickable session range, no-time clock fallback, and Attendance hours were exercised in Chromium. Browser console and page errors remained empty in all four projects.

## Comparison History

### Pass 10 — centered time control and smaller row circles, passed

- Moved the content-sized Attendance time control into the centered primary action cluster immediately after the joined date navigator.
- Removed the visible `Open` label and status dot. The open state now uses a subtle semantic success background while the control's accessible name continues to announce `Open`.
- Reduced visible row status discs/count pills from 32 px to 28 px while preserving 44 px status and QR-Undo hit targets to satisfy Pika's direct-action accessibility contract.
- Compared the refreshed 1440 x 900 Product Design source and implementation together and reviewed desktop/mobile light/dark default, selected-menu, Undo, hours-dialog, scrolled-header, and no-hours states. No actionable mismatch remains.

### Pass 9 — left-fitted time control and denser row choices, passed

- Moved the clickable session-time control to the left edge of its context track and removed the stretching/right-alignment rules.
- Exercised the longest requested example, `Open · 12:45 AM - 10:34 PM`, and confirmed the button remains content-sized and below one-third of the desktop context bar width.
- Reduced row status targets from 44 px to 36 px and visible discs/count pills from 36 px to 32 px. The compact target removes eight pixels from the control-driven row height while preserving the selected ring, inactive opacity, semantic pressed states, tooltips, and keyboard model.
- Compared the refreshed 1440 x 900 source and implementation together and reviewed desktop/mobile light/dark default, selected-menu, Undo, dialog, scrolled-header, and no-hours states. No actionable mismatch remains.

### Pass 8 — always-editable controls and direct session-time editing, passed

- Removed the manual-attendance mode concept from the approved direction; the fixed Present/Late/Absent control is always available when existing Attendance permissions allow marking.
- Reduced inactive status discs from 35% to 12% opacity and removed the segmented-control track, preserving a quiet fixed three-column grid. The selected disc remains full-strength with its blue ring.
- Widened count pills to 36 px and aligned their 44 px targets with the row status columns.
- Replaced the trailing Attendance hours icon with a directly clickable session range using spaced-dash time formatting. Dates without a range show a clock fallback in the same leading slot. Its final left alignment and content sizing are recorded in Pass 9.
- Compared the final 1440 x 900 source and implementation together, then verified desktop/mobile light/dark default, selected, menu, Undo, dialog, scrolled-header, and no-hours states. No actionable mismatch remains.

### Pass 7 — smaller discs and stronger selected state, passed

- Reduced the visible attendance disc from 44 x 44 to 36 x 36 while retaining the 44 x 44 target, focus behavior, fixed order, and named pressed states.
- Added a semantic primary ring and subtle shadow to the selected disc and standardized visible Attendance times to uppercase `AM`/`PM`.
- The four-project Chromium matrix passed with explicit geometry, opacity, ring, and time-label assertions.

### Pass 6 — icon-free circular row controls, passed

- Removed the check, clock, and x icons from the three row status buttons and changed the visible state marks to circles.
- Preserved semantic color, fixed order, tooltips, named pressed states, and roving Arrow/Home/End keyboard behavior.

### Pass 5 — checkbox selection restored, passed

- Restored row/select-all checkboxes and the persistent selected-student actions menu.
- Removed the superseded whole-roster status buttons while retaining per-student controls, Check-in time, and QR correction Undo.
- Removed only the visible `Status` header text; accessible sortable counts remain.

### Pass 4 — whole-roster direction, superseded by Pass 5

- Explored confirmed whole-roster status actions at the user's direction at that point.
- This interaction was later explicitly reverted; it is retained here only as decision history and is not current conformance evidence.

### Passes 1–3 — responsive and accessibility refinements, passed

- Resolved mobile utility overlap by condensing session actions without moving the mathematically centered primary cluster.
- Verified the selected hierarchy across desktop/mobile light/dark.
- Independent review strengthened shared menu row target height/focus treatment and corrected the teacher work-surface guidance mapping.

## Follow-up Polish

None required. Durable teacher work-surface guidance already covers the reusable hierarchy; the status-disc opacity, clickable session range, time formatting, and no-time fallback are Attendance-specific.

final result: passed
