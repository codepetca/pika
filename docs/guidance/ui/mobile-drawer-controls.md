# Mobile drawer controls

Bounded delivery within the active product-wide fluidity goal. Risk: `workspace-state`.
Base: `c88abe16bb2acc5942f7b5430e296ea3bd09c37f`.

Surface: mobile dismissal controls in the existing LeftSidebar and RightSidebar.
Reference: `/pattern-lab#controls`, canonical `IconButton` and its ghost Button
variant; DESIGN.md minimum-target and focus contracts. Keep existing ModalLayer
behavior. Guidance: UI change skill, DESIGN.md, src/ui/README.md, stable UI canon,
change brief, composite-widget accessibility checklist and visual-testing guide.

| Need | Existing candidate | Decision | Reason |
|---|---|---|---|
| Navigation dismissal | IconButton with Lucide X, ghost variant | reuse | Named 44px control, shared focus and tooltip, forwarded initial-focus ref |
| Detail dismissal, standard and minimal headers | IconButton with Lucide ArrowLeft, ghost variant | reuse | Same immediate Back command and canonical interaction geometry |
| Drawer lifecycle | ModalLayer and ThreePanelProvider | reuse | Preserve focus trap/return, Escape, background inertness, scroll lock and responsive closure |
| Executable evidence | Pattern Lab rendering actual drawer owners | reuse | Fixed local content, no feature or backend behavior; outside existing golden contract region |

Primary signal: quiet dismissal icon, shared hover and focus feedback. No new
animation, API, dependencies, layout redesign, scrim migration or design promotion.
Experimental guidance introduced: no. Human promotion needed: no. Main merge and
production remain subject to their separate owner authorization.

Roles: teacher and student navigation drawers. Only `calendar-teacher` currently
enables RightSidebar in route configuration. The student assignment caller exists
but its configuration disables the owner, so this is not a live student detail
drawer claim. The deterministic shared-owner example uses the enabled Calendar
configuration in both role presentations; student RightSidebar results prove only
the shared owner composition, not a student production route.

Viewports: desktop 1440×900 and mobile 390×844. Themes: light and dark. Motion:
normal and reduced. States: closed/default, open/initial keyboard focus, hover,
tooltip, click/Enter/Escape/backdrop dismissal, draft preserved after reopen,
blocked home navigation and mobile-to-desktop resize. Minimal and standard right
headers both covered. Composite accessibility review: required, including Tooltip
Escape interaction and the forwarded focus ref; no semantics redesign.

Before production edits, measure actual control bounds and capture representative
baseline screenshots. Source predicts navigation 40px and Back 36px; these are
not runtime results yet. Then verify targets at least 44×44, immediate close,
focus return, scroll restoration and original input node/value/selection. Compare
with the canonical IconButton reference at matching viewport/state. Retain natural
recordings and screenshots, without updating unrelated golden images.

Nearby desktop sidebar toggle controls remain a future audit candidate. This slice
does not change shell sizing, route composition, draft ownership or desktop density.
Focused tests and UI/design policy checks precede the required focused gate and
draft-first, independently reviewed stable-SHA PR lifecycle. This delivery alone
does not complete the product-wide goal or establish production performance.

Baseline captured before production edits: all four mobile role/theme combinations
measured navigation 40×40 and both right header variants 36×36; canonical
IconButton measured 44×44. Existing keyboard outlines were visible. Twelve drawer
and four reference screenshots retained outside Git with runtime JSON provenance.
This is target-size and shared-feedback repair, not a claim of missing baseline
keyboard focus or production-route verification for student RightSidebar.
