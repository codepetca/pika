# Attendance schedules and location

User goal: use Daily's existing Attendance schedules action to choose one attendance location. The room section is headed **Attendance Location**, followed by one dropdown (for example, Room 223), without visible Default room / This meeting labels or a second room picker. Remove the teacher-only move sticker from this flow; keep the student attendance poster for the selected location.

The latest owner direction supersedes the earlier dual-picker UI requirement. The single choice is treated as the class location for the current and future meetings (explicitly confirmed by the owner). Use existing move with save_default when a meeting exists; use the existing class-room setting when no meeting exists. Do not introduce backend, auth, schema or catalog changes. Undo must restore both parts of the prior location assignment or visibly retain recovery for a partial failure. A mutation with an uncertain response requires a fresh authoritative snapshot before more location actions; recovery must not repeat an already-applied Undo. An existing meeting without a room remains unassigned in the picker, even if a future location is configured.

Reference: production AttendanceWindowDialog and its existing room owner; approved native Select/FormField and shared modal-close behavior. Pattern Lab's modal-close reference remains visual evidence. Follow DESIGN.md and stable.md; no experimental primitive or promotion needed.

| Need | Existing candidate | Decision | Reason |
| --- | --- | --- | --- |
| Schedule picker/edit/save | AttendanceWindowDialog | reuse | Preserve timing and delivery acknowledgement |
| One location picker | Existing room owner and Select/FormField | extend | One visible choice; hidden accessible label |
| Student attendance QR | TeacherRoomPosterDialog, AttendancePoster | reuse | Print the chosen physical room's student poster |
| Overlay behavior | ContentDialog, DialogPanel | reuse | Preserve focus, close and keyboard contracts |

Risk: workspace-state. Requests and selection belong to classroom + selected date + open generation. Preserve A→B→A stale-response protection, schedule-error independence, busy guards and poster return. Keep shared admin-created catalog, permissions/readiness, disabled/error/retry states, normal Daily entry and unchanged external room-return links.

Teacher only; student n/a because student UI and check-in contracts are unchanged. Verify desktop1440×900/mobile390×844, light/dark; loaded/empty/loading/error/unready, saving, Undo/recovery, schedule edit/apply/acknowledgement and poster return. Primary signal: one location dropdown under one heading. Composite widget review: dialog focus, native selection, busy/disabled actions and poster overlay.

No duplicate room manager, teacher move QR, extra room controls, new dependency, auth/data architecture, hosted migration or deployment. Follow the draft-first review lifecycle for follow-up changes. Model recommendation: GPT-6.1 Terra medium for bounded UI work; GPT-6.1 Sol high for consequential integration review.

## Legacy location recovery — 2026-11-18

When a legacy future location is no longer selectable, a successful move to a shared room cannot be undone in full. Keep the new selection and explain that Undo is unavailable; preserve normal Undo when the previous future location remains restorable. Reset the notice with the classroom, date, dialog lifetime and later actions; do not show it after an uncertain write or failed refresh.

| Need | Existing candidate | Decision | Reason |
| --- | --- | --- | --- |
| Location state and ownership | TeacherAttendanceRoomsDialog room owner | extend | Keep rollback eligibility with the existing snapshot and request generation |
| Location control | Select and FormField | reuse | Existing native picker already reflects unavailable locations |
| Recovery explanation | Existing inline status copy | reuse | A concise status needs no new primitive |

Teacher only; student UI n/a. Verify with and without a current meeting, desktop/mobile and light/dark, including subsequent valid changes and uncertain refresh. No backend or catalog changes.
