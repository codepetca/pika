# Dev Flow Risk Checklists

Use this file when a task matches one of the risk profiles below. Keep the checklist compact and concrete in plans, PR notes, and review responses.

## Risk Profile Declaration

Every non-trivial task should declare one of:

- `none`
- `workspace-state`
- `async-grading`
- `exam-mode`
- `runtime-platform`

If more than one applies, list all matching profiles.

## Workspace State

Applies when changing long-lived workspaces, split panes, editors, autosave surfaces, overlays, or parent/child refresh behavior.

- Treat current mounted editors/forms as stateful unless proven otherwise.
- Preserve mounted workspace children across autosave, transient overlays, parent metadata updates, and background refetches.
- Prefer local summary patching over full parent reloads when the child already has the fresh state.
- Test that the active workspace does not remount when autosave completes or when non-destructive metadata changes.
- If async state belongs to a route, classroom, selected record, or pane owner, name that identity boundary before editing.
- Tag loaded state with its owner identity when stale data could remain visible during navigation or reselection.
- Guard late async completions before every visible state write; a response for classroom A must not repaint classroom B.
- Clear or hide owner-scoped sidebar/detail state synchronously when the owner changes, even before the next request resolves.
- Add at least one stale-response regression for risky route-keyed work: start load A, switch to B, resolve A late, prove B stays visible.
- For structural refactors, use this implementation contract:

```text
This is a structural refactor, not a redesign.

Use teacher assignments as the visual and interaction reference. Extract only the repeated shell structure that already exists: page layout, action bar placement, summary spacing, selected-workspace gutter behavior, feedback banner placement, and selected-workspace frame.

Do not move business logic, data loading, selection state, grading behavior, routing/query behavior, modal flows, or assessment-specific mode state into the shell.

The migrated assignment UI should look and behave the same after the refactor. Any visible difference must be explicitly listed and justified before continuing.

Stop and reassess if the new shell API starts needing domain-specific props such as assignment status, test status, grading state, AI run state, student selection, rubric state, or return behavior.
```

### Workspace-State Review Prompt

Before opening the PR, answer:

```text
What is the owner identity for this async state?
Which late responses are now ignored?
Which state clears immediately on owner change?
Which regression proves A resolving after switching to B cannot repaint the UI?
```

## Async Grading

Applies when changing assignment/test AI grading, manual grading save flows, return flows, or background run processing.

- Model grading as resumable run state, not one long request.
- Keep ticks idempotent and bounded; each tick should have a narrow failure scope.
- Persist enough state to recover after reload and to summarize partial failure.
- Keep token controls explicit: structured output, bounded output caps, minimal prompt context, and reusable references where available.
- Test missing, empty, partial, failed, retryable, and recovered work states.

## Exam Mode

Applies when changing student test taking, fullscreen/maximize checks, focus/away tracking, overlays, or draft preservation.

- Derive lock state from a compliance snapshot, not a raw browser event alone.
- Use a grace window for transient fullscreen/resize/focus changes before locking or logging violations.
- Hide locked content instead of unmounting the active test form when draft preservation matters.
- Test transient loss, sustained loss, restoration, and unsaved open-response preservation.
- Verify teacher telemetry still distinguishes route exits, focus/away events, and window/fullscreen exits.

## Runtime Platform

Applies when changing cron, background work, deployment config, long-running routes, or Vercel behavior.

- Check current Vercel plan constraints before adding repo-managed schedules.
- On Hobby, Vercel cron schedules must run at most once per day.
- Prefer teacher-driven ticks or resumable foreground progress for sub-daily or interactive background work.
- Avoid routes that depend on one long request completing for bulk work.
- Document any platform assumption in the task notes or PR body.
