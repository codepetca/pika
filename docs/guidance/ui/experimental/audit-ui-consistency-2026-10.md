# UI consistency change brief — 2026-10-04

Experimental verification record; no stable-canon promotion.

Surfaces: shared SplitButton action menus, legacy teacher calendar read states, teacher assignment artifact table cells.
References: shared Tabs/SegmentedControl scoped and roving keyboard ownership; Pattern Lab page states and PageState; Attendance operational table density; existing artifact pills and chooser.
Roles: shared SplitButton teacher + student; calendar and AssignmentArtifactsCell teacher only (student n/a: neither owner is rendered in student workflows).
Viewports: desktop 1440×900 and mobile 390×844. Themes: light + dark.
States: menu open, arrow navigation, disabled option, Escape focus return, Tab/focus exit, external input caret; calendar loading/list error/scope error/retry/empty/success and late A→B completion; single/multiple artifact, focus, hover, chooser, dense wrapping.
Primary signal: existing menu elevation, PageState error/retry, compact artifact pill within the standard target geometry.
Exclusions: no new design language, stable guidance edits, auth/DB/provider/dependency changes, or unrelated UI migration.
Composite accessibility review: required; scoped navigation, roving focus, usable Tab exit, Escape return, accessible names and visible focus are acceptance criteria.

| Need | Existing candidate | Decision | Reason |
|---|---|---|---|
| Menu navigation | SplitButton with Tabs/SegmentedControl keyboard precedent | extend | Stable behavior for current consumers without a new menu owner |
| Failed/empty calendar reads | PageState | reuse | Error, loading and empty remain distinct within the existing utility route |
| Artifact interaction | AssignmentArtifactsCell + canonical control target/focus tokens | extend | Retain domain labels, compact visual pill and chooser while enlarging targets |
| Executable evidence | Pattern Lab production-owner fixtures | extend | Deterministic menu/artifact examples; calendar owner verified with intercepted read fixtures |

No experimental pattern is being promoted. This record documents enforcement of existing stable contracts. Nearby legacy calendar native controls remain outside this bounded state fix.

Browser correction: the production assignment table’s fixed columns left less than one target’s width at 390px. The consumer now derives a minimum table width from its resizable columns, the shared target token and artifact-cell padding, with horizontal scrolling contained inside TableCard. Desktop artifact width remains flexible. Final browser assertions must cover 44px targets contained inside their cells and no document overflow.
