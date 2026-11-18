# Attendance schedules and rooms

User goal: open the existing Daily Attendance schedules action to assign a room and print its student poster or teacher sticker. Remove the separate Attendance rooms overflow entry.

Reference: the production AttendanceWindowDialog schedule picker/editor and TeacherAttendanceRoomsDialog controls, with Pattern Lab dialog-entry/modal-close as overlay references. Follow DESIGN.md and stable.md; no experimental pattern or human promotion needed.

Risk: workspace-state. Room state belongs to classroom ID + selected attendance date + open lifetime. Ignore previous-owner responses, reset owner-scoped selection and poster state on navigation, and cover a late-response regression.

| Need | Existing candidate | Decision | Reason |
| --- | --- | --- | --- |
| Schedule selection/edit/save | AttendanceWindowDialog | extend | Keep existing timing and delivery acknowledgement |
| Room assignment | TeacherAttendanceRoomsDialog | reuse | One implementation preserves room commands and permissions |
| Student poster and teacher sticker | TeacherRoomPosterDialog, AttendancePoster, QrCode | reuse | Retain room-specific semantics |
| Overlay behavior | ContentDialog, DialogPanel | reuse | Shared focus, close and keyboard contracts |

Teacher only; student n/a because student UI and check-in contracts do not change. Verify desktop 1440×900 and mobile 390×844, light/dark, closed/open/focus, loaded/loading/error/empty/unready, selection/edit/save/acknowledgement, move/Undo and poster return. Primary signal: schedule selection and room assignment appear in one existing dialog. Composite-widget accessibility review: yes (dialog focus, native selects, busy/disabled controls, poster overlay).

Default room and This meeting remain separate. Changing today's room leaves the default intact. Keep admin-created shared catalog, readiness and permissions, error/retry states, Undo, room-return links, date/classroom switching and the normal Daily entry point. Exclude new manager, auth/data architecture, new dependencies, hosted migrations and deployment.

Implementation: compose the existing room owner into the schedules flow and route former room-dialog entry paths there. Verify with closest component tests, focused checks and Playwright. Independent review covers the complete fixed commit after draft publication. Keep the PR draft as requested.

Model recommendation: GPT-6.1 Terra medium for bounded UI implementation; GPT-6.1 Sol high for integration review.
