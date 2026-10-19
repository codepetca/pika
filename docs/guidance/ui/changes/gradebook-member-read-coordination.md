# Student Gradebook marks read coordination

Surface: existing Classwork `StudentReturnedMarks` loading, error/retry and loaded
region. Reference: production `StudentReturnedMarksList`, the executable Pattern
Lab Student Grades visibility specimen (`StudentGradesPattern`), and the accepted
unchanged C5 desktop/mobile light/dark capture matrix. Follow `DESIGN.md`, stable
PageState semantics and the standalone Gradebook disclosure contract.

| Need | Existing candidate | Decision | Reason |
|---|---|---|---|
| Marks and zero/blank presentation | StudentReturnedMarksList | reuse | Keep existing data and visual semantics. |
| Loading, failure and explicit Retry | PageState, Card, Button | reuse | No new controls, labels, geometry or focus behavior. |
| Same active-owner pending read | StudentReturnedMarks request ownership | extend | Coalesce only its unfinished read; preserve fresh authority checks after reactivation, classroom change, real remount, settlement and Retry. |

Both historical account roles can be classroom members, so verify both member
roles. Classroom-owner Gradebook layout is unchanged; include owner isolation in
the existing full workflow. Desktop1440x900/mobile390x844, light/dark; loading,
loaded, empty, failed, explicit Retry, zero versus blank, inactive/reactivated,
classroom-changed and stale completion states. The primary signal remains the
existing marks or explicit PageState. No redesign, new cache/framework, automatic
retry, SQL lock change, permission relaxation, public diagnostic or dependency.

Composite-widget review: n/a; no widget, keyboard, focus or ARIA contract changes.
Reuse existing Retry keyboard semantics. No experimental pattern or canon
promotion. Pattern Lab presentation remains deterministic and unchanged.

Acceptance requires focused StrictMode/ownership tests, unchanged disclosure and
permission tests, policy/type/lint checks, independent review and fresh bounded
Playwright captures of the reviewed app revision. Existing captures are reference
evidence only, not acceptance evidence for the changed revision. All production,
shared-local-schema, real-account and activation holds remain in force.
