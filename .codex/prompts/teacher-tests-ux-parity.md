Align the teacher tests surface to the teacher work-surface canon, using assignments as the current baseline reference.

This is a task-scoped prompt for teacher tests. It should consume the canon, not reinvent the system design locally.

## Target

- target tab: teacher `Tests`
- target family state: start from `entry` and `summary`, then preserve or refine `workspace`, `workspace_mode`, and `inspector_active` as needed
- preserve existing test behavior unless the task explicitly changes it

## Read First

1. `docs/guidance/ui/teacher-work-surfaces.md`
2. `docs/guidance/assignment-ux-language.md`
3. `docs/guides/assessment-ux-evaluation.md`
4. `src/app/classrooms/[classroomId]/TeacherClassroomView.tsx`
5. `src/components/SortableAssignmentCard.tsx`
6. `src/components/PageLayout.tsx`
7. `src/ui/EmptyState.tsx`
8. `src/app/classrooms/[classroomId]/TeacherQuizzesTab.tsx`
9. `src/app/classrooms/[classroomId]/ClassroomPageClient.tsx`
10. `src/lib/layout-config.ts`
11. `src/components/QuizCard.tsx`
12. `tests/components/TeacherQuizzesTab.test.tsx`

If the surrounding harness says the environment is already verified, do not rerun full repo startup or full-suite validation. Move directly into task-scoped work.

When reading or editing App Router files from the shell, quote the path exactly because `[` and `]` will be treated as glob syntax by `zsh`.

## Required Interpretation

Before editing, identify:

- the current interaction-ladder layer
- the owning component for the visible behavior

Use this ownership order:

1. feature tab component
2. classroom shell
3. route/layout config

## Goal

Make teacher tests feel like the same product family as teacher assignments while preserving tests-specific business behavior.

In practice:

- `summary` should feel complete as a full-width list state
- `workspace` should appear only after selecting a test
- `workspace_mode` tabs such as `Authoring` and `Grading` belong only inside a selected workspace
- `inspector_active` should open only when the current mode and current selection justify it

## Must Preserve

- existing test data and API behavior
- existing create, open, close, grading, AI grading, and return behavior
- existing wiring the surrounding classroom shell depends on once a test is actually selected

## Must Not Introduce

- a passive split-pane placeholder before selection
- a blank right pane or blank right column in `summary`
- workspace-mode tabs before a test is selected
- louder controls than the content list
- a new shell system outside the family primitives

## Typical Edit Shape

Most tasks should stay focused on one or more of:

- the teacher tests tab component
- the surrounding `ClassroomPageClient`
- `src/lib/layout-config.ts`
- test-card anatomy if the cards are drifting from assignment-family scanning rules

Do not broaden the change unless the canon clearly requires it.

## Validation

1. Run `pnpm exec vitest run tests/components/TeacherQuizzesTab.test.tsx`
2. Run `pnpm e2e:verify assessment-ux-parity`
3. Review:
   - `artifacts/assessment-ux-parity/teacher-assignments-reference.png`
   - `artifacts/assessment-ux-parity/teacher-tests-target.png`
4. Score the result with `docs/guides/assessment-ux-evaluation.md`
5. Report pass/fail and list remaining mismatches
