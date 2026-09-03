# Live Gradebook adoption

## Approved scope and change brief

The maintainer accepted the Gradebook prototype on 2026-09-02 and authorized
merging #1167 and beginning live adoption. This approval covers Gradebook only;
other page compositions remain experimental.

- Reference: `/pattern-lab#mockup-gradebook-panel` from #1167.
- Teacher: desktop 1440×900 and mobile 390×844; light/dark; loaded, empty,
  loading/error/retry, selected, horizontal/vertical scroll, category editing,
  locked percentages, assessment editing, invalid input, saving/failure.
- Student: existing Classwork and Test titles remain canonical; no student
  layout change or new access to teacher Gradebook data.
- Signal: persistent centered display controls, quiet utilities at the right,
  compact assessment columns, two optional metadata rows, opaque frozen cells.
- Exclusions: other Pattern Lab page migrations, dependencies, schema changes,
  production migrations/deployment, new student-grade visibility.
- Risk profile: workspace-state; independent-review risk: standard.

| Need | Decision | Owner/reference |
|---|---|---|
| Category and assessment editors | extend | Shared `components/gradebook` owners now serve the fixture and live page; add async save/error handling |
| Toolbar and matrix controls | reuse | TeacherWorkSurfaceContextBar, action menus, SegmentedControl, IconButton, DataTable, KeyboardNavigableTable |
| Display/calculation helpers | extend | Existing Gradebook math, extracted display/editor helpers in `src/lib` |
| Persistence | reuse | Gradebook category/weight API; Classwork assignment writer; versioned Test draft writer |
| Student inspector | reuse | Existing detail content extracted without changing its role |

## Data and interaction contract

- Percentage locks are editor-local balancing controls, not server permissions.
  Unlocked shares rebalance top-to-bottom; new edits use 0.5% steps. Existing
  hundredth-percent settings remain exact until the teacher explicitly converts
  them. The API retains its backward-compatible hundredth-percent contract.
- New categories receive item weight 10 internally. Existing configured default
  weights are preserved, not silently rewritten by this UI adoption.
- The live API requires at least one category; the zero-category fixture remains
  available in Pattern Lab. Deleting a category leaves affected items at None.
- Title saves use the original assignment/Test records. Test titles use the
  versioned draft API, preserving question content. Title and Gradebook details
  are separate saves; partial success is reported explicitly and caches invalidated.
  Live titles may duplicate other assessment titles, matching those writers.
  Only Pattern Lab's title-keyed score fixtures require unique titles.
- Gradebook totals do not fall back to legacy totals when configured categories
  contain no counted grades. None is excluded, while legacy classrooms without
  categories retain their existing calculations.
- Unsaved inline drafts survive refreshes; per-item save queues and classroom
  request fences are preserved. Archived classrooms cannot edit.
- Score mode, summary, names/IDs, weights, and frozen-column preferences persist
  locally. Export quotes CSV fields and neutralizes formula-like text.
  Frozen columns intentionally match the approved prototype: selection, the first
  displayed name, and Final. Freezing both names and IDs would crowd assessments
  off the mobile viewport. Returning from Classwork invalidates the Gradebook
  cache before refreshing, even within its normal cache lifetime.
- The maintainer chose the display label Email 2 for the existing counselor_email
  address. The Gradebook command is Copy email 2; it remains disabled until its
  roster-data wiring is completed in a subsequent reviewed pass. No new personal
  data field or guessed address convention is introduced.

## Follow-up menu refinement

- Surface/reference: teacher Gradebook toolbar and approved Pattern Lab Gradebook.
- Reuse the shared icon menu and Lucide MoreVertical, matching the prototype's
  existing vertical-dot trigger; retain its accessible name, tooltip and 44px target.
- Extend only Gradebook's menu copy to Copy email 2. Roster-wide terminology is a
  separate scope question; storage and import contracts remain unchanged.
- Verify teacher desktop/mobile, light/dark, menu closed/open/focused and selected
  email menu. Student UI is n/a (teacher-only controls); confirm role isolation.
- Risk profile: none for this icon/label refinement. No new shared owner, layout,
  title-save changes or copy-data wiring. Composite keyboard/focus checks apply.

## Accessibility and verification

Shared menus, segmented controls and dialogs retain their keyboard and focus
contracts. Category dragging uses pointer and keyboard sensors; controls have
named 44px targets. Weight rows have row headers and named inputs/outputs.
Selection and the student inspector retain keyboard row navigation and Escape.

Current visual evidence and final verification results are recorded on the PR.
Local screenshots live under ignored `output/playwright/`. Browser-only expanded
fixtures are labeled separately from persisted demo-data verification.
