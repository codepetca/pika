# Classrooms list live adoption

The maintainer accepted the Classrooms prototype from PR #1139 for live adoption
on 2026-09-03. This is scoped to the teacher classroom index; other page mockups
remain experimental. Risk profile: none; independent review risk: standard UI/state.

## Acceptance brief

- Surface: teacher `/classrooms`, including active/edit/archived views.
- Reference: `/pattern-lab?role=teacher#mockup-classrooms-panel`.
- Roles: teacher implementation; student regression-only (no student changes).
- Viewports/themes: desktop 1440×900 and mobile 390×844, light and dark.
- States: populated, open menu, keyboard focus, edit, Back, archive loading,
  empty/error, and creation/archive dialogs. Component tests retain active-empty,
  archive/recovery/restore/purge and navigation-pending coverage.
- Primary signal: one borderless top-right ellipsis for New Classroom, checked Edit
  classrooms, and contextual Show Archived/Show Active. Place it immediately above
  the first classroom card, aligned with the cards' right edge, like classroom
  action bars. Back and list Escape
  return to Active/non-editing and focus the heading.
- Exclusions: card restyling, new permanent instructional copy, backend changes,
  archive/purge permission changes, student redesign, dependencies and deployment.
- Composite checklist: yes. Menu keyboard state, focus return, nested dialog/menu
  Escape ownership, and checked edit state require direct tests and browser evidence.

| Need | Existing candidate | Decision | Reason |
|---|---|---|---|
| Menu | TeacherWorkSurfaceIconMenuButton | reuse | Existing ghost treatment, targets, keys and checked state |
| Top-right placement | PageActionBar | reuse | Shared heading and right-aligned actions |
| Rows and operations | SortableClassroomRow, existing archive rows/dialogs | reuse | Preserve identity, data, actions and safeguards |
| State navigation | TeacherClassroomsIndex | extend | Add accepted menu and Back states while preserving live operations |
| Heading focus | PageHeading | extend | Optional headingRef/tabIndex supports focus return in the live index and reference without duplicating typography |
| Creation focus | CreateClassroomModal/ModalLayer | reuse | Use the existing initial-focus marker instead of autofocus, so the owner remembers the opener |

Intentional differences from the fixture: retain real gradient classroom cards,
semester formatting, recovery/restore/reuse/purge controls and first-classroom
empty-state creation. Do not copy fixture data, fake action callbacks, or explanatory
prototype copy. Live operations remain owned by their existing feature handlers.

Nearby refactor candidate: active and archived row framing. A later shared owner
would require compatible operation/state contracts; visual similarity alone does
not justify moving archive lifecycle logic in this change.

## Verification

Run `E2E_BASE_URL=<local-url> pnpm e2e:verify classrooms-live-pattern` after
`pnpm e2e:auth` with the local server and Pattern Lab enabled. The scenario captures
both roles and themes at both viewports, compares the reference surface, verifies
menu keys/checked state, nested Escape, creation focus and Back, and supplies
deterministic archive responses. Classroom mutations are blocked in that capture.
Existing archive visual specs and the Blueprint creation matrix use the new menu.

Artifacts: `output/playwright/classrooms-live-pattern/` (untracked). Record the
rendered commit/tree, capture date and check results on the PR. These captures
prove only the declared classroom-list scope, not product-wide conformance.
