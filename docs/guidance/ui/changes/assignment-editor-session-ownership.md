# Assignment editor session ownership

Scope: teacher assignment authoring, async session state and original-resource parent publication. Risk: workspace-state. Approved references: actual AssignmentModal/AssignmentForm editor and Pattern Lab Content surfaces / Save status examples. Layout, save feedback and existing Instructions-preview motion retain their established owners.

| Need | Existing candidate | Decision | Reason |
|---|---|---|---|
| Editor geometry, inputs, history | AssignmentModal, AssignmentForm, Tiptap, CreationModalShell | reuse | Preserve editor identity and native undo within an open session |
| Saved/Saving/Unsaved and inline errors | SaveStatus, AssignmentForm error | reuse | Feedback describes the current editor operation |
| Async session ownership | AssignmentModal, useAssignmentScheduling | extend | Old success/error/finally/timer/flush callbacks cannot repaint or close a replacement owner |
| Original-resource publication | TeacherClassroomView assignment callbacks | extend | Publish appropriate original results while guarding the current classroom list and editor closure |
| Static preview exit | Existing ContentDialog opacity opt-in | reuse | Preserve approved immediate logical dismissal, focus and reduced-motion contracts |

The ownership boundary is external open lifetime, classroom and whole assignment prop identity. Internal assignment adoption from the current save/create remains in the same session. Existing external same-ID whole-object refresh reset semantics are preserved. Close, replacement and unmount invalidate old UI effects; new create owners start their own backing request. Active save coalescing, pending buffers, saved baselines, throttle timestamps and busy flags remain session owned.

Initiated save/release commands retain their original resource and command policy. Eligible stale successful manual save/release/discard-preservation results use their original callback with closeModal:false. Stale autosaves and backing creation do not publish. Late errors/finally cannot change current feedback or busy flags; a delayed old schedule-opening flush cannot reopen its dialog. Teacher parent callbacks preserve original cache invalidation and creation placement, while preventing old-classroom list writes/reloads that could supersede a replacement load. No transport abort, implicit abandoned-draft cleanup, new dependency, backend/API/schema or deployment change.

Teacher only; student n/a because its separate authoring/read owners are unchanged. Desktop1440×900 and mobile390×844; light/dark; normal/reduced motion. States: dirty autosave, close-save and reopen, stale response/error, create owner replacement, pending flush and scheduling, manual-save overlap, newer dirty buffer, subsequent correct-resource writes, parent publication and busy exclusion. Deterministic real-editor/hook/caller regressions cover these boundaries, with an existing dirty-buffer control preserved. API-isolated browser screenshots reproduce the old-error sequence naturally and verify current draft/save feedback plus preview focus/editor identity. Separate native preview contracts cover typing/undo and dismissal continuity. These are not authenticated persistence or hardware paint/INP measurements.

Composite checklist reviewed: dialog names and top-layer keyboard commands, initial/final focus, immediate outgoing inertness, editor identity/undo, save/error feedback and busy exclusion. No layout, color, spacing, shared motion default or new visual pattern is introduced.
