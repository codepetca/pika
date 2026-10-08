# Student assignment detail read recovery — 2026-10-06

Coordinator: chat01a10bfa-17e1-76d2-9483-af955a51a9fd. Branch
codex/assignment-detail-recovery, initial main baseline25457e2d; updated onto
main5bf3dbac after independent initial review. Distinct Classwork
owner delivery; PR1501 journal branch and exhausted review budget remain unchanged.

Student assignment detail GET failures currently show Assignment unavailable with
only Back to assignments/Go back. Controlled actual-owner desktop/mobile probes
confirmed a503 failure requires leaving and reopening the same assignment.

Surface: initial student assignment detail loading/error/retry in embedded
Classwork and standalone editor. Reference: approved StudentAssignmentsTab
initial-error PageState, named Classwork region and retry focus; stable page-state
conventions; executable /pattern-lab?role=student#page-states actual PageState
loading/error/empty/forbidden. Coordinator inspected the target and reference.
Reference capture: retained chat product-fluidity/assignment-detail-reference/.

Role: student. Teacher n/a: TeacherStudentWorkPanel and shared primitives are
unchanged. Viewports1440×900 and390×844; light/dark; normal/reduced motion.
States: initial loading; transient network/5xx failure; keyboard retry pending;
repeat failure; retry success with server/local-recovery content; protected
unavailable response; existing success/edit/save untouched.
Primary signal: canonical named page-state heading, status/alert and Try again.
Composite-widget review: no new composite; normal keyboard/focus continuity yes.
Keep selection/URL, classroom shell, safe route away, local draft storage and
existing autosave/submission/version/restore contracts. Retry is user initiated,
GET-only, limited to failed initial detail reads; no automatic retry loop.

| Need | Existing candidate | Decision | Reason |
|---|---|---|---|
| Loading/error/unavailable presentation | @/ui PageState | reuse | Canonical status/alert and shared geometry |
| Retry/exit action | @/ui Button | reuse | 44px target and focus treatment |
| Stable retry focus | StudentAssignmentsTab named work region | reuse | Retry control replacement retains deterministic focus |
| Detail failure classification/retry state | StudentAssignmentEditor initial load owner | extend | Keep initial read separate from save/submission/history failures |
| HTTP error transport | @/lib/api-error ApiError | reuse | Preserve response status without changing server API |

Do not create shared primitives, change API authorization/data contracts, add
motion/dependencies, promote experiments, alter history recovery, teacher detail
loading or normal saved content. Protect intentionally indistinguishable missing
and forbidden copy. Do not display raw server errors on protected/unavailable
states. Do not claim initial failure erased a draft: recovery storage must remain
until an authorized successful detail reconciliation resolves it.

Implementation acceptance: meaningful failure→manual retry→success tests, repeat
failure without duplicate GET/save, unavailable response stays protected, local
recovery draft survives failure and is reconciled through existing rules, stable
focus through pending/success. Check stale owner replies if read state gains a
new request identity. Existing owner suite protects save/submit/restore behavior.

Visual acceptance: actual guarded production student Classwork editor in full
shell with controlled APIs, desktop/mobile light/dark normal/reduced matrix;
keyboard and URL identity, natural interaction recordings, no unexpected console
errors or horizontal overflow. Standalone is compatibility-only: no production standalone adopter was found;
owner tests cover its network retry and stale-response behavior. Record
current known shared-header hydration warning as a blocker if it occurs; do not
filter it or count retries as a clean first run. Before/after samples describe the
local fixture and distinct recovery interaction, not production INP or speed gains.

Shared loading PageState on current main has an existing reduced-motion gap
already covered by pending shared-controlsPR1490. Keep that owner unchanged;
ensure this adoption honors reduced motion with the narrowest supported scoped
className treatment if required, and document it. No new motion direction.

Completion integration, 2026-10-08: current main's shared `CircularProgress`
already honors reduced motion. Reuse that primitive and remove the redundant
feature-local SVG animation override; retain the existing browser assertion
that the loading indicator does not animate under reduced motion.

Run focused gate, Pika audit, append/trim session log, publish draft PR and perform
risk-matched independent stable-SHA review. Merge/deployment require user authority.
Risk: workspace-state. Model recommendation: GPT6.1Sol/high — protected-resource
recovery and preserved local editor/save state need careful owner boundaries.


Verification at implementation candidate: ten meaningful new failures before the
change and54 existing passes; all64 owner tests pass after the change. Focused
checks pass334 tests across18 files plus architecture/UI/design/TypeScript/lint.
The actual student Classwork owner passes16 browser cases: desktop/mobile,
light/dark, normal/reduced motion, with server content and a recoverable local
draft. Each case checks two user retries (repeat503 then success), persistent
region and keyboard focus, unchanged selected URL/storage during pending reads,
three GETs and zero writes, no unexpected runtime/console errors or overflow.
The first browser attempt stopped after an adjacent returned-marks fixture lacked
its required items array; failed artifacts retained. Only the fixture was fixed;
the corrected fixed matrix used zero retries. Screenshots and natural recordings
are retained in the coordinator's assignment-detail-browser-corrected artifacts.
No teacher or shared primitive source changed; no production performance claim.
