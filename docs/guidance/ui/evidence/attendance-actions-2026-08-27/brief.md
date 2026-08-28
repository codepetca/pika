# Attendance action hierarchy change brief

- Surface: teacher classroom Attendance tab
- Reference: approved Option 1 in `approved-design-reference.png`, grounded in the Test grading work surface merged by PR #1088, plus the user's approved interaction revision on 2026-08-27
- Affected role: teacher; student is not affected because this is a teacher-only operational surface
- Required viewports: desktop and mobile
- Required themes: light and dark
- Key states: default, a manual correction to a QR check-in with Undo visible, whole-roster confirmation, internally scrolled roster, and Attendance hours dialog
- Primary signal: a visually dominant, top-centered action cluster containing the joined previous/date/next navigator, session actions, and square Present/Late/Absent whole-roster controls
- Must not add: row-selection checkboxes, a selected-student dropdown, a date dropdown chevron, duplicate action chrome, Test-specific terminology, decorative treatments, or changes to Attendance permissions and command-confirmation behavior
- Composite widget accessibility review: yes; the joined date navigator and per-student three-state control require accessible names, pressed-state semantics, roving keyboard focus, tooltips, and disabled-state semantics

## Acceptance target

This is an Attendance-specific migration to the established teacher operational work-surface hierarchy. The date arrows touch the date control, the date control has no dropdown chevron, quiet session context and utilities remain at the edges, whole-roster status changes are confirmed, and reversible per-student corrections happen inline without row selection. QR-origin rows show their check-in time and expose Undo only after a staff correction changes the QR-derived status.
