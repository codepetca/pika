# Composite Widget Accessibility Checklist

Use this checklist when changing or reviewing any interactive composite UI, especially:

- tabs / tabpanels
- menus / action menus
- dialogs / drawers / popovers
- segmented controls and toggle groups
- split-pane separators and resizers
- listbox / combobox / option pickers
- teacher work-surface mode bars or multi-panel controls

This is the required accessibility gate before UI verify and before merge.

## Required Checks

- role relationships are complete
  - examples: `tab` -> `tabpanel`, trigger -> dialog/menu/popover, separator -> aria value attributes when draggable
- the active state is exposed semantically
  - examples: `aria-selected`, `aria-pressed`, `aria-expanded`, `aria-current`
- keyboard behavior matches the widget type
  - examples: arrow-key movement for tabs, escape to close overlays, tab order stays usable
- focus handling is intentional
  - opening a surface moves focus appropriately, closing returns focus to a sensible anchor, and focus remains visible
- labels and descriptions are explicit
  - controls have accessible names, grouped controls expose a group label, and supporting copy is connected with `aria-describedby` where needed
- state changes are not color-only
  - if the UI changes state visually, the same state is available through text, semantics, or both
- tests cover the semantics that matter
  - prefer `getByRole(...)`, attribute assertions, and keyboard interaction checks over class-based assertions

## Minimum Review Note

When this checklist applies, the task note, PR note, or audit response should say:

- checklist reviewed: yes
- keyboard behavior covered: yes/no
- semantic state covered by tests: yes/no
- remaining manual follow-up: none or explicit item

## Testing Guidance

- add or update component tests when roles, relationships, or keyboard behavior change
- keep assertions semantic:
  - `role`
  - `aria-*`
  - focus movement
  - visible labels tied to controls
- still run Playwright UI verification for visual changes; this checklist does not replace screenshots
