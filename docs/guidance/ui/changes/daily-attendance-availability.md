# Daily attendance availability

## Surface and reference

- Surface: teacher Classroom > Daily student table.
- Approved reference: the existing Daily operational table and its current attendance-enabled state, exercised by `/e2e-fixtures/teacher-daily-attendance`.
- Pattern reference: `/pattern-lab#status-colors` for the existing attendance status controls. This change introduces no new status, color, or table pattern.
- Roles: teacher only. The student attendance experience is not visually changed.
- Matrix: desktop and mobile, light and dark; scheduled/unavailable, open/editable, closed/editable, not configured, delayed/error, selected, and keyboard-focus states.

## Product signal

The table selection controls must communicate a real batch capability. When attendance cannot be marked for the selected class day, the selection column and its Student actions menu are absent. Existing attendance warnings explain configuration or sync failures, and the existing Open QR check-in action communicates how a scheduled session becomes editable.

## Reuse decisions

| Concern | Decision | Existing primitive |
| --- | --- | --- |
| Row and select-all controls | Reuse conditionally | `TableSelectionHeaderCell` and `TableSelectionCell` |
| Batch attendance actions | Reuse conditionally | `TeacherWorkSurfaceMenuButton` |
| Attendance status and check-in evidence | Reuse | Existing Daily columns and `AttendanceStatusControl` |
| Configuration and sync failures | Reuse | Existing Daily warning region |

No component is extended and no new component is created.

## Guardrails

- Do not add a tab, summary row, status taxonomy, color, or provider-specific wording.
- Do not remove attendance status or check-in evidence when marking is unavailable.
- Preserve row navigation and log selection independently from attendance batch selection.
- Preserve selection semantics and keyboard behavior when marking is available.
- Render no disabled selection checkbox when the batch action is unavailable.

## Composite-widget accessibility checklist

- The open and closed editable states retain native checkbox semantics and labels.
- The unavailable state removes both the checkbox controls and the selection-only menu, so focus cannot land on an action that has no effect.
- Table row keyboard navigation remains independent and unchanged.
- Column count and `colgroup` structure change together with the conditional selection column.
- Existing warnings remain live `role="alert"` content for failures; no new announcement channel is introduced.

Stable design guidance is followed. No experimental pattern or promotion is required.
