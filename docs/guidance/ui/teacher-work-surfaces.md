# Teacher Work-Surface Canon

This document is the stable canon for the teacher-side work-surface family:

- teacher assignments
- teacher quizzes
- teacher tests

It governs how those three tabs should feel, compose, and evolve. It does not govern:

- the main classroom shell as a whole
- unrelated teacher tabs such as attendance, roster, settings, gradebook, or calendar
- the student product

Assignments are the current baseline source of truth for this family because they express the clearest teacher summary-to-workspace progression today. They are not permanent authority. If quizzes or tests later produce a better family pattern, this canon should be updated and assignments can then follow.

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
- This file is the stable authority for teacher assignments/quizzes/tests interaction structure, shell behavior, and family taste.
- [`docs/guidance/assignment-ux-language.md`](/docs/guidance/assignment-ux-language.md) is the assignment-specific reference implementation, not a competing stable canon.
- Nothing becomes stable for this family until this canon and the audit agree it is stable.

## Formal Interaction Ladder

Use these state names explicitly in planning, prompts, reviews, and implementation notes:

- `entry`: the teacher clicked the parent classroom tab
- `summary`: the full-width browsing/list state with no passive inspector
- `workspace`: a selected work item is open in the main content area
- `workspace_mode`: a sub-mode inside the selected workspace, such as `authoring`, `grading`, `overview`, or `details`
- `inspector_active`: a secondary pane is open because the current workspace mode and selection justify it

Defaults for this family:

- sub-routes inside these tabs are workspace states by default, not URL states
- top tabs belong inside selected workspaces, not in passive entry states
- the right sidebar is a tool, not default chrome
- re-clicking the parent nav tab should return the surface to `summary`

## State Rules

### 1. `entry`

What the teacher sees:

- the shared classroom shell with the family tab activated
- a browsing-oriented first impression, not a dense authoring or grading workspace

Allowed:

- a sparse action bar
- a full-width list or empty state
- existing shell framing from the classroom route

Must not appear:

- a passive blank detail pane
- an already-open inspector with no active selection
- top tabs that imply a selected workspace before anything is selected

Advances when:

- the tab finishes loading and resolves into `summary`

### 2. `summary`

What the teacher sees:

- one calm browsing surface
- content-first cards, rows, or equivalent summary items
- a stable, restrained top action bar

Allowed:

- one obvious primary action such as `New Assignment`, `New Test`, or `New Quiz`
- quiet secondary controls when they are needed and visually subordinate
- a single quiet `EmptyState`

Must not appear:

- a reserved placeholder pane
- a visibly empty right column
- workspace-mode tabs
- controls that visually outrank the content list

Advances when:

- the teacher selects a work item
- a summary action intentionally opens focused work

### 3. `workspace`

What the teacher sees:

- the same outer shell, now centered on a selected item
- denser content only because the teacher chose to work inside that item

Allowed:

- a selected-item title
- context-aware actions
- a main-pane editor, table, or review surface

Must not appear:

- summary-only placeholder messaging
- a new shell language unrelated to the summary shell

Advances when:

- the teacher leaves the selected item and returns to `summary`
- the workspace exposes a deeper `workspace_mode`

### 4. `workspace_mode`

What the teacher sees:

- a selected workspace with top-level sub-modes only when they unlock materially different work

Allowed:

- tabs such as `Authoring` and `Grading`
- mode-specific action bars
- different main-pane surfaces for different kinds of work

Must not appear:

- workspace tabs before a selection exists
- decorative or redundant mode switches that do not represent real workflow changes
- mode chrome that visually dominates the selected content

Advances when:

- the teacher switches modes inside the selected workspace
- the current mode and selection justify `inspector_active`

### 5. `inspector_active`

What the teacher sees:

- a secondary pane that is actively supporting the current work

Allowed:

- grading inspectors
- contextual review panes
- split or resizable layouts when both panes are being used

Must not appear:

- a passive inspector before the current mode needs it
- an inspector opened only to preserve layout symmetry
- a secondary pane with no active contextual value

Advances when:

- the teacher selects the row, student, or sub-item that requires side-by-side work
- the teacher closes, clears, or exits that focused selection and returns to the previous state

## Shell And Chrome Rules

### Action bar density

- Use the shared page-shell composition already present in teacher assignments: `PageLayout`, `PageActionBar`, `PageContent`, `PageStack`.
- Summary states get a sparse action bar with one clear primary action and minimal surrounding chrome.
- Workspace states may add contextual controls, but the shell should remain recognizable across nearby states.
- Workspace-mode controls are justified only when they unlock genuinely different work.

### Reusable selected-workspace shell template

When a teacher tab needs the Daily/Assignment two-pane work surface, reuse the
shared shell and split primitives instead of building feature-local layout and
resize code.

Use this composition as the default selected-workspace template for assignments,
quizzes, tests, and nearby teacher work tabs when the workflow has an active
primary pane plus an active inspector/detail pane:

```tsx
<TeacherWorkSurfaceShell
  state="workspace"
  primary={actionBar}
  summary={null}
  workspace={workspace}
  workspaceFrame="standalone"
  workspaceFrameClassName="border-0 bg-page"
/>
```

Inside `workspace`, use the shared split:

```tsx
<TeacherWorkspaceSplit
  splitVariant="gapped"
  primary={primaryPane}
  inspector={inspectorPane}
  inspectorCollapsed={false}
  inspectorWidth={inspectorWidth}
  onInspectorWidthChange={setInspectorWidth}
  primaryClassName="rounded-lg bg-surface"
  inspectorClassName="rounded-lg bg-surface"
  dividerLabel="Resize workspace panes"
/>
```

Default shape:

- `TeacherWorkSurfaceShell` owns the tab action bar and the lower workspace slot.
- `workspaceFrame="standalone"` keeps the one-bar page shell.
- `workspaceFrameClassName="border-0 bg-page"` removes extra outer framing so
  the panes sit directly on the page background.
- `TeacherWorkspaceSplit splitVariant="gapped"` provides the page-background
  middle gap, drag resize behavior, keyboard resize behavior, and mobile stacked
  layout.
- Pane content remains feature-owned; pane sizing, resize mechanics, and the
  outer split shape should not be reimplemented in each tab.

Use `TeacherWorkspaceSplit` without `splitVariant="gapped"` only when preserving
an older joined split is explicitly desired.

### Main-content width

- Summary states use the available main-content width.
- Do not leave a silent empty column beside the browsing surface.
- Do not preserve future detail space in a passive state.

### Selected-workspace gutters

- Summary states should keep the normal page rhythm from `PageContent` and `PageStack`.
- Selected workspaces that render a primary panel shell, split shell, or top-mounted workspace tabs should remove outer `PageContent` gutter padding.
- In those selected workspaces, the workspace container should sit flush with the main content bounds so the tabs and pane boundaries touch the container edge.
- Extra outer gutter padding around a selected workspace shell is drift, not family polish.

### Right-sidebar default behavior

- The right sidebar should be closed or visually inactive by default in `entry` and `summary`.
- Open the inspector only when the current workspace mode and current selection justify active side-by-side work.
- Desktop split layouts are workspace tools, not default family chrome.

### Top-tab justification

- Top tabs are allowed only inside `workspace` as `workspace_mode` selectors.
- They must represent real workflow changes.
- They should not be the first visual emphasis in a browsing state.

### Action-bar workspace toggles

- Compact workspace toggles are allowed in the selected-workspace action bar
  when they choose the primary workspace view.
- They should replace, not duplicate, top workspace tabs.
- Keep batch or grading actions in the same action cluster when they apply to
  the selected workspace.
- Summary states should put the tab label, such as `Assignments`, in the global
  app-header title slot instead of duplicating it in the page action bar.
- In selected workspaces, place the selected item title in the global app-header
  title slot rather than inside the page action bar.
- Render central summary or selected-workspace actions through the floating
  center action cluster so the controls stay anchored under the app header while
  the teacher scrolls the workspace.
- The assignment pane-toggle implementation is an experimental assignment-led
  pattern until promoted after visual and workflow review.

### Hard failures

Treat these as family-level hard failures:

- a passive blank pane before selection
- a visibly empty right column after placeholder content is removed
- workspace-mode tabs shown before selection
- summary chrome that visually dominates the list
- a selected workspace shell wrapped in extra outer gutters when the panel or tabs should sit flush

## Card And Spacing Rules

Teacher work-item cards and summary rows should follow assignment-family scanning priorities:

- title first
- muted secondary metadata
- compact status treatment
- quiet row actions
- modest vertical rhythm via `PageContent` and `PageStack`

Card language should stay compact, descriptive, and reusable:

- surface the minimum metadata needed to decide what to open next
- avoid helper copy, badge piles, or action clusters that make each item feel like a mini dashboard
- preserve a strong left-to-right reading order with the title as the strongest text

Spacing should stay calm:

- modest action-bar spacing
- clear but not oversized separation between cards or rows
- enough padding for readability without feeling loose
- in selected panel-based workspaces, earn density by removing outer gutters rather than nesting padded boxes inside padded boxes

## Ownership Checklist

If a screen shows unwanted pane or chrome behavior, check ownership in this order before editing:

1. the feature tab component
2. the surrounding classroom shell
3. route and layout config

Typical ownership examples:

- summary/workspace transitions often live in the feature tab component
- passive no-selection panes may live in `ClassroomPageClient`
- persistent blank columns may be owned by route config in `src/lib/layout-config.ts`

Do not paper over an outer-shell problem only inside the local tab component.

## Reuse Boundaries

Keep these reusable:

- shell/state rules
- page-shell primitives
- stable split-workspace structure when it is truly structural
- future shared card variants only after real convergence

Keep these feature-local:

- grading behavior
- quiz/test authoring rules and validation
- assignment grading logic
- assessment-specific state machines and domain controls

Do not introduce a generic assessment mega-shell that tries to own assignments, quizzes, and tests in one abstraction.

## Implemented Primitive Map

The assignment refactor created stable structural primitives, plus assignment-local implementations that demonstrate how to compose them. Future tests/quizzes/gradebook work should use this map instead of inferring reuse from filenames alone.

Stable structural primitives:

| Component | Use for | Do not put here |
|---|---|---|
| `TeacherWorkSurfaceShell` | page layout, summary/workspace state, action bar placement, feedback placement, selected-workspace frame | data loading, routing/query behavior, selection state, grading state, assessment status, return behavior |
| `TeacherWorkSurfaceModeBar<TMode>` | selected-workspace mode tabs with tab semantics and keyboard movement | domain-specific mode state machines, assessment-specific labels baked into the primitive |
| `TeacherWorkspaceSplit` | bounded primary/inspector split panes when both panes are active work surfaces | grading behavior, student selection, assignment-specific width policy beyond generic min/max constraints |

Assignment-local reference implementations:

| Component | Role | Reuse boundary |
|---|---|---|
| `TeacherAssignmentStudentTable` | assignment student-status table with selection, artifacts, assignment statuses, and assignment grade summary | copy the table rhythm only after creating a domain-specific table for tests/quizzes; do not import it outside assignment work |
| `TeacherStudentWorkPanel` | assignment document review surface that composes content preview with an inspector | use as a behavioral reference, not as a generic assessment panel |
| `TeacherWorkInspector` | assignment grading/history/repo/comments inspector | assignment-only; tests/quizzes need their own inspector if their data and controls differ |
| `useTeacherStudentWorkController` | assignment document loading, grading, autosave, history, repo analysis, and feedback return orchestration | assignment-only business logic |

Stable hierarchy for teacher work tabs:

```tsx
<FeatureTeacherTab>
  <TeacherWorkSurfaceShell
    state={isSummary ? 'summary' : 'workspace'}
    primary={summaryOrWorkspaceActionBar}
    feedback={featureFeedback}
    summary={featureSummary}
    workspace={featureWorkspace}
    workspaceFrame="attachedTabs | standalone"
  />
</FeatureTeacherTab>
```

Inside `workspace`, use `TeacherWorkSurfaceModeBar` only when the selected item has real workflow modes. Use `TeacherWorkspaceSplit` only when a current selection makes side-by-side work useful.

## AI Adoption Contract

Use this language when asking an AI agent to migrate tests, quizzes, or another teacher work tab:

```text
Use the assignment tab as the reference implementation, but do not copy assignment-specific components or logic.

Reuse `TeacherWorkSurfaceShell`, `TeacherWorkSurfaceModeBar`, and `TeacherWorkspaceSplit` for structural shell behavior.

Create domain-specific inner components for this tab. Do not import `TeacherAssignmentStudentTable`, `TeacherStudentWorkPanel`, `TeacherWorkInspector`, or `useTeacherStudentWorkController` unless the task is assignment work.

Preserve the teacher work-surface ladder: summary -> selected workspace -> optional workspace mode -> optional active inspector.

Keep data loading, routing/query behavior, selection state, grading state, return behavior, draft state, browser-event handling, and assessment-specific mode logic in the feature tab or feature-specific hooks, not in the shared shell primitives.

Stop and reassess if a shared primitive needs props named after assignment, quiz, test, gradebook, student grading, AI runs, return flow, rubric, attempt, artifact, or assessment status.
```

## Tests And Quizzes Migration Template

For future teacher tests/quizzes work, migrate in this order:

1. Identify the existing states in the formal ladder: `summary`, `workspace`, `workspace_mode`, and `inspector_active`.
2. Replace only the outer page rhythm with `TeacherWorkSurfaceShell`.
3. Move selected-item mode controls into `TeacherWorkSurfaceModeBar` if the modes are real workflow changes.
4. Use `TeacherWorkspaceSplit` only for active side-by-side review, grading, or authoring work.
5. Extract feature-specific inner pieces under a feature-specific path such as `src/components/test-workspace/` or `src/components/quiz-workspace/`.
6. Add focused component tests for shell state, mode tabs, split bounds, selected-workspace behavior, and browser-back behavior.
7. Run UI verification against the migrated tab and compare it to the pre-refactor screenshots before migrating another tab.

Do not migrate tests and quizzes in the same pass unless assignment parity has already been accepted and the first non-assignment migration has passed visual review.

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

## Documentation Checklist

Use this checklist when changing or reviewing teacher-family UX:

- full-width summary by default
- no passive inspector before selection
- selected workspace earns complexity
- workspace tabs only after selection
- action-bar toggles replace workspace tabs when the selected workspace needs a
  compact primary-view switch
- inspector opens only for active comparative or review work
- parent tab click returns to `summary`
- page-shell primitives are reused
- semantic tokens remain in app code
- owner check covers feature tab, classroom shell, and layout config

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

- the interaction ladder
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
