# Success alert alignment

User requested removal of the checkmark from Pattern Lab's Open alert dialog because it shifts the text off-center. Reference: canonical default AlertDialog's icon-free layout, shown through the same Pattern Lab owner.

| Need | Existing candidate | Decision | Reason |
|---|---|---|---|
| Balanced success message | AlertDialog default layout | reuse | Remove the decorative success icon and its existing conditional indentation; title, description and action share the same content width. |

Scope: success alerts across teacher and student surfaces. Keep the success variant API, title/description semantics, focus, dismissal, button styling and auto-dismiss unchanged. Error alerts retain their current error icon and warning treatment. No new primitives, icon styles or dependencies.

Verification: teacher/student × desktop/mobile × light/dark; text/action alignment, alert accessible name/description, initial focus, Escape/button dismissal and focus return. Existing unit tests retain error-variant and auto-dismiss coverage. Pattern Lab directly uses the production owner. This is a bounded presentation fix; no API or data changes.

Completed: removed SuccessIcon from the shared AlertDialog; the existing conditional margins now resolve to the default, unindented layout for success. Forty dialog/gallery unit tests and UI/design policy, TypeScript and lint pass. Eight Playwright checks passed across both roles, viewports and themes; inspected all captures, confirmed aligned title/description/action, centered full-width action, accessible description, initial focus and dismissal/focus return. Evidence: session visualization folder alert-alignment, captured locally on 2026-08-31 from this uncommitted worktree using fixed Pattern Lab copy. Compared against the previous dialog screenshot. Error alerts remain unchanged. Full Pattern Lab screenshot-baseline acceptance remains part of the existing pre-publication work.
