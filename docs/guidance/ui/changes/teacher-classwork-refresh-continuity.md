# Teacher Classwork refresh continuity

Surface: Teacher Classwork summary and selected assignment workspace.
Reference: `TeacherTestsTab` retained successful list with inline refresh error/Retry; Pattern Lab teacher work-surface shell, operational table, and page-state examples.
Roles: teacher only; student is n/a because no student/shared owner changes.
Matrix: desktop 1440×900 and mobile 390×844, light and dark; successful populated/empty, pending refresh, repeated failure/Retry, recovery, selected table and student inspector with draft/focus/scroll retained.
Primary signal: existing RefreshingIndicator and inline semantic error with Retry.
Must not add: motion, new shared components, Daily experimental promotion, new styling patterns, permissions/cache TTL/mutation changes, parent-tab navigation changes.
Composite accessibility review: preserve table and inspector owners; assert identity, focus, and scroll during background refresh and Retry.

| Need | Existing candidate | Decision | Reason |
|---|---|---|---|
| Refresh status | RefreshingIndicator | reuse | Existing calm pending signal |
| Error and Retry | TeacherTestsTab retained-list alert | reuse | Approved non-blocking recovery pattern |
| Workspace and table | TeacherWorkSurfaceShell/table frame | reuse | Stable mounted work region |
| Scroll restoration | Existing feature scroll memory | reuse | Preserve existing owner and node |
| Snapshot/error/selection | TeacherClassroomView | extend | Same-classroom successful reads remain authoritative during failed background reads |

A successful empty list is a snapshot. Initial required-list failure remains blocking. Classroom changes clear the old snapshot and ignore obsolete requests. Successful new lists remain authoritative for selection removal. Detail loading depends on scalar assignment identity and explicit mutation refresh, avoiding reads and remounts from list metadata changes. No shared API or Pattern Lab contract changes.

Freshness contract: actual same-classroom tab reactivation explicitly advances the existing detail refresh counter once for a loaded selected assignment. List metadata changes and list Retry do not advance detail freshness. Current-owned detail rows and AI run remain mounted through warm detail pending/failure/Retry; new owner reads remain cold and cannot expose prior data. Warm detail uses the same existing indicator/inline error/Retry canon. Return and AI explicit refresh paths remain unchanged; inspector document/controller refresh remains independently owned.

Verification: 62 component cases and the required focused gate (319 tests/18 files plus all static checks) pass. Four browser cases cover desktop/mobile, light/dark with actual table, inspector and comment editor; 32 current screenshots and 12 unchanged Pattern Lab references were visually inspected. Keyboard Retry focuses the stable Classwork region with preventScroll; indirect Retry preserves editor focus, even when its text is Retry. One existing 5-second material-order timeout passed in isolation and the unchanged full gate subsequently passed. No timeout was changed. Source/screenshot digests and logs are retained in the task artifact directory.
