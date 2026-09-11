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

## 2026-09-07 — Rebase atomic enrollment after prerequisite merge

- Rebased PR #1193 onto current main after #1187 merged. Main now owns migrations 155–158, so the enrollment source migration moved from 157 to 159 with its SQL unchanged. The earlier exact local authorization was consumed by the former 157 filename; the current local history is therefore evidence of the SQL behavior, not a clean 159 lineage replay. No migration was reapplied, repaired, reset, or promoted.
- Updated current enrollment guidance, harness messages, and static contracts to migration 159. A clean ephemeral replay, focused/type checks, the reserved fifth and final cumulative reviewer launch, and exact-head CI remain before readiness. Hosted application, route adoption, cohort activation, deployment, and production access remain unapproved.

## 2026-09-07 — Bind atomic enrollment responses to the requested classroom

- The reserved fifth cumulative Sol/high review found one merge-blocking response-boundary gap and one stale migration comment. Under the owner-approved review-budget extension, remediation batch 4 models exact created and already-enrolled success variants, models each failure code/status envelope, canonicalizes and binds the returned classroom UUID to the server-requested classroom, and rejects malformed or cross-class success as unavailable. Regression coverage proves wrong-classroom and inconsistent-status responses fail closed.
- Corrected the installed function comment to migration 159 and bound it with a static assertion. The three targeted suites pass 11 tests. One targeted security review and, if clean, one final cumulative review remain under the explicit extension; no local/hosted migration, route adoption, cohort, deployment, or production change occurred.

## 2026-09-08 — Resume privacy fix review for PR 1218

- User approved resuming the time-limited independent reviews. Both reviewers confirmed two blockers: Turkish/German case variants could evade name masking, and unknown batch-grading provider refs could reach durable Test-run errors. Batched fixes add folded matching with original grapheme-offset substitution and fixed unknown/duplicate-ref errors, preserving existing retry/classification behavior. Also corrected UTF-16-only initials for astral names.
- Added regressions for Turkish-I, sharp-S in both directions, Greek sigma, unchanged surrounding text/context, astral initials, and actual batch-adapter errors through saved Test-run items. Targeted tests pass 4 files / 75 tests. Focused gate, targeted privacy re-review and final cumulative integration review remain required before ready/CI. No migration, dependency, production setting or deployment change.

## 2026-09-08 — Make the Gradebook percent control a true toggle

- Kept the Gradebook `%` label visible in both states: pressed displays percentages and unpressed displays raw `x/y` marks. Added the requested `Show %` tooltip and explicit `aria-pressed` state.
- Updated the live Gradebook and Pattern Lab semantic coverage. Focused checks pass 21 files / 232 tests plus architecture, UI/design policy, TypeScript and lint; the Pika audit and 67 directly affected tests pass. Teacher desktop/mobile light/dark and on/off/hover states were visually inspected. Student view is not applicable because Gradebook is teacher-only.
- Composite-widget checklist reviewed: native button keyboard behavior is preserved, semantic pressed state is covered by tests, and no manual follow-up remains. Risk profile: none; no schema, data, API, dependency, or new shared component.

## 2026-09-08 — Rebase atomic enrollment after Gradebook toggle

- Rebased PR #1193 onto main `6dbc2fcf` after #1219 merged. Preserved main's Gradebook toggle and resolved only the shared continuity journal; migration 159, the enrollment adapter, generated types, database harnesses, CI wiring, and their tests are unchanged by range comparison.
- The previously reviewed exact-head CI was green before main advanced. Focused verification and fresh ready-PR CI must pass on the rebased head before merge. No reviewer launch, migration application, hosted change, route adoption, cohort, deployment, or production rollout occurred.

## 2026-09-08 — Sync privacy PR 1218 for authorized merge

- User authorized merging the reviewed privacy fixes. New main commits #1219/#1193 caused an archive-only conflict, so the PR returned to draft. Integrated current main without switching branches and preserved both continuity histories; the privacy implementation and regression tests remain byte-identical to independently reviewed `0e3ac63c`.
- Prior exact-head CI passed 6,423 tests, 154 browser checks (17 skipped), database contracts, build and PR Gate. Fresh focused checks, a bounded sync-only review and new exact-head CI are required before retrying the squash merge. No migration application or production deployment is authorized or performed by this sync.

## 2026-09-08 — Normalize Attendance timing minute inputs

- Updated all four minute fields in the teacher Attendance timing dialog to select their current value on focus, immediately normalize typed values so `05` displays as `5`, and hide native number spinner arrows without changing saved bounds or validation.
- Added focused interaction and styling coverage. The focused gate passes 15 files / 224 tests plus architecture, UI/design policy, TypeScript and lint; the Pika audit passes. Fixture-backed Playwright verification passes teacher desktop/mobile in light/dark, and a real browser check confirms clicking the zero value and typing `5` yields exactly `5`. Student is n/a because the dialog is teacher-only. No schema, API, dependency, or shared component change.

## 2026-09-08 — Resolve the second privacy PR history conflict

- Owner approved the review-limit checkpoint after #1220 landed during green CI. Integrated main `0fa59c42`, preserving both archive markers and unique history entries; privacy product code/tests and the incoming attendance fix are unchanged from their respective reviewed commits.
- Scope is one documentation-only integration review and fresh exact-head CI before authorized main merge. Prior exact-head CI at `0339c5da` passed all lanes and PR Gate. No migration, production deployment, or new security implementation is included.

## 2026-09-08 — Open blueprint-created classrooms directly

- Removed the post-instantiation “Classroom Created” review step. Successful Blueprint creation now closes the wizard and opens the new classroom's Assignments tab immediately while preserving the class-day review prompt and parent-list refresh.
- Updated component and browser coverage to assert the direct destination and absence of the old modal. Independent review caught that the removed modal had also named lesson plans that could not fit the calendar; remediation batch 1 now carries those titles into the classroom's existing review notice through a session-scoped handoff, while the no-overflow path retains the generic notice.
- Focused checks pass 18 files / 260 tests plus architecture, UI/design policy, TypeScript, and lint; the pre-commit audit passes. Visual verification passed for the teacher destination and overflow notice on desktop/mobile in light/dark themes. Student is not applicable because classroom creation is teacher-only. Composite checklist reviewed: pending-operation Escape protection remains covered, the removed dialog state adds no semantic or keyboard obligation, and no manual follow-up remains. Risk profile: none.

## 2026-09-08 — Diagnose and resolve the privacy PR merge disagreement

- Reproduced the remaining session-log conflict in an isolated Git clone with `.ai/SESSION-LOG.md` using normal text merging instead of the repository's local union rule. The earlier stale-GitHub explanation was incorrect: current main had another simultaneous log append hidden by local automatic union merging.
- Integrated main `e9c6417d` and explicitly preserved both histories. No new privacy or incoming-main product edits; existing independent reviews apply to their unchanged content. Verify parent equality, history preservation, normal-text mergeability and fresh exact-head CI before authorized squash merge. No production deployment or migration application.

## 2026-09-08 — Split-pane assignment editing

- Implemented the Pattern Lab prototype in the production assignment edit modal: desktop uses one-third details and two-thirds assignment authoring panes, while mobile stacks the same controls. Assignment creation remains unchanged.
- Reused the modal shell, title, Preview, Toronto due-date control, Post split action, submission-requirements editor, save status, and Markdown-safe editor. The formatting toolbar remains at the top of the right pane, and the panes use spacing instead of a vertical divider.
- Promoted the approved Pattern Lab action layout into production: Preview occupies a full-width details row below Title, while the equal-width Due/Post controls anchor to the bottom of the left pane (and remain the last details row on mobile). Removed the rejected editor-pane Preview variation so Pattern Lab and production share one split-edit contract.
- The focused gate passes 18 files / 266 tests plus architecture, UI/design policy, TypeScript, and lint; the Pika audit passes. Pattern Lab and the authenticated production edit modal were verified and visually inspected across desktop/mobile and light/dark, including Preview focus restoration. Student is not applicable because this is teacher-only editing. Risk profile: standard UI behavior.

## 2026-09-08 — Add announcement drafts and publication timestamps

- Added announcement draft persistence plus an explicit publication timestamp. Immediate posts record the posting time, scheduled announcements retain their scheduled publication boundary after going live, and drafts remain teacher-only across announcements, calendars, notifications and published course sites.
- Reused the existing announcement editor and SplitButton with a `Save draft` option and quiet `Draft · Saved …` status. Focused announcement/API/calendar/course-site coverage passes 120 tests; generated types match local migrations, lint/type/architecture/UI/design policy and the Pika audit pass. Visual verification covers teacher/student, desktop/mobile, light/dark and the open menu; the student never sees the draft.
- With explicit owner authorization, local migrations 159 and 160 were applied after a dry run showed exactly that set; hosted environments remain unchanged. The first full focused run exposed and fixed a course-site mock/defense-in-depth gap. Final focused coverage passed 437 of 438 tests; the same unrelated UiGallery test timed out only under the parallel suite and passed immediately in isolation. TypeScript, lint, architecture, UI/design policy, generated database types and the Pika audit all pass before draft PR publication and high-risk independent review.
- High-risk independent review found that migration 160's metadata backfill would have fired the legacy announcement update trigger and replaced historical edit timestamps. Remediation batch 1 now snapshots `updated_at`, disables only that trigger for the backfill, re-enables it, and fails the migration if any timestamp changed; 121 focused feature/migration tests, generated database types and TypeScript pass. Hosted data was never touched; the owner-authorized earlier local application used the pre-review migration text.
- Integrated current main `d48b1408` after PR #1223 landed during review. The rebase was conflict-free; range comparison confirms the two announcement commits are unchanged apart from surrounding continuity-log context. A bounded sync review and fresh exact-head verification remain before ready-PR CI.
- Exact-head CI replayed migration 160 and passed generated types/lint, but a later database harness exposed that the CLI commits between migration statements: the temporary timestamp snapshot had already dropped before the assertion. Returned PR #1224 to draft. Remediation batch 2 moves snapshot creation, trigger bypass, backfill and assertion into one atomic `DO` statement so it is independent of CLI statement-pipelining behavior; fresh exact-head database CI must validate it before readiness.
- Extended the experimental Owned/Joined home: Edit classrooms offers Archive for owned rows and Hide for joined rows; the shared Archived page lists Archived first and Hidden below, with distinct Restore/Unhide actions. Joined-only users retain access to Show Archived even after hiding their last row. Personal hidden IDs never change membership or classroom archival state.
- Added red-first component coverage for role-scoped actions, last-row recovery, focus, membership retention and owner-archived exclusion. Eight browser scenarios pass across both roles, desktop/mobile and light/dark, including measured section order and zero API mutations; screenshots inspected. Current evidence is in the experimental home guidance.
- Same prototype branch/PR #1178; risk profile none, standard-risk Terra/high independent review and final focused/CI evidence follow on the PR. No shared component, production route, database, deployment or merge changes are authorized. Live adoption remains separate.

## 2026-09-08 — Adopt the unified classroom QR poster in Daily

- Rebased `codex/unified-classroom-qr-prototype` onto current main and promoted its approved Daily interaction to the live teacher surface. Permanent-poster-enabled classrooms now use one centered `Classroom QR` action for display, print, and SVG download even while attendance is closed; classrooms outside the rollout retain the occurrence-specific `Show QR` fallback. Removed the duplicate poster entry from More actions and moved destructive rotation behind Poster settings plus confirmation.
- Reused the existing server-gated classroom QR APIs, authorization, stable handle, dialog contracts, and print portal. No API, database, migration, entitlement, or production configuration changed. Pattern Lab and the QR guidance now describe the adopted interaction.
- Focused component coverage passes 84 tests. Browser verification passes teacher desktop/mobile light/dark for poster, print, download, rotation/recovery, closed/scheduled/unconfigured states and occurrence fallback, plus student desktop/mobile light/dark open/closed/revoked/roster/error outcomes. Visual inspection caught and fixed a dark-mode SVG rendering defect by inheriting the fixed semantic QR foreground over the QR background; refreshed dark captures show a scannable dark-on-white code.
- The first ready-PR Test & Build run correctly rejected a fixed poster padding utility outside the registered QR geometry. Returned PR #1222 to draft, restored the governed 10% quiet zone with a semantic regression, and reran design policy, audit, 56 affected tests, and teacher desktop/mobile light/dark browser captures successfully. Targeted re-review and fresh exact-head CI remain.

## 2026-09-08 — Refine the classroom QR for monitor display

- Replaced the poster dialog's visible `Classroom QR` header with a responsive monitor-shaped composition: the large classroom name and one settings control occupy the left side while the scan-safe QR uses the maximum available height on the right. Compact screens stack the same content so the QR remains visible and contained.
- Moved Print poster beside Rotate QR inside the existing settings menu and removed the separate SVG download action. The print-only view now mirrors the landscape label-left/code-right composition; rotation retains its invalidation warning and recovery behavior.
- Focused component tests pass 78/78, TypeScript and UI/design policy pass, and the production Daily browser contract passes desktop/mobile in light/dark (4/4), including print and rotation recovery. The broad focused gate exposed one stale QR assertion, now corrected and covered by that 78-test rerun; its other failure passed alone and was unrelated Student Assignments timing. QR-specific Pattern Lab checks passed; its full broad run retained one unrelated Gradebook raw-score failure. All four poster captures and the print capture were visually inspected.

## 2026-09-08 — Center and expose classroom QR poster actions

- Centered and enlarged the classroom label in the poster's left pane, replaced the explanatory subtitle with a prominent `Scan Attendance` label and the configured attendance hours, and moved Print poster and Rotate QR from the settings menu into visible labeled buttons below the information.
- Preserved the maximum-height QR and 16:9 desktop monitor composition. Compact screens now use a portrait panel with vertically stacked actions so the larger content and full QR remain contained. The print-only poster mirrors the centered label, scan instruction, and hours without printing controls.
- Focused component tests pass 78/78; TypeScript, UI/design policy, design policy, and the Pika audit pass. Teacher desktop/mobile light/dark captures were visually inspected, and the production desktop poster/print plus mobile-dark poster/print were inspected. One full desktop browser scenario passed; three subsequent product-wide variants timed out in unrelated date/navigation steps under local server contention, after the mobile-dark run had already exercised and captured the revised poster and print state. Exact-head CI remains authoritative.
- Composite-widget checklist reviewed: shared dialog Escape/focus behavior is unchanged, both actions are native labeled buttons, semantic action/confirmation coverage is present, and no manual accessibility follow-up remains. Student view is n/a because this poster is teacher-only.
- Final targeted review found the stacked QR pane still claimed full height and could clip the lower Rotate QR edge at 390×844. Removed that mobile height claim in the live and Pattern Lab compositions, visually confirmed the full control and QR in compact dark mode, and added browser geometry assertions requiring both action rectangles to stay inside the dialog with Rotate fully above the QR.
- Split printing from the monitor composition: `@page` now requests portrait with zero page margin, the classroom name is centered at the top, the QR fills the main page area, and larger configured hours plus a subordinate `Scan Attendance` label sit below it. The desktop production browser flow passes with assertions for portrait page CSS and heading/QR/hours/subtitle vertical order; an actual CSS-sized PDF was rendered to PNG and visually inspected with no clipping or overlap.
- Post-print verification passes the 78 affected tests, TypeScript, UI/design policy, audit, and the complete desktop production browser scenario. The broad focused gate passed 1,591/1,592 tests before one unrelated UiGallery history hover test hit its five-second timeout; that file passed alone 8/8 immediately afterward. Exact-head CI remains authoritative.
- Restored the visible Download SVG action below the classroom information alongside Print poster and Rotate QR. It serializes only the live QR SVG with its governed quiet zone and excludes the portrait poster's classroom name, hours, and scan label. Component coverage inspects the downloaded SVG payload, and the production browser flow verifies the filename and desktop/mobile light/dark action layout; compact mode preserves a measured gap between Rotate and the QR.
- Simplified compact screen mode to the classroom title and a larger QR, with Print poster, Download SVG, and Rotate QR in the governed `QR options` menu. Desktop keeps Scan Attendance, hours, and visible actions in its left pane. The production browser matrix passes desktop/mobile in light/dark and covers the compact menu-open state; student is n/a because this is a teacher-only poster.
- Tightened compact screen spacing by centering the classroom title and QR as one group with a small fixed gap; browser geometry now constrains the visible title-to-QR gap to 8–32px. Mobile light/dark pass and were visually inspected; desktop and portrait print compositions remain unchanged.
- Returned the desktop Print poster, Download SVG, and Rotate QR actions to one governed `Poster settings` menu beneath the left-pane information. Compact mode retains its separate `QR options` menu; action handlers and export/print outputs are unchanged. Desktop light/dark closed and menu-open states were visually inspected, and both desktop themes plus compact dark pass the production browser flow.

## 2026-09-08 — Align the Owned / Joined home prototype with the live classroom list

- Updated only the development-only Pattern Lab Owned / Joined home: classroom rows now use the live themed gradient cards, current owner edit grip/archive treatment, the top-right classroom actions menu, and the archived owner Settings menu. Joined rows retain relationship-correct Hide/Unhide actions and never gain owner operations.
- Independent review found that the reused shared work-surface menu did not honor the repository's roving-focus and Tab-dismissal contract. The shared owner now handles Arrow/Home/End navigation, disabled-item skipping, Escape focus return and Tab dismissal; direct component and archived Settings regressions pass.
- Targeted re-review found that preview cleanup could retain a callback from before a parent rerender or drop a removed handler before clearing it. Active previews now refresh their callback by stable action ID and clear before a handler disappears; both regressions and the existing inspector compatibility case pass.
- Focused checks pass 44 files / 641 tests plus architecture, UI/design policy, TypeScript and lint; the Pika audit passes. Eight browser scenarios pass across teacher/student, desktop/mobile and light/dark with zero API writes. Visual inspection found and fixed a clipped archived Settings menu, then confirmed the corrected menu and classroom cards across the matrix. Exact-head review/CI are recorded on PR #1225.
- No production route, authorization, persistence, API, schema, entitlement, dependency or rollout availability changed. The prototype remains gated off in production and still requires later adoption approval; only the shared menu's existing keyboard behavior is corrected in live consumers.

## 2026-09-08 — Keep the classroom QR available when attendance is closed

- Promoted the stable classroom poster from its separate canary gate to every classroom with server-confirmed QR attendance access. The Daily center `Classroom QR` action now remains enabled while attendance is scheduled or closed; archived classrooms remain excluded.
- Preserved scan-time enforcement: Pika still requires an eligible occurrence, enabled attendance policy, active class day, open Bara session projection, current enrollment, and an active participant mapping before submitting a check-in.
- Focused verification passes 122 tests plus architecture, UI/design policy, TypeScript and lint. The attendance browser flow passes desktop/mobile in light/dark, including opening the poster from the closed state; all four closed-state captures were inspected. No schema, migration, dependency, hosted data, deployment, publish, or merge action.
- Draft PR #1226 independent review found stale environment/documentation references to the retired poster canary and a scheduled-state coverage gap. Remediation removes those obsolete settings, marks the old canary guidance historical, clarifies that migration 151 is required rather than falling back to the occurrence UI, and verifies scheduled and closed poster availability through successful permanent-QR rendering. The corrected focused gate passes 172 tests plus architecture, UI/design policy, TypeScript and lint; the production browser flow passes desktop/mobile in light/dark, and the Pika audit is clean. A reported migration-deployment-skew fallback was not implemented because the stable classroom handle has no safe legacy occurrence equivalent and migration 151 is already a documented deployment prerequisite.
- Current main advanced to `6c41deeb` during final review. Rebased PR #1226 and resolved its only conflict by retaining main's complete continuity archive; range comparison confirms the QR product and remediation commits are otherwise unchanged. Fresh focused verification, a sync-only final review, and exact-head CI are required before the authorized merge.

## 2026-09-09 — Dismiss the Daily student pane outside the table

- Daily now clears the selected student when the teacher clicks page-level controls outside the student table workspace; Escape and clicks elsewhere already use the same deselection path, while the student history pane remains interactive.
- Added component regressions for Escape, page background, date controls, More actions, dialogs, and in-pane clicks. Focused checks pass 13 files / 191 tests plus architecture, UI/design policy, TypeScript and lint; the direct component suite passes 51/51 and the Pika audit is clean.
- Playwright verification exercises selection, Escape dismissal, and outside-control dismissal at desktop/mobile in light/dark. The selected split/stacked layouts were visually inspected. Composite-widget checklist reviewed: keyboard behavior and semantic selection remain covered; no manual accessibility follow-up remains. Student role is unchanged and was captured by the standard UI verification script.

## 2026-09-09 — Keep manual attendance available for existing occurrences

- Daily now permits teacher-entered attendance and corrections for every existing occurrence state: scheduled, open, closed, and cancelled. QR session controls retain their narrower lifecycle rules, archived classrooms remain read-only, and dates without an occurrence remain unavailable because there is no attendance record to correct.
- Extended the existing attendance controller and reused the current row status buttons and Edit attendance dialog; no new component, API, schema, migration, dependency, entitlement, or hosted-data change.
- Focused component coverage passes 60 tests; the full focused gate passes 200 tests plus architecture, UI/design policy, TypeScript, and lint, and the Pika audit is clean. The teacher attendance browser flow passes desktop/mobile in light/dark, including the cancelled-state correction controls, and all four captures were visually inspected. The related student attendance matrix also passes across the same four view/theme combinations.

## 2026-09-09 — Show selected work titles in teacher action bars

- Added the selected assignment or test name as quiet, truncated left context in the teacher action bar above the student table. The Pattern Lab prototype mirrors production, and the rejected back arrow was removed; the parent Classwork/Tests tab remains the return path.
- Narrow teacher layouts place the readable title on a first row while preserving the work-mode and trailing controls below it. Desktop retains the centered one-line control hierarchy. Teacher desktop/mobile light/dark states were visually inspected; student is n/a because the changed workspace is teacher-only.
- Assignment, test, and Pattern Lab component coverage passes 149/149. The focused gate passes 18 files / 315 tests plus architecture, UI/design policy, TypeScript and lint; the Pika audit is clean.
- The first ready-PR browser matrix caught that the narrow-layout refinement left-aligned the primary control by 55px. Returned PR #1231 to draft and changed the mobile grid to keep the title on its own row while restoring the shared bar's mathematically centered primary column. The exact failing Test grading browser contract now passes in both mobile themes; targeted re-review and fresh exact-head CI remain.

## 2026-09-09 — Preserve attendance QR signup handoff

- Signed-out classroom attendance scans now retain their validated internal destination through login, classic signup verification/password creation, and WorkOS magic-auth signup, then return through a full navigation so the new session reaches the existing check-in boundary.
- Signup still grants no classroom enrollment or attendance access. Unsafe external continuations are discarded. Security review found that an older pending WorkOS signup challenge could retain classroom A after scanning classroom B; remediation resumes a pending challenge only when its sealed destination exactly matches the current safe path, otherwise requiring a fresh code.
- Cumulative review found the symmetric stale-challenge risk for ordinary sign-in. Remediation applies the same exact sealed-destination match to login, so a pending code for classroom A cannot resume after scanning classroom B. Final focused checks pass 33 files / 264 tests plus architecture, UI/design policy, TypeScript and lint; refreshed unauthenticated desktop/mobile visuals remain clean. Risk profile: high authentication navigation; bounded review checkpoint and exact-head CI remain before merge.

## 2026-09-09 — Prepare outbound transport hardening

- User reports students checked production with no issue and asks to continue; recorded as user-reported acceptance, not an agent-run draft/schedule canary. Prior privacy release #1227 is deployed.
- Created isolated `codex/outbound-transport-hardening` from main `6173d863`, checked active tasks/PRs for overlap, installed locked dependencies and passed environment verification. Confirmed existing redirect-policy and optional Gradex URL/error-boundary gaps; documented the scoped next package in the student-data egress audit.
- Paused at the session-start concrete-plan approval gate. No source implementation, tests, new PR, migration, feature-flag or production change in this preparation step.

## 2026-09-09 — Implement approved outbound transport hardening

- User approved the scoped package. Eight authenticated runtime OpenAI/Brevo/Pal/Gradex request sites reject redirects. Optional Gradex requires an HTTPS origin, with loopback HTTP allowed only in explicit development; its HTTP/parser/mapping diagnostics discard provider-controlled content, and request timeouts cover response-body consumption.
- Synthetic loopback regressions first reproduced redirect forwarding and now prove no second-destination requests. URL, safe-error, retry and timeout regressions added; full focused checks and independent review gate publication/readiness. No real provider requests, student records, migration, feature flag or production change.
- Initial fixed-head Sol/security and Terra/compatibility reviews approved without findings; bounded local checks passed 1,758 tests and all CI jobs passed (two browser cases passed on retry). After owner merge approval, main advanced through #1231 and conflicted only in this shared log. Rebased while draft, preserving both tasks and unchanged transport implementation; targeted integration review and fresh exact-head CI gate the merge. No migration files changed or stash created.

## 2026-09-09 — Resume final outbound transport merge sync

- The first sync passed targeted independent review, 1,758 local tests, static checks and all CI jobs, but #1233 landed during CI and conflicted in shared continuity logs. User authorized another final sync with a brief hold on other main merges.
- Preserved both tasks' entries and main's archive history while rebasing onto `8698cb95`; transport source and tests remain unchanged. A bounded rebase review, local checks and exact-head CI gate the authorized main merge. Production rollout remains separate; no migration or hosted-data changes.

## 2026-09-09 — Remove counts from Owned / Joined prototype headings

- Removed the numeric totals beside Teaching, Joined, Archived and Hidden in the development-only Owned / Joined Pattern Lab prototype. Filters, semantic regions, classroom cards and actions are unchanged.
- Added component coverage that requires the active Teaching and Joined group headings to contain only their labels. The existing browser scenario passes for teacher/student across desktop/mobile and light/dark, and all eight default grouped-list captures were visually inspected.
- Risk profile: none. No production route, API, authorization, persistence, entitlement, schema, migration, dependency or rollout availability changed.

## 2026-09-10 — Adopt contextual enrollment in the guarded join route

- Merged prototype heading cleanup PR #1236, synchronized main, and started the next compatibility-batch-C slice in an isolated worktree.
- The regular join endpoint now authenticates before body parsing and preserves the existing student path unless the exact mixed-role pilot flag and user/classroom pair are configured. The contextual branch scopes code resolution to that pair, evaluates server-built relationship/roster evidence, creates membership only through migration 159's atomic transaction, projects no code/owner data, and allows direct classroom IDs only to recognize an existing membership.
- Added a service-only rejected-guess wrapper to migration 159 so invalid, out-of-scope and pre-atomic policy-denied non-empty codes consume the same actor and actor-invitation windows. Exact normalized server comparison rejects wildcard/prefix patterns. Successful joins retain atomic roster, binding, profile and optional Pal outbox writes; immediate Pal delivery occurs only for a newly committed membership and uses the same event instant.
- Independent security and compatibility review found and cleared bounded-input, post-lockout denial-oracle and wildcard-pattern issues. Focused verification passes 104 files / 1,102 tests plus architecture, UI/design policy, TypeScript and lint; the Pika audit and database-harness shell syntax pass. The rollback-only database harness was not run because the revised, resequenced migration 159 has not been applied under a new exact local permission. No migration, cohort, flag, hosted data, deployment or production availability changed.

## 2026-09-10 — Correct contextual enrollment migration lineage

- Verified that local and production databases already record migrations 159 and 160. Both expose migration 159's atomic join foundation and migration 160's announcement fields, but neither has the rejected-guess wrapper later added to the already-applied 159 source.
- Restored migration 159 byte-for-byte to its deployed definition and moved the rejected-guess wrapper plus adopter comment into additive forward migration 161. Updated current access guidance, database-harness prerequisites and static migration contracts to preserve the boundary.
- Targeted coverage passes 24 tests; the focused application/database gate passes 99 tests plus architecture, TypeScript and lint. The complete database harness passes with migration 161 installed inside one rollback-only transaction, and the function is absent afterward. The Pika audit is clean. No local or hosted migration was applied, no cohort or flag changed, and current production requests remain on the legacy path.
- Initial high-risk review found no security or migration-design defect, but identified two verification gaps. Remediation pins migration 159's deployed SHA-256 and makes the database-type preflight parse both current JSON and legacy table migration-list output, with fixtures proving pending migration 161 fails before type generation. Targeted coverage passes 13 tests; focused revalidation and targeted compatibility review remain.
- Targeted compatibility review cleared that batch. Final cumulative review then found recognized but empty/malformed JSON could still pass as matching history; remediation batch 2 now requires a nonempty migration array and strict string `local`/`remote` fields with at least one numeric side. Malformed, renamed, empty and non-string fixture coverage passes; the focused gate passes 106 tests plus all static checks.
- The approved extended final review and targeted parser re-review cleared the cumulative diff. Exact-head CI then found one stale attendance contract still pinned `.ai/CURRENT.md` to production migration 156; remediation batch 3 updates that assertion to the independently verified 160 boundary. The affected 47 tests and focused 110-test/static gate pass. The PR remains draft pending an additional targeted review authorization and fresh CI.

## 2026-09-10 — Separate classroom joining from attendance QR

- Replaced the draft attendance-driven enrollment design with two explicit flows. Teachers share a roster-matched `Join this classroom` link/QR from Settings > Access; students authenticate, join only on one safe existing roster match, and see an explicit joined/already joined/no match/ambiguous result. The join operation reuses migration 159's atomic transaction and does not record attendance.
- Classroom attendance QR is read-only for nonmembers: an existing enrollment plus active participant can check in, while a rostered nonmember, roster miss, conflicting identity, closed window, or revoked token receives a distinct non-writing result. Attendance never enrolls, binds, synchronizes sources, or offers an inline join action.
- Updated Daily/live/poster wording to `Check in for attendance`, added governed join/attendance guidance and a teacher access fixture, and visually inspected desktop/mobile light/dark join QR and student result captures. Browser contracts pass 10/10 across the two focused scenarios; focused checks pass 35 files / 431 tests plus architecture, UI/design policy, TypeScript and lint, and the Pika audit is clean. No migration was added or applied; no hosted data, configuration, dependency, deployment, or production state changed. Independent fixed-head review and exact-head CI still gate readiness.
- Initial independent review found an existing Dashboard UUID-link compatibility break, an unbounded attendance roster read, and a case-sensitive join prelookup. Remediation preserves issued UUID links while making all new teacher links code-based, and uses wildcard-safe maximum-two server-side candidate reads for join and attendance identity classification. Targeted compatibility re-review approved the first fix; targeted security re-review and fresh exact-head gates remain.

## 2026-09-10 — Make manual attendance optimistic

- Manual attendance status changes now render immediately while the existing API write completes. A failed first write restores the exact prior overrides; a partially saved class-wide batch retains the existing authoritative refresh and warning behavior.
- Added hook regressions for pre-response projection and rollback, plus a browser scenario that holds the write open and verifies the selected status across teacher desktop/mobile and light/dark. Student is n/a because this interaction exists only on the teacher Daily surface.
- Focused verification passes 199 tests plus architecture, UI/design policy, TypeScript and lint. The Pika audit is clean, and all four optimistic-state captures were visually inspected; one desktop-light Playwright teardown timed out after the body passed and then passed cleanly alone.
- Independent review found that a partial-save recovery refresh could finish after a date switch and show the old date's warning in the new scope. Remediation rechecks mount and scope after the awaited refresh; the delayed-refresh/date-switch regression passes with the hook suite 8/8.
- Final cumulative review found two remaining recovery edges: an A-to-B-to-A scope cycle could reuse the same value key, and a failed recovery read could leave the unsaved optimistic tail visible. Remediation binds rollback/notification to the original command ID and reconstructs only server-acknowledged chunks when refresh fails, with focused regressions for both scope cycles and failed reconciliation.
- Post-remediation focused verification passes 203 tests and all static checks; the optimistic browser scenario passes desktop/mobile in light/dark 4/4 on the updated tree.

## 2026-09-10 — Put roster removal in Student Actions

- Moved student removal from page-level More actions into the centered selection-aware Student Actions menu. Direct row selection now enables the same menu as checkbox selection.
- Unified the teacher-facing behavior after product clarification: removing a joined student uses the existing comprehensive purge, which also removes roster membership; unjoined invitations retain the lightweight roster-only path because no classroom data exists. The duplicate purge menu item is gone. Joined students must be removed one at a time for per-student impact review and typed confirmation, and unavailable comprehensive removal fails closed instead of falling back to partial deletion.
- The comprehensive dialog now consistently uses removal language and states that all classroom data is permanently deleted while the account and other-class data remain. Independent review found a join-after-page-load race in the legacy lightweight endpoint; forward migration 162 now serializes with classroom joining and rejects joined targets before any deletion, while the UI refreshes into the comprehensive flow. Targeted re-review found the legacy UUID-link enrollment path did not share that lock, so new direct-ID enrollments now use the existing atomic join transaction while already-enrolled compatibility links remain supported. The migration was not applied locally or remotely. Targeted race/API/migration/join coverage passes 70/70; the focused application/database/browser gate passes 19 files / 220 tests plus architecture, UI/design policy, TypeScript and lint. The Pika audit was clean before this follow-up. Teacher desktop/mobile light/dark menu, confirmation, and progress states plus the student authorization boundary pass the six-test browser matrix with no horizontal overflow.
- Exact-head CI exposed an older cross-operation database check that still expected lightweight roster removal to delete joined memberships. The contract now explicitly requires that call to fail atomically and preserve both joined roster and enrollment rows for the comprehensive purge path; the focused 220-test/static gate remains green. The PR returned to draft before this correction and requires fresh exact-head CI.

## 2026-09-10 — Standalone Gradebook items

Implemented original standalone items/scores, explicit return/retraction, teacher desktop/mobile editing, and returned-only student Classwork entries. No live student Grades aggregate exists; contract documented in standalone-gradebook-items.md. Migration 161 prepared; persistent databases untouched. Isolated ephemeral replay/types, weighted/API/interaction checks, actual archive-compaction-restore equality, and student-purge preservation passed. Teacher/student light/dark desktop/mobile screenshots and real create-score-return-clear flow verified. Draft PR and independent review follow before ready handoff; no merge/deployment permission.

## 2026-09-10 — Finish standalone Gradebook browser contract correction

- User approved extending the bounded review after the first full CI run passed tests/build and database contracts but caught an ambiguous Pattern Lab assertion in eight role/view/theme cases. Scoped the existing Grades assertion to its preview and independently checked the standalone Not counted label and absence of feedback links; product behavior is unchanged.
- The two earlier independent-review findings are corrected: category removal retracts returned marks, and identical score saves preserve return state. The extension permits one test-only correction, focused verification, one Terra review, and fresh exact-head CI. No merge, deployment, or persistent migration application is authorized.

## 2026-09-10 — Synchronize standalone Gradebook with corrected enrollment lineage

- User approved the final synchronization after main PR #1239 consumed migration 161 during the previously successful CI run. Rebased onto d0a23a4b, preserved both continuity histories, and renamed the standalone migration to 162 with matching database-contract and rollout references. Product logic remains unchanged.
- The previous reviewed head passed all CI lanes and PR Gate; this synchronized candidate requires a fresh disposable combined-history replay/types check, focused verification, one approved independent review, and new exact-head CI. No merge, deployment, or persistent migration application is authorized.

## 2026-09-10 — Clarify other assessment creation in Gradebook

- Renamed creation to “Add other assessment” and moved it into the existing More actions menu on desktop/mobile; added the requested dividers after Edit categories and before Export gradebook. Updated production and Pattern Lab together; the creation dialog explains that Classwork and Tests appear automatically.
- Reused the shared action menu and item editor; no new shared pattern. Teacher-only refinement (student n/a); menu/dialog, keyboard opening, disabled-item skipping, Escape/focus return verified. Desktop 1440×900 and phone 389×843, light/dark captures reviewed in `/tmp/pika-other-*`; full-page captures worked around blank viewport captures. Existing Gradebook menu is the reference; primary signal is its secondary action label.
- `VITEST_MAX_WORKERS=2 pnpm check:focused -- --base origin/main`: 855 tests/73 files and all static checks passed. Pika audit passed. No migration or deployment.

## 2026-09-10 — Order and group Gradebook menu actions

- Put Edit categories first with the existing Lucide Settings icon, followed by Add other assessment. Per the final user direction, the first divider follows Add other assessment; the export divider stays in place. Production and Pattern Lab match. Reused the existing menu/icon pattern; teacher only, student n/a.
- Keyboard regression expectations now cover Edit categories as the first item and ArrowDown to creation. Focused gate: 855 tests/73 files plus all static checks pass; audit passed. Final menu screenshots reviewed at desktop 1440×900 and phone 389×843, light/dark (`/tmp/pika-menu-final-*`). No shared behavior, schema, or deployment changes.

## 2026-09-10 — Synchronize Gradebook with main through PR 1241

- Rebased standalone Gradebook onto main `007b516a`; only archive-log batch-marker conflicts required resolution, preserving all entries. Code/test patches remain equivalent. Main now owns migration 162, so renamed byte-identical standalone SQL to `163_standalone_gradebook_items.sql` and updated harness/restore/rollout references. No stash was needed or popped.
- The combined history preserves main's joined-roster removal guard. Extended the rollback-only Gradebook contract to require that rejection before exercising orphan-score cleanup after fixture enrollment removal. Fresh disposable 001–163 replay, standalone archive/restore contract, comprehensive student purge, generated types equality, and warning-free database lint pass.
- `VITEST_MAX_WORKERS=2 pnpm check:focused -- --base origin/main` passes 856 tests/73 files and all static checks; audit passes. Gradebook UI/source is unchanged by the rebase, retaining the reviewed menu/icon/divider evidence. Persistent migration application, merge, and deployment remain separate owner actions.

## 2026-09-10 — Close join-limiter maintenance release prerequisite

- Cumulative review of authorized production promotion #1242 found ordinary class-code joins now use the limiter, but its required scheduled cleanup/health owner was missing. Added a bounded call to migration 159's existing service-only cleanup RPC within the already authenticated nightly history cron; no new migration, schedule, secret, or runtime flag.
- One 10,000-row batch deletes only database-qualified entries older than one day. Database/transport errors, invalid results, and exhausted batch capacity fail the existing durable cron ledger with a sanitized code; successful calls log only the aggregate count. Targeted tests cover auth, health recording, valid/invalid/capacity responses, and failure sanitization. Risk profile runtime-platform; one Terra/high targeted review of the bounded maintenance addition, then cumulative promotion confirmation.

## 2026-09-11 — Restore classroom join controls

- Restored the visible/copyable join code and roster-only policy switch in Settings > Access, added the join code to the classroom QR dialog, and restored the open-join student profile step while preserving the separate attendance QR boundary.
- Reused the Settings Pattern Lab composition and shared switch, dialog, QR, field and input owners. Teacher/student desktop/mobile light/dark browser coverage passes for roster-only, open-join, QR-open, profile-required, success and error states; screenshots were visually inspected with no overflow. Composite checklist reviewed: keyboard behavior and semantic state are covered, with no manual follow-up.
- Focused unit/API coverage passes 61 tests, the rollback-only contextual enrollment database contract passes, the Pika audit passes, and the application/database/browser focused gate passes 211 tests plus architecture, UI/design policy, TypeScript and lint. No migration, dependency, hosted data, configuration or deployment change.
- Independent review found two compatibility gaps in open joining: Attendance code entry could not continue when a profile was required, and legacy UUID join links dropped submitted profile fields. Attendance now hands off to the canonical profile-aware join page, UUID retries retain the profile, and both paths have component regressions. The remediated focused gate passes 218 tests plus architecture, UI/design policy, TypeScript and lint; final integration review follows on the stable head.
- Final integration review found that trimming the Attendance handoff could break space-padded legacy codes already accepted by the bounded server fallback. The handoff now URL-encodes the exact entered code and its regression retains surrounding spaces. The default five-launch review budget is exhausted after this correction, so the PR remains draft pending an explicitly authorized final-review extension.
- Simplified the join QR at owner direction to reuse the attendance display modal's `max-w-6xl`, portrait-mobile and widescreen-desktop frame and QR scale. The dialog now shows only the classroom name, join-code label/value, Copy link, QR, and close control; all introductory/instructional text is removed. Teacher desktop/mobile light/dark open-dialog screenshots were inspected, QR contrast is asserted in both themes, and the student role is unaffected.
- Extended review raised possible clipping at 390×844, but explicit bounds for the wrapped classroom title, join code, Copy link, and complete QR all remain within the dialog in mobile light/dark runs, matching the inspected captures. The claim was rejected as unsupported; the bounds assertion remains as a responsive regression.
- Final integration review found the Attendance profile handoff spent a second rate-limited probe before profile submission, leaving no budget for one transient retry. The handoff now carries a non-authoritative profile-required UI hint, skips only that redundant client probe, preserves the exact code, and still submits the profile through the authoritative join endpoint. Rate-limited profile responses show the server retry delay instead of claiming an immediate retry is safe; integrated component and browser regressions cover the three-attempt sequence and wait message.

## 2026-09-11 — PR #1245 reviewed-blocker continuation

- Explicit handoff: this task owns `codex/restore-classroom-join-controls`. Fixed History retry-delay feedback and Settings copy-code accessible name; added component regressions and History browser fixture coverage.
- Validation: 54 affected component tests, focused gate 221 tests plus architecture/UI/design/TypeScript/lint, audit, and 8 browser cases across desktop/mobile light/dark passed. Visual captures inspected. Fresh cumulative independent review and exact-head CI/merge follow; no migration or deployment.

## 2026-09-11 — PR #1245 cumulative review remediation

- Sol found one explicit compatibility gap: raw Settings join URLs could drop legacy trailing spaces. Encoded the path segment and added Settings link/QR/copy regressions; Terra's initial cumulative review had no blockers.
- Validation: new regression reproduced failure first; focused gate 222 tests plus architecture/UI/design/TypeScript/lint passed; 4 join-flow browser variants passed again. Targeted and final integration review follow on the corrected commit.
