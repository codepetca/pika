# RepoLight feedback import interaction

Surface: teacher Assignment Repository report dialog. Reference: the existing
report dialog and Pattern Lab's shared Button disabled/loading states, governed
by DESIGN.md and src/ui/README.md. Preserve the current layout, controls, spacing,
focus and status region. No new shared component or visual pattern.

| Need | Existing candidate | Decision | Reason |
|---|---|---|---|
| Import completion state | AssignmentRepositoryReport | extend | Owns the reviewed preview and per-scope interaction state. |
| Action, select and layout | Shared Button/Select and existing dialog | reuse | Existing semantic, focus and responsive contracts fit. |

Primary signal: the action becomes disabled and reads “Added to comment draft”
after successful import of that exact preview in the current workspace session.
The workspace controller retains successful previews across dialog reopening,
keyed by owner, report reference/digest and contributor/repository scope. Editing
to new text enables a new explicit import; returning to an already-added preview
keeps it disabled. Failed imports retain the reviewed text and can be retried.
Different reports keep independent completion state. This is a workspace-local
repeat-click guard, not a permanent deduplication policy for all future feedback.
The server's request-ID replay, source checks and document revision guards remain.

Roles: teacher affected; student draft visibility must remain unchanged. Verify
desktop/mobile and light/dark, including successful disabled action, editing,
scope/evidence switches and failure retry. Composite widget accessibility review:
no new composite widget; preserve existing native controls and status semantics.
Do not add styling, icons, automatic sending, grading changes or provider calls.

Verification: regression first reproduced two failing assertions, then component
and hook tests passed after the fix. Authenticated synthetic pilot evidence and
visual captures remain private in the task worktree. Shared/production gates,
databases, credentials and deployment are outside this local verification.
