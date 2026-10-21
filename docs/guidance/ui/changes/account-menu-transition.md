# Account menu transition consistency — 2026-10-20

Surface: authenticated AppHeader account menu for teacher and student. Reference: executable Pattern Lab Page actions (`page-action-icons-example`) and its shared semantic fast opacity transition. Primary signal: a quiet fade at a fixed position during opening and closing.

| Need | Existing candidate | Decision | Reason |
| --- | --- | --- | --- |
| Account menu presentation | UserMenu | extend | Align its existing transition with the shared action-menu motion |
| Timing, easing and reduced motion | Semantic fast duration and standard easing | reuse | Shared menu timing; reduced motion stays immediate |
| Keyboard, focus and logical close | useDropdownNav and existing UserMenu handlers | reuse | Preserve existing ownership and immediate hidden/inert state |

Keep the current menu, user information, controls, targets, theme handling, Feedback dialog and Logout semantics. This pass changes presentation only. Do not introduce a shared primitive, delayed command retirement, copied exit content, new dependency, backend change, or new visual treatment. Persistent hidden DOM is not itself a defect.

Verify teacher/student × desktop/mobile × light/dark × normal/reduced motion: natural open and close frames, stable panel position and size, shared duration/easing, immediate inaccessible/inert close, roving keys, Escape/toggle/outside/Tab dismissal, rapid reopen, theme change and Feedback open/Escape/trigger focus return. Never submit Feedback or Logout. Compare the unchanged Pattern Lab reference and goldens. Composite-widget accessibility review applies; preserve existing hydration relationships and closed Tab order.

Risk profile: workspace-state. Broad transition goal remains open after this pass; production and migrations remain outside its scope.
