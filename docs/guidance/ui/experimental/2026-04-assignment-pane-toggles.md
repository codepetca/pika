---
status: experimental
scope:
  - teacher-assignments
  - teacher-work-surface
source_files:
  - src/app/classrooms/[classroomId]/TeacherClassroomView.tsx
  - src/components/TeacherStudentWorkPanel.tsx
human_review_required: true
generated_at: 2026-04-30
---

# Assignment Pane Toggles

## Summary

Teacher assignments now pilot an untabbed selected-assignment workspace. Instead
of a top `Class` / `Individual` tab strip, the action-bar center owns an
icon-only class/individual toggle beside the assignment batch action split
button. The left pane switches between class table and individual work, while
the right pane remains the grading panel.

## Pattern

- Keep the assignment action bar for assignment context, status, edit mode, the
  class/individual view switch, and batch actions.
- Use icon-only class/individual controls to keep the action cluster compact.
- Keep the student-work controller shared across the split so history preview
  and grading state update the visible work pane.
- Keep the right pane fixed on grading so the selected student's work and rubric
  can be compared side by side.
- Keep batch actions in the global selected-assignment action bar.

## Why Experimental

This has only been applied to teacher assignments. It should guide tests and
quizzes exploration, but it is not yet stable family guidance until the
assignment screenshots and teacher workflow are accepted.

## Promotion Criteria

- Assignment workspace screenshots pass visual review on desktop and mobile.
- Teachers can quickly discover the icon-only view toggle without losing class
  batch actions.
- The pattern works for at least one of teacher tests or quizzes without
  importing assignment-specific components or controller logic.
