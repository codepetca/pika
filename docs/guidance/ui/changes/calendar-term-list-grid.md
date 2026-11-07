# Calendar term List and Grid

Owner-approved prototype, 2026-11-06. Scope: classroom lesson calendar for teachers and students. The existing term calendar and Pattern Lab `calendar-identity` are the Pika references; the approved prototype defines the revised layout.

- Show the complete term in List or Grid, with a compact sticky action bar and Today action. Center today on entry and on demand; if outside the term, use the nearest term boundary.
- Grid keeps sticky weekday headings, vertical month labels spanning weeks assigned to the majority month, and a subtle outline following each calendar month's actual dates.
- List keeps the current month and year in the action bar and uses quiet month and week separators.
- Preserve day content, editing, permissions, category identities, navigation, and source states. Dragging chips to change dates is separate future work.
- Roles: teacher and student. Viewports: desktop and mobile. Themes: light and dark. States: List, Grid, scroll, Today, selected, menu open, focus, editing, empty and error as applicable. Primary signal: compact calendar content with quiet date boundaries; no decorative chrome.
- Composite widget review: yes, for mode selection and menu keyboard/focus behavior.

| Need | Existing candidate | Decision | Reason |
|---|---|---|---|
| View selector and actions | SegmentedControl, CalendarActionBar | extend | Keep shared controls and menu semantics |
| Calendar content | LessonCalendar, LessonDayCell | extend | Preserve day content and role behavior |
| Month and week boundaries | Existing term layout | extend | Keep the existing majority-week grouping |
| Scrolling | Existing term scroller | extend | Align sticky controls and headings to one scroll owner |

This is a scoped calendar composition; it does not promote a new shared pattern. Pattern Lab remains the executable calendar identity reference.
