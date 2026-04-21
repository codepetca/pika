Restyle an assessment surface so it matches the assignments UX system.

Treat assignments as the canonical design source of truth for classroom assessment work in Pika.

## Inspect First

Read these files before editing:

1. `docs/guidance/assignment-ux-language.md`
2. `src/app/classrooms/[classroomId]/TeacherClassroomView.tsx`
3. `src/app/classrooms/[classroomId]/StudentAssignmentsTab.tsx`
4. `src/components/SortableAssignmentCard.tsx`
5. `src/components/PageLayout.tsx`
6. `src/ui/EmptyState.tsx`
7. The target assessment surface:
   - `src/app/classrooms/[classroomId]/TeacherQuizzesTab.tsx`
   - `src/app/classrooms/[classroomId]/StudentQuizzesTab.tsx`
   - related assessment components only as needed

If the challenge is teacher tests authoring parity, treat the exact target as:

- `TeacherQuizzesTab`
- `assessmentType="test"`
- `testsMode === 'authoring'`

Do not spend the run auditing unrelated tabs once those references are loaded.

## Goal

Make the target surface feel like it belongs to the same product family as assignments.

Preserve assessment-specific behavior:
- test-taking
- grading
- status semantics
- submission or return behavior

But express that behavior using the assignment shell, spacing, card tone, empty-state tone, and selection flow.

## Must Match

- Use the assignment page shell and spacing rhythm where possible.
- Keep the page content-first and quiet.
- Prefer the same list-card language as assignments.
- Keep empty states as restrained as assignments.
- Make detail appear because the user selected work, not because the layout reserved a large empty pane in advance.
- Reuse existing primitives before creating new layout structures:
  - `PageLayout`
  - `PageActionBar`
  - `PageContent`
  - `PageStack`
  - `EmptyState`

## Must Preserve

- Existing assessment behavior and data model
- Existing role semantics
- Existing API interactions and business logic
- Test-specific constraints that are actually necessary for active exam mode or grading mode

## Must Not Introduce

- A new shell or layout system when assignments already provide one
- Default split panes with placeholder detail states unless the analogous assignment state uses them
- Controls or mode toggles that visually outrank content
- Louder, denser, or more decorative empty states than assignments
- One-off card styling that no longer resembles assignment cards
- Raw `dark:` classes or non-semantic token styling

## Working Rules

- Keep logic out of UI components.
- Prefer adapting existing assessment components to the assignment shell rather than rewriting behavior.
- If an assessment-specific mode truly needs a different layout, keep that difference limited to the active mode and do not let it bleed into passive browsing states.
- For student tests, passive browsing and pre-start detail should still read like student assignments; reserve the split exam shell for active in-progress test work.
- If you need a split view, justify it with the current state, not with anticipated future selection.
- In a blind run, stay scoped to the named target branch instead of reloading broad repo context after the required files are read.
- If the outer harness says the environment is already verified, do not rerun full startup or full-suite validation before implementing the target.

## Finish Checklist

Before stopping:

1. Capture assignment reference screenshots and target screenshots.
   - `pnpm e2e:verify assessment-ux-parity`
2. Review the artifacts in `artifacts/assessment-ux-parity/`.
3. Score the result against `docs/guides/assessment-ux-evaluation.md`.
4. List the remaining mismatches explicitly.
5. If the result still drifts from assignments, tighten the implementation before handing off.

## Known First-Pass Drift To Remove

For the current teacher tests surface, eliminate these before considering the run successful:

- the left-list plus right-placeholder passive shell
- the oversized no-selection pane with “Select a test” copy
- mode-toggle emphasis that outranks the test cards
- card styling that reads as tool chrome instead of assignment-family work items
