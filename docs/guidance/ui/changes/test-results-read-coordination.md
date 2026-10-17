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

## Main integration

Port only the verified fix from `8633ca70` and `050699bb` onto main
`944c1735c`. Preserve the newer publication controls, roster columns, gridlines,
score wording and grading summaries. Replace main's unique-key, zero-TTL results
wrapper with the workspace-owned in-flight reader; no fulfilled data is cached.
Clear roster read errors at request entry, not successful completion, so a newer
mutation or completed-run failure is not erased by a pending refresh.

The original real vertical proof passed at app `050699bb` with runner `36685e858`:
create, publish, member answer/save/submit, owner inspection, three forbidden
access checks, cleanup and preservation. Local evidence is retained under
`~/.codex/verification/classroom-access/2026-10-12-restart-recovery/playwright-vertical-u04GxQ/ACCEPTANCE.md`.
Those desktop-light captures are historical for this main integration, not a
claim that current main has passed another database-backed rehearsal.

Integration verification: 169 reader/panel/roster tests pass, including main's
partial-failure grading summary regression. Use the existing returned-feedback
Playwright fixture across teacher desktop/mobile and light/dark for current
rendering, focus and local-draft evidence; intercepted API reads and blocked
writes do not establish database persistence. Student rendering is unchanged
by this diff (n/a for the integration visual matrix); its prior real submission
proof remains tied to the original app revision. Composite checklist reviewed:
no new roles, keyboard model, focus contract or layout behavior.

Full focused checks, independent integration review and PR evidence follow in
the PR receipt. Production, schema, provider, account and rollout holds remain.
