# Attendance explicit-retry focus

Surface: StudentAttendanceCheckIn on classroom and individual token entry. Reference: approved StudentGrades named focus region, Gradebook/Roster explicit-retry handoff, and executable `/pattern-lab#page-states` with production Button/Card. Risk: workspace-state, bounded client focus only.

Student: keyboard retry from unavailable to pending, success or another unavailable result; initial entry and already-focused return link do not autofocus. Teacher/restricted role: no check-in or retry; shared card composition remains unchanged. Desktop1440x900/mobile390x844, light/dark, normal/reduced motion. Primary signal: existing governed visible focus ring on the stable Attendance check-in region. Composite accessibility review: yes, keyboard handoff and next Tab to the existing return link.

| Need | Existing candidate | Decision | Reason |
|---|---|---|---|
| Check-in card and controls | Card, Button, buttonVariants | reuse | Preserve existing layout, targets and outcome semantics. |
| Explicit retry focus owner | Feature-owned stable content wrapper | extend | Focus a named mounted region before the retry button is removed. |
| Focus treatment | StudentGrades region semantic ring classes | reuse | Existing foundation tokens; no new visual pattern. |
| Verification seam | Guarded student-classroom-attendance fixture | extend | Fixed teacher/student and occurrence/classroom cases without identity or backend writes. |

No new motion, controls, instructional text, data/mutation/attempt semantics, cache, server/auth/provider, schema, dependencies or shared primitive APIs. Pattern Lab owners/contracts are unchanged; inspect and capture its Page states reference instead of adding duplicate feature examples. New wrapper retains flex-column layout; focus preventScroll preserves the current viewport. Only explicit Retry moves focus, before the existing request; completion and initial reads do not steal it.

Evidence: current-main source-equivalent one-case component RED at e24d591ab proves activeElement becomes body on keyboard Retry. The custom external probe startup failures are retained as tooling failures, not product test failures. Required GREEN checks cover both token modes, pending/success/repeated unavailable, initial and restricted-role behavior. Native synthetic matrix verifies focus, target, theme/motion, scroll and overflow; guarded fixtures fence all real API writes. No backend/identity/performance claim.

Coordinator authorized the distinct local fixture/browser slot for this bounded fix. No hosted heavy CI or main merge until coordinator integration order. References and capture hashes belong in the task evidence receipt.
