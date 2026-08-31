# Pika Design System (`/ui`)

This directory contains the canonical UI primitives for the Pika application.

**All app code must import from `@/ui`, not from legacy `@/components/*` paths.**

The development-only `/pattern-lab` renders these owners with deterministic fixtures and
records approved icon/status usage. Update its catalog when a stable primitive contract or
cross-product symbol meaning changes. The component implementation and this API reference remain
authoritative over the gallery.

Root [`DESIGN.md`](/DESIGN.md) owns global design principles and authority.
This file owns canonical component APIs and semantic-token usage; executable
values remain in [`src/styles/tokens.css`](/src/styles/tokens.css).

---

## Quick Start

```tsx
import { Button, Input, Select, FormField, AlertDialog, ConfirmDialog, Card, Tooltip, useAppMessage } from '@/ui'

// Form controls are always wrapped by FormField
<FormField label="Email" error={errors.email} required>
  <Input type="email" value={email} onChange={...} />
</FormField>

<FormField label="Country" error={errors.country}>
  <Select options={countries} value={country} onChange={...} />
</FormField>
```

---

## Canonical Component APIs

### Button

```typescript
interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'surface' | 'subtle' | 'danger' | 'success' | 'ghost'
  size?: 'xs' | 'sm' | 'md' | 'lg'
  loading?: boolean
  fullWidth?: boolean
}
```

### Input (bare - no label/error)

```typescript
interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  // No label or error - those come from FormField
}
```

### Select (bare - no label/error)

```typescript
interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  options: Array<{ value: string; label: string; disabled?: boolean }>
  placeholder?: string
  // No label or error - those come from FormField
}
```

### FormField (wraps ALL form controls)

```typescript
interface FormFieldProps {
  label: string
  htmlFor?: string
  error?: string
  hint?: string
  required?: boolean
  children: ReactElement  // Exactly one Input, Select, Textarea, etc.
}
```

`FormField` preserves a control-provided `id` unless an explicit `htmlFor` override is supplied, associates the label, propagates native `required` plus ARIA required/invalid state, and merges existing descriptions with hint and error ids. Hints remain available when an error is present. Pass exactly one form control as its child.

### AlertDialog

```typescript
interface AlertDialogProps {
  isOpen: boolean
  onClose: () => void
  title: string
  description?: string
  variant?: 'default' | 'success' | 'error'
  buttonLabel?: string
  autoDismiss?: boolean
}
```

### ConfirmDialog

```typescript
interface ConfirmDialogProps {
  isOpen: boolean
  onCancel: () => void
  onConfirm: () => void | Promise<void>
  title: string
  description?: string
  confirmLabel?: string
  cancelLabel?: string
  confirmVariant?: 'primary' | 'danger'
  isCancelDisabled?: boolean
  isConfirmDisabled?: boolean
}
```

### ModalLayer

`ModalLayer` is the behavioral foundation for canonical dialogs and mobile drawers. Prefer `AlertDialog`, `ConfirmDialog`, `ContentDialog`, or `DialogPanel` for normal product work. Use `ModalLayer` directly only for a custom modal surface such as a navigation or inspector drawer.

### QrCode

`QrCode` renders a machine-readable dark-on-light code in both themes. Pass the
absolute public URL as `value` and a concise accessible `label`; do not style a
feature-local QR with theme-dependent foreground/background colors.

The primitive portals to `document.body`, focuses the requested initial control, contains Tab focus, restores the opener, makes background roots inert, locks page scroll, and ensures only the top nested layer handles Escape. Callers provide the panel layout and accessible label; they must not add separate global Escape or scroll-lock effects.

### Card

```typescript
interface CardProps {
  children: ReactNode
  tone?: 'default' | 'muted' | 'panel' | 'accent' | 'selected'
  padding?: 'none' | 'sm' | 'md' | 'lg'
  interactive?: boolean
  className?: string
}
```

### Page structure

Use the page primitives from `@/ui` instead of feature-local width, gutter, heading, or action-bar
wrappers:

```tsx
<PageLayout density="teacher" width="standard">
  <PageActionBar
    primary={<PageHeading title="Assignments" />}
    actions={actions}
  />
  <PageContent>
    <PageStack>{content}</PageStack>
  </PageContent>
</PageLayout>
```

- `PageLayout` owns the `reading`, `standard`, `wide`, and `full` content-width contract.
- `density="teacher"` preserves Pika's compact operational spacing; `student` provides the
  standard content rhythm. The default remains compact for compatibility while callers migrate.
- `PageHeading` owns page/section heading level and typography. Do not add feature-local page-title
  sizes.
- `PageActionBar` keeps primary context and actions on one row, renders full actions on desktop,
  and uses the keyboard-accessible overflow menu on mobile.
- Action-bar controls and menu items preserve the shared 44px target and focus-visible treatment.

### Page states

Use `PageState` for the primary `loading`, `error`, `empty`, or `forbidden` state of a route or work
region. Keep the surrounding app/classroom shell mounted, and never render an empty state from a
failed request.

```tsx
<PageState
  kind="error"
  title="Could not load classrooms"
  description="The classroom list could not be retrieved."
  action={<Button onClick={retry}>Try again</Button>}
/>
```

- Initial loading uses `kind="loading"`; non-blocking refreshes use `RefreshingIndicator`.
- Error and forbidden states use assertive semantics; loading and empty states use polite status
  semantics.
- Use `compact` only when the state replaces a primary region in an existing workspace.
- Route and retry rules live in
  [`page-state-conventions.md`](/docs/guidance/ui/page-state-conventions.md).

### Application navigation

Authenticated route families use `AppShell` with an `AppNavigation` region instead of defining
their own logo, account controls, link styling, or responsive navigation wrapper. Navigation items
keep their existing product labels and route ownership; the shared mechanism supplies active-page
semantics, keyboard focus treatment, 44px targets, and narrow-width horizontal overflow.

Application navigation is app-specific composition and remains in `src/components/`, while its
base controls and shell styling follow the `@/ui` contracts.

### Composite controls

- Use `Tabs` plus `TabPanel` for panel-switching navigation. The tab list owns roving focus,
  automatic activation, arrow keys, `Home`/`End`, disabled-item skipping, narrow-width scrolling,
  and 44px targets. Panels with interactive descendants are not additional tab stops.
- Use `SegmentedControl` for a small selected group that does not own tabpanels. It exposes pressed
  state and the same roving arrow/first/last keyboard behavior. Options may provide semantic
  `className`, `activeClassName`, and `inactiveClassName` overrides when the feature's established
  status colors carry domain meaning; the shared control continues to own targets, focus, and keys.
- Use the app-level `DateNavigator` from `@/components/DateNavigator` for previous/date/next scope
  controls. Callers retain date calculations and picker behavior; the shared composition owns the
  control geometry and accessible labels. Use its joined treatment when the date is the centered
  actionable scope in a teacher context bar.
- Import `DataTable`, `SortableHeaderCell`, `KeyboardNavigableTable`, and related table primitives
  from `@/ui`; keyboard-selectable tables require a feature-specific accessible name and matching
  row IDs so keyboard selection can move focus to the active row.
- Pass a `resize` configuration to `SortableHeaderCell`, or use `ResizableHeaderCell` for a
  non-sortable column, when a table exposes adjustable widths. The shared resize handle owns the
  vertical separator semantics, min/max/current values, pointer drag behavior, and
  Arrow/Home/End keyboard controls; feature tables continue to own their column limits and cells.
- Use `useTableColumnWidths` for controlled column widths. Operational tables may provide a
  feature-owned storage key so width preferences persist locally; static previews should keep
  natural widths and avoid resize controls.
- Use `useTableSelection` with `TableSelectionHeaderCell` and `TableSelectionCell` when selected
  rows feed a real batch action. The shared header checkbox exposes the native indeterminate state.
  Do not add checkboxes to read-only previews or tables where row selection only opens an inspector.
- Keep domain behavior in feature code. The shared table layer owns structure, sorting controls,
  resizing, selection controls, and keyboard navigation; it is intentionally not a universal
  data-grid component.
- Menu and split-pane ownership, semantics, and verification requirements live in
  [`composite-control-conventions.md`](/docs/guidance/ui/composite-control-conventions.md).

### EmptyState

```typescript
interface EmptyStateProps {
  title: string
  description?: ReactNode
  action?: ReactNode
  icon?: ReactNode
  className?: string
  tone?: 'default' | 'muted' | 'panel' | 'accent'
}
```

### Tooltip

```typescript
interface TooltipProps {
  content: ReactNode
  children: ReactNode
  side?: 'top' | 'right' | 'bottom' | 'left'
  align?: 'start' | 'center' | 'end'
  delayDuration?: number
}
```

### AppMessage

`AppMessageProvider` is mounted from the root layout and owns the one-at-a-time message overlay centered in the global title bar. Use it only for short transient feedback such as loading, refreshing, progress, copy, and success notices. Keep validation, blocking errors, empty states, confirmations, and persistent editor save state inline. Loading-tone messages animate a trailing ellipsis, so pass copy without static dots when possible.

```typescript
type AppMessageTone = 'loading' | 'info' | 'success' | 'warning'

interface ShowAppMessageOptions {
  text: string
  tone?: AppMessageTone
  durationMs?: number
}

function useAppMessage(): {
  showMessage: (options: ShowAppMessageOptions) => string
  clearMessage: (id?: string) => void
}

function useOverlayMessage(
  active: boolean,
  text: string,
  options?: { tone?: AppMessageTone; delayMs?: number }
): void
```

```tsx
const { showMessage } = useAppMessage()
showMessage({ text: 'Copied', tone: 'success' })

useOverlayMessage(isRefreshing, 'Refreshing', { tone: 'loading' })
```

---

## Design System Policies (AI Rails)

These rules ensure consistency across the codebase:

| Policy | Rule | Rationale |
|--------|------|-----------|
| **Dark mode** | `dark:` classes allowed in `/ui` CVA definitions ONLY. Banned in app code. | CVA centralizes theme logic; app code uses semantic tokens |
| **Backgrounds** | Use `bg-page`, `bg-surface`, `bg-surface-2` in app code | Prevents inconsistent dark backgrounds across pages |
| **Text/borders** | Use `text-text-default`, `text-text-muted`, `border-border` in app code | Consistent semantic naming |
| **Form labels** | Always via `<FormField>`, never on Input/Select directly | One pattern to learn, one place for label styling |
| **Targets and focus** | Shared buttons, segmented controls, and form controls provide a 44px minimum target and `focus-visible` ring | Mobile and keyboard access should not depend on feature-local classes |
| **Token naming** | Intent-based only (`rounded-control`, not `rounded-8px`) | Prevents proliferation of one-off tokens |
| **Raw design values** | New raw colours, arbitrary spacing, and raw layers require an exact governed exception | Existing migration debt must not silently spread or mutate |
| **Tiptap** | Stays in `/components/tiptap*`, not `/ui` | Editor is a mini-platform; don't mix with app primitives |

### Dark Mode Examples

```tsx
// GOOD in /ui - CVA definitions can use dark:
const buttonVariants = cva('...', {
  variants: {
    variant: {
      primary: 'bg-blue-600 dark:bg-blue-500 text-white',  // OK here
    },
  },
})

// GOOD in app code - semantic tokens (no dark:)
<div className="bg-surface border-border text-text-default">

// BAD in app code - dark: classes
<div className="bg-white dark:bg-gray-900">  // NEVER in app code
```

### Form Field Examples

```tsx
// GOOD - FormField wraps control
<FormField label="Email" error={errors.email} required>
  <Input type="email" {...register('email')} />
</FormField>

// BAD - label on Input directly (old pattern)
<Input label="Email" error={errors.email} />  // Don't do this
```

---

## Semantic Tokens Reference

### Colors (CSS Variables)

| Token | Light | Dark | Usage |
|-------|-------|------|-------|
| `bg-page` | gray-50 | gray-950 | App background |
| `bg-surface` | white | gray-900 | Cards, panels |
| `bg-surface-2` | gray-50 | gray-800 | Nested surfaces |
| `border-border` | gray-200 | gray-700 | Default borders |
| `border-border-strong` | gray-300 | gray-600 | Emphasized borders |
| `text-text-default` | gray-900 | gray-100 | Primary text |
| `text-text-muted` | gray-600 | gray-400 | Secondary text |
| `text-text-inverse` | white | white | Text on solid semantic fills |
| `bg-primary-solid` | blue-600 | blue-600 | Solid primary fills carrying inverse text |
| `bg-success-solid` | green-700 | green-700 | Solid success fills carrying inverse text |
| `bg-danger-solid` | red-600 | red-600 | Solid danger fills carrying inverse text |

### Border Radius

| Token | Value | Usage |
|-------|-------|-------|
| `rounded-control` | 0.5rem (8px) | Buttons, inputs, selects |
| `rounded-card` | 0.5rem (8px) | Cards, panels |
| `rounded-dialog` | 0.5rem (8px) | Modals |
| `rounded-badge` | 9999px | Pill shapes |

### Surface Tones

Use these semantic surfaces in app code and component variants:

| Token | Usage |
|-------|-------|
| `bg-surface` | Standard content card |
| `bg-surface-2` | Muted nested panel |
| `bg-surface-3` | Dense muted surfaces |
| `bg-surface-panel` | Page shell panels and elevated wrappers |
| `bg-surface-accent` | Quiet hover/accent backgrounds |
| `bg-surface-selected` | Selected rows/cards |

### Spacing

| Token | Value | Usage |
|-------|-------|-------|
| `p-dialog` / `gap-dialog` | 1.25rem (20px) | Modal content |
| `p-card` / `gap-card` | 1.25rem (20px) | Card content |
| `gap-section` | 1.5rem (24px) | Major section gaps |
| `gap-field` | 0.75rem (12px) | Form field gaps |
| `gap-control` | 0.5rem (8px) | Button group gaps |

### Portable foundations

These aliases preserve existing Pika values while making their intent portable.
Use canonical components first; use an alias directly only when the
responsibility belongs to feature composition.

| Responsibility | Tailwind aliases |
|---|---|
| Typography | `font-sans`, `font-mono` |
| Minimum control target | `min-h-control`, `min-w-control` |
| Focus | `ring-foundation`, `ring-focus`, `ring-offset-foundation` |
| Motion | `duration-fast`, `duration-standard`, `duration-deliberate`, `ease-standard` |
| Page width | `max-w-reading`, `max-w-standard`, `max-w-wide` |
| Density rhythm | `*-density-compact-*`, `*-density-comfortable-*` |
| Layers | `z-sticky-table`, `z-local-menu`, `z-floating`, `z-app-chrome`, `z-popover`, `z-modal`, `z-app-message` |
| Overlay scrim | `bg-overlay-scrim` |

The motion duration variables resolve to `0ms` under
`prefers-reduced-motion: reduce`. A feature-owned animation that does not use
them must provide an equivalent path.

Run `pnpm run check:design-policy` after changing visual values. It covers
Tailwind arbitrary syntax, literal inline styles, and CSS/SCSS declarations;
canonical definitions in `src/styles/tokens.css` are intentionally reviewed by
semantic and contrast tests instead. The exception registry is an exact
baseline: counts and fingerprints must match, and each entry names a reason and
migration owner.

### Shadows

| Token | Usage |
|-------|-------|
| `shadow-elevated` | Cards, dropdowns |
| `shadow-dialog` | Modals |

---

## Out of Scope

These are NOT part of the `/ui` design system:

- **Tiptap primitives**: Stay in `tiptap-ui-primitive/`
- **Textarea**: Use native `<textarea>` wrapped by FormField
- **Toast stacks**: Use `AppMessage` instead; stacked toasts are intentionally not implemented
- **App-specific components**: UserMenu and other feature-owned compositions

---

## Import Policy Enforcement

ESLint and CI enforce that app code imports from `@/ui`:

```bash
# These imports are BLOCKED in app code:
@/components/Button
@/components/Input
@/components/AlertDialog
@/components/ConfirmDialog
@/components/Tooltip

# Use this instead:
@/ui
```
