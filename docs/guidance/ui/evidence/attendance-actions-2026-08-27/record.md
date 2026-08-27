# Attendance Action-Hierarchy Visual Evidence

## Provenance

- Implementation commit: `254c18aeff5d5a726071429fc44905ed65574e73`
- Capture date: 2026-08-27
- Capture tool: Playwright Chromium through `e2e/experience-matrix.spec.ts`
- Base URL or environment: local `PIKA_E2E_FIXTURES=true` Next.js development server with placeholder-only build/runtime configuration
- Routes or component surfaces: `/e2e-fixtures/teacher-live-attendance`; teacher Attendance roster
- Evidence location: `docs/guidance/ui/evidence/attendance-actions-2026-08-27/`
- Historical baseline or current conformance evidence: current conformance evidence; `approved-design-reference.png` is the selected Product Design exploration, not product authority

## Verification Matrix

| Artifact | Role | Viewport | Theme | State | Reference surface |
|---|---|---:|---|---|---|
| `approved-design-reference.png` | teacher | 1486 x 1059 image board | light | default and selected menu | approved Option 1 exploration |
| `teacher-desktop-light-default.png` | teacher | 1440 x 900 | light | 45-student default roster | teacher Attendance |
| `teacher-desktop-light-selected.png` | teacher | 1440 x 900 | light | one selected student | teacher Attendance |
| `teacher-desktop-light-selected-menu.png` | teacher | 1440 x 900 | light | selected-student menu open | teacher Attendance |
| `teacher-desktop-light-hours-dialog.png` | teacher | 1440 x 900 | light | Attendance hours dialog | teacher Attendance |
| `teacher-desktop-dark-default.png` | teacher | 1440 x 900 | dark | 45-student default roster | teacher Attendance |
| `teacher-desktop-dark-selected.png` | teacher | 1440 x 900 | dark | one selected student | teacher Attendance |
| `teacher-desktop-dark-selected-menu.png` | teacher | 1440 x 900 | dark | selected-student menu open | teacher Attendance |
| `teacher-desktop-dark-hours-dialog.png` | teacher | 1440 x 900 | dark | Attendance hours dialog | teacher Attendance |
| `teacher-mobile-light-default.png` | teacher | 390 x 844 | light | 45-student default roster | teacher Attendance |
| `teacher-mobile-light-selected.png` | teacher | 390 x 844 | light | one selected student | teacher Attendance |
| `teacher-mobile-light-selected-menu.png` | teacher | 390 x 844 | light | selected-student menu open | teacher Attendance |
| `teacher-mobile-light-hours-dialog.png` | teacher | 390 x 844 | light | Attendance hours dialog | teacher Attendance |
| `teacher-mobile-dark-default.png` | teacher | 390 x 844 | dark | 45-student default roster | teacher Attendance |
| `teacher-mobile-dark-selected.png` | teacher | 390 x 844 | dark | one selected student | teacher Attendance |
| `teacher-mobile-dark-selected-menu.png` | teacher | 390 x 844 | dark | selected-student menu open | teacher Attendance |
| `teacher-mobile-dark-hours-dialog.png` | teacher | 390 x 844 | dark | Attendance hours dialog | teacher Attendance |

## Assessment

- Design claim being checked: the date and session context stay quiet at the edges, while the joined date navigator, session actions, and persistent selected-student actions form the dominant centered cluster above an internally scrolling roster.
- Confirmed invariants: previous/date/next controls are contiguous; the selectable date has no dropdown chevron; the selected-student trigger persists and is disabled before selection; mobile session actions collapse without losing QR/open/close access; utilities remain reachable; the roster scrolls internally with sticky sortable/resizable headers and semantic status counts; there is no page overflow or action overlap.
- Inconsistencies or migration debt: none identified for this scope.
- Intentional differences: the implementation retains Attendance terminology, existing QR/session command rules, Pika typography/tokens, Daily-style status dots, real confirmation polling, and existing permission gates. Mobile uses compact icon menus to preserve the hierarchy at 390 px.
- Limitations or dimensions not covered: no separate tablet viewport; student view is not applicable because this is a teacher-only work surface; backend integration behavior remains covered by existing component/API tests rather than the visual fixture.
- Follow-up owner: none.

## Accessibility Checklist

- Checklist reviewed: yes
- Keyboard behavior covered: yes; menu initial focus, arrow navigation, Escape dismissal, and focus restoration are covered
- Semantic state covered by tests: yes; menu roles, expanded/disabled states, selected-row semantics, and accessible control names are asserted
- Remaining manual follow-up: none

## Guidance Decision

No durable design guidance changed. The reusable rules—centered persistent selected-actions menus, quiet edge utilities, compact internal scrolling, and sticky sortable/resizable headers—were already established by the Test grading work-surface guidance. The joined Attendance date treatment remains a scoped component option until another product surface proves it reusable.
