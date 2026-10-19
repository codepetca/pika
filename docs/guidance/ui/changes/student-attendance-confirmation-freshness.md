# Student attendance confirmation freshness

## Acceptance target

Student QR check-in results and in-app attendance statuses must confirm only the
current America/Toronto class date. A successful mutation still waits for the
attendance service's accepted/already-accepted result. Resuming a success page
uses an authenticated read; it must never submit another attendance mutation.
An uncertain or expired result cannot retain green confirmation.

Reference: existing student QR confirmation card and retry region,
StudentAttendanceStatus, and Pattern Lab's semantic status/page-state examples.
Guidance: DESIGN.md, src/ui/README.md, UI stable canon and visual-testing guide.
Primary signal: existing semantic success icon and dated confirmation; existing
spinner for verification and warning state for an unconfirmed result.
Student desktop/mobile, light/dark: loading, current success, stale prior-day
result, resumed verification, read failure, and keyboard retry. Teacher is n/a
because this change does not affect teacher rendering or refresh behavior.
No new visual pattern, decorative chrome, provider identifiers, or component
library. Composite widget review n/a: existing status and button/link semantics.

| Need | Existing candidate | Decision | Reason |
|---|---|---|---|
| Confirmation presentation | StudentAttendanceCheckIn | extend | Add class date and freshness states to the existing owner. |
| Controls and status icons | Card, Button, Spinner, Lucide | reuse | Existing semantics and visual treatment fit. |
| Current attendance read | fetchStudentAttendanceStatus | reuse | Authenticated identity binding and uncached refresh already exist. |
| Confirmation lifecycle | Feature-owned attendance hook/helper | create | Keep clock, validation and asynchronous state outside presentation; no shared UI primitive. |

## Verification

Behavioral tests cover backend acknowledgement, prior Toronto date, expiry,
skewed phone clocks, resume/focus/pageshow, identity/occurrence mismatch, failed
reads and stale in-flight responses. Playwright captures compare the existing
reference with the changed owner at desktop/mobile in both themes.


## Captured evidence — 2026-10-19

Playwright CLI, local Next development server at localhost:3000, synthetic
network responses through the production StudentAttendanceCheckIn owner at
/e2e-fixtures/student-classroom-attendance. Rendered working tree before commit;
base f88b06a5e (source unchanged between captures and implementation commit).
Evidence: output/playwright/attendance-confirmation/.

| Artifacts | Role | Viewport | Themes | States | Reference |
|---|---|---|---|---|---|
| 390-*.png | student | 390×844 | light/dark | success, verifying, failure, expired | Existing QR result card; Pattern Lab statuses |
| 1440-*.png | student | 1440×900 | light/dark | success, verifying, failure, expired | Same |

All sixteen captures inspected: date/time legible, existing icon meanings, no
horizontal overflow; retry and stable return-link focus covered by component
tests. Browser checked four initial POSTs and eight GETs with zero resume/retry
mutations, and the teacher guard. Teacher workflow n/a; no teacher code changes.
In-app banner geometry unchanged; its current-day fixture remains covered by
component tests. No new shared contract or Pattern Lab catalogue change.
