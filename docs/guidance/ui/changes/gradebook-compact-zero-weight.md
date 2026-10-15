# Compact zero-weight assessments

User request: replace separate teacher/student hide actions with **Compact 0-weight assessments**, on by default. This classroom setting governs teacher and student presentation. Assessments, scores, links and calculations remain available. Retired hide settings have no presentation effect.

Surface/reference: Gradebook toolbar, table and student inspector; Grades and Classwork returned marks. Extend the production owners demonstrated by Pattern Lab **Gradebook compact** and the existing Grades list. No new shared primitive or symbol convention.

| Need | Existing candidate | Decision | Reason |
|---|---|---|---|
| Setting | TeacherWorkSurfaceIconMenuButton checked menu | extend | One persisted classroom boolean with existing keyboard/focus behavior |
| Teacher columns | GradebookTable compact code treatment | extend | Narrow zero-weight columns, muted scores, full title tooltip and accessible editor names |
| Teacher mobile/inspector | GradebookStudentPanel | extend | One compact row with metadata available to assistive technology |
| Student rows | StudentGradesView / StudentReturnedMarksList | extend | Shorter muted rows with visible 0 weight label, preserved scores and links |

Primary signal: reduced width/density and semantic muted text, reinforced with visible 0 weight text. Preserve above-maximum teacher warnings and 44px primary edit/link targets. No new colors, dependencies, tab visibility changes, grade arithmetic changes or new shared component. Nearby list similarity remains feature-owned; extraction would require a durable common metadata/action contract.

Matrix: teacher and student; desktop1440×900 and mobile390×844; light and dark; default compact on, menu open/focus/Escape, compact off, zero-weight scores (including0), weighted and excluded items, teacher inspector and returned marks. Composite review: existing checked menu retains arrow, Enter and Escape/focus semantics. Pattern Lab renders the actual production owners deterministically.

Persistence: optional JSON key `gradebook_compact_zero_weight_assessments`, missing means true. Existing optional hide key retained for old-client compatibility only. Migration267 updates dormant metadata RPC; not applied as part of this work. Active legacy JSON writer supports the preference without migration application. No flag activation.

Verification receipts recorded in session log and PR after execution.
