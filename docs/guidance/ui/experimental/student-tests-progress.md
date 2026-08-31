---
status: experimental
scope: student-tests-list-and-submitted-detail
source_files:
  - src/components/StudentTestListItem.tsx
  - src/lib/student-test-presentation.ts
  - src/app/classrooms/[classroomId]/StudentTestsTab.tsx
human_review_required: true
---

# Student Tests progress and access

Local review candidate; not a new cross-product default.

## Change brief — 2026-08-31

- Surface: student Tests list and non-exam detail/return navigation.
- Authority/reference: DESIGN.md, stable UI canon, shared classroom shell,
  canonical Button/Card/PageHeading/PageState examples in `/pattern-lab#controls`
  and `/pattern-lab#page-states`. The old Tests page is baseline evidence only.
- Roles: student; teacher product UI n/a (unchanged). Pattern Lab checked for both roles.
- Viewports/themes: 1440×900 and 390×844, light and dark.
- States: available, closed/unsubmitted, submitted with open/closed access,
  returned, long title, hover/focus, initial loading, empty, list/detail error,
  retry and return. Upcoming n/a: student API exposes no scheduled state.
- Primary signal: explicit progress label; quiet supporting access/recovery text.
- Exclusions: no sorting, API, test data, attempt permissions, exam workspace,
  telemetry, grading, date helpers or history changes. No new dependencies.
- Composite checklist: reviewed for list-to-detail focus; no new composite widget.
- Model recommendation: current Codex model — bounded UI and regression work.
- Risk: workspace-state (selected detail and late reads); exam-mode implementation
  excluded, with existing exam regressions required as protection.
- Approval: user manually verified the preview and authorized PR review and main merge. Production promotion is not authorized; this does not promote the examples to cross-product canon. Existing page-top and inter-card spacing remains unchanged.

| Need | Existing candidate | Decision | Reason |
|---|---|---|---|
| List and Back actions | `Button` | reuse | Shared targets, disabled semantics and visible focus |
| Page framing, heading, feedback | `PageLayout`, `PageHeading`, `Card`, `PageState` | reuse | Canonical widths, typography and recovery states |
| Test status and row presentation | Student Tests list | extend | Feature-owned presentation extracted for deterministic Lab evidence; no universal status component |

## Domain boundaries

The API distinguishes test publication, effective student access, and progress.
Published closed tests remain visible; drafts are not returned. Individual access
can differ from the test's global status. `responded` is the API's submitted/read-only
category and also includes work closed for grading; the UI must not infer that the
student explicitly pressed Submit. `can_view_results` alone unlocks results.

Progress takes precedence over access in the badge: Returned, Submitted, then
Closed or Available. Submitted closed work explicitly retains “Access closed”
as supporting context. No “Upcoming”, “Overdue”, “Missing”, or “In progress” state
is invented from fields that do not establish it.

## Recovery and focus

Detail HTTP failure cannot use the list summary as if it were a successful read.
Pending and failed detail show a named state and an available Back action; retry
is bounded and explicit. Existing request IDs and classroom identity guards
remain in place. Back returns focus to the originating enabled card, with the
Tests region as fallback. Active exam form lifetime and incident rules are unchanged.

## Refactor candidates

The large exam workspace remains feature-owned. Its repeated submitted banners
and detail headers could be consolidated only in a dedicated exam-lifecycle
review that proves form preservation and document/focus telemetry behavior.
