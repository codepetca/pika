---
status: experimental
scope: paired teacher and student grade visibility
source_files:
  - src/app/__ui/StudentGradesPattern.tsx
  - src/components/settings/SettingsSwitchRow.tsx
  - src/app/classrooms/[classroomId]/TeacherSettingsTab.tsx
  - src/app/classrooms/[classroomId]/TeacherGradebookTab.tsx
  - src/components/StudentAssignmentEditor.tsx
  - src/components/StudentTestResults.tsx
human_review_required: true
---

# Student Grades Visibility

This Pattern Lab composition visualizes the approved minimal product contract
in [`docs/guidance/student-grades.md`](../../student-grades.md). It is evidence
for review, not authorization to expose production grade data.

## UI change brief

- **Surface:** development-only paired teacher visibility control and student
  Grades preview.
- **Reference:** `SettingsSwitchRow`, the teacher Gradebook, and the returned
  score treatments in student Classwork and Tests.
- **Affected roles:** teacher and student.
- **Required viewports:** desktop and mobile.
- **Required themes:** light and dark.
- **Key states:** grades shown and grades hidden; switch hover and focus.
- **Primary signal:** the teacher's `Show grades to students` switch and the
  student's `Current grade` value.
- **Must not add:** charts, trends, ranks, projections, reporting, attendance,
  category dashboards, or additional publication controls.
- **Composite widget accessibility review:** reviewed. The only interactive
  product control is one semantic switch; its name, checked state, keyboard
  behavior, visible focus treatment, and 44px target are covered.

## Ownership decisions

| Need | Existing candidate | Decision | Reason |
|---|---|---|---|
| Teacher visibility control | `SettingsSwitchRow` | extend | Export and render the existing production owner without changing its visible track or semantics. |
| Student content framing | `Card` and the stable student content rhythm | reuse | The view is a calm reading surface, not a teacher operational table. |
| Returned assessment rows | Existing Classwork and Test result language | create | Keep the composition feature-owned until production behavior exists and converges. |
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

## Promotion boundary

Human acceptance of the Pattern Lab composition may guide a production change,
but the production feature still requires a returned-only student API,
classroom-scoped authorization, persisted visibility state, focused tests, and
the full teacher/student visual verification matrix.
