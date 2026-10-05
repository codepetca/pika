# Standalone Gradebook items

Teachers can use **More actions → Add other assessment** in Gradebook to record
original marks outside Classwork assignments or Tests. Classwork and Tests
appear automatically; the creation dialog explains this distinction. A manually scored
**Attendance – Term 1** item is one example; no attendance automation or daily
attendance columns are involved.

## Mark and calculation contract

- Each item has a title, positive points possible, category, relative category
  weight (0–999), and final-grade inclusion flag.
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

Standalone marks become student-visible as soon as the teacher saves them. Entering
participation or an external exam mark in Gradebook is the disclosure action;
there is no extra **Return marks** step. This applies to existing entered marks too.

Students see their own nonblank marks in **Gradebook marks** in the Classwork
summary, and in the aggregate **Grades** view when **Show grades to students** is
on. Hiding Classwork hides standalone marks in both places. Each API projects only
the current student's records, never the teacher payload or peer records.
Excluded, uncategorized, and zero-percent-category items show **Not counted**.
An explicit zero is a saved mark; blank is absent and never counted as zero.

Editing a mark or item details updates what students see. Clearing a mark removes
it from the list and calculation. This is a live record, not an immutable report
card. Fully scored, included, categorized items contribute alongside returned
Pika assignments and tests; those assignment/test return requirements are unchanged.

Legacy `returned_at` metadata and the service-only `return_marks` mutation remain
compatible with the existing database and older clients, but no longer control
standalone disclosure. This application change requires no migration or backfill.

## Storage and rollout

Migration `163_standalone_gradebook_items.sql` adds first-class items, original
scores, service-only atomic mutation functions, archive resource membership,
revision/maintenance guards, and student-purge integration. Scores are scoped to
both their item/classroom and current enrollment. Removing a student removes
that student's marks while preserving the item and other students' marks.
Classroom archive/restore preserves item metadata and original scores and legacy return metadata;
older archives without these tables restore an empty standalone-item set.

Pre-migration teacher reads remain usable with item creation disabled. Student
reads treat only a missing new table as no standalone records. Mutation calls
return a migration-required conflict; unexpected read errors fail visibly.
There are no browser-side database writes or schema fallbacks that fabricate
assignments. Apply the migration before deploying the item capability. Applying
it to an existing local or production database requires the normal
one-time target-and-migration authorization.

## UI change brief

Surface: existing Gradebook toolbar, item/score dialogs, teacher student pane,
and student Classwork summary. References: existing Gradebook assessment and
score editors, approved Attendance operational controls, Pattern Lab form/dialog
owners, and the Pattern Lab student Grades row composition.

| Need | Existing candidate | Decision | Reason |
|---|---|---|---|
| Add action | GradebookToolbar More actions menu | reuse | Secondary creation stays in the existing menu on desktop and mobile |
| Item details | ContentDialog, FormField, Input, Select | reuse | Canonical compact form and focus behavior |
| Original score editing | GradebookScoreDialog | extend | Same mark-entry interaction, explicit clear action |
| Mobile teacher marks | GradebookStudentPanel | extend | Item details and marks remain accessible |
| Deletion safeguard | ConfirmDialog | reuse | Explicit deletion scope and consequence |
| Student disclosure | Classwork summary and shared Card | extend | No new navigation or fake work |

Primary signal: **Edit categories** first with a settings icon, followed by **Add other assessment** in More actions and existing editable marks. Dividers follow **Add other assessment** and precede **Export gradebook**. No
charts, decorative status symbols, automated attendance, new shared primitives,
or new top-level surfaces. Both roles, desktop/mobile, light/dark; default,
create/edit, blank/scored/returned, clear, deletion confirmation, loading,
error, and archived states. Composite review covers toolbar reachability and
shared modal focus/keyboard behavior. Nearby Gradebook editing duplication is
kept feature-owned; extract only after stable behavior and genuine adopters
justify it. The Pattern Lab Grades composition renders the production presentation owners.

### Immediate visibility change brief (2026-10-05)

References: production Gradebook item/score dialogs and Pattern Lab Gradebook and
Student Grades visibility entries. Both roles, desktop/mobile, light/dark;
create/edit/save, empty/error, explicit zero, excluded mark, visibility off/on,
and delete dialog focus/keyboard behavior. Primary signal remains the existing
Save action and score rows. Remove standalone return controls without adding a
publication setting or new visual pattern. Reuse the student list and shared
form/dialog controls; extend item/score dialogs and student calculation for
immediate visibility. Composite review covers focus return and deletion only.
