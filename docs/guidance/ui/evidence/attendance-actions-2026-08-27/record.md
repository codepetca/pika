# Attendance Action-Hierarchy Visual Evidence

## Provenance

- Implementation commit: `8aaf6d538f15292c4f505a606147e1d58c326907`
- Capture date: 2026-08-27
- Capture tool: Playwright Chromium through `e2e/experience-matrix.spec.ts`
- Base URL or environment: local `PIKA_E2E_FIXTURES=true` Next.js development server with placeholder-only build/runtime configuration
- Routes or component surfaces: `/e2e-fixtures/teacher-live-attendance`; teacher Attendance roster
- Evidence location: `docs/guidance/ui/evidence/attendance-actions-2026-08-27/`
- Historical baseline or current conformance evidence: current conformance evidence; `approved-design-reference.png` is the selected Product Design exploration, not product authority

## Verification Matrix

| Artifact | Role | Viewport | Theme | State | Reference surface |
|---|---|---:|---|---|---|
| `approved-design-reference.png` | teacher | 1486 x 1059 image board | light | initial default and selected menu | approved Option 1 exploration, superseded only where the user later revised interaction details |
| `teacher-desktop-light-default.png` | teacher | 1440 x 900 | light | 45-student default roster | teacher Attendance |
| `teacher-desktop-light-manual-with-undo.png` | teacher | 1440 x 900 | light | QR check-in manually corrected; Undo visible | teacher Attendance |
| `teacher-desktop-light-bulk-confirmation.png` | teacher | 1440 x 900 | light | whole-roster Absent confirmation | teacher Attendance |
| `teacher-desktop-light-hours-dialog.png` | teacher | 1440 x 900 | light | Attendance hours dialog | teacher Attendance |
| `teacher-desktop-dark-default.png` | teacher | 1440 x 900 | dark | 45-student default roster | teacher Attendance |
| `teacher-desktop-dark-manual-with-undo.png` | teacher | 1440 x 900 | dark | QR check-in manually corrected; Undo visible | teacher Attendance |
| `teacher-desktop-dark-bulk-confirmation.png` | teacher | 1440 x 900 | dark | whole-roster Absent confirmation | teacher Attendance |
| `teacher-desktop-dark-hours-dialog.png` | teacher | 1440 x 900 | dark | Attendance hours dialog | teacher Attendance |
| `teacher-mobile-light-default.png` | teacher | 390 x 844 | light | 45-student default roster | teacher Attendance |
| `teacher-mobile-light-manual-with-undo.png` | teacher | 390 x 844 | light | QR check-in manually corrected; Undo visible | teacher Attendance |
| `teacher-mobile-light-bulk-confirmation.png` | teacher | 390 x 844 | light | whole-roster Absent confirmation | teacher Attendance |
| `teacher-mobile-light-hours-dialog.png` | teacher | 390 x 844 | light | Attendance hours dialog | teacher Attendance |
| `teacher-mobile-dark-default.png` | teacher | 390 x 844 | dark | 45-student default roster | teacher Attendance |
| `teacher-mobile-dark-manual-with-undo.png` | teacher | 390 x 844 | dark | QR check-in manually corrected; Undo visible | teacher Attendance |
| `teacher-mobile-dark-bulk-confirmation.png` | teacher | 390 x 844 | dark | whole-roster Absent confirmation | teacher Attendance |
| `teacher-mobile-dark-hours-dialog.png` | teacher | 390 x 844 | dark | Attendance hours dialog | teacher Attendance |

The older `*-selected.png` and `*-selected-menu.png` files remain as historical
evidence for the initial approved direction. They are not current conformance
targets after the user's interaction revision.

## Assessment

- Design claim being checked: the date and session context stay quiet at the edges, while the joined date navigator, session actions, and confirmed whole-roster status controls form the dominant centered cluster above an internally scrolling roster with inline row corrections.
- Confirmed invariants: previous/date/next controls are contiguous; the selectable date has no dropdown chevron; row-selection checkboxes and the selected-student dropdown are absent; whole-roster Present/Late/Absent controls are square, named, tooltip-backed, and confirmed; per-student controls expose three named pressed states; QR-origin corrections expose Undo; Check-in shows the QR time or remains visually empty; mobile session actions collapse without losing QR/open/close/hours/refresh access; utilities remain reachable; the roster scrolls internally with sticky sortable/resizable headers and semantic status counts; there is no page overflow or action overlap.
- Inconsistencies or migration debt: none identified for this scope.
- Intentional differences: the implementation retains Attendance terminology, existing QR/session command rules, Pika typography/tokens, real confirmation polling, and existing permission gates. It projects the original QR check-in time/status from Pika's signed integration inbox so a later staff correction does not erase the provenance needed by Undo. Mobile condenses session context and utilities to preserve the centered status controls at 390 px.
- Limitations or dimensions not covered: no separate tablet viewport; student view is not applicable because this is a teacher-only work surface; backend integration behavior remains covered by existing component/API tests rather than the visual fixture.
- Follow-up owner: none.

## Accessibility Checklist

- Checklist reviewed: yes
- Keyboard behavior covered: yes; the joined date navigator and three-state row controls have reachable 44 px targets, and segmented controls support arrow/Home/End movement with roving focus
- Semantic state covered by tests: yes; pressed states, disabled states, confirmation-dialog labels, Undo labels, tooltips, and accessible group names are asserted
- Remaining manual follow-up: none

## Guidance Decision

Durable guidance changed only to correct the Attendance reference and mapping:
Attendance now demonstrates confirmed global scope actions plus immediate,
reversible inline row corrections without selection. The existing reusable rules
for quiet edge utilities, compact internal scrolling, sticky sortable/resizable
headers, and selection menus only when selection drives real batch actions were
otherwise sufficient. The joined Attendance date treatment remains a scoped
component option until another product surface proves it reusable.
