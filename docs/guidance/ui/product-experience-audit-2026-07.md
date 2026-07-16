# Product Experience Audit (July 2026)

## Decision

Pika should evolve through small vertical changes, not a replacement architecture or a one-time visual redesign. The current classroom shell, semantic tokens, server-side domain modules, atomic grading operations, blueprint round-trip operations, and verified archive format are useful foundations. The largest risks come from inconsistent product shells, oversized client coordinators, missing shared interaction guarantees, failures that look like empty states, and partially productized lifecycle systems.

The first implementation work should protect user data before visual consolidation:

1. Disable the legacy permanent classroom Delete route and UI. Any future hot-data removal must run exclusively through the verified archive compaction state machine.
2. Prevent assignment submission when the latest document save failed.
3. Correct the legacy teacher dashboard entry-detail authorization path.
4. Reconcile the blueprint runtime/package-doc v3 contract with the shared transfer/lifecycle v2 contract.

## Audit Method

- Environment: seeded local Supabase only. Production was not queried or modified.
- Desktop viewport: `1440x900`.
- Mobile viewport: `390x844`.
- Visual evidence: ignored local product captures `01-50` with credential-bearing login capture `48` removed, plus Open Design board-QA captures `51-52`; every retained image has a matching DOM snapshot.
- Roles: teacher and student.
- Evidence types: rendered screens, DOM/accessibility snapshots, route/component/API/domain/database tracing, migration contracts, and existing test inventory.
- Open Design: project `Pika Product Experience Audit` (`ec89fd79-1229-4143-8f69-cf24842c6584`), generation run `879efda2-651b-4b5c-aeba-111e43e0cab4`, review run `b503a4ba-f0c0-41df-85a5-6b349588c7e7`. A read-only Pika worktree and the screenshot set were supplied to produce a visual evidence board. The corrected board was browser-verified at `1440x900` and `390x844`; committed captures `51-52` preserve those states because the preview itself is maintainer-local. The mobile document had no horizontal overflow. The repo document remains the authoritative engineering backlog.

The full screenshot set remains in ignored local audit artifacts. A representative review set is committed with the evidence manifest. Together they include classroom indexes, every classroom navigation family, assignment and test grading, gradebook, roster, settings, utility dashboard/calendar/history, blueprints, archived classrooms, authentication entry states, and representative teacher/student mobile and light-theme states.

The durable evidence inventory is [`product-experience-evidence-2026-07.md`](./product-experience-evidence-2026-07.md). It records role, route family, viewport, theme, state, screenshot/DOM identity, and the reviewable evidence copy used by Open Design.

## Product Topology

Pika currently has three role/shell regimes built from two structural mechanisms:

1. The current classroom shell: `AppShell` plus the responsive three-panel classroom layout.
2. Teacher utility routes: `src/app/teacher/layout.tsx`, including dashboard, calendar, and blueprints.
3. Student utility routes: `src/app/student/layout.tsx`, including history.

The classroom shell is the strongest base. Teacher and student utility layouts duplicate navigation mechanics and differ from the classroom product language. They should converge on shared navigation and page-state contracts incrementally. Do not move all routes at once.

## Ranked Findings

### P0: Data Integrity And Recovery

| Finding | Evidence | Required outcome |
| --- | --- | --- |
| A hot-archived classroom can be permanently deleted from the normal Archived UI. Archiving itself only sets `archived_at`, and the legacy route bypasses compaction source-revision, actor, row-count, object, tombstone, and atomic-deletion guarantees. | `TeacherClassroomsIndex.tsx`, `api/teacher/classrooms/[id]/route.ts`, migration `085`, screenshots `40` and `41` | Disable the legacy Delete route and UI. Future hot-data removal must be available only through the verified archive compaction state machine and its explicit lifecycle policy. |
| Assignment submission can continue after the pre-submit save fails because `saveContent` catches the error instead of rejecting. The API can receive an older database document. | `StudentAssignmentEditor.tsx`; no regression test covers this path | Submission stops, preserves the draft, exposes a retryable error, and has a regression test proving no stale submission. |

### P1: Correctness, Accessibility, And Product Architecture

| Finding | Evidence | Required outcome |
| --- | --- | --- |
| Teacher dashboard entry detail calls the student-only entries endpoint; its test mocks the unauthorized path as successful. | `teacher-dashboard-client.ts`, `api/student/entries/route.ts`, `TeacherDashboardPage.test.tsx` | Use a teacher-owned endpoint/domain function and make authorization behavior explicit in tests. |
| Daily, Classwork, Tests, announcements, surveys, and calendar often render fetch failures as empty or stale content. | Teacher and student list hooks/components; one route-level `loading.tsx`, no route `error.tsx` | Shared loading/error/empty contracts with retry behavior; errors must not claim there is no data. |
| Canonical dialogs and classroom drawers do not trap focus, restore the opener, make the background inert, or consistently lock scroll. Hand-built modals add further drift. | `src/ui/Dialog.tsx`, `LeftSidebar.tsx`, `RightSidebar.tsx`, 52 canonical dialog uses | One tested modal-layer contract covering initial focus, containment, Escape, focus return, inert background, and scroll lock. |
| Canonical token pairs fail WCAG AA, including dark primary, success, danger, and light warning combinations. | `tokens.css`, `Button.tsx` | Adjust semantic pairs and add automated contrast assertions. |
| Base buttons and segmented icon controls do not meet the documented `44x44` target contract; several focusable surfaces suppress outlines without a replacement. | `Button.tsx`, `SegmentedControl.tsx`, `DataTable.tsx`, `WorkspaceSplitPane.tsx` | Shared target sizing and visible focus treatment, verified at mobile width and keyboard-only. |
| `FormField.required` is visual rather than semantic and cloned props can leak non-DOM attributes into native controls. | `FormField.tsx`, login and blueprint creation callers | Field primitives own label, required, description, error, and native/ARIA wiring. |
| Blueprint create/instantiate calls do not preserve a caller idempotency key; lesson-plan overflow metadata is ignored; runtime and package guidance use v3 while `COURSE_BLUEPRINT_TRANSFER_CONTRACT` and the archive lifecycle guide still declare v2. | blueprint clients and operation modules; `course-blueprint-package.ts`; `course-blueprint-packages.md`; `classroom-artifacts.ts`; `classroom-lifecycle-archives.md` | Stable idempotency across retries, an overflow review step, one package version contract, compatibility evidence, and a browser round trip. |
| Gradex is substantial server-side but has only a global assignment flag, advances while a teacher page sends tick requests, and lacks a named status/audit product surface or recorded production canary. | assignment AI-run routes/modules and Gradex extract modules | Teacher/classroom canary scope, durable background progression, explicit status/retry/audit UX, hardened smoke target validation, and recorded canaries. |
| Archive export/restore/compaction infrastructure is operator-gated. Hot restore and a gated cold-restore control exist, but teachers cannot initiate or monitor export, understand verification/retention/quota, or see why cold restore is unavailable. Purge is absent. | archive server modules and migrations 082-086 and 095-098 | Productize verified export and lifecycle status before cleanup; retain existing restore controls with explicit availability/progress; cleanup remains disabled until separately canaried and approved. |
| Legacy dashboard and top-level calendar expose Delete for active classrooms, but the shared route rejects non-archived deletion. | `teacher/dashboard/page.tsx`, `teacher/calendar/page.tsx`, `api/teacher/classrooms/[id]/route.ts` | Remove the invalid commands or replace them with the governed archive workflow and regression coverage. |

### P2: Consistency And Maintainability

- The dashboard attendance matrix has unbounded horizontal width and a separate shell. Screenshot `36` shows a full-page capture several viewports wide on mobile.
- Assignment and test grading remain usable on mobile but compress dense tables and controls into a narrow operational surface. Screenshots `30` and `32` show the need for explicit mobile modes instead of desktop density scaled down.
- Blueprints use a legacy shell, hand-built tabs, a passive empty detail pane, and duplicate create actions. Screenshots `13`, `37`, `37a`, and `38` show the inconsistency.
- Archived classroom discovery is hidden inside Organize mode. Once visible, Restore and Delete are presented as peer actions without recovery context.
- There are 21 `@/ui/*` subpath imports and many native controls with no exception registry. Current UI policy checks cannot distinguish intentional specialized controls from drift.
- `EmptyState`, loading, menus, tabs, and tables have multiple local implementations. Composite ownership is unresolved in `docs/guidance/ui/legacy.md`.
- Playwright defines one desktop project, CI does not run the browser suite, and existing visual snapshots contain no mobile coverage.
- Student aggregate grades and profile editing are absent. These are product decisions to confirm, not automatic implementation defects.
- Legacy resource and gradebook helpers remain tested but are not mounted in the current product. Student history is separately mounted under the utility shell and overlaps the classroom Today history model. Retire or consolidate only after caller and compatibility evidence.

## Shared Authentication Workflow Map

| Workflow | UI ownership | API/domain/database ownership | Test evidence | Accessibility and error-state assessment |
| --- | --- | --- | --- | --- |
| Login, signup, verification, password creation/reset, logout, session expiry, and role routing | login/signup/verify/reset pages, `UserMenu`, logout route, teacher/student layouts and root routing | auth/session/verification routes and helpers; Supabase Auth plus `users`, `student_profiles`, and session cookies | Auth pages, route handlers, verification/reset, session, role-routing, and user-menu suites cover the primary contract. | Field semantics are inconsistent because `FormField.required` is visual; route-level failures lack a shared error boundary; session-expiry recovery and post-auth focus/announcement behavior need browser verification. |

## Teacher Workflow Map

| Workflow | UI ownership | API/domain/database ownership | Test evidence | Accessibility and error-state assessment |
| --- | --- | --- | --- | --- |
| Classroom list, create, order, archive | `TeacherClassroomsIndex` | teacher classroom routes; `classroom-order`, `server/classrooms`; `classrooms` | Component and API suites cover active/archive/order behavior. | Archive discovery is hidden in Organize mode. Permanent deletion bypasses verified recovery, and destructive/recovery actions lack lifecycle context. |
| Daily attendance and journals | `TeacherAttendanceTab` | logs, history, summary, attendance, and class-day routes; attendance/report/history modules; `entries`, `class_days`, `log_summaries` | Unit, API, component, attendance, and timezone suites exist. | Fetch failures can look normal; status changes need live announcements; the mobile table and history split need an explicit narrow-screen mode. |
| Classwork authoring and ordering | `TeacherClassroomView`, assignment/material/survey editors | assignment/material/survey routes; assignment and scheduling modules; `assignments`, `classwork_materials`, `surveys`; reorder RPCs | Component, modal, API, reorder, and domain suites are broad. | Error/empty separation is incomplete. The coordinator owns fetching, selection, mode, and rendering, which makes consistent focus and recovery behavior difficult. |
| Assignment submissions and grading | assignment workspace and `TeacherStudentWorkPanel` | document, grade, return, feedback, artifact, repo, and AI-run routes; assignment grade/return/AI modules; document/history/feedback/repo/AI tables and atomic RPCs | Focused component/API suites and atomic contract tests are strong. | Mobile density is high; grading/history comments need clear mode and focus transitions; AI progress pauses without page-driven ticks and lacks durable retry/status feedback. |
| Tests: authoring, access, attempts, grading | `TeacherTestsTab`, test editors and grading panes | test/question/document/result/access/AI/return routes; test domain modules; test/attempt/response/focus/draft tables and atomic RPCs | Extensive component, hook, API, architecture, E2E, and return-flow coverage exists. | One large coordinator owns authoring and grading. Mobile needs mode navigation; document tabs lack complete tab semantics; list failures can look empty. |
| Gradebook | `TeacherGradebookTab` | gradebook route and domain modules; derived assignment/test/enrollment data | Unit, API, server, validation, architecture, and component suites exist. | Dense desktop table is coherent, but mobile remains horizontal-data heavy. Keyboard sorting/selection/focus behavior lacks direct `DataTable` coverage. |
| Roster | `TeacherRosterTab` | roster add/upload/edit/bulk-delete routes and atomic removal RPC; roster/enrollment/profile/user tables | Component, API, parser, removal, and RPC coverage exists. | Mobile hides email and counselor fields without row detail. Table focus, sort, selection, and confirmation behavior need keyboard verification. |
| Calendar, lesson plans, announcements | classroom calendar and announcement surfaces | lesson-plan, announcement, class-day, and read routes; lesson/announcement/read tables | Component/API coverage exists across the individual features. | Independent failures collapse to partial empty calendars; announcement time is not consistently Toronto-based; compact calendar controls need mobile target checks. |
| Syllabus/resources | teacher resources tab and `/actual` iframe | course-site and published-source modules; classroom site fields/resources plus course content | Published-source and resource behavior has focused tests; the legacy editor is still separately tested. | Empty/published states exist, but iframe sizing, nested scrolling, theme contrast, and keyboard traversal need browser checks. |
| Settings | classroom settings surface | classroom/site/calendar/join/blueprint routes and modules | Settings and related route/domain behavior have focused component/API coverage. | One long surface mixes joining, display, calendar, syllabus publishing, and blueprint capture; section navigation, field semantics, failure recovery, and mobile scroll position are not governed. |
| Legacy dashboard | `/teacher/dashboard` | teacher attendance/export plus an incorrect student entry call; classroom/roster/class-day/entry data | Component and API coverage exists but the component test mocks an unauthorized call as success. | Entry detail is functionally broken for teachers. The shell differs from classrooms and the matrix has unbounded mobile width. |
| Top-level teacher calendar | `/teacher/calendar` | teacher classroom/lesson-plan/calendar routes and classroom/class-day/lesson data | Calendar component/API behavior has focused coverage; evidence `43` and `44` adds a dedicated utility-route browser review. | Delete is offered for active classrooms even though the API rejects it. Mobile evidence shows horizontal overflow; keyboard, empty, and failure states still need direct verification. |
| Blueprints | `/teacher/blueprints` | blueprint CRUD/import/export/instantiate/merge/AI routes; operation/package modules; blueprint tables and atomic RPCs | Server, API, package, migration, and focused component suites exist. No browser round trip exists. | Client retries lack stable idempotency, overflow is ignored, navigation has no dirty-state guard, and legacy tabs/shell/modal semantics drift from shared primitives. |
| Public planned-course site | `/planned/[slug]`, opened from Blueprints | public planned-course loader and publishing contract; blueprint publication metadata and course content | Publishing/domain tests cover source selection and availability; no durable browser capture exists yet. | Public not-found, responsive layout, keyboard traversal, and content-exposure boundaries require browser verification before Phase 5 exits. |
| Standalone test preview | `/classrooms/[classroomId]/tests/[testId]/preview` | teacher preview page plus test authorization/detail contracts | Test authorization and authoring suites cover related behavior; no durable full-screen browser capture exists yet. | The separate full-screen shell, authorization failure, keyboard flow, and mobile framing require browser verification in the Tests slice. |
| Archive lifecycle | classroom index plus operator routes | inventory/export/restore/compaction/cleanup modules; archive operation/manifest/tombstone tables and private storage | Low-level, migration, recovery, database-contract, and named canary coverage is unusually strong. | Teacher-visible export/verification/retention/quota/purge states are absent. Hot archive Delete is unsafe; cleanup remains correctly fenced and disabled. |
| Gradex | assignment AI grading and internal extract paths | assignment AI-run and Gradex extract modules; run/extract/cleanup operation tables and private storage | Backend suites cover adapter, payload, persistence, privacy, archive extraction, and cleanup ledgers. | No scoped rollout, durable worker progression, teacher audit/status/retry surface, named production grading canary, or downstream extract-consumer evidence. |

## Student Workflow Map

| Workflow | UI ownership | API/domain/database ownership | Test evidence | Accessibility and error-state assessment |
| --- | --- | --- | --- | --- |
| Classroom list and join | `StudentClassroomsIndex`, join page, classroom shell | student classroom/join routes; classroom access modules; users/profiles/classrooms/enrollments/roster | Index, join, access, and classroom API component suites exist. | Mobile shell is compact. Join exposes loading/profile-required/error states, but the shell/drawer needs focus containment and return; profile collection exists only during join. |
| Today journal | `StudentTodayTab` | student entry and class-day routes; entry client and attendance rules; `entries`, `class_days` | History, conflict, autosave, entry API, and attendance suites exist. | Save status is not announced; conflict/error recovery is visually local; long history dominates mobile and should not obscure the current entry task. |
| Assignments | `StudentAssignmentsTab`, `StudentAssignmentEditor` | assignment list and document save/submit/unsubmit/history/restore/artifact routes; assignment/validation modules; document/history/feedback/requirement/artifact tables | Tab/editor, submission API, feedback, validation, and focused E2E coverage exists. | Failed save can still submit stale data. Save status is not live-announced; history/restore dialogs lack complete modal semantics; list failure can look empty. |
| Tests and results | `StudentTestsTab`, `StudentTestForm`, `StudentTestResults` | list/detail/attempt/respond/result/session/focus routes; atomic submit/save RPCs; test/attempt/response/history/focus tables and document storage | Extensive unit, component, API, exam-mode E2E, and atomic contract coverage exists. | Save and flag states are not fully announced; flags lack pressed semantics; unavailable/failed lists can look empty; exam-mode focus and mobile split-pane behavior need browser verification. |
| Surveys | `StudentSurveyPanel` | survey list/detail/respond/results routes and survey tables | Component, API, and survey-domain coverage exists. | Results failure can remain indefinitely in loading; choices lack radio/pressed semantics; retry and error announcement are absent. |
| Calendar | `StudentLessonCalendarTab` | lesson, assignment, announcement, and class-day reads | Calendar and source feature suites cover normal behavior. | Independent failures are hidden as empty arrays; `320px` density, target sizing, and keyboard day navigation need explicit tests. |
| Syllabus and announcements | resource iframe and announcement section | published course-site/material/announcement routes; announcement/read tables | Published-source, material, and announcement coverage exists. | Iframe sizing, nested scrolling, theme contrast, and keyboard traversal need browser checks; announcement time uses browser timezone; failures can look like no content. |
| Grades and profile | returned assignment/test feedback and join profile collection | assignment/test result data and `student_profiles` | Coverage lives in assignment feedback, test results, join, user-menu, and profile unit tests. | No aggregate gradebook or profile-edit route exists. Confirm product intent before adding scope; current fragmentation makes status and error behavior inconsistent. |
| Legacy student history | `/student/history` | student entry/history routes and entry/history helpers; `entries` and `class_days` | History behavior and entry APIs have focused coverage; evidence `46` and `47` adds mobile/desktop utility-route review. | The route duplicates Today history, overflows horizontally on mobile, uses clickable non-keyboard rows, and has hand-built modal semantics. Decide whether to migrate, redirect, or retire it after compatibility evidence. |

## Architecture Direction

### Keep

- App Router server authorization and server-side domain modules.
- Atomic RPCs for multi-table grading, test lifecycle, roster removal, blueprint round trips, and archive operations.
- The semantic token layer and `@/ui` as the intended primitive boundary.
- URL-backed classroom tabs and selected-item state.
- Verified archive manifests, resumable restore, and cleanup fences.
- The deidentified Gradex extract as a separate integration boundary.

### Change Incrementally

- Split large client coordinators by workflow state machine and server/data adapter, not by arbitrary visual fragments.
- Give every route/workflow an explicit `loading | ready | empty | error | forbidden` contract.
- Promote shared modal, menu, tabs, table, shell, and page-state behavior only after focused migrations prove the APIs.
- Move background operations out of page-driven polling while retaining observable operation records and idempotent retry.
- Treat blueprints as reusable course definitions and archives as recoverable historical records. They may share capture inputs, but they must not share lifecycle semantics.
- Use Zod at untrusted boundaries: request payloads, external packages, environment/config, background-job payloads, and stored JSON. Do not add schemas to already typed internal values solely for uniformity.

## Execution Backlog

### Phase 1: Audit And Prioritization

1. Merge this workflow map, ranked backlog, and durable evidence manifest.
2. Complete and review the Open Design evidence board at desktop and mobile widths.
3. Record limitations explicitly: local seeded data, no production inspection, representative rather than exhaustive light-theme captures, and no assistive-technology user study.
4. Select the first Safety Wave PR and carry its acceptance criteria into the implementation brief.

Exit evidence: merged audit, reviewable Open Design artifact, durable workflow/viewport coverage matrix with an explicit reason and owning phase for every uncaptured state, reviewer findings resolved, and the first implementation PR scoped. A maintainer-local Open Design URL alone is not durable evidence.

### Safety Wave: Immediate Correctness

1. Disable the legacy archived-classroom Delete endpoint and UI with API/UI regression tests. Design any future removal control only around the compaction state machine.
2. Make pre-submit assignment save failures reject submission and add data-loss regression coverage.
3. Replace the dashboard student endpoint call with a teacher-owned contract and correct its tests.
4. Resolve blueprint package v2/v3 drift in runtime, docs, fixtures, and compatibility tests.
5. Remove or replace invalid active-classroom Delete actions on the dashboard and top-level calendar.

Each item is a separate PR unless one shared route contract makes two inseparable. Exit evidence is a focused regression test, relevant contract test, and role/viewport verification where UI changes.

### Phase 2: Shared Experience Foundation

1. Add automated semantic-token contrast checks and correct failing pairs.
2. Implement and test one modal-layer contract, then migrate canonical dialogs and mobile drawers.
3. Correct button target sizing, focus-visible behavior, and `FormField` semantic propagation.
4. Define page structure, typography, spacing, action placement, and responsive-density contracts using the existing Tailwind tokens and `@/ui` layer.
5. Define page-level loading/error/empty/forbidden primitives and route conventions.
6. Establish shared table, menu, tabs, segmented-control, and split-pane contracts with direct keyboard/ARIA tests.
7. Establish one shared application-navigation mechanism, migrating teacher and student utility routes one at a time.
8. Strengthen UI policy enforcement with a specialized-control exception registry rather than banning valid native controls.
9. Add mobile and light/dark Playwright projects plus CI coverage for representative teacher/student workflows.

Exit evidence: canonical primitive tests prove keyboard/focus/ARIA behavior; all semantic foreground/background pairs meet AA; representative classroom, teacher utility, and student utility routes use the governed page-state contracts; desktop/mobile and light/dark browser checks run in CI.

### Phase 3: Vertical Product Slices

1. Assignments: save/submit integrity, error states, mobile workspace modes, Gradex status boundary.
2. Tests: list errors, authoring/grading mode separation, standalone preview authorization/framing, mobile navigation, accessible flags/save status.
3. Daily and attendance: explicit failures, mobile history/table modes, Toronto timestamp verification.
4. Dashboard: teacher-owned entry detail, responsive summary-first attendance, and removal of invalid classroom commands.
5. Roster: mobile row detail, keyboard table behavior, bulk-action recovery, and counselor-field access.
6. Surveys: explicit results error/retry and native-equivalent choice semantics.
7. Calendar and lesson plans: independent source failures, compact navigation, and Toronto date/time behavior.
8. Announcements: explicit failure/read states and Toronto timestamp formatting.
9. Gradebook: narrow-screen navigation, selected-student detail, and direct table keyboard tests.
10. Syllabus/resources: iframe sizing, nested scroll, theme, keyboard traversal, and legacy resource-path disposition.
11. Authentication and history utility routes: shared shell/page states, session-expiry recovery, and an evidence-based migrate/redirect/retire decision for `/student/history`.
12. Settings and student grades/profile: organize the mixed settings surface, verify field/error behavior, and record the product decision for aggregate grades and profile editing before implementing or explicitly declining those surfaces.

Each numbered slice is independently releasable and reviewed for both affected roles. Exit evidence: focused component/API/domain tests, explicit error-state coverage, keyboard checks for composite controls, and accepted desktop/mobile screenshots in both themes when the workflow supports them.

### Phase 4: Gradex Integration

1. Add teacher/classroom canary controls and stronger smoke target guards.
2. Introduce durable background run progression with idempotent retries.
3. Add teacher-visible run status, retry, audit, and privacy/retention information.
4. Version the deidentified extract contract and prove direct-identifier exclusion, content sanitization, PII rejection, and private-object access controls.
5. Define authenticated ingestion with schema compatibility checks, idempotency, replay handling, and durable receipt/error evidence.
6. Enforce extract and ingestion retention with separately auditable deletion ledgers; keep all cleanup disabled by default.
7. Run and record an exactly authorized assignment grading canary and a separate extract-to-ingestion canary with target identity, latency, result, privacy, and retention evidence.

Exit evidence: scoped rollout controls, durable runs that progress without an open page, teacher status/retry UX, passing deidentification and ingestion contract suites, recorded authorized production canaries, and cleanup still disabled unless a separate approval explicitly enables one exact action.

### Phase 5: Blueprints And Archives

1. Productize end-of-course rollover: capture a reusable blueprint, preview included/excluded content, version it, and create the next classroom without students, submissions, grades, attendance, or runtime publication state.
2. Preserve blueprint idempotency keys across client retries; expose lesson-calendar overflow and require due-date/release-state review before teachers publish classwork.
3. Add dirty-state protection, package compatibility evidence, and browser-tested classroom-to-blueprint-to-new-classroom round trips.
4. Verify the public `/planned/[slug]` output at desktop/mobile, including not-found and content-exposure boundaries.
5. Define explicit archive eligibility and hot-to-cold policy: verified export, retention approval, recoverability evidence, quota headroom, and no active operation conflicts.
6. Productize background export/verification/compaction status while retaining hot data until every gate passes.
7. Keep hot and gated cold restore, adding availability, progress, retry, and failure evidence. Prove restored relational counts, actor reconciliation, object bytes/checksums, and URL bindings against an independent oracle.
8. Add retention, quota, completed-archive purge, and remaining storage-ownership policy backed by durable operation records.
9. Canary manual cleanup repeatedly before scheduling it; require separate authorization for each production cleanup stage and keep cleanup disabled otherwise.

Exit evidence: browser-tested rollover and date/release review; idempotent operation evidence; a documented hot-to-cold state machine; teacher-visible operation and restore states; database contract/recovery drills proving equality; named production canaries; and separately approved cleanup evidence, if cleanup is enabled at all.

### Phase 6: Verification And Legacy Retirement

1. Rerun the complete teacher/student workflow matrix across classroom, teacher utility, and student utility shells at desktop/mobile and light/dark states.
2. Rerun accessibility checks for contrast, target size, headings/landmarks, keyboard order, focus containment/return, live status, tables, menus, tabs, drawers, dialogs, and editors.
3. Rerun architecture boundaries, dependency checks, client-coordinator ownership review, route-state inventory, and UI-policy enforcement.
4. Rerun API/domain/database contract suites, migration replay, archive recovery drills, Gradex privacy/ingestion tests, and production-readiness checklists.
5. Perform only explicitly authorized production canaries; use read-only hosted verification otherwise. Record target identity and evidence for every production statement.
6. Inventory duplicated routes, components, hooks, tables, and package representations. Remove each legacy surface only in a focused PR after runtime-caller, data-compatibility, redirect, and recovery evidence.

Exit evidence: every row in the workflow/evidence manifest has a current result; all required checks and canaries have durable records; no unreviewed legacy caller or representation remains; production cleanup state is explicit; and the final completion audit maps every original goal requirement to authoritative evidence.

## PR And Acceptance Contract

Each implementation PR must:

- Own one user-visible workflow or one shared primitive contract.
- Identify the route, API/domain boundary, database contract, and failure states it changes.
- Include regression tests for the reported risk.
- Include desktop and mobile screenshots for affected roles.
- Include keyboard verification when dialogs, drawers, menus, tabs, tables, or editors change.
- Avoid new dependencies unless explicitly approved.
- Keep migrations human-controlled unless exact one-time target and migration permission is granted.
- Avoid production writes unless explicitly authorized.

Phase 1 is complete only when the reviewed Open Design board and its durable verification captures, this backlog, and the workflow/viewport coverage matrix are merged; reviewer findings are resolved; and the first Safety Wave implementation PR is scoped and selected. The broader goal remains active until all six phases are implemented and verified.
