# Attendance action hierarchy change brief

- Surface: teacher classroom Attendance tab
- Reference: approved Option 1 in `approved-design-reference.png`, grounded in the Test grading work surface merged by PR #1088, plus the user's Attendance-specific interaction revisions through 2026-08-28
- Affected role: teacher; student is not affected because this is a teacher-only operational surface
- Required viewports: desktop and mobile
- Required themes: light and dark
- Key states: default open session, closed session, one or more checked students with the selected-student menu open, a manual correction to a QR check-in with Undo visible, internally scrolled roster, Attendance hours dialog, and a date without a session time
- Primary signal: a visually dominant, top-centered action cluster containing the joined previous/date/next navigator, immediate session actions, and a persistent selected-student menu that is disabled until a checkbox is selected; the content-sized Attendance time control stays in the quiet leading context slot
- Must not add: whole-roster Present/Late/Absent actions, a manual-attendance mode toggle, a `Status` text label above the row controls, a date dropdown chevron, duplicate action chrome, Test-specific terminology, decorative treatments, or changes to Attendance permissions and command-confirmation behavior
- Composite widget accessibility review: yes; the joined date navigator, selected-student menu, table selection controls, sortable count controls, and per-student three-state control require accessible names, semantic state, keyboard behavior, focus restoration, tooltips, and disabled-state semantics

## Acceptance target

This is an Attendance-specific migration to the established teacher operational work-surface hierarchy. The date arrows touch the date control, the date control has no dropdown chevron, quiet utilities remain at the edges, checkbox selection feeds one persistent selected-student actions menu, and reversible per-student corrections are always available inline. Inactive status choices remain visible at 12% while the selected choice uses full color and a blue ring. Each row choice preserves Pika's 44 px direct-action target around a compact 28 px status disc, and the 28 px count pills align to those discs. QR-origin rows show their check-in time and expose Undo only after a staff correction changes the QR-derived status. The content-sized session range sits in the leading context slot, supports the full `12:45 AM - 10:34 PM` label, uses uppercase AM/PM and spaces around the dash, opens Attendance hours directly, and becomes a clock control when no range exists. Only a confirmed open Attendance session gives the time control a subtle semantic success background; closed, scheduled, cancelled, stale, and pending states remain neutral while the accessible name still communicates the session state. The trailing header keeps the sortable Present/Late/Absent counts without a visible `Status` label.
