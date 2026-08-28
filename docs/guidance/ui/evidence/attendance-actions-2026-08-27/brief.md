# Attendance action hierarchy change brief

- Surface: teacher classroom Attendance tab
- Reference: approved Option 1 in `approved-design-reference.png`, grounded in the Test grading work surface merged by PR #1088, plus the user's Attendance-specific interaction revisions through 2026-08-28
- Affected role: teacher; student is not affected because this is a teacher-only operational surface
- Required viewports: desktop and mobile
- Required themes: light and dark
- Key states: default, one or more checked students with the selected-student menu open, a manual correction to a QR check-in with Undo visible, internally scrolled roster, and Attendance hours dialog
- Primary signal: a visually dominant, top-centered action cluster containing the joined previous/date/next navigator, immediate session actions, and a persistent selected-student menu that is disabled until a checkbox is selected
- Must not add: whole-roster Present/Late/Absent actions, a `Status` text label above the row controls, a date dropdown chevron, duplicate action chrome, Test-specific terminology, decorative treatments, or changes to Attendance permissions and command-confirmation behavior
- Composite widget accessibility review: yes; the joined date navigator, selected-student menu, table selection controls, sortable count controls, and per-student three-state control require accessible names, semantic state, keyboard behavior, focus restoration, tooltips, and disabled-state semantics

## Acceptance target

This is an Attendance-specific migration to the established teacher operational work-surface hierarchy. The date arrows touch the date control, the date control has no dropdown chevron, quiet session context and utilities remain at the edges, checkbox selection feeds one persistent selected-student actions menu, and reversible per-student corrections happen inline. QR-origin rows show their check-in time and expose Undo only after a staff correction changes the QR-derived status. The trailing header keeps the sortable Present/Late/Absent counts without a visible `Status` label.
