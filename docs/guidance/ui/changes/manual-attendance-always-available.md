---
status: implemented
approved_reference: Existing teacher Daily attendance status controls and Edit attendance dialog
approved_by: user
approved_on: 2026-09-09
---

# Manual Attendance Always Available

- Surface: teacher classroom Daily attendance table and More actions.
- Reference: the production Daily row status controls, class-wide Edit attendance
  dialog, and stable teacher operational-table guidance.
- Affected roles: teacher. Student is regression-only because no student
  attendance surface changes.
- Viewports/themes: desktop and mobile, light and dark.
- States: scheduled, open, closed, and cancelled attendance occurrences;
  not-scheduled, non-class-day, and archived states remain guarded.
- Primary signal: existing Present, Late, and Absent actions remain enabled for
  staff correction independently of the QR session lifecycle.
- Must not add: new controls, alternate status storage, QR actions in closed or
  cancelled states, or edits on archived/non-class days.
- Composite widget accessibility review: existing named 44px row buttons,
  keyboard menu behavior, dialog focus, and pressed states are unchanged.

| Need | Existing candidate | Decision | Reason |
| --- | --- | --- | --- |
| Staff corrections across QR lifecycle states | `useTeacherAttendanceController` `canMark` policy | extend | The server accepts audited overrides for every existing attendance occurrence |
| Row and class-wide actions | Daily status buttons and Edit attendance dialog | reuse | Existing semantics, persistence, and accessibility already fit |
| New UI component | None | reuse | This is an enabled-state correction, not a new visual pattern |

Verification matrix: teacher desktop/mobile in light/dark for scheduled and
cancelled occurrences; student is n/a because no student UI or shared shell
behavior changes. Confirm QR remains unavailable when the session is not open,
while row and class-wide manual attendance controls remain available.
