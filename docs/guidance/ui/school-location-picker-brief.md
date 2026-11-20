# School location picker — 2026-11-19

Surface: teacher Attendance schedules and Attendance Location dialog. Reference: existing attendance room picker and Pattern Lab select/dialog primitives. Teacher only; student view unchanged. Desktop and mobile, light and dark. States: loading, empty, selected, updating, failure, refresh, poster and undo. Primary signal: selected school and room; Custom retains existing class QR fallback. Excludes administration and class linking. Native selects retain keyboard behavior; no new composite widget.

| Need | Existing candidate | Decision | Reason |
|---|---|---|---|
| Location selection | Select / FormField | reuse | Existing accessible choice control |
| Attendance location workflow | useTeacherAttendanceRoomsContent | extend | Shared schedule and dialog owner |
| Poster and undo | Existing attendance controls | reuse | Preserve established behavior |

Accepted direction: admins own school rooms; teachers choose a school and room, with Custom fallback and no approval or manual class linking. PETHS rooms come from the service, not hardcoded UI.

Milestone review: reused existing native selects, dialog, poster and recovery controls; no new dashboard or approval state. The shared hook propagates the picker into Attendance schedules and the standalone dialog. Covered missing schools, legacy contracts, Custom reset, uncertain writes, stale classroom responses and partial Undo. All 2,317 focused tests, architecture/UI/design policy, TypeScript and lint passed with one worker; the production build passed. Production-server browser evidence covers PETHS → room 223 with Print student poster at desktop/mobile widths in light/dark themes.
