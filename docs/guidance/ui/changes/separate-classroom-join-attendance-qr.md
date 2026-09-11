# Separate classroom join and attendance QR

Reference: classroom Settings > Access, the shared `DialogPanel` and `QrCode`
contracts, and the Daily attendance QR poster. Roles: teacher, student, and signed-out
student. Viewports: 1440×900 and 390×844. Themes: light and dark. States: settings
default, join QR open, join success/already joined/no roster match/ambiguous match,
attendance checked in/not joined/not rostered/revoked, and authentication continuation.

Primary signal: every teacher QR surface uses a visible purpose label plus the
classroom name. `Join this classroom` and `Check in for attendance` are never
interchangeable and never rely on color. Joining records no attendance; attendance
offers no enrollment action.

| Need | Existing candidate | Decision | Reason |
|---|---|---|---|
| Join destination and token | `/join/[code]` and `class_code` | reuse | One established enrollment mechanism and auth return path |
| QR rendering and modal behavior | `QrCode` and `DialogPanel` | reuse | Existing sizing, quiet-zone, focus, Escape, and dismissal contracts |
| Teacher join controls | Settings Access panel | extend | Student access is the established teacher-owned surface |
| Join QR composition | `TeacherClassroomJoinQrDialog` | create | Feature-local decomposition keeps join semantics out of the attendance poster |
| Attendance poster | `TeacherClassroomQrDialog` | extend | Preserve rotation/print behavior while making its purpose explicit |

No new shared primitive or Pattern Lab promotion is required. The Daily Pattern Lab
reference wording changes with the production attendance owner. Composite-widget
review is n/a: the change uses ordinary buttons and an existing dialog contract.
