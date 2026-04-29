---
status: experimental
scope:
  - teacher-assignments
  - teacher-work-surface
  - shared-shell
source_files:
  - src/app/classrooms/[classroomId]/TeacherClassroomView.tsx
  - src/app/classrooms/[classroomId]/ClassroomPageClient.tsx
  - src/components/SortableAssignmentCard.tsx
  - src/components/TeacherStudentWorkPanel.tsx
  - src/components/assignment-workspace/TeacherWorkInspector.tsx
  - src/components/assignment-workspace/useTeacherStudentWorkController.ts
  - src/components/teacher-work-surface/TeacherEditModeControls.tsx
human_review_required: true
generated_at: 2026-04-28
---

# Teacher Edit-Mode Controls

## Summary

Teacher assignments now pilot a temporary edit mode for work surfaces. The default surface stays workflow-first: create, navigation, grading, review, save, return, and status controls remain visible. Destructive, reorder, and source-edit affordances are revealed only after the teacher enables edit mode.

## Pattern

- Put the edit toggle in the teacher work-surface action bar `trailing` slot.
- Keep edit mode local to the current tab or workspace state. Do not persist it.
- Reset edit mode when the teacher leaves the tab or switches assignment workspaces.
- Use edit-only action children only when a feature needs extra explicit commands. In the assignments pilot, the existing bulk markdown sidebar opens automatically when summary edit mode starts, so there is no separate `Code` action in the assignment list.
- Keep feature behavior inside the feature. The shared control owns only placement, active styling, disabled state, labels, and the edit-only action group.

## Assignments Pilot Rules

- Normal assignment summary cards hide drag handles and delete.
- Normal assignment summary cards open the assignment workspace when possible.
- Draft and scheduled assignment cards continue to open the assignment editor in normal mode.
- Edit-mode assignment summary cards show drag handles and delete, and the card click opens the assignment editor.
- Edit-mode assignment summary opens the existing bulk markdown sidebar by default as the right-side split pane.
- Selected assignment workspaces keep grading and return actions visible. Secondary workflow actions such as `Return` may live in the centered split-button menu when that keeps the action bar calmer.
- The title edit affordance appears only while edit mode is active.
- Inspector card visibility controls are edit-mode-only. Hidden inspector cards stay visible as unchecked card headers in edit mode so teachers can re-show them, and are removed from normal mode.

## Why Experimental

This has only been applied to teacher assignments. Other teacher classroom tabs should not adopt it automatically until the assignments screenshots, behavior, and tests have been reviewed.

## Promotion Criteria

- Assignment pilot is accepted after visual review on desktop and mobile.
- Teachers can discover edit mode without losing access to primary workflows.
- The pattern works for at least one more teacher tab without feature-specific leakage into the shared shell.
- Human review approves promotion into stable teacher work-surface guidance.
