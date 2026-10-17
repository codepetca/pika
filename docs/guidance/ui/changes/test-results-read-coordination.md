# Test results read coordination — 2026-10-17

Surface: selected Test grading roster and active response inspector.
Reference: existing `TeacherTestsTab` / `TestStudentGradingPanel` and the governed
teacher work-surface canon. The development-only Pattern Lab
`?role=teacher&fixture=test-controller#test-controller` is the real authoring
controller reference, not a substitute grading-inspector implementation;
the existing `/e2e-fixtures/teacher-test-grading` owner is the grading reference.
This is a behavior correction, not a new visual pattern or shell redesign.

| Need | Existing candidate | Decision | Reason |
|---|---|---|---|
| Selected workspace and inspector | Existing Tests grading roster, split and panel | reuse | Preserve selection, layout, controls and semantic styling. |
| Loading/error/content feedback | Existing inspector loading/error/result branches | reuse | A stale request must not win over the current selection or a newer successful read. |
| Results read ownership | Feature-owned Tests loaders | extend | Coordinate their in-flight reads without caching settled grading revisions or weakening server locks. |

Roles: classroom owner/teacher-context grading; globally student-valued owners
are included. Member test-taking UI is unchanged and remains an end-to-end
regression participant. No new controls, messages, layout, colors, typography,
ARIA composite behavior or design-system primitive. Composite-widget review: n/a.
Primary signal: the existing selected student's actual response renders after
loading, while genuine current failures retain the existing error treatment.

Affected states: loading, selected response, error/recovery, Test/scope switch,
refresh and unsaved manual grading drafts. Deterministic regressions must cover
overlapping reads, stale success/error, fresh post-mutation reads and dirty drafts.
No fulfilled-value cache, cross-workspace data sharing, automatic request retries,
SQL/auth/permission changes or changes to network/process/database safeguards.

Visual acceptance: fresh bounded real-app proof of owner response inspection and
member submission, using its existing three-capture ceiling. Desktop/mobile and
theme dimensions are recorded with the actual captures; unchanged geometry and
theme styling are not a new cross-theme design claim. This narrow proof does not
establish the full Tests/Surveys rollout matrix. Any missing dimension remains
explicit, not inferred from a passing unit test or an older screenshot.

Evidence and exact rendered revision: pending independent review and fresh proof.
Production and rollout remain held.
