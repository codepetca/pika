# Fluid Pika experience — 2026-10-05

Owner: chat `01a10bfa-17e1-76d2-9483-af955a51a9fd`; current continuation branch
`codex/product-fluidity`. The original classroom delivery branch was
`codex/fluid-classroom-ui`.
Source baseline: `c25ebf78`. This document tracks the goal's phases.
Approved rollout branch: `codex/fluid-motion-rollout`, based on reviewed Daily
`b94b27670`; the reviewed Teacher and Student Classwork response changes are integrated
into the same merge candidate.

## Experience contract

Immediate feedback, continuous workspace identity, quiet controls, clear save/error
state. Preserve teacher table density, scroll, drafts, selection, focus, keyboard
resize and Toronto date behavior. Motion is purposeful and uses existing 150–300ms
tokens; reduced motion is immediate. No blanket whitespace, hidden-data quota or
spring requirement. Keep domain logic, navigation and mutations feature-owned.

## Current phase and acceptance brief

Phase 1: bounded interaction audit and Daily pilot. Reference: approved Attendance
operational-table composition, existing Daily selected workspace and Pattern Lab's
teacher examples. Role: teacher; student n/a for Daily-only production changes.
Viewports: desktop/mobile; themes: light/dark. States: table, selected student,
switch student, deselect, keyboard selection/Escape, resize, refresh and reduced
motion. Primary signal: existing selected row and adjacent log inspector. No extra
controls, visual ornaments or layout redesign. Composite accessibility review: yes.
Risk: workspace-state. Data owner: classroom ID + selected date; individual history
also belongs to student ID. Late classroom/date responses must remain ignored.

| Need | Existing candidate | Decision | Reason |
| --- | --- | --- | --- |
| Continuous table/inspector | TeacherWorkspaceSplit | extend | Opt-in opening/closing, stable primary, immediate drag resize |
| Table, scroll and selection | Daily + useScrollPositionMemory | reuse | Preserve actual DOM and current keyboard/sort behavior |
| Timing/reduced motion | src/styles/tokens.css | reuse | Existing semantic durations and easing |
| Same-date refresh selection | Daily request identity guards | extend | Retain a valid selected student in the same owner scope |
| Reproducible demonstration | Pattern Lab TeacherPatterns | extend | Render the real split owner with fixed data |

Pilot exit: same scroller/row nodes survive select/switch/deselect; inspector width
changes smoothly without scaling text; no extra history entrance when switching
students; resize remains immediate; closed content is inert; same-date refresh
retains selection; changed scope and removed students clear it; stale-response
regression passes. Record desktop/mobile light/dark screenshots, normal/reduced
motion recordings and measured response/layout timing. Measurements describe the
local fixture, not production or low-end-device performance. Human design acceptance
precedes promotion of the experimental motion behavior and broader adoption.

## Audit findings and next phases

1. Daily swaps table subtrees (TeacherAttendanceTab:1265–1325), compensating with
   repeated scroll restoration. Pilot keeps one primary owner.
2. Daily clears selection after every successful log fetch (393–398), including
   same-date tab reactivation. Retain valid selection only within the current scope.
3. ClassroomPageClient:1590 removes selected assignment/test parameters on leaving
   tabs. Later assess per-tab workspace memory while preserving active-tab return
   behavior; editor focus/mount continuity is lost, draft loss is not established.
4. StudentAssignmentsTab:119 clears usable snapshots on failed background refresh.
   Later preserve same-owner content with explicit stale/error feedback; initial
   failure must remain an error. Keep autosave and submission behavior intact.
5. TabContentTransition:20 hides content immediately; current opacity transition
   cannot perform an exit. Later evaluate restrained presence/entry behavior without
   exposing inactive controls or delaying navigation.

Phase 2: accept Daily pilot; promote reusable behavior through UI governance.
Phase 3: teacher Classwork/Tests continuity and response improvements, one bounded
family slice at a time. Phase 4: Student Classwork snapshot/editor continuity with
both-role regression evidence. Phase 5: cumulative verification and reviewed PRs.
No new dependencies are assumed. Evaluate Motion only if a concrete shared-element
case warrants its bundle and maintenance cost; adoption requires owner approval.

## Coordination receipt

One read-only GPT-6.1 Sol/medium investigator, 12:57:01–12:58:55 UTC, inspected
baseline sources and test seams. Coordinator verified Daily swap, refresh reset and
current shared owner directly. No edits/conflicts/retries by worker; token telemetry
unknown; coordinator review about 3 minutes (estimate). Weekly remaining 53% at
start; account-wide usage is not attributable task consumption. DeepSeek automatic
pilot remains paused by the dated owner preference.

## Evidence and release status

Daily pilot implemented and accepted by the human on 2026-10-05, in response to
the explicit request to approve its restrained motion direction for wider
adoption. Scoped promotion is recorded in `stable.md`, the teacher family canon
and audit, and the Pattern Lab catalog; unrelated experimental patterns remain
unchanged. Approved motion adoption and cumulative local verification are complete.
The owner subsequently authorized merge and goal advancement. Integrated
PR #1486 passed all five exact-head CI jobs and was squash-merged as
`84a657ebe28dd277fc2e55c145c7099c301c7e04`. The
[rollout brief](./changes/approved-classroom-motion-rollout.md) records its
decisions. Its temporary preview is stopped; recordings and merge receipts remain
in the owning chat's retained artifacts.

Verification evidence:

- Daily matrix: 20/20 passed across desktop/mobile, light/dark, normal/reduced
  motion, isolated fixture and real classroom layout owner. Includes inspector
  intermediate-frame samples, DOM identity, scrolling and Escape.
- Existing teacher/student Pattern Lab references: 8/8 passed with unchanged
  accepted header snapshots. New inspector reference: 4/4 passed, including
  bounded mobile details and focus return.
- Six capture variants exercise visible-row select/switch/Escape with actual log
  text and an available summary, plus the real Pattern Lab owner. Normal paths
  use 200ms transitions; reduced paths use 0ms. Pane and row identity, focus,
  remembered scroll (516px), no horizontal overflow and closed-content inertness
  pass. Desktop drag changes width by approximately 79px for an 80px pointer
  move, with transition-property none.
- Click-to-first-observed-selected-frame: 42–63ms in these local fixture captures.
  This is frame sampling under development-server/host load, not INP, production
  performance, a low-end-device result or a before/after speed comparison.
- Local evidence is under the chat's visualization directory, `fluid-pilot/`:
  recordings, before/selected/closed and reference PNGs, measurements.json,
  capture.cjs and browser-matrix screenshots. Capture data is synthetic.
- Final local gate: `pnpm check:focused -- --base origin/main --max-workers 1`.
  Its result and reviewed SHA are recorded in the PR. Separate audit and design
  checks also apply. Early concurrent runs hit unrelated gallery 5s timeouts;
  serial execution avoids competing browser/worker load without changing limits.

Composite checklist reviewed: yes; keyboard and semantic state covered: yes.
Human design acceptance: received. The scoped rollout and cumulative local
verification are complete; reviewed PR #1486 and the task artifact own the
receipts. The owner explicitly authorized merge in a subsequent instruction.
Production deployment remains a separate decision. Independent review and
release status belong to the PR, avoiding stale commit-status copies here.

## Product-wide continuation

The owner clarified that all aspects of Pika should feel fluid and refined,
explicitly including transitions, and requested a broader goal and orchestration.
The merged classroom delivery is the completed first phase. It does not establish
product-wide completion. This document remains the coordinator's execution plan.

Outcome: responsive navigation, coherent motion, predictable feedback and recovery,
clear hierarchy, and usable density across every production route family. Preserve
role and data ownership, drafts, selection, caret, focus, scroll, keyboard use and
reduced motion. Navigation and commands take effect immediately. Existing
dependencies suffice for the first slice; a motion library remains an explicit
decision if a concrete later interaction warrants it.

| Phase | Deliverable | Exit |
| --- | --- | --- |
| Shared interactions — current | Control/reduced-motion consistency, account-menu focus and restrained tab entry | Focused behavior checks, actual-owner normal/reduced recordings and both-role visual matrix; reviewed stable-SHA PR; tab direction reviewable before promotion |
| Overlays and navigation | Dialog/drawer/popover and route-transition refinements | Preview meaningful entry/exit choices; retain modal focus, inertness and immediate commands |
| Classroom coverage | Remaining teacher/student families and mobile composition | Each inventoried tab/state verified; preserve completed #1486 behavior |
| Utilities and forms | Indexes, Dashboard, Calendar, Blueprints, History, authentication and join | Accurate cold/warm/error/empty/save states, draft protection and comfortable narrow layouts |
| Public and special routes | Attendance entry, published course sites, standalone preview, redirects | Verify reading density, role/visibility boundaries and keyboard/reduced-motion behavior |
| Cumulative acceptance | Full route/state coverage with performance observations | Every family verified or explicitly deferred by the owner; reviewed deliveries and applicable release authority |

### Coverage inventory

| Production family | Roles | State and interaction coverage |
| --- | --- | --- |
| Home and logout redirects | Unauthenticated, teacher, student | Immediate identity-aware destination and safe return path |
| Login, signup, signup verification, create password, forgot/reset password | Unauthenticated | Loading, invalid/expired input, error/success, field focus, session replacement |
| Join and join-code routes | Student, unauthenticated | Profile input, authorization, enrollment/roster outcomes, retries and preserved input |
| Classroom and individual attendance-token routes | Student, restricted other roles | Loading, unavailable/retry, domain result announcements |
| Classroom indexes | Teacher, student | Initial/error/empty, active/archived lists, creation/join, ordering, recovery/purge dialogs |
| Classroom shell and navigation | Teacher, student | Initial/error/not-found, feature visibility, retained tabs, drawers and URL selection |
| Daily and native Attendance | Teacher | Table/history density, selected workspace, logs, actions, refresh/error and Toronto dates |
| Classwork | Teacher, student | Lists, material/survey/assignment detail, drafts, authoring/grading, save/conflict/return/submit/history |
| Tests and standalone teacher preview | Teacher, student | Lists, authoring/grading, attempts, exam boundaries, draft/conflict/access/results |
| Blueprint, Gradebook, Roster | Teacher | Load/recovery, edit/save, feature/returned-work disclosure, contact data and mobile access |
| Today | Student | Journal save/conflict/history, mobile composition |
| Grades and Achievements | Student | Hidden/returned work, warm refresh/error, Pal loading/unavailable/retry and motion boundary |
| Calendar, Course Guide, Announcements | Teacher, student | Independent read failures, date/detail navigation, draft/publication, empty and recovery |
| Classroom Settings | Teacher | URL-backed sections, class-day workflow, action/status feedback and narrow layout |
| Dashboard, utility Calendar, Blueprints | Teacher | Attendance/detail/export, classroom/date scope, Blueprint dirty guards/import/proposals/publication |
| History | Student | Cross-classroom attendance summary, detail/dialog, narrow density |
| Planned and Actual published sites | Public | Published/unpublished/not-found, long-form reading, responsive themes and safe links |

Development Pattern Lab, galleries and E2E fixtures are evidence seams, not
production families. The July product audit supplies historical inventory; its
findings require current-source/runtime verification. Current Gradebook mobile
panels, auth controls and several recovery states already exist.

### Verified source candidates and next decisions

- Shared controls: several color transitions bypass semantic duration tokens;
  text Button and PageState spinners lack the IconButton reduced-motion treatment.
- Account menu: all open items have tabIndex=0; feedback closes the menu without
  first moving focus to its visible trigger, so modal close can restore hidden
  focus. Existing teacher action menus supply the approved counterpart.
- TabContentTransition: display:none and opacity change together; preserve its
  mounted children and immediate inactive-state hiding while making entry real.
- Classrooms server index: queries discard read errors and normalize absent data
  to empty arrays. Review feature-owned read recovery after shared foundations.
- Blueprint list/detail: current failure banners can coexist with empty/select
  prompts; inspect bounded recovery while preserving dirty-section safeguards.
- Roster contact columns are hidden below md; Dashboard retains a min-w-max
  attendance matrix. Preview narrow composition after current runtime inspection.

These source candidates are not claims that a visual matrix has passed. No new
dependency, schema or business-rule change follows automatically from the audit.

### Orchestration receipt

Two bounded read-only GPT-6.1 Sol/medium workers examined shared interactions and
route/state coverage in parallel. Shared audit: 22:47:28–22:49:03 UTC, 95 seconds;
route inventory: approximately six minutes reported, precise active time unknown.
Coordinator checked owner code, tests and actual Pattern Lab reference before
selecting the first slice. No worker edits/conflicts or repeated investigation;
tokens and effective runtime model telemetry unavailable. Weekly remaining was
43% at phase start. DeepSeek automatic delegation remains paused through
2026-12-31 under the owner's dated preference.

Current first-slice brief:
[shared-interaction-fluidity](./changes/shared-interaction-fluidity.md).
Source: main `84a657ebe`. Implementation/PR publication is authorized; future
merges and production promotion retain their separate authority requirements.
