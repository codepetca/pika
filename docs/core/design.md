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

### 4. Performance
- Fast initial load (< 3s)
- Instant feedback on interactions
- Lazy load below-the-fold content
- Optimize images and assets

---

## Visual Design System

### Color Palette

#### Primary Colors
```css
/* Attendance status colors */
--color-present: #22c55e  /* green-500 */
--color-absent: #ef4444   /* red-500 */

/* Action colors */
--color-primary: #3b82f6  /* blue-500 */
--color-secondary: #6b7280 /* gray-500 */
```

#### Neutral Colors
```css
--color-bg: #ffffff       /* white */
--color-bg-secondary: #f9fafb /* gray-50 */
--color-border: #e5e7eb   /* gray-200 */
--color-text: #111827     /* gray-900 */
--color-text-secondary: #6b7280 /* gray-500 */
```

#### Semantic Colors
```css
--color-success: #22c55e  /* green-500 */
--color-error: #ef4444    /* red-500 */
--color-warning: #f59e0b  /* amber-500 */
--color-info: #3b82f6     /* blue-500 */
```

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

#### Primary Button
```tsx
<button className="bg-blue-500 hover:bg-blue-600 text-white font-medium px-4 py-2 rounded-md">
  Submit Entry
</button>
```

#### Secondary Button
```tsx
<button className="bg-gray-200 hover:bg-gray-300 text-gray-700 font-medium px-4 py-2 rounded-md">
  Cancel
</button>
```

#### Destructive Button
```tsx
<button className="bg-red-500 hover:bg-red-600 text-white font-medium px-4 py-2 rounded-md">
  Delete
</button>
```

#### Button Sizes
- **Small**: `px-3 py-1 text-sm`
- **Medium**: `px-4 py-2 text-base` (default)
- **Large**: `px-6 py-3 text-lg`

### Forms

#### Text Input
```tsx
<input
  type="text"
  className="w-full px-3 py-2 border border-gray-300 rounded-md
             focus:outline-none focus:ring-2 focus:ring-blue-500"
  placeholder="Enter your name"
/>
```

#### Textarea
```tsx
<textarea
  className="w-full px-3 py-2 border border-gray-300 rounded-md
             focus:outline-none focus:ring-2 focus:ring-blue-500
             resize-none"
  rows={6}
  placeholder="Write your journal entry..."
/>
```

#### Label
```tsx
<label className="block text-sm font-medium text-gray-700 mb-1">
  Email Address
</label>
```

#### Error Message
```tsx
<p className="text-sm text-red-600 mt-1">
  This field is required
</p>
```

### Cards

#### Basic Card
```tsx
<div className="bg-white border border-gray-200 rounded-lg p-6 shadow-sm">
  <h3 className="text-lg font-semibold mb-2">Card Title</h3>
  <p className="text-gray-600">Card content goes here.</p>
</div>
```

#### Clickable Card
```tsx
<div className="bg-white border border-gray-200 rounded-lg p-6 shadow-sm
                hover:shadow-md transition-shadow cursor-pointer">
  <h3 className="text-lg font-semibold mb-2">Clickable Card</h3>
  <p className="text-gray-600">Card content goes here.</p>
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
        <a href="/student/today" className="text-gray-700 hover:text-blue-600">
          Today
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

---

## Page-Specific Patterns

### Student Pages

#### Today Page (Journal Entry)
**Layout**:
- Full-width on mobile
- Max-width container on desktop
- Form centered vertically

**Components**:
- Date header with "on time" indicator
- Large textarea for journal entry
- Character count (optional)
- Submit button (primary, full-width on mobile)

**Example**:
```tsx
<div className="min-h-screen bg-gray-50">
  <nav>{/* Navigation */}</nav>

  <main className="max-w-2xl mx-auto px-4 py-8">
    <div className="bg-white rounded-lg shadow-md p-6">
      <h2 className="text-2xl font-bold mb-2">Today's Entry</h2>
      <p className="text-sm text-gray-600 mb-6">Monday, January 15, 2024</p>

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
- Mobile: stack vertically
- Desktop: 2-column grid (optional)

**Components**:
- Date and status icon for each entry
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
- Add verbose instructional text
- Ignore mobile responsiveness
- Skip accessibility features
- Use custom fonts (slow loading)
- Over-animate (distracting)
- Create pixel-perfect designs (embrace flexibility)

✅ **DO**:
- Use Tailwind utility classes
- Keep UI minimal and functional
- Test on mobile devices
- Include ARIA labels
- Use system fonts
- Use subtle transitions
- Design for content flexibility

---

## Next Steps

- For architecture patterns, see [/docs/core/architecture.md](/docs/core/architecture.md)
- For testing UI components, see [/docs/core/tests.md](/docs/core/tests.md)
- For agent collaboration, see [/docs/core/agents.md](/docs/core/agents.md)
- For project context, see [/docs/core/project-context.md](/docs/core/project-context.md)
