---
status: implemented
approved_reference: Pattern Lab teacher Daily QR check-in and Manual attendance fixtures
approved_by: user
approved_on: 2026-09-01
---

# Daily Attendance Production Adoption

- Surface: teacher classroom Daily tab, Attendance time dialog, More actions,
  and attendance table.
- Reference: `DailyMockup`, the stable teacher operational-table guidance, and
  the existing production `TeacherAttendanceTab` data owners.
- Affected roles: teacher. Student is regression-only because the page shell is
  shared but student attendance UI is unchanged.
- Viewports/themes: desktop and mobile, light and dark.
- States: QR open/closed/unavailable, Manual Attendance from log on/off,
  no time/time set, menu and dialogs open, manual override/undo, loading/error.
- Primary signal: one compact date plus equal-height joined QR/time cluster and
  tight far-right attendance status controls.
- Must not add: row selection, a selected-student actions menu, duplicate
  open/close controls, log completion circles, or QR evidence in Manual mode.
- Composite widget accessibility review: yes; the joined action group, menu,
  segmented end-day choice, status buttons, sticky table controls, dialogs, and
  tooltips retain named 44px targets and keyboard/focus behavior.

| Need | Existing candidate | Decision | Reason |
|---|---|---|---|
| Daily action hierarchy | `TeacherWorkSurfaceContextBar`, `DateNavigator` | reuse | Preserve stable centered scope and subtle trailing utilities |
| Joined QR/time actions | `IconButton`, `Button` | extend | Daily-specific composition, shared accessible controls |
| Status marking and sorting | `DataTable`, `AttendanceStatusSortChip` | extend | Preserve table semantics while splitting statuses into fixed far-right columns |
| Class-wide commands | Teacher work-surface More actions, `ContentDialog` | reuse | Remove row-selection dependency without creating a new menu primitive |
| Manual persistence | Existing teacher API ownership, `classrooms`, `classroom_enrollments`, and Pika log data | extend | Store settings and date-keyed marks on archive-owned rows; revision-check settings and update roster marks atomically |
| Timing rules | `AttendanceWindowDialog`, `SegmentedControl`, `FormField` | extend | Reuse the production policy editor with approved defaults, clamps, and copy |

Verification matrix: teacher and student; desktop and mobile; light and dark;
default, QR open/closed, Manual log/manual, menu, time dialog, batch dialog,
override/undo, no-time, loading, and migration-required error.
