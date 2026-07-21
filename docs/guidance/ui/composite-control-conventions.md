# Composite-Control Conventions

Use the governed contracts below for multi-control interactions. A matching visual treatment is not
enough: role relationships, roving focus, disabled-item behavior, and keyboard operation belong to
the shared primitive or hook.

## Tabs

- Use `Tabs` from `@/ui` for horizontal tab lists. It owns `tablist`/`tab`, automatic activation,
  one tab stop, disabled-item skipping, `ArrowLeft`/`ArrowRight`, `Home`, and `End`.
- Supply stable tab and panel IDs whenever the surface renders tabpanels. Use `TabPanel` to connect
  the active panel to its tab. Panels containing interactive controls remain outside the tab order;
  use `focusable` only when the panel itself needs to receive focus.
- Tab lists scroll horizontally at narrow widths and tabs do not shrink, so labels remain legible
  without creating page-level overflow.
- Use the `connected` variant for a tab attached to a work surface and `underline` for tabs inside a
  dialog or bounded editor.
- Do not use tabs for commands or for controls whose content does not replace a related panel.

## Menus

- Product menus using local rendering must use `useDropdownNav`; editor-owned Radix menus retain
  their editor contract.
- Triggers expose `aria-haspopup="menu"`, `aria-expanded`, and `aria-controls`. Items use `menuitem`
  and one roving tab stop.
- `ArrowUp`/`ArrowDown`, `Home`, and `End` move among enabled items. `Escape` closes and restores
  trigger focus; `Tab` closes without trapping focus.
- A set of visible navigation links is navigation, not a menu. Do not add menu roles only for
  styling.

## Segmented Controls

- Use `SegmentedControl` from `@/ui` for a small, single-selected set of peer display or mode
  options that does not own tabpanels.
- The group has an explicit name, each option exposes `aria-pressed`, and only the selected enabled
  option is in the tab order.
- Arrow keys select and focus the next enabled option; `Home` and `End` select the first and last.
- Use `Tabs` instead when the options switch tabpanels.

## Tables

- Import `DataTable` and its related primitives from `@/ui`. The old component path is a temporary
  compatibility export only.
- Sortable headers expose `aria-sort`, a normal button name, a 44px target, and a visible focus ring.
- Wrap row-selectable tables in `KeyboardNavigableTable` with a feature-specific `ariaLabel`.
  `ArrowUp`/`ArrowDown`, `Home`, and `End` change selection; `Escape` clears it when supported.
- Supply `getRowId`, apply the matching ID, `tabIndex={-1}`, and `aria-selected` to each selectable
  row. Keyboard selection moves focus to that row so assistive technology announces its content;
  row key events bubble to the named region for continued navigation.
- Focusable column-resize separators expose their numeric range and provide a 44px pointer target
  without enlarging the visible divider.
- Horizontal scrolling belongs in `TableCard overflowX`; responsive workflow modes must not hide
  data solely to make a desktop table fit.

## Split Panes

- Use `WorkspaceSplitPane` or its governed composition wrappers for resizable workspaces.
- Every visible drag divider is a focusable vertical `separator` with a name, `aria-valuemin`,
  `aria-valuemax`, `aria-valuenow`, and keyboard resizing.
- Arrow keys resize by a documented step. `Home` and `End` move to the allowed bounds when the
  caller exposes those commands; double-click may reset to the product default.
- Pointer and keyboard paths must use the same clamping rules and update the same controlled value.

## Verification

- Direct tests assert roles, relationships, roving tab stops, semantic state, disabled-item
  skipping, focus movement, and keyboard activation.
- Representative callers are verified at desktop and mobile widths in light and dark themes.
- Complete the composite-widget checklist before merge and record any manual exception explicitly.

## Reference Surfaces

- Shared tabs: `src/ui/Tabs.tsx`
- Shared segmented control: `src/ui/SegmentedControl.tsx`
- Shared table: `src/ui/DataTable.tsx`
- Shared menu behavior: `src/hooks/use-dropdown-nav.ts`
- Shared split pane: `src/components/WorkspaceSplitPane.tsx`
- Teacher connected tabs: `src/components/teacher-work-surface/TeacherWorkSurfaceModeBar.tsx`
- Test document tabs and question/markdown split: `src/components/TestDocumentsEditor.tsx`,
  `src/components/TestDetailPanel.tsx`
