# Artifact first-focus scrolling

Surface: AssignmentArtifactsCell native button/link in the teacher assignment table.
Reference: `/pattern-lab?role=teacher#ui-consistency`, its settled artifact hint and
existing chooser; shared Tooltip owns unchanged stationary fast opacity.

| Need | Existing candidate | Decision | Reason |
|---|---|---|---|
| Hint disclosure and dismissal | Shared Tooltip / Radix | reuse | Retain provider, description, hover grace and immediate closing |
| Native focus reveal | Artifact button and anchor | extend | Forward keyboard focus to Radix after one frame, following browser scrolling |
| Activation and focus return | Native anchor / ContentDialog | reuse | Keep commands immediate and native keyboard navigation intact |

Primary signal: existing hint and focus ring. No layout, typography, timing token,
new shared primitive, dependency, API or schema change. The private native adapters
have no domain focus callback; any future domain callback must execute synchronously
inside that owner rather than being merged into the deferred Radix callback.

Matrix: teacher actual table, desktop1440×900/mobile390×844, light/dark,
normal/reduced motion; first Tab after horizontal reveal, single link/multiple
buttons, pending Escape/Tab/activation/blur/explicit scroll intent, settled
ancestor-scroll dismissal, chooser Enter/Escape and pointer interaction.
Student has no artifact table in this fixture; verify its unchanged shared hint
reference at both viewports/themes/motion settings. Composite checklist: yes.

The browser retains native focus/scroll. Only the received public `asChild`
Radix focus callback waits one frame. Before that callback Root has never opened,
so cancellation cannot leave provider close bookkeeping behind. Save the native
element separately; React clears the retained event's currentTarget. Pending work
is cancelled on intent, blur, hiding and unmount and rechecks focus/availability.
After acquisition all disclosure and scroll/Escape dismissal stay with Radix.

The pending frame reads the latest committed Radix handler. Hover may already
have opened Root; invoking an obsolete controlled-state closure could otherwise
close/reopen its owner and restart provider skip-delay reset. A real-Radix
regression covers that ordering without changing shared provider behavior.

Workspace-state identity: the connected native artifact control. Blur, unmount
and explicit intent cancel its frame; execution rechecks focus, visibility,
inertness and availability. No data request or feature workspace is remounted.
