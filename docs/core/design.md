# UI/UX Design Guidelines

This document defines UI/UX patterns, visual design standards, and component guidelines for **Pika**.

---

## Design Principles

### 1. Mobile-First
- Design for mobile screens first (320px+)
- Scale up to tablet (768px+) and desktop (1024px+)
- Touch-friendly targets (minimum 44×44px)
- Optimize for portrait orientation on mobile

### 2. Minimal and Functional
- Avoid verbose instructional text
- Use short labels and clear headings
- Rely on whitespace and visual hierarchy
- Progressive disclosure (show what's needed, hide what's not)

### 3. Accessibility
- Keyboard navigation for all interactions
- ARIA labels for screen readers
- Color contrast meets WCAG 2.1 AA standards
- Focus indicators visible
- No color-only information

### 4. Dark Mode Support (Required)
- **All UI components MUST support both light and dark modes**
- **Use semantic tokens** (NOT `dark:` classes) - see "Design System Layer" section below
- Ensure proper contrast in both light and dark modes (WCAG 2.1 AA)
- Test all views in both modes before considering complete
- Dark mode activates via Tailwind's `class` strategy (`darkMode: 'class'` in config)

### 5. Performance
- Fast initial load (< 3s)
- Instant feedback on interactions
- Lazy load below-the-fold content
- Optimize images and assets

---

## Design System Layer (`/ui`)

**IMPORTANT**: All app code must use the design system layer for consistent theming.

### Import Pattern
```tsx
// CORRECT - import from @/ui
import { Button, Input, Select, FormField, AlertDialog, ConfirmDialog, Card, Tooltip } from '@/ui'

// WRONG - direct imports are blocked by ESLint
import { Button } from '@/components/Button'  // ❌ Blocked
```

### Semantic Token Pattern (REQUIRED)

**App code must use semantic tokens, NOT `dark:` classes.**

The `/ui` layer handles dark mode internally via CVA. App code uses semantic class names that automatically adapt:

```tsx
// CORRECT - app code uses semantic tokens
<div className="bg-surface text-text-default border-border">
<p className="text-text-muted">Secondary text</p>

// WRONG - app code uses dark: classes
<div className="bg-white dark:bg-gray-900 text-gray-900 dark:text-white">  // ❌ Never do this
```

### Available Semantic Tokens

| Token | Light Value | Dark Value | Usage |
|-------|-------------|------------|-------|
| `bg-page` | gray-50 | gray-950 | App background |
| `bg-surface` | white | gray-900 | Cards, panels |
| `bg-surface-2` | gray-50 | gray-800 | Nested surfaces |
| `bg-surface-hover` | gray-100 | gray-700 | Hover states |
| `border-border` | gray-200 | gray-700 | Default borders |
| `border-border-strong` | gray-300 | gray-600 | Emphasized borders |
| `text-text-default` | gray-900 | gray-100 | Primary text |
| `text-text-muted` | gray-500 | gray-400 | Secondary text |
| `text-text-inverse` | white | gray-900 | Text on colored backgrounds |
| `text-primary` | blue-600 | blue-400 | Links, primary actions |
| `text-danger` | red-600 | red-400 | Error text |
| `text-success` | green-600 | green-400 | Success text |

### When to Use `dark:` Classes

`dark:` classes are **only allowed** in:
1. `/src/ui/` - CVA component definitions
2. `/src/components/PikaLogo.tsx` - CSS filter transformation (exception)
3. `/src/components/editor/RichText*.tsx` - Code block styling (intentional dark regardless of theme)

**All other code must use semantic tokens.**

---

## Visual Design System

### Color Palette

#### Status Colors
```css
/* Attendance status */
--color-success: #22c55e  /* green-500 - Present */
--color-danger: #ef4444   /* red-500 - Absent/Error */
--color-warning: #f59e0b  /* amber-500 */
--color-info: #3b82f6     /* blue-500 */

/* Action colors */
--color-primary: #3b82f6  /* blue-500 */
--color-primary-hover: #2563eb  /* blue-600 */
```

#### Neutral Colors (defined in `/src/styles/tokens.css`)

The semantic token system automatically handles light/dark mode switching. See the tokens table above for the complete mapping.

### Typography

#### Font Families
```css
/* System font stack (fast loading) */
font-family: -apple-system, BlinkMacSystemFont,
             "Segoe UI", Roboto, "Helvetica Neue",
             Arial, sans-serif;
```

#### Font Sizes
```css
--text-xs: 0.75rem    /* 12px */
--text-sm: 0.875rem   /* 14px */
--text-base: 1rem     /* 16px */
--text-lg: 1.125rem   /* 18px */
--text-xl: 1.25rem    /* 20px */
--text-2xl: 1.5rem    /* 24px */
--text-3xl: 1.875rem  /* 30px */
--text-4xl: 2.25rem   /* 36px */
```

#### Font Weights
```css
--font-normal: 400
--font-medium: 500
--font-semibold: 600
--font-bold: 700
```

### Spacing

Use consistent spacing scale (Tailwind default):
```css
--space-1: 0.25rem    /* 4px */
--space-2: 0.5rem     /* 8px */
--space-3: 0.75rem    /* 12px */
--space-4: 1rem       /* 16px */
--space-5: 1.25rem    /* 20px */
--space-6: 1.5rem     /* 24px */
--space-8: 2rem       /* 32px */
--space-10: 2.5rem    /* 40px */
--space-12: 3rem      /* 48px */
--space-16: 4rem      /* 64px */
```

### Border Radius
```css
--radius-none: 0
--radius-sm: 0.125rem   /* 2px */
--radius-md: 0.375rem   /* 6px */
--radius-lg: 0.5rem     /* 8px */
--radius-xl: 0.75rem    /* 12px */
--radius-2xl: 1rem      /* 16px */
--radius-full: 9999px   /* fully rounded */
```

### Shadows
```css
--shadow-sm: 0 1px 2px 0 rgb(0 0 0 / 0.05)
--shadow-md: 0 4px 6px -1px rgb(0 0 0 / 0.1)
--shadow-lg: 0 10px 15px -3px rgb(0 0 0 / 0.1)
--shadow-xl: 0 20px 25px -5px rgb(0 0 0 / 0.1)
```

---

## Component Patterns

### Icons & Status Indicators

#### Attendance Status
```
🟢 Present
🔴 Absent
```

Usage:
- **Simple and universal** — No need to translate
- **Color + emoji** — Redundant encoding (accessible)
- **Size**: Use text size (inherits from parent)

#### Example
```tsx
<span className="text-2xl" role="img" aria-label="Present">
  🟢
</span>
```

### Buttons

**Always import Button from `@/ui`:**

```tsx
import { Button } from '@/ui'

// Primary (default)
<Button>Submit Entry</Button>

// Secondary
<Button variant="secondary">Cancel</Button>

// Destructive
<Button variant="danger">Delete</Button>

// Sizes
<Button size="sm">Small</Button>
<Button size="md">Medium</Button>  {/* default */}
<Button size="lg">Large</Button>
```

Button variants and dark mode are handled automatically by the design system.

### Forms

**Always wrap form controls with `FormField` from `@/ui`:**

```tsx
import { FormField, Input, Select } from '@/ui'

// Text input with label and error
<FormField label="Email Address" error={errors.email} required>
  <Input type="email" placeholder="Enter your email" {...register('email')} />
</FormField>

// Select with hint
<FormField label="Country" hint="Select your country of residence">
  <Select options={countries} value={country} onChange={setCountry} />
</FormField>
```

FormField handles:
- Label rendering with proper `htmlFor` association
- Error message display with `aria-invalid`
- Hint text (hidden when error present)
- Required indicator (*)

#### Textarea (native, wrapped by FormField)
```tsx
<FormField label="Journal Entry" error={errors.entry}>
  <textarea
    className="w-full px-3 py-2 border border-border rounded-control
               bg-surface text-text-default
               focus:outline-none focus:ring-2 focus:ring-primary
               resize-none"
    rows={6}
    placeholder="Write your journal entry..."
  />
</FormField>
```

### Cards

**Use `Card` from `@/ui` or semantic tokens for custom containers:**

```tsx
import { Card } from '@/ui'

// Basic Card (uses design system styling)
<Card>
  <h3 className="text-lg font-semibold text-text-default mb-2">Card Title</h3>
  <p className="text-text-muted">Card content goes here.</p>
</Card>

// Card with different padding
<Card padding="lg">
  <form>...</form>
</Card>
```

#### Custom Container (semantic tokens)
```tsx
// Use semantic tokens when Card component doesn't fit
<div className="bg-surface border border-border rounded-card p-6 shadow-elevated">
  <h3 className="text-lg font-semibold text-text-default mb-2">Card Title</h3>
  <p className="text-text-muted">Card content goes here.</p>
</div>

// Clickable container
<div className="bg-surface border border-border rounded-card p-6 shadow-elevated
                hover:shadow-lg hover:bg-surface-hover transition-shadow cursor-pointer">
  <h3 className="text-lg font-semibold text-text-default mb-2">Clickable Card</h3>
  <p className="text-text-muted">Card content goes here.</p>
</div>
```

### Lists

#### Simple List
```tsx
<ul className="space-y-2">
  <li className="py-2 px-3 hover:bg-gray-50 rounded-md cursor-pointer">
    Item 1
  </li>
  <li className="py-2 px-3 hover:bg-gray-50 rounded-md cursor-pointer">
    Item 2
  </li>
</ul>
```

#### List with Dividers
```tsx
<ul className="divide-y divide-gray-200">
  <li className="py-3">Item 1</li>
  <li className="py-3">Item 2</li>
  <li className="py-3">Item 3</li>
</ul>
```

### Navigation

#### Top Navigation
```tsx
<nav className="bg-white border-b border-gray-200">
  <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
    <div className="flex justify-between h-16">
      <div className="flex items-center">
        <h1 className="text-xl font-bold">Pika</h1>
      </div>
      <div className="flex items-center space-x-4">
        <a href="/classrooms" className="text-gray-700 hover:text-blue-600">
          Classrooms
        </a>
        <a href="/student/history" className="text-gray-700 hover:text-blue-600">
          History
        </a>
        <a href="/logout" className="text-gray-700 hover:text-blue-600">
          Logout
        </a>
      </div>
    </div>
  </div>
</nav>
```

#### Mobile Navigation (Hamburger)
```tsx
<nav className="bg-white border-b border-gray-200">
  <div className="px-4">
    <div className="flex justify-between items-center h-16">
      <h1 className="text-xl font-bold">Pika</h1>
      <button className="p-2">
        <svg className="w-6 h-6" fill="none" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>
    </div>
  </div>
</nav>
```

---

## Layout Patterns

### Container Widths
```tsx
/* Mobile: full width with padding */
<div className="px-4">

/* Tablet/Desktop: max width with centering */
<div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">

/* Narrow content (reading) */
<div className="max-w-2xl mx-auto px-4">
```

### Grid Layouts
```tsx
/* Responsive grid: 1 col mobile, 2 col tablet, 3 col desktop */
<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">

/* 2-column layout: sidebar + main */
<div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
  <aside className="lg:col-span-1">Sidebar</aside>
  <main className="lg:col-span-3">Main content</main>
</div>
```

### Flexbox Layouts
```tsx
/* Horizontal stack with spacing */
<div className="flex space-x-4">

/* Vertical stack with spacing */
<div className="flex flex-col space-y-4">

/* Space between (justify) */
<div className="flex justify-between items-center">

/* Centered */
<div className="flex justify-center items-center">
```

### 3-Panel Layout System

The app uses a 3-panel layout for classroom views, implemented in `src/components/layout/`:

```
┌──────────────────────────────────────────────────────────────┐
│                         AppHeader                            │
├────────┬─────────────────────────────────┬───────────────────┤
│        │                                 │                   │
│  Left  │          MainContent            │    RightSidebar   │
│ Sidebar│                                 │   (Inspector)     │
│        │                                 │                   │
│ (nav)  │                                 │                   │
│        │                                 │                   │
└────────┴─────────────────────────────────┴───────────────────┘
```

#### Components

| Component | Location | Purpose |
|-----------|----------|---------|
| `ThreePanelProvider` | `layout/ThreePanelProvider.tsx` | Context provider for layout state |
| `ThreePanelShell` | `layout/ThreePanelShell.tsx` | CSS Grid container |
| `LeftSidebar` | `layout/LeftSidebar.tsx` | Navigation rail (collapsible) |
| `MainContent` | `layout/MainContent.tsx` | Primary content area |
| `RightSidebar` | `layout/RightSidebar.tsx` | Inspector/details panel |

#### Configuration

Route-specific layout is configured in `src/lib/layout-config.ts`:

```typescript
type RouteKey =
  | 'classrooms-list'
  | 'settings'
  | 'attendance'
  | 'roster'
  | 'today'
  | 'assignments-student'
  | 'assignments-teacher-list'
  | 'assignments-teacher-viewing'

// Example config
ROUTE_CONFIGS['attendance'] = {
  rightSidebar: { enabled: true, defaultOpen: false, defaultWidth: '50%' },
  mainContent: { maxWidth: 'full' },
}
```

#### Usage Pattern

```tsx
// In page.tsx
import { ThreePanelProvider, ThreePanelShell, LeftSidebar, MainContent, RightSidebar } from '@/components/layout'
import { getRouteKeyFromTab } from '@/lib/layout-config'

const routeKey = getRouteKeyFromTab(activeTab, user.role)

<ThreePanelProvider routeKey={routeKey} initialLeftExpanded={...}>
  <ThreePanelShell>
    <LeftSidebar>
      <NavItems ... />
    </LeftSidebar>

    <MainContent>
      {/* Tab content */}
    </MainContent>

    <RightSidebar title="Details">
      {/* Inspector content - varies by tab */}
    </RightSidebar>
  </ThreePanelShell>
</ThreePanelProvider>
```

#### Passing Content to RightSidebar

Content is passed to RightSidebar at the page level via callbacks:

```tsx
// State at page level
const [selectedItem, setSelectedItem] = useState<Item | null>(null)

// Pass callback to tab component
<TabComponent onSelect={setSelectedItem} />

// Render in RightSidebar
<RightSidebar title={selectedItem?.name || 'Details'}>
  {selectedItem ? (
    <ItemDetails item={selectedItem} />
  ) : (
    <p>Select an item to view details.</p>
  )}
</RightSidebar>
```

#### Responsive Behavior

- **Desktop (lg+)**: 3-column grid with smooth width transitions
- **Mobile**: Single column, sidebars become overlay drawers
- Use `useMobileDrawer()` hook to control mobile drawer state
- Use `useRightSidebar()` hook to toggle/control right panel

#### Hooks

```typescript
import { useLeftSidebar, useRightSidebar, useMobileDrawer } from '@/components/layout'

// Toggle right sidebar
const { isOpen, toggle, enabled } = useRightSidebar()

// Mobile drawer control
const { openLeft, openRight, close } = useMobileDrawer()
```

---

## Page-Specific Patterns

### Student Pages

Keep the student version of `AppShell`/`AppHeader` so the title bar always shows the classroom the student is enrolled in (matching the teacher experience) and a single canonical date indicator. All student-facing dates should use the format `Tue Dec 16` (no year), and on the Today page that date should be left-aligned in the header ribbon, taking the place of the old “Today” label so it feels like the primary headline.

This `Tue Dec 16` format applies throughout the app (calendar selectors, assignment due badges, history cards, etc.) so every date display feels predictable.

#### Today Page (Journal Entry)
**Layout**:
- Full-width page with centered card
- Max-width container on larger screens
- Form content sits within the card so the date headline remains the dominant element

**Components**:
- Date header with "on time" indicator (display `Tue Dec 16`)
- Large textarea for journal entry
- Character count
- Submit button (primary, full-width on smaller widths)

**Example**:
```tsx
<div className="min-h-screen bg-gray-50">
  <nav>{/* Navigation */}</nav>

  <main className="max-w-2xl mx-auto px-4 py-8">
    <div className="bg-white rounded-lg shadow-md p-6">
      <h2 className="text-2xl font-bold mb-2">GLD2O — Learning Strategies</h2>
      <p className="text-sm text-gray-600 mb-6">Tue Dec 16</p>

      <textarea
        className="w-full px-3 py-2 border border-gray-300 rounded-md
                   focus:outline-none focus:ring-2 focus:ring-blue-500
                   resize-none"
        rows={10}
        placeholder="Write your journal entry..."
      />

      <button className="w-full sm:w-auto bg-blue-500 hover:bg-blue-600
                         text-white font-medium px-6 py-2 rounded-md mt-4">
        Submit Entry
      </button>
    </div>
  </main>
</div>
```

#### History Page (Past Entries)
**Layout**:
- List of past entries (most recent first)
- Card-based design
- Stack vertically on narrower widths
- Desktop: 2-column grid (optional)

**Components**:
- Date and status icon for each entry (dates read `Tue Dec 16`)
- Preview of content (first 150 characters)
- "View full entry" link

---

### Teacher Pages

#### Dashboard (Attendance Matrix)
**Layout**:
- Sticky left column (student names)
- Horizontal scroll for dates
- Fixed header row
- Desktop-optimized (table layout)

**Components**:
- Student name column (sticky left)
- Date columns (scrollable horizontally)
- Attendance status cells (🟢 present, 🔴 absent)
- Click cell to view entry modal

**Example**:
```tsx
<div className="overflow-x-auto">
  <table className="min-w-full">
    <thead className="bg-gray-50 sticky top-0">
      <tr>
        <th className="sticky left-0 bg-gray-50 px-4 py-3 text-left">
          Student
        </th>
        <th className="px-4 py-3">Jan 15</th>
        <th className="px-4 py-3">Jan 16</th>
        <th className="px-4 py-3">Jan 17</th>
        {/* More dates... */}
      </tr>
    </thead>
    <tbody>
      <tr className="border-b hover:bg-gray-50">
        <td className="sticky left-0 bg-white px-4 py-3 font-medium">
          John Doe
        </td>
        <td className="px-4 py-3 text-center cursor-pointer">🟢</td>
        <td className="px-4 py-3 text-center cursor-pointer">🔴</td>
        <td className="px-4 py-3 text-center cursor-pointer">🟢</td>
        {/* More dates... */}
      </tr>
      {/* More students... */}
    </tbody>
  </table>
</div>
```

**Responsive Strategy**:
- Desktop: Full table with horizontal scroll
- Tablet: Same as desktop
- Mobile: Consider list view instead of table

### Classroom & Assignments (Shared)

#### Classroom Shell
- **Sidebar**: list classrooms with code/link actions; keep width <= 280px, sticky on desktop.
- **Join/Create affordances**: clear “+ New” (teacher) and “+ Join” (student) buttons at top of sidebar.
- **Empty states**: centered card with primary action (create/join).

#### Roster Upload
- Modal with file picker + drag/drop; show progress + success/error inline.
- After upload, refresh roster and attendance to reflect new students.

#### Class Days
- Toggle list/calendar per classroom; show disabled state for non-class days; keep destructive actions (delete/toggle off) secondary.

#### Assignments (Teacher)
- Card/list with title + due date + submission stats (`submitted/total`, late count).
- Actions: “+ New Assignment” button reveals inline form; keep form constrained to ~480px width.

#### Assignment Editor (Student)
- Header: back link to classroom, due date, relative due text, status badge.
- Editor: large textarea, monospace; autosave indicator (`Saved | Saving... | Unsaved changes`) top-right.
- Actions: primary Submit / secondary Unsubmit; disable while submitting.
- Submission timestamp: show in Toronto timezone, small text below editor.

#### Status Badges
- Present/absent: 🟢 / 🔴 icons only (no late in attendance UI).
- Assignments: use `getAssignmentStatusBadgeClass` palette; keep text short (“In progress”, “Submitted (late)”).

---

## Responsive Breakpoints

Use Tailwind's default breakpoints:

```css
/* Mobile first (default, no prefix) */
.px-4

/* Small (640px+) */
@media (min-width: 640px) { ... }
.sm:px-6

/* Medium (768px+) */
@media (min-width: 768px) { ... }
.md:px-8

/* Large (1024px+) */
@media (min-width: 1024px) { ... }
.lg:px-12

/* Extra Large (1280px+) */
@media (min-width: 1280px) { ... }
.xl:px-16
```

### Common Responsive Patterns

#### Hide/Show by Screen Size
```tsx
/* Show on mobile only */
<div className="block md:hidden">Mobile menu</div>

/* Show on desktop only */
<div className="hidden md:block">Desktop menu</div>
```

#### Different Layouts
```tsx
/* Vertical on mobile, horizontal on desktop */
<div className="flex flex-col md:flex-row">

/* 1 column mobile, 2 columns tablet, 3 columns desktop */
<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
```

---

## Accessibility Guidelines

### Keyboard Navigation
- All interactive elements must be keyboard accessible
- Logical tab order (follows visual order)
- Visible focus indicators
- Escape key closes modals/overlays

### ARIA Labels
```tsx
/* Button with icon only */
<button aria-label="Close modal">
  <svg>...</svg>
</button>

/* Status icon */
<span role="img" aria-label="Present">🟢</span>

/* Loading state */
<div role="status" aria-live="polite">
  Loading...
</div>
```

### Color Contrast
- Text: Minimum 4.5:1 contrast ratio
- Large text (18px+): Minimum 3:1 contrast ratio
- Don't rely on color alone (use icons + text)

### Form Accessibility
```tsx
<label htmlFor="email" className="block text-sm font-medium mb-1">
  Email Address
</label>
<input
  id="email"
  type="email"
  aria-required="true"
  aria-invalid={hasError}
  aria-describedby="email-error"
/>
{hasError && (
  <p id="email-error" className="text-sm text-red-600 mt-1">
    Invalid email address
  </p>
)}
```

---

## Animation & Transitions

### Subtle Transitions
```tsx
/* Hover effects */
className="transition-colors duration-200 hover:bg-blue-600"

/* Transform */
className="transition-transform duration-200 hover:scale-105"

/* Shadow */
className="transition-shadow duration-200 hover:shadow-lg"
```

### Loading States
```tsx
/* Spinner */
<div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />

/* Pulse (skeleton) */
<div className="animate-pulse bg-gray-200 h-4 w-full rounded" />
```

### Page Transitions
- Keep simple (fade in/out)
- Duration: 150-300ms
- Use for navigation between pages

---

## Performance Optimization

### Images
- Use Next.js `<Image>` component
- Provide width and height
- Use WebP format when possible
- Lazy load below-the-fold images

```tsx
<Image
  src="/photo.jpg"
  alt="Student photo"
  width={200}
  height={200}
  loading="lazy"
/>
```

### Code Splitting
- Use dynamic imports for large components
- Split by route automatically (Next.js App Router)

```tsx
const HeavyComponent = dynamic(() => import('./HeavyComponent'))
```

---

## Common Mistakes to Avoid

❌ **DON'T**:
- Use component libraries (no Chakra UI, Material-UI, etc.)
- **Use `dark:` classes in app code** - use semantic tokens instead
- **Import UI primitives from `@/components`** - import from `@/ui`
- **Use hardcoded gray-* classes** - use `text-text-muted`, `bg-surface`, etc.
- Add verbose instructional text
- Ignore mobile responsiveness
- Skip accessibility features
- Use custom fonts (slow loading)
- Over-animate (distracting)
- Create pixel-perfect designs (embrace flexibility)

✅ **DO**:
- **Import Button, Input, Select, FormField, etc. from `@/ui`**
- **Use semantic tokens** (`bg-surface`, `text-text-default`, `border-border`)
- **Wrap form controls with `<FormField>`** for consistent label/error styling
- Use Tailwind utility classes
- Keep UI minimal and functional
- Test on mobile devices
- Include ARIA labels
- Use system fonts
- Use subtle transitions
- Design for content flexibility
- **Test all views in both light and dark modes**

---

## Next Steps

- For architecture patterns, see [/docs/core/architecture.md](/docs/core/architecture.md)
- For testing UI components, see [/docs/core/tests.md](/docs/core/tests.md)
- For agent collaboration, see [/docs/core/agents.md](/docs/core/agents.md)
- For project context, see [/docs/core/project-context.md](/docs/core/project-context.md)
