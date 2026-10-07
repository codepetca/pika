# Teacher assignment editor dismissal

The main teacher AssignmentModal uses the existing 200ms opacity exit. Logical
close still releases focus, scroll and accessibility ownership immediately. The
outgoing text and field geometry remain visible while their commands, portals,
editor updates and drag sensors retire. Reduced motion removes the view immediately.

Reference: canonical ModalLayer/DialogPanel semantic motion and the development
Pattern Lab DialogEntryPattern. The actual AssignmentModal/Form, SaveStatus and
Instructions surfaces remain the presentation owners. This individually audited
feature adoption does not promote a wider generic editor pattern or change entry
motion. It supersedes the immediate whole-editor-close description in
[Instructions preview dismissal](assignment-instructions-preview-exit.md).

| Need | Existing candidate | Decision | Reason |
|---|---|---|---|
| Opacity, stack, focus and reduced motion | ModalLayer/DialogPanel | reuse | Existing reviewed contract and standard token |
| Optional forwarding | CreationModalShell | extend | Immediate default; audited AssignmentModal opts in |
| Current activity outside frozen presentation | AssignmentModal feature body | extend | Context retires inputs while retaining committed outgoing values |
| Fresh reopen and retained same-open history | AssignmentModal/Tiptap | extend | Remount the body only on logical reopen; preserve same-open undo |
| Nested controls and deferred focus | Real toolbar, SplitButton and requirement owners | extend | Remove portals, listeners and callbacks without changing field styling |
| Visible assignment actions | SplitButton upper placement | reuse | Keep both options inside the clipped creation panel without scrolling its title |
| Active and pending drag cleanup | Exported dnd-kit Sensor protocol | create | Feature-owned sensors can cancel resources that built-in context unmount leaves behind; no new shared widget |
| Existing Blueprint provenance | ClassroomBlueprintDraftSource | extend | Keep already displayed text on this caller's close and reject late publication |
| Native verification | Gated teacher assignment fixture | extend | Real owner with a deterministic parent; all APIs intercepted |

Teacher only; student n/a because its authoring owner is unchanged. Required
matrix: desktop1440×900 and mobile390×844, light/dark, normal/reduced motion.
States include header, Escape and backdrop close; nested Instructions, Remove,
toolbar and action menus; manual Draft and confirmed Post closure; dirty focused
inputs, pending provenance and initiated commands; active/pending mouse, touch
and keyboard drags; owner refresh, rapid reopen, unmount and preference change.
Primary signal: quiet opacity, without scale, translation or a new duration.

The feature context carries logical activity and a rollback-safe requirement
owner generation outside ModalLayer's snapshot. Interaction guards publish during
commit, before closing focus cleanup, so suspended or abandoned renders leave the
visible editor and active drag functional. Requirement owners retire on an
external classroom or assignment-object refresh without remounting the rich editor. Same-ID whole external object refresh
keeps its existing field-reset behavior. Already initiated A save/release commands
retain their existing A ownership; new outgoing inputs cannot affect B.

RichTextEditor retires the actual toolbar and uses its existing 44px strip height
for the passive presentation. Ordinary callers remain interactive by default.
SplitButton retires document listeners and deferred focus. Assignment actions
use its existing upper menu placement; visual verification checks every option's
panel bounds and unchanged title position. The feature's sensors
implement the public dnd-kit protocol, retaining public activators, sortable
coordinates and scroll behavior. Their owner cancels pending activation, active
listeners and normal pointer-drop click tails on retirement/unmount. Keyboard
attachment is immediate and ignores its activating event so the next arrow has
no attachment gap. Adapted movement code carries MIT attribution. No private
library instance access, global cancellation events or dependency changes.

Composite accessibility checklist: named dialog/menu controls, top-layer Escape,
keyboard navigation, current initial/final focus, immediate hidden/inert outgoing
controls, noneditable outgoing instructions, scroll release and stale callback
fences. Component tests cover ownership, undo, input and real drag liveness during
suspended or abandoned closes, and reduced preference changes. Native checks must activate actual sensors before
asserting cleanup; mere DOM disappearance is insufficient.

Verification uses the development-only fixture, including an external close,
saved requirements refresh and a parent publication counter. It is a controlled
teacher-parent simulation, not authenticated persistence. Natural opacity uses
real animation frames and compositor screenshots; no paused or fabricated
midpoints. Local evidence does not measure hardware paint/INP. Wider editor
adoptions still require their own descendant and lifetime audits.
