Restyle the teacher tests passive browsing surface so it matches the teacher assignments UX system.

This is a task-scoped parity prompt for the teacher-tests authoring surface. That surface spans the test-authoring branch in `TeacherQuizzesTab` and the surrounding teacher assessment shell in `ClassroomPageClient`.

Aim for the same **product family** as assignments, not a literal visual clone. Small aesthetic refinements are acceptable if they would also make sense as a future shared direction for assignments, tests, and quizzes.

## Target

- Primary file: `src/app/classrooms/[classroomId]/TeacherQuizzesTab.tsx`
- Supporting shell file: `src/app/classrooms/[classroomId]/ClassroomPageClient.tsx`
- Supporting layout config: `src/lib/layout-config.ts`
- Branch: `assessmentType="test"` with `testsMode === 'authoring'`

Do not treat teacher quizzes or grading mode as the primary target for this challenge.
Do not treat unrelated classroom tabs as in scope.

## Read Only These Files First

1. `docs/guidance/assignment-ux-language.md`
2. `docs/guides/assessment-ux-evaluation.md`
3. `src/app/classrooms/[classroomId]/TeacherClassroomView.tsx`
4. `src/components/SortableAssignmentCard.tsx`
5. `src/components/PageLayout.tsx`
6. `src/ui/EmptyState.tsx`
7. `src/app/classrooms/[classroomId]/TeacherQuizzesTab.tsx`
8. `src/app/classrooms/[classroomId]/ClassroomPageClient.tsx`
9. `src/lib/layout-config.ts`
10. `src/components/QuizCard.tsx`
11. `tests/components/TeacherQuizzesTab.test.tsx`

If the surrounding harness says the environment is already verified, do not rerun full repo startup or full-suite validation. Move directly from these files into the implementation.

When reading or editing App Router files from the shell, quote the path exactly because `[` and `]` will be treated as glob syntax by `zsh`. Example:

- `sed -n '1,220p' 'src/app/classrooms/[classroomId]/TeacherQuizzesTab.tsx'`
- `sed -n '1,220p' 'src/app/classrooms/[classroomId]/ClassroomPageClient.tsx'`
- `git diff -- 'src/app/classrooms/[classroomId]/TeacherQuizzesTab.tsx'`

## Goal

Make teacher tests authoring feel like teacher assignments summary/list state:

- quiet shell
- content-first list
- restrained action bar
- no reserved right-side placeholder detail pane before selection
- no reserved blank right-side column after the placeholder pane is removed
- assignment-family card tone

If the visible placeholder or split-pane treatment comes from the surrounding classroom shell rather than `TeacherQuizzesTab`, fix it there instead of forcing the tab component to work around it.
If the blank right column is being created by the teacher tests route opening the right sidebar by default, fix that in `src/lib/layout-config.ts` rather than only hiding content inside the open shell.

## Must Match

- The default authoring view should feel complete as a list page, just like teacher assignments.
- The default authoring view may evolve the shared aesthetic slightly, but it must still read as part of the same assignment-derived system at a glance.
- The default authoring view must use the available main-content width for the test list. Hiding placeholder copy while leaving an empty right column is still a failure.
- `New Test` can remain the primary action, but it should not be visually outnumbered by chrome.
- The authoring/grading toggle may remain, but it must recede behind the content and should not be the first thing the eye lands on.
- Empty or no-selection states should use `EmptyState` or a comparably quiet single-surface treatment.
- Cards should read like descendants of `SortableAssignmentCard`, not a separate dashboard component family.
- The teacher assessment sidebar or detail shell must not stay visually active in authoring mode when nothing is selected.

## Must Preserve

- Existing test data and API behavior
- Existing grading mode behavior
- Existing create/open/close actions
- Existing sidebar and selection wiring that the rest of the classroom page depends on
- Existing teacher assessment detail behavior once a test is actually selected

## Must Not Introduce

- A split-pane placeholder state in authoring mode before a selection exists
- A large blank right pane with “Select a test” copy in passive browsing state
- A large blank right pane or blank right column in passive browsing state even if the placeholder copy is removed
- Louder controls than the content list
- A new shell or layout system outside the existing page primitives
- A workaround that hides the symptom in `TeacherQuizzesTab` while leaving the outer `ClassroomPageClient` shell behavior inconsistent

## Expected Edit Shape

The likely implementation should stay narrow:

- reshape the `PageActionBar` hierarchy for the test authoring state
- reshape the authoring branch of `TeacherQuizzesTab`
- adjust the teacher assessment no-selection shell in `ClassroomPageClient` if that is what produces the placeholder pane
- adjust the `tests-teacher` route config in `src/lib/layout-config.ts` if the route-level default sidebar state is what keeps the blank column alive
- adapt `QuizCard` only if needed so teacher tests cards feel closer to assignment cards
- avoid touching grading tables unless required for shared component compatibility

## Finish Checklist

1. Run `pnpm exec vitest run tests/components/TeacherQuizzesTab.test.tsx`
2. Run `pnpm e2e:verify assessment-ux-parity`
3. Review:
   - `artifacts/assessment-ux-parity/teacher-assignments-reference.png`
   - `artifacts/assessment-ux-parity/teacher-tests-target.png`
4. Score the result with `docs/guides/assessment-ux-evaluation.md`
5. Report pass/fail and list any remaining mismatches
