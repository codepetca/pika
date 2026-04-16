# Teacher Work-Surface Canon

This document is the stable canon for the teacher-side work-surface family:

- teacher assignments
- teacher quizzes
- teacher tests

It governs how those three tabs should feel, compose, and evolve. It does not govern:

- the main classroom shell
- unrelated teacher tabs such as attendance, roster, settings, gradebook, or calendar
- the student product

Assignments are the starting reference implementation for this family because they currently express the clearest summary-to-workspace flow. They are not permanent authority. If quizzes or tests produce a better pattern, this canon should be updated and assignments can then follow.

## Read Order

When a task touches teacher assignments, teacher quizzes, or teacher tests, read in this order:

1. [`docs/core/design.md`](/docs/core/design.md)
2. [`src/ui/README.md`](/src/ui/README.md)
3. [`docs/guidance/ui/stable.md`](/docs/guidance/ui/stable.md)
4. [`docs/guidance/ui/teacher-work-surfaces.md`](/docs/guidance/ui/teacher-work-surfaces.md)
5. [`docs/guidance/ui/audit-teacher-work-surfaces.md`](/docs/guidance/ui/audit-teacher-work-surfaces.md)
6. Relevant experimental or legacy guidance only if it materially affects the task

## Authority Model

- `stable.md` remains the source of truth for cross-cutting UI rules.
- This file is the source of truth for teacher assignments/quizzes/tests composition and taste.
- Experimental guidance may originate in assignments, quizzes, or tests.
- Nothing becomes stable for this family until this canon and the audit agree it is stable.

## Stable Rules

### 1. Teacher work surfaces begin in a quiet summary shell

- The default teacher state is a scan-friendly list or summary surface, not a tool-heavy workspace.
- The first visual emphasis belongs to the content list, not to toggles, segmented controls, or placeholder panels.
- Empty states should feel calm and singular: one primary surface, one clear action, minimal framing.

Current grounding:

- [`src/app/classrooms/[classroomId]/TeacherClassroomView.tsx`](/src/app/classrooms/[classroomId]/TeacherClassroomView.tsx)
- [`src/components/SortableAssignmentCard.tsx`](/src/components/SortableAssignmentCard.tsx)

### 2. Action bars stay stable, sparse, and subordinate to content

- Use the shared page-shell composition already present in teacher assignments: `PageLayout`, `PageActionBar`, `PageContent`, `PageStack`.
- The primary create/edit action may be prominent, but surrounding controls should remain restrained.
- Mode controls are allowed only when they unlock a materially different teacher workflow. They should not visually outrank the list itself.

Current grounding:

- [`src/components/PageLayout.tsx`](/src/components/PageLayout.tsx)
- [`src/app/classrooms/[classroomId]/TeacherClassroomView.tsx`](/src/app/classrooms/[classroomId]/TeacherClassroomView.tsx)
- [`src/app/classrooms/[classroomId]/TeacherQuizzesTab.tsx`](/src/app/classrooms/[classroomId]/TeacherQuizzesTab.tsx)

### 3. Card language stays compact, descriptive, and reusable

- Teacher work-item cards should surface the title, key status, time context, and the minimum metadata needed to decide what to open next.
- Metadata density should stay restrained. Avoid secondary badges, helper copy, or action clusters that make cards feel like mini dashboards.
- New shared card variants are acceptable only if assignments, quizzes, and tests converge on the same structure.

Current grounding:

- [`src/components/SortableAssignmentCard.tsx`](/src/components/SortableAssignmentCard.tsx)
- [`src/components/QuizCard.tsx`](/src/components/QuizCard.tsx)

### 4. Summary-to-detail progression should feel deliberate

- The teacher should move from summary to focused work only after a real selection or workflow transition.
- Passive browsing states should not reserve large empty detail panes purely to preserve structure.
- Split or inspector layouts are justified only when the teacher is actively reviewing work, grading, authoring in detail, or comparing primary content with contextual inspection.

Current grounding:

- [`src/app/classrooms/[classroomId]/TeacherClassroomView.tsx`](/src/app/classrooms/[classroomId]/TeacherClassroomView.tsx)
- [`src/components/TeacherStudentWorkPanel.tsx`](/src/components/TeacherStudentWorkPanel.tsx)
- [`src/app/classrooms/[classroomId]/ClassroomPageClient.tsx`](/src/app/classrooms/[classroomId]/ClassroomPageClient.tsx)

### 5. Split and resizable layouts are workspace tools, not default chrome

- A split workspace is appropriate when the teacher is actively working in both panes.
- A split workspace is not appropriate as a passive no-selection scaffold.
- Width, collapse, and resize behavior should be structural and reusable. Business logic must stay outside the shared layout primitive.
- The first extraction target for this family is a reusable teacher workspace split derived from assignments.

Current grounding:

- [`src/components/layout/ThreePanelShell.tsx`](/src/components/layout/ThreePanelShell.tsx)
- [`src/components/layout/RightSidebar.tsx`](/src/components/layout/RightSidebar.tsx)
- [`src/lib/layout-config.ts`](/src/lib/layout-config.ts)

### 6. Tone and copy stay plain, product-like, and low-drama

- Prefer short labels and direct status language over decorative copy.
- Empty and no-selection states should explain the next action without sounding instructional for the sake of it.
- Reuse Toronto-aware date language and existing status terms where possible.

Current grounding:

- [`docs/guidance/ui/stable.md`](/docs/guidance/ui/stable.md)
- [`docs/core/design.md`](/docs/core/design.md)

## Componentization Rules

Not every recurring UI idea should become a primitive.

A pattern becomes a primitive only when all of the following are true:

- it is structural rather than domain-specific
- it appears in at least two places or is clearly intended to
- it has stabilized
- it can expose a narrow API
- extracting it removes duplication without hiding meaningful differences

For this teacher work-surface family:

- should become primitives:
  - shared page-shell pieces already in use
  - stable empty/list/detail containers where structure truly matches
  - the teacher resizable split workspace container derived from assignments
  - shared teacher work-item card variants only if assignments/quizzes/tests converge
- should remain composed patterns:
  - teacher assignment summary
  - teacher assignment workspace
  - teacher quiz authoring composition
  - teacher test authoring composition
  - grading workspace composition
- should remain feature-local:
  - grading behavior
  - quiz/test state machines
  - assessment-specific domain controls
  - authoring rules and validation logic

## Lifecycle

Every teacher work-surface pattern should be classified as one of:

- `local`: a one-off implementation detail, not proposed for reuse
- `experimental`: a promising reusable pattern under review
- `stable`: the approved default that AI and engineers should reuse
- `legacy`: still present in code but not appropriate for new work

Promotion flow:

1. a pattern changes in assignments, quizzes, or tests
2. it is recorded as local or experimental
3. if it proves better or reusable, this canon and the audit are updated
4. only then does it become stable or a primitive candidate

The weekly promotion-review automation should be used to surface promotion candidates and stale guidance, but it must remain non-mutating. Human review is still required before stable guidance changes.

## Change Protocol

Any meaningful teacher assignments/quizzes/tests UX change should update this canon when it changes:

- shell structure
- action hierarchy
- card anatomy
- empty-state treatment
- focused workspace behavior
- rules around when split panes are justified

When updating this file, explicitly note whether the pattern is:

- assignment-led and already stable
- experimental and under review
- promoted from quizzes/tests because it is now the better family pattern
