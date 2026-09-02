# Classroom page mockups

Status: experimental. These development-only proposals need human acceptance
before any live-page adoption. Risk profile: none (fixture-only UI).

The Gradebook category editor and assessment-details dialog mirror their
production components. The surrounding full-page compositions remain
experimental.

## Brief

- Surface: `/pattern-lab#page-mockups`, Gradebook, Calendar, Announcements,
  Roster, Settings, and the shared Classwork/Tests workspace progression.
- References: Pattern Lab core page actions and teacher date context;
  Attendance table density; selected Test grading selection/action hierarchy.
- Roles: teacher. Student gallery is checked for exclusion/regression; no student
  product surface changes.
- Viewports/themes: desktop 1440×900 and mobile 390×844, light and dark.
- States: populated, loading, empty, error/retry, sorted, selected, open menu,
  keyboard focus, preview dialog, gradebook-category setup, assessment details,
  calendar view/range, announcement filter, settings section/save/confirmation,
  and summary/workspace/inspector.
- Primary signal: stable centered scope/actions; quiet context left; ellipsis
  utilities right. Table selection never replaces global controls.
- Exclusions: live APIs, persistent preferences, real email/clipboard writes,
  live grading writes from Pattern Lab, enrollment changes, publishing, new
  dependencies, and promotion of unrelated experimental compositions.
- Composite checklist: required for tabs, menus, view selectors and dialogs.

| Need | Existing candidate | Decision | Reason |
|---|---|---|---|
| Page controls | PageActionBar, TeacherWorkSurfaceContextBar | reuse | Stable center and edge responsibilities |
| Menus/selection | TeacherWorkSurface action menus | reuse | Named, keyboard-accessible scope actions |
| Dates/views | DateNavigator, SegmentedControl | reuse | Existing scope and display contracts |
| Tables | DataTable, SortableHeaderCell, TeacherWorkSurfaceTableFrame | reuse | Density, sticky header and sorting semantics |
| States/overlays | PageState, ContentDialog, IconButton | reuse | Standard feedback, focus return and targets |
| Gradebook setup | ContentDialog, FormField, Input, Select, Button | extend | One feature-owned editor is shared by Pattern Lab and the live gradebook |
| Calendar/content | LessonCalendar, AnnouncementContent | reuse | Real feature-owned renderers with local fixtures |
| Review surface | Pattern Lab catalog and gallery | extend | Page-level experiments without new production owners |

## Source audit and proposed composition

| Page | Current evidence | Proposal |
|---|---|---|
| Gradebook | TeacherGradebookTab replaces score-display button with email on selection; settings menu shares center | Keep %/Raw stable, persistent disabled-until-selected student menu, ellipsis right; add Edit gradebook for category percentages/defaults; assessment titles open category, item-weight, and exact-course-weight details; retain row preview |
| Calendar | CalendarActionBar nests a context bar in PageActionBar; date, Week/Month/All and edit controls share one wrapping cluster | Date remains centered; use Week/Month/Term and Markdown in the right menu, where Term means the configured classroom date range; preserve real calendar rendering and selected date content |
| Announcements | TeacherAnnouncementsSection already has centered + and right ellipsis, but duplicates creation in menu | Preserve +; demonstrate All/Posted/Scheduled filter in menu, reading cards and contextual Eye preview; no operational status-count table |
| Roster | TeacherRosterTab has + Students and settings in center, selected email/removal commands mixed into global menu | Icon-only +, persistent selection menu, CSV import in right ellipsis; separate sortable names, quiet joined/not-joined text and contextual details |
| Settings | TeacherSettingsTab uses section navigation, local field saves, feature switches, and guarded access changes | Keep one section visible at a time; show save feedback without a global submit bar; retain confirmation for join-code replacement |
| Classwork/Tests workspaces | TeacherClassroomView and TeacherTestsTab share the formal summary-to-workspace ladder and activate inspectors only after selection | Compare both families with one deterministic list → selected item → student inspector fixture while preserving family-owned labels and statuses |

Gradebook student scores remain explicit examples. Category setup uses the live
calculation contract: Attendance 10%, Term 65% and Final 25%, with Term as the
default; assessment weights distribute their category's course percentage.
Calendar uses a fixed Semester 1 range from September 2026 through January 2027. Demo controls change local
state only. Any unavailable live workflow opens an explicitly labeled explanation,
never a fake success message. Announcement filters are proposed, not existing
production behavior.

Nearby refactor candidates: CalendarActionBar's nested bars; Gradebook/Roster
selection menus and settings icons. Do not refactor those owners in this change.
Adopt a page only after its proposal is accepted and live data/state handling is
verified independently.
