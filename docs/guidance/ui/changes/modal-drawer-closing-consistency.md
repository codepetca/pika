# Modal and navigation drawer closing consistency — 2026-10-09

User direction: proceed with the transition consistency pass, starting modal and drawer closing, using shared Pika patterns. Risk: workspace-state. Reference: ModalLayer opacity exit and Pattern Lab Dialog entry/Mobile drawer controls; same 200ms standard token and easing, immediate reduced motion. This authorizes audited opt-in adoption; generic effect-bearing drawers/editors retain immediate defaults.

First slice: teacher classroom Join QR dialog and teacher/student classroom navigation drawer. Desktop1440x900/mobile390x844, light/dark, normal/reduced. Drawer opening/closing, header/Escape/backdrop/navigation, rapid reopen, collapsed desktop rail, guarded navigation and focus/scroll restoration; QR closing after copy and changed/cleared parent props. Primary signal: existing panel/backdrop fades together. No scale/slide, new controls, delayed navigation, dependencies, server/data/role changes, or arbitrary descendant retention.

| Need | Existing candidate | Decision | Reason |
|---|---|---|---|
| Close/focus/isolation/scroll and presence | ModalLayer opacity opt-in | reuse | Existing canonical contract |
| Safe drawer adoption | LeftSidebar explicit exitMotion and mobile content slot | extend | Audited classroom navigation only; generic default stays immediate |
| Stable mobile labels | NavItems explicit expanded presentation | extend | Mobile labels stay visible through dismissal independent of live drawer context |
| Static modal | TeacherClassroomJoinQrDialog/DialogPanel | extend | QR SVG/text/buttons have no effect cleanup; parent copy/close unchanged |
| Reference evidence | MobileDrawerControlsPattern + guarded close fixture | extend | Render real owners deterministically with no identity/backend writes |

Lifetime: classroom NavItems has no component effects/requests/timers/editor; provider notification state stays parent-owned. Mobile content retains full labels even when logical drawer context closes. Generic LeftSidebar children and live RightSidebar Calendar editor stay default none; student Instructions retains Tiptap cleanup. Join QR uses effect-free SVG; TeacherSettings keeps owner mounted and clears notice immediately. Logical close, request/selection/URL guards and focus are never delayed. Closed visual root is inert/aria-hidden/pointer-disabled; reopening cancels exit.

Composite accessibility checklist required: yes. Focused semantic tests must demonstrate immediate logical close, retained passive presentation, blocked commands, visible full mobile labels, navigation guards, reopen cancellation and reduced motion. Native synthetic matrix records before/midpoint/after and natural timing without disabling animations; roles/viewports/themes/preferences declared. No new stable global default or whole-family/production performance claim. Existing experimental generic-adoption guidance remains scoped; this instruction accepts these audited adopters only. Privacy and1217 remain held.
