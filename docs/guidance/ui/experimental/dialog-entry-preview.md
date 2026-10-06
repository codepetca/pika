---
status: experimental
scope: development-only dialog entry comparison
source_files:
  - src/app/__ui/DialogEntryPattern.tsx
  - src/app/__ui/DialogEntryPattern.module.scss
human_review_required: true
---

# Dialog entry preview

This is a bounded overlay-phase comparison within the active product-wide fluidity
goal. Risk: `workspace-state`. No production default or adopter changes.

Surface: deterministic ContentDialog entry in Pattern Lab, with fixed editable
content and a nested confirmation. Reference: canonical `/pattern-lab#controls`
and its ContentDialog QR example; approved selected-workspace opacity entry in
globals.scss and the existing semantic motion tokens. Workspace approval does not
promote dialog entry; this comparison remains experimental until human review.

| Need | Existing candidate | Decision | Reason |
|---|---|---|---|
| Dialog, focus, inertness, scroll and dismissal | ContentDialog / ModalLayer | reuse | Keep existing lifecycle and panelClassName seam; no new modal API |
| Quiet entry | Approved workspace opacity entry and semantic duration/easing | extend | Development-only overlay experiment; isolated class, no change to workspace entry or production defaults |
| Comparison evidence | Deterministic Pattern Lab example | create | Local preview composition, not a new shared production component |
| Draft and command controls | FormField, Input, Button and canonical dialog actions | reuse | Preserve shared targets, semantics and feature-owned local state |

Roles: teacher and student presentations of shared owner. Viewports: 1440×900
desktop and 390×844 mobile. Themes: light/dark. Motion: normal/reduced. States:
closed, immediate entry, quiet entry, immediate initial focus, typing/selection,
metadata rerender while open, body scrolling, nested dialog open/Escape, dismissal
during entry, reopen, and background scroll restoration.

Primary signal: a quiet 200ms opacity entry. No translation, scale, spring, stagger,
new scrim, exit retention, route delay, dependency or production default. Reduced
motion is immediate. Commands, focus and overlay isolation become available when
opened, independently of animation completion. The comparison must use an actual
ContentDialog panel rather than a decorative mock.

Acceptance: record current canonical runtime before preview implementation;
measure actual normal/reduced animation behavior, retain screenshots and natural
recordings, and inspect the full matrix. While open, draft node/value/caret and
content/page scroll survive typing and local metadata rerenders without replaying
entry. Nested Escape closes the top layer only. Close/backdrop/Escape and simulated
local destination selection during entry unmount immediately and restore focus
and environment. The destination command is a fixture callback, not proof of
production routing. Modal children currently unmount on close: retained backing
draft on reopen is distinct from node retention while open.

Composite checklist review required: dialog roles/names, focus containment/return,
top-layer Escape, immediately available commands and background inertness.
Guidance: DESIGN.md, src/ui/README.md, stable UI canon, change brief, experimental
rules and visual testing. Human promotion required: yes. AI may draft experimental
entries; promotion and main merge remain separate owner decisions.

Potential later adopters: teacher Dashboard attendance detail and student History
detail, both actual ContentDialog consumers. Adoption is deferred until direction
review; this PR cannot claim either route is improved. No auth, schema, API or
async-state identity changes. Real interaction performance and complete route/state
coverage remain separate requirements of the full goal.
