# Product Experience Audit (July 2026)

## Decision

Pika should evolve through small vertical changes, not a replacement architecture or a one-time visual redesign. The current classroom shell, semantic tokens, server-side domain modules, atomic grading operations, blueprint round-trip operations, and verified archive format are useful foundations. The largest risks come from inconsistent product shells, oversized client coordinators, missing shared interaction guarantees, failures that look like empty states, and partially productized lifecycle systems.

The first implementation work should protect user data before visual consolidation:

1. Completed in PR #890: the legacy permanent classroom Delete route and UI are disabled. Any future hot-data removal must run exclusively through the verified archive compaction state machine.
2. Prevent assignment submission when the latest document save failed.
3. Completed in PR #894: the teacher dashboard entry-detail path uses the teacher-owned authorization contract.
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
| Resolved in PR #894: teacher dashboard entry detail now uses the teacher-owned student-history endpoint with explicit authorization coverage. | `teacher-dashboard-client.ts`, `api/teacher/student-history/route.ts`, `TeacherDashboardPage.test.tsx` | Preserve the teacher-owned contract and its ownership/enrollment regressions. |
| Daily, Classwork, Tests, announcements, surveys, and calendar often render fetch failures as empty or stale content. | Teacher and student list hooks/components; one route-level `loading.tsx`, no route `error.tsx` | Shared loading/error/empty contracts with retry behavior; errors must not claim there is no data. |
| Canonical dialogs and classroom drawers do not trap focus, restore the opener, make the background inert, or consistently lock scroll. Hand-built modals add further drift. | `src/ui/Dialog.tsx`, `LeftSidebar.tsx`, `RightSidebar.tsx`, 52 canonical dialog uses | One tested modal-layer contract covering initial focus, containment, Escape, focus return, inert background, and scroll lock. |
| Canonical token pairs fail WCAG AA, including dark primary, success, danger, and light warning combinations. | `tokens.css`, `Button.tsx` | Adjust semantic pairs and add automated contrast assertions. |
| Base buttons and segmented icon controls do not meet the documented `44x44` target contract; several focusable surfaces suppress outlines without a replacement. | `Button.tsx`, `SegmentedControl.tsx`, `DataTable.tsx`, `WorkspaceSplitPane.tsx` | Shared target sizing and visible focus treatment, verified at mobile width and keyboard-only. |
| `FormField.required` is visual rather than semantic and cloned props can leak non-DOM attributes into native controls. | `FormField.tsx`, login and blueprint creation callers | Field primitives own label, required, description, error, and native/ARIA wiring. |
| Blueprint create/instantiate calls do not preserve a caller idempotency key; lesson-plan overflow metadata is ignored; runtime and package guidance use v3 while `COURSE_BLUEPRINT_TRANSFER_CONTRACT` and the archive lifecycle guide still declare v2. | blueprint clients and operation modules; `course-blueprint-package.ts`; `course-blueprint-packages.md`; `classroom-artifacts.ts`; `classroom-lifecycle-archives.md` | Stable idempotency across retries, an overflow review step, one package version contract, compatibility evidence, and a browser round trip. |
| Gradex is substantial server-side but has only a global assignment flag, advances while a teacher page sends tick requests, and lacks a named status/audit product surface or recorded production canary. | assignment AI-run routes/modules and Gradex extract modules | Teacher/classroom canary scope, durable background progression, explicit status/retry/audit UX, hardened smoke target validation, and recorded canaries. |
| Archive export/restore/compaction infrastructure is operator-gated. Hot restore and a gated cold-restore control exist, but teachers cannot initiate or monitor export, understand verification/retention/quota, or see why cold restore is unavailable. Purge is absent. | archive server modules and migrations 082-086 and 095-098 | Productize verified export and lifecycle status before cleanup; retain existing restore controls with explicit availability/progress; cleanup remains disabled until separately canaried and approved. |
| Resolved in PR #890: the legacy dashboard and top-level calendar no longer expose invalid active-classroom Delete commands. | `teacher/dashboard/page.tsx`, `teacher/calendar/page.tsx`, `api/teacher/classrooms/[id]/route.ts` | Keep classroom removal behind the governed archive lifecycle. |

### P2: Consistency And Maintainability

- The dashboard attendance matrix has unbounded horizontal width and a separate shell. Screenshot `36` shows a full-page capture several viewports wide on mobile.
- Assignment and test grading remain usable on mobile but compress dense tables and controls into a narrow operational surface. Screenshots `30` and `32` show the need for explicit mobile modes instead of desktop density scaled down.
- Blueprints use a legacy shell, hand-built tabs, a passive empty detail pane, and duplicate create actions. Screenshots `13`, `37`, `37a`, and `38` show the inconsistency.
- Archived classroom discovery is hidden inside Organize mode. Once visible, Restore and Delete are presented as peer actions without recovery context.
- Resolved in Phase 2 PR #905: the 21-import baseline and unclassified native controls now use the canonical `@/ui` barrel plus an AST-enforced, reasoned registry covering 215 controls across 67 files.
- `EmptyState`, loading, menus, tabs, and tables have multiple local implementations. Composite ownership is unresolved in `docs/guidance/ui/legacy.md`.
- Playwright now defines explicit desktop/mobile and light/dark Chromium projects. CI runs a seeded, read-only teacher/student classroom and utility-shell contract across that matrix; the broader feature and manual visual suites remain desktop-light to control runtime. Durable mobile visual baselines remain a Phase 6 deliverable.
- Resolved in the Settings slice: returned assignment/test feedback remains the student grade surface until aggregate disclosure, weighting, and incomplete-work semantics are defined. Standalone profile editing remains declined until global profile and classroom-roster name authority and synchronization are defined.
- Legacy resource and gradebook helpers remain tested but are not mounted in the current product. Student history is separately mounted under the utility shell and overlaps the classroom Today history model. Retire or consolidate only after caller and compatibility evidence.

## Shared Authentication Workflow Map

| Workflow | UI ownership | API/domain/database ownership | Test evidence | Accessibility and error-state assessment |
| --- | --- | --- | --- | --- |
| Login, signup, verification, password creation/reset, logout, session expiry, and role routing | login/signup/verify/reset pages, `UserMenu`, logout route, teacher/student layouts and root routing | auth/session/verification routes and helpers; Supabase Auth plus `users`, `student_profiles`, and session cookies | Auth pages, route handlers, verification/reset, session, role-routing, and user-menu suites cover the primary contract. Recovery coverage proves safe interrupted routes survive reauthentication and stale pages detect both role and user-ID changes. | Field semantics are inconsistent because `FormField.required` is visual and route-level failures lack a shared error boundary. Expired and replaced sessions now show distinct persistent warnings, focus the email field, and return only to a canonical same-origin path after login. |

## Teacher Workflow Map

| Workflow | UI ownership | API/domain/database ownership | Test evidence | Accessibility and error-state assessment |
| --- | --- | --- | --- | --- |
| Classroom list, create, order, archive | `TeacherClassroomsIndex` | teacher classroom routes; `classroom-order`, `server/classrooms`; `classrooms` | Component and API suites cover active/archive/order behavior. | Archive discovery is hidden in Organize mode. Permanent deletion bypasses verified recovery, and destructive/recovery actions lack lifecycle context. |
| Daily attendance and journals | `TeacherAttendanceTab` | logs, history, summary, attendance, and class-day routes; attendance/report/history modules; `entries`, `class_days`, `log_summaries` | Unit, API, component, attendance, and timezone suites exist. | Fetch failures can look normal; status changes need live announcements; the mobile table and history split need an explicit narrow-screen mode. |
| Classwork authoring and ordering | `TeacherClassroomView`, assignment/material/survey editors | assignment/material/survey routes; assignment and scheduling modules; `assignments`, `classwork_materials`, `surveys`; reorder RPCs | Component, modal, API, reorder, and domain suites are broad. | Error/empty separation is incomplete. The coordinator owns fetching, selection, mode, and rendering, which makes consistent focus and recovery behavior difficult. |
| Assignment submissions and grading | assignment workspace and `TeacherStudentWorkPanel` | document, grade, return, feedback, artifact, repo, and AI-run routes; assignment grade/return/AI modules; document/history/feedback/repo/AI tables and atomic RPCs | Focused component/API suites and atomic contract tests are strong. | Mobile density is high; grading/history comments need clear mode and focus transitions; AI progress pauses without page-driven ticks and lacks durable retry/status feedback. |
| Tests: authoring, access, attempts, grading | `TeacherTestsTab`, test editors and grading panes | test/question/document/result/access/AI/return routes; test domain modules; test/attempt/response/focus/draft tables and atomic RPCs | Extensive component, hook, API, architecture, E2E, and return-flow coverage exists. | One large coordinator owns authoring and grading. Mobile needs mode navigation; document tabs lack complete tab semantics; list failures can look empty. |
| Gradebook | `TeacherGradebookTab` | gradebook route and domain modules; derived assignment/test/enrollment data | Unit, API, server, validation, architecture, and component suites cover cold/retained recovery, stale-request isolation, and direct table keyboard behavior. | Desktop loading, empty, error, retry, refresh, sorting, selection, and detail behavior are covered. Mobile remains horizontal-data heavy and is deferred. |
| Roster | `TeacherRosterTab` | roster add/upload/edit/bulk-delete routes and atomic removal RPC; roster/enrollment/profile/user tables | Component, API, parser, removal, and RPC coverage includes cold and retained recovery, stale-request isolation, direct table keyboard behavior, alt-email edits, and removal confirmation. | Desktop table selection, confirmation, alt-email editing, error recovery, and focus behavior are covered. Mobile still hides email and alt-email fields without row detail. |
| Calendar, lesson plans, announcements | classroom calendar and announcement surfaces | lesson-plan, announcement, class-day, and read routes; lesson/announcement/read tables | Component/API coverage exists across the individual features. | Independent failures collapse to partial empty calendars; announcement time is not consistently Toronto-based; compact calendar controls need mobile target checks. |
| Syllabus/resources | teacher resources tab and `/actual` iframe | course-site and published-source modules; classroom site fields/resources plus course content | Published-source and resource behavior has focused tests, including loading, explicit successful-render readiness, HTTP failure timeout, retry, and unpublished states; the legacy editor is still separately tested. | The shared iframe preview owns a bounded workspace, external-open escape, delayed-load recovery, and ready-only keyboard focus. Teacher/student desktop/narrow and light/dark browser checks cover sizing, theme, scroll ownership, and keyboard traversal. The unmounted legacy editor/API representation remains a Phase 6 compatibility-led retirement decision. |
| Settings | classroom settings surface | classroom/site/calendar/join/blueprint routes and modules | Settings and related route/domain behavior have focused component/API coverage. | General, Access, Syllabus, Class Days, and Reuse are stable URL-backed sections using the shared keyboard-operable segmented control. Existing field, save, error, stale-classroom, and archived-read-only behavior is retained. Narrow-screen navigation scrolls without widening the page; broader mobile redesign remains deferred. |
| Legacy dashboard | `/teacher/dashboard` | teacher attendance/export plus teacher-owned student-history detail; classroom/roster/class-day/entry data | Component and API coverage proves authorization, loading/error/empty recovery, retry, stale-request isolation, modal semantics, and focus return. | Entry detail correctness and invalid commands are resolved. The shell still differs from classrooms, and responsive summary-first attendance remains deferred with broader mobile work. |
| Top-level teacher calendar | `/teacher/calendar` | teacher classroom/lesson-plan/calendar routes and classroom/class-day/lesson data | Calendar component/API behavior has focused coverage; evidence `43` and `44` adds a dedicated utility-route browser review. | The invalid active-classroom Delete command is removed. Mobile evidence still shows horizontal overflow; broader narrow-screen redesign remains deferred. |
| Blueprints | `/teacher/blueprints` | blueprint CRUD/import/export/instantiate/merge/AI routes; operation/package modules; blueprint tables and atomic RPCs | Server, API, package, migration, and focused component suites cover stable retry identity, cross-section draft preservation, guarded transitions, and saved-version actions. The classroom rollover browser drill remains incomplete. | Dirty sections are explicit and protected across saves, Blueprint changes, route actions, authority changes, imports, proposal application, exports, and classroom creation. Legacy tabs/shell semantics, planned-site verification, and end-to-end rollover evidence remain. |
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
| Syllabus and announcements | resource iframe and announcement section | published course-site/material/announcement routes; announcement/read tables | Published-source, material, and announcement coverage includes syllabus loading/retry/unpublished states and explicit announcement recovery/read behavior. | The syllabus preview is viewport-bounded, theme-verified, and keyboard traversable with an external-open escape. Announcement failures and Toronto timestamps are explicit. Legacy resource representation retirement remains separate. |
| Grades and profile | returned assignment/test feedback and join profile collection | assignment/test result data and `student_profiles` | Coverage lives in assignment feedback, test results, join, user-menu, and profile unit tests. | No aggregate gradebook or profile-edit route exists. Confirm product intent before adding scope; current fragmentation makes status and error behavior inconsistent. |
| Student attendance utility | `/student/history` (stable compatibility URL) | student classroom, entry, and class-day routes; shared attendance-domain row builder; `entries` and `class_days` | Focused domain/component coverage proves full class-day status construction, classroom switching/retry, keyboard log opening, shared-dialog focus return, and the existing URL contract; evidence `46` and `47` records the prior mobile/desktop surface. | Retained as the only cross-classroom full attendance summary: Today intentionally exposes only the latest submitted logs and cannot replace absent/pending history. The ambiguous nav label is now Attendance, the unmounted classroom history tab was removed, and the hand-built modal was replaced. Mobile density remains deferred with the broader mobile pass. |

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
3. Completed in PR #894: replace the dashboard student endpoint call with a teacher-owned contract and correct its tests.
4. Resolve blueprint package v2/v3 drift in runtime, docs, fixtures, and compatibility tests.
5. Completed in PR #890: remove invalid active-classroom Delete actions on the dashboard and top-level calendar.

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
9. Completed: add mobile and light/dark Playwright projects plus seeded CI coverage for representative teacher/student classroom and utility workflows.

Exit evidence: canonical primitive tests prove keyboard/focus/ARIA behavior; all semantic foreground/background pairs meet AA; representative classroom, teacher utility, and student utility routes use the governed page-state contracts; desktop/mobile and light/dark browser checks run in CI.

### Phase 3: Vertical Product Slices

Assignment progress:

- Save/submit integrity was completed in the Safety Wave with atomic persistence and stale-submit regression coverage.
- The first Phase 3 assignment slice gives teacher and student Classwork lists explicit governed loading, error, and successful-empty states. Retry invalidates the classroom list caches before reloading, and role/viewport/theme browser verification covers failure and recovery without changing the normal class-wide workflow.
- Accessible assignment save announcements and restore-dialog semantics were completed in #891. The visible save state is a polite atomic live region, and restore confirmation uses the shared modal-layer contract for focus containment, dismissal, background isolation, scroll locking, and focus return.
- Remaining assignment work is limited to the deferred mobile workspace modes and the separately owned Gradex status boundary.

Daily and attendance progress:

- Cold class-schedule, student-entry, teacher-attendance, and selected-student history reads now render explicit retryable failures instead of false non-class-day or empty states.
- Failed background schedule and student-entry refreshes preserve the last valid table, editor, and history snapshots with non-blocking retry warnings. Cross-classroom and cross-student stale response guards prevent another classroom's or student's log data from painting in the active workspace.
- Student Daily save status is a polite atomic live region and save failures are announced. Existing Toronto midnight, DST, quick-jump, stale-mounted-save, and API timing tests remain the timestamp evidence.
- Remaining Daily/Attendance work is limited to the deferred mobile history/table workspace modes.

Tests progress:

- Teacher and student Tests lists now distinguish loading, cold failure, successful empty, and failed refresh states. Cold failures offer an explicit retry instead of claiming that no tests exist.
- Failed refreshes retain the last valid list with a compact retry warning, while classroom-scoped snapshots and request guards prevent another classroom's tests from painting in the active view.
- Teacher controlled test URLs remain intact until a successful list snapshot proves that the selected test is invalid. Existing list-first teacher and student compositions are unchanged.
- The selected Tests workspace remains grading-first and preserves the class-wide student table. Test authoring is now an explicit visible `Edit Test` command with a named editor dialog, and authoring-only dialog/view composition lives in `TeacherTestAuthoringDialog` instead of expanding the grading coordinator.
- Standalone preview route tests now prove unauthenticated, non-teacher, non-owner, and classroom/test mismatch denials. Preview data is owned by `testId`, late requests cannot repaint another test, and opening or closing a document transfers focus predictably.
- Full-screen teacher preview framing was browser-verified in light/dark at desktop and the mobile breakpoint, including a mobile-dark opened text document with focus on Back and no horizontal overflow. A student-authenticated route check rendered only the generic authorization denial.
- Link snapshots now validate and pin public DNS addresses across manual redirects before fetching. Migration 105 atomically rechecks ownership, archive state, document identity, and URL under row locks before attaching a unique snapshot; it must be applied before deploying the updated sync route.
- Student flag controls now expose pressed state and keyboard activation, while student autosave and teacher authoring/grading save transitions use polite atomic live announcements. Focused regressions cover successful saves, failures, locked controls, storage restoration, and stale save completion.
- Remaining Tests work is limited to the deferred mobile navigation treatment.

Surveys progress:

- Student results now distinguish loading, success, and announced failure states, offer explicit retry recovery, and use native radio semantics for multiple-choice responses.
- Teacher results now use governed loading and cold-error states. Failed refreshes retain the last valid results with an announced retry warning, and request guards prevent another Survey's response from painting in the selected workspace.
- Component tests cover cold failure, retry recovery, retained-results refresh failure, successful refresh replacement, and stale Survey isolation. Teacher desktop/mobile and light/dark browser verification preserves the existing results-first workspace with no horizontal overflow.
- The Phase 3 Surveys slice is complete.

Announcements progress:

- Teacher and student Announcement tabs now distinguish loading, successful empty, loaded, and announced failure states with explicit Retry recovery.
- Classroom-scoped request guards prevent stale responses or errors from painting under another classroom. Student read acknowledgement failures remain visible and retryable instead of silently clearing notification state.
- Announcement creation, scheduling, and display timestamps now use `America/Toronto`; focused tests cover standard/daylight offsets, failure recovery, stale classroom isolation, and read retries.
- Teacher/student desktop/mobile browser verification passed in light/dark for loaded and cold-error states, plus the student read-error state.
- The Phase 3 Announcements slice is complete.

Calendar and lesson-plan progress:

- Teacher and student Calendar tabs now track lesson plans, assignments, announcements, and class days independently instead of converting failed reads into empty calendar data.
- Successful source snapshots remain visible during another source's failure or refresh. Each failed source has a named Retry action, and committed-classroom request generations reject stale responses and overlapping teacher assignment refreshes.
- Calendar term boundaries use date-only parsing, and initial/today navigation is explicitly Toronto-based so classroom dates do not shift at UTC boundaries.
- Focused tests cover partial and cold failures, source-specific recovery, retained refresh data, stale classroom isolation, and Toronto term labels. Teacher/student desktop light/dark loaded states and intercepted partial-error states passed Playwright review.
- The Phase 3 Calendar and lesson-plans slice is complete. Mobile Calendar redesign remains deferred with the broader mobile work.

Dashboard progress:

- The dashboard entry-detail path uses the teacher-owned student-history contract, and invalid active-classroom Delete commands are removed.
- Student logs now open immediately in the canonical dialog with explicit loading, successful-empty, ready, and retryable error states. Request generations fence close, classroom changes, and overlapping student requests so stale responses cannot reopen or replace the active detail.
- Focus containment, Escape/backdrop dismissal, background isolation, scroll locking, and opener focus return come from the shared modal-layer contract. Focused tests cover the entry states, retry, stale responses, and focus return.
- Teacher desktop/mobile and light/dark browser verification covers ready, loading, and error states without horizontal overflow. The student role is not authorized for this teacher utility route and redirects to its classroom surface.
- Remaining Dashboard work is limited to responsive summary-first attendance and utility-shell convergence, both deferred with the broader mobile and shell work.

Gradebook progress:

- Cold Gradebook failures are distinct from successful empty classrooms and expose an in-place Retry action. Successful retries move focus into the named student table.
- Failed refreshes preserve the last valid assessment matrix and selected-student context with a compact retry warning. Request generations and committed classroom identity prevent stale loads or assessment-weight saves from repainting another classroom.
- Existing direct table keyboard selection, row focus, Escape dismissal, sorting, resizing, bulk email selection, and selected-student detail coverage remains intact.
- Teacher desktop loaded light/dark, cold-error light/dark, retained-refresh, and narrow loaded/error browser verification has no viewport overflow. Remaining Gradebook work is limited to deferred mobile navigation/composition.

Roster progress:

- Cold roster failures are distinct from successful empty classrooms and expose an in-place Retry action. A failed refresh retains the last valid roster.
- Successful removals remain committed in the visible roster even when the follow-up refresh fails. Removal errors stay inside the confirmation dialog with a focused retry action.
- Direct keyboard selection and focus return are covered for the table. Alt email editing uses governed controls, descriptive labels, operation-scoped errors, row-revision conflicts, and stale-request fencing across students and classroom changes. Delayed add/upload completions cannot supersede the active classroom load or expose confirmation/error/close state in another classroom.
- Teacher desktop/mobile and light/dark browser verification covers ready, selected, editing, cold-error, removal-error, and alt-email-error states. The student role redirects away from the teacher-only roster.
- Remaining Roster work is limited to the deferred mobile row-detail experience for hidden primary and alt email fields.

Syllabus/resources progress:

- Teacher and student published syllabi share one viewport-bounded preview with a compact external-open action, named iframe, visible focus boundary, and ready-only tab stop.
- The successful syllabus page emits a validated same-origin, frame-specific readiness handshake after hydration. HTTP error documents cannot unlock or focus the iframe; a bounded timeout instead exposes Retry without presenting the failed document as empty.
- Desktop owns one viewport scroll region while the iframe owns syllabus document scrolling. Teacher/student desktop and narrow light/dark browser verification covers loaded and failed states, direct link-to-iframe keyboard order, focus, and horizontal overflow.
- The old rich-text resource sidebars are not mounted by the current product. Their API/data representation remains intact pending the caller, archive/package, and compatibility evidence required for a focused Phase 6 retirement.

1. Assignments: save/submit integrity, error states, mobile workspace modes, Gradex status boundary.
2. Tests: completed list errors, authoring/grading separation, and standalone preview authorization/framing; remaining accessible flags/save status and deferred mobile navigation.
3. Daily and attendance: explicit failures, mobile history/table modes, Toronto timestamp verification.
4. Dashboard: completed teacher-owned entry detail, governed recovery/dialog behavior, and removal of invalid classroom commands; responsive summary-first attendance remains deferred.
5. Roster: completed desktop keyboard behavior, bulk-action recovery, and alt-email access; mobile row detail remains deferred.
6. Surveys: completed explicit student/teacher results recovery, retained refresh data, stale-response guards, and native choice semantics.
7. Calendar and lesson plans: completed independent source recovery, retained snapshots, stale-response guards, compact error controls, and Toronto date behavior; mobile redesign remains deferred.
8. Announcements: completed explicit failure/read states, stale-classroom guards, Retry recovery, and Toronto timestamp formatting.
9. Gradebook: completed explicit recovery, retained snapshots, stale-request isolation, selected-student detail, and direct table keyboard tests; narrow-screen navigation remains deferred.
10. Syllabus/resources: completed shared iframe sizing, scroll ownership, theme, keyboard traversal, loading, and Retry behavior; defer the unmounted legacy resource-path retirement to Phase 6 compatibility review.
11. Authentication and history utility routes: session-expiry and account-replacement recovery are complete with distinct announced warnings, deterministic email focus, user-ID/role validation, and canonical same-origin return-path preservation. `/student/history` remains the stable URL for the cross-classroom Attendance utility because Today does not preserve its full class-day summary; its dead duplicate tab and duplicated attendance builder are removed, and log details use governed keyboard/dialog behavior. Mobile density remains deferred.
12. Settings and student grades/profile: completed. The mixed teacher surface is organized into stable General, Access, Syllabus, Class Days, and Reuse sections with existing field/error behavior retained. Aggregate student grades and standalone profile editing are explicitly declined until their disclosure and data-authority contracts are defined.

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

Blueprint rollover progress:

- Classroom capture and blueprint instantiation now retain one UUID idempotency key while an unchanged client request is retried. Changing the semantic request produces a new key, and successful completion clears it.
- Both teacher package-import entry points now retain one UUID while normalized JSON or exact TAR bytes are retried, replace it when package content changes, clear it after success or cancellation, and suppress concurrent submissions.
- Blueprint-created classrooms pause at a teacher review handoff before the create dialog closes. The handoff states that assignments and tests are unpublished, requires due-date/release review, lists lesson templates that did not fit the selected classroom calendar, and opens the new classroom's Assignments tab from every entry point.
- The teacher-only refinement follows the existing create-classroom dialog pattern. Desktop/mobile and light/dark browser verification covers the overflow state, confirms the browser sends a UUID idempotency key, and finds no horizontal overflow; focused component tests cover successful handoff and same-key retries for both capture and instantiation.
- The Blueprint editor now tracks saved baselines per editable section. Saving one section preserves unsaved work elsewhere, accepted server values refresh only the saved section, state-replacing transitions require explicit confirmation, saved-version actions disclose excluded edits, and in-flight replacement operations lock editor writes.
- Remaining Blueprint work includes a real classroom-to-blueprint-to-new-classroom browser drill, package compatibility evidence, planned-site verification, and broader preview/version workflow productization.

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
