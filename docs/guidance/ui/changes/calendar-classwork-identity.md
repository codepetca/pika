# Calendar themes and Classwork type identity

Owner approved 2026-10-21 in the calendar-chip prototype chat:
“due and test the same color (the amber/orange), material and survey the same
color (that light green), announcement can be the current orange”. The owner
also selected the prototype's FileText and ListChecks icons and requested them
beside created items in the Classwork list and in future prototypes and work.

## Acceptance target

- Surface: Calendar week, month, term, weekend and presented-day chips;
  teacher Classwork creation menu and teacher/student Classwork item titles.
- Reference: approved calendar-chip prototype, existing LessonDayCell agenda,
  Pattern Lab Calendar and Classwork examples.
- Roles: teacher and student. Desktop and mobile; light and dark.
- States: default, hover, keyboard focus, open item, draft and scheduled labels.
- Primary signal: category fill in Calendar; type icon beside Classwork titles.
- Exclusions: no new scheduling, survey calendar data, status meanings,
  grading, list layout, migrations or unrelated icon replacements.
- Composite accessibility review: n/a; existing controls/roles are preserved.
- Promotion: owner explicitly approved the convention and requested retention.

| Need | Existing candidate | Decision | Reason |
| --- | --- | --- | --- |
| Calendar colors | LessonDayCell, LessonCalendar, semantic tokens | extend | Same category treatment across existing views |
| Classwork icons | Lucide ClipboardList, FileText, ListChecks | reuse | Owner-selected meanings |
| Shared mapping | ClassworkTypeIcon | create | Teacher menu, teacher list, student list and prototypes share the same three types |
| Executable reference | Pattern Lab feature patterns | extend | Deterministic production owner and shared icon examples |

Exact theme values live only in `src/styles/tokens.css`. Use the
`calendar-assessment`, `calendar-resource` and `calendar-announcement` Tailwind
color groups, including their `bg` and `hover` variants. These encode content
identity, independently of success, warning, or completion status.

`ClassworkTypeIcon` owns assignment → ClipboardList, material → FileText,
survey → ListChecks. Keep visible type labels or accessible names; the icon
itself is decorative and must not become a separate control. Do not replace
an unrelated feedback/comment icon with a survey icon.

Nearby teacher/student Classwork card composition remains separate because
teacher reordering, status counts and student navigation differ. No broader
card extraction is needed for this convention.

Verification and review receipts are recorded in the session log and PR.
