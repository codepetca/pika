# Audit: Teacher Work Surfaces

This audit classifies the current teacher-side work-surface family:

- teacher assignments
- teacher quizzes
- teacher tests

Use it to decide what should become a primitive, what should remain a composed pattern, and what should stay feature-local.

## Scope

Included:

- [`src/app/classrooms/[classroomId]/TeacherClassroomView.tsx`](/src/app/classrooms/[classroomId]/TeacherClassroomView.tsx)
- [`src/app/classrooms/[classroomId]/TeacherQuizzesTab.tsx`](/src/app/classrooms/[classroomId]/TeacherQuizzesTab.tsx)
- supporting layout primitives in [`src/components/PageLayout.tsx`](/src/components/PageLayout.tsx), [`src/components/layout/ThreePanelShell.tsx`](/src/components/layout/ThreePanelShell.tsx), and [`src/components/layout/RightSidebar.tsx`](/src/components/layout/RightSidebar.tsx)
- card and workspace components used by those surfaces

Excluded:

- the student product
- the main classroom shell as a whole
- unrelated teacher tabs
- gradebook for now

## Foundations

These are already foundational and should stay shared:

| Pattern | Current owners | Stability | Disposition | Priority |
| --- | --- | --- | --- | --- |
| Semantic tokens for surfaces, borders, and text | `src/ui`, app-wide classroom surfaces | stable | keep as foundation | now |
| Base controls from `@/ui` | `src/ui`, assignments, quizzes/tests | stable | keep as foundation | now |
| Shared page shell primitives: `PageLayout`, `PageActionBar`, `PageContent`, `PageStack` | assignments, quizzes/tests | stable | keep as primitives | now |
| Shared classroom shell: `ThreePanelShell`, `LeftSidebar`, `RightSidebar`, `MainContent` | classroom route layer | stable cross-cutting | keep as shell primitives | now |

## Stable Family Contract

These interaction rules are now considered stable for the teacher work-surface family.

| Pattern | Current owners | Stability | Disposition | Priority |
| --- | --- | --- | --- | --- |
| Formal interaction ladder: `entry` -> `summary` -> `workspace` -> `workspace_mode` -> `inspector_active` | assignments as baseline, tests/quizzes as adopters | stable | reuse as the family state model | now |
| Summary state is full-width and content-first | assignments | stable | treat as family default | now |
| Workspace-mode tabs are post-selection only | assignments structure, tests emerging | stable | treat as family default | now |
| Inspector activation is selection- and mode-driven, not passive | assignments as baseline, tests grading as adopter | stable | treat as family default | now |
| Parent tab re-click returns to summary | assignments intent, tests implementation direction | stable | treat as family default | now |
| Ownership check across feature tab, classroom shell, and route config | family-wide diagnostic rule | stable | require in future parity work | now |

## True Primitives

These are the current or proposed structural primitives for the teacher work-surface family.

| Pattern | Current owners | Where else it appears | Stability | Disposition | Priority |
| --- | --- | --- | --- | --- | --- |
| Page-shell primitives (`PageLayout`, `PageActionBar`, `PageContent`, `PageStack`) | assignments, quizzes/tests | shared already | stable | keep as primitives | now |
| Calm empty-state container via `EmptyState` | quizzes/tests today, assignments via similar composition | intended family-wide | stable | keep as primitive | now |
| Teacher workspace split container derived from assignments | assignment viewing/grading + shell sidebar behavior | intended for quizzes/tests later | experimental candidate | extract as new primitive | now |
| Shared teacher work-item card variant | `SortableAssignmentCard`, `QuizCard`, emerging test card variants | partial convergence only | experimental | revisit after convergence | later |
| Generic teacher list/detail container | no single owner yet | conceptually repeated | unstable | do not extract yet | never for now |

## Composed Work-Surface Patterns

These should remain composed feature patterns even if they use shared primitives internally.

| Pattern | Current owners | Stability | Disposition | Priority |
| --- | --- | --- | --- | --- |
| Teacher assignment summary list and selection flow | `TeacherClassroomView` | stable | keep composed | now |
| Teacher assignment focused workspace and student inspection | `TeacherClassroomView`, `TeacherStudentWorkPanel` | stable | keep composed, feed split extraction | now |
| Teacher quiz authoring composition | `TeacherQuizzesTab`, `QuizDetailPanel`, `QuizModal` | experimental | keep composed | now |
| Teacher test authoring composition | `TeacherQuizzesTab`, `QuizDetailPanel`, `QuizModal` | experimental | keep composed | now |
| Teacher grading workspace composition | `TeacherQuizzesTab`, `TestStudentGradingPanel` | experimental | keep composed | now |

## Feature-Local Behavior

These should not be extracted into primitives.

| Pattern | Current owners | Stability | Disposition | Priority |
| --- | --- | --- | --- | --- |
| Assignment grading logic and student work fetching | `TeacherClassroomView`, assignment workspace hooks | stable | keep feature-local | now |
| Quiz/test authoring rules, question editing, and validation | `TeacherQuizzesTab`, `QuizModal`, question editors | stable per feature | keep feature-local | now |
| Test grading batch actions, AI grading strategy, and return flows | `TeacherQuizzesTab` | feature-local | keep feature-local | now |
| Assessment-specific workspace mode state machines | assignments/tests/quizzes owners | feature-local | keep feature-local | now |
| Right-sidebar open/close decisions tied to route/query behavior | `ClassroomPageClient`, layout hooks | mixed structural/feature-local | keep feature-local until split primitive is extracted | later |

## Current Assignment Audit

Assignments remain the best baseline for the family contract.

Observed status:

- summary is already full-width and calm
- selected work earns complexity rather than inheriting it by default
- inspector behavior is justified by active review work
- page-shell primitives are already the structural baseline

No major contradiction currently requires an assignment redesign before tests or quizzes adopt the canon. Future assignment changes should be targeted only when the canon exposes a clear inconsistency.

## Legacy Drift To Avoid Copying Forward

These are present or recently present patterns that should not be treated as reusable defaults.

| Pattern | Current owners | Stability | Disposition | Priority |
| --- | --- | --- | --- | --- |
| Passive split shells that reserve empty detail space before selection | tests/quizzes shell paths | legacy drift | mark legacy, avoid copying | now |
| Mode controls that visually outrank content lists | tests authoring/grading toggle states | legacy drift | reduce or localize | now |
| Divergent card systems with incompatible metadata density | assignments vs quizzes/tests cards | experimental drift | converge before extracting | later |

## Extraction Roadmap

### Now: teacher workspace split

The first extraction target remains a reusable teacher workspace split derived from assignments.

Responsibilities:

- primary pane plus inspector pane layout
- resize handle
- width clamping
- collapsed and expanded inspector state
- desktop split vs mobile stacked behavior

Required API shape:

- `primary`
- `inspector`
- `inspectorWidth`
- `onInspectorWidthChange`
- `inspectorCollapsed`
- `onInspectorCollapsedChange`

Non-goals:

- no assignment, quiz, or test business logic
- no grading logic
- no routing/query management beyond what a layout primitive strictly needs

Adoption order:

1. assignments adopt it first
2. teacher quizzes/tests adopt it only when their workspace state truly matches the pattern

### Later: teacher work-item card convergence

Assignments and quizzes/tests both need compact work-item cards, but they have not converged far enough yet to justify one primitive.

Promotion criteria before extraction:

- shared metadata hierarchy
- shared action affordances
- comparable density and status treatment
- narrow enough API that does not leak assessment-specific logic

### Never for now: full assessment mega-shell

Do not introduce a generic assessment framework that tries to own assignments, quizzes, and tests in one abstraction. The family is aligned at the structural level, not at the business-logic level.

## Review Checklist

When deciding whether a pattern should be promoted or extracted, answer:

1. Is the pattern structural rather than domain-specific?
2. Does it appear in at least two places or clearly need to?
3. Is the API narrow enough to stay comprehensible?
4. Would extraction simplify future work instead of hiding important differences?
5. Has the interaction-ladder behavior been canonized first?
