# Shared interaction fluidity

Owner: chat `01a10bfa-17e1-76d2-9483-af955a51a9fd`, branch
`codex/product-fluidity`, source `84a657ebe`. This is the first continuation slice
of the [product-wide plan](../fluid-classroom-plan.md).

Surface: shared controls, classroom tab content and the account menu. References:
Pattern Lab Controls/Selection controls/Page states; accepted quiet opacity entry
from the classroom rollout; teacher action-menu keyboard and opener-focus contract.
The coordinator inspected the live Pattern Lab reference before implementation.
Roles: teacher/student; unauthenticated Button/PageState consumers also affected.
Viewports: desktop/mobile. Themes: light/dark. States: default, hover, focus,
selected/revisited tabs, open/closed menu, feedback dialog, loading and reduced motion.
Primary signal: existing selected color/underline and quiet opacity entry.
Do not add ornamental signals, springs, delayed exits, rekeyed editor wrappers,
new data reads or navigation/state ownership. No modal lifecycle changes.

| Need | Existing candidate | Decision | Reason |
| --- | --- | --- | --- |
| Control color response | Button, Tabs, SegmentedControl, Card, table primitives, AppNavigation | extend | Use existing semantic timing/easing and reduced-motion contract without delaying state |
| Loading feedback | Button, PageState; IconButton reference | extend | Keep labels/busy state with a static indicator when motion is reduced |
| Tab entry | TabContentTransition; existing workspace-entry opacity treatment | extend | Active-only entry with stable children and immediate hidden/inert inactive content |
| Menu keyboard/focus | UserMenu and useDropdownNav; teacher action cluster | extend | Local roving tabstop and visible feedback-dialog opener; no shared hook rewrite |
| Timing and themes | Existing tokens and semantic surfaces | reuse | Preserve governed foundation values |
| Executable demonstration | Pattern Lab real owners | extend | Show the shared tab wrapper in its experimental example and actual account-menu flow deterministically |

Guidance read: DESIGN, UI README/stable/change brief, composite checklist,
architecture/tests and visual guide. Existing foundation rules followed. The
broader tab-entry adoption is a proposed design extension; its preview and evidence
need human acceptance before stable promotion/merge. Stable canon is unchanged.
Risk: workspace-state. Composite accessibility review required: yes.

Acceptance: normal controls use existing durations; reduced controls transition
immediately and loading indicators remain static with labels intact. Tab activation
changes content immediately, performs quiet entry, and does not replay on typing or
refresh. Deactivation hides/inerts immediately without unmounting children. Draft
control identity, caret, scroll and caller-owned focus remain intact. Account-menu
Arrow/Home/End/Escape behavior, single tabstop, closed inertness and feedback close
restore usable focus. Both-role desktop/mobile light/dark and normal/reduced motion
captures compare unchanged control/layout geometry with the reference. Recordings
and animation samples must be labeled local evidence, not production performance.

Verification and stable-SHA review results will be recorded in the PR and owning
chat artifact. No dependency or deployment change is included.
