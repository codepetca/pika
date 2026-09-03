# Classroom page mockups

Status: experimental. These development-only proposals need human acceptance
before any live-page adoption. Risk profile: none (fixture-only UI; no live data writes).
Independent review risk: standard, covering prototype interaction state.

The Classrooms list menu/navigation was accepted on 2026-09-03 for
[scoped live adoption](../classrooms-live-adoption.md). Real classroom cards and
archive lifecycle operations remain feature-owned; unrelated mockups are not promoted.

The Gradebook composition was accepted by the maintainer on 2026-09-02 for
[scoped live adoption](../gradebook-live-adoption.md). Its category and assessment
editors share feature-owned components with the live page; Pattern Lab still uses
fixture-only save callbacks. The surrounding full-page compositions remain experimental.

## Brief

- Surface: `/pattern-lab#page-mockups`; teacher Daily, Classrooms, Gradebook,
  Calendar, Announcements, Roster, Settings, and the shared Classwork/Tests
  workspace progression; student Today, Classwork, Tests, Calendar,
  Announcements, and Resources.
- References: Pattern Lab core page actions and teacher date context;
  Attendance table density; selected Test grading selection/action hierarchy.
- Roles: teacher and student. The sticky Pattern Lab navigator owns the role
  switch; each role receives its own tabs and deterministic fixtures.
- Viewports/themes: desktop 1440×900 and mobile 390×844, light and dark.
- States: populated, no gradebook categories, loading, empty, error/retry, sorted, selected, open menu,
  keyboard focus, preview dialog, gradebook-category setup, assessment details,
  calendar view/range, announcement filter, settings section/save/confirmation,
  Daily session toggling, batch attendance
  dialog, per-student manual marking/undo, QR reset, student list
  actions, and summary/workspace/inspector.
- Primary signal: stable centered scope/actions; quiet context left; ghost
  ellipsis utilities right. Daily joins its QR action and attendance time beside
  the date for QR check-in mode, while Manual mode keeps a passive time control
  and omits QR evidence. Class-wide attendance commands remain in More actions.
- Exclusions: live APIs, persistent preferences, real email/clipboard writes,
  live grading writes from Pattern Lab, enrollment changes, publishing, new
  dependencies, and promotion of unrelated experimental compositions.
- Composite checklist: required for tabs, menus, view selectors and dialogs.

| Need | Existing candidate | Decision | Reason |
|---|---|---|---|
| Page controls | PageActionBar, TeacherWorkSurfaceContextBar | reuse | Stable center and edge responsibilities |
| Menus/selection | TeacherWorkSurface action menus | reuse | Named, keyboard-accessible scope actions |
| Dates/views/role | DateNavigator, SegmentedControl | reuse | Existing scope, display, and keyboard contracts |
| Daily attendance modes | Pattern Lab fixture selector, IconButton, Button, and local joined geometry | extend | Compare QR check-in and Manual fixtures while preserving governed control contracts without promoting an experimental Daily-only composition |
| Tables | DataTable, SortableHeaderCell, TeacherWorkSurfaceTableFrame | reuse | Density, sticky header and sorting semantics |
| States/overlays | PageState, ContentDialog, IconButton | reuse | Standard feedback, focus return and targets |
| Gradebook setup | ContentDialog, FormField, Input, IconButton, DnD Kit | create | Fixture-owned table-card experiment leaves the production editor unchanged during review |
| Gradebook inline weight editing | FormField, Input, live integer-weight validation contract | extend | A fixture-local wrapper keeps invalid drafts out of calculations and restores the last valid value on blur; no new shared primitive |
| Calendar/content | LessonCalendar, AnnouncementContent | reuse | Real feature-owned renderers with local fixtures |
| Review surface | Pattern Lab catalog and gallery | extend | Page-level experiments without new production owners |

## Source audit and proposed composition

| Page | Current evidence | Proposal |
|---|---|---|
| Gradebook | TeacherGradebookTab replaces score-display button with email on selection; settings menu shares center | Keep Student Actions, %/x/y, AVG/MED, and one Lucide Dumbbell weight toggle in the centered action cluster with ellipsis actions right. Student Actions offers Copy emails and Copy secondary emails, with a compact mobile trigger outside the scrolling display controls so the menu is never clipped. Frozen cells use opaque surfaces; the pinned AVG/MED row has one quiet top divider. Edit categories demonstrates table-card rows with whole/half-point Course percentages, read-only amber locks, top-to-bottom unlocked balancing, keyboard/pointer drag handles, one default, internal new-category item weight 10, and a Gradebook-only no-categories example. Show weights reveals two non-sticky metadata rows beneath the header: editable Category weight and calculated Course weight, with pinned labels in the first identity column. Inline weights accept integers 1–999, retain valid calculations during invalid edits, and restore the last valid value on blur. Assessment titles open a compact single-column editor for title, Category/None, Category weight, and read-only Course weight. Changing category preserves the item weight; deleting its category moves an assessment to None. Retain row preview. |
| Daily | TeacherAttendanceTab and AttendanceWindowDialog own date, QR/session commands, timing policy, log completion, scan-time evidence, and attendance status | Add a Pattern Lab Attendance mode selector. QR check-in puts the date beside an equal-height joined QR-icon/time control; QR is disabled unless attendance is open, while the clickable time area carries a subtle semantic green open state. Its time editor always shows the production timing-rule fields without an Advanced disclosure or cutoff blurb. The Grace field is labeled `Grace period before late (min)`; defaults are 10 minutes open, 5 minutes grace, 0 minutes close, and 0 minutes Absent. QR-open minutes hard-clamp to 0–120; grace, QR-close, and Absent minutes hard-clamp to 0–the calculated session duration, including the selected Same class day / Next day boundary. The end-day choice remains a segmented toggle with option-specific day-boundary tooltips, followed by `Open and close QR attendance automatically`, enabled by default. Manual removes those automatic settings along with the QR action, Time of scan column, open/close command, and QR reset while keeping the optional time neutral and editable. Its More menu has one off-by-default Attendance from log checkbox; checking it makes completed logs supply the automatic Present baseline, while unchecked means teacher-only marking. A configured passive time uses the full `9:00 - 10:00 AM` form at every viewport. In both modes, clearing time retains only the clock icon; Edit time and class-wide Edit attendance remain in More actions, and the batch editor relies on its action labels without explanatory instructions. Remove row selection, keep the compact Present/Late/Absent plus conditional undo group sticky at the far right, and show undo only when a manual mark overrides the automatic baseline. Count tooltips use compact `2 Present` language; the active sort adds a chevron inside the existing count pill without widening its 44px column. Row undo keeps the student-specific accessible name with the concise `Undo manual change` tooltip. Keep fixed rows and no attendance API |
| Calendar | CalendarActionBar nests a context bar in PageActionBar; date, Week/Month/All and edit controls share one wrapping cluster | Date remains centered; use Week/Month/Term and Markdown in the right menu, where Term means the configured classroom date range; preserve real calendar rendering and selected date content |
| Announcements | TeacherAnnouncementsSection already has centered + and right ellipsis, but duplicates creation in menu | Preserve +; demonstrate All/Posted/Scheduled filter in menu, reading cards and contextual Eye preview; no operational status-count table |
| Roster | TeacherRosterTab has + Students and settings in center, selected email/removal commands mixed into global menu | Icon-only +, persistent selection menu, CSV import in right ellipsis; separate sortable names, quiet joined/not-joined text and contextual details |
| Settings | TeacherSettingsTab uses section navigation, local field saves, feature switches, and guarded access changes | Keep one section visible at a time; show save feedback without a global submit bar; retain confirmation for join-code replacement |
| Classwork/Tests workspaces | TeacherClassroomView and TeacherTestsTab share the formal summary-to-workspace ladder and activate inspectors only after selection | Compare both families with one deterministic list → selected item → student inspector fixture while preserving family-owned labels and statuses; keep only Create in the centered summary cluster and place Organize once in More actions |
| Student classroom pages | Student Today, Assignments, Tests, Calendar, Announcements, and Resources have separate production owners | Expose a role-appropriate local set using their existing cards, status labels, date controls, content renderer, and resource actions; do not reuse teacher-only operational controls |

Gradebook student scores remain explicit examples. Category setup uses the live
calculation contract: Attendance 10%, Term 65% and Final 25%, with Term as the
default; assessment weights distribute their category's course percentage.
The Few assessments example shows three columns from the same fixture course;
hidden assessments remain in category-weight denominators and title validation.
Calendar uses a fixed Semester 1 range from September 2026 through January 2027. Demo controls change local
state only. Any unavailable live workflow opens an explicitly labeled explanation,
never a fake success message. Announcement filters are proposed, not existing
production behavior.

Nearby refactor candidates: CalendarActionBar's nested bars; Gradebook/Roster
selection menus and settings icons. Do not refactor those owners in this change.
Adopt a page only after its proposal is accepted and live data/state handling is
verified independently.
