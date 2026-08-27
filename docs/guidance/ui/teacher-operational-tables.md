---
status: stable
scope: teacher operational work surfaces
approved_reference: Attendance table rhythm and selected Test grading actions
approved_on: 2026-08-27
executable_owners:
  - src/components/teacher-work-surface/TeacherWorkSurfaceContextBar.tsx
  - src/components/teacher-work-surface/TeacherWorkSurfaceTableFrame.tsx
  - src/ui/DataTable.tsx
reference_surface:
  - src/app/classrooms/[classroomId]/TeacherLiveAttendanceTab.tsx
  - src/app/classrooms/[classroomId]/TeacherTestsTab.tsx
---

# Teacher Operational Tables

This is the stable composition for scan-heavy teacher sections that combine an
active scope, sortable rows, status triage, and optional batch actions.
Attendance is the approved density, column, and scrolling reference. The
selected Test grading roster is the approved action-scope and selection
reference. Reuse the combined design language; do not copy either feature's
domain states or business logic.

## Migration direction

`TeacherWorkSurfaceContextBar` is the target top-control composition for
teacher pages as they are refreshed. Existing uses of
`TeacherWorkSurfaceActionBar` are transitional: do not add new uses, and when a
consuming page is materially updated, replace it with the context bar when the
adoption checklist below fits. Migrate one page or coherent workflow at a time
so its responsive hierarchy, scroll behavior, and interaction states can be
visually verified; do not perform an unreviewed mechanical replacement across
unrelated surfaces.

## Product hierarchy

Use one compact row directly above the table:

1. **Leading information:** quiet state or scope detail. It has no fill, border,
   hover treatment, or button-like weight.
2. **Centered actions:** the active scope control and only its immediate
   workflow commands. The elevated cluster is mathematically centered and is
   the obvious place to act.
3. **Trailing utilities:** low-priority utilities only. Row-derived totals do
   not belong here.

The table begins immediately below this row. Avoid an empty spacer, a second
summary row, or permanent top chrome. On narrow screens, preserve the centered
scope/actions and condense edge information instead of wrapping another row.

## Table anatomy

- Use the tight teacher density from `DataTable`.
- Put selection first only when selected rows feed real batch actions.
- Separate First and Last for people tables so both can sort independently.
- Follow identity with only the metadata needed for scanning. Secondary
  metadata may hide on narrow screens.
- Keep Status trailing so its header controls explain the state marks below.
- Use `SortableHeaderCell` for sortable columns and its shared resize behavior
  for adjustable data columns. Persist widths with a feature-owned key when
  repeated use justifies it.
- Keep status cells concise. Color needs an accessible name, tooltip, icon, or
  other non-color carrier, and compact color marks need a semantic boundary
  that remains visible against default, hovered, and selected row surfaces in
  both themes.

Daily provides the column and sorting rhythm. Attendance provides the approved
density and table composition. Selected Test grading provides the approved
global, selection-aware, and row-action composition.

## Status-count sorting

Use numbered status chips in the Status header when all of the following are
true:

- each chip maps directly to a meaningful row state
- teachers benefit from bringing that state to the top
- the set is small enough to remain legible without wrapping
- counts describe the currently displayed rows

Each chip is a button with a descriptive accessible name, a 44px target, a
visible pressed state, and a tooltip. Activating it prioritizes matching rows;
feature-owned tie breakers should keep ordering predictable. Column sorting
clears the active status priority, and activating another chip replaces it.

Do not add a chip for every internal state. Omit neutral or incomplete states
when they are not a teacher triage target, as Attendance does for Unmarked.
Do not repeat the same counts in the context row.

## Long-list, selection, and action scope

- Keep the context row outside the internal table scroller.
- Keep the table header sticky inside that scroller so columns and status-sort
  controls remain visible.
- Let only rows pass beneath the sticky header. Do not insert an
  `overflow-hidden` ancestor between it and the intended scroller.
- Keep global scope commands stable when rows are selected.
- Keep one selection-aware menu visible in the centered cluster. It is disabled
  with no selection and becomes a selected-count trigger when enabled.
- Keep the menu limited to feature-owned actions that truly apply to the
  selection. Do not duplicate global commands or add a clear-selection item.
- Apply immediate, reversible row state changes inline with a non-color state
  carrier. Do not require confirmation for each row toggle.
- Confirm broad global state changes and destructive actions. For costly or
  overwrite-capable actions, ask for the meaningful scope at execution time.
- `TeacherSelectionBar` remains legacy compatibility with no current production
  owner. Operational tables use the centered persistent menu and do not add
  bottom selection clearance.

## Executable composition

```tsx
<TeacherWorkSurfaceContextBar
  ariaLabel="Work controls"
  context={quietInformation}
  primary={scopeAndImmediateActions}
  actions={utilities}
/>

<TeacherWorkSurfaceTableFrame>
  <DataTable density="tight">
    {/* sticky sortable header and feature-owned rows */}
  </DataTable>
</TeacherWorkSurfaceTableFrame>
```

The shared components own layout, responsive hierarchy, and scroll containment.
The feature-owned action cluster owns command placement and selected-count context.
Features own labels, dates, statuses, semantic status colors, row data,
comparisons, column limits, loading, permissions, commands, and mutations.

## Adoption checklist

Adopt this composition only when all required answers are yes:

1. Is the surface a teacher workflow optimized for scanning rows?
2. Is there one meaningful active scope, such as a date, range, collection, or
   selected work item?
3. Can primary actions be distinguished from quiet information?
4. Do sortable columns or status prioritization help teachers find work?
5. If rows are selectable, do they lead to real batch actions?

If the first two answers are no, use the ordinary summary, workspace, or
authoring patterns instead. Status chips and selection are optional even when
the overall composition fits.

## Section mappings

| Section/state | Centered action focus | Table adaptation | Status-chip rule |
| --- | --- | --- | --- |
| Attendance | Date plus QR/open/close commands; migrate selection actions into the centered persistent menu | First, Last, Source, Status | Present/Late/Absent; Unmarked has no chip |
| Classwork operational list | Active collection, range, or selected assignment plus immediate commands | Title or student identity, relevant dates/metadata, Status | Use only for a small set of row states teachers actively triage |
| Tests summary | Active filter/scope and immediate create or management command | Test title, availability, response metadata, Status | Use only when counts map to visible test rows |
| Selected Test grading roster | Persistent Open All/Close All icons plus the disabled-until-selection student-actions menu | First, Last, Access, score/activity metadata, Status | Suitable for a small mutually meaningful set such as submission/review states |

These mappings define hierarchy, not final feature requirements. Before each
adoption, inspect the existing workflow, name its row states, and verify the
desktop/mobile, light/dark, default, sorted, scrolled, selected, empty, loading,
and error states that materially change.

## Must not add

- a second summary row beneath the context bar
- status totals duplicated outside the Status header
- informational chips that resemble actions
- a bottom selection toolbar or permanent clearance for one in new work
- selection replacing or hiding global scope commands
- confirmation for immediate reversible row toggles
- a generic data-grid owner that absorbs feature business logic
- Attendance-specific colors or statuses in another domain without semantic
  justification
