# Fluid classroom experience — 2026-10-05

Owner: chat `01a10bfa-17e1-76d2-9483-af955a51a9fd`, branch `codex/fluid-classroom-ui`.
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
The owner subsequently authorized merge and goal advancement; the integrated
PR awaits its required final CI gate. The [rollout brief](./changes/approved-classroom-motion-rollout.md)
records decisions and the implementation assignment. Approved rollout preview:
http://localhost:3217/pattern-lab?role=teacher#teacher-patterns.

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
