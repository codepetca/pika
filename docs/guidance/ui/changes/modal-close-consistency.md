# Modal close consistency — 2026-10-22

Owner requested top-right X dismissal consistently across the app. Reference:
existing QR dialog corner controls and shared ContentDialog; use canonical
44px Button, ghost treatment, Lucide X, right-3/top-3 inset.

| Need | Existing candidate | Decision | Reason |
| --- | --- | --- | --- |
| Close action appearance | Button | reuse | Accessible name, native Close tooltip, focus and 44px target without introducing a TooltipProvider dependency into standalone dialogs |
| Modal close position | DialogCloseButton | create | Shared dialogs, creation shells and legacy modal owners all adopt it |
| Dismissal guards | DialogPanel / ContentDialog | extend | Button, Escape and backdrop share closeDisabled |
| Editor layout | CreationModalShell | extend | Reserve horizontal space in existing title/control rows and remove close duplicates |

Scope: dismissible dialog windows, including creation/edit, previews, alerts,
confirmations and custom dialog panels. Side drawers, inline pane dismissal,
remove-item X controls and non-dismissible pending operations retain their
semantics. Close uses the existing cancellation/save-flush callback; it never
confirms a destructive operation. Do not change mutation payloads or auth.

Teacher/student, desktop1440×900/mobile390×844, light/dark. Verify default,
long-title, scrolling, nested, busy/disabled, keyboard/focus and retained exits.
Primary signal: the one consistent corner X. No decorative close styling.
Composite accessibility checklist required: names, one icon close, focus return,
Escape/backdrop/busy parity. Owner request promotes this as stable modal guidance.

Implementation evidence: shared DialogCloseButton; all shared dialog families,
creation editors, legacy submission/add-student dialogs, reward and test preview
owners adopt the corner convention. Horizontal clearance in existing rows prevents title/control
collisions without an empty header band. The executable `/pattern-lab#modal-close` covers all five families.

Verification: teacher/student × desktop/mobile × light/dark screenshots inspected;
44px target, 12px corner inset, scrolling, disabled dismissal and focus return
covered in Playwright. Production assignment/test/survey fixtures also exercise
save/preview/close paths. Unit coverage checks cancellation, busy guards and one
modal-owned close. Artifacts: local visualization folder `modal-close/` and
`modal-editor-layouts/` under the task's 2026-10-22 visualization directory.

## Compact header refinement — 2026-10-22

Owner requested a compact header without a close-only band. Headerless creation/edit shells place
X alongside existing top controls (Write / Markdown for assignments), with no
additional vertical row. On stacked mobile layouts the title field reserves the
corner; desktop control rows reserve it instead. Visible dialog headings keep X
in that same heading row. Keep one 44px target outside the scroller, existing
callbacks/guards and accessible labels. Reference: current assignment mode row,
Pattern Lab assignment/test/survey/material editors and modal-close examples.

| Need | Existing candidate | Decision | Reason |
| --- | --- | --- | --- |
| Corner action | DialogCloseButton | extend | Allow creation-shell inset to match existing responsive form padding |
| Empty header removal | CreationModalShell | extend | Only render a heading row for visible titles/metadata; reserve inline control space |
| Inline clearance | Existing editor/title rows | extend | Semantic class hooks reserve horizontal space only in compact creation shells |

Both roles, desktop/mobile, light/dark; verify mode switching, long titles,
question menus, source mode, scroll, busy guards and focus. Primary signal remains
the shared corner X; must not add another row or another close control.

Compact creation callers mark the mobile title field with `modal-title-field`,
the desktop top control row with `modal-controls-row`, centered question grids
with `modal-question-controls-row` (clear only the trailing actions), or the wrapper around
the first rich-text toolbar with `modal-toolbar-row`. CreationModalShell scopes
clearance to those rows only; inline editors outside that shell retain their
layout. Visible headings/metadata retain their own existing row.

Existing compact title/control rows stay sticky within the editor's actual
scroller so moving through long content never places X over another card.
Use the existing local sticky layer beneath the close/menu layer. The survey
fixture must match the production workspace's full-height grid scroll owner.

Compact shells isolate each rich-text editor's internal stacking context so its
sticky toolbar stays beneath question menus in the existing control rows. This
retains existing layer tokens and the panel-owned X above both.
