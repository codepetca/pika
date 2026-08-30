# Pika Session Log

Rolling recent session log for AI/human handoffs. Keep this file small; full historical session history lives in `.ai/JOURNAL-ARCHIVE.md`.

**Rules:**
- Append one concise entry for meaningful work, then immediately run `node scripts/trim-session-log.mjs` in the same change.
- Start each entry heading with a valid ISO date (`## YYYY-MM-DD ...`) so retention can identify the latest entries.
- CI allows at most 60 entries; the trim step compacts to the latest 40 entries by default so there is headroom for future appends.
- Use `node scripts/trim-session-log.mjs --check` to reject empty entries and verify the log is chronological and within the 60-entry cap.
- Keep enough recent entries for weekly automations to inspect roughly the last week of work.
- The trim step appends removed entries to `.ai/JOURNAL-ARCHIVE.md`, so trimming never loses history.
- Use `.ai/JOURNAL-ARCHIVE.md` only for historical investigation.

## 2026-08-31 — Discuss simpler assignment attachments

- Audited teacher requirement fields, validation modes, image formats and student submission flow for the user's proposed single-label rows and missing-attachment warning. Basic/Reachable/Expected site are Link validation settings; supported images are PNG/JPEG/GIF/WebP, 10 MB maximum.
- No current Assignment submit confirmation exists. Missing required items block Submit in the client, submit API and database guard, so the proposed confirmation requires coordinated behavior changes. Recorded proposed UI, pending URL-save handling, legacy-policy and migration-rollout considerations in submission-area-audit.md. Discussion only; no product behavior or database changes.

## 2026-08-31 — Checkpoint UI standardization before attachment redesign

- User approved a local checkpoint and a separate task for simplifying assignment attachments. This checkpoint contains the shared creation/action icons, centered action bars, attendance/status catalog, smaller attendance circles, consistent Classwork headings/Material creation bar, centered Assignment save status, real Pattern Lab creation examples, icon-only Preview and aligned success alerts. Attachment behavior remains unchanged.
- Updated obsolete gallery assertions and direct keyboard/accessibility coverage for attendance controls, the visible modal heading/initial title focus, and both production-owner creation examples. Pika audit passes; focused checks pass 137 files / 1,343 tests plus architecture, UI/design policy, TypeScript and lint.
- Reviewed and refreshed five Darwin and five Linux teacher screenshot references; student references remain unchanged. Full macOS Pattern Lab suite: 37 passed / 3 intentional skips. Linux: 36 passed / 3 skips plus one Chromium launch SIGSEGV before any assertion; the affected case passed twice in isolation. All 37 browser contracts therefore verified on each platform. Linux used Playwright 1.58.0 Noble with fonts-dejavu-core, matching the existing student references; no project dependency changes.
- Visual matrix covers teacher/student, desktop/mobile, light/dark and relevant interaction/focus states. Evidence and final check logs saved under the session visualization folder `checkpoint-verification`. Earlier pending-baseline notes are superseded by this verification.
- Checkpoint stays local on codex/standardize-page-action-icons; no push, PR, merge, deployment or database change. Separate attachment task creation is queued; its prompt carries the agreed design, compatibility and database-rollout constraints, and instructs it to use its own worktree.

## 2026-08-31 — Attendance current-main integration and bounded queue recovery candidate

User confirmed the retained Bara organization is the intended Codepet production workspace and that its one staff and three student memberships must be preserved. This resolves ownership only; no deployment, migration, mapping repair, queue mutation or production canary was authorized or performed. Integrated current main `983f9de4` into `codex/daily-checkbox-investigation`, preserving both sides of the sole shared archive-history conflict. Added proposed migration 142: a service-role-only, idempotent recovery that requires the exact teacher, active entitlement epoch and complete unresolved roster/schedule row set; rejects changed scope and live leases; rotates the entitlement epoch and supersedes the exact old rows atomically; and writes an immutable audit. Added a dry-run-first operator command whose execution gate is bound to the exact target, operation, teacher, epoch, row IDs, actor and reason; added static migration, authorization, launcher and rollback-scoped database contract coverage plus generated types and runbook guidance. Local targeted tests and TypeScript pass. The integrated 14-check teacher/student desktop/mobile light/dark browser matrix passes and representative screenshots were visually reviewed, including 2:00–3:00 PM on Aug 28 and the student notice. One unrelated CourseBlueprint purge-dialog timing assertion failed during an earlier focused run and remains to be rechecked in the final candidate run. User approved exactly one additional final fixed-SHA review after complete verification; no later reviewer is authorized. Production remains unchanged. Next: finish canonical checks, commit/push the draft candidate, run the one approved review and exact-head CI, then prepare fresh backup and exact production approval requests.

## 2026-08-31 — Close attendance recovery ordering blocker

The one owner-approved final fixed-SHA reviewer found one P1 operational sequencing gap and otherwise rated the SQL concurrency/idempotency/privileges, tenant boundaries, authorization binding, Bara identity preservation, UI async ownership and coverage clean. The gap was that restoring the Bara tenant mapping could make Pika's 10 obsolete rows claimable before migration 142 superseded them. Corrected both Pika and Bara runbooks: the default mandatory order is exact old-epoch supersession plus empty/non-claimable queue proof before Bara restore; the only alternate requires a separately approved verified Pika worker pause beginning before restore and spanning supersession/proof, with no implicit unrelated-classroom pause. Fresh snapshot delivery remains separately approved. Reviewer ran 65 focused Pika and 15 Bara tests. These documentation corrections are post-review changes; no additional reviewer is authorized without a new owner decision. No production mutation occurred.

## 2026-08-31 — Exact-head CI generated-type ordering correction

After the clean owner-approved targeted runbook re-review, Pika PR #1134 was marked ready and exact-head CI run `33449330779` started on `d0e6dc7d`. Ephemeral migration replay succeeded, then the database lane stopped because the migration-142 table and RPC definitions in `database.generated.ts` were manually placed before Supabase's generated alphabetical positions. The PR was immediately returned to draft. The coverage and browser lanes were canceled by that draft transition, not failed assertions; their partial logs show the attendance tests and 28 browser checks reached before cancellation were passing. Applied the exact inverse of CI's generated diff: unchanged 53-line table/RPC blocks moved only to the generated positions. Seven focused recovery/authorization/launcher tests and TypeScript pass; diff check confirms a pure 53-line move. No migration was applied locally, no CI retry has been requested, and production remains unchanged. This mechanical generated-artifact correction does not change the reviewed SQL or runtime behavior. Next: canonical focused checks, commit/push, then follow the stable-head review/CI gate without treating canceled lanes as failures.

## 2026-08-31 — Stabilize TestDetailPanel autosave timing coverage

Fresh exact-head CI run `33449809343` on `f72cc6cd` passed the complete database-contract lane, including migration replay/generated types, and the complete browser matrix. Its Test & Build job failed twice at the same TestDetailPanel assertion while 5,474 tests passed: the test typed a long prompt in real time and assumed the production three-second autosave could not elapse before asserting zero PATCH calls. Under hosted full-coverage contention, the typing crossed that valid debounce boundary. A first test-only correction at `b709cbe3` stretched the debounce with the file's existing helper, but fresh run `33451182430` proved that remained wall-clock-dependent by producing the same PATCH; the PR was returned to draft and remaining lanes canceled. Replaced the long character-by-character input with a single paste after select-all, preserving the real editor change/blur behavior while removing elapsed typing time from the assertion. No production source or behavior changed. Local exact-file tests pass 43/43 and full locked-dependency coverage passes; the corrected test completes in under one second during coverage. PR #1134 remains draft pending final focused checks and fresh exact-head CI. No production mutation occurred.

## 2026-08-31 — Move markdown preference to Advanced settings

- Worktree `codex/advanced-settings-tab`: added a URL-backed Advanced teacher Settings section and moved the existing storage-backed Show markdown switch out of General without changing preference behavior.
- Reused the current Settings `SegmentedControl`, panel, and switch row. The settings scroller now brings the selected section fully into view so the final Advanced option is not clipped on direct mobile URLs. No shared component contract, Pattern Lab example, API, schema, permission, or dependency changed; risk profile none.
- Verification: 32 Settings tests and four shared selector keyboard tests pass. Focused checks pass 12 files / 154 tests plus architecture, UI/design policy, TypeScript, and lint. Playwright screenshots were inspected for teacher desktop/mobile in light/dark, selected Advanced, focus, and toggle on/off. Student capture confirmed the teacher-only section is inaccessible and the normal student surface is unchanged.
- User authorized the draft PR, independent review, CI, and merge to `main`; production promotion, deployment, and database operations remain excluded. Low-risk review plan: one GPT-5.6 Terra/medium fixed-commit review. Ledger starts at zero launches, zero remediation waves, and zero fix batches; record final evidence on the PR without post-review commits.

## 2026-08-31 — Repair attendance epoch restaging and Daily availability controls

- Confirmed the production failure mode: migration 142 correctly superseded stale roster/schedule outbox rows, but preparation reused the same source revisions and therefore the same globally unique idempotency keys. Bara correctly rejects a second snapshot at the same revision, so the repair belongs in Pika rather than Bara.
- Added migration 145 so the private roster and schedule source documents include the teacher entitlement revision. A recovery epoch now changes both source tokens, advances both snapshot revisions, and generates fresh keys that Bara accepts. Added a rollback-only database lifecycle proving revision-1 stage, exact supersession, revision-2 restage, fresh pending rows, and idempotent retry.
- Daily now renders its selection column and Student actions menu only when the selected session is actually editable (`open` or `closed`). Scheduled, unconfigured, disabled, archived, and other non-editable views retain check-in/status evidence without dead checkboxes. The governed brief and composite-widget checklist are recorded in `daily-attendance-availability.md`.
- Verification after the first independent-review remediation: 51 focused attendance tests pass; the canonical focused gate passes 13 files / 163 tests plus architecture, UI/design policy, TypeScript, and lint; Pika audit passes. Teacher Playwright verification passes and screenshots were inspected for desktop/mobile, light/dark, open/closed/scheduled/unconfigured. The recovery runbook now makes migration 145 and newer revision/key proof explicit preconditions. Student UI is unchanged. Migration 145 has not been applied to any database; ephemeral replay remains a PR-CI gate and production application requires fresh exact-target authorization.
- Final cumulative review found no code, SQL, privilege, rollback, or UI blocker. A second documentation-only remediation aligned the completion audit with the control runbook: migrations 142 and 145 are a coupled recovery prerequisite, while migration application, supersession, fresh preparation/staging, tenant-link repair, delivery, and canary remain separate authorization gates. Added a documentation contract preventing a return to 142-only guidance. The cumulative focused gate passes 14 files / 167 tests plus architecture, UI/design policy, TypeScript, and lint.
- Exact-head CI replayed every migration successfully, then exposed an untyped `smallint` argument in the new rollback-only database lifecycle fixture before its recovery assertions could run. The PR returned to draft; the browser and Test & Build lanes were canceled by that draft transition rather than failed assertions. Added explicit UUID, time, smallint, bigint, and timestamptz casts matching the existing timing-policy RPC signature. This is remediation batch 3/3; 167 focused tests and every static gate pass locally. Reviewer launches remain at the default ceiling of 5/5, so a fresh exact-head review and CI retry require the owner checkpoint before merge.
- After the owner extended the bounded review, current-main rebase preserved the product patch. Exact-head CI then exposed one remaining stale fixture field: `class_days.course_code`, removed since migration 006. Owner authorized remediation batch 4, final review launch 8/8, and source-epoch migration replay only in a new disposable local Supabase target. The disposable `pika-attendance-144-ci:56322` project replayed the then-current migrations 001–144 and the complete Bara attendance database harness passed, then was stopped and moved to Trash; the existing local Pika stack remained healthy and untouched. The final reviewer found that the temporary configurable-target support could fall back after a misspelled explicit container, so owner-directed remediation batch 5 removes that support entirely and restores the original strict `pika:54322` guard while keeping the valid current-schema fixture correction. After current main added its own migration 144, the attendance source-epoch migration was resequenced to 145. The refreshed focused gate passes 14 files / 168 tests plus every static gate; current-main teacher Daily verification passes desktop/mobile in light/dark and open/closed/scheduled/unconfigured states. Production remains unchanged.

## 2026-08-31 Test corrections after first Start
- Added a reviewable migration and application policy: after first student Start only question prompt wording/instructions remain editable; structure, choices, grading, identities and response settings remain frozen.
- Start now persists through the atomic attempt transaction and returns its post-lock student snapshot; title/documents/result visibility stay on existing paths. Added focused UI/API/policy/migration coverage and a dev preview on port 3006.
- Static/focused checks and visual matrix pass. Migration 143 is not applied; local database replay, generated types and concurrency verification await exact one-time migration approval. PR/review pending.
- Draft PR #1140 received independent architecture and security review. The first remediation batch keeps the Test detail visible with a specific retryable Start error, corrects the pre-Start preview, and makes pre/post-142 Classroom archives restore locked Tests safely while preserving the boundary. The archive database harness now covers current locked, legacy started and legacy untouched Tests plus rejection outside maintenance mode.
- Post-remediation focused checks pass: 65 files / 914 tests plus architecture, UI/design policy, TypeScript and lint. Corrected desktop/mobile and light/dark screenshots were inspected. Migration 143 remains unapplied pending exact local approval, so live database replay/concurrency and generated types remain outstanding.
- User approved the Test editing migration for local Supabase and checks; it was numbered 142 before the branch was resequenced. The first transactional apply exposed an invalid historical timestamp column and rolled back; corrected the backfill/restore timestamp sources, then applied the Test editing migration successfully under its pre-resequence version 142. Generated database types match the local schema.
- Added a current archive-v2 Test-policy round trip covering a preserved current lock, reconstructed legacy-started lock, untouched legacy Test, exact restored rows and ordinary structural-write rejection. Updated the atomic Test harness for permanent locks and multiple local Supabase projects. Both live database harnesses pass.
- Ready-PR CI exposed an outdated atomic-grading fixture assumption, so the PR returned to draft before correction. Grading fixtures now persist the same Start boundary as production RPCs; wording/grading ordering expects the allowed prompt correction while grading fields remain frozen. The atomic grading harness passes locally, and the Test-policy archive harness is now an explicit database CI step.
- Rebasing PR #1140 onto `ad13b3d7` exposed the newly merged Attendance migration 142. Resequenced the Test editing migration to 143 and updated its runtime, test and rollout references. Reconciled the already-applied local Test schema to version 143 without resetting local data; a dry run then proposed only Attendance 142, which applied successfully. The local ledger is aligned through 143, generated types match, and the Attendance, Test editing, atomic submit and atomic grading database harnesses pass. No hosted migration or deployment occurred.
- Ready-PR CI passed Test & Build but exposed a remaining pre-policy fixture in the Blueprint question-identity database harness, so the PR returned to draft. Directly inserted attempt/response fixtures now set the durable Test lock, wording-only corrections are asserted to succeed without changing answers, points or responses, and grading mutations remain rejected. The exact Blueprint database harness, 25 targeted static tests, and the focused gate (67 files / 934 tests plus policies, TypeScript and lint) pass locally.
- Follow-up: Close should confirm discarding unapplied Markdown.

## 2026-08-31 — Refine the exam document workspace

- Replaced the duplicated teacher Preview and student live-exam document compositions with a shared `ExamDocumentWorkspace`. The persistent pane header now transitions from Documents to Back plus the active document title without a jarring horizontal morph; list/viewer layers and the question form stay mounted.
- Added an accessible desktop split-pane resizer. Documents begin at 30% in the list, open at or remember 30–50%, and questions remain at least 50%. Pointer drag, Arrow keys, Home/End, double-click reset, visible focus, and semantic separator values are covered; compact screens retain the stacked layout without a divider.
- Focused verification passes 60 component tests and the repository gate passes 15 files / 184 tests plus architecture, UI/design policy, TypeScript and lint. Pika audit passes. Inspected actual teacher Preview and student attempt at desktop/mobile and light/dark; a compact document-body collapse found during verification was corrected. A live unsaved answer remained mounted while opening docs. Temporary local visual-only records were deleted; no existing data changed.
- Draft PR #1145 review found one non-blocking P2: inactive eager iframes could remain in the screen-reader tree. They now retain eager mounting while receiving inactive `tabIndex` and `aria-hidden` isolation; two-frame coverage and the full 184-test focused gate pass after the fix. Final cumulative review and exact-head CI remain.

## 2026-08-31 — Preview simpler Assignment attachments

- In worktree `codex/assignment-attachments-redesign`, Assignment creation now uses a compact 52px single-line Submission Requirement row at every width: 44px drag target, type icon, editable label and 44px trash target. Its tooltip-backed 44px `+` button opens the Link, Repo and Image menu. Removed visible Required, helper-text, image-limit and Link-check rows while keeping image limits as accessible label help and preserving existing hidden values during edits. Teacher work review continues to call submitted artifacts Attachments and shows missing legacy optional rows.
- Assignment Title and Instructions labels are now visually hidden and their reserved rows collapse; empty fields show `Title` and `Instructions` placeholders while retaining associated accessible labels and required semantics. Removed the student-facing instructions hint and tightened the Assignment-only inset between the modal heading and title field. Assignment and Daily now share one zero-gap date/subtitle button that reserves the subtitle line for constant height when relative context is absent. Other creation forms retain their existing visible labels and spacing.
- Student Turn in treats every configured attachment as expected, flushes pending link edits before submit, and uses one shared `Submit without attachments?` confirmation listing all missing labels. Present invalid/inaccessible attachments and save failures still block. The submit API requires explicit `allow_missing_attachments`; empty work is allowed only through that acknowledged missing-attachment path.
- Prepared migration `144_allow_acknowledged_missing_assignment_attachments.sql` so acknowledged missing attachments are accepted only inside the locked submission RPC while present invalid/inaccessible artifacts remain blocked. It was not applied to any shared database.
- Draft-PR review hardened that boundary: the API requires an exact, duplicate-free match and passes only its canonical missing-requirement IDs to both standard and Pal submission RPCs; the shared locked validator independently re-derives the missing set and requires exact cardinality and membership. Extra IDs, duplicates, a concurrently added requirement, or a deleted artifact are not covered by an earlier confirmation. Legacy call shapes remain strict, ordinary submissions safely fall back during migration-first rollout, and acknowledged missing submissions return a retryable migration-required response until migration 144 is present. Failed or in-flight image uploads block confirmation and submission until retry or an explicit continue-without action.
- Rollback-scoped atomic checks and disposable-database concurrency checks pass, including strict/scoped acknowledgement, invalid, Pal, acknowledged requirement-add and acknowledged artifact-delete cases. Remediation tests pass 89/89; the focused gate passes 186 files / 1,856 tests plus architecture, UI/design policy, TypeScript and lint. The eight desktop/mobile × light/dark Pattern Lab contracts pass and representative captures were inspected. Migration 144 remains unapplied to shared databases.
- Pattern Lab has API-free teacher/student examples. Desktop/mobile × light/dark teacher rows, populated/empty label states, the shared fixed-height relative-date subtitle, the open requirement menu, student checklist and confirmation all passed and were inspected; geometry caps the three-row card at 220px and checks same-row centering. Evidence is under session artifacts `assignment-attachments`. Final focused checks pass 185 files / 1,837 tests plus architecture, UI/design policy, TypeScript and lint. Preview remains on localhost:3007; no commit, PR, merge or deployment yet.

## 2026-08-31 — Remove Daily corner clipping artifact

- Removed the redundant radius from Daily's invisible standalone workspace frame while preserving the table, warning-card, and summary-card radii. This prevents nested anti-aliased clipping from reading as a translucent page-colour overlay at the top corners.
- Added focused ownership coverage. The Daily component suite passes 37/37; the repository focused gate passes 12 files / 159 tests plus architecture, UI/design policy, TypeScript, and lint.
- Playwright screenshots were inspected for the plain table and warning-first composition at teacher desktop/mobile in light/dark. The student mobile capture confirmed no regression on the teacher-only route. Local only on `codex/fix-daily-table-corners`; no PR or publish action taken.

## 2026-08-31 Pattern Lab remaining classroom page mockups
- Added experimental Gradebook, Calendar, Announcements, and Roster compositions using production owners and local fixtures only.
- Verified teacher desktop/mobile light/dark, populated/loading/empty/error, sorting, selection, menus, focus return, student exclusion, and no page overflow; tests and UI/design policy passed.
- Independent review found missing inactive tabpanel targets, inert retry/prototype commands, and insufficient durable coverage. Fixed all findings in one batch, added explicit local-only feedback and a reusable 35-check browser scenario; focused checks pass 13 files / 101 tests.

## 2026-08-31 Persistent Pattern Lab navigation
- Replaced the one-time horizontal section strip with a sticky Find a pattern selector and desktop quick links. Added direct destinations for Page actions, status colors, creation dialogs, student tests, history preview, and history graphs while preserving bookmarkable hashes.
- Reused the shared Select and existing section anchors; no production route or shared component changed. Added reduced-motion-aware jumps and scroll offsets that keep headings below the persistent navigator.
- Retained the compact overview links in the opening header and added the granular finder as the persistent navigation layer. The legacy tall contracts screenshot temporarily renders the finder statically so screenshot stitching cannot composite it into unrelated component baselines; the dedicated navigator verifier still exercises real sticky behavior.
- Nine focused gallery tests, eight affected baseline contracts, UI/design policy, TypeScript, and a 40-check browser scenario pass. Independent review identified the nested status-color anchor's old scroll offset; one remediation batch fixed it and added a browser assertion that the heading clears the sticky navigator. Visually inspected desktop light and mobile dark deep-link captures; the navigator remains visible and neither layout overflows.

## 2026-08-31 — Expand Pattern Lab classroom page patterns

- Extended the teacher-only experimental Page mockups with deterministic Settings and Classwork/Tests workspace compositions. Settings covers section navigation, inline save state, access safeguards, feature switches, class days, course reuse, and Advanced markdown preference. Workspaces cover summary lists, selected-item Overview/Students modes, Markdown actions, student selection, and a keyboard-resizable work inspector. All examples use local fixtures and make no API, database, permission, or production-route changes.
- Reused the production Settings controls and teacher work-surface owners; no new universal page component was introduced. Added direct Find a pattern destinations for all six classroom mockups so hidden Settings or Workspaces panels activate before scrolling.
- Verification passes 13 focused test files / 105 tests plus architecture, UI policy, design policy, TypeScript, and lint. Targeted semantic tests cover the composite interactions. The durable browser scenario passes 65 checks across teacher desktop/mobile, light/dark, all six tabs, direct navigation, a full September–January Calendar Term selection, Settings selection/confirmation, workspace selection/inspector/Markdown actions, student exclusion, and page overflow. Representative screenshots were visually reviewed. Experimental adoption still requires user review; PR remains unmerged.

## 2026-08-31 — Stabilize invalid Test Markdown coverage

- Exact-head CI for the fixture-only Pattern Lab PR passed 5,510 tests and failed one unrelated TestDetailPanel timing assertion: the invalid-Markdown test assumed no background autosave could occur anywhere before its final assertion. It now compares PATCH count immediately before and after the synchronous invalid Apply action, preserving the actual contract that invalid Markdown cannot issue a save while removing dependence on hosted wall-clock contention. No production source or behavior changed.

## 2026-08-31 — Add the Classrooms list to Pattern Lab

- Extended the experimental teacher Page mockups with the main Classrooms list. Its borderless bottom three-dot menu offers New Classroom, Edit classrooms, and one contextual Show Archived/Show Active toggle; edit and archived states expose a visible Back to classrooms control, and both that control and Escape restore the active non-editing list. The production Classrooms route remains unchanged.
- Added a direct Find a pattern destination plus semantic and durable browser coverage. Visual verification covers desktop/mobile, light/dark, menu-open, editing, and archived states. The focused gate passes 14 files / 149 tests plus architecture, UI policy, design policy, TypeScript, and lint.
- Independent review found that the first Escape listener also reacted while the mounted Classrooms panel was hidden. The listener now exists only while Classrooms is active, and a semantic regression test proves Escape in another mockup preserves the Classrooms edit state.

## 2026-08-31 — Define and visualize minimal student Grades

- Approved product contract: a classroom-level `Show grades to students` control defaults off. When enabled, students see one current grade calculated only from returned, fully graded, included work plus a returned-work list; excluded returned work is labelled `Not counted`. When disabled, aggregate Grades navigation is hidden while returned feedback remains in Classwork and Tests. Reporting, trends, rank, projections, category analytics, attendance and per-assessment publication controls remain out of scope.
- Added the product guidance and an experimental paired teacher/student Pattern Lab reference. Extracted the existing Settings switch row as a shared owner and preserved current Teacher Settings behavior while ensuring a 44px target. No student API, schema, persistence, permission or production Grades page was added.
- Verification after integrating current main: focused gate passes 18 test files / 185 tests plus architecture, UI/design policy, TypeScript and lint. Full Pattern Lab browser suite passes 49 checks with three intentional skips across teacher/student, desktop/mobile and light/dark. Published, hidden and feedback-link focus screenshots were inspected; keyboard behavior, 44px targets and no horizontal overflow pass. Pika audit passes; composite-widget checklist reviewed with keyboard and semantic state covered and no remaining manual accessibility follow-up.
- Risk profile: low, localized non-functional Pattern Lab UI and documentation. Review plan: one GPT-5.6 Terra/medium fixed-commit review under the default budget (zero launches, waves and fix batches at start). Production implementation remains a separate future change requiring human review of the experimental reference.
- The first completed fixed-commit review found one blocking contract mismatch: returned rows were static despite the approved feedback-link requirement. Remediation batch one makes every fixture row an accessible Classwork/Test link and adds component/browser coverage. Targeted re-review and a cumulative integration review found the blocker resolved with no new findings.
- Exact-head CI run `33467038586` failed one unrelated `TestDetailPanel` timing assertion after 5,516 tests passed; the unchanged 43-test file passed locally under coverage. The PR returned to draft and the remaining browser/database lanes were canceled. Current main then advanced through assignment-attachment work, so the branch integrated it while preserving both Pattern Lab concepts. One final integration review and fresh exact-head CI remain; no merge is authorized.

## 2026-09-01 — Subtle saved attendance-hours action

Updated the teacher Daily attendance-hours action so configured hours reuse the neutral PageActionBar background unless the current attendance session is confirmed open, when the existing success-green state remains. Added component coverage for confirmed-open, scheduled, and stale-open states. Focused tests, lint, UI/design policy checks, and teacher/student desktop/mobile visual verification passed in light and dark themes; no API, schema, attendance data, or student UI behavior changed. Draft-first PR review follows; merge is not yet authorized.

## 2026-09-01 — Record AI PR lifecycle evidence

- Added `pnpm record:ai-pr-lifecycle`, an append-only local recorder for AI PR stages, attributable active work/token metrics, CI queue/run timing, correction/sync counts, and final quality. It keeps unavailable fields unknown and never records prompts, source content, secrets, identities, or environment values.
- Updated the canonical development workflow plus Codex and Claude PR prompts so agents record start, draft, review, remediation, CI, merge, and summary evidence automatically. No application, schema, CI-policy, dependency, or production behavior changed.
- Verification: recorder and guidance tests (47), focused checks (89), architecture/UI/design policy, TypeScript, lint, and Pika audit passed. Model recommendation: GPT-5.6 Terra — bounded local tooling and workflow-contract change.
- Independent review corrections: added recorder tests to the canonical PR Gate workflow and renamed the post-PR timestamp to `trackingStartedAt`, so it cannot be mistaken for active development time.

## 2026-09-01 — Cache immutable CI setup inputs

- Added lockfile-keyed pnpm-store caches to the database and browser CI lanes plus a lockfile-keyed Playwright browser cache to the browser lane. Cache hit labels and setup evidence appear in each job summary for before/after comparison.
- Preserved fresh safety state: every run installs from the lockfile, verifies Chromium system dependencies, and starts a new ephemeral Supabase stack with complete migration replay. No classifier, required gate, browser spec, artifact, production, or dependency behavior changed.
- Verification pending final draft lifecycle. Model recommendation: GPT-5.6 Terra — bounded CI workflow and evidence-contract change.
- Independent review correction: distinguish exact cache-key hits from useful pnpm prefix restores, and run the normal Chromium installer on every run so cached downloads do not weaken browser setup integrity.

## 2026-09-01 — Align classroom feature icons

- Replaced the classroom Tests icon with Lucide `SquarePen`, changed Course Guide to `Compass`, and aligned student Today with teacher Daily on `ClipboardCheck`, eliminating the legacy `PenSquare` alias.
- Centralized teacher/student classroom navigation metadata so Pattern Lab renders the exact production feature icons, Lucide names, and role availability without a second mapping.
- Focused checks pass 21 files / 220 tests plus architecture, UI/design policy, TypeScript, and lint. Pattern Lab desktop/mobile light/dark contracts were updated and visually reviewed; the local gallery remains open on port 3001 for user review.
- Ready-PR CI exposed that only the Darwin Pattern Lab baselines had been refreshed. Replaced all four Linux contract baselines with CI's stable captures (identical across three attempts), visually inspected representative desktop-light and mobile-dark renders, and reran the focused gate successfully.

## 2026-09-01 — Default teacher Daily to today

- Diagnosed the fresh-mount initializer: Daily deliberately chose the most recent class day before Toronto today, falling back to yesterday, so every browser reload reset to a previous date.
- Fresh Daily mounts now initialize to Toronto today. Explicit previous/next navigation remains mounted state and is not overwritten by rerenders, focus refreshes, or Toronto date rollover; a true remount returns to today.
- Daily component coverage passes 42/42. The focused gate passes 13 files / 170 tests plus architecture, UI/design policy, TypeScript, and lint. Ten deterministic browser contracts pass across teacher desktop/mobile and light/dark, including previous-day navigation and the existing Attendance states; screenshots were inspected with no visual drift. Student is not affected.
- Draft review identified a rollover-coverage gap; component and browser contracts now advance Toronto today, preserve the chosen prior date through focus, and prove a reload selects the new today. The corrected cumulative diff reviewed clean. PR #1154 was rebased after #1153 advanced `main`; exact-head review and CI repeat on the synchronized SHA.

## 2026-09-01 — Hide unavailable Daily log summaries

- The teacher Daily summary card now stays hidden while the summary read is loading and whenever no generated summary is ready (`pending`, `no_entries`, `unavailable`, or error). Generated summaries retain the existing expanded/collapsible card and resize behavior.
- Added availability signaling and focused component coverage for ready versus unavailable summaries. Composite-widget checklist reviewed: keyboard behavior remains covered, semantic hidden state is tested, and no manual follow-up remains.
- Verification: 45 focused component tests pass; the repository focused gate passes 14 files / 173 tests plus architecture, UI/design policy, TypeScript, and lint; Pika audit passes. Playwright screenshots were inspected for teacher desktop/mobile, light/dark, generated and pending states. Student navigation is unchanged and was checked on mobile. Risk profile none. Model recommendation: GPT-5.6 Terra — localized UI state and regression-test change.

## 2026-09-01 — Align student Daily label

- Renamed the student classroom navigation label from `Today` to `Daily` while preserving the internal `today` route identifier, notification behavior, and shared `ClipboardCheck` icon.
- Pattern Lab continues to consume the production catalog directly. Teacher/student desktop/mobile light/dark verification passed, including open mobile navigation and active-page semantics; Darwin baselines were regenerated and the stable Linux baselines were updated only at the student label pixels, then reviewed.

## 2026-09-01 — Refine student Today mobile order

- Moved the mobile Today/Last class lesson-plan panel directly after the student daily-plan editor and before Past logs while preserving the desktop split inspector.
- Reduced the mobile editor minimum from 200px to 100px; desktop remains 200px. Browser measurement confirmed the empty editor is 100px and expands to 168px for longer content without internal overflow.
- Focused checks pass 13 files / 150 tests plus architecture, UI/design policy, TypeScript, lint, and Pika audit. Student mobile light/dark and expanded-entry states plus the unchanged student desktop split were visually reviewed. Composite checklist reviewed: keyboard and semantic behavior are unchanged; focused role/order coverage passes; no manual follow-up remains.
- Independent review found that the relocated mobile plan disappeared during an initial daily-log or schedule failure. The blocking-state composition now keeps Today/Last class below the retry state; focused failure coverage and a dark mobile intercepted-error capture confirm the plan remains available.
- Follow-up copy refinement renames the editor heading to “Daily Log” and replaces the generic empty-state copy with “What is your plan today?”. Focused tests pass, and student mobile light/dark plus desktop dark were visually checked in empty and typed states; the placeholder clears on input and the test entry was restored to empty.
- Follow-up review found the visible title did not programmatically label the production rich-text editor because the test mock derived its accessible name from the placeholder. “Daily Log” is now an `h2` linked with `aria-labelledby`; the mock forwards the real accessibility contract, and a browser accessibility snapshot confirms both the heading and textbox are named “Daily Log”.
- Renamed the student classroom navigation label from “Today” to “Daily” through the shared nav catalog while keeping the stable internal `?tab=today` route and the lesson-plan “Today” date heading. Updated current feature-visibility guidance, teacher Settings explanatory copy, and focused navigation/catalog coverage. Student mobile light/dark open-drawer and desktop dark expanded-sidebar captures show the new label without layout drift.
- Model recommendation: GPT-5.6 Terra — localized responsive UI composition with bounded component and browser verification.

## 2026-09-01 — Privatize student submission and Test storage

- Replaced direct public Supabase Storage delivery for `submission-images` and `test-documents` with authenticated same-origin authorization routes that issue 60-second signed redirects. Student images require submission ownership; teachers require classroom ownership. Uploaded Test documents require contextual Test access for students or Test ownership for teachers, plus a ready managed-storage record and exact Test reference.
- Large file bodies bypass Vercel functions: Pika reserves an immutable managed object, the browser uploads directly with a signed Supabase token, and Pika verifies exact stored size/MIME before finalization. New uploads persist managed object identity and bucket/path metadata without public URLs. Legacy stored public URLs normalize to private paths; Blueprint copy and classroom archive/restore preserve private identities.
- Added migration `146_private_student_and_test_storage.sql` to make both buckets private and remove anonymous-read policies. It was not applied: rollout requires deploying the compatible application first, followed by one-time authorization naming the Supabase target and this exact migration.
- Verification: focused gate passes 128 files / 1,586 tests plus architecture, UI/design policy, TypeScript, and lint; the production build, Pika audit, and diff checks pass. Database replay and browser lanes remain selected for final CI.
- Independent architecture/security review found rollout continuity, obsolete-policy defense, and API-debt baseline blockers. One remediation batch now preserves unregistered legacy delivery only while the bucket is still public, makes migration 146 refuse existing objects until managed-storage enforcement and settled identities are proven, re-drops all obsolete direct Storage policies, and removes the stale upload-route debt entry. The focused gate now passes 128 files / 1,592 tests; build and Pika audit pass. Migration 146 remains unapplied and separately authorized.
- First ready-PR CI replay reached migration 146 but both database-backed lanes rejected its nonessential `COMMENT ON storage.buckets` because the migration role does not own Supabase's Storage table. Removed only that comment; the privacy update, rollout guard, and policy drops are unchanged.

## 2026-09-01 — Refine the experimental Gradebook controls

- Simplified the teacher Gradebook mockup: removed the term/student-count context and per-row Preview column, centered a persistent `Student Actions` dropdown with an explicit chevron and Email for selected students, and moved score display into More actions. Its visible label changes to `x selected` when rows are selected.
- More actions now provides one dynamic score-display command (`Show raw scores` or `Show %`) plus a concrete `Show student IDs` checkbox. All assessment columns respond to score mode, and the optional Student ID column is local fixture data only. Production Gradebook remains unchanged.
- More actions also provides a `Keep key columns visible` checkbox. When enabled, selection and First stay pinned left while Final stays pinned right during horizontal table scrolling; the assessment region remains the only moving content.
- The populated fixture now shows twelve compact 88px assessment columns at their minimum display width, preserving the dense horizontal Gradebook and making horizontal scrolling inspectable even on a wide Pattern Lab surface.
- Added a `Few assessments` example state with three 88px assessment columns. A flexible empty assessment-space column absorbs the remaining table width so Final stays anchored at the far-right edge without stretching populated assessments.
- The Empty fixture now means a roster with no assessments: checkbox, First, Last, and narrow Final retain their fixed defaults while Assessments spans the remaining table width. The table retains a 96px minimum for that flexible region so narrow screens scroll inside the table frame.
- First and Last cells now stay on one line and ellipsize at narrow resized widths, retain the full value as native hover text, and include a deliberately long fixture name so the behavior is inspectable at the 72px minimum.
- Focused component and policy tests pass, lint passes, and the durable Pattern Lab verifier passes across desktop/mobile and light/dark with populated/empty, open More actions, selected Student Actions, internal mobile scrolling, no page overflow, and student exclusion. Representative captures were inspected. The work is included in draft PR #1146; merge is not authorized.

## 2026-09-01 — Mock a sticky Gradebook class summary

- Moved the experimental Gradebook class summary into a semantic single-row table footer that stays pinned to the bottom edge of the internal Gradebook viewport while roster rows scroll underneath. Average is the default; one dynamic More actions command swaps it with Median and reverses to Show average. The production Gradebook remains unchanged.
- Expanded the populated local fixture to ten uniquely named students so vertical scrolling and the pinned summary can be inspected. The selected summary remains aligned with assessment and Final columns and follows the existing percent/raw display toggle; the empty state omits the summary.
- Added one dynamic More actions command to swap First/Last name order. The reverse label always describes the next arrangement, each field retains its own width and sorting behavior, and `Keep key columns visible` defaults on while pinning whichever name field currently leads.
- Added semantic coverage and a measured browser assertion for the actual sticky geometry. The Pattern Lab verifier passes across teacher desktop/mobile, light/dark, vertical/horizontal scrolling, frozen columns, empty/few-assessment states, and no page overflow. Representative light/dark desktop/mobile captures were inspected; student is intentionally n/a for this teacher-only table pattern.
- Independent fixed-SHA review found the populated footer still summarized the original four-student fixture. Remediation batch one now derives Average/Median from every displayed row and proves the ten-student Ecosystems average is 85% in component and browser coverage. A second review claim that both name columns should freeze was rejected against the approved contract: selection plus only the leading First/Last field are key columns, with Final pinned right. Full local tests pass 644 files / 5,575 tests; Pika audit and the 100-check Pattern Lab browser suite pass. Targeted re-review and exact-head CI remain.

## 2026-09-01 — Add configurable Gradebook categories

- Synced after PR #1146 merged and added teacher-managed Gradebook categories with course percentages totaling 100, one default category, per-category default assessment weights, and per-assessment category/weight overrides. The seeded setup is Attendance 10%, Term 65% (default), and Final 25%; deleting a category leaves its assessments Uncategorized.
- Added the shared category and assessment dialogs to the live teacher Gradebook and Pattern Lab. Assessment titles now open details showing category, relative weight, and exact course weight. Running grades use assessment weights within categories and renormalize category percentages when a student has no qualifying score in a category.
- Full tests pass 651 files / 5,614 tests; focused checks, TypeScript, lint, design/UI policies, Pika audit, and teacher/student desktop/mobile light/dark visual review pass. Composite checklist reviewed: keyboard/focus behavior and semantic states are covered; no manual UI follow-up remains.
- With one-time authorization, applied migration `147_gradebook_categories.sql` to local Supabase, regenerated matching database types, and verified the seeded defaults, Term assignment default, atomic replacement, and delete-to-Uncategorized behavior in a rolled-back transaction. Database lint found no new warnings. Draft PR review and CI remain.
- Independent review remediation added category reordering, serialized same-assessment saves, explicit-weight preservation, safe name swaps/delete-recreate behavior, reserved internal-name validation, and full classroom archive/restore/purge integration. The corrected migration replayed from a clean local database; category, archive, compaction, schema-audit, and hot-to-cold-to-restore recovery checks pass with all 41 resources. Full tests pass 652 files / 5,619 tests; the final focused gate passes 73 files / 828 tests plus architecture, UI/design policy, TypeScript, lint, and Pika audit.
- Final integration review caught restore drift for intentionally Uncategorized assessments. Current-format restores now preserve explicit null category membership, legacy archives still default missing category data to Term, and the recovery drill fixture proves Uncategorized survives hot-to-cold-to-restore unchanged. The frozen migration-108 archive wrapper and current migration-147 archive checks both pass with strict version-aware resource/trigger counts.

## 2026-09-01 — Harden application dependencies

- Upgraded Next.js and its lint config to the patched 15.5 line, Vitest/coverage to 4.1.11, Vite to 7.3.5, and PostCSS to 8.5.26. Added narrow pnpm overrides for vulnerable transitive packages; `pnpm audit` now reports zero vulnerabilities at every severity.
- Adapted server-page request APIs and fixture tests for Next 15's asynchronous headers and search parameters. Authentication redirect destinations and teacher/student route behavior remain unchanged.
- Verification: frozen-lockfile install, production build, focused gate (18 files / 115 tests plus architecture, UI/design policy, TypeScript, and lint), full suite (650 files / 5,599 tests), diff check, and Pika audit pass. Independent fixed-SHA security and compatibility review plus exact-head PR Gate follow before the authorized merge.
- First exact-head CI exposed that Next 15 development Flight diagnostics could serialize raw fulfilled Supabase assessment results before the public planned-course page projected them, including private question and document fields. The public loader now resolves only to an explicit least-data DTO with no database identities or private Test fields, and no longer fetches answer-bearing assessment JSON; public Test cards retain their titles but omit question counts. Child rows use stable position/ID ordering. E2E-only Next developer chrome is disabled so keyboard-order checks exercise the application. The exact raw-response privacy and not-found keyboard matrix covers desktop/mobile and light/dark; full checks, targeted re-review, and fresh CI follow.

## 2026-09-01 — Harden authentication sessions and abuse controls

- Replaced PII/role-bearing long-lived cookie authority with version-3 opaque tokens whose hashes, current user binding, authentication source, and expiry are held in a server-only `auth_sessions` table. Login rotation and logout revoke the exact row; password reset consumes the handoff, changes the password, and revokes every prior session atomically.
- Added shared concurrency-safe database rate limits for login, signup/reset code sends, and code verification. Limiter keys are HMAC-normalized email hashes, browser roles have no table/RPC access, stale limiter metadata is removed after one day, and expired sessions are swept during login.
- Replaced legacy `Math.random` verification-code generation, equalized password-login hash work for missing/passwordless accounts, removed response-based signup/login/reset enumeration, and made `/api/auth/me` explicitly private/non-cacheable.
- Added migration `148_auth_session_and_rate_limit_hardening.sql`, database concurrency/revocation/privilege contracts, focused route/runtime/migration tests, and a migration-first rollout/rollback canary runbook. Migration 148 is unapplied everywhere and still requires exact target/migration authorization before rollout.
- Initial high-risk review found a login/reset issuance race, reusable sibling reset handoffs, identifier-only abuse budgets, unbounded invalid-confirm bcrypt, and residual body/timing oracles. Remediation batch one adds a user credential version plus atomic issuance RPC, user-locked single-winner reset invalidation, identifier/client/global budgets using Vercel's overwritten client-IP header, pre-bcrypt handoff validation, byte-identical verification failures with fixed bcrypt work, and post-response email delivery behind a 350 ms initiation floor.
- Remediation verification: 123 auth/WorkOS-focused tests and the focused gate (166 files / 1,227 tests) pass with architecture/UI/design policy, TypeScript, lint, Pika audit, shell validation, and diff checks. The database CI harness now covers stale issuance fencing and concurrent sibling reset single-winner behavior. The generic verification error was visually inspected on local student mobile. Targeted re-review and final integration review remain.
- Targeted security re-review found that limiter ordering could charge victim identifiers after a client was already blocked, the hour-long rolling global budget could become an unauthenticated kill switch, and verification failures still differed by one database write. Remediation batch two now evaluates the client first, uses a high-capacity 10,000-request one-minute fixed-counter overload guard, and charges identifiers only after both upstream checks pass. Signup/reset verification failures always perform one attempt update, using a sentinel UUID for no-op paths. Unit/API coverage proves downstream budgets are untouched after upstream denial and missing, ineligible, exhausted, and wrong-code states have identical response bodies and update operation counts. The focused gate passes 166 files / 1,230 tests plus architecture/UI/design policy, TypeScript, and lint; Pika audit, shell validation, and diff checks pass. Migration 148 remains unapplied everywhere.
- Final integration review found that the production signup confirmation endpoint was the lone password flow bypassing shared abuse controls. Remediation batch three adds a `signup_confirm` scope and applies client, overload, then identifier limits before `/api/auth/create-password` performs any database lookup; route coverage proves a limiter rejection makes zero table calls. The user explicitly extended the bounded review budget for this final fix and one targeted re-review. Direct tests pass 2 files / 16 tests; the focused gate passes 166 files / 1,231 tests plus architecture/UI/design policy, TypeScript, and lint; Pika audit and diff checks pass.
- Exact-head CI replayed migration 148 but rejected the manually updated generated type ordering/nullability. After explicit local reset authorization, the branch replayed migrations 001–148 without seed data, regenerated exact schema types, passed type drift and zero-error database lint, then exposed an automatic Supabase table-grant default: `service_role` retained direct insert on auth tables. Remediation batch four explicitly revokes automatic table grants from every auth table, restores only session select/delete, leaves limiter mutation RPC-only, and moves nullable RPC refinements into the supported application type layer. With renewed one-time permission, a fresh no-seed local reset replayed migrations 001–148; generated types match, database lint has zero errors, and the live auth harness passes issuance fencing, revocation, rate-limit concurrency, privileges, and reset atomicity. The focused gate passes 166 files / 1,231 tests plus architecture/UI/design policy, TypeScript, and lint; Pika audit and diff checks pass.
- Targeted review confirmed the replayed database ACL is safe but found the harness asserted only part of the intended least-privilege matrix. Final test-only remediation batch five now checks all seven table privileges for both browser roles across all three auth tables, denies browser execution of all five auth RPCs, permits only session select/delete for `service_role`, and denies every direct `service_role` privilege on both limiter tables. The existing functional RPC calls continue to prove the security-definer paths remain usable. The strengthened live harness and shell validation pass; the focused gate remains 166 files / 1,231 tests plus architecture/UI/design policy, TypeScript, and lint; no TypeScript changes required another Pika audit scan.

## 2026-09-01 — Shorten login code-expiry guidance

- Shortened the shared unauthenticated magic-code hint to “The code expires in 10 minutes.” and updated its focused assertion; no auth behavior, layout, component contract, or role-specific UI changed.
- Refined the unauthenticated entry card for first-time visitors by renaming both login headings to “Pika Classroom” and removing the redundant email instruction. The existing field label, button copy, layout, and auth behavior remain unchanged; a focused regression assertion covers the new hierarchy.
- Focused gate passes 12 files / 112 tests plus architecture, UI/design policy, TypeScript, and lint. Email and code-entry states were visually reviewed at desktop/mobile in light/dark with no overflow; teacher/student are pre-role and share this surface. Pika audit passes. Risk profile: none. Model recommendation: GPT-5.6 Terra — localized copy-only UI refinement.
- Follow-up brand refinement reuses the production Pika logo beside the title, adds the approved subtitle “School days, simplified.”, and removes the visible School Email asterisk while retaining native required semantics in both login modes. The shared pre-role email state was visually inspected at desktop/mobile in light/dark. Per explicit user direction, tests and CI were not run for this follow-up before its draft push; focused assertions were updated for the final copy and semantics.
- Final independent review found the title-adjacent logo duplicated “Pika” for assistive technology. The login treatment now hides that decorative instance from the accessibility tree while retaining the visible mark; a matching semantic assertion covers the correction.

## 2026-09-01 — Resolve database lint warnings

- Added migration 149 to resolve all warning-level findings found by a fresh migration replay while preserving deployed RPC signatures, grants, security modes, and established lock order. Dead declarations and discarded results were removed; Test unsubmit now enforces its teacher actor at the database boundary, and clear-grade rejects a null deterministic clock.
- After rebasing over Gradebook migration 147 and auth-hardening migration 148, verification uses a disposable isolated Supabase project built only from this branch. Fresh migrations 001–149 replay successfully, generated public-schema types are unchanged, and `supabase db lint --local --level warning` reports zero findings.
- Current archive staging/compaction, assignment mutation/concurrency, Test submit/grading, student purge, attendance, managed storage, and cleanup-health database contracts pass on the isolated replay. Focused checks pass 11 files / 96 tests plus architecture, TypeScript, and lint; Pika audit reports no TypeScript changes. Risk profile runtime-platform. Model recommendation: GPT-5.6 Sol — cross-domain PostgreSQL migration and authorization boundary change.
- Independent security and compatibility review identified a concurrency gap in the first Test-unsubmit actor check: Classroom ownership or archive state could change between authorization and mutation. Remediation now serializes authorization with the established Classroom-before-Test lock order and revalidates the actor and archive state after acquiring those locks.
- Added a database harness covering wrong/null actors, a null grade-clear clock, owning-teacher success, and deterministic two-session archive and ownership-transfer races. Both rejected races leave the submitted attempt and response unchanged. A second fresh 001–149 replay, zero-warning lint, the 96-test focused gate, migration contract tests, shell validation, and Pika audit pass after remediation.
- Targeted re-review found that Classroom-before-Test row locks could deadlock with grading RPCs that already serialize on the per-Test advisory lock and then take Test-before-Classroom row locks. Remediation batch two makes unsubmit join that advisory-lock family before any parent-row access. The database harness now proves a grading-shaped holder can lock Test, then Classroom, while unsubmit waits on the advisory lock without holding Classroom; both transactions complete without `40P01`. A third fresh replay and zero-warning lint pass.
- Final cumulative review found the new runtime harness was not yet an exact-head CI gate. Remediation batch three adds warning-level database lint and the new actor/clock/concurrency harness to the Architecture Database Contracts job, with a static workflow contract preventing accidental removal.
- After rebasing onto current `main`, the lint migration is resequenced to 149 after Gradebook 147 and auth hardening 148; both the auth database harness and new lint/runtime harness remain in the database CI lane. Targeted re-review found the static contract searched the whole workflow instead of the lane, so remediation batch four scopes its assertions to `architecture-database-contracts` and pins all three required commands there.
- Targeted test re-review found those lane-scoped substring assertions could still match commented-out commands. Remediation batch five anchors each required named step to its active YAML `run:` line, so moving or commenting out warning lint, the lint/runtime harness, or the preserved auth-session harness now fails the contract.
- Exact-head CI passed replay 001–149, generated types, error/warning lint, auth-session checks, and the new actor/clock/concurrency harness, then exposed an older purge-lint wrapper assumption: Supabase CLI 2.103.0 emits clean text instead of JSON when no findings remain. Remediation batch six accepts only the exact `No schema errors found` line as an empty report, keeps malformed output fail-closed, and adds executable regressions for both paths. Returning the PR to draft cancelled the still-running build/browser lanes; those cancellations were not product failures.
- After PR 1162 merged, the branch rebased without conflicts and retained migration 149. Fresh targeted review found the clean-output fallback could accept the sentinel alongside contradictory output. The new review session's remediation batch one parses full JSON first and accepts only the complete normalized CLI clean transcript; managed-function warning JSON still exits 1, while mixed or malformed output exits 2.
- Final cumulative review found syntactically valid but structurally invalid JSON could still default to an empty result. Remediation batch two requires a non-array report object with an actual `results` array; `{}`, `[]`, and null-results reports now exit 2 instead of passing.
- Targeted re-review found malformed entries inside a valid `results` array could still pass filtering. Remediation batch three validates every result and issue before filtering, including non-managed functions and optional statement line metadata; empty results, null issues, and malformed issue objects now fail closed.

## 2026-09-01 — Record AI PR lifecycle evidence

- Added `pnpm record:ai-pr-lifecycle`, an append-only local recorder for AI PR stages, attributable active work/token metrics, CI queue/run timing, correction/sync counts, and final quality. It keeps unavailable fields unknown and never records prompts, source content, secrets, identities, or environment values.
- Updated the canonical development workflow plus Codex and Claude PR prompts so agents record start, draft, review, remediation, CI, merge, and summary evidence automatically. No application, schema, CI-policy, dependency, or production behavior changed.
- Verification: recorder and guidance tests (47), focused checks (89), architecture/UI/design policy, TypeScript, lint, and Pika audit passed. Model recommendation: GPT-5.6 Terra — bounded local tooling and workflow-contract change.
- Independent review corrections: added recorder tests to the canonical PR Gate workflow and renamed the post-PR timestamp to `trackingStartedAt`, so it cannot be mistaken for active development time.

## 2026-09-01 — Simplify teacher work-surface actions

- Removed the duplicate centered Organize action from the experimental Classwork and Tests summaries; Create remains centered and each Organize command remains available once in the trailing More menu.
- Changed shared Page action-bar More triggers and default teacher work-surface icon-menu triggers to the ghost treatment so they blend into their background at rest. Explicit primary menu triggers remain unchanged.
- Focused checks pass 141 files / 1,393 tests plus architecture, UI policy, design policy, TypeScript, and lint. The Pika audit passes with composite-widget coverage present. The durable browser verifier passes 83 checks, including teacher desktop/mobile light/dark Classwork and Tests summaries and open More menus, student exclusion, and overflow checks; representative screenshots were visually inspected.

## 2026-09-01 — Add Daily and role-aware classroom page mockups

- Added an API-free teacher Daily page mockup using the production date navigator, work-surface action hierarchy, operational table, selection menu, attendance status controls, and log-summary composition.
- Added a sticky Pattern Lab Teacher/Student switch. Both fixture mode and authenticated development review accept the explicit reference role; production remains unavailable. The classroom page set now remains visible in both modes, with student Today, Classwork, Tests, Calendar, Announcements, and Resources fixtures composed from existing feature owners.
- Focused checks pass 141 files / 1,397 tests plus architecture, UI policy, design policy, TypeScript, and lint. Pika audit passes with composite-widget coverage present. The durable 142-check browser scenario verifies role switching, direct destinations, desktop/mobile light/dark page sets, and no page overflow; representative Daily, student-page, and sticky-navigator screenshots were visually inspected.

## 2026-09-01 — Prototype streamlined Daily attendance controls

- Refined only the API-free teacher Daily Pattern Lab fixture. Joined an icon-only, tooltip-backed QR action with the attendance time to its right; the control matches the date selector height. QR remains available when attendance is closed; the clickable time area uses a subtle semantic green open state and a neutral closed state. It opens a local time editor, collapses to the clock icon when cleared, and is also reachable through Edit time in More actions. Moved open/close attendance and the renamed Edit attendance dialog into More actions, and removed row checkboxes plus the selected-student action menu.
- Replaced the combined status group with tight Present/Late/Absent table columns, added an untitled per-row undo action for manual marks, and removed log completion circles. The batch dialog locally supports mark all present/late/absent, revert manual changes, and clear QR check-ins.
- Added a Pattern Lab-only Attendance mode selector. Manual mode preserves the optional editable time as a neutral/passive control and all manual marking actions, while removing the QR action, Check-in column, open/close session command, and Clear QR check-ins action. Its More menu switches between Attendance from log, where any completed daily log supplies an automatic Present baseline, and Manual marking. Manual overrides remain reversible.
- Kept compact Present/Late/Absent selection plus the conditional undo action sticky at the table's far-right edge, including on narrow screens. Semantic tests cover both attendance modes and sub-modes, session state, far-right ordering, manual undo, batch marking, revert, and QR clearing. The durable browser scenario passes across teacher/student, desktop/mobile, and light/dark, including Manual renders, open menus/dialogs, and overflow checks. Visual inspection found and corrected a mobile action-width issue so More actions remains visible. Live Daily behavior, APIs, persistence, and schema remain unchanged; prototype awaits user review.
- Tightened Daily microcopy without weakening accessible names: row undo now shows `Undo manual change`, and status-count tooltips use `2 Present`, `1 Late`, and `1 Absent`. Clicking a status count performs the local status-first sort and reveals a 10px chevron inside the existing 28px pill, preserving the 44px attendance-column width and row alignment.
- Extended the QR check-in Attendance time dialog with a collapsed Advanced disclosure that reuses the production timing-rule labels and cutoff explanation. Defaults are QR open 10 minutes before, Present grace 5 minutes, QR close 0 minutes before end, Absent 0 minutes before end, Same class day, and automatic open/close enabled. Session end day is a two-option segmented toggle. Manual attendance keeps the simple time-only dialog. Browser coverage verifies expanded and simple dialogs at teacher desktop/mobile in light/dark; student is unchanged.
- Superseded the disclosure treatment: QR timing rules are always visible, the cutoff paragraph is removed, and the grace label is `Grace period before late (min)`. Same class day and Next day expose `Class end on the same day` and `Class ends the next day after midnight` tooltips, respectively. The checkbox now reads `Open and close QR attendance automatically`. Manual attendance remains time-only.
- Hard-clamped timing inputs: QR opens before start accepts 0–120 minutes; grace before late, QR closes before end, and Absent before end accept 0–the calculated session duration. That duration updates from the draft start/end time and Same class day / Next day choice, and existing values are clamped again whenever the duration shrinks.

## 2026-09-01 — Adopted the approved Daily attendance design in production Pika

- Replaced the real teacher Daily selection/bulk-action layout with the approved compact far-right Present/Late/Absent columns and conditional `Undo manual change` action. Open/close attendance, Edit time, and class-wide Edit attendance now live in More actions; the centered QR/time control matches the date selector, QR is disabled unless the authoritative session is confirmed open, and log completion circles are gone.
- Added Pika-owned manual attendance for classrooms without QR Attendance. Attendance from log derives Present from a completed Pika log; when that option is off, attendance uses an Unmarked baseline. Optional times remain passive, and teacher overrides/reverts persist through a teacher-owned API. After syncing with `main`, the source migration was resequenced to `147_pika_manual_attendance.sql`. An earlier explicitly authorized local-only prototype applied a different table-based draft under number 146, so that one local database has stale prototype tables and migration history; production remains untouched and clean environments will apply only the final migration 147.
- Removed completed/empty count chips from the production Log header. Log remains keyboard-sortable by completed versus empty entries, while Attendance from log continues deriving Present automatically and displays that result only in the far-right attendance columns. Focused component coverage passes 45/45, UI/design policy and TypeScript checks pass, and teacher/student desktop/mobile screenshots were visually verified.
- Updated the real attendance-time editor with always-visible timing rules, the approved labels/tooltips and automatic-QR copy, 10/5/0/0 defaults, Same class day/Next day toggle, and hard clamps based on the session duration. Focused component, API, validation, domain, and migration tests pass; Pattern Lab browser verification covers teacher/student, desktop/mobile, light/dark, open dialogs/menus, both attendance modes, and overflow.
- Replaced the visible QR Daily `Check-in` column label in Pattern Lab and production with a compact clock icon and `Time of scan` tooltip. Production keeps the existing sort and resize behavior and exposes the same accessible name. Focused component tests pass 54/54, UI/design policy and TypeScript checks pass, and the complete Pattern Lab visual matrix passes across desktop/mobile and light/dark.
- Simplified Manual Daily further: passive time now retains the full `9:00 - 10:00 AM` form at every width; More actions has one off-by-default `Attendance from log` checkbox instead of paired radio options; and Edit attendance removes both its menu description and dialog instruction paragraph. The production fallback and migration source default are now manual/off, while existing explicit settings remain respected. Focused coverage passes 64/64, all static UI/type checks and the complete Pattern Lab visual matrix pass, and the real local classroom was left with Attendance from log off plus 9:00–10:00 saved for review.
- Final post-rebase verification passes the Pika audit, the full focused gate (148 files / 1,441 tests plus architecture, UI/design policy, TypeScript, and lint), and the complete Pattern Lab teacher/student desktop/mobile light/dark browser matrix. Representative QR, manual-mobile, and dark timing-dialog screenshots were visually inspected. Production migration application remains a separate human-controlled step.
- Independent high-risk review found archive-lifecycle, cross-date request, concurrent-settings, and roster-race blockers. One remediation batch now stores settings on `classrooms` and date-keyed marks on `classroom_enrollments`, so the immutable archive-v2 graph preserves and purges them without a new resource version; service-role RPCs revision-check settings and atomically update exact roster rows. The manual controller now generation-scopes reads and mutations, invalidates late GETs, and reloads after settings writes. Focused verification passes 149 files / 1,447 tests plus architecture, UI/design policy, TypeScript, lint, and the Pika audit. Migration 147 remains unapplied.
- Targeted security re-review found pre-147 archive restore defaults, archive-vs-mark locking, Strict Mode effect replay, and missing-RPC error mapping gaps. Remediation batch two preserves the complete restore normalizer while defaulting all five new fields, row-locks the active teacher-owned classroom before mark updates, restores mounted state on effect setup, and recognizes missing-function migration codes. Focused verification passes 149 files / 1,450 tests plus all static gates and the Pika audit; migration 147 remains unapplied for final database-backed CI.
- The first ready-PR gate replayed migration 147 successfully but caught two mechanical artifacts: nullable RPC arguments left over from the discarded local prototype and stale Pattern Lab snapshots for the approved subtle More actions treatment. The generated types now match the clean schema, and the desktop/mobile light/dark contract snapshots were regenerated on both macOS and Linux. The full focused gate remains green at 149 files / 1,450 tests; production remains untouched.
- Capped both QR and Pika-owned manual attendance sessions at 12 hours. A shared duration helper now aligns dialog and API validation; exact 12-hour same-day/overnight windows are accepted and longer or non-positive windows are rejected. Migration 147 adds stored-policy constraints plus a fail-safe precondition that stops rollout if existing QR policy data violates the cap rather than altering it. Pattern Lab mirrors production and keeps all time-dialog actions visible on mobile. The full focused gate passes 150 files / 1,458 tests, Pika audit passes, and QR/manual invalid states were visually verified across teacher and student Pattern Lab matrices, desktop/mobile, and light/dark. Composite checklist reviewed: keyboard behavior is unchanged and covered, semantic invalid/pressed/disabled state is covered by tests, and no manual follow-up remains. Migration 147 remains unapplied.
- The approved extra migration review caught incorrect API-shaped column names and minute-only SQL arithmetic in the new QR duration constraint. The constraint now uses the real `opens_local`/`closes_local`/`close_day_offset` schema and exact interval arithmetic. The database harness requires migration 147, accepts an exact 12-hour overnight RPC write, rejects 12 hours plus one second through the named constraint, and proves the rejected write leaves the valid policy unchanged. The full focused gate remains green at 150 files / 1,458 tests; the clean migration replay remains required in final CI because migration 147 was not applied to the stale local prototype database.

## 2026-09-02 — Rebase Daily attendance after database-lint merge

- After PR 1161 merged, rebased PR 1163 onto `a9cf57ae`, preserving the newer Gradebook/role-aware Pattern Lab work and the approved Daily attendance behavior. Resolved only Pattern Lab guidance/composition and append-only journal conflicts.
- Resequenced the branch migration to `150_pika_manual_attendance.sql` after main migrations 147–149 and updated its unit/database harness references. The local database was intentionally not migrated; its read-only harness correctly reports migration 150 absent, while migration/API/domain/component tests pass 82/82.
- Refreshed worktree dependencies to current main, corrected authenticated Pattern Lab role selection for asynchronous Next.js search parameters, and passed the full focused gate: 151 files / 1,465 tests plus architecture, UI/design policy, TypeScript, and lint. Final visual verification, independent review, and exact-head CI remain before merge.
- Post-rebase high-risk review found that migration 150 replaced migration 147's gradebook-aware archive adapter, allowed manual marks for non-class dates, left legacy QR policies above the new 120-minute early-open cap, and rejected class-wide marking above 200 students. The first remediation extends the v147 adapter chain and transactionally locks an active `class_days` row before marking. Targeted re-review rejected a silent legacy-policy clamp and an unbounded replacement request, so the final batch fails the migration safely when an explicit policy correction is required, enforces the 120-minute database limit, and splits large class-wide changes into bounded 200-student requests with refresh-and-warning handling after a partial failure. The attendance database harness exercises the final restore adapter and class-day boundary. Targeted coverage passes 35/35; after one resource-starved run produced only unrelated worker/test timeouts, a clean retry passes 151 files / 1,471 tests plus architecture, UI/design policy, TypeScript, lint, shell validation, diff checks, and the Pika audit. Migration 150 remains unapplied pending exact-head database CI.
- The first exact-head CI replayed migrations 001–150 successfully, then found the generated schema types omitted the newly chained internal `normalize_classroom_archive_restore_row_v147` signature. The deterministic four-line generated-type entry now matches the fresh replay; no schema or runtime behavior changed. The PR returned to draft before this correction, and exact-head database CI must confirm the type drift is gone before merge.
## 2026-08-27 — Tighten selected Test roster controls

**Risk profile:** UI-only — selected Test grading spacing, stacking, and checkbox
alignment changed; no grading behavior, permissions, API, schema, persistence,
authentication, dependency, migration, or student UI changed.

- Reduced the selected Test action-to-roster gap to the established Attendance
  work-surface spacing and kept the centered whole-Test action visually dominant.
- Raised the action-bar stacking context with the existing semantic layer token
  so the whole-Test split-button menu stays visible and interactive above the
  sticky roster header.
- Restored the shared selection-cell inset so the select-all checkbox and row
  checkboxes align on desktop and mobile.
- Added browser geometry regressions for the 4px maximum gap, checkbox-center
  alignment, and an unobscured menu, plus component coverage for menu semantics,
  Escape dismissal, and focus restoration.
- Composite-widget accessibility checklist reviewed: yes; keyboard behavior
  covered: yes; semantic state covered by tests: yes; remaining manual follow-up:
  none.

**Verification:** focused Test/shared component tests (87/87 plus final Test-only
68/68), responsive long-roster Playwright matrix (4/4), lint, design/UI policies,
Pika audit, and diff checks pass. Visual review covers default, menu-open, and
selected states on desktop/mobile in light/dark. Student UI is n/a because this
is a teacher-only surface.

**Model recommendation:** current GPT-5 coding model for a bounded teacher UI
remediation with responsive visual verification.

## 2026-08-27 — Consolidate Test grading actions at the top

**Risk profile:** UI-only — selected Test grading action placement and shared
teacher context-bar chrome changed; no grading behavior, permissions, API,
schema, persistence, authentication, dependency, migration, or student UI
changed.

- Removed the floating bottom selection bar from Test grading. Selecting rows
  now replaces the centered whole-Test control with the selected-student action
  toolbar in the same top command area.
- Preserved direct bulk actions on wide layouts and kept every action available
  from a top overflow menu on narrower layouts. Access, clear-selection, action
  eligibility, confirmations, and terminology are unchanged.
- Removed the 4px inset from the shared teacher context-bar floating chrome so
  the chrome hugs the existing 44px buttons instead of making the FAB appear
  oversized. This also keeps Attendance and Test on the same shared treatment.
- Removed obsolete bottom scroll clearance after the selection bar moved.
- Composite-widget accessibility checklist reviewed: yes; keyboard behavior
  covered: yes; semantic state covered by tests: yes; remaining manual follow-up:
  none.

**Verification:** focused Test/shared component tests (74/74, then 71/71 after
the final guard fixes), responsive long-roster Playwright matrix (4/4 twice),
lint, architecture/design/UI policies, Pika audit, diff checks, and live local
browser inspection pass. Visual review covers default and selected states on
desktop/mobile in light/dark; the live selected toolbar has 0px wrapper padding
while button height remains 44px. Student UI is n/a because this is a
teacher-only surface.

**Model recommendation:** current GPT-5 coding model for a focused responsive
teacher-work-surface interaction refinement.

## 2026-08-27 — Compact selected-student Test actions

**Risk profile:** UI-only — selected-student utility controls changed from
labeled buttons to icon buttons; no action eligibility, grading behavior,
permissions, API, schema, persistence, authentication, migration, or student UI
changed.

- Converted AI Grade, Unsubmit, Return, and Delete Work to shared teacher
  work-surface icon buttons on desktop while retaining their explicit accessible
  names, hover tooltips, disabled states, and destructive treatment.
- Kept the selected access split button labeled because it communicates the
  current action and scope, and retained labeled utility actions in the narrow
  layout overflow menu.
- Added component coverage for icon-only accessible naming and browser coverage
  for empty visible button text plus the AI Grade hover tooltip.
- Hardened an unrelated in-app Test preview regression exposed by CI coverage:
  its fetch mock now matches URL and method instead of depending on concurrent
  request order. Product code and preview behavior are unchanged.
- Composite-widget accessibility checklist reviewed: yes; keyboard behavior
  covered: yes (existing split/menu Escape and focus tests remain intact);
  semantic state covered by tests: yes; remaining manual follow-up: none.

**Verification:** full Vitest suite and full coverage suite (5,139/5,139),
responsive long-roster Playwright matrix (4/4), TypeScript, lint,
architecture/design/UI policies, Pika audit, and diff checks pass. Visual review
covers selected desktop/mobile states in light/dark and the desktop tooltip
hover state. Student UI is n/a because this is a teacher-only surface.

**Model recommendation:** current GPT-5 coding model for a bounded accessible
teacher-toolbar refinement.

## 2026-08-27 — Adopt persistent Test grading action scopes

**Risk profile:** standard — selected Test grading action placement, row access
state changes, and AI-grading request scope changed; permissions, enrollment
validation, test status rules, grading eligibility, persistence schema,
authentication, dependencies, migrations, and student UI are unchanged.

- Kept Open All and Close All as persistent icon commands in the centered Test
  action cluster, with tooltips and confirmation for the global mutations.
- Added one persistent student-actions menu that is disabled before selection,
  becomes a selected-count trigger, and contains only AI Grade, Unsubmit,
  Return, and Delete Work. Global access commands and selection clearing are not
  duplicated in the menu.
- Replaced row access icons with immediate semantic switches: green/right for
  open and red/left for closed, with a lock-state icon, accessible state, and no
  per-row confirmation.
- Added an AI Grade scope prompt for Only ungraded versus Regrade all and passed
  the explicit scope through a Zod-validated API boundary into run preflight.
  Ungraded scope now preserves any persisted grade; all scope queues eligible
  answered responses even when previously graded.
- Updated stable teacher operational-table guidance to combine Attendance's
  table rhythm with selected Test grading's persistent action-scope pattern.
  Attendance's bottom selection bar is now documented as migration debt for a
  later focused pass.
- Composite-widget accessibility checklist reviewed: yes; keyboard behavior
  covered: yes; semantic state covered by tests: yes; remaining manual follow-up:
  align Attendance with the new persistent selection-menu pattern in a separate
  change.

**Verification:** TypeScript, lint, focused Test/UI/API/validation tests
(117/117), responsive long-roster Playwright matrix (4/4), Pika audit, and diff
checks pass. Visual review covers default, global confirmation, selected menu,
and AI scope states on desktop/mobile in light/dark. Student UI is n/a because
this is a teacher-only surface.

**Model recommendation:** GPT-5.6 Sol for implementation and GPT-5.6 Terra/high
for one bounded independent correctness and requirements review.

## 2026-08-27 — Redesign teacher Attendance action hierarchy

**Risk profile:** standard UI interaction change — teacher Attendance action
placement and responsive grouping changed; Attendance permissions, session
states, command eligibility, confirmation polling, API behavior, persistence,
authentication, schema, migrations, dependencies, and student UI are unchanged.

- Implemented the user-selected Option 1 using the Test grading work-surface
  hierarchy without importing Test terminology or domain behavior.
- Joined the previous/date/next controls into one segmented date navigator. The
  arrows touch the date and the selectable date has no dropdown chevron.
- Moved Present, Late, Absent, and Clear mark from the transitional bottom bar
  into a persistent centered Student actions menu that is disabled before
  selection and becomes a selected-count trigger.
- Preserved explicit desktop QR and session commands. At 390 px, the same
  session actions collapse into one centered icon menu so the quiet edge utility
  menu cannot overlap the primary cluster.
- Kept Attendance hours and refresh at the quiet edge, retained status-count
  sorting and per-student status dots, and added a bordered internally scrolling
  roster with sticky sortable/resizable headers.
- Added component coverage for the joined date treatment, persistent selected
  actions, command confirmation, disabled states, and menu focus/arrow/Escape
  behavior. Expanded the Playwright experience matrix to a 45-student roster
  with default, selected, menu, sorted/scrolled, hours, mobile session-action,
  and browser-error checks.
- Retained the approved design target, normalized comparison boards, and the
  complete desktop/mobile light/dark evidence matrix under
  `docs/guidance/ui/evidence/attendance-actions-2026-08-27/`.
- Added no new durable rule because the reusable hierarchy was already
  established by the merged Test grading guidance. Corrected stale audit text
  that still described Attendance selection placement as migration debt; the
  joined date treatment remains scoped until another surface proves it reusable.
- One bounded independent review found that shared action-menu rows were shorter
  than the 44 px interaction target and lacked canonical visible focus. Added
  `min-h-control`, the inset focus ring, a regression assertion, refreshed the
  visual evidence, and corrected the stale work-surface audit state.
- Composite-widget accessibility checklist reviewed: yes; keyboard behavior
  covered: yes; semantic state covered by tests: yes; remaining manual follow-up:
  none.

**Verification:** focused component tests (20/20), responsive Attendance
Playwright matrix (4/4) after the mobile-overlap correction and again after the
menu accessibility remediation, TypeScript, lint, production build, Pika audit,
diff checks, and Product Design comparison pass.
Visual review covers teacher desktop/mobile in light/dark, default/selected/menu
states, internal scrolling/sticky headers, tooltips, mobile session actions, and
Attendance hours. Student UI is n/a because this is a teacher-only surface.

**Model recommendation:** GPT-5.6 Terra/high for one bounded independent review
of requirements coverage, responsive behavior, accessibility, and regression
risk.

## 2026-08-27 — Close Test identity release-safety gaps

**Risk profile:** runtime-platform — cross-version Test authoring compatibility
and Classroom/Test database lock ordering; no database was reset or migrated
and no hosted state changed.

- Replaced the missing-migration 503 with a narrow pre-134 fallback that maps
  marked portable question IDs back to exact legacy row IDs for persistence and
  activation while continuing to return the portable API contract. Active and
  closed saves accept metadata/document changes only when the question graph is
  unchanged; question edits require reopening as draft because migration 133
  cannot hold a student-entry fence across multiple application writes.
  Pre-migration activation is deliberately unavailable because migration 133
  has no transactional primitive that can safely synchronize questions while
  fencing every access override. Draft-only UUIDs remain in the legacy draft
  until migration 134 backfills them; the atomic RPC then materializes them.
  Draft-only/internal-row namespace collisions are rejected before writing.
- Added a real pre-migration integration contract to the disposable CI lifecycle:
  it runs closed-Test save and activation refusal against migration 133, covers the
  production-shaped row-ID/portable-ID collision plus draft-only collision
  rejection, active/closed refusal, edit/add/remove/reorder/reopen behavior,
  explicit pre-migration activation refusal, and a concurrent student-attempt
  race; it then applies migration 134 and verifies activation through the
  portable-only path.
- Wrapped student attempt save and submission so both acquire Classroom before
  Test, matching Test authoring, archive, Blueprint reuse, and child mutations.
  The original migration-088 implementations moved behind non-callable private
  functions, preserving behavior without exposing a bypass.
- Added database races for teacher question authoring versus both student
  autosave and submission. A third lock probe proves the student writer does not
  retain Test while waiting for Classroom, and both RPCs must complete without
  SQLSTATE 40P01 or partial state.
- The full 5,155-test suite, focused 63-test Test identity/API suite, TypeScript,
  lint, Pika audit, shell syntax, diff validation, and production build pass.
  The disposable migration replay remains CI-authoritative.

**Model recommendation:** GPT-5.6 Sol for the migration/concurrency correction
and GPT-5.6 Terra for cross-version compatibility review.

## 2026-08-27 — Make Blueprint provenance compatible with student work

**Risk profile:** runtime-platform — migration 134 trigger semantics and
production cutover controls; no database was reset or migrated and no hosted
state changed.

- Fixed the Test-question freeze so owner-run Blueprint identity mapping may
  update only `source_blueprint_version_id` after student work exists. The
  exception runs after Classroom/Test parent locks and requires both the
  transaction-local identity guard and the PostgreSQL owner; authored content
  and portable identity remain frozen.
- Added database regressions for active Blueprint capture and archived reuse
  with retained attempts and responses. They verify provenance is recorded,
  student work and question identity/content are unchanged, and an authored
  question mutation still raises `test_questions_locked`.
- Corrected production continuity to migrations 001–133 applied with only 134
  pending. Migration 134 now has a 10-second lock timeout and 15-minute
  per-statement timeout, with an idle-window preflight and fresh-authorization
  retry runbook. The production-shaped lifecycle deliberately blocks the
  migration, proves the timeout leaves 134 unapplied, then proves a clean retry.
- PR #1095 passed targeted independent safety review with no P0/P1/P2 findings.
  Full local tests pass (588 files, 5,168 tests), as do lint, TypeScript, build,
  Pika audit, focused migration tests, and all CI jobs. Production migration 134
  remains unapplied and still requires exact one-time authorization.

**Model recommendation:** GPT-5.6 Sol for migration and concurrency changes;
GPT-5.6 Terra for bounded compatibility review.

## 2026-08-27 — Course Guide Phase 1

**Risk profile:** cross-role UI plus authenticated and public-read APIs — a
classroom-backed guide, optional public sharing, teacher-managed guide content,
and one resource-save ordering migration applied to local only; staging and
production remain unchanged.

- Replaced user-facing Syllabus terminology with Course Guide while preserving
  the existing internal `syllabus` feature key and `/actual/[slug]` route for
  compatibility.
- Added one safe Course Guide projection and shared presentation for the
  authenticated teacher/student tab and optional public course webpage. The
  in-Pika guide is always available to the teacher and enrolled students; a
  public slug or publication state is no longer required. Removed the iframe
  preview and its message protocol.
- Published configured classroom sections: curriculum overview and
  expectations, resources, assignments, tests, lesson sequence, and
  announcements. Test questions/private uploads are excluded and document
  links are restricted to public HTTP(S) URLs; disabled sections are omitted
  from the public API payload.
- Added one consolidated curriculum overview and expectations editor plus the
  existing autosaving rules/links/reference resources editor directly inside
  the guide. Teacher-authored section headings become keyboard-clickable in
  edit mode, while derived assignments, tests, lesson sequence, and
  announcements remain read-only projections of the live classroom.
- Moved section visibility, lesson-sequence scope, and optional public sharing
  into an accessible Guide options dialog launched from the guide's focused
  floating action cluster. Removed the visible Course Guide Settings subtab;
  legacy `section=syllabus` URLs fall back to General while stored compatibility
  fields and APIs remain intact.
- Removed the redundant `Course Guide` page title from the guide content area;
  the classroom title now leads the document while teacher actions remain in
  the action bar.
- Removed the internal section jump links and kept all enabled guide sections
  in one continuous document with an explicit desktop scroll container inside
  the constrained classroom shell. Reduced doubled horizontal rules so only
  major-section and between-item separators remain.
- Removed course date ranges, term labels, and per-lesson dates from the guide.
  Retired the separate outline setting, visibility control, and rendered
  section while preserving its stored compatibility field. Seeded the local
  demo classroom overview with two Lorem Ipsum paragraphs for visual review.
- Added domain, server projection, authenticated/public API, component,
  settings, navigation, focus, mutation-failure, and regression tests. The full
  suite passes 5,146 tests across 591 files; lint, TypeScript, the production
  build, design/UI policy checks, and the Pika audit pass.
- Visual verification passed for teacher and student at desktop/mobile in
  light/dark, including read, edit, overview editor, resources editor, private
  and public options, saving, and save-error states. Semantic coverage also
  verifies loading, empty, retry, unpublished, archived read-only, unsaved
  discard, dialog focus/Escape/return, and section pressed states. No course
  dates added by the guide, outline section, second narrative editor, iframe,
  settings duplicate, or horizontal overflow remains. The local fixture stays
  private.
- Follow-up density pass reduced the guide header, section, assessment,
  lesson, announcement, and options spacing; shortened both authored editor
  canvases; and replaced the tall empty-resources checklist with one compact
  prompt. The title band is now slimmer, and the edit toggle plus its contextual
  Guide options/Done controls use the top-centred floating action position shared
  with Attendance. The Course Guide floating shell has no inset padding, so its
  shadow hugs the action edges. Focused tests and the 10-case cross-role browser
  matrix remain green.
- PR review removed the classroom join credential from every public/shared guide
  path, filtered future scheduled assignments, corrected duplicate-title grade
  matching, added unload-beacon POST support, made resource load failures
  non-editable/retryable, and restored the shared E2E classroom fixture after
  anonymous public-guide coverage.
- Final concurrency remediation adds migration 136 with a persisted
  monotonic resource `save_revision`, rejects stale PUT/beacon writes in the
  database, serializes and generation-fences client autosaves across classroom
  switches, and snapshots fixture state from the full classroom endpoint. The
  final local gate passes 5,191 tests across 594 files, lint, architecture,
  production build, and the Pika audit.
- With explicit one-time authorization, migrations 135 and 136 were applied to
  the local database only. Migration history now matches through 136, and the
  generated Supabase types were regenerated from and checked against that local
  schema. No hosted environment was touched.

## 2026-08-27 — Revise teacher Attendance controls after Option 1 selection

**Risk profile:** standard application behavior — teacher Attendance interaction,
read-model projection, and shared segmented-control styling API changed; existing
authorization, session/mark commands, confirmation polling, schema, migrations,
dependencies, authentication, and student UI are unchanged.

- Removed Attendance row-selection checkboxes and the selected-student actions
  menu. Added square, tooltip-backed Present/Late/Absent whole-roster controls
  to the centered cluster; each opens an explicit scope confirmation before
  posting marks for all enrolled students.
- Replaced static row statuses with an accessible three-state segmented control.
  Row corrections are immediate and reversible, use icons plus `aria-pressed`
  instead of color alone, retain 44 px targets, and support roving Arrow/Home/End
  keyboard navigation through the shared `SegmentedControl` primitive.
- Replaced Source with QR Check-in time. The teacher read model validates Pika's
  existing signed `attendance.record.changed` inbox events and projects the
  earliest QR-origin time/status per student, so a later staff correction can
  expose Restore QR check-in without losing durable provenance. No provider
  reference or raw integration payload is returned to the browser.
- Preserved Attendance-specific permissions, archived/closed states, session
  actions, command failures, status-count sorting, column resizing, internal
  roster scrolling, and mobile access to QR/open/close/hours/refresh utilities.
- Refreshed Product Design evidence for desktop/mobile, light/dark, default,
  manual-with-Undo, whole-roster confirmation, and hours states. Updated only
  stale Attendance-specific durable guidance; generic selection guidance remains
  conditional on selection feeding real batch actions.
- One bounded independent review found that QR inbox history was filtered by
  classroom/occurrence but not the active installation. Added query-level and
  defensive payload installation checks plus a rotation regression fixture, so
  an old provider installation cannot supply the Check-in time or Undo target.
  The same remediation batch historicalized a stale Test evidence note that
  still described the now-removed Attendance selection bar as active debt.
- Composite-widget accessibility checklist reviewed: yes; keyboard behavior
  covered: yes; semantic state covered by tests: yes; remaining manual follow-up:
  none.

**Verification:** focused API/server/component/UI tests (43/43), responsive
Attendance Playwright matrix (4/4), TypeScript, lint, production build,
architecture check, design-policy check, Pika audit, diff checks, and visual
reference comparison pass. Student UI is n/a because this remains a teacher-only
surface.

**Model recommendation:** GPT-5.6 Terra/high for one bounded independent review
of requirements coverage, QR provenance projection, accessibility, and
responsive regression risk.

## 2026-08-27 — Revise teacher Attendance controls after Option 1 selection

**Risk profile:** standard application behavior — teacher Attendance interaction,
read-model projection, and shared segmented-control styling API changed; existing
authorization, session/mark commands, confirmation polling, schema, migrations,
dependencies, authentication, and student UI are unchanged.

- Removed Attendance row-selection checkboxes and the selected-student actions
  menu. Added square, tooltip-backed Present/Late/Absent whole-roster controls
  to the centered cluster; each opens an explicit scope confirmation before
  posting marks for all enrolled students.
- Replaced static row statuses with an accessible three-state segmented control.
  Row corrections are immediate and reversible, use icons plus `aria-pressed`
  instead of color alone, retain 44 px targets, and support roving Arrow/Home/End
  keyboard navigation through the shared `SegmentedControl` primitive.
- Replaced Source with QR Check-in time. The teacher read model validates Pika's
  existing signed `attendance.record.changed` inbox events and projects the
  earliest QR-origin time/status per student, so a later staff correction can
  expose Restore QR check-in without losing durable provenance. No provider
  reference or raw integration payload is returned to the browser.
- Preserved Attendance-specific permissions, archived/closed states, session
  actions, command failures, status-count sorting, column resizing, internal
  roster scrolling, and mobile access to QR/open/close/hours/refresh utilities.
- Refreshed Product Design evidence for desktop/mobile, light/dark, default,
  manual-with-Undo, whole-roster confirmation, and hours states. Updated only
  stale Attendance-specific durable guidance; generic selection guidance remains
  conditional on selection feeding real batch actions.
- One bounded independent review found that QR inbox history was filtered by
  classroom/occurrence but not the active installation. Added query-level and
  defensive payload installation checks plus a rotation regression fixture, so
  an old provider installation cannot supply the Check-in time or Undo target.
  The same remediation batch historicalized a stale Test evidence note that
  still described the now-removed Attendance selection bar as active debt.
- Composite-widget accessibility checklist reviewed: yes; keyboard behavior
  covered: yes; semantic state covered by tests: yes; remaining manual follow-up:
  none.

**Verification:** focused API/server/component/UI tests (43/43), responsive
Attendance Playwright matrix (4/4), TypeScript, lint, production build,
architecture check, design-policy check, Pika audit, diff checks, and visual
reference comparison pass. Student UI is n/a because this remains a teacher-only
surface.

**Model recommendation:** GPT-5.6 Terra/high for one bounded independent review
of requirements coverage, QR provenance projection, accessibility, and
responsive regression risk.

## 2026-08-28 — Consolidate selected-Test actions menu

**Risk profile:** none — teacher Test grading UI and shared menu focus behavior only.

- Moved Edit Test into the selected Test grading view's three-dot menu beside
  Delete Test on every viewport, and renamed the trigger tooltip and accessible
  label to More actions.
- Fixed shared work-surface menus to restore focus after Escape/click-away and
  to hand dialog focus back to the menu trigger after a menu action.
- Added component and browser coverage for menu contents, tooltip copy, focus
  restoration, and open-menu screenshots. Focused Vitest (70/70), lint,
  architecture boundaries, and the light/dark desktop/mobile grading matrix pass.
- Confirmed the selected-screen Active label is raw Test lifecycle state and can
  be misleading for archived Classrooms or fully closed student access; no status
  presentation change was included in this task.

## 2026-08-28 — Repair post-134 database lint findings

**Risk profile:** runtime-platform — replacement PL/pgSQL definitions for the
individual-student purge failure path and the legacy archive snapshot engine;
no persistent local, staging, or production migration was applied.

- Added migration 135. `fail_student_purge_object` now qualifies the joined
  retry expression as `object.attempt_count`, fixing the reproduced PostgreSQL
  `42702` runtime failure. The archive-v082 actor temp table was proven safe at
  runtime by the existing rollback regression; its lint finding was a
  `plpgsql_check` limitation, resolved with runtime-bound, explicitly
  `pg_temp`-scoped dynamic references while preserving archive behavior.
- Extended the rollback-only student-purge database fixture through the real
  storage-deletion failure path. It now proves object/operation failure state,
  error evidence, exponential backoff, lease cleanup, stale-lease rejection,
  and a fresh retry lease before successful completion.
- Independent high-risk review found and remediation added operation-first row
  locking plus post-lock live-lease validation, preventing a deadlock or stale
  failure write when an expired lease is reclaimed concurrently. A disposable
  two-session regression now proves the stale reporter waits, loses authority,
  and cannot overwrite the replacement lease or operation retry state.
- The disposable race harness accepts only its reserved database-name prefix
  and drops the database only after a successful create, so an unsafe override
  or pre-existing database cannot be removed during failed setup.
- Replayed migrations 001-135 from scratch in a disposable isolated Supabase
  project. Error-level database lint reports zero findings and is now an
  all-schema, fail-on-error CI gate; focused student
  purge and archive database contracts, generated database types, 5,172-test
  coverage, TypeScript, lint, architecture/UI/design policies, migration
  lineage, diff/shell checks, the Pika audit, and the production build pass.

**Model recommendation:** GPT-5.6 Sol for high-risk PostgreSQL migration and
static-analysis/runtime reconciliation.

## 2026-08-28 — Preserve linked Tests during Blueprint purge

**Risk profile:** runtime-platform — pending migration 134 trigger semantics;
no migration was applied, no database was reset, and no hosted state changed.

- Extended the owner-only provenance exception so Blueprint purge finalization
  may clear only `test_questions.source_blueprint_version_id` and `updated_at`
  after student work exists. Authored Test content and identity remain frozen.
- Added a transactional database regression covering an active linked Test,
  question, submitted attempt, and response. The old trigger fails purge
  permanently; the revised trigger completes purge while preserving all Test
  and student-work records and clearing only Blueprint lineage.
- Full Vitest passes (588 files, 5,168 tests), as do focused migration tests,
  lint, the production build, SQL diff validation, and transaction-only local
  before/after database proofs. Migration 134 remains unapplied to production.

**Model recommendation:** current frontier coding model for the bounded
PostgreSQL trigger and deletion-contract fix.

## 2026-08-28 — Complete Blueprint identity and database-lint rollout

**Risk profile:** runtime-platform — protected production release, hosted
migrations 134–135, and authenticated production Blueprint verification.

- Merged the reviewed Test-question identity and Blueprint purge corrections
  through production, then applied migration 134 after an exact clean preflight.
  Production migration history matched local through 134 and the production
  Blueprint capture/reuse smoke passed with a real disposable student attempt.
- The smoke verified portable Test-question identity and ordering across initial
  reuse and recapture/current reuse. Assignments, materials, and Tests copied;
  student enrollment, attempts, responses, submissions, grades, and activity did
  not. The source submission remained intact.
- Merged PR #1097 and applied migration 135 after a sole-migration production
  dry run. Production now matches local through 135, a second dry run is empty,
  and error-level database lint reports zero findings.
- Full PR CI covered migration replay, Test identity rehearsal, student-purge
  failure concurrency, archive recovery, browser matrices, 5,172 tests, lint,
  TypeScript, and the production build.

**Model recommendation:** GPT-5.6 Sol for production migration and concurrency
verification; GPT-5.6 Terra for release compatibility and continuity review.

## 2026-08-28 — Repair Classroom and Blueprint purge finalization

**Risk profile:** runtime-platform — migration 137 changes trusted purge trigger
semantics, cross-purge ordering, and retained retry evidence; production remains
unchanged and migration 137 is not authorized for hosted application.

- Reproduced the retained smoke failure against a production-schema clone. Hot
  Classroom purge deleted `test_questions` before `test_attempts`, so migration
  134's student-work freeze correctly rejected the direct question deletion.
- Migration 137 permits only owner-run whole-Classroom finalization to delete
  those questions; ordinary authored Test changes remain frozen. The database
  regression now includes a closed Test, question, submitted attempt, and
  response and proves the complete Classroom graph is deleted.
- Added explicit Classroom/Blueprint purge ordering. A linked purge fence blocks
  the second deletion from starting. One canonical lineage relation now covers
  direct, proposal, operation, and editing-session links for atomic advisory
  locking, conflict detection, and upgrade repair. Three synchronized two-session
  database races prove exactly one purge installs a fence for indirect links.
  The fixture identifies each backend, proves the coordinator owns the pair
  lock and both contenders are waiting before release, and runs in the CI
  Architecture Database Contracts job.
- Preserved the cold-Classroom lifecycle fence that migration 122 added. A
  rollback database regression proves both the shared guard and cold tombstone
  trigger still reject mutations while a cold purge is active.
- Legacy interleaved operations drain in Classroom-then-Blueprint order. The
  retained-failure repair now includes operation-only and editing-session-only
  links and is covered by a database fixture for both omitted upgrade shapes.
- Expanded both rollback-only purge contracts for linked versions, completed
  capture lineage, applied proposals, retained fences, and worker-role access.
  Before the rebase/resequence, a clean 001-136 replay, all four database
  contracts, 5,181 tests, lint, build, and database lint passed; lint reported
  only established warning-level findings. CI will replay the resequenced
  migration 137 after main's new migration 136.
- During the isolated replay, `supabase db reset --db-url` recognized the local
  container and recreated its default local database rather than the named
  disposable database. No hosted database was touched. The local database was
  a clean replay of the pre-resequence branch through its former migration
  136. No hosted environment was changed.

**Model recommendation:** GPT-5.6 Sol for migration, trigger, and concurrent
deletion review; GPT-5.6 Terra for compatibility and operability review.

## 2026-08-28 — Preserve linked Tests during Blueprint purge

**Risk profile:** runtime-platform — pending migration 134 trigger semantics;
no migration was applied, no database was reset, and no hosted state changed.

- Extended the owner-only provenance exception so Blueprint purge finalization
  may clear only `test_questions.source_blueprint_version_id` and `updated_at`
  after student work exists. Authored Test content and identity remain frozen.
- Added a transactional database regression covering an active linked Test,
  question, submitted attempt, and response. The old trigger fails purge
  permanently; the revised trigger completes purge while preserving all Test
  and student-work records and clearing only Blueprint lineage.
- Full Vitest passes (588 files, 5,168 tests), as do focused migration tests,
  lint, the production build, SQL diff validation, and transaction-only local
  before/after database proofs. Migration 134 remains unapplied to production.

**Model recommendation:** current frontier coding model for the bounded
PostgreSQL trigger and deletion-contract fix.

## 2026-08-28 — Restore selected-student Attendance actions

**Risk profile:** standard application behavior — teacher Attendance selection
and batch-action composition changed; existing permissions, command polling,
QR provenance, API/schema behavior, authentication, and student UI are unchanged.

- Restored row and select-all checkboxes plus the persistent Student actions
  menu, disabled with no selection and labeled with the selected count when
  enabled. Removed the superseded whole-roster Present/Late/Absent controls.
- Retained the inline per-student Present/Late/Absent segmented control,
  Check-in time, and QR correction Undo. Removed only the visible `Status`
  column-header label while retaining accessible sortable status counts.
- Preserved the joined date navigator, centered session/action hierarchy, quiet
  utilities, compact internally scrolling roster, sticky sortable/resizable
  headers, archived/closed-state permissions, and mobile action access.
- Refreshed desktop/mobile light/dark evidence for default, selected, open-menu,
  manual-with-Undo, and hours states. The Tailscale gallery on port 8792 was
  refreshed and left running. Durable guidance changed only where its
  Attendance-specific mapping described the superseded whole-roster direction.
- Composite-widget accessibility checklist reviewed: yes; keyboard behavior
  covered: yes; semantic selection, menu, sortable-count, and pressed-state
  behavior covered by tests: yes; remaining manual follow-up: none.

**Verification:** focused component/UI tests (25/25), responsive Attendance
Playwright matrix (4/4), TypeScript, lint, production build, architecture,
design policy, UI policy, Pika audit, diff checks, and combined source/rendered
Product Design comparison pass. Student UI is n/a because this remains a
teacher-only surface.

**Model recommendation:** GPT-5.6 Terra/high for one bounded independent review
of requirements coverage, selection behavior, accessibility, evidence, and
responsive regression risk.

## 2026-08-28 — Refine Attendance row status targets

**Risk profile:** low visual/composite-widget refinement — only the appearance
of the existing teacher row status targets changed; status semantics, commands,
permissions, selection, QR Undo, API/schema behavior, and student UI are
unchanged.

- Removed the check, clock, and x icons from each row's Present/Late/Absent
  targets and changed the three 44 x 44 targets from rounded squares to circles.
- Preserved fixed Present/Late/Absent order, semantic attendance colors,
  tooltips, named `aria-pressed` buttons, and roving Arrow/Home/End keyboard
  behavior.
- Added component and browser assertions for icon absence and circular geometry,
  then refreshed desktop/mobile light/dark default, selected-menu,
  manual-with-Undo, and hours evidence plus before/after comparison boards.
- No durable guidance changed because the treatment is Attendance-specific.
- Composite-widget accessibility checklist reviewed: yes; keyboard behavior
  covered: yes; semantic state, tooltip naming, icon absence, and geometry
  covered by tests: yes; remaining manual follow-up: none.

**Verification:** focused component/UI tests (20/20), responsive Attendance
Playwright matrix (4/4) with no browser/page errors, TypeScript, lint, Pika
audit, diff checks, and combined source/rendered Product Design comparison pass.
Student UI is n/a because this remains a teacher-only surface.

## 2026-08-28 — Strengthen Attendance selected-state clarity

**Risk profile:** low visual/copy refinement — only the visible size and selected
emphasis of existing teacher row status controls plus Attendance time formatting
changed; hit targets, status commands, permissions, selection, QR Undo,
API/schema behavior, and student UI are unchanged.

- Reduced each visible Present/Late/Absent disc from 44 x 44 to 36 x 36 while
  retaining its 44 x 44 interactive target and existing keyboard/focus behavior.
- Added a semantic primary ring and subtle shadow to the selected status; inactive
  states remain identifiable at lower emphasis in light and dark themes.
- Standardized session-window, Check-in, and QR-expiry times to uppercase AM/PM.
- Added component and browser assertions for disc geometry, selected/inactive
  styling, and time labels, then refreshed desktop/mobile light/dark evidence,
  gallery images, and matching before/after comparison boards.
- No durable guidance changed because the visual treatment and time copy are
  Attendance-specific.
- Composite-widget accessibility checklist reviewed: yes; keyboard behavior
  covered: yes; semantic pressed state, hit geometry, visible-disc geometry,
  selected ring, inactive opacity, and time labels covered by tests: yes;
  remaining manual follow-up: none.
- One bounded independent review found the browser regression test described the
  44 x 44 hit target without asserting its exact size. Added explicit tolerant
  width/height assertions and reran the four-project matrix successfully.

**Verification:** focused component/UI tests and responsive Attendance Playwright
matrix (4/4) pass; TypeScript, lint, Pika audit, and diff checks pass; CI and
bounded independent re-review are pending before handoff. Student UI is n/a
because this remains a teacher-only surface.

## 2026-08-28 — Finalize approved always-editable Attendance controls

**Risk profile:** low visual/composite-widget refinement — teacher Attendance
presentation and interaction placement changed without changing API/schema,
session/mark permissions, command polling, QR provenance, or student UI.

- Made the per-student Present/Late/Absent controls permanently visible within
  existing Attendance permission gates, removed their segmented track, and
  reduced inactive discs to 12% opacity while retaining the full-color selected
  disc and semantic blue ring.
- Aligned the three 36 px count pills with the three 36 px row discs on a fixed
  44 px target grid; retained accessible names, pressed state, tooltips, and
  keyboard movement.
- Replaced the trailing Attendance hours icon with a right-justified clickable
  session range using uppercase AM/PM and spaced-dash formatting. Added the
  approved clock fallback for dates without a session range and retained mobile
  hours access in the condensed action menu.
- Preserved checkboxes, the persistent disabled-until-selection Student actions
  menu, Check-in time, QR correction Undo, sticky sortable/resizable headers,
  compact internal roster scrolling, and Attendance-specific terminology.
- Refreshed the approved Product Design reference and desktop/mobile light/dark
  evidence for default, selection, menu, Undo, hours-dialog, and no-hours states.
  Durable design guidance did not change because the reusable work-surface rules
  already cover the shared hierarchy.
- Composite-widget accessibility checklist reviewed: yes; keyboard behavior
  covered: yes; semantic selection, pressed state, 44 px hit targets, 36 px
  status/count alignment, inactive opacity, time-control naming, and no-time
  fallback are covered by component/browser checks; remaining manual follow-up:
  none.
- One bounded independent review found no actionable issues. After rebasing onto
  the latest `main`, CI's governed-design check rejected an arbitrary minimum
  width; replaced it with the standard `min-w-40` token and confirmed design/UI
  policy checks locally.

**Verification:** focused component tests (17/17), responsive Attendance
Playwright matrix (4/4), TypeScript, lint, architecture boundaries, Pika audit,
diff checks, and same-viewport source/implementation Product Design comparison
pass. Student UI is n/a because this remains a teacher-only surface. Bounded
independent review passed; rerun PR CI remains before handoff.

## 2026-08-28 — Fit Attendance time and tighten row controls

**Risk profile:** low teacher-only visual/composite-widget refinement — no
Attendance commands, permissions, session state, QR provenance, API/schema, or
student behavior changed.

- Left-aligned the clickable Attendance time control and made it shrink to its
  content. Verified the full `Open · 12:45 AM - 10:34 PM` label without
  stretching the leading context track.
- Reduced each row Present/Late/Absent target from 44 px to 36 px and its visible
  disc from 36 px to 32 px. Matched the sortable count pills to the 32 px disc
  width and reduced the QR-correction Undo target so it does not hold rows open.
- Kept mobile Check-in time on one line so the reduced controls materially lower
  row height at the narrow viewport as well as desktop.
- Updated the live Open Design mock, approved reference, brief, Product Design
  QA, and desktop/mobile light/dark evidence. No durable guidance changed because
  these remain Attendance-specific density and placement choices.
- Composite-widget accessibility checklist reviewed: yes; keyboard behavior
  unchanged and covered; semantic names, pressed state, focus rings, tooltips,
  36 px target geometry, 32 px disc/count geometry, longest-time alignment, and
  compact row height are covered by component/browser checks.

**Verification:** focused component tests (18/18), responsive Attendance
Playwright matrix (4/4) with zero browser/page errors, TypeScript, lint,
architecture, design policy, UI policy, Pika audit, diff checks, and same-view
source/implementation Product Design comparison pass. Student UI is n/a.

## 2026-08-28 — Center Attendance time and further compact row controls

**Risk profile:** low teacher-only visual/composite-widget refinement — no
Attendance commands, permissions, session state, QR provenance, API/schema, or
student behavior changed.

- Moved the content-sized Attendance time control into the centered primary
  action cluster immediately after the joined date navigator.
- Removed the visible `Open` label and status dot. The open state now uses a
  subtle semantic success background while the accessible name still announces
  the state; mobile hours access remains in the condensed action menu.
- Reduced each row's visible Present/Late/Absent disc from 32 px to 28 px and
  matched the count-pill width. Preserved 44 px status and QR Undo hit targets,
  pressed state, focus rings, tooltips, and keyboard behavior.
- Refreshed the live Open Design mock, approved reference, change brief, Product
  Design QA, and desktop/mobile light/dark evidence. No durable shared guidance
  changed because the adjustments remain Attendance-specific.

**Verification:** focused component tests (18/18) and responsive Attendance
Playwright matrix (4/4) pass; same-viewport Product Design source and production
captures were reviewed together. Student UI is n/a because this remains a
teacher-only surface. TypeScript, lint, policy checks, Pika audit, and PR CI
pass. Bounded independent review found and prompted correction of a 32 px
hit-target regression, then confirmed the 44 px target/28 px visual treatment.
The final integration pass found no behavior blocker and identified two P3
documentation gaps: the teacher-view contract now records QR-origin provenance
fields with a route assertion, and superseded 36 px comparison captures are
explicitly marked historical. One targeted documentation confirmation remains
before handoff.

## 2026-08-28 — Restore Attendance time to leading context

**Risk profile:** low teacher-only visual refinement — no Attendance commands,
permissions, session state, QR provenance, API/schema, or student behavior
changed.

- Restored the content-sized clickable Attendance range to the quiet left
  context slot while keeping the date and action hierarchy centered.
- Limited the subtle success background to a confirmed open session. Closed,
  scheduled, cancelled, stale, and pending states remain neutral; the accessible
  name continues to announce the actual state.
- Added explicit light/dark closed-session browser captures and assertions, and
  refreshed the live two-state Open Design comparison, evidence record, and
  Product Design QA. Mobile continues to expose Attendance hours through the
  condensed actions menu.
- No durable shared guidance changed because this placement and open-only state
  cue are Attendance-specific refinements.

**Verification:** focused component tests (19/19) and the responsive Attendance
Playwright matrix (4/4) pass with explicit leading-placement, longest-label,
open-background, neutral-closed, stale, and pending assertions. Open and closed
source/production captures were visually compared in desktop light/dark; mobile
light/dark remained free of overflow. Student UI is n/a because this remains a
teacher-only surface.

## 2026-08-28 — Integrate Attendance redesign with timing rules

**Risk profile:** standard integration of a teacher-only UI with newly merged
Attendance timing and automatic-status behavior; no authorization boundary or
schema was added by this branch.

- Merged current `main`, including configurable Attendance timing rules and the
  reviewed Course Guide import, into the feature branch before final review.
- Preserved the approved compact roster and persistent selected-student menu.
  Mapped the new `Use automatic` and confirmed `Remove QR check-in` actions into
  that menu instead of restoring a separate bulk action bar.
- Updated per-row QR correction Undo to clear the manual override and reveal the
  timing-derived automatic status. Check-in time now comes from the durable
  check-in fact introduced by the timing work.
- Retained the leading session-time control, open-only success treatment,
  neutral closed/stale/pending states, compact 28 px discs in 44 px targets, and
  mobile condensed action hierarchy.
- Refreshed Product Design QA and desktop/mobile light/dark evidence for the
  integrated selected-student menu and Attendance timing dialog. No new durable
  shared design guidance was needed.

**Verification:** TypeScript passes; five focused Attendance test files pass
(40 tests); the integrated teacher/student Playwright matrix passes in all
eight desktop/mobile light/dark cases with no browser or page errors. Visual
comparison passed for default, selection menu, timing dialog, and dark/mobile
states. Final policy, lint, audit, independent review, and PR merge gates follow.

### Final-review privacy correction

- Independent review identified a merge-blocking provider-boundary leak: the
  timing integration exposed Bara's opaque `check_in_ref` in the Pika-owned
  teacher browser contract even though the UI only needed existence state.
- Replaced the public reference with provider-neutral `hasQrCheckIn`, retained
  `pendingCommand` separately, and updated selection filtering, removal
  confirmation polling, and per-row automatic-status Undo.
- Updated the typed session-route fixture, privacy assertions, builder tests,
  durable teacher-surface contract, and visual evidence record. Serialized view
  tests now explicitly reject private check-in references.

**Verification:** TypeScript and six focused Attendance test files pass (48
tests). The targeted browser matrix, policy gates, audit, targeted independent
confirmation, and GitHub checks follow before merge.

## 2026-08-28 — Define configurable Attendance timing semantics

**Risk profile:** runtime-platform — proposed Pika/Bara timing, lifecycle,
status, persistence, and versioned-contract behavior; no product code,
migration, deployment, PR, merge, production state, or Bara file changed.

- Completed the mandatory Pika startup contract in a fresh detached worktree at
  the fetched `origin/main` head `09bb0c54`; installed locked dependencies and
  passed `verify-env.sh`.
- Audited native Pika Attendance policy creation, Toronto/DST schedule
  materialization, teacher/student permissions, QR entry and idempotency,
  projections, persistence, API validators, and focused tests. The current v1
  model has only absolute open/close instants: every accepted QR scan becomes
  Present and closing finalizes Unmarked students as Absent.
- Inspected open PR #1094. It preserves teacher corrections and Undo while
  exposing original QR check-in time from signed Bara events, but it does not
  add timing cutoffs; reconciliation cannot yet recover immutable first-QR
  evidence if the original event was missed.
- Inspected `/Users/stew/Repos/bara` read-only at local `main` `f66850f`.
  Bara's server clock and Convex mutation are authoritative, the entry interval
  currently closes exclusively at `closesAt`, manual Pika corrections are
  allowed after close, and automatic close turns only Unmarked records Absent.
- Recommended separating session start/end, QR entry open/close, Present grace,
  and Absent finalization; using explicit boundary semantics and a v2 contract;
  preserving existing policies in legacy mode until a teacher opts in; and
  waiting for maintainer agreement before any implementation plan or change.

**Model recommendation:** GPT-5.6 Sol with high reasoning for the eventual
cross-repository, time-boundary, persistence, and compatibility implementation.

## 2026-08-28 — Implement configurable Attendance timing

**Risk profile:** runtime-platform — coordinated pre-release Pika/Bara contract,
PostgreSQL migration, QR acceptance ledger, derived status rules, and teacher UI;
no migration was applied and no PR, commit, deployment, or hosted state changed.

- Rewrote the shared v1 contract in place because neither integration is in use.
  Bara now receives only concrete `[accepts_at, stops_accepting_at)` gates and
  publishes authoritative accepted/invalidated check-in facts; it no longer
  assigns Pika Present/Late/Absent outcomes.
- Added Pika timing policy defaults and occurrence snapshots for session start/end,
  QR open/close, inclusive Present grace, and Absent cutoff. Frozen occurrences
  retain their policy after QR entry opens, including scans already accepted.
- Added Pika-side status derivation, audited teacher overrides with Undo, and
  audited individual/bulk QR check-in invalidation. Invalidation preserves the
  fact history and permits a new scan while Bara's gate remains open.
- Updated the teacher timing dialog, live roster timestamps/source labels,
  automatic-status control, removal confirmation, student confirmation reads,
  Toronto DST/cross-midnight handling, validation, reconciliation, and docs.
- Pika passed 591 files/5,180 tests, TypeScript, lint, production build, the
  repository audit, and an eight-case Playwright matrix covering teacher/student,
  desktop/mobile, and light/dark states. Bara passed 34 files/180 tests,
  TypeScript, and lint with only four generated-file warnings.

**Rollout note:** migration 138 remains unapplied and requires exact one-time
authorization. Deploy Pika's migration/API and Bara's matching v1 contract as a
coordinated pre-release cutover; there is intentionally no legacy compatibility
mode.

**Model recommendation:** GPT-5.6 Sol for the migration review and coordinated
cutover; GPT-5.6 Terra for bounded UI and contract follow-up.

## 2026-08-28 — Course Guide Phase 2 curriculum import

**Risk profile:** teacher AI-assisted content mutation — one-time PDF/public-URL
extraction into the live classroom-backed Course Guide; no ongoing Blueprint or
classroom synchronization. Migration 140 adds a durable provider-call lease and
rate window; it has not been applied to local or hosted state.

- Added an Import curriculum assistant to Guide options with explicit Source,
  Review, and Confirm steps. Teachers can upload a validated PDF up to 4 MB or
  provide a public HTTPS document URL, then edit the extracted overview,
  expectations, and useful links before anything is applied.
- Added a server-side structured Responses API extraction boundary with
  non-stored requests, untrusted-document instructions, bounded validated
  output, safe failures, and source provenance. The confirmed apply path always
  attaches the citation server-side so review edits cannot remove it.
- Preserved existing teacher content by appending the reviewed import, and used
  an expected-overview compare guard to return a conflict instead of silently
  overwriting a Course Guide changed during review.
- Applied the owner refinement that the Course Guide is orientation, not an
  activity feed. The shared teacher/student/public display model now contains
  only overview/resources visibility plus title-only Assignment and Test
  records. Lesson sequence, Announcements, instructions, dates, scores,
  statuses, documents, and grading details are absent from the payload and UI;
  their classroom features remain unchanged. Guide options exposes only the
  four orientation sections.
- Added domain, provider-boundary, API authorization/concurrency, component,
  fixture, and regression coverage. All 5,223 tests pass, along with lint,
  architecture, design/UI policy checks, production build, Pika audit, and diff
  validation.
- Visual verification passed 13 teacher/student/public checks across desktop
  and mobile, light and dark, covering the narrowed options, title-only lists,
  removed activity sections, source, editable cited review, confirmation,
  extraction failure, overflow, and absence of teacher controls for students.
- Independent review remediation lowered PDF uploads to the hosting-safe 4 MB
  boundary; added extraction timeout/output limits; moved apply authorization
  before body parsing; signed source provenance to the teacher/classroom;
  normalized and previewed the locked citation; preserved existing overview
  bytes; used raw classroom content when visibility is off; and cancelled stale
  client operations across classroom switches. Final hardening canonicalized
  public URLs, rejected credentials and control/format characters, emitted the
  locked citation as safe plain text, and removed redundant provenance-token
  fields so maximum valid inputs still fit the apply contract.
- Final merge review rebased the branch onto Attendance PR #1103 and closed the
  remaining provider-cost boundary: public curriculum URLs are fetched through
  the existing DNS-pinned, redirect-revalidated 4 MB document path before they
  reach OpenAI. A teacher-scoped database lease now permits one active extraction
  and three attempts per ten minutes across all deployed server instances. The
  confirmed write now also rechecks teacher ownership and non-archived state in
  the atomic update predicates.
- Updated production continuity to the user-confirmed baseline: production
  commit 530d444a with migrations through 136 applied and zero error-level
  database lint findings. Migration 140 was added but not applied to local or
  hosted state; nothing was merged or deployed.
- Recorded `epic-gradebook-general-breakdown` as separate future work for a
  general Attendance, Term Work, and Final breakdown; no mark breakdown was
  added to the Course Guide.

## 2026-08-28 — Stop feature branches from consuming Vercel deployments

**Risk profile:** runtime-platform — repository deployment-trigger configuration
only; no application behavior, database, or hosted state changed.

- Replaced the single-segment `*` deployment exclusion with recursive `**`, so
  slash-containing feature branches such as `codex/*` and `claude/*` are
  rejected before Vercel creates a deployment. `main` preview and `production`
  release deployments remain explicitly enabled.
- Added a regression test that locks the exact three-rule deployment policy.
  The focused test, lint, JSON policy assertion, and diff validation pass.

## 2026-08-28 — Clarify compact operational control targets

**Risk profile:** none — durable design guidance only; no product code,
behavior, schema, dependency, deployment, or hosted state changed.

- Clarified in the canonical design contract that dense visible control
  geometry may be smaller than its interaction geometry only while preserving
  a non-overlapping 44 by 44 CSS-pixel target and perceptible focus/state cues.
- Clarified the teacher operational-table contract for mutually exclusive
  inline statuses: inactive choices remain available but subordinate, while
  the selected choice combines domain color, semantic pressed state, and a
  non-color boundary.

**Model recommendation:** GPT-5.6 Terra for a low-risk, cross-page design
guidance clarification grounded in the reviewed Attendance implementation.

## 2026-08-28 — Release configurable Attendance timing

**Risk profile:** runtime-platform — coordinated Pika/Supabase/Bara production
release with protected-branch merges, exact Git-source deployments, and a
production Convex worker correction.

- Merged configurable Attendance timing through Pika production PR #1106 at
  `f895b240` and Bara production PR #49, followed by the worker correction in
  PRs #50/#51 at `8515a4ca`. Exact Git-source Vercel production deployments are
  Ready and own the stable Pika and Bara aliases.
- Verified production Supabase migrations 001–138 are aligned. Migration 138
  owns timing-policy persistence, occurrence snapshots, Pika-side status
  derivation, immutable accepted-check-in facts, and audited invalidation.
- Kept service ownership explicit: Bara enforces only the concrete half-open QR
  gate and records authoritative timestamps; Pika derives Present/Late/Absent,
  applies teacher overrides/Undo, and invalidates or clears accepted facts.
- Corrected Bara's scheduled worker after production logs exposed two paginated
  queries in one Convex transaction. The coordinator is now an internal action
  whose open and close pages run as separate mutations. Full Bara tests,
  typecheck, build, and lint passed; repeated production cron runs are clean.
- Restricted Vercel deployment creation in both repositories to `main` and
  `production`; slash-containing feature branches are rejected before a preview
  deployment is created. Main preview and production release paths remain on.
- Restored the configured canary teacher's missing entitlement through the
  separately authorized, audited production operation. The active revision-1
  grant has no expiry, classroom access returns `ready`, and the final deployed
  `enabled`/`teacher_entitlements` signed smoke passed 4/4 across canary scope,
  transition health, Pika-to-Bara authentication, and Bara-to-Pika callback.

**Model recommendation:** GPT-5.6 Terra for routine Attendance monitoring and
bounded follow-up now that the coordinated rollout is complete.

## 2026-08-28 — Build the automatic development-speed workflow

**Risk profile:** runtime-platform — CI selection, browser concurrency, AI PR
routing, and protected production-promotion behavior changed; no schema,
dependency, secret, or hosted state was changed.

- Measured the pre-change CI baseline: latest clean lanes took 4m41s for Test &
  Build, 7m32s for database contracts, and 9m08s for the browser matrix; the
  recent successful wall-time median was 563s, with 8 of 30 attempts cancelled
  after consuming about 41 minutes.
- Added a fail-closed, change-aware classifier and aggregate `PR Gate`. Draft
  pushes skip heavy work; docs/AI guidance uses the fast workflow-contract lane;
  application, database, and rendered-browser paths select their relevant lanes;
  unknown/runtime/CI paths and manual dispatches run the full suite.
- Made the draft-first stable-SHA lifecycle automatic for AI agents: focused
  local checks, draft PR, risk-matched review, batched remediation, one ready-SHA
  CI run, and return-to-draft before any correction push.
- Combined the three Playwright CI launches, moved the public Course Guide setup
  into deterministic seed state, and enabled two CI workers while keeping each
  spec internally serial. Added a reusable performance measurement command and
  rollout/rollback targets.
- Changed production promotion to reuse one cumulative draft PR and kept direct
  or noncanonical production PRs on fail-closed full CI. Repository ruleset
  replacement remains an explicit owner checkpoint after the workflow proves
  both docs-only and full classifications.
- Independent Sol/Terra review found and batch-remediated spoofable production
  provenance, deletion omission, over-broad runtime safe classification, a
  shared Playwright mutation, persistent production-worktree divergence,
  malformed aggregate selectors, and metrics that could not prove per-mode
  targets. Production abbreviation now requires same-repository head = current
  `main`; all other cases fail closed. Mutable publication coverage has a
  dedicated fixture, promotion worktrees are ephemeral, and metrics inspect
  actual `PR Gate` timing by classifier mode.
- A targeted remediation review then closed four remaining integration gaps:
  the helper now publishes the exact `origin/main` SHA even when production is
  divergent; all three aggregate selectors are validated together; fork PRs
  cannot enter promotion discovery; and unrecognized `.github` paths fail
  closed. Executable temporary-repository coverage exercises merge, squash,
  rebase, and subsequent promotion preparation.
- Validation on current `main` passed 77 workflow contracts, architecture,
  UI/design policies, TypeScript, lint, production build, actionlint, Bash
  syntax, Playwright discovery (93 tests), focused checks, and diff validation.
  Two full-suite attempts each passed 5,287/5,288 but exposed different
  non-repeating timing failures; both affected files passed immediately in
  isolation. The PAL timeout test now has scheduler headroom while retaining a
  strict bound. Final GitHub CI remains authoritative. Ephemeral database and
  real-browser execution remain selected for the final ready-PR run because
  local seed/migration application was not authorized.
- Tightened the Pika audit so newly introduced production `console.log` calls
  still fail without forcing unrelated edits to clean legacy logging elsewhere
  in the same file; regression coverage locks both cases.
- Final exact-SHA GitHub CI passed every selected full-mode safeguard: aggregate
  `PR Gate` in 7m34s, database contracts in 7m17s, Test & Build in 6m21s, and
  the combined browser matrix in 5m13s versus the 9m08s browser baseline.
  After owner approval, current `main` advanced through Course Guide limiter PR
  #1111; the speed-program PR returned to draft and merged that change while
  retaining its new database-contract step in the aggregate CI workflow.
- The next exact-SHA CI exposed a pre-existing archive visual test that packed
  20 context/navigation states into one 30-second case. Test & Build and database
  contracts passed, while all browser retries timed out even though an artifact
  snapshot showed the expected verified state arriving after the deadline.
  Split the four viewport/theme entries into separate internally serial tests,
  preserving every assertion and screenshot. The exact two-worker combined
  browser command then passed 82 tests with 14 intentional skips in 2.5 minutes;
  each split archive case passed first try in 4.3–10.2 seconds.

**Model recommendation:** GPT-5.6 Sol at high reasoning for the branch-protection
transition and initial post-rollout evidence review; use Terra for routine
follow-up once the aggregate gate is established.

## 2026-08-28 — Limit Test publication wording to the publish transition

**Risk profile:** none — teacher Test workspace labels and confirmation copy only.

- Removed the raw Draft/Active/Closed lifecycle indicator from the selected-Test
  workspace; publication state is no longer persistently labelled there.
- Renamed the irreversible Draft-to-Active confirmation to Publish test and made
  its one-way effect explicit while preserving the existing API lifecycle.
- Added component and browser coverage proving lifecycle wording stays absent
  from the workspace and publication wording appears in the confirmation only.
  Focused Vitest (70/70), lint, architecture boundaries, and eight light/dark
  desktop/mobile browser cases pass; screenshots were reviewed visually.

## 2026-08-28 — Separate Test publication from student access

**Risk profile:** runtime-platform — atomic publication RPC, teacher publication
and roster controls, and student Test-list visibility.
Migration 139 was applied to the local and production Supabase databases with
separate explicit authorizations; no application code was deployed.

- Moved Edit Test into the selected Test's three-dot More actions menu and
  removed persistent Draft/Active/Closed wording from the grading workspace.
- Added an irreversible Publish action to draft authoring. Publication validates
  and materializes the saved draft as a closed Test; direct Draft-to-Active
  requests are rejected. Open All and Close All now only change student access
  and remain disabled before publication.
- Published closed Tests now remain visible in the student list with a clear
  closed treatment, while not-started students cannot open them until access is
  granted. Once access opens, the card becomes actionable and the teacher's live
  grading refresh resumes even though the internal published-default status is
  closed. Submitted and returned work remains governed by the existing access
  contract.
- Added migration 139 with a service-role-only atomic publication RPC. It wraps
  draft materialization and the published-but-closed transition in one database
  transaction so a close failure restores the draft, materialized questions,
  and Classroom revision. Added a rollback contract script and CI wiring.
- Replaced the route's prior two-step activation/close sequence with that RPC
  and made the server fail closed if the result is not a closed Test. Repaired
  the publication browser fixture so it waits for the loaded editor and cannot
  pass while an editor-load error is present.
- Focused post-migration coverage passes (165 tests), as do lint, TypeScript, the
  production build, architecture, design-policy, UI-policy, managed-storage
  lineage, the Pika audit, shell syntax, and diff validation. The affected
  Playwright matrix passes 12 cases across teacher/student, desktop/mobile, and
  light/dark; all screenshots were reviewed and visual verification passed.
  The full Vitest run passes all 609 files and 5,264 tests.
- After the authorized local migration application, migration history is aligned
  through 139, the real success-and-forced-failure rollback contract passes,
  generated database types include the publication RPC and match the migrated
  schema, and error-level database lint reports no findings.
- After the separately authorized production application, remote migration
  history is aligned through 139 and read-only error-level database lint reports
  no findings. The fixture-writing rollback contract was not run against
  production.
- Independent high-risk review found three merge blockers. The remediation
  removes legacy active/closed lifecycle mutations from the generic Test PATCH,
  redacts document content and storage identifiers until a student can open or
  view submitted work, and derives the student Closed treatment from effective
  access so individually closed students no longer see a disabled New card.
  The browser fixture count now matches the one actually open Test.
- Post-remediation coverage passes 166 focused tests plus lint, TypeScript, the
  Pika audit, and four student desktop/mobile light/dark Playwright cases. The
  updated captures were reviewed and preserve a clear Closed treatment without
  overflow. A non-blocking lost-response publication-retry reconciliation is
  documented for follow-up because it needs a durable idempotency design beyond
  the already-applied migration.
- Final integration review found and corrected a partial-success failure path:
  if the published-closed Test query fails, the student list now returns 500 so
  the existing retry/stale-snapshot UI can preserve prior data instead of
  replacing it with a misleading active-only list. Regression coverage proves
  the request fails rather than emitting partial data.

**Model recommendation:** GPT-5.6 Sol for the migration transaction,
publication/access state boundary, cross-role UI behavior, and high-risk PR
review.

## 2026-08-28 — Resequence Course Guide import rate-limit migration

**Risk profile:** workspace-state/schema-numbering — migration filename and
references only; no SQL behavior, database state, or hosted environment changed.

- Rebased the merged Course Guide branch onto current `origin/main`, skipping
  the five feature commits already represented by squash merge `ba08bf52`.
- Preserved and restored the uncommitted database-backed import-rate-limit work.
- Resolved the active-worktree collision with the student Tests migration
  `139_publish_test_from_draft_atomic.sql` by renaming the Course Guide limiter
  to `140_course_guide_import_rate_limits.sql` and updating its tests and
  continuity references.
- Migration 140 remains unapplied. It must be rebased after migration 139 lands
  before any authorized local or hosted application.

**Model recommendation:** current frontier coding model for shared-worktree
preservation and migration-lineage coordination.

## 2026-08-28 — Apply Course Guide import rate-limit migration

**Risk profile:** runtime-platform — explicitly authorized local and production
application of migration 140; no deployment or unrelated migration application.

- Reconstructed the complete 001–140 migration directory in an isolated
  workspace because migration 139 remains in its separate student Tests
  worktree. Both target ledgers were already aligned through 139.
- Dry runs for local and linked production each proposed only
  `140_course_guide_import_rate_limits.sql`.
- Applied migration 140 locally, then verified the shared lease/concurrency and
  three-attempt window contract plus zero error-level database lint findings.
- Applied migration 140 to production. The production ledger is aligned through
  140 with zero error-level lint findings; an authenticated schema dump confirms
  the RLS-enabled table, constraints, security-definer functions with empty
  search paths, and service-role execution grants.
- The database-backed limiter application changes remain uncommitted and
  undeployed; production continues using the merged in-memory limiter until the
  code completes its own PR/review/release loop.

**Model recommendation:** GPT-5.6 Sol for the remaining migration-backed server
code review and rollout because it crosses provider-cost and database authority.

## 2026-08-28 — Harden Course Guide import rate limiting

**Risk profile:** runtime-platform — rolling teacher-wide provider-cost limit,
lease fencing, and explicitly authorized local and production migration 141.

- Added migration 141 to replace the fixed Course Guide import window with a
  rolling three-attempt/ten-minute history and extend extraction leases to 90
  seconds. Existing migration-140 rows are backfilled conservatively.
- Kept acquisition serialized with row locking and retained token-fenced release
  so an expired worker cannot clear a replacement lease.
- Added database-contract coverage for existing-row concurrency, rolling-window
  boundaries, conservative upgrade behavior, and stale-token replacement.
- Independent security re-review found no remaining blockers. Focused tests,
  TypeScript, lint, database type generation/checking, shell syntax, the Pika
  audit, and the live local database contract pass.
- With explicit target-and-migration authorization, applied migration 141 first
  to local and then production. Both migration ledgers are aligned through 141,
  error-level database lint reports no findings, and an authenticated production
  schema dump confirms the hardened function, constraints, and grants.
- The application changes remain pending their exact-head PR/CI/merge loop; no
  application deployment was performed as part of the schema application.

**Model recommendation:** GPT-5.6 Sol for the final exact-head CI and merge loop.

## 2026-08-28 — Consistent classroom work-surface controls

**Risk profile:** low — teacher/student presentation structure and shared
control composition only; existing domain behavior, routes, schema,
dependencies, deployments, and hosted state are unchanged.

- Added the shared app-level `DateNavigator` composition and adopted it in
  Daily, Attendance, and Calendar while leaving each feature's date logic and
  picker behavior local.
- Migrated every production consumer of the transitional floating teacher
  action bar to the anchored, mathematically centered
  `TeacherWorkSurfaceContextBar`: Classwork, Tests summary, Gradebook, Roster,
  Announcements, and Calendar. Existing commands and menu contents are
  unchanged.
- Preserved the floating layer token on the anchored context row so open menus
  remain above sticky operational-table headers; verified the Gradebook and
  Roster open-menu states explicitly.
- Documented the shared date-scope composition and removed the Calendar raw
  value/native-control exceptions made obsolete by the refactor.
- Visual verification passed teacher Calendar, Daily, Classwork, Tests,
  Gradebook, Roster, and Announcements across desktop/mobile and light/dark,
  plus student Calendar across the same matrix and student Classwork where the
  shared page was otherwise unchanged.
- All 608 test files / 5,254 tests pass, along with lint, architecture,
  design/UI policy checks, production build, and diff validation. The build
  retains the existing WorkOS Edge Runtime and browsers-data warnings.

No deployment or database operation was performed.

**Model recommendation:** GPT-5.6 Sol for the cross-surface consistency review;
GPT-5.6 Terra for bounded follow-up on an individual classroom surface.

## 2026-08-29 — Make local Pika startup supply safe runtime credentials

**Risk profile:** runtime-platform — local development process bootstrap and
secret handling only; no hosted configuration, database state, migrations, or
application behavior changed.

- Added a repository-scoped `pika-local-dev` skill so future agents launch Pika
  with a generated process-only session secret and credentials derived from the
  already-running local Supabase stack.
- Required loopback HTTP and trusted Pika Git-common-directory identity before
  reading or passing local Supabase credentials. Current and legacy Supabase key
  names are supported without adding a `jq` dependency.
- Disabled inherited shell tracing before sensitive reads and fail closed when
  OpenSSL fails or returns anything other than a 64-character hex secret.
- Cleared inherited Git repository selectors and required the canonical target
  to appear in the trusted Pika repository's registered-worktree inventory
  before the launcher reads local credentials.
- Added behavioral coverage for credential injection, key-format compatibility,
  missing-key diagnostics, untrusted-worktree and non-loopback rejection,
  trace redaction, secret-generation failure, stopped-stack failure, and
  check-only mode.

**Verification:** focused skill tests (12/12), live prerequisite check, Bash and
ShellCheck validation, and Codex skill validation pass.

**Model recommendation:** current frontier coding model for bounded local
developer tooling with security-sensitive environment handling.

## 2026-08-29 — Audit development-speed rollout after 20 CI attempts

**Risk profile:** standard — CI operating guidance and browser-test scheduling;
no product behavior, branch enforcement, dependencies, schema, migrations, or
hosted data changed.

- Measured the first 20 completed natural CI attempts after rollout commit
  `12336121b05ae55fa0ea97fb5bf81e21ff7b9f6a` at
  `2026-08-29T03:20:41Z` with `pnpm measure:ci -- --limit 20`. Exact output:

```json
{
  "sampleSize": 20,
  "successfulSampleSize": 8,
  "counts": {
    "cancelled": 3,
    "skipped": 9,
    "success": 8
  },
  "cancellationRate": 0.15,
  "cancelledElapsedSeconds": 116,
  "successfulQueueSeconds": {
    "min": 0,
    "p50": 0,
    "p95": 0,
    "max": 0,
    "average": 0
  },
  "successfulRunSeconds": {
    "min": 54,
    "p50": 464,
    "p95": 533,
    "max": 533,
    "average": 409
  },
  "successfulWallSeconds": {
    "min": 54,
    "p50": 464,
    "p95": 533,
    "max": 533,
    "average": 409
  },
  "successfulRunsWithoutPrGateEvidence": 1,
  "prGateByMode": {
    "application-test-build": {
      "sampleSize": 1,
      "timeToGateStartSeconds": {
        "min": 376,
        "p50": 376,
        "p95": 376,
        "max": 376,
        "average": 376
      },
      "gateRunSeconds": {
        "min": 3,
        "p50": 3,
        "p95": 3,
        "max": 3,
        "average": 3
      },
      "timeToGatePassSeconds": {
        "min": 379,
        "p50": 379,
        "p95": 379,
        "max": 379,
        "average": 379
      }
    },
    "docs-only": {
      "sampleSize": 1,
      "timeToGateStartSeconds": {
        "min": 49,
        "p50": 49,
        "p95": 49,
        "max": 49,
        "average": 49
      },
      "gateRunSeconds": {
        "min": 4,
        "p50": 4,
        "p95": 4,
        "max": 4,
        "average": 4
      },
      "timeToGatePassSeconds": {
        "min": 53,
        "p50": 53,
        "p95": 53,
        "max": 53,
        "average": 53
      }
    },
    "full": {
      "sampleSize": 4,
      "timeToGateStartSeconds": {
        "min": 460,
        "p50": 496,
        "p95": 528,
        "max": 528,
        "average": 486
      },
      "gateRunSeconds": {
        "min": 2,
        "p50": 4,
        "p95": 4,
        "max": 4,
        "average": 3
      },
      "timeToGatePassSeconds": {
        "min": 462,
        "p50": 500,
        "p95": 532,
        "max": 532,
        "average": 489
      }
    },
    "production-promotion": {
      "sampleSize": 1,
      "timeToGateStartSeconds": {
        "min": 393,
        "p50": 393,
        "p95": 393,
        "max": 393,
        "average": 393
      },
      "gateRunSeconds": {
        "min": 2,
        "p50": 2,
        "p95": 2,
        "max": 2,
        "average": 2
      },
      "timeToGatePassSeconds": {
        "min": 395,
        "p50": 395,
        "p95": 395,
        "max": 395,
        "average": 395
      }
    }
  }
}
```

- The initial checkpoint failed two targets: cancellation rate was 15% rather
  than below 10%, and full-mode time to PR Gate pass had a 500-second p50 rather
  than below 480 seconds. Docs-only passed at 53 seconds. The one successful run
  without PR Gate evidence was an intentional `workflow_dispatch` diagnostic.
- Inspected every skipped, cancelled, failed, and missing-evidence attempt. All
  nine skipped attempts were draft pushes with no heavy jobs. Two cancellations
  came from a production promotion opened ready by a stale personal skill; that
  skill now delegates to the repository's draft-first exact-main workflow. The
  third was a redundant manual dispatch launched beside the exact-SHA ready-event
  run; the workflow guidance now prohibits this concurrency.
- Two of four full-mode runs paid two 30-second timeouts in the single packed
  student-purge visual matrix before retry #2 passed. Split the unchanged
  desktop/mobile and light/dark teacher/student assertions into four separately
  timed cases. Local verification passed all four on the first attempt in
  2.4–8.8 seconds while retaining every screenshot path.
- Safety targets remained intact: both active branch rulesets still require the
  strict `PR Gate`; selected database/browser lanes fed that gate; unknown-path
  PR #1114 failed closed to full mode; browser specs and artifacts remained in
  the stable two-worker combined job; and production promotion #1115 ultimately
  passed in provenance-checked promotion mode from exact `main`.
- Because the initial checkpoint failed, the development-speed goal remains
  open. After this bounded remediation merges, collect 20 new natural attempts
  and repeat the complete audit before declaring success.

**Verification:** startup workflow contract (41/41), split Playwright discovery
(four target cases), local student-purge browser suite (6/6 including auth),
strict `main` and `production` ruleset inspection, and diff validation pass.

**Model recommendation:** GPT-5.6 Terra for the bounded CI/browser-test
remediation review and GPT-5.6 Sol only if the follow-up audit exposes a deeper
workflow or safety-lane defect.

## 2026-08-29 — Combine Daily and teacher Attendance

**Risk profile:** standard application behavior — teacher classroom navigation,
authoritative Attendance commands, responsive operational-table composition,
and existing Daily logs/summary; no schema, migration, hosted configuration, or
student Attendance behavior changed.

- Removed the standalone teacher Attendance destination and composed entitled,
  classroom-enabled Attendance hours, QR/session commands, selected-student
  actions, Check-in, and Present/Late/Absent controls into Daily.
- Preserved Daily date selection, First/Last/ID/Log sorting, resizable columns,
  log hover text, student-log inspection, and the dotted resizable Class Log
  Summary. The summary timestamp now omits “Generated,” uses the existing
  Toronto-relative formatter, and names its action list “Class log follow-ups.”
- Kept the Daily-only state stable when Attendance is unavailable or disabled:
  centered date navigation and a trailing More menu containing only Show/Hide
  ID. Legacy `?tab=attendance` links and new Blueprint classrooms resolve to
  Daily. Daily-log content never infers Attendance.
- Added production-path tests for entitlement/setting composition, status and
  bulk mark commands, session close, QR presentation, sorting, ID removal,
  menu/dialog focus, and preserved Daily split/resize behavior. Stabilized two
  unrelated Test-detail debounce assertions selected by the full dependency
  gate by asserting the immediate mirror update synchronously and holding the
  other assertion's 3-second autosave timer.
- Independent review identified that an accepted Attendance command could stay
  locally pending forever when provider confirmation arrived after the bounded
  foreground poll. Daily now keeps one cancellable background revalidation
  queue until authoritative success or terminal failure, then releases the
  affected controls. Non-retryable check-in invalidations are surfaced through
  the existing per-student failure contract. Request-scoped ownership rejects
  overlapping commands for a still-pending student, and a monotonic view
  generation cancels stale foreground work across A-to-B-to-A date transitions.
  Regression coverage confirms delayed success after the eighth read, terminal
  session failure recovery, overlap rejection, view-generation cancellation,
  non-retryable active-versus-invalidated check-in mapping, and controller-level
  rejection of mark/reset commands for students whose authoritative view still
  reports pending command ownership.
- Final integration review hardened four boundaries: Attendance hours remain
  reachable when the entitlement exists but the policy is disabled or missing;
  a current pending retry takes precedence over retained historical outbox
  failures; long-roster headers stay sticky inside the Daily scroll pane; and
  Escape closes the active action menu, restores trigger focus, and preserves
  the selected Daily log workspace. Direct controller, server-view, component,
  shared-menu, and browser-geometry regressions cover these cases.
- A subsequent cumulative review closed three more integration boundaries.
  The server projection now exposes authoritative session-command ownership so
  remounts cannot submit a duplicate open/close command. Selection and bulk
  mutations are intersected with the current Daily log rows, immediately
  pruning students hidden by a fresher Daily response. The rare QR check-in
  plus manual-override recovery action now stacks below the three 44px status
  targets inside a minimally wider status column instead of overflowing it.
  Focused controller, server-view, component, and browser-geometry regressions
  cover all three cases.
- Visual verification passed Attendance-on, unconfigured Attendance, and
  Daily-only teacher states on desktop/mobile in light/dark, including
  selection, hidden ID, open More menus, the sticky long-roster header, and the
  contained QR-override recovery row. The unchanged student Daily flow also
  passed in all four browser projects.
- Ready-PR CI exposed an action-menu focus race in the existing Tests workspace.
  Tooltip-wrapped icon menus now keep the same trigger mounted while their menu
  is open and suppress only the tooltip through one lifetime-controlled Radix
  state, so a dialog reliably captures and restores focus to its opener without
  an uncontrolled/controlled transition or retained hover state. The full Tests
  workspace file and a shared action-cluster modal round-trip regression cover
  the hosted failure.
- `pnpm check:focused -- --base origin/main` passes: workflow, architecture,
  UI/design policy, 228 changed-path tests, 1,868 related tests, TypeScript, and
  lint. The Pika pre-commit audit passes; the composite-widget checklist is
  covered by direct semantic, keyboard, focus, and resize tests.

**Model recommendation:** GPT-5.6 Terra high for correctness, requirements,
responsive behavior, and compatibility review of the complete PR diff.

## 2026-08-30 — Keep the light Pika favicon in every theme

**Risk profile:** none — root metadata and its focused regression assertion
only; no application behavior, schema, runtime configuration, or role-specific
surface changed.

- Replaced the theme-conditioned light/dark favicon metadata with one
  unconditional `pika-icon-light.svg` declaration so browser color preference
  cannot select the dark asset.
- Updated the existing middleware/favicon regression test to require the light
  icon, reject the dark icon from root metadata, and reject favicon media
  conditions while preserving the static-asset checks.
- Visual verification passed in headed Chrome: the same light mouse icon appears
  in the tab under light and dark color preferences. Playwright DOM checks also
  confirmed the unconditional light SVG on desktop and mobile. Teacher and
  student roles are not applicable because favicon metadata is global browser
  chrome.
- `pnpm check:focused -- --base origin/main` passes in application-browser mode,
  including workflow, architecture, UI/design policy, focused/related tests,
  TypeScript, and lint. The Pika pre-commit audit passes.
- Ready-PR CI exposed an existing Toronto-midnight rollover in the combined
  Daily/Attendance visual contract: a fixed August 29 timestamp was asserted as
  “Today” after August 30 began. The browser assertion now verifies the stable
  `10:10 AM` timestamp inside the summary while unit coverage continues to own
  relative-day formatting. The corrected scenario passed desktop/mobile in
  light/dark; one cold-start desktop fixture race passed on its immediate
  targeted rerun.

**Model recommendation:** current model for this narrow metadata-only visual
fix.
## 2026-08-29 — Align Classwork teacher action bars and Return icons

- Updated the Classwork teacher summary to keep `New Classwork` as its primary
  action and move organization/import controls into a trailing vertical More
  menu on the shared page action bar.
- Updated the assignment grading workspace to use a shared page action bar with
  layout controls, a selection-aware Student actions menu, and a trailing More
  menu containing Edit Assignment and Delete Assignment.
- Standardized teacher Return actions and returned-work status indicators on the
  Tests-page reply-arrow icon. Extended the shared action-menu item contract so
  the grade/comment copy actions retain their inspector hover/focus
  behavior.
- Renamed the selected-student grade/comment actions around copying and
  replaced generic overwrite prose with structured confirmations. The comment
  dialog previews only the exact comment; the grade dialog mirrors the grading
  card with category scores, total, percentage, and Draft/Final state.
- Added regression coverage for the new menus, selection-aware disabled states,
  checkbox semantics, Return icon consistency, and shared hover/focus callbacks.
- Visually verified teacher summary/workspace on desktop and mobile, both More
  menus, zero/one-student selection, light/dark modes, the corresponding Tests
  action menu, and unchanged student desktop/mobile views. Browser console checks
  reported no errors.

**Verification:** `bash scripts/verify-env.sh`; `pnpm check:focused -- --base
origin/main` (77 workflow, 124 focused, and 261 related tests);
`pnpm exec tsc --noEmit`; `pnpm lint`; `git diff --check`; Playwright teacher and
student desktop/mobile visual matrix.

## 2026-08-30 — Refine Classwork summary actions

- Replaced the Classwork summary's text-heavy `New Classwork` trigger with a
  compact plus control whose accessible name and tooltip are `New classwork`.
- Renamed the checked organization action to `Edit classwork` and kept `Edit
  Markdown` visible in the More menu whenever the Markdown editor capability is
  available, independent of edit mode.
- Preserved read-only and capability gating, existing menu semantics, focus and
  keyboard behavior, and unchanged student Classwork views.

**Verification:** 50 Classwork component tests; `pnpm exec tsc --noEmit`;
`pnpm lint`; Pika audit; `git diff --check`; Playwright teacher desktop/mobile
light/dark tooltip and open-menu states plus unchanged student desktop/mobile;
zero browser console errors. Composite widget checklist reviewed: yes; keyboard
behavior covered by the shared menu implementation/tests: yes; semantic state
covered by role and `aria-checked` tests: yes; remaining manual follow-up: none.
