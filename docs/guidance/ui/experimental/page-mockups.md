# Classroom page mockups

Status: experimental. These development-only proposals need human acceptance
before any live-page adoption. Risk profile: none (fixture-only UI).

## Brief

- Surface: `/pattern-lab#page-mockups`, Gradebook, Calendar, Announcements,
  Roster, Settings, and the shared Classwork/Tests workspace progression.
- References: Pattern Lab core page actions and teacher date context;
  Attendance table density; selected Test grading selection/action hierarchy.
- Roles: teacher. Student gallery is checked for exclusion/regression; no student
  product surface changes.
- Viewports/themes: desktop 1440×900 and mobile 390×844, light and dark.
- States: populated, loading, empty, error/retry, sorted, selected, open menu,
  keyboard focus, preview dialog, calendar view/range, announcement filter,
  settings section/save/confirmation, and summary/workspace/inspector.
- Primary signal: stable centered scope/actions; quiet context left; ellipsis
  utilities right. Table selection never replaces global controls.
- Exclusions: live APIs, persistent preferences, real email/clipboard writes,
  grading changes, enrollment changes, publishing, new dependencies, promotion
  of experimental compositions, Attendance/Term Work/Final grade calculations.
- Composite checklist: required for tabs, menus, view selectors and dialogs.

| Need | Existing candidate | Decision | Reason |
|---|---|---|---|
| Page controls | PageActionBar, TeacherWorkSurfaceContextBar | reuse | Stable center and edge responsibilities |
| Menus/selection | TeacherWorkSurface action menus | reuse | Named, keyboard-accessible scope actions |
| Dates/views | DateNavigator, SegmentedControl | reuse | Existing scope and display contracts |
| Tables | DataTable, SortableHeaderCell, TeacherWorkSurfaceTableFrame | reuse | Density, sticky header and sorting semantics |
| States/overlays | PageState, ContentDialog, IconButton | reuse | Standard feedback, focus return and targets |
| Calendar/content | LessonCalendar, AnnouncementContent | reuse | Real feature-owned renderers with local fixtures |
| Review surface | Pattern Lab catalog and gallery | extend | Page-level experiments without new production owners |

## Source audit and proposed composition

| Page | Current evidence | Proposal |
|---|---|---|
| Gradebook | TeacherGradebookTab replaces score-display button with email on selection; settings menu shares center | Keep %/Raw stable, persistent disabled-until-selected student menu, ellipsis right; table scores and missing-work indicators; row preview |
| Calendar | CalendarActionBar nests a context bar in PageActionBar; date, Week/Month/All and edit controls share one wrapping cluster | Date remains centered; use Week/Month/Year and Markdown in the right menu; preserve real calendar rendering and selected date content |
| Announcements | TeacherAnnouncementsSection already has centered + and right ellipsis, but duplicates creation in menu | Preserve +; demonstrate All/Posted/Scheduled filter in menu, reading cards and contextual Eye preview; no operational status-count table |
| Roster | TeacherRosterTab has + Students and settings in center, selected email/removal commands mixed into global menu | Icon-only +, persistent selection menu, CSV import in right ellipsis; separate sortable names, quiet joined/not-joined text and contextual details |
| Settings | TeacherSettingsTab uses section navigation, local field saves, feature switches, and guarded access changes | Keep one section visible at a time; show save feedback without a global submit bar; retain confirmation for join-code replacement |
| Classwork/Tests workspaces | TeacherClassroomView and TeacherTestsTab share the formal summary-to-workspace ladder and activate inspectors only after selection | Compare both families with one deterministic list → selected item → student inspector fixture while preserving family-owned labels and statuses |

Gradebook score values are explicit example values, never a new calculation rule.
Calendar uses a fixed September 2026 teaching range. Demo controls change local
state only. Any unavailable live workflow opens an explicitly labeled explanation,
never a fake success message. Announcement filters are proposed, not existing
production behavior.

Nearby refactor candidates: CalendarActionBar's nested bars; Gradebook/Roster
selection menus and settings icons. Do not refactor those owners in this change.
Adopt a page only after its proposal is accepted and live data/state handling is
verified independently.
