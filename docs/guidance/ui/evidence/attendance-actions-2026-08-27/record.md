# Attendance Action-Hierarchy Visual Evidence

## Provenance

- Implementation commit: `d6575cafe46c55af8a64394d0d5fb5aab4954bfe`
- Capture date: 2026-08-28
- Capture tool: Playwright Chromium through `e2e/experience-matrix.spec.ts`
- Base URL or environment: local `PIKA_E2E_FIXTURES=true` Next.js development server backed by the local ephemeral Supabase environment
- Routes or component surfaces: `/e2e-fixtures/teacher-live-attendance`; teacher Attendance roster
- Evidence location: `docs/guidance/ui/evidence/attendance-actions-2026-08-27/`
- Historical baseline or current conformance evidence: current conformance evidence; `approved-design-reference.png` is the selected Product Design exploration, not product authority

## Verification Matrix

| Artifact | Role | Viewport | Theme | State | Reference surface |
|---|---|---:|---|---|---|
| `approved-design-reference.png` | teacher | 1486 x 1059 image board | light | initial default and selected menu | approved Option 1 exploration, superseded only where the user later revised interaction details |
| `teacher-desktop-light-default.png` | teacher | 1440 x 900 | light | 45-student default roster | teacher Attendance |
| `teacher-desktop-light-manual-with-undo.png` | teacher | 1440 x 900 | light | QR check-in manually corrected; Undo visible; one row selected | teacher Attendance |
| `teacher-desktop-light-selected-menu.png` | teacher | 1440 x 900 | light | one checked student; selected-student menu open | teacher Attendance |
| `teacher-desktop-light-hours-dialog.png` | teacher | 1440 x 900 | light | Attendance hours dialog | teacher Attendance |
| `teacher-desktop-dark-default.png` | teacher | 1440 x 900 | dark | 45-student default roster | teacher Attendance |
| `teacher-desktop-dark-manual-with-undo.png` | teacher | 1440 x 900 | dark | QR check-in manually corrected; Undo visible; one row selected | teacher Attendance |
| `teacher-desktop-dark-selected-menu.png` | teacher | 1440 x 900 | dark | one checked student; selected-student menu open | teacher Attendance |
| `teacher-desktop-dark-hours-dialog.png` | teacher | 1440 x 900 | dark | Attendance hours dialog | teacher Attendance |
| `teacher-mobile-light-default.png` | teacher | 390 x 844 | light | 45-student default roster | teacher Attendance |
| `teacher-mobile-light-manual-with-undo.png` | teacher | 390 x 844 | light | QR check-in manually corrected; Undo visible; one row selected | teacher Attendance |
| `teacher-mobile-light-selected-menu.png` | teacher | 390 x 844 | light | one checked student; selected-student menu open | teacher Attendance |
| `teacher-mobile-light-hours-dialog.png` | teacher | 390 x 844 | light | Attendance hours dialog | teacher Attendance |
| `teacher-mobile-dark-default.png` | teacher | 390 x 844 | dark | 45-student default roster | teacher Attendance |
| `teacher-mobile-dark-manual-with-undo.png` | teacher | 390 x 844 | dark | QR check-in manually corrected; Undo visible; one row selected | teacher Attendance |
| `teacher-mobile-dark-selected-menu.png` | teacher | 390 x 844 | dark | one checked student; selected-student menu open | teacher Attendance |
| `teacher-mobile-dark-hours-dialog.png` | teacher | 390 x 844 | dark | Attendance hours dialog | teacher Attendance |
| `qa-circle-controls-desktop.png` | teacher | 2880 x 900 comparison | light | preceding icon-bearing row controls beside revised icon-free circular controls | teacher Attendance |
| `qa-circle-controls-mobile.png` | teacher | 780 x 844 comparison | dark | preceding icon-bearing row controls beside revised icon-free circular controls | teacher Attendance |
| `qa-smaller-selected-controls-desktop.png` | teacher | 2880 x 900 comparison | light | preceding full-size filled discs beside revised 36 px visible discs with selected rings | teacher Attendance |
| `qa-smaller-selected-controls-mobile.png` | teacher | 780 x 844 comparison | dark | preceding full-size filled discs beside revised 36 px visible discs with selected rings and uppercase AM/PM | teacher Attendance |

The `*-selected.png` captures mirror the current manually corrected selected-row
state. The `*-selected-menu.png` captures are the authoritative selected-action
state for this revision. The removed `*-bulk-confirmation.png` captures described
the superseded whole-roster action direction and are no longer conformance evidence.

## Assessment

- Design claim being checked: the date and session context stay quiet at the edges, while the joined date navigator, session actions, and persistent selected-student menu form the dominant centered cluster above an internally scrolling roster with checkbox selection and inline row corrections.
- Confirmed invariants: previous/date/next controls are contiguous; the selectable date has no dropdown chevron; each student has a checkbox and the header has a select-all checkbox; the selected-student menu stays visible but disabled with no selection and exposes the selected count when enabled; whole-roster status buttons are absent; per-student controls expose three named pressed states in fixed Present/Late/Absent order as 36 px icon-free visible circles inside retained 44 px hit targets; the selected status has a semantic ring while inactive states remain visible at lower emphasis; the trailing header shows sortable Present/Late/Absent counts without a visible `Status` label; QR-origin corrections expose Undo; Check-in shows the QR time or remains visually empty; all visible Attendance times use uppercase AM/PM; mobile session actions collapse without losing QR/open/close/hours/refresh access; utilities remain reachable; the roster scrolls internally with sticky sortable/resizable headers; there is no page overflow or action overlap.
- Inconsistencies or migration debt: none identified for this scope.
- Intentional differences: the implementation retains Attendance terminology, existing QR/session command rules, Pika typography/tokens, real command-confirmation polling, and existing permission gates. It projects the original QR check-in time/status from Pika's signed integration inbox so a later staff correction does not erase the provenance needed by Undo. Mobile condenses session context and utilities while preserving the centered date/session/selection hierarchy at 390 px.
- Limitations or dimensions not covered: no separate tablet viewport; student view is not applicable because this is a teacher-only work surface; backend integration behavior remains covered by existing component/API tests rather than the visual fixture.
- Follow-up owner: none.

## Accessibility Checklist

- Checklist reviewed: yes
- Keyboard behavior covered: yes; the joined date navigator, menu, checkboxes, sortable counts, and three-state row controls have reachable targets; menus support Arrow/Home/End/Escape with focus restoration, and segmented controls support Arrow/Home/End movement with roving focus
- Semantic state covered by tests: yes; checkbox state, selected-row state, menu disabled/enabled state, selected count, pressed states, Undo labels, tooltips, accessible group names, absence of row-button icons, 44 px hit geometry, 36 px disc geometry, selected ring/shadow, inactive opacity, and uppercase AM/PM are asserted
- Remaining manual follow-up: none

## Guidance Decision

No durable guidance changed for this refinement. Icon-free circular row status
targets are an Attendance-specific treatment; existing reusable rules for quiet
edge utilities, persistent selection-aware menus, compact internal scrolling,
and sticky sortable/resizable headers remain sufficient.
