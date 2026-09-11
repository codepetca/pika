# Standalone Gradebook items

Teachers can use **More actions → Add other assessment** in Gradebook to record
original marks outside Classwork assignments or Tests. Classwork and Tests
appear automatically; the creation dialog explains this distinction. A manually scored
**Attendance – Term 1** item is one example; no attendance automation or daily
attendance columns are involved.

## Mark and calculation contract

- Each item has a title, positive points possible, category, relative category
  weight (1–999), and final-grade inclusion flag.
- Items start with blank marks. Blank marks do not contribute to a student's
  running grade; an explicitly recorded zero does.
- Category percentages and relative weights use the existing Gradebook
  calculation. Excluded or uncategorized items do not contribute.
- Item scores are original records in `gradebook_item_scores`.
  Assignment/Test/final overrides remain in `gradebook_score_overrides`.
  **Undo all overrides** never changes standalone marks.
- The teacher table, student inspection pane, class summaries, and CSV export
  include standalone columns. Existing assignment/Test subtotals keep their
  original meaning; the overall grade includes qualifying standalone items.
- Teachers can clear a mark, edit details, or deliberately delete an item and
  all its marks. Archived classrooms remain read-only.

## Student disclosure

The approved future student Grades product is currently only a Pattern Lab
prototype. This feature adds no top-level navigation or aggregate Grades screen.
Returned standalone marks appear in a **Returned marks** section of the existing
student Classwork summary; they are not assignments and have no submission or
feedback link. Hiding Classwork hides its returned-mark section too.

**Return marks** in the item details dialog explicitly releases all currently
entered marks for that item. Blank marks remain absent. Each student's API
projects only their returned records, never the teacher payload or peer records.
Excluded, uncategorized, and zero-percent-category items show **Not counted**.

Changing an original mark withdraws that mark until returned again. Re-saving
an identical score preserves its return state. Changing
item details (including removal of its category) withdraws its marks until returned again, so altered meaning or
points are never silently released. Re-saving identical details preserves
return state. This is a live returned record, not an immutable report card.

The future Grades calculation must include fully scored, returned, included,
categorized items alongside returned assignments and Tests. It must omit
unreturned items from both the supporting list and aggregate. There is no live
student aggregate in this implementation.

## Storage and rollout

Migration `162_standalone_gradebook_items.sql` adds first-class items, original
scores, service-only atomic mutation functions, archive resource membership,
revision/maintenance guards, and student-purge integration. Scores are scoped to
both their item/classroom and current enrollment. Removing a student removes
that student's marks while preserving the item and other students' marks.
Classroom archive/restore preserves item metadata and original/returned scores;
older archives without these tables restore an empty standalone-item set.

Pre-migration teacher reads remain usable with item creation disabled. Student
reads treat only a missing new table as no standalone records. Mutation calls
return a migration-required conflict; unexpected read errors fail visibly.
There are no browser-side database writes or schema fallbacks that fabricate
assignments. Apply the migration before deploying the item capability. Applying
it to an existing local, staging, or production database requires the normal
one-time target-and-migration authorization.

## UI change brief

Surface: existing Gradebook toolbar, item/score dialogs, teacher student pane,
and student Classwork summary. References: existing Gradebook assessment and
score editors, approved Attendance operational controls, Pattern Lab form/dialog
owners, and the experimental returned Grades row composition.

| Need | Existing candidate | Decision | Reason |
|---|---|---|---|
| Add action | GradebookToolbar More actions menu | reuse | Secondary creation stays in the existing menu on desktop and mobile |
| Item details | ContentDialog, FormField, Input, Select | reuse | Canonical compact form and focus behavior |
| Original score editing | GradebookScoreDialog | extend | Same mark-entry interaction, explicit clear action |
| Mobile teacher marks | GradebookStudentPanel | extend | Item details and marks remain accessible |
| Deletion and return safeguards | ConfirmDialog | reuse | Explicit scope and consequence |
| Student disclosure | Classwork summary and shared Card | extend | No new navigation or fake work |

Primary signal: **Edit categories** first with a settings icon, followed by **Add other assessment** in More actions and existing editable marks. Dividers follow **Add other assessment** and precede **Export gradebook**. No
charts, decorative status symbols, automated attendance, new shared primitives,
or new top-level surfaces. Both roles, desktop/mobile, light/dark; default,
create/edit, blank/scored/returned, clear, deletion/return confirmation, loading,
error, and archived states. Composite review covers toolbar reachability and
shared modal focus/keyboard behavior. Nearby Gradebook editing duplication is
kept feature-owned; extract only after stable behavior and genuine adopters
justify it. The student Grades prototype remains experimental.
