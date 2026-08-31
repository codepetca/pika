# Status catalog audit: Attendance and assessments

Scope: audit the current direction and render approved examples in Pattern Lab; no production attendance or grading behavior changes.

## Attendance reference

Use the combined Daily/Attendance owner (`TeacherAttendanceTab.tsx`) and its extracted `TeacherAttendanceControls.tsx`. `TeacherLiveAttendanceTab.tsx` retains the same visual controls in the older standalone fixture. The teacher operational-table canon governs the composition.

| State | Current presentation | Count chip |
|---|---|---|
| Present | Green `attendance-present` (#2dbf00), dark count text | Yes |
| Late | Yellow `attendance-late` (#f1c700), dark count text | Yes |
| Absent | Red `attendance-absent` (#b10606), white count text | Yes |
| Unmarked | No selected row option; neutral semantic token | No |

- Colors are identical across light/dark themes. Selected row circles use a ring; inactive choices use a subdued fill.
- Count chips are rounded number-only pills, 28 × 20px visually, inside 44px controls. Counts use tabular numerals and describe rows in the current scope.
- Chips sit in the trailing table header. Clicking brings matching rows first, without filtering others out. Active sort has a ring and pressed state. Tooltips/accessibility labels include status, count, and sorting action.
- Do not duplicate these totals in the page context row. Preserve zero-count chips and omit Unmarked as the current owner does.
- Student `Checked in` is a separate confirmation, not a claim that the teacher-derived mark is Present. Older log-derived attendance helpers are not the source for the live attendance catalog.

## Shared catalog boundary

Share control geometry, typography, focus and count behavior where semantics match. Keep attendance colors/domain labels separate from assessment states. The existing `AssessmentStatusIndicator` supports assignment, test and gradebook mappings; actions such as Grade and Return must remain distinct from state labels.

User decision: retain colored, number-only count chips. Do not add status icons beside the counts. Keep the contextual tooltips, descriptive accessible names, keyboard focus, and selected-sort rings. This applies to count chips; it does not remove existing action icons or change assessment status meanings.

## Verification and incidental fix

Inspected current attendance screenshots at 1440 × 900 and 390 × 844, in both themes. The four existing Attendance browser contracts pass after removing an empty trailing slot from a primary-only PageActionBar. That empty slot, introduced by the earlier centered-actions change, reserved a 12px gap and shifted the existing Attendance cluster 6px left. Centered bars with real primary actions still reserve equal side columns.

## Pattern Lab implementation brief

User requested visible examples after the design-only handoff. Add the examples directly in Core controls, under Page actions, with an anchor for direct preview. Use existing live Attendance colors/controls and existing assessment display mappings, without changing production workflows.

| Need | Existing candidate | Decision | Reason |
|---|---|---|---|
| Attendance counts and row choices | AttendanceStatusSortChip / AttendanceStatusControl | reuse | Render the exact production owners with fixed, editable sample rows; no icons in counts. |
| Assessment colors and labels | Assignment/Test work-status display helpers | reuse | Show actual labels and semantic colors, retaining the difference between Graded and Returned. |
| Catalog composition | Pattern Lab Core controls / Card / DataTable | extend | Put visible examples where the user is looking, without another application-wide component. |

Matrix: teacher/student Lab, desktop 1440x900/mobile 390x844, light/dark, default, hover/focus, selected sort and changed local mark. Keyboard names/pressed state/44px targets remain owned by the reused controls. All sample changes are browser-local, with no API calls or attendance writes. No new dependencies. Refactor candidate: inline Test count-chip geometry differs from Attendance; do not silently change that production surface in this catalog-only update.

Implemented in `src/app/__ui/StatusPatterns.tsx`, directly under Controls at `/pattern-lab#status-colors`. The catalog also links to these examples from Statuses. Production attendance components supply count pills and row controls; existing assignment/test display helpers supply assessment labels and colors. Five fixed sample students support sorting, local mark changes, zero counts and reset without saving.

Final verification: focused checks passed (135 files / 1,335 tests, architecture, UI/design policies, TypeScript and lint). Eight browser contracts passed across teacher/student, desktop/mobile and light/dark. Inspected the four visual variants; matching role screenshots have identical hashes. Verified number-only counts, hover/focus labels, keyboard activation, active sorting, all rows retained, local updates, zero counts and reset. Evidence: session visualization folder `status-catalog-preview`. Prior full Pattern Lab snapshot-baseline acceptance remains a separate pre-publication step.

## Smaller attendance selection circles

User refinement: reduce the visible selection circles from 28px to 20px, retaining 44px interaction targets, selected rings, colors, opacity and count-chip dimensions. Decision: extend the existing AttendanceStatusControl presentation; keep the matching standalone Attendance control consistent. Pattern Lab renders the production owner, so its examples update automatically. Verify both Lab roles and the actual Attendance fixture across desktop/mobile and light/dark. No status, sorting, count or persistence behavior changes.

Smaller-circle verification: 56 focused component tests and 12 browser contracts pass (8 Lab role/theme/viewport combinations plus 4 Attendance fixture combinations). Inspected the updated Lab screenshots in both roles/themes/viewports. Confirmed the visible browser now renders approximately 20px circles within 44px controls; count pills remain unchanged. No production merge is needed to see this local preview.
