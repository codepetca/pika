# Pika Design System

Design tokens and component guidelines for consistent, compact UI.

---

## 🎨 Design Principles

1. **Compact & Dense** - Maximize visible content, minimize scrolling
2. **Consistent** - Reusable components, predictable patterns
3. **Professional but Approachable** - Clean aesthetic with playful touches
4. **Mobile-First** - Student experience optimized for phones

---

## 📏 Spacing Scale

### Vertical Spacing (Reduce from defaults)

| Element | Old | New | Token |
|---------|-----|-----|-------|
| Page container top/bottom | `py-8` (32px) | `py-3` (12px) | `spacing-page` |
| Section gap | `space-y-8` (32px) | `space-y-4` (16px) | `spacing-section` |
| Card padding | `p-6` (24px) | `p-4` (16px) | `spacing-card` |
| List item gap | `space-y-4` (16px) | `space-y-2` (8px) | `spacing-list` |
| Form field gap | `mb-4` (16px) | `mb-2` (8px) | `spacing-form` |
| Student row height | ~60px | ~36px | `h-9` (36px) |

### Horizontal Spacing

| Element | Old | New | Token |
|---------|-----|-----|-------|
| Page container sides | `px-8` (32px) | `px-4` (16px) | `spacing-page-x` |
| Card padding | `px-6` (24px) | `px-3` (12px) | `spacing-card-x` |
| Button padding | `px-4` (16px) | `px-3` (12px) | `spacing-btn-x` |

---

## 🔤 Typography Scale

### Headings

```tsx
// Page title (eliminate when in classroom context - use PageHeader instead)
className="text-2xl font-bold text-gray-900" // Only for top-level pages

// Section title
className="text-lg font-semibold text-gray-900" // Attendance, Logs, etc.

// Subsection
className="text-base font-medium text-gray-900" // List headers
```

### Body Text

```tsx
// Primary text
className="text-sm text-gray-900" // Student names, content

// Secondary text
className="text-xs text-gray-600" // Student numbers, metadata

// Tertiary/hint
className="text-xs text-gray-500" // Helper text
```

---

## 🏗️ Layout Components

### 1. AppShell (Global Layout)

**Purpose:** Wrap all authenticated pages

```tsx
// src/components/AppShell.tsx
<div className="min-h-screen bg-gray-50">
  <AppHeader /> {/* Compact 48px header */}
  <main className="max-w-7xl mx-auto px-4 py-3">
    {children}
  </main>
</div>
```

**Specs:**
- Header height: `h-12` (48px) - down from 64-72px
- Main padding: `px-4 py-3` - down from `px-8 py-8`
- Max width: `max-w-7xl` (1280px)

### 2. AppHeader (Compact Titlebar)

**Purpose:** Global navigation with classroom selector

```tsx
// src/components/AppHeader.tsx
<header className="h-12 bg-white border-b border-gray-200 flex items-center px-4 gap-3">
  {/* Logo */}
  <PikaIcon className="w-8 h-8 text-blue-500" />

  {/* Classroom Selector (teachers only) */}
  <ClassroomDropdown />

  {/* Icon Nav */}
  <nav className="flex items-center gap-1">
    <IconButton icon={HomeIcon} label="Classrooms" href="/classrooms" />
    <IconButton icon={CalendarIcon} label="Calendar" href="/calendar" />
  </nav>

  {/* Right side */}
  <div className="ml-auto">
    <UserMenu />
  </div>
</header>
```

**Specs:**
- Total height: 48px (3rem / `h-12`)
- Logo: 32px (`w-8 h-8`)
- Icons: 20px with 8px padding = 36px click target
- Horizontal gap: `gap-3` (12px)

### 3. ClassroomDropdown

**Purpose:** Switch between classrooms without leaving page

```tsx
<select className="h-9 px-3 text-sm border border-gray-300 rounded-md bg-white">
  <option>GLD2O - Learning Strategies</option>
  <option>Other Classroom</option>
</select>
```

### 4. PageHeader

**Purpose:** Replace repeated classroom titles, provide action buttons

```tsx
// src/components/PageHeader.tsx
<div className="flex items-center justify-between mb-4">
  <h1 className="text-lg font-semibold text-gray-900">{title}</h1>
  {action && <div className="flex gap-2">{action}</div>}
</div>
```

**When to use:**
- Use for section titles (Attendance, Logs, Roster)
- **Do NOT repeat classroom name** (already in header dropdown)

### 5. StudentRow (Compact List Item)

**Purpose:** Consistent student display across all views

**Variants:**

```tsx
// Minimal (Attendance view)
<StudentRow.Minimal
  email="student@yrdsb.ca"
  indicator={<AttendanceIndicator status="present" />}
/>

// Medium (Roster view)
<StudentRow.Medium
  email="student@yrdsb.ca"
  name="Last, First"
  studentNumber="1001"
  badge={<Badge>Joined</Badge>}
  action={<Button size="sm">Remove</Button>}
/>

// Expandable (Logs view)
<StudentRow.Expandable
  email="student@yrdsb.ca"
  preview="Log summary text..."
  expanded={false}
  onToggle={() => {}}
/>
```

**Specs:**
- Height: `py-2` (36px total with border)
- Text: `text-sm` (14px)
- Hover: `hover:bg-gray-50`
- Border: `border-b border-gray-200` (not card wrapper)

### 6. SectionCard

**Purpose:** Optional card wrapper for grouped content (use sparingly)

```tsx
<div className="bg-white rounded-lg border border-gray-200 p-4">
  {title && <h2 className="text-base font-medium mb-3">{title}</h2>}
  {children}
</div>
```

**When to use:**
- Forms (signup, login, settings)
- Isolated sections (calendar, settings panels)

**When NOT to use:**
- Student lists (use direct dividers instead)
- Already within page context (tabs)

---

## 🧩 Component Patterns

### Tab Navigation

**Current:** Text tabs with underline
**Keep:** Works well, just reduce spacing

```tsx
<div className="border-b border-gray-200">
  <nav className="flex gap-4 px-3">
    <button className="py-2 border-b-2 border-blue-600 text-blue-600">
      Attendance
    </button>
    <button className="py-2 text-gray-600 hover:text-gray-900">
      Logs
    </button>
  </nav>
</div>
```

**Spacing reduction:**
- Container: `px-3` (was `px-0` or `px-4`)
- Tab gap: `gap-4` (keep, provides breathing room)
- Vertical: `py-2` (down from `py-3`)

### Buttons

**Primary:**
```tsx
className="px-3 py-2 text-sm font-medium rounded-md bg-blue-600 text-white hover:bg-blue-700"
```

**Secondary:**
```tsx
className="px-3 py-2 text-sm font-medium rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50"
```

**Icon Button:**
```tsx
className="p-2 rounded-md text-gray-600 hover:bg-gray-100"
```

**Size scale:**
- Small: `px-2 py-1 text-xs`
- Default: `px-3 py-2 text-sm`
- Large: `px-4 py-2 text-base`

### Status Indicators

**Attendance:**
```tsx
// Dot style (compact)
<div className="w-3 h-3 rounded-full bg-green-500" />
<div className="w-3 h-3 rounded-full bg-red-500" />

// Badge style (when space allows)
<span className="px-2 py-1 text-xs rounded-full bg-green-100 text-green-700">
  Present
</span>
```

---

## 🎨 Color System

### Primary Palette

```tsx
// Blue (primary brand color)
blue-500  // Interactive elements, selected state
blue-600  // Buttons, links (current)
blue-700  // Button hover

// Gray (neutral)
gray-50   // Page background
gray-100  // Hover states
gray-200  // Borders, dividers
gray-600  // Secondary text
gray-900  // Primary text

// Semantic
green-500  // Success, present
green-100  // Success background
red-500    // Error, absent
red-100    // Error background
```

### Playful Accents (minimal use)

- Logo: Keep existing blue pika
- Mood emojis: Student daily log form
- Status colors: Green/red for attendance

---

## 📱 Responsive Breakpoints

```tsx
// Mobile-first (default styles for mobile)
sm:  640px  // Small tablets
md:  768px  // Tablets
lg:  1024px // Desktop
xl:  1280px // Large desktop
```

**Priority: Mobile experience for students**

---

## 🚀 Implementation Priority

### Phase 1: Foundation (Highest Impact)
1. ✅ Create `AppShell` component
2. ✅ Create compact `AppHeader` with icons
3. ✅ Add `ClassroomDropdown` to header
4. ✅ Reduce page container padding (`py-8` → `py-3`)

### Phase 2: Student Lists (High Impact)
5. ✅ Create `StudentRow` component variants
6. ✅ Replace attendance list with compact rows
7. ✅ Replace logs list with compact expandable rows
8. ✅ Replace roster list with compact rows

### Phase 3: Consistency (Medium Impact)
9. ✅ Create `PageHeader` component
10. ✅ Remove duplicate classroom titles
11. ✅ Standardize button sizes
12. ✅ Consistent section spacing

### Phase 4: Polish (Nice-to-have)
13. Add avatar/user menu to header
14. Icon library integration (Heroicons recommended)
15. Micro-interactions and transitions

---

## 📊 Expected Results

**Before:**
- Titlebar: 72px
- Visible students (1440x900): ~8 students

**After:**
- Titlebar: 48px (33% reduction)
- Visible students (1440x900): ~15 students (87% increase)

**Vertical space savings per page:** ~120px
**Equivalent to:** 3-4 additional student rows visible

---

## 🎯 Design Goals Checklist

- [ ] 1. Compact titlebar (72px → 48px) with classroom dropdown, avatar, icons
- [ ] 2. Reduced vertical padding (py-8 → py-3, eliminate redundant headers)
- [ ] 3. Design consistency via shared components (AppShell, StudentRow, PageHeader)
- [ ] 4. Reduced horizontal padding (px-8 → px-4, tighter card spacing)
- [ ] 5. Compact student rows (60px → 36px)
- [ ] 6. Maintain minimal, professional-but-fun aesthetic

---

## 📝 Notes

- All Tailwind classes chosen to maintain mobile-first responsive design
- Spacing choices prioritize information density without feeling cramped
- Component system enables future theming/customization
- Design system living document - update as patterns evolve
