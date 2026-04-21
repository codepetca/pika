# Assessment UX Evaluation

Use this guide to verify that the new assignment-parity docs actually cause a fresh AI to produce assessment screens that match the existing assignments system.

This is a **rubric-and-screenshot** evaluation flow, not a pixel diff.

## Goal

A fresh AI should be able to restyle tests or quizzes so they feel like assignment-family screens without extra coaching.

Passing means:

- the resulting screen reads as the same product family as assignments at a glance
- the code reuses the expected page primitives
- the evaluator can explain parity using the rubric instead of relying on vague taste

Minor aesthetic evolution is acceptable. The pass condition is family consistency, not pixel identity.

## Reference and Target Artifacts

Capture screenshots with:

```bash
pnpm e2e:verify assessment-ux-parity
```

The scenario writes screenshots to:

```bash
artifacts/assessment-ux-parity/
```

Expected artifacts:

- `teacher-assignments-reference.png`
- `teacher-tests-target.png`
- `teacher-quizzes-target.png`
- `student-assignments-reference.png`
- `student-tests-target.png`
- `student-quizzes-target.png`

Use the assignment images as the reference set. Use the assessment images as the targets to score.

If you are intentionally testing a “same family, slightly evolved” direction, use the same rubric. The question is still whether the target reads as a descendant of assignments rather than a separate tool.

## Blind-Run Validation Workflow

Run the docs in a fresh AI session with only:

- `docs/guidance/assignment-ux-language.md`
- `.codex/prompts/assessment-ux-parity.md`
- the target task request

Do not provide prior design discussion or hidden context.

For the teacher-tests blind run, prefer the dedicated wrapper:

```bash
bash scripts/run-teacher-tests-parity-challenge.sh --refresh-auth
```

This attaches the assignment reference screenshot and the current teacher-tests screenshot to the fresh run so the evaluator tests implementation quality instead of the agent's ability to imagine the baseline from text alone.

### Required challenge set

Run at least these three tasks:

1. teacher tests authoring/list parity
2. student tests list/detail parity
3. student quizzes list/detail parity

Teacher quizzes are optional for v1, but should be included when time allows.

### Test loop

For each challenge:

1. Start a fresh AI session.
2. Give it one concrete restyle task.
3. Let it implement without extra verbal guidance.
4. Capture screenshots with `pnpm e2e:verify assessment-ux-parity`.
5. Score the resulting screen against the assignment references.
6. Record failures against the docs and prompt.
7. Tighten the docs or prompt.
8. Rerun the same challenge until it passes.

If the fresh AI never reaches implementation and spends the run reacquiring unrelated context instead, count that as a failed blind run. The guidance package must be specific enough to get a task-scoped change started, not just to describe the desired end state.

Also count it as a prompt-scoping failure if the fresh AI only inspects the local tab component while the visible no-selection shell actually lives in a surrounding container such as `ClassroomPageClient`.
Also count it as a prompt-scoping failure if the persistent blank column is owned by route-level layout configuration such as `tests-teacher` in `src/lib/layout-config.ts` and the challenge packet never points the fresh AI there.

Also count it as an execution-packet failure if the prompt names App Router files with bracketed path segments but does not tell the fresh AI to quote those paths in shell commands. In this repo, that causes `zsh` glob failures before implementation even starts.

## Rubric

Score each category from 0 to 2.

| Category | 0 | 1 | 2 |
| --- | --- | --- | --- |
| Shell/Layout Parity | Different structural language from assignments | Partially similar, but still noticeably bespoke | Clearly uses the same shell language as assignments |
| Spacing/Density Parity | Much denser or noisier than assignments | Close in places, but inconsistent | Matches assignment rhythm and breathing room |
| Empty-State Parity | Extra framing, chrome, or noise | Same intent but heavier than assignments | Same quiet tone as assignments |
| List-Card Parity | Cards feel unrelated to assignments | Mixed parity | Clearly reads as assignment-family cards |
| Detail-State Parity | Detail layout appears unrelated or premature | Partially aligned | Detail emerges in the same way assignments do |
| Action Hierarchy Parity | Controls dominate the page | Action hierarchy is improved but still busy | Same restraint and emphasis as assignments |
| Status/Copy Parity | Copy or status treatment feels like a different product | Some alignment, some drift | Same terse, product-like tone |
| Chrome Restraint | New panes, toggles, or placeholders overpower content | Reduced, but still visible drift | Chrome stays subordinate to content |

Maximum score: `16`

### Pass threshold

Pass only if:

- total score is `12` or higher
- no `0` appears in:
  - Shell/Layout Parity
  - Empty-State Parity
  - List-Card Parity
  - Action Hierarchy Parity

## Hard Failures

The run fails immediately if any of these appear:

- A default split-pane placeholder state appears before selection without a strong functional reason.
- A passive browsing state still reserves a visibly empty right column or pane after placeholder content is removed.
- A student browsing state uses an exam-style split shell before active test-taking has actually started.
- The empty state is materially noisier than assignments.
- Controls or mode toggles visually dominate the screen before content.
- The layout introduces a structural pattern that does not exist in assignments for the analogous state.

## Required Code Review Checks

Before approving a blind-run result, confirm the implementation reuses expected primitives where appropriate:

- `PageLayout`
- `PageActionBar`
- `PageContent`
- `PageStack`
- `EmptyState`
- semantic tokens instead of bespoke raw-theme styling

If the screenshots look close but the code invented a new shell or component family, treat that as drift and update the docs/prompt.

## Failure Logging

Every failed run should produce a short note with:

- challenge name
- screenshot pair reviewed
- rubric scores
- hard failures, if any
- whether the AI actually reached implementation
- exact drift observed
- whether the wrong owning component was targeted
- where the docs were insufficient:
  - UX system rule missing
  - prompt instruction missing
  - primitive checklist missing

## Iteration Rules

Update the **UX spec** when the failure is system-level:

- state progression is unclear
- split-pane rules are underspecified
- empty-state tone is underspecified
- card or shell language is underspecified

Update the **parity prompt** when the failure is execution-level:

- the AI used the wrong files as references
- the AI invented a new layout even though the spec was clear
- the AI ignored primitive reuse
- the AI needed stronger “must not introduce” constraints

Do not call the guidance “working” after one success. Require repeatable passes across the full challenge set.
