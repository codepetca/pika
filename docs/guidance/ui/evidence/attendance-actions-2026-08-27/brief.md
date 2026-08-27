# Attendance action hierarchy change brief

- Surface: teacher classroom Attendance tab
- Reference: approved Option 1 in `approved-design-reference.png`, grounded in the Test grading work surface merged by PR #1088
- Affected role: teacher; student is not affected because this is a teacher-only operational surface
- Required viewports: desktop and mobile
- Required themes: light and dark
- Key states: default, one selected student, selected-student menu open, internally scrolled roster, and Attendance hours dialog
- Primary signal: a visually dominant, top-centered action cluster containing the joined previous/date/next navigator, session actions, and persistent selected-student actions trigger
- Must not add: a date dropdown chevron, duplicate selection chrome, Test-specific terminology, decorative treatments, new Attendance actions, or changes to Attendance permissions and confirmation behavior
- Composite widget accessibility review: yes; the joined date navigator and selected-student action menu require accessible names, disabled-state semantics, focus restoration, and keyboard menu behavior

## Acceptance target

This is an Attendance-specific migration to the established teacher operational work-surface hierarchy. The date arrows touch the date control, the date control has no dropdown chevron, quiet session context and utilities remain at the edges, and corrections move from the floating bottom bar into a persistent centered menu that enables only after selection.
