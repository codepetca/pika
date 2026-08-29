# Attendance Product Design QA

## Comparison Target

- Source visual truth: `docs/guidance/ui/evidence/attendance-actions-2026-08-27/approved-design-reference.png` for the approved always-editable hierarchy, plus the user's explicit interaction revisions through 2026-08-28
- Primary implementation screenshots:
  - `docs/guidance/ui/evidence/attendance-actions-2026-08-27/teacher-desktop-light-default.png`
  - `docs/guidance/ui/evidence/attendance-actions-2026-08-27/teacher-desktop-light-closed.png`
  - `docs/guidance/ui/evidence/attendance-actions-2026-08-27/teacher-desktop-light-manual-with-undo.png`
  - `docs/guidance/ui/evidence/attendance-actions-2026-08-27/teacher-desktop-light-selected-menu.png`
  - `docs/guidance/ui/evidence/attendance-actions-2026-08-27/teacher-desktop-light-no-hours.png`
- Additional responsive/theme evidence: all `teacher-desktop-*` and `teacher-mobile-*` captures in the same evidence directory
- Route: `/e2e-fixtures/teacher-live-attendance`
- Role: teacher; student is not applicable to this teacher-only surface
- States: open default, closed session, QR correction with Undo, one checked student with the selected-student menu open, automatic-status restoration, QR check-in removal, internally scrolled/sorted roster, Attendance timing dialog, and no-session-time fallback

## Dimensions and Normalization

- Source: 1440 x 900 CSS pixels and image pixels at device scale factor 1.
- Desktop implementation: 1440 x 900 CSS pixels and image pixels at device scale factor 1.
- Mobile implementation: 390 x 844 CSS pixels and image pixels at device scale factor 1.
- The source and implementation default captures were reviewed together at the same 1440 x 900 viewport and state. Additional captures were reviewed as a desktop/mobile, light/dark state matrix.
- The source remains an exploration rather than product authority, so comparisons judge approved hierarchy and component treatment while production retains Pika's real tokens, data density, permissions, and commands.

## Findings

No actionable P0, P1, or P2 mismatch remains.

- Fonts and typography: the implementation uses Pika's production font stack, weights, and compact table type scale. Hierarchy, legibility, and truncation behavior are consistent with the shared work surface.
- Spacing and layout rhythm: the content-sized clickable session range sits in the left context slot, while refresh remains quiet at the opposite edge and the action hierarchy stays centered. The full `12:45 AM - 10:34 PM` example fits without crowding the QR, close, or selected-student controls. Row status visuals are reduced to 28 px within retained 44 px hit targets, and zero vertical cell padding keeps the roster compact without overlapping actions. The date arrows directly touch the date segment. At 390 px, session context and commands condense into one compact menu without overlap.
- Colors and visual tokens: semantic Pika surface, text, focus, attendance-status, light, and dark tokens render consistently. The time control uses a subtle success surface only while the session is confirmed open, without adding visible `Open` copy; closed, stale, and pending treatments remain neutral. The active row status is full-strength with a primary blue ring and subtle shadow; the other two choices remain discoverable at 12% opacity. Count pills and visible discs share a 28 px width on a 44 px direct-action grid.
- Copy and content: the implementation preserves Attendance-specific terms and does not import Test terminology. `Check-in` contains the Toronto-local QR check-in time and is visually empty when no QR check-in exists. The session range, Check-in, and QR expiry use uppercase `AM`/`PM`; the session range uses spaces around the dash.
- Icons and affordances: the old trailing Attendance hours icon is removed. The leading session range itself is a subtle button that opens Attendance hours; its accessible name still announces the session state, and a clock button occupies the same leading slot when no range exists. The selectable date has no dropdown chevron. Row status controls are icon-free; remaining utility and menu icons use Pika's existing Lucide family with accessible names and tooltips.
- Selection and actions: checkbox selection remains independent from always-available row corrections. The persistent selected-student menu is disabled until selection and then exposes the selected count, automatic-status restoration, and QR check-in removal. Broad whole-roster status buttons and a manual-attendance mode toggle are absent. Per-row Undo restores the timing-derived automatic status after a manual correction.
- Responsiveness and accessibility: desktop/mobile light/dark captures have no document overflow. Row status controls preserve Pika's 44 x 44 direct-action target around the explicitly requested 28 px visual circle, while retaining named pressed states, visible focus rings, roving focus, and Arrow/Home/End behavior. Mobile keeps Attendance hours in the condensed action menu. The internal roster scroller retains sticky sortable/resizable headers.
- Interaction/runtime check: checkbox selection, select-all semantics, selected-student actions, direct row changes, QR Undo, status sorting, internal scrolling, mobile session menu, clickable session range, no-time clock fallback, and Attendance hours were exercised in Chromium. Browser console and page errors remained empty in all four projects.

## Comparison History

### Pass 11 — leading time control and open-only color, passed

- Restored the content-sized Attendance time control to the left context slot, leaving the date and action controls centered.
- Limited the subtle success background to a confirmed open session. Closed, scheduled, cancelled, stale, and pending states stay neutral while the accessible name continues to announce the actual state.
- Added explicit light/dark closed-session captures and assertions, then compared those with the open state and the refreshed two-state Product Design reference. No actionable mismatch remains.

### Pass 10 — centered time control and smaller row circles, passed

- Moved the content-sized Attendance time control into the centered primary action cluster immediately after the joined date navigator.
- Removed the visible `Open` label and status dot. The open state now uses a subtle semantic success background while the control's accessible name continues to announce `Open`.
- Reduced visible row status discs/count pills from 32 px to 28 px while preserving 44 px status and QR-Undo hit targets to satisfy Pika's direct-action accessibility contract.
- Compared the refreshed 1440 x 900 Product Design source and implementation together and reviewed desktop/mobile light/dark default, selected-menu, Undo, hours-dialog, scrolled-header, and no-hours states. No actionable mismatch remains.

### Pass 9 — left-fitted time control and denser row choices, passed

- Moved the clickable session-time control to the left edge of its context track and removed the stretching/right-alignment rules.
- Exercised the longest requested example, `Open · 12:45 AM - 10:34 PM`, and confirmed the button remains content-sized and below one-third of the desktop context bar width.
- Reduced row status targets from 44 px to 36 px and visible discs/count pills from 36 px to 32 px. The compact target removes eight pixels from the control-driven row height while preserving the selected ring, inactive opacity, semantic pressed states, tooltips, and keyboard model.
- Compared the refreshed 1440 x 900 source and implementation together and reviewed desktop/mobile light/dark default, selected-menu, Undo, dialog, scrolled-header, and no-hours states. No actionable mismatch remains.

### Pass 8 — always-editable controls and direct session-time editing, passed

- Removed the manual-attendance mode concept from the approved direction; the fixed Present/Late/Absent control is always available when existing Attendance permissions allow marking.
- Reduced inactive status discs from 35% to 12% opacity and removed the segmented-control track, preserving a quiet fixed three-column grid. The selected disc remains full-strength with its blue ring.
- Widened count pills to 36 px and aligned their 44 px targets with the row status columns.
- Replaced the trailing Attendance hours icon with a directly clickable session range using spaced-dash time formatting. Dates without a range show a clock fallback in the same leading slot. Its final left alignment and content sizing are recorded in Pass 9.
- Compared the final 1440 x 900 source and implementation together, then verified desktop/mobile light/dark default, selected, menu, Undo, dialog, scrolled-header, and no-hours states. No actionable mismatch remains.

### Pass 7 — smaller discs and stronger selected state, passed

- Reduced the visible attendance disc from 44 x 44 to 36 x 36 while retaining the 44 x 44 target, focus behavior, fixed order, and named pressed states.
- Added a semantic primary ring and subtle shadow to the selected disc and standardized visible Attendance times to uppercase `AM`/`PM`.
- The four-project Chromium matrix passed with explicit geometry, opacity, ring, and time-label assertions.

### Pass 6 — icon-free circular row controls, passed

- Removed the check, clock, and x icons from the three row status buttons and changed the visible state marks to circles.
- Preserved semantic color, fixed order, tooltips, named pressed states, and roving Arrow/Home/End keyboard behavior.

### Pass 5 — checkbox selection restored, passed

- Restored row/select-all checkboxes and the persistent selected-student actions menu.
- Removed the superseded whole-roster status buttons while retaining per-student controls, Check-in time, and QR correction Undo.
- Removed only the visible `Status` header text; accessible sortable counts remain.

### Pass 4 — whole-roster direction, superseded by Pass 5

- Explored confirmed whole-roster status actions at the user's direction at that point.
- This interaction was later explicitly reverted; it is retained here only as decision history and is not current conformance evidence.

### Passes 1–3 — responsive and accessibility refinements, passed

- Resolved mobile utility overlap by condensing session actions without moving the mathematically centered primary cluster.
- Verified the selected hierarchy across desktop/mobile light/dark.
- Independent review strengthened shared menu row target height/focus treatment and corrected the teacher work-surface guidance mapping.

## Follow-up Polish

None required. Durable teacher work-surface guidance already covers the reusable hierarchy; the status-disc opacity, clickable session range, time formatting, and no-time fallback are Attendance-specific.

final result: passed

# Compact assignment-history chart design QA

## Source and corrected target

- Visual source: the user-provided 1536 × 1024 concept image reviewed during
  this task. It is not stored in the repository.
- Corrected user direction: show the complete save history in one chart at the
  existing 240–256 px sidebar size. The horizontal axis covers the student's
  actual activity days, including work outside assigned and due dates.
- Intended state: a teacher or student can immediately see whether work happened
  in one clump and whether each save added or deleted content, then inspect the
  individual saves from that same chart.

## Implementation evidence

- Playwright captures were reviewed locally for desktop/mobile and light/dark.
  Generated screenshots live under the repository's intentionally gitignored
  `artifacts/` directory, so this note records the verified matrix rather than
  presenting those local files as durable repository evidence.
- Teacher target width: 256 px.
- Student target width: 240 px, matching the original desktop history column.

The source and the final implementation screenshots were inspected together in one comparison input. The compact chart intentionally adapts the concept to Pika's real sidebar width instead of reproducing the concept's large inspector and lower detail view.

## Comparison

- Layout: one compact chart contains the complete save history across the first
  through last activity days. Assignment, due, and submission dates do not crop
  or extend the horizontal range.
- Data: each save is a vertical mark around a centered zero line. Additions rise
  in semantic success green and deletions fall in semantic danger red. Closely
  timed saves retain chronological order and a small minimum visual separation.
- Interaction: horizontal nearest-save selection previews individual saves.
  Click pins the nearest save. The same chart supports Arrow, Home, and End
  navigation as a labelled slider.
- Typography and spacing: titles and metadata no longer compete on one row. The chart fits the original narrow history column without cramped labels or an enlarged inspector.
- Color: semantic Pika tokens provide clear hierarchy in both light and dark
  themes. Green and red encode change direction; the selected save receives the
  only point marker and the zero baseline remains subordinate.
- Responsive behavior: teacher and student examples stack cleanly on mobile. The responsive viewport reported equal document scroll and client widths, with no horizontal overflow.
- Assets and icons: the chart is the product's existing code-native data visualization; no raster assets or icons are required for this compact state.
- Copy: teachers see `Student activity`; students see `Version history`. The
  only chart labels are the first and last activity dates, or one centered date
  when the history spans a single day.

## Accessibility and states

- The chart is a single focusable slider labelled `Complete save history`.
- `aria-valuenow` and `aria-valuetext` identify the selected save.
- Arrow, Home, and End behavior is covered by component tests.
- Hover preview, click pinning, keyboard focus, role language, empty state,
  clustered history, desktop/mobile, and light/dark states were checked.
- Student restore confirmation and teacher preview/pin wiring remain in the existing callers and are unchanged.

## Findings

- No P0, P1, or P2 findings remain.
- The earlier two-level explorer was removed after the user clarified that the entire history must remain in one small chart.

## Final result

passed

## History preview framing follow-up

The compact chart and its dimensions remain unchanged. The document pane now has
three deliberate states:

- current: normal scale and the reader's existing scroll position;
- hover: the complete historical document is scaled into the available pane;
- pinned: normal readable scale, starting at the top, with ordinary scrolling.

Ending a transient hover or exiting a pinned preview restores the current
document and the scroll position captured before preview began. Selecting a
different pinned save returns that save to the top. The fit calculation responds
to viewport resizing and image loading.

Playwright evidence was reviewed for teacher and student roles at 1440 × 900 and
390 × 844 in light and dark themes, including both hover and pinned states. The
captures are intentionally local and gitignored; the durable evidence here is
the explicit matrix and review result.

The whole-document signal is clear at desktop size, pinned text remains readable,
the narrow layout contains both panes without horizontal overflow, and semantic
colors remain legible in both themes. No P0, P1, or P2 findings remain.

## Activity-day addition/deletion refinement

### Change brief

- Surface: the existing compact assignment-history chart shared by the teacher
  student-work inspector and student assignment editor.
- Reference: the established 240–256 px Pika history sidebar and its existing
  hover-preview/click-lock interaction.
- Affected roles: teacher and student.
- Required viewports and themes: desktop/mobile and light/dark.
- Key states: default, hover preview, keyboard focus, pinned preview, and empty.
- Primary signal: vertical save marks above a centered zero line for additions
  and below it for deletions, positioned across the actual activity days.
- Must not add: assignment/due boundaries, judgments, legends, duplicate detail
  charts, session summaries, or decorative labels.
- Composite widget accessibility review: yes; the existing labelled slider and
  Arrow/Home/End behavior remain the governing interaction.

This is a refinement of the existing history chart, not a new history surface.
The visible copy is limited to the role-owned heading, empty state when needed,
and the first/last activity dates.

### Verification result

- Reviewed teacher and student screenshots at 1440 × 900 and 390 × 844 in
  light and dark themes, plus hover, pinned, keyboard-focus, and empty states.
- The day-based clumps and addition/deletion direction remain legible at the
  compact sidebar size. The keyboard focus ring is visible and no tested
  viewport has horizontal overflow.
- Focused component and graph coverage passes 123/123. TypeScript and lint pass.
- No P0, P1, or P2 visual or interaction findings remain.

### Composite-widget accessibility checklist

- Checklist reviewed: yes.
- Keyboard behavior covered: yes; Arrow keys, Home, and End select saves.
- Semantic state covered by tests: yes; the slider name, range position, and
  text alternative for character change are asserted.
- Remaining manual follow-up: none; visible focus was checked in Playwright.

## Dense-history semantic zoom refinement

### Change brief

- Surface: the existing compact assignment-history chart and the development
  gallery examples used to stress-test it.
- Reference: the current 240–256 px chart, including hover preview and
  click-to-pin behavior.
- Affected roles: teacher and student.
- Required viewports and themes: desktop/mobile and light/dark.
- Key states: fit-all overview, zoomed save detail, hover, pinned selection,
  keyboard focus, empty, long document, steady multi-week work, bursty rewrites,
  and a dense final-day crunch.
- Primary signal: the fit-all view aggregates additions and deletions by activity
  day; zooming reveals individual saves. Both directions share one linear
  character scale that recalculates for the visible range and uses the available
  chart height. Tiny exact-scale stems use a separate dot for visibility.
- Must not add: a permanent legend, activity judgments, assignment/due
  boundaries, a second chart, pan controls, or explanatory body copy.
- Composite widget accessibility review: yes. The save-history slider supports
  Left/Right/Up/Down/Home/End and labelled zoom buttons expose the view change.

The teacher surface removes the redundant visible `Student activity` heading
while retaining the section's accessible name. The student keeps its existing
role-owned heading.

### Verification result

- Reviewed teacher and student at 1440 × 900 and 390 × 844 in light and dark
  themes. No horizontal overflow was present at 390 px.
- Reviewed fit-all daily views for steady six-week work, bursty rewrites, a
  100-save final-day crunch, a single save, and empty history.
- Reviewed the long-document hover fit, 14-day individual-save zoom, pinned
  reading-size preview, and visible keyboard focus.
- Rechecked the review remediation in the rendered teacher gallery: clicking
  pinned the selected save at reading size, moving across the chart left the
  same save and slider value selected, and the Exit preview affordance remained
  visible. The post-remediation capture was visually reviewed with no layout
  regression.
- Reviewed the extreme large-paste fixture after removing the stem-height floor:
  the +530-character stem remains dominant, 20–30-character edits retain their
  exact proportional height, and their separate dots remain clear at both the
  240 px student and 256 px teacher widths. The mixed multi-day fixture also
  shows a direction-neutral selection ring on the zero line rather than implying
  that the selected save was an addition or deletion.
- Rechecked selection layering after targeted review: the neutral ring is behind
  the daily stems and dots, so the selected final-day deletion remains visibly
  red in both teacher and student compact charts. The refreshed capture has no
  console errors or layout regression.
- The zoom controls measured 44 × 44 px. Additions and deletions remain visibly
  distinct and share one proportional linear character scale.
- No P0, P1, or P2 visual or interaction findings remain.

### Composite-widget accessibility checklist

- Checklist reviewed: yes.
- Keyboard behavior covered: yes; Left/Right/Up/Down, Home, and End retain save
  navigation, and zoom controls are ordinary keyboard-reachable buttons.
- Semantic state covered by tests: yes; slider values/text, daily/save view
  changes, zoom button state, accessible group naming, and hidden-heading region
  naming are asserted.
- Remaining manual follow-up: none; focus visibility and target size were checked
  in Playwright.

## Zoomed-history wheel navigation and saved-state preview

### Change brief

- Surface: the existing compact teacher/student assignment-history chart and
  its long-document development fixture.
- Affected roles: teacher and student.
- Added gestures: vertical wheel zooms around the pointer; horizontal trackpad
  scrolling or Shift+wheel pans the bounded window after zooming.
- Zoom presentation: a 260 ms eased expansion/contraction keeps the chosen point
  as the visual origin; panning stays immediate and reduced motion is respected.
- Preserved interactions: fit-all overview, zoom buttons, Arrow-key/Home/End
  save navigation, hover-to-fit preview, and click-to-pin reading view.
- Visible copy remains unchanged; gesture instructions are connected to the
  slider with `aria-describedby`.

### Verification result

- Teacher desktop at 1440 × 900: wheel zoom changed the fit-all daily view to
  individual saves; a horizontal delta moved the start of the visible window
  earlier. Hovering the left and right sides of the resulting window rendered
  distinct four- and eighteen-paragraph saved states.
- Student mobile at 390 × 844: the same gesture sequence moved the date window
  and rendered distinct seven- and twenty-one-paragraph saved states without
  horizontal overflow.
- Light and dark screenshots were reviewed for both roles. Stems, baseline,
  date labels, zoom controls, preview border, and fitted text remained clear.
- A non-passive native wheel listener contains handled gestures inside the chart;
  the final teacher and student browser runs reported zero console errors.
- Chromium reported one active SVG animation with an intermediate scale and
  opacity during the transition, followed by no animation and the identity
  transform after completion; the mid-transition frame remained legible.
- No P0, P1, or P2 visual or interaction findings remain.

### Composite-widget accessibility checklist

- Checklist reviewed: yes.
- Keyboard behavior covered: yes; Left/Right/Up/Down/Home/End navigation and the
  keyboard-reachable zoom buttons remain covered.
- Semantic state covered by tests: yes; slider values, view mode, visible window,
  zoom status, and the connected gesture description are exposed semantically.
- Remaining manual follow-up: none.
