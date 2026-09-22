---
status: experimental
scope: paired teacher and student grade visibility
source_files:
  - src/app/__ui/PageMockups.tsx
  - src/app/__ui/StudentGradesPattern.tsx
  - src/app/__ui/StudentPageMockups.tsx
  - src/components/settings/SettingsSwitchRow.tsx
  - src/app/classrooms/[classroomId]/TeacherSettingsTab.tsx
  - src/app/classrooms/[classroomId]/TeacherGradebookTab.tsx
  - src/components/StudentAssignmentEditor.tsx
  - src/components/StudentTestResults.tsx
  - src/components/gradebook/StudentReturnedMarks.tsx
  - src/components/gradebook/StudentGradesView.tsx
  - src/components/gradebook/TeacherGradebookVisibilityControl.tsx
human_review_required: true
---

# Student Grades Visibility

This Pattern Lab composition visualizes the approved minimal product contract
in [`docs/guidance/student-grades.md`](../../student-grades.md). It is evidence
for review, not authorization to expose production grade data.

## UI change brief

- **Surface:** development-only teacher Gradebook visibility control, student
  Classroom Grades tab, and paired visibility-state comparison.
- **Reference:** the approved teacher Gradebook action bar, `IconButton`, and the returned
  score treatments in student Classwork and Tests.
- **Affected roles:** teacher and student.
- **Required viewports:** desktop and mobile.
- **Required themes:** light and dark.
- **Key states:** grades shown and grades hidden; action hover, focus, and saving.
- **Primary signal:** the teacher's eye/eye-off visibility action and the
  student's `Current grade` value.
- **Must not add:** charts, trends, ranks, projections, reporting, attendance,
  category dashboards, or additional publication controls.
- **Composite widget accessibility review:** reviewed. The only interactive
  product control is one semantic pressed-state button; its name, pressed state,
  keyboard behavior, concise action tooltip, visible focus treatment, and 44px target are covered.

## Ownership decisions

| Need | Existing candidate | Decision | Reason |
|---|---|---|---|
| Teacher visibility control | Gradebook action bar and `IconButton` | extend | The feature-owned control uses Eye/EyeOff beside More actions, with a stable accessible name and a concise show/hide tooltip. |
| Student content framing | `Card` and the stable student content rhythm | reuse | The view is a calm reading surface, not a teacher operational table. |
| Returned assessment rows | Existing Classwork and Test result language | create | The feature-owned production view is shared by the student Classroom tab and deterministic Pattern Lab fixture. |
| Shown/hidden comparison | Pattern Lab fixture state | create | Deterministic review behavior belongs to the development-only gallery. |

No new shared primitive is proposed.

## Review questions

1. Does the teacher control read as visibility rather than snapshot
   publication?
2. Can a student understand the current grade and reconcile it with the three
   returned examples without more explanation?
3. Does `Not counted` make the excluded example clear without introducing a
   second status system?
4. When hidden, is it clear that only the aggregate Grades area disappears and
   returned feedback remains with the original work?

## Promotion status

The approved composition has been promoted to production owners. The student
API projects only returned work after classroom-scoped authorization, and the
persisted classroom visibility setting defaults off. Pattern Lab remains the
place to compare shown and hidden states without live data.

The Classroom page patterns now show the approved placement in context. The
teacher Gradebook action defaults off. The student page set includes the
enabled-state Grades tab so reviewers can inspect its complete layout. These
fixtures remain deterministic; production navigation is controlled separately
by the persisted `student_grades` preference.

## Standalone marks integration

The standalone Gradebook feature adds a bounded returned-marks list within the
existing student Classwork summary and the live aggregate Grades projection.
Pattern Lab renders the production
`StudentReturnedMarksList` owner with deterministic counted, zero, and excluded
fixtures, without API reads. This remains experimental composition evidence;
the production aggregate surface remains governed by the stable product contract.

The list reuses `Card` and the returned-row score treatment. Its primary signal
is each item's score and percentage. The feature introduces no links to fake
work, no navigation, no aggregate, and no composite widget. Verification covers
student desktop/mobile and light/dark, returned/zero/excluded/loading/error/empty
states, and tab reactivation. Teacher return controls are covered in the feature
brief. The endpoint scopes release, enrollment, classroom, archive status, and
Classwork visibility server-side; the browser receives only returned marks.
