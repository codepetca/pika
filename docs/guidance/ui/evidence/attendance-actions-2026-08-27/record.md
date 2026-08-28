# Attendance Action-Hierarchy Visual Evidence

## Provenance

- Implementation commit: current PR #1094 branch head at capture time; final hash recorded in the PR
- Capture date: 2026-08-28
- Capture tool: Playwright Chromium through `e2e/experience-matrix.spec.ts`
- Base URL or environment: local `PIKA_E2E_FIXTURES=true` Next.js development server backed by the local ephemeral Supabase environment
- Routes or component surfaces: `/e2e-fixtures/teacher-live-attendance`; teacher Attendance roster
- Evidence location: `docs/guidance/ui/evidence/attendance-actions-2026-08-27/`
- Historical baseline or current conformance evidence: current conformance evidence; `approved-design-reference.png` is the selected Product Design exploration, not product authority

## Verification Matrix

| Artifact | Role | Viewport | Theme | State | Reference surface |
|---|---|---:|---|---|---|
| `approved-design-reference.png` | teacher | 1440 x 900 | light | approved always-editable default | final Product Design exploration with centered, content-sized session time and compact row controls |
| `teacher-desktop-light-default.png` | teacher | 1440 x 900 | light | 45-student default roster | teacher Attendance |
| `teacher-desktop-light-manual-with-undo.png` | teacher | 1440 x 900 | light | QR check-in manually corrected; Undo visible; one row selected | teacher Attendance |
| `teacher-desktop-light-selected-menu.png` | teacher | 1440 x 900 | light | one checked student; selected-student menu open | teacher Attendance |
| `teacher-desktop-light-hours-dialog.png` | teacher | 1440 x 900 | light | Attendance hours dialog | teacher Attendance |
| `teacher-desktop-dark-default.png` | teacher | 1440 x 900 | dark | 45-student default roster | teacher Attendance |
| `teacher-desktop-dark-manual-with-undo.png` | teacher | 1440 x 900 | dark | QR check-in manually corrected; Undo visible; one row selected | teacher Attendance |
| `teacher-desktop-dark-selected-menu.png` | teacher | 1440 x 900 | dark | one checked student; selected-student menu open | teacher Attendance |
| `teacher-desktop-dark-hours-dialog.png` | teacher | 1440 x 900 | dark | Attendance hours dialog | teacher Attendance |
| `teacher-desktop-light-no-hours.png` | teacher | 1440 x 900 | light | no session time; clock fallback | teacher Attendance |
| `teacher-desktop-dark-no-hours.png` | teacher | 1440 x 900 | dark | no session time; clock fallback | teacher Attendance |
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

The `*-selected.png` captures mirror the current manually corrected selected-row
state. The `*-selected-menu.png` captures are the authoritative selected-action
state for this revision. The removed `*-bulk-confirmation.png` captures described
the superseded whole-roster action direction and are no longer conformance evidence.

`qa-smaller-selected-controls-desktop.png` and
`qa-smaller-selected-controls-mobile.png` are superseded historical comparison
artifacts from the earlier 36 px-disc pass. They are not evidence for the final
28 px visual-disc geometry.

## Assessment

- Design claim being checked: the quiet refresh utility stays at the edge, while the joined date navigator, session-time control, immediate session actions, and persistent selected-student menu form the dominant centered cluster above an internally scrolling roster with checkbox selection and inline row corrections.
- Confirmed invariants: previous/date/next controls are contiguous; the selectable date has no dropdown chevron; each student has a checkbox and the header has a select-all checkbox; the selected-student menu stays visible but disabled with no selection and exposes the selected count when enabled; whole-roster status buttons and a manual-editing mode toggle are absent; per-student controls always expose three named pressed states in fixed Present/Late/Absent order with Pika's 44 px direct-action targets around 28 px icon-free visible discs; the selected status has a semantic blue ring while inactive states remain visible at 12% opacity; 28 px count pills align with the status discs; the trailing header shows sortable Present/Late/Absent counts without a visible `Status` label; QR-origin corrections expose a 44 px Undo action; Check-in shows the QR time or remains visually empty; the clickable session range shrinks to its content in the centered cluster while accommodating `12:45 AM - 10:34 PM`, uses uppercase AM/PM, and keeps spaces around the dash; its subtle semantic background communicates the open state without visible `Open` copy, while its accessible name retains that state; the old trailing hours icon is absent and a clock control appears when no range exists; mobile session actions collapse without losing QR/open/close/hours/refresh access; utilities remain reachable; the roster scrolls internally with sticky sortable/resizable headers; there is no page overflow or action overlap.
- Inconsistencies or migration debt: none identified for this scope.
- Intentional differences: the implementation retains Attendance terminology, existing QR/session command rules, Pika typography/tokens, real command-confirmation polling, and existing permission gates. It projects the original QR check-in time/status from Pika's signed integration inbox so a later staff correction does not erase the provenance needed by Undo. Mobile condenses session context and utilities while preserving the centered date/session/selection hierarchy at 390 px.
- Limitations or dimensions not covered: no separate tablet viewport; student view is not applicable because this is a teacher-only work surface; backend integration behavior remains covered by existing component/API tests rather than the visual fixture.
- Follow-up owner: none.

## Accessibility Checklist

- Checklist reviewed: yes
- Keyboard behavior covered: yes; the joined date navigator, menu, checkboxes, sortable counts, and three-state row controls have reachable targets; menus support Arrow/Home/End/Escape with focus restoration, and segmented controls support Arrow/Home/End movement with roving focus
- Semantic state covered by tests: yes; checkbox state, selected-row state, menu disabled/enabled state, selected count, pressed states, Undo labels, tooltips, accessible group names, absence of row-button icons, 44 px direct-action geometry, 28 px disc/count geometry, selected ring/shadow, inactive opacity, centered longest-range placement, semantic open background, accessible session-state naming, and uppercase AM/PM are asserted
- Remaining manual follow-up: none

## Guidance Decision

No durable guidance changed for this refinement. Icon-free circular row status
targets are an Attendance-specific treatment; existing reusable rules for quiet
edge utilities, persistent selection-aware menus, compact internal scrolling,
and sticky sortable/resizable headers remain sufficient.
