# Student Classwork refresh continuity — 2026-10-05

Part of the active fluid-classroom goal in chat 01a10bfa-17e1-76d2-9483-af955a51a9fd.
This slice uses existing stable states; Daily's experimental motion promotion is
separate and still awaits owner acceptance.

## Acceptance brief

Surface: Student Classwork summary, material, survey and selected assignment.
Reference: page-state conventions, Pattern Lab's Page states and production
Teacher Tests' retained-list refresh alert. Role: student; teacher n/a because
neither teacher consumers nor shared owners change. Both viewports and themes.
States: initial loading/failure/retry, successful empty snapshot, loaded list,
selected editor, failed same-classroom refresh, repeated retry and recovery,
classroom switch and late response. Primary signal: an explicit retry alert above
retained work. Existing cards/editor geometry and actions remain feature-owned.
No new motion, dependencies or shared component. Composite review: no new
composite widget; retry focus and alert semantics require coverage.

| Need | Existing candidate | Decision | Reason |
| --- | --- | --- | --- |
| Initial failure/empty state | PageState | reuse | Failed required read stays distinct from successful empty data |
| Background read feedback | Teacher Tests retained-list alert + Button | reuse | Explain stale content and provide bounded retry |
| Loaded snapshot identity | StudentAssignmentsTab classroom/request guards | extend | Retain only an actual successful snapshot of the current classroom |
| Editor and draft ownership | StudentAssignmentEditor | reuse | Keep the same keyed editor through refresh/retry; no autosave changes |
| Retry focus | Named stable Classwork region | extend | Retry can disappear without sending keyboard focus to the document body |

Acceptance: initial failure blocks; a successful empty snapshot still counts as
loaded; same-classroom refresh failure retains assignments/materials/surveys and
selected content with an alert; retry stays non-blocking for that snapshot;
recovery replaces the snapshot; new classroom and obsolete requests never expose
old work. Component tests verify actual node/draft identity. Browser checks use
synthetic API responses with the real classroom layout and real editor. Native
cross-tab selected-workspace memory is a later slice, not claimed by this fix.

Stable guidance followed; experimental guidance introduced: no. No human
promotion required for this slice. The broader goal and Daily candidate's
acceptance decision remain open. Verification and reviewed SHA are recorded on
the associated PR.

## Verification receipt

- Component regression: five original failures reproduced before implementation;
  20 cases now pass, including obsolete success/failure across classroom switches.
- Required focused gate: 231 tests/13 files plus architecture, UI/design policy,
  TypeScript and lint passed. Source audit and diff checks passed.
- Browser matrix: 8/8 passed (21.4 seconds), desktop/mobile light/dark, real
  classroom shell and editor with synthetic reads/autosave responses. List and
  editor nodes retained; editor GET remains one; draft, retry focus and initial
  blocking error are asserted. No hosted database or classroom mutation.
- Visually inspected all 16 state screenshots. Durable evidence is under chat
  visualization `classwork-continuity/`, including README, capture runner, log,
  videos and traces. Coordinator also inspected desktop-light/mobile-dark editor.
- Native GPT-6.1 Sol/medium browser worker; reported visual review about three
  minutes, two fixture corrections and one tooltip capture correction, no
  production corrections. Coordinator verified the delivered diff and proof.
  Token telemetry unknown; DeepSeek automatic delegation remains paused.

Review/CI status belongs to the PR and is not duplicated as a release claim here.
