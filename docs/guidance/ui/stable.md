# Stable UI Guidance

These are the stable cross-cutting UI rules for the current governed slices.

Use these by default for new work.

For teacher assignments and teacher tests, also read:

- [`docs/guidance/ui/teacher-work-surfaces.md`](/docs/guidance/ui/teacher-work-surfaces.md)
- [`docs/guidance/ui/audit-teacher-work-surfaces.md`](/docs/guidance/ui/audit-teacher-work-surfaces.md)

This file handles shared foundation rules. The teacher work-surface canon handles that family’s composition and promotion lifecycle.

## Stable Rules

### 1. App code uses semantic tokens, not raw theme switching

- Use semantic surface, border, and text tokens in app code.
- Keep `dark:` classes inside `src/ui/` or other documented exceptions only.
- Favor tokens such as `bg-page`, `bg-surface`, `bg-surface-panel`, `border-border`, `border-border-strong`, `text-text-default`, and `text-text-muted`.

Source grounding:

- [`docs/core/design.md`](/docs/core/design.md)
- [`src/ui/README.md`](/src/ui/README.md)
- Current classroom surfaces use these tokens heavily.

### 2. Base controls come from `@/ui`

- Import primitives from `@/ui`, not from feature-local component paths.
- Wrap labeled form controls in `FormField`.
- Reuse `Button`, `Card`, dialogs, and other primitives before inventing feature-local base controls.
- Preserve the shared 44px target and `focus-visible` treatment instead of shrinking controls with feature-local height classes.
- Let `FormField` own label, required, hint, error, and description wiring; callers may provide an `id` or existing `aria-describedby`, which the primitive preserves.

Source grounding:

- [`src/ui/README.md`](/src/ui/README.md)
- [`docs/core/design.md`](/docs/core/design.md)
- [`src/components/AssignmentForm.tsx`](/src/components/AssignmentForm.tsx)

### 3. Classroom pages preserve the shared shell

- Classroom work stays inside the shared classroom shell rather than inventing standalone page layouts.
- Keep left navigation for tab switching, main content for the active workflow, and right-side inspection/detail behavior where the route already supports it.
- On desktop, the shell remains a three-panel grid. On mobile, side panels collapse into drawer behavior rather than creating a separate information architecture.

Source grounding:

- [`docs/core/design.md`](/docs/core/design.md)
- [`src/components/layout/ThreePanelShell.tsx`](/src/components/layout/ThreePanelShell.tsx)
- [`src/app/classrooms/[classroomId]/ClassroomPageClient.tsx`](/src/app/classrooms/[classroomId]/ClassroomPageClient.tsx)

### 3a. Page structure comes from `@/ui`

- Use `PageLayout`, `PageHeading`, `PageActionBar`, `PageContent`, and `PageStack` for page framing.
- Select a named width instead of adding feature-local `max-w-*` values.
- Use teacher density for scan-heavy operational surfaces and student density for standard content
  rhythm; density must not hide data or replace a narrow-screen workflow mode.
- Keep page context and actions in one responsive row. Secondary actions collapse into the shared
  mobile overflow menu; do not duplicate feature-local menu behavior.
- Preserve the compact classroom shell and table-first teacher workflows. These primitives govern
  alignment and rhythm, not product information architecture.

Source grounding:

- [`src/ui/Page.tsx`](/src/ui/Page.tsx)
- [`src/ui/README.md`](/src/ui/README.md)
- [`src/app/classrooms/TeacherClassroomsIndex.tsx`](/src/app/classrooms/TeacherClassroomsIndex.tsx)
- [`src/app/classrooms/StudentClassroomsIndex.tsx`](/src/app/classrooms/StudentClassroomsIndex.tsx)

### 3b. Page states distinguish pending, failed, empty, and unavailable data

- Use `PageState` from `@/ui` for a route or primary work region.
- A failed read must render an error state, not empty copy or stale zero counts.
- Empty means a successful request returned no records.
- Preserve the surrounding shell and offer a bounded retry when retrying is safe.
- Keep protected-resource not-found and forbidden copy intentionally indistinguishable when needed
  to avoid disclosing existence.
- Use transient overlay loading only when usable content remains visible underneath it.

Source grounding:

- [`docs/guidance/ui/page-state-conventions.md`](/docs/guidance/ui/page-state-conventions.md)
- [`src/ui/PageState.tsx`](/src/ui/PageState.tsx)
- [`src/app/classrooms/[classroomId]/error.tsx`](/src/app/classrooms/[classroomId]/error.tsx)
- [`src/app/teacher/dashboard/page.tsx`](/src/app/teacher/dashboard/page.tsx)
- [`src/app/student/history/page.tsx`](/src/app/student/history/page.tsx)

### 3c. Composite controls keep behavior in their shared owner

- Use `Tabs` for tabpanel navigation and `SegmentedControl` for peer mode/display options without
  tabpanels; do not reproduce either behavior with feature-local buttons.
- Product menus use the shared dropdown-navigation contract, including disabled-item skipping,
  first/last movement, Escape close, and focus restoration.
- Import governed table primitives from `@/ui`; name keyboard-selectable table regions and keep
  sortable-header state semantic.
- Every visible split-pane drag divider must also expose separator values and keyboard resizing.
- Run the composite-widget checklist and direct role/focus/keyboard tests whenever these contracts
  change.

Source grounding:

- [`docs/guidance/ui/composite-control-conventions.md`](/docs/guidance/ui/composite-control-conventions.md)
- [`src/ui/Tabs.tsx`](/src/ui/Tabs.tsx)
- [`src/ui/DataTable.tsx`](/src/ui/DataTable.tsx)
- [`src/hooks/use-dropdown-nav.ts`](/src/hooks/use-dropdown-nav.ts)
- [`src/components/WorkspaceSplitPane.tsx`](/src/components/WorkspaceSplitPane.tsx)

### 3d. Utility routes use the shared application-navigation mechanism

- Keep the compact `AppHeader` and account controls owned by `AppShell`; utility layouts must not
  recreate their own logo, logout, header, or responsive link wrapper.
- Use `AppNavigation` for visible route-family links. Preserve the product's existing route labels
  and information architecture while the utility families migrate incrementally.
- The current page uses `aria-current="page"`, a semantic accent edge, and the same visible focus
  and 44px target contracts as other shared controls.
- Narrow screens scroll the link row horizontally instead of wrapping the app header or hiding
  destinations in a new menu.

Source grounding:

- [`src/components/AppShell.tsx`](/src/components/AppShell.tsx)
- [`src/components/AppNavigation.tsx`](/src/components/AppNavigation.tsx)
- [`src/app/teacher/layout.tsx`](/src/app/teacher/layout.tsx)
- [`src/app/student/layout.tsx`](/src/app/student/layout.tsx)

### 3e. Specialized native controls are registered, not globally banned

- Import base controls and utilities through the `@/ui` barrel; app code does not use `@/ui/*`
  subpaths or legacy primitive paths.
- Prefer canonical primitives for ordinary controls. Keep native controls where browser semantics
  or composite behavior requires them.
- Every native `button`, `input`, `select`, or `textarea` outside `src/ui` and isolated Tiptap
  implementations has an exact, reasoned registry entry. New or stale counts fail UI policy CI.
- Treat `legacy-form-control` entries as named migration debt, not precedent for new controls.

Source grounding:

- [`docs/guidance/ui/specialized-control-policy.md`](/docs/guidance/ui/specialized-control-policy.md)
- [`scripts/check-ui-policy.ts`](/scripts/check-ui-policy.ts)
- [`scripts/ui-control-exceptions.json`](/scripts/ui-control-exceptions.json)

### 4. Attendance stays presence-first and scan-friendly

- Attendance UI is optimized for quick scanning and teacher drill-down, not extra status taxonomy.
- Present and absent remain the primary user-facing states.
- Use a sortable teacher matrix/table view with clear date movement and lightweight summary counts.
- Detailed log content belongs in secondary inspection, not inside each row.

Source grounding:

- [`docs/core/design.md`](/docs/core/design.md)
- [`docs/core/architecture.md`](/docs/core/architecture.md)
- [`src/app/classrooms/[classroomId]/TeacherAttendanceTab.tsx`](/src/app/classrooms/[classroomId]/TeacherAttendanceTab.tsx)

### 5. Assignment surfaces expose status, due date, and save state clearly

- Assignment list items should surface title, due date, and concise status without requiring expansion first.
- Student editing surfaces must make autosave and submit state obvious.
- Submission controls remain explicit primary actions rather than hidden behind menus.
- Teacher assignment views keep student status and work inspection adjacent to the assignment context.

Source grounding:

- [`docs/core/design.md`](/docs/core/design.md)
- [`src/app/classrooms/[classroomId]/StudentAssignmentsTab.tsx`](/src/app/classrooms/[classroomId]/StudentAssignmentsTab.tsx)
- [`src/app/classrooms/[classroomId]/TeacherClassroomView.tsx`](/src/app/classrooms/[classroomId]/TeacherClassroomView.tsx)
- [`src/components/AssignmentModal.tsx`](/src/components/AssignmentModal.tsx)

### 6. Toronto date language stays consistent across classroom workflows

- Use the existing Toronto-aware date helpers and the established app language for dates.
- Prefer predictable classroom-facing date labels instead of one-off formatting.
- Date presentation should feel consistent across attendance navigation, assignment due labels, and classroom-level scheduling affordances.

Source grounding:

- [`docs/core/design.md`](/docs/core/design.md)
- [`docs/core/architecture.md`](/docs/core/architecture.md)
- Current attendance and assignment surfaces already rely on Toronto-aware helpers.

## Stable Guidance Limits

- This file is intentionally narrow. It does not try to canonize the entire app.
- Teacher assignments/tests family rules live in [`teacher-work-surfaces.md`](/docs/guidance/ui/teacher-work-surfaces.md).
- If a current pattern exists in code but is not listed here, do not assume it is stable.
- Use an experimental draft when you want to propose reuse beyond the current stable rules.
