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
  address. Copy email 2 uses selected students' stable roster bindings, skips
  blanks and deduplicates addresses. Roster reads are prefetched separately from
  grades; loading/failure disables copying and a failed read has an explicit retry.
  No new personal data field or guessed address convention is introduced.

## Follow-up menu refinement

- Surface/reference: teacher Gradebook toolbar and approved Pattern Lab Gradebook.
- Reuse the shared icon menu and Lucide MoreVertical, matching the prototype's
  existing vertical-dot trigger; retain its accessible name, tooltip and 44px target.
- Extend only Gradebook's menu copy to Copy email 2. Roster-wide terminology is a
  separate scope question; storage and import contracts remain unchanged.
- Verify teacher desktop/mobile, light/dark, menu closed/open/focused and selected
  email menu. Student UI is n/a (teacher-only controls); confirm role isolation.
- Risk profile: none for this icon/label refinement. No new shared owner, layout,
  title-save changes or copy-data wiring in that earlier icon/label pass.
  Composite keyboard/focus checks apply.

## Accessibility and verification

### Approved completion pass

The maintainer authorized one additional fix/review pass for Test-title refresh
and Email 2 copying. Scope remains teacher Gradebook; no roster-wide rename,
schema change, migration or merge is authorized.

| Need | Existing candidate | Decision | Reason |
|---|---|---|---|
| Copy Email 2 | Gradebook student-actions menu | extend | Enable the existing command; keep its shared keyboard/focus owner |
| Alternate addresses | Teacher-only roster API | reuse | Use existing counselor_email values and stable student bindings |
| Tests title refresh | Tests-updated event and request cache | reuse | Refresh the mounted list after potentially committed title writes |
| Copy failure/retry | AppMessage, Button, inline error surface | reuse | Explicit empty/failure feedback without changing the grade table |

Reference: approved Pattern Lab Gradebook. Verify teacher desktop/mobile,
light/dark, selected/enabled copy, loading/empty/error/retry, clipboard failure,
and return-to-Tests after full/partial title saves. Student UI remains unchanged;
confirm no teacher-only menu exposure. Prefetch addresses so clipboard writing
starts within the user's click/tap, without awaiting a network request.
Risk profile: workspace-state. No new visual pattern or shared primitive.

Test-title writes invalidate the Tests list and emit its existing classroom-scoped
update event, including uncertain/partial writes. The list uses the canonical
server title for that test instead of reapplying a retained editor's stale title,
while preserving other draft-summary fields. Tests remain mounted during the
regression flow; both successful and partial saves are covered.

Shared menus, segmented controls and dialogs retain their keyboard and focus
contracts. Category dragging uses pointer and keyboard sensors; controls have
named 44px targets. Weight rows have row headers and named inputs/outputs.
Selection and the student inspector retain keyboard row navigation and Escape.

Current visual evidence and final verification results are recorded on the PR.
Local screenshots live under ignored `output/playwright/`. Browser-only expanded
fixtures are labeled separately from persisted demo-data verification.

## Ultra-compact display preference

- Surface/reference: teacher Gradebook table and More actions; approved
  `/pattern-lab#mockup-gradebook-panel`, with production-owner evidence at
  `/pattern-lab#gradebook-compact`.
- Extend GradebookToolbar, GradebookTable and local display preferences;
  reuse shared checked menu items, inputs, buttons, tooltips and table owners.
  No shared primitive or new experimental pattern is introduced.
- Default off; remembered in the existing local display preference record.
  Assessment headers show codes, categories show at most four letters,
  weight inputs are 44px wide, and assessment/course/average percentages round
  to whole numbers for display. Original values and calculations remain exact.
- Percentage columns are 56px; raw-score columns use 64px with earned marks only.
  Raw mode shows the maximum once per assessment in a Max mark row before
  Weight, even when weights are hidden; regular raw mode uses the same row. The second name column is hidden in ultra-compact mode; the first displayed name and
  Final retain their configured widths. Toggling off restores configured widths.
- Teacher: desktop/mobile, light/dark; toggle on/off, menu open/checked/focused,
  weight input editing, raw scores, override indicators and horizontal scrolling.
  Student: n/a for layout; teacher-only specimen role isolation checked.
- Signal: narrow columns and short labels. No new decoration, dependencies,
  grade calculations or student display changes. Composite menu keyboard and
  focus behavior reuse the canonical owner. Risk profile: none.
- Verification: preference normalization and live remount persistence, compact
  labels/rounding and precise edit information, unchanged Final precision;
  Playwright screenshots of the production owners with deterministic fixtures
  at 1440×900 and 390×844, both themes, plus 44px weight-input target checks.
  Nearby legacy Pattern Lab mockup renderer duplication remains a future
  refactor candidate; this specimen uses the live production owners.

## Maximum override modal

- Reuse the Gradebook mark dialog, native Select, table buttons and RotateCcw
  indicator. Extend the dialog with a maximum target and positive-number validation.
- Raw Max mark cells open Edit max mark. Each save chooses Keep existing marks
  (percentage changes) or Preserve percentages (earned marks scale with the new
  maximum). A refresh action restores the original maximum and original scale.
- Original assignment/rubric/Test/item definitions stay intact. Override maximum
  and scale persist with the assessment. Newly entered marks are normalized by
  the current scale in a classroom-locked write; precision is retained internally.
  These overrides also apply to returned-only student Grades calculations.
- Migration 210 is required. Before it is applied, the Gradebook remains readable
  and maximum editing stays disabled. No migration is applied without the exact
  target/migration permission in the schema rollout checklist.
- Verify teacher desktop/mobile and both themes: original, modal open, both save
  choices, overridden indicator, refresh, validation, failure, archived and saving.
  Student calculation and disclosure are tested server-side; student layout is
  unchanged. Risk: workspace-state; independent review: high (grade arithmetic,
  persisted schema, authorization and serialized writes).

### Maximum override rollout and rollback

Deploy this application revision fully before applying migration 210. Until the
RPC is present, reads use original marks and maximum editing is disabled. After
activation, all mark writers must run this revision: previous deployments write
effective marks directly and are unsafe against normalized marks when a scale
is active. Do not roll back or route traffic to an older deployment while any
maximum override/scale remains. Before rollback, restore every maximum through
the new application and verify all maxima are null and scales are 1. This returns
marks to original source coordinates; the old application can then read/write
that coordinate system. Production activation and rollback remain human controlled.

Migration 210 extends the existing cold-archive normalization chain with null
maximums and scale 1 for historical rows, retaining current overrides on restore.
Scale is bounded from 1e-12 to 1e12; out-of-range cumulative changes are rejected
without changing saved state, and reset remains available. Fractional marks remain
exact internally. The manual mark editor initializes to the displayed tenth;
only an explicit Save creates that rounded manual mark.

Local preflight on 2026-09-26 found shared migration 209 belongs to the pending
Stripe billing foundation (PR1366), so gradebook uses migration 210. Do not treat
a matching version number alone as application evidence: verify its name and RPC
contract. On 2026-09-26 the owner approved local210, applied once from an
isolated billing-baseline checkout with the identical reviewed gradebook SQL.
The dry run listed only210; database contracts and generated type checks pass
there. No billing migration, reset or history repair ran. Integrating canonical
types into this feature branch still awaits the merged billing209 baseline.

## Above-maximum grade signal

- Surface/reference: teacher Gradebook table and production-owner compact specimen;
  reuse the mark dialog's existing over-total warning semantics and warning tokens.
- Extend score/final/average cells with a warning background, border, bold value
  without status icons. Keep values and column widths intact.
  Exact percentages/maximums remain in accessible labels and hover explanations.
- Threshold is above 100%, or earned above possible; an earned mark of 150/200
  stays ordinary. Grade calculations remain unchanged.
- Teacher desktop/mobile, light/dark, regular/compact, raw/percent; normal, exact
  maximum, over maximum, overridden, disabled/read-only, hover/focus and summaries.
  Student: n/a; this table is teacher-only, with student specimen isolation checked.
  Primary signal: highlighted mark; warning text remains in hover/accessibility labels. Composite behavior is reused.
  Risk: none (display treatment); independent review is a bounded display review.

User refinement: remove warning and refresh/override glyphs from the teacher
mark table (including max mark status). The mark dialogs retain reset actions.
Reuse table controls and warning tokens; extend presentation only. Verify the
same density/mode/viewport/theme matrix and student-role isolation.
