# Stable UI Guidance

These are the stable UI rules for the v1 governed slice: assignments, attendance, and the classroom shell that supports them.

Use these by default for new work.

## Stable Rules

### 1. App code uses semantic tokens, not raw theme switching

- Use semantic surface, border, and text tokens in app code.
- Keep `dark:` classes inside `src/ui/` or other documented exceptions only.
- Favor tokens such as `bg-page`, `bg-surface`, `bg-surface-panel`, `border-border`, `border-border-strong`, `text-text-default`, and `text-text-muted`.

Source grounding:

- [`docs/core/design.md`](/docs/core/design.md)
- [`src/ui/README.md`](/src/ui/README.md)
- Current classroom surfaces use these tokens heavily.

### 2. Base controls come from `@/ui`

- Import primitives from `@/ui`, not from feature-local component paths.
- Wrap labeled form controls in `FormField`.
- Reuse `Button`, `Card`, dialogs, and other primitives before inventing feature-local base controls.

Source grounding:

- [`src/ui/README.md`](/src/ui/README.md)
- [`docs/core/design.md`](/docs/core/design.md)
- [`src/components/AssignmentForm.tsx`](/src/components/AssignmentForm.tsx)

### 3. Classroom pages preserve the shared shell

- Classroom work stays inside the shared classroom shell rather than inventing standalone page layouts.
- Keep left navigation for tab switching, main content for the active workflow, and right-side inspection/detail behavior where the route already supports it.
- On desktop, the shell remains a three-panel grid. On mobile, side panels collapse into drawer behavior rather than creating a separate information architecture.

Source grounding:

- [`docs/core/design.md`](/docs/core/design.md)
- [`src/components/layout/ThreePanelShell.tsx`](/src/components/layout/ThreePanelShell.tsx)
- [`src/app/classrooms/[classroomId]/ClassroomPageClient.tsx`](/src/app/classrooms/[classroomId]/ClassroomPageClient.tsx)

### 4. Attendance stays presence-first and scan-friendly

- Attendance UI is optimized for quick scanning and teacher drill-down, not extra status taxonomy.
- Present and absent remain the primary user-facing states.
- Use a sortable teacher matrix/table view with clear date movement and lightweight summary counts.
- Detailed log content belongs in secondary inspection, not inside each row.

Source grounding:

- [`docs/core/design.md`](/docs/core/design.md)
- [`docs/core/architecture.md`](/docs/core/architecture.md)
- [`src/app/classrooms/[classroomId]/TeacherAttendanceTab.tsx`](/src/app/classrooms/[classroomId]/TeacherAttendanceTab.tsx)

### 5. Assignment surfaces expose status, due date, and save state clearly

- Assignment list items should surface title, due date, and concise status without requiring expansion first.
- Student editing surfaces must make autosave and submit state obvious.
- Submission controls remain explicit primary actions rather than hidden behind menus.
- Teacher assignment views keep student status and work inspection adjacent to the assignment context.

Source grounding:

- [`docs/core/design.md`](/docs/core/design.md)
- [`src/app/classrooms/[classroomId]/StudentAssignmentsTab.tsx`](/src/app/classrooms/[classroomId]/StudentAssignmentsTab.tsx)
- [`src/app/classrooms/[classroomId]/TeacherClassroomView.tsx`](/src/app/classrooms/[classroomId]/TeacherClassroomView.tsx)
- [`src/components/AssignmentModal.tsx`](/src/components/AssignmentModal.tsx)

### 6. Toronto date language stays consistent across classroom workflows

- Use the existing Toronto-aware date helpers and the established app language for dates.
- Prefer predictable classroom-facing date labels instead of one-off formatting.
- Date presentation should feel consistent across attendance navigation, assignment due labels, and classroom-level scheduling affordances.

Source grounding:

- [`docs/core/design.md`](/docs/core/design.md)
- [`docs/core/architecture.md`](/docs/core/architecture.md)
- Current attendance and assignment surfaces already rely on Toronto-aware helpers.

## Stable Guidance Limits

- This file is intentionally narrow. It does not try to canonize the entire app.
- If a current pattern exists in code but is not listed here, do not assume it is stable.
- Use an experimental draft when you want to propose reuse beyond the current stable rules.
