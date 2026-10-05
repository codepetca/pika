# Classroom index first-read recovery

Surface: `/classrooms` required initial list reads. Reference: Pattern Lab
`#page-states`, the classroom route error boundary, and the teacher index's
archived-read error. Existing stable PageState composition is reused.

Roles: teacher and student. Viewports: desktop and mobile. Themes: light and
dark. States: initial read error, retry focus/pending, repeated error, recovered
list, and successful empty. Primary signal: shared error icon and specific
heading. No new decoration, create/join prompt on failure, raw database errors,
dependencies, schema changes, or warm list/archive-flow refactor.
Composite widget review: n/a; shared retry button keyboard/focus checks required.

| Need | Existing candidate | Decision | Reason |
|---|---|---|---|
| Authenticated framing | AppShell | reuse | Identity and navigation remain available after a list failure. |
| Error geometry | PageLayout, PageContent, PageState | reuse | Required read failure matches the stable page-state contract. |
| Retry control | IconButton with RotateCw | reuse | Named, tooltip-backed, 44px keyboard control with pending semantics. |
| First-read recovery | Classroom index route composition | extend | Feature-owned recovery retries the server read without changing successful list ownership. |

No stable primitive contract or icon meaning changes; no experimental pattern
or human promotion needed. Existing archive-error duplication is a possible
future feature composition extraction only if its request ownership converges.
Successful server results update the existing list state, including successful
zero results. Failed placeholder arrays never overwrite a previously valid list.
Local dialog/opening state stays with its mounted owner. Retry focuses a stable
named region before the control is replaced, without moving focus on background
read-status changes. Root coordinator owns the final screenshot matrix and reviewed evidence.
