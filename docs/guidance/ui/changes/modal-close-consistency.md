# Modal close consistency — 2026-10-22

Owner requested top-right X dismissal consistently across the app. Reference:
existing QR dialog corner controls and shared ContentDialog; use canonical
44px Button, ghost treatment, Lucide X, right-3/top-3 inset.

| Need | Existing candidate | Decision | Reason |
| --- | --- | --- | --- |
| Close action appearance | Button | reuse | Accessible name, native Close tooltip, focus and 44px target without introducing a TooltipProvider dependency into standalone dialogs |
| Modal close position | DialogCloseButton | create | Shared dialogs, creation shells and legacy modal owners all adopt it |
| Dismissal guards | DialogPanel / ContentDialog | extend | Button, Escape and backdrop share closeDisabled |
| Editor layout | CreationModalShell | extend | Reserve a non-scrolling corner area and remove left-title close duplicates |

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
owners adopt the corner convention. Non-scrolling header space prevents title
collisions. The executable `/pattern-lab#modal-close` covers all five families.

Verification: teacher/student × desktop/mobile × light/dark screenshots inspected;
44px target, 12px corner inset, scrolling, disabled dismissal and focus return
covered in Playwright. Production assignment/test/survey fixtures also exercise
save/preview/close paths. Unit coverage checks cancellation, busy guards and one
modal-owned close. Artifacts: local visualization folder `modal-close/` and
`modal-editor-layouts/` under the task's 2026-10-22 visualization directory.
