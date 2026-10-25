# Assignment Return: refresh the open grading panel

Reference: governed teacher Assignment workspace and existing teacher-assignment-grading development fixture; Pattern Lab teacher work-surface composition remains unchanged. Follow DESIGN.md, stable and teacher-work-surface guidance.

Surface: existing Return confirmation and selected learner grading/comments inspector. Roles: owner/teacher interaction; learner returned-work projection checked unchanged. Both desktop/mobile and light/dark. States: existing Final grade, Return pending, acknowledged Return with detail read pending, refreshed grade, sent comment. Primary signal: existing disabled write actions during a pending read and existing Comments Sent acknowledgement. No new control, copy, layout, token, API, migration or provider behavior. Composite keyboard/ARIA contract unchanged; no new composite interaction. Experimental pattern/promotion: none.

| Need | Existing candidate | Decision | Reason |
|---|---|---|---|
| Observe revision after Return | TeacherClassroomView selected panel refresh key | extend | Existing grade/AI completions already use this path |
| Pending/conflict behavior and composer | TeacherStudentWorkPanel/useTeacherStudentWorkController | reuse | Preserve read fencing and optimistic-concurrency refusal |
| Verification | Existing gated fixture and synthetic intercepted API driver | reuse | Real production parent/controller, no backend or provider calls |

Acceptance: after acknowledged Return for the open learner, the inspector fetches the current document before accepting comment writes; the comment save uses the acknowledged revision without a page reload. Retain scores, selection and conflict guards. Blocked/missing learners are not treated as completed. No adjacent refactor planned. Production and cohort/provider holds remain.

## Verification

Component regression failed on the original Return path, then141 owner/controller checks passed. The canonical browser inventory adds one scenario across four projects while retaining every previous case. Browser verification covers teacher Return pending, returned-detail pending and sent-comment states on desktop1440×900/mobile390×844, light/dark; writes use synthetic intercepted acknowledgements. It verifies preserved7/8/9 scores, the exact refreshed revision for autosave, the next revision for Send, no duplicate writes and unchanged document time origin. Four unchanged learner detail-recovery cases cover the same viewport/theme matrix. All8role/view/theme cases pass; final4teacher captures explicitly scroll the sent comment into view. Desktop/mobile captures visually inspected: existing composition, loading/write-disabled feedback and sent-comment states retained, no horizontal overflow or new chrome.

These are actual production UI owners under gated local fixtures with synthetic identities and HTTP replies, not signed-in production, backend persistence, auth or provider-readiness evidence. The prior deployed canary needed a normal reload. No snapshot baseline or stable UI contract changed; no human pattern promotion is needed.

Risk profiles: workspace-state and async-grading (manual Return only). Owner identity remains classroom/assignment/student; the existing controller request/epoch fencing rejects stale reads after owner changes. The new code only invokes that established read path, with dirty-form and pending-write rules preserved. No AI run, provider or mutation protocol change.
