# Test Grading Action-Scope Visual Evidence

## Provenance

- Implementation commit: `6d8db92f00c394538fcf0dcfd4e40025f48956af`
- Capture date: 2026-08-27
- Capture tool: Playwright Chromium through `e2e/experience-matrix.spec.ts`
- Base URL or environment: local `PIKA_E2E_FIXTURES=true` Next.js development server
- Routes or component surfaces: `/e2e-fixtures/teacher-test-grading`; selected Test grading roster
- Evidence location: `docs/guidance/ui/evidence/test-grading-actions-2026-08-27/`
- Historical baseline or current conformance evidence: current conformance evidence; `approved-open-design-reference.png` is the approved exploration reference, not product authority

## Verification Matrix

| Artifact | Role | Viewport or container | Theme | State | Reference surface |
|---|---|---|---|---|---|
| `approved-open-design-reference.png` | teacher | 1488 x 1058 image board | light | default, selected menu, AI scope | approved Open Design exploration |
| `desktop-light-default.png` | teacher | 1440 x 900 | light | 45-student default roster | selected Test grading |
| `desktop-light-close-all-confirm.png` | teacher | 1440 x 900 | light | global Close All confirmation | selected Test grading |
| `desktop-light-selected-menu.png` | teacher | 1440 x 900 | light | selected student, menu open, sorted/scrolled roster | selected Test grading |
| `desktop-light-ai-grade-scope.png` | teacher | 1440 x 900 | light | AI scope prompt | selected Test grading |
| `desktop-dark-selected-menu.png` | teacher | 1440 x 900 | dark | selected student, menu open, sorted/scrolled roster | selected Test grading |
| `mobile-light-default.png` | teacher | 390 x 844 | light | 45-student default roster | selected Test grading |
| `mobile-light-close-all-confirm.png` | teacher | 390 x 844 | light | global Close All confirmation | selected Test grading |
| `mobile-light-selected-menu.png` | teacher | 390 x 844 | light | selected student, menu open, sorted/scrolled roster | selected Test grading |
| `mobile-light-ai-grade-scope.png` | teacher | 390 x 844 | light | AI scope prompt | selected Test grading |
| `mobile-dark-selected-menu.png` | teacher | 390 x 844 | dark | selected student, menu open, sorted/scrolled roster | selected Test grading |

## Assessment

- Design claim being checked: global Test access actions remain stable in the centered top cluster, the disabled-until-selection student menu becomes the selected-count trigger, row access switches communicate open/closed state, and long-roster table density remains intact.
- Confirmed invariants: quiet edge context; mathematically centered action cluster; no gap before the table; aligned header/row checkboxes; sticky sortable/resizable header; menu above the table layer; persistent Open All/Close All controls; exact four-item student menu; immediate semantic row switches; responsive light/dark rendering.
- Historical migration debt: at capture time, Attendance still used the transitional bottom selection bar. PR #1094 later completed that focused Attendance redesign and replaced row selection with confirmed whole-roster actions plus inline corrections.
- Intentional differences: the implementation uses Pika's existing modal dialog for the consequential AI grading scope choice instead of the exploration board's attached prompt; application tokens, production typography, and long realistic roster data remain authoritative.
- Limitations or dimensions not covered: no separate tablet viewport; student view is not applicable because this is a teacher-only surface; production data and authenticated routing are covered by existing integration paths rather than this fixture capture.
- Follow-up owner: none; the Attendance consistency pass is tracked by PR #1094.

## Rules

- The approved mock is retained as visual design evidence, not as canonical UI authority.
- `DESIGN.md`, stable UI guidance, shared primitives, and the running product own the durable rules.
