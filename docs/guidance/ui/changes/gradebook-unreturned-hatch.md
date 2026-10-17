# Unreturned teacher Gradebook marks

Owner approved 2026-10-16 in the Gradebook immediate-marks chat: add a subtle
hatch and tooltip to unreturned marks in PR1609. This is a scoped Gradebook
status treatment, not a new cross-product status convention.

- Surface/reference: production Gradebook table and student inspector, as
  demonstrated by Pattern Lab Gradebook compact.
- Roles: teacher; student Grades remains unchanged and is a disclosure regression.
- Matrix: desktop1440x900/mobile390x844, light/dark, returned/unreturned, selected
  inspector, hover/focus/tap tooltip, Escape, zero/raw/override/compact marks.
- Signal: faint diagonal lines behind the score; full-opacity text retains its
  existing grade colour. Returned marks, blanks, totals and standalone marks stay plain.
- Help: `Graded · Not returned to student`. Editable table marks keep their edit
  action; read-only marks and inspector scores expose keyboard-focusable help.
  Inspector help can also be tapped.
- Exclusions: no badges, icons, new controls in the toolbar, calculations or
  student-release changes. Unknown legacy return metadata does not assert a status.

| Need | Existing candidate | Decision | Reason |
|---|---|---|---|
| Per-student return state | Teacher Gradebook cell response | extend | Project existing document/attempt timestamp |
| Mark styling | Gradebook table/inspector | extend | One feature-owned CSS module supplies the hatch |
| Status help | Shared Tooltip | reuse | Existing hover/focus/Escape behavior |
| Executable reference | Pattern Lab Gradebook compact | extend | Deterministic returned/unreturned examples |

No shared component extraction or unrelated refactor is needed. Composite
accessibility checklist reviewed: focusable help, accessible state labels,
Escape/focus retention and unchanged mark-edit action have semantic coverage.
No global canon promotion is required for this owner-approved scoped treatment.
