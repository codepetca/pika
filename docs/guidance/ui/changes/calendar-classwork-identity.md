# Calendar themes and Classwork type identity

Owner approved 2026-10-21 in the calendar-chip prototype chat:
“due and test the same color (the amber/orange), material and survey the same
color (that light green), announcement can be the current orange”. The owner
also selected the prototype's FileText and ListChecks icons and requested them
beside created items in the Classwork list and in future prototypes and work.

Owner refinement 2026-10-21: the saturated announcement orange was too loud,
and Material/Survey should be distinct. Restore Material to the first
prototype’s quiet slate theme, retain Survey light green, and soften
Announcement to peach-orange. This supersedes the initial shared green and
strong orange treatments; the icon convention remains approved.

Owner label refinement 2026-10-21: remove visible Announcement, Material and
Survey prefixes from calendar chips; retain Due and Test prefixes. Keep icons,
colors, scheduled markers and descriptive accessible names/tooltips. Untitled
announcements retain a useful fallback label.

Owner density refinement 2026-10-21: make Month/Term chips shorter while
leaving Week unchanged. Reuse the existing cell and Button owners; extend only
grid presentation with 24px single-line rows for fine pointers. Coarse and
unknown pointers keep 44px minimum targets without overlapping rows. The
same sizing applies to the deterministic survey reference. Verify both
roles/themes, 1440/390px, fine/coarse pointers, focus and activation; compare
Week before/after. The shared cell serves both Month and Term.

Owner identity refinement 2026-10-21: Announcement peach remained too close
to Test amber. Use soft blue for announcements and retain visible Megaphone,
FileText and ListChecks icons on the title-only chips in every view, including
compact grids. This supersedes the orange/peach announcement palette.

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
`calendar-assessment` (due/tests), `calendar-resource` (slate Material),
`calendar-survey` (light-green Survey) and `calendar-announcement` (soft blue) Tailwind
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
