# Pika Design System (`/ui`)

This directory contains the canonical UI primitives for the Pika application.

**All app code must import from `@/ui`, not from legacy `@/components/*` paths.**

---

## Quick Start

```tsx
import { Button, Input, Select, FormField, AlertDialog, ConfirmDialog, Card, Tooltip } from '@/ui'

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
  variant?: 'primary' | 'secondary' | 'danger' | 'success' | 'ghost'
  size?: 'sm' | 'md' | 'lg'
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
  children: ReactNode  // Input, Select, Textarea, etc.
}
```

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

### Card

```typescript
interface CardProps {
  children: ReactNode
  padding?: 'none' | 'sm' | 'md' | 'lg'
  className?: string
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

---

## Design System Policies (AI Rails)

These rules ensure consistency across the codebase:

| Policy | Rule | Rationale |
|--------|------|-----------|
| **Dark mode** | `dark:` classes allowed in `/ui` CVA definitions ONLY. Banned in app code. | CVA centralizes theme logic; app code uses semantic tokens |
| **Backgrounds** | Use `bg-page`, `bg-surface`, `bg-surface-2` in app code | Prevents inconsistent dark backgrounds across pages |
| **Text/borders** | Use `text-text-default`, `text-text-muted`, `border-border` in app code | Consistent semantic naming |
| **Form labels** | Always via `<FormField>`, never on Input/Select directly | One pattern to learn, one place for label styling |
| **Token naming** | Intent-based only (`rounded-control`, not `rounded-8px`) | Prevents proliferation of one-off tokens |
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
| `text-text-muted` | gray-500 | gray-400 | Secondary text |
| `text-text-inverse` | white | gray-900 | Text on colored backgrounds |

### Border Radius

| Token | Value | Usage |
|-------|-------|-------|
| `rounded-control` | 0.5rem (8px) | Buttons, inputs, selects |
| `rounded-card` | 0.5rem (8px) | Cards, panels |
| `rounded-dialog` | 0.5rem (8px) | Modals |
| `rounded-badge` | 9999px | Pill shapes |

### Spacing

| Token | Value | Usage |
|-------|-------|-------|
| `p-dialog` / `gap-dialog` | 1.25rem (20px) | Modal content |
| `p-card` / `gap-card` | 1.25rem (20px) | Card content |
| `gap-section` | 1.5rem (24px) | Major section gaps |
| `gap-field` | 0.75rem (12px) | Form field gaps |
| `gap-control` | 0.5rem (8px) | Button group gaps |

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
- **Toast/Tabs**: Not implemented yet
- **App-specific components**: ClassroomDropdown, UserMenu, etc.

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
