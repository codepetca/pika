Restyle a teacher or student assessment surface so it clearly belongs to the same product family as assignments, while allowing slight aesthetic evolution.

Use this mode when you want consistency, not cloning.

## Read First

1. `docs/guidance/ui/teacher-work-surfaces.md`
2. `docs/guidance/assignment-ux-language.md`
3. `docs/guides/assessment-ux-evaluation.md`

If the task is teacher-side, treat the teacher work-surface canon as the stable authority.

## Required Interaction Check

Before editing, identify the current layer in the formal interaction ladder:

- `entry`
- `summary`
- `workspace`
- `workspace_mode`
- `inspector_active`

Preserve that ladder unless the task explicitly changes it.

Defaults:

- sub-routes are workspace states by default, not URL states
- top tabs are post-selection workspace-mode controls
- the right sidebar is a tool, not default chrome
- parent tab re-click should return to `summary`
- selected panel-based workspaces should remove outer gutters so tabs and pane shells sit flush with the main container

## Intent

The result does not need to be a visual duplicate of assignments.

It does need to preserve the same:

- shell discipline
- spacing rhythm
- action hierarchy
- card semantics
- empty-state calmness
- content-first behavior
- selection-driven progression into focused work

Small aesthetic changes are acceptable if they are reusable across assessment surfaces and still feel like the same system.

## Owner Check

If a visible pane, placeholder, or blank column is wrong, verify ownership before editing:

1. feature tab component
2. surrounding classroom shell
3. route or layout config

Do not patch a shell or route problem only inside the local tab component.

## Allowed Evolution

You may slightly evolve:

- card polish
- status chip treatment
- typography emphasis
- spacing density
- empty-state composition

But only if the result would still make sense as a future design direction for:

- teacher assignments
- teacher tests
- teacher quizzes
- student assignments
- student tests
- student quizzes

## Not Allowed

- one-off styling that only exists on the target screen
- a new shell language that breaks family resemblance
- controls taking visual priority over content
- dashboard chrome or placeholder panes that assignments would not use
- workspace-mode tabs in a passive pre-selection state
- a blank passive pane or empty right column in a browsing state
- extra outer gutter padding around a selected panel-based workspace

Treat blank passive panes as hard failures.

## Primitive Expectations

When the existing surface fits, prefer:

- `PageLayout`
- `PageActionBar`
- `PageContent`
- `PageStack`
- `EmptyState`
- semantic tokens

Do not invent a new shell when the existing family shell already fits the state.

## Design Test

At a glance, a reviewer should think:

- same product
- same design system
- same interaction priorities

They should not think:

- different tool
- special admin console
- bespoke screen with unrelated chrome

## Review Standard

If the UI changed aesthetically but the same aesthetic could now be rolled back into assignments without conflict, the evolution is acceptable.
