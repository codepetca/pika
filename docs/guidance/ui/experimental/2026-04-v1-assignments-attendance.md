---
status: experimental
scope:
  - assignments
  - attendance
  - shared-shell
source_files:
  - src/app/classrooms/[classroomId]/StudentAssignmentsTab.tsx
  - src/app/classrooms/[classroomId]/TeacherClassroomView.tsx
  - src/app/classrooms/[classroomId]/TeacherAttendanceTab.tsx
  - src/components/AssignmentModal.tsx
  - src/ui/Page.tsx
  - src/components/DataTable.tsx
human_review_required: true
generated_at: 2026-04-14
---

# v1 Candidate Guidance: Assignments + Attendance

## Summary

The page-scaffolding portion of this candidate is now promoted into stable guidance. Dense tables,
assignment cards, and adjacent inspection remain experimental workflow patterns.

## Promoted Guidance

`PageLayout`, `PageHeading`, `PageActionBar`, `PageContent`, and `PageStack` are canonical in
[`src/ui/Page.tsx`](/src/ui/Page.tsx). Follow
[`stable.md`](/docs/guidance/ui/stable.md) for new work. The compatibility export at
`src/components/PageLayout.tsx` is not a separate feature-owned contract.

## Affected Screens / Files

- Student assignment summary and editor flow
- Teacher assignment list and grading/work inspection flow
- Teacher attendance table and date navigation flow
- Shared action-bar and table scaffolding used by those routes

## Observed Pattern

- Feature-level pages use the canonical `@/ui` page primitives to keep controls and content aligned inside the classroom shell.
- Dense, interactive list or table surfaces use feature-owned components such as `DataTable` and `TableCard` rather than a primitive from `@/ui`.
- Student assignments use large pressable cards with title, due date, relative due text, and a compact status badge.
- Teacher assignment and attendance views favor side-by-side inspection rather than modal-heavy drill-down once the user is already inside the workflow.

## Proposed Guidance

- Use the stable `@/ui` page contract for page-level composition while preserving the shared classroom shell.
- Consider dense feature-owned tables and list cards acceptable for high-information classroom workflows, but treat them as workflow-level patterns rather than primitive-level truth.
- Prefer visible status cues and adjacent detail inspection over hidden state or multi-step reveal in attendance and assignments.

## Why This Is Experimental

- Dense tables, assignment cards, and adjacent inspection are strong inside assignments and attendance, but they have not yet been validated across enough other classroom tabs.
- The repo has not yet decided whether those workflow patterns should remain local or become broader defaults.

## Human Review Required

- Decide whether `DataTable` should remain a feature-owned composition helper or become promoted shared guidance.
- Decide whether the pressable assignment-card pattern should become a wider classroom-list standard.
- Confirm that these dense layouts remain strong on smaller screens before promotion.

## Promotion Criteria

- Reused successfully in additional classroom workflows
- No major usability regressions in teacher or student views
- Consistent with stable token and `@/ui` usage
- Explicit human approval to move the pattern into `stable.md`
