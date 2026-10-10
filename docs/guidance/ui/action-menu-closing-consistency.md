# Page action menu closing consistency

Surface: the shared `PageActionBar` More actions menu in `src/ui/Page.tsx`.
Reference: stable page structure guidance and the actual owner rendered by
`/pattern-lab?role=teacher|student`, Page actions (`#page-actions`). Closing
lifetime follows `ModalLayer` retirement principles with the existing fast
motion token (150ms), rather than its standard dialog duration (200ms).

Roles: teacher and student. Teacher production adopters include dashboard,
Blueprints, and Course Guide; student verification exercises the actual shared
owner in Pattern Lab (no current student secondary-menu adoption claimed).
Viewports: desktop 1440×900 and mobile 390×844. Themes: light and dark.
Motion: normal and reduced, including preference changes during closing.
States: closed, keyboard focus, open, disabled item, closing, reopened,
selection-to-dialog handoff, changed/removed actions and owner unmount.

Primary signal: a restrained opacity fade on ordinary dismissal. Logical
dismissal, command retirement and focus return are immediate. A parent update
or owner removal ends retention immediately. Item-array identity is a
conservative ownership stamp; callers may therefore interrupt a fade on an
unrelated parent render. Retain only copied static labels/disabled/destructive
presentation, without retaining command callbacks.

| Need | Existing candidate | Decision | Reason |
|---|---|---|---|
| Menu closing | PageActionBar's private ActionBarMenu | extend | Existing real adopters share static string-label commands and one owner. |
| Duration/easing/reduced motion | Semantic fast motion tokens | reuse | Existing menu-scale timing and zero-duration preference path. |
| Lifetime safety | ModalLayer retirement policy | reuse | Immediate inertness and focus return; retained visual presence must not remain actionable. |
| Hydrated ID relationship | useDropdownNav mounted relationship deferral | reuse | Avoid the observed streamed useId mismatch without changing keyboard policy. |
| Executable reference | Pattern Lab Page actions | extend | Existing production owner demonstrates closing automatically; describe its contract. |

Exclusions: SplitButton, teacher work-surface action-cluster menus and arbitrary
React descendants; new dependencies, portals, layer tokens, business logic,
backend writes, production promotion and migrations. No new component or
decorative/spatial treatment. Preserve target size, geometry, grouping,
Tab-away behavior and local menu placement.

Composite-widget checklist reviewed: yes. Keyboard and semantic coverage are
required before acceptance: enabled-item arrows/Home/End, Escape/focus return,
matching hydrated IDs, aria-expanded, inert/hidden exiting menu, captured stale
commands, rapid reopen, owner/callback/availability changes, timer cancellation,
initial/mid-exit reduced motion and dialog focus handoff. Use focused semantic
tests and source-bound Playwright screenshots/videos across the declared matrix.
No screen-reader, production-hydration or live-backend acceptance is inferred.

Risk profile: `workspace-state` (UI presentation lifetime only). Ownership is the
committed incoming item-array identity plus the mounted PageActionBar. No async
request or completion behavior changes. Changed owners/availability clear the
closing snapshot before paint; controlled owner/callback replacement regressions
must prove stale commands cannot execute. Rich workspaces stay outside this
retained subtree. Stable guidance followed; no new experimental pattern or
guidance promotion is required.

Baseline source: main `03fca4506fa4359bec164638730a3cba3bf4097f`. Eight reference
contexts were captured before implementation. Baseline warning logs are retained
with the external evidence; they are not silently filtered or attributed to the
new transition. Prior Course Guide streamed-ID mismatch is a separate captured
baseline finding addressed within this owner.
