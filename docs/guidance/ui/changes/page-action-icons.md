# Creation and page action icons

User-approved refinement: creation entry points use a Lucide Plus icon with a contextual accessible name and tooltip; classroom loading retry uses RotateCw; PageActionBar secondary actions live in the far-right More actions menu. Primary actions stay visible and horizontally centered at every width, including creation and date controls. Menu choices and final form confirmations retain explicit text.

| Need | Existing candidate | Decision | Reason |
|---|---|---|---|
| Consistent named icon action | Button + Tooltip | create | IconButton composes both for classroom creation, test creation, announcements, retry, and page actions, including disabled/loading states. |
| Creation chooser | TeacherWorkSurfaceIconMenuButton | reuse | Existing accessible menu supports the classwork type choices. |
| Trailing action menu | PageActionBar / ActionBarMenu | extend | Keep shared keyboard/focus behavior and move secondary actions to one rightmost menu at all widths. |
| Centered controls | PageActionBar; TeacherWorkSurfaceContextBar | extend | Apply the approved teacher context bar's equal-side-column layout to PageActionBar; keep context left, controls centered, utilities right without absolute positioning. |
| Examples | Pattern Lab | extend | Render production owners with deterministic create/retry/action-menu examples. |

Reference: DESIGN.md, stable UI canon, Pattern Lab Core actions and page states, teacher work-surface icon menu. Roles: teacher and student. Viewports: 1440x900 and 390x844. Themes: light/dark. States: default, hover/focus tooltip, open menu, keyboard navigation/Escape, disabled/loading and error/empty. Main signal: simple icon with contextual label. No permission, mutation, data, exam, or deadline changes. No new dependencies. Composite review required: preserve menu roles, disabled skipping, focus return, and 44px targets. Refactor candidate: older feature-owned icon-button wrappers; leave unrelated controls alone.

Verification: focused checks passed (134 test files, 1,332 tests; architecture, UI/design policy, TypeScript and lint). Eight browser contracts passed across teacher/student × desktop/mobile × light/dark. Inspected screenshots confirm exact horizontal centering, right-aligned overflow, 44px targets, visible focus tooltips, disabled menu items and Escape focus return. The existing Daily date reference remains centered. Real classroom creation opens its dialog; announcement creation opens its editor without posting anything. Local review server: http://localhost:3004/pattern-lab#controls.

This is a local visual review, not a published change. Full Pattern Lab screenshot baselines intentionally remain unchanged until this visual direction is accepted; refresh and review both Darwin and Linux contract baselines before publishing a PR. The separate Daily and Student Tests redesign tasks are outside this worktree.
