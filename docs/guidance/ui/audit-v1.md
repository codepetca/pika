# UI Guidance Audit v1

This audit records which existing sources already govern Pika UI work and which current screens were used to seed the first governed canon.

## Existing Governing Docs

- [`docs/ai-instructions.md`](/docs/ai-instructions.md)
  Defines the global read order, mandatory constraints, and AI workflow rules.
- [`docs/core/design.md`](/docs/core/design.md)
  Holds the durable UI invariants: mobile-first, accessibility, dark-mode support via semantic tokens, and classroom-route layout expectations.
- [`src/ui/README.md`](/src/ui/README.md)
  Documents the canonical primitive layer: `@/ui` imports, semantic tokens, `FormField`, `Card`, dialogs, and token usage.
- [`docs/workflow/handle-issue.md`](/docs/workflow/handle-issue.md) and [`docs/issue-worker.md`](/docs/issue-worker.md)
  Govern how issue work is planned and executed, including the UI verification requirement after actual UI changes.

## Current Seed Surfaces

The v1 canon is grounded in these current code surfaces:

- Shared shell:
  - [`src/components/AppShell.tsx`](/src/components/AppShell.tsx)
  - [`src/components/layout/ThreePanelShell.tsx`](/src/components/layout/ThreePanelShell.tsx)
  - [`src/app/classrooms/[classroomId]/ClassroomPageClient.tsx`](/src/app/classrooms/[classroomId]/ClassroomPageClient.tsx)
- Attendance:
  - [`src/app/classrooms/[classroomId]/TeacherAttendanceTab.tsx`](/src/app/classrooms/[classroomId]/TeacherAttendanceTab.tsx)
- Assignments:
  - [`src/app/classrooms/[classroomId]/StudentAssignmentsTab.tsx`](/src/app/classrooms/[classroomId]/StudentAssignmentsTab.tsx)
  - [`src/app/classrooms/[classroomId]/TeacherClassroomView.tsx`](/src/app/classrooms/[classroomId]/TeacherClassroomView.tsx)
  - [`src/components/AssignmentModal.tsx`](/src/components/AssignmentModal.tsx)
  - [`src/components/AssignmentForm.tsx`](/src/components/AssignmentForm.tsx)

## What Was Already Strong

- Semantic color tokens and theme handling are already explicit in docs and widely used in app code.
- `@/ui` is already the canonical primitive layer for buttons, inputs, dialogs, cards, tooltips, and field chrome.
- The classroom experience already has a shared shell model with left navigation, main content, and optional right-side inspection.
- Attendance and assignments already encode several strong product behaviors, such as presence-only attendance status and visible assignment autosave/submission states.

## What Was Missing

- No single UI canon separated stable patterns from candidate patterns.
- No explicit place for legacy patterns that still exist in code or docs.
- No workflow requirement for AI to declare whether it is following stable guidance or introducing a new candidate pattern.
- No lightweight script to generate reviewable experimental guidance from changed files or a diff base.

## Conclusion

The repo already had solid UI rules, but they were split across architecture, design, primitive docs, and live code. This v1 canon adds governance and a promotion path without replacing those foundations.
