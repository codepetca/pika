# Split menu closing consistency

Extend the existing SplitButton owner with an optional fast opacity exit for audited plain-text menus. Reference: shared PageActionBar closing and executable Pattern Lab Page actions, Material creation and UI consistency owners. This is a refinement of the shared menu contract; no new pattern promotion is needed.

| Need | Existing candidate | Decision | Reason |
| --- | --- | --- | --- |
| Closing timing/easing/reduced motion | Shared menu fast opacity contract | reuse | Semantic fast duration and standard easing; reduced motion removes immediately |
| Menu command/focus lifetime | SplitButton | extend | Logical close retires commands, hover, listeners and keyboard ownership before visual expiry |
| Material action chooser | MaterialCreationDialog | extend | Plain-text options with saving/read-only/unmount boundaries |
| Role reference | Pattern Lab UI consistency SplitButton | extend | Actual shared owner with deterministic options; no new production student adopter claim |

Surface: SplitButton menus. Roles: teacher production Material chooser; teacher/student shared-owner Pattern Lab references. Viewports: desktop1440x900 and mobile390x844. Themes: light/dark. States: closed/open/focused/selected/disabled, normal/reduced closing, rapid reopen, owner change/unmount and dialog handoff. Primary signal: restrained opacity. Preserve geometry, 44px targets, grouping, roving focus, checked/destructive semantics, placement and Tab-away behavior. No new symbols, ornaments, global layers, dependencies or persistence logic.

Default exit remains immediate. Opacity is eligible only when every option has a string or number label and no non-null caller icon. Copy only primitive presentation fields; never retain arbitrary ReactNode children or live option/hover commands as render content. Internal checked artwork is owned and pure. Rich labels/icons fall back to immediate removal even when opacity is requested.

Logical close immediately invalidates commands/hover callbacks and outside/focus listeners. Retained presentation is inert, aria-hidden and cannot dispatch captured click/key/pointer/hover events. Escape/toggle focus and selection-to-dialog handoff remain timely; expiry never restores focus. Any options identity change while closing, disabled/inactive/empty/all-disabled state or unmount removes immediately and clears timers/media listeners. Reopening uses current options and cancels obsolete expiry. Read the computed semantic fast duration, including ms/s, zero/malformed fallback; reduced motion initially or during exit removes immediately.

Composite accessibility checklist required: roles/relationships, keyboard/Tab, focus, active/checked state, disabled skipping, semantic and direct dispatched-event tests. Visual verification uses production owners with fixed fixtures and read-only network guards. Native captures do not establish live persistence, screen-reader or production behavior.

Excluded this pass: TeacherWorkSurfaceActionMenuButton, rich/hover-enabled production menu adoption, RightSidebar editors, other dialog/form exits, auth/business/backend/migrations/production. Nearby menu lifetime duplication remains a later extraction candidate only after at least two owners share a proven narrow contract.
