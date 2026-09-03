---
status: experimental
scope: classroom-account-home
source_files:
  - src/app/__ui/OwnedJoinedHomeMockup.tsx
  - src/app/__ui/owned-joined-home-fixtures.ts
  - src/app/__ui/UiGallery.tsx
human_review_required: true
---

# Owned / Joined home prototype

Status: experimental; fixture-only, not approved for live adoption.
Risk profile: none. Independent review risk: standard (local interaction state).
Model recommendation: GPT-5.6 Terra — bounded UI correctness and compatibility review.

## Brief

- Surface: `/pattern-lab#owned-joined-home`, available in both reference roles.
- Reference: PR #1179's accepted top-right classroom actions, extending the PR #1139
  Classrooms mockup. The current reference is retained unchanged beside this proposal.
- Outcome: one account discovers classrooms it teaches and joins without changing account type.
- Roles: teacher, student, and a mixed-relationship fixture; these are examples, not authorization.
- Viewports: 1440×900 desktop and 390×844 mobile; light and dark.
- States: All/Teaching/Joined, populated, new account, loading, error/retry, filtered empty,
  creation unavailable, join validation/confirmation, create, edit, archive/restore and classroom preview.
- Primary signal: one top-right menu above the list, familiar classroom identity accents
  and quiet Teaching/Joined grouping. Filters have their own row above list actions.
- Exclusions: production routes, auth, API calls, persistence, schema, eligibility changes,
  subscription labels, payment UI, destructive deletion, broad visual redesign.
- Composite accessibility: shared selection/menu/dialog owners; test keyboard, semantic state,
  focus return and dismissal. No custom global Escape handler.

| Need | Existing candidate | Decision | Reason |
|---|---|---|---|
| Classroom rows | PR #1139 Card/Button composition | reuse | Preserve compact title, term, dates and identity accent |
| Home filters | SegmentedControl | reuse | Filter one list with shared pressed/keyboard semantics |
| Top-right menu | PageActionBar + TeacherWorkSurfaceIconMenuButton | reuse | Match PR #1179 placement, downward opening, checked edit state and archive divider |
| Back and list Escape | PageHeading | reuse | Return to Active/non-editing and focus the heading; nested menus/dialogs retain Escape |
| Forms and previews | ContentDialog, FormField, Input, ConfirmDialog, PageState | reuse | Keep validation and focus in existing owners |
| Review surface | Pattern Lab catalog | extend | Add a fixture-owned experiment; leave original Classrooms example intact |

Teaching means owner; Joined means member. All groups both relationships. Creation availability
is a separate fixture control, not inferred from a plan label or the selected relationship.
Join remains available in every account example. Only owned classes expose editing, archiving
and restore controls. Archived membership is not presented as active participation.

All form results explicitly say they affect this example only. A demo code confirms a named
synthetic classroom before adding its local member row; invalid input cannot create a row.
Opening a classroom previews relationship-specific destinations without navigating to live URLs.
No fake live-save success, network writes or persisted settings are introduced.

Nearby refactor candidate: PR #1139 and this prototype share classroom-row structure. Keep the
proposal local until human acceptance establishes a durable contract for a live adopter.
Human promotion and separately reviewed server discovery/routing are required before adoption.

## Historical verification — original bottom-menu prototype, 2026-09-03

This evidence predates the PR #1179 alignment below; it is not current placement evidence.

- Captured the uncommitted implementation based on `c29de2d0`; the PR records the final
  committed source and independent review. No UI source changed between captures and this record.
- Environment: local fixture-only `/pattern-lab`, port 3016. Capture owner:
  `e2e/ui-pattern-lab.spec.ts`, tests named `previews the Owned Joined home without live writes`.
- Eight browser scenarios passed: teacher and student × desktop 1440×900 and mobile
  390×844 × light and dark. Screenshots are retained locally under `test-results/`
  in the matching `ui-pattern-lab-{teacher,student}-*` project directories, not committed.
- Visually compared `reference-pr1139-classrooms.png` with `mixed-all.png` at matching
  desktop/mobile viewports. Reviewed defaults for both roles/themes, the menu, join
  confirmation, classroom navigation, mobile edit controls and new-account state.
- Preserved compact identity-accent rows and bottom menu placement. Intentional additions:
  relationship filters/grouping, ownership/member metadata, and explicit local-example status.
  No page overflow at either viewport; mobile metadata moves below dates.
- Keyboard filters, selected state, menu Escape, classroom dialog dismissal/focus return,
  join validation/confirmation, edit order, archive/restore, create cancellation, and error
  retry have automated coverage. Component coverage also validates creation before adding a row.
- A red-first regression exposed focus loss when an archived row disappeared. Archive/restore
  now focus Back, Back focuses the selected relationship, and successful create/join focuses
  its selected relationship after the dialog closes. The browser matrix covers removed-row
  and Back focus, in addition to shared menu/dialog behavior. Composite checklist reviewed:
  keyboard behavior yes; semantic state yes; remaining manual follow-up none for this scope.
- Browser scenarios observe zero non-read `/api/` requests during prototype interactions.
  No live identity, plan enforcement, saved ordering, production navigation or persistence
  is being validated. Classroom destination content is a navigation sketch only.
- In-app browser screenshots were blank; repository Playwright captures provide the visual
  evidence. A development-only Next issue badge appears in some edit captures; this is not
  part of the proposed home. Shared Sass deprecation warnings remain outside this change.
- Human acceptance and live adoption remain pending. The current author owns any follow-up.
- Independent review noted the menu's `h-9 w-9` style, but a browser measurement regression
  passes the 44px minimum because the shared Button also enforces `min-h-control` and
  `min-w-control`. No geometry override is needed; the assertion now protects this contract.

## PR #1179 alignment

The current change moves the same local-only actions into a shared PageActionBar, with a
borderless downward-opening menu aligned to the list's top-right edge. New Classroom and
Join classroom remain independent of the Teaching/Joined filter; owned-only edit/archive
controls retain their permission scope. Edit classrooms uses the current grip icon and
checked state; Show Archived/Show Active is separated as in the accepted menu. Back and
list-level Escape reset Active/non-editing/All and focus the list heading. Menu, form and
confirmation Escape cannot reset the underlying list. The separate filter row prevents
mobile controls crowding out the title or menu. No live list or lifecycle logic is changed.

### Current verification — top-right menu, 2026-09-03

- Verified the revision based on main `1cff4138` (PR #1179). No UI source changed
  between this capture run and the verification record; the PR identifies the final SHA.
- `VITEST_MAX_WORKERS=2 pnpm check:focused -- --base origin/main` passes: 14 files,
  123 tests, architecture, UI/design policy, TypeScript and lint.
- Eight `Owned Joined home` browser scenarios pass on port 3016: both roles ×
  desktop/mobile × light/dark. Current captures live under `test-results/home-top-right/`
  in the corresponding role/project directories. Compared `reference-pr1179-classrooms.png`
  with the proposed list at matching desktop/mobile sizes; inspected both roles/themes,
  full-menu placement, editing and archived states. No page overflow or crowded header.
- Geometry assertions place the menu above the list and within 1px of its right edge
  in active, editing and archived states. The open menu extends downward and its trigger
  retains the shared 44px minimum target.
- Checked edit semantics, Back/list Escape heading focus, and nested menu/confirmation
  Escape ownership pass alongside local reorder/archive/restore/create/join coverage.
  Composite checklist: keyboard and semantic states verified; no manual follow-up for
  this fixture scope. Browser interactions still produce zero API mutations.
- A development-only Next issue badge remains visible in some captures, outside the
  proposed home. This revision does not validate or change live lifecycle persistence,
  permissions or routing. Human acceptance and live adoption remain separate.
