# Pika Session Log

Rolling recent session log for AI/human handoffs. Keep this file small; full historical session history lives in `.ai/JOURNAL-ARCHIVE.md`.

**Rules:**
- Append one concise entry for meaningful work, then immediately run `node scripts/trim-session-log.mjs` in the same change.
- Start each entry heading with a valid ISO date (`## YYYY-MM-DD ...`) so retention can identify the latest entries.
- CI allows at most 60 entries; the trim step compacts to the latest 40 entries by default so there is headroom for future appends.
- Use `node scripts/trim-session-log.mjs --check` to verify the log is chronological and within the 60-entry cap.
- Keep enough recent entries for weekly automations to inspect roughly the last week of work.
- The trim step appends removed entries to `.ai/JOURNAL-ARCHIVE.md`, so trimming never loses history.
- Use `.ai/JOURNAL-ARCHIVE.md` only for historical investigation.

## 2026-07-18 — Assignment submit/recovery race review fixes

**Completed:**
- Ran independent Sol/high database, client-state, and integration reviews of PR #891 after CI passed. The client review found and fixed four ordering/recovery defects: a conflict catch overwriting a newer durable draft, edits arriving during a successful submit being shown or cleared incorrectly, queued save reconciliation being cleared by a later submit response, and a definitively rejected equal-content recovered operation retaining a stale writer fence.
- Added a synchronous preserved-draft reference so the submitted server snapshot remains authoritative while newer local content survives save/submit response reordering and can be restored after unsubmit.
- Replaced stale recovered operations with a fresh mount-local writer identity and refreshed revision while retaining the original metric-session identity and cumulative counters for database deduplication.
- Added behavior regressions for all four races. Final independent rereviews reported no findings and confirmed the tests fail against the prior implementation.
- No production data, Storage, migration history, deployment, or visible layout was modified.

**Validation:**
- `pnpm test` (375 files / 3,487 tests)
- Focused assignment integrity suites (3 files / 71 tests)
- `pnpm exec tsc --noEmit`
- `pnpm lint`
- `pnpm run check:architecture` (604 modules / 0 allowances)
- Pika pre-commit audit
- `git diff --check`

**Remaining before merge:**
- Push the final review fixes and wait for PR checks. Migration 099 still requires exact one-time target authorization and must be applied and verified before this application version is deployed.

## 2026-07-18 — Production assignment integrity migration

**Completed:**
- Applied only migration `099_assignment_submission_integrity_guards.sql` to the linked production Pika project after exact one-time authorization and a clean dry run.
- Verified production migration history is aligned through 099, both new ledger tables have RLS enabled, the writer-fence columns are present, and the four application RPCs exist with execution granted to `service_role` but denied to `anon` and `authenticated`.
- No reset, repair, rollback, seed, cleanup, Storage deletion, or application deployment was performed.

**Validation:**
- `supabase migration list --linked` records migrations 001-099
- Read-only production catalog checks for RPC signatures, role grants, RLS, save RPC overload count, and assignment document columns
- PR #891 CI: architecture/database contracts, full test/build, and UI policy checks passed before application

**Remaining:**
- Merge PR #891 to deploy the application version that uses migration 099, then continue the product-experience program.

## 2026-07-18 — Enforce chronological session-log retention

**Completed:**
- Updated the session-log trimmer to order ISO-dated entries chronologically before retaining or archiving them while preserving source order for same-day entries.
- Made check mode reject chronological drift so CI catches future merge-order mistakes.
- Made archive appends idempotent with deterministic path-normalized per-trim batch markers so failed output writes can be retried without duplicating history or collapsing identical entries; added forced-failure, duplicate-entry, and equivalent-path recovery coverage after independent review.
- Made trim and check modes reject undated or invalid entry headings instead of guessing whether they belong in the latest retention window; aligned startup guidance after independent review.
- Repaired the rolling log's existing July 13-15 ordering drift and added focused regression coverage.

**Validation:**
- `bash .codex/skills/pika-session-start/scripts/session_start.sh`
- `pnpm test tests/unit/trim-session-log.test.ts tests/unit/ai-startup-docs.test.ts` (2 files / 41 tests)
- `pnpm lint`
- `node --check scripts/trim-session-log.mjs`
- `node scripts/trim-session-log.mjs --check`
- `git diff --check`

## 2026-07-20 — Migration 099 local seed compatibility

**Completed:**
- Fixed `pnpm seed` for databases with migration 099 by creating assignment documents as editable, inserting their baseline/autosave/blur history, and only then finalizing submitted documents.
- Let migration 099's deferred constraint trigger create each authoritative submit snapshot, preserving the database invariant that editable history cannot be written after submission.
- Aligned the synthetic writing timelines with the existing 4-day and 2-day submission dates so grading fixtures remain chronologically valid.
- Added unit and source-order regression coverage for history partitioning and seed lifecycle ordering.
- Derived the earliest returned-feedback timestamp from the generated submission time after review found an early-day chronology edge case.
- Re-ran `pnpm seed` against the authorized loopback database; the complete classroom, assignment-review, and test fixtures now seed successfully. No production resources were accessed or modified.

**Validation:**
- `pnpm test` (376 files / 3,495 tests)
- `pnpm exec tsc --noEmit`
- `pnpm lint`
- `pnpm seed` against the loopback Supabase database through migration 099
- Direct loopback database checks: one submit row per submitted document, matching content snapshots, all editable history before submission, and returned feedback after submission
- `git diff --check`

**Audit note:**
- The Pika pre-commit audit reports the existing CLI progress `console.log` calls throughout `scripts/seed.ts` after that file is touched. No new production logging path was introduced; this is a whole-file false positive for the development seed CLI.

## 2026-07-20 — Teacher dashboard entry authorization contract

**Completed:**
- Replaced the teacher dashboard's unauthorized `/api/student/entries` read with an exact student/day query through the teacher-owned student-history route.
- Added a named Zod query contract for classroom, student, exact/paged date, and bounded limit inputs while preserving authentication-first handling.
- Kept classroom ownership and enrollment checks ahead of entry access, and added regressions for foreign classrooms, unenrolled students, exact-date filtering, and the dashboard endpoint choice.
- Preserved the existing 50-row cap for oversized history limits and rejected ambiguous exact/paged date filters after independent review.
- Verified the route against local Supabase with a teacher session: the teacher endpoint returned the selected entry and the old student endpoint returned HTTP 403.
- No schema, migration, production data, or visible UI layout changed.

**Validation:**
- `pnpm test` (376 files / 3,501 tests)
- Focused dashboard, teacher entry/history, consumer, and API boundary suites (5 files / 23 tests)
- `pnpm exec tsc --noEmit`
- `pnpm lint`
- `pnpm check:architecture` (605 modules / 0 allowances)
- Live loopback teacher authorization and exact-entry query
- `git diff --check`

**Remaining:**
- Independently review PR #894. After merge, reconcile the blueprint package v2/v3 contract as the final uncompleted Safety Wave item before Phase 2.

## 2026-07-20 — Blueprint package version contract reconciliation

**Completed:**
- Merged PR #894, fast-forwarded the hub to `origin/main`, and removed its clean feature worktree and local branch.
- Made course package version 3 the shared canonical export and lifecycle contract while explicitly retaining version 2 import compatibility.
- Added a focused Zod boundary for package manifests and files so malformed and unsupported versions fail before operation planning; server operations now consume validated manifest metadata rather than the original request value.
- Preserved legacy version 2 course content while intentionally ignoring retired `quizzes.md` content, with a checked-in compatibility fixture and bundle/tar regressions.
- Made v3 file membership strict, bounded HTTP and tar input size/counts, and rejected unknown or duplicate archive entries after independent review; removed the import route from the API validation debt baseline.
- Added byte-aware per-file limits for both JSON and tar imports after rereview; the final independent rereview reported no actionable findings.
- Updated package and classroom lifecycle guidance to agree on current and supported versions. No database migration, production access, or visible UI change was required.

**Validation:**
- `pnpm test` (376 files / 3,514 tests)
- Focused package, artifact, server, API, documentation, and route-standard suites (6 files / 52 tests)
- `pnpm exec tsc --noEmit`
- `pnpm lint`
- `pnpm check:architecture` (606 modules / 0 allowances)
- `pnpm build`
- `git diff --check`

**Remaining:**
- Merge PR #895 after required checks/review. Phase 2 begins after that merge.

## 2026-07-20 — Phase 2 semantic-token contrast contract

**Completed:**
- Merged PR #895, completing the Product Experience Safety Wave and beginning Phase 2.
- Added a WCAG AA contract that evaluates semantic foreground/background pairs in both themes, including translucent selected and status surfaces.
- Split semantic foreground colors from opaque solid action fills, migrated filled controls to the new solid tokens, and corrected failing muted, status, accent, and selected-state combinations.
- Preserved a persistent selected-row cue in the gradebook after reducing the dark selected-surface opacity.
- Resolved all findings from two independent reviews, including omitted hover/subtle pairs, solid-fill opacity enforcement, inverse-text bypasses, and missing direct component coverage.
- Visually verified representative teacher and student routes at desktop/mobile sizes in light/dark themes, plus selected gradebook rows in both themes. No overflow, overlap, console, or page errors were found.

**Validation:**
- `pnpm test` (378 files / 3,523 tests)
- `pnpm exec tsc --noEmit`
- `pnpm lint`
- `pnpm build`
- `bash .codex/skills/pika-audit/scripts/audit.sh`
- `bash .codex/skills/pika-ui-verify/scripts/ui_verify.sh classrooms`
- Custom Playwright teacher/student desktop/mobile light/dark matrix and gradebook selected-row checks
- `git diff --check`

**Remaining:**
- Review and merge PR #896. Then implement Phase 2's shared modal-layer contract as a separate slice.

## 2026-07-20 — Phase 2 shared modal-layer contract

**Completed:**
- Reviewed and merged PR #896, then fast-forwarded the hub and started the next Phase 2 slice from current `main`.
- Added a portal-based `ModalLayer` that owns top-layer keyboard handling, initial focus, Tab containment, focus restoration, background inertness, scroll locking, stacking, Escape, and backdrop behavior.
- Preserved the canonical `AlertDialog`, `ConfirmDialog`, `DialogPanel`, and `ContentDialog` APIs while routing them through the shared layer; migrated classroom mobile left/right drawers without changing their visual design.
- Fixed independent-review findings for lifecycle churn while a confirmation becomes busy and reverse Tab containment when a custom panel owns focus; added regressions and narrowed documentation to migrated surfaces.
- Visually verified open dialogs and navigation drawers for teacher/student roles at desktop/mobile sizes in light/dark themes, including focus, inert background, scroll lock, Escape cleanup, and focus restoration.
- Opened PR #897. No schema migration or production data change was made.

**Validation:**
- `pnpm test` (381 files / 3,529 tests)
- `pnpm exec tsc --noEmit`
- `pnpm lint`
- `pnpm build`
- `bash .codex/skills/pika-audit/scripts/audit.sh`
- Custom Playwright teacher/student desktop/mobile light/dark open-state matrix
- `git diff --check`

**Remaining:**
- Review and merge PR #897. Continue Phase 2 with shared button target sizing/focus-visible behavior and semantic form-field propagation.

## 2026-07-21 — Internal test grading profile and provenance

**Risk profile:** async-grading

**Model recommendation:** GPT-5.4 - this phase crosses provider contracts, privacy boundaries, durable grading concurrency, revision fencing, and rolling database compatibility.

**Completed:**
- Moved test open-response prompts, strict output schemas, output budgets, and profile versions into the database-independent grading core while preserving Pika's sanitization, reference cache, score buckets, telemetry, and teacher workflows in the compatibility adapter.
- Routed direct and durable test grading through the shared structured-output provider executor with bounded, pseudonymous per-request provenance and complete retry token accounting.
- Added signed manual provenance propagation and migration `102` with service-role-only compatibility wrappers that atomically persist provenance without double-incrementing response revisions.
- Preserved provenance for teacher corrections, cleared stale provenance for legacy AI replacements and grade clears, and kept durable replay idempotent.
- Kept the remote Gradex worker disabled; no live provider calls, production changes, or local migration application were performed.

**Validation:**
- Focused grading/persistence suite (10 files / 114 tests)
- Full Vitest suite (403 files / 3,632 tests)
- `pnpm exec tsc --noEmit`
- `pnpm lint`
- `pnpm check:architecture` (620 modules / 0 allowances)
- `pnpm build`
- `bash -n scripts/check-atomic-test-grading.sh`
- `git diff --check`
- Migration replay, database harness, and generated-type drift check pending ephemeral CI

## 2026-07-21 — Phase 2 shared control and form-field contract

**Completed:**
- Merged PR #897 and began the next Phase 2 slice from current `main`.
- Standardized shared button, input, select, segmented-control, split-button, sortable-table, and split-pane interaction targets and focus-visible treatment without changing Pika's information-dense workflows.
- Made `FormField` the semantic owner for label association, required state, hints, errors, `aria-describedby`, `aria-errormessage`, and `aria-invalid` while preserving child IDs and existing descriptions.
- Kept hint and error content visible together, prevented custom props from leaking to native controls, and documented the one-control composition contract.
- Fixed review findings by expanding the split-pane divider target, reconciling the `FormField` docs, reserving the full mobile classroom switcher height, and forwarding generated field naming and validation semantics to the rich-text editor.
- Visually verified unauthenticated, teacher, and student surfaces across desktop/mobile and light/dark themes, including keyboard focus, form errors, the dense gradebook, and the student Today view. No overflow or layout regression was found.

**Validation:**
- `pnpm test` (383 files / 3,543 tests)
- Focused shared-control and integration suites (8 files / 69 tests)
- `pnpm exec tsc --noEmit`
- `pnpm lint`
- `pnpm check:architecture` (607 modules / 0 allowances)
- `pnpm build`
- `bash .codex/skills/pika-audit/scripts/audit.sh`
- `bash .codex/skills/pika-ui-verify/scripts/ui_verify.sh classrooms/07e8da7d-9a2a-4e74-b516-f5fe2bab1bf8?tab=attendance`
- Custom Playwright light/dark desktop/mobile focus, error, teacher, and student checks
- `git diff --check`

**Remaining:**
- Merge reviewed PR #898 after required CI. Then continue Phase 2 with page structure, typography, spacing, action placement, and responsive density as a separate slice.

## 2026-07-21 — Phase 2 shared page-structure contract

**Completed:**
- Merged PR #898 and began the next Phase 2 slice from current `main`.
- Promoted page framing into the canonical `@/ui` layer with named content widths, explicit teacher/student density, governed page and section headings, content stacks, and responsive action placement; retained the old component path as an incremental compatibility export.
- Preserved compact table-first teacher workflows and the existing implicit density for unmigrated callers while adopting the governed contract on teacher and student classroom indexes.
- Corrected the shared `AppShell` main region so default pages fill the available width instead of accidentally shrinking to their contents.
- Removed action-bar overrides that reduced shared controls below 44px and gave mobile menu items explicit target and focus-visible treatment.
- Visually verified teacher and student classroom indexes at desktop/mobile sizes in light/dark themes, including the open mobile menu. All eight role/viewport/theme cases had exact viewport width, no console/page errors, and focused 44px menu items.
- Opened PR #899. Initial independent architecture review found no actionable issues; accessibility review prompted additional disabled-item, ArrowUp, Home, and End menu coverage plus reconciliation of stale promotion guidance.
- Targeted remediation review prompted an explicit keyboard-activation regression proving Enter invokes the focused action, closes the menu, updates expanded state, and restores trigger focus.
- An explicitly approved final remediation batch scoped menu keys to menu focus, restored the startup-doc budget, and reconciled the remaining experimental page-scaffolding guidance.
- Final review retained legacy width compatibility, migrated Blueprints to the named wide contract, and made all-disabled mobile action groups non-openable.

**Validation:**
- Full `pnpm test` suite
- Focused page, shell, classroom-index, action-menu, and teacher-work-surface suites
- `pnpm exec tsc --noEmit`
- `pnpm lint`
- `pnpm check:architecture` (608 modules / 0 allowances)
- `pnpm build`
- `bash .codex/skills/pika-audit/scripts/audit.sh`
- `bash .codex/skills/pika-ui-verify/scripts/ui_verify.sh classrooms`
- Custom Playwright teacher/student desktop/mobile light/dark and menu-state matrix
- Composite widget checklist reviewed; keyboard behavior and semantic state are covered, with no remaining manual accessibility follow-up.
- `git diff --check`

**Remaining:**
- Complete targeted remediation review and merge PR #899 after required checks. Then continue Phase 2 with page-level loading, error, empty, and forbidden contracts.

## 2026-07-21 — Phase 2 governed page-state contract

**Completed:**
- Merged PR #899 and started Phase 2 item 5 from current `main` in a dedicated worktree.
- Added canonical `PageState` loading, error, empty, and forbidden variants with explicit live-region semantics, text-backed icons, optional actions, and compact work-region support.
- Added classroom route loading, error-boundary retry, and intentionally indistinguishable unavailable/access-denied states while preserving safe layout framing and route-away behavior.
- Migrated teacher dashboard and student history initial loading/empty behavior; failed classroom/history reads now render explicit retryable errors instead of valid-looking empty data.
- Added cache invalidation before client retries and direct regressions for state semantics, route boundaries, error/empty separation, and retry recovery.
- Documented the state decision table and App Router conventions in stable guidance.
- Visually verified teacher/student loading, error, and empty states plus classroom unavailable states at desktop/mobile sizes in light/dark themes. Governed states had no overflow or page errors, and retry/route-away controls measured 44px.
- Opened PR #900 for independent review; no schema, migration, API contract, or production data change was made.
- Fixed independent-review findings by separating attendance read failures from empty rosters, binding data to its owning classroom, routing roster-upload refresh through the same guarded coordinator, and rejecting stale entry-detail responses after class switches.
- Added deterministic focus recovery and page-level heading semantics, clarified shell behavior when protected identity data is unavailable, and made the teacher dashboard and student history stack cleanly on mobile without changing their table-first desktop workflow.

**Validation:**
- `pnpm test` (387 files / 3,569 tests)
- Focused page-state, classroom-route, teacher-dashboard, student-history, UI-guidance, and startup-doc suites
- `pnpm exec tsc --noEmit`
- `pnpm lint`
- `pnpm check:architecture` (610 modules / 0 allowances)
- `pnpm build`
- `bash .codex/skills/pika-audit/scripts/audit.sh`
- Composite-widget checklist reviewed; no composite widget behavior changed in this slice, while retry keyboard/focus behavior is covered directly.
- Custom Playwright teacher/student desktop/mobile light/dark loading/error/empty/forbidden and keyboard-retry matrix; all remediation cases had no overflow or page errors, 44px retry controls, and stable post-retry focus
- `git diff --check`

**Remaining:**
- Merge the independently reviewed page-state PR after required checks. Then continue Phase 2 with shared table, menu, tabs, segmented-control, and split-pane contracts.

## 2026-07-21 — Phase 2 composite-control contracts

**Completed:**
- Merged PR #900 and started Phase 2 item 6 from current `main` in a dedicated worktree.
- Promoted canonical `DataTable` and `Tabs` primitives into `@/ui`, retained the legacy table export for incremental compatibility, and migrated teacher Attendance, Assignments, Tests, Gradebook, Roster, document-editor, and work-surface callers.
- Standardized automatic tabs, roving segmented controls, Home/End menu navigation, keyboard table selection, stable row identity, split-pane and column-resize separators, focus-visible treatment, 44px interaction targets, and narrow-screen tab overflow.
- Fixed independent-review findings covering failed Attendance refreshes, legacy `aria-label` compatibility, extra tab-panel stops, mobile tab overflow, row-focus semantics and cancellation races, remount-safe Attendance focus restoration, and resize target sizing.
- Added governed composite-control guidance plus direct primitive and integration regressions. No schema, migration, API, production, or data change was made.
- Opened PR #902 after independent architecture and accessibility re-reviews. The final cumulative review then caught bubbled table shortcuts overriding nested inputs, failed Attendance reads falling through to empty-roster copy, and empty copy flashing during retry; all now have direct regressions and remediated behavior.
- Restored the startup-context budget after CI caught a 10-character overage in `.ai/CURRENT.md`.

**Validation:**
- `pnpm test --run` (390 files / 3,579 tests)
- Focused DataTable, Attendance, and startup regressions (3 files / 50 tests)
- `pnpm exec tsc --noEmit`
- `pnpm lint`
- `pnpm check:architecture` (612 modules / 0 allowances)
- `pnpm build`
- `bash .codex/skills/pika-audit/scripts/audit.sh`
- Teacher/student desktop/mobile light/dark visual matrix plus live Attendance ArrowDown selection, row focus, Escape deselection/focus restoration, retryable error desktop/mobile light/dark states, and overflow checks
- `git diff --cached --check`

**Remaining:**
- Merge PR #902 after required CI. Then continue Phase 2 with the next scoped shared-experience slice from the product-experience audit.

## 2026-07-21 — Phase 2 shared application navigation

**Completed:**
- Merged independently reviewed PR #902 as `14de9893`, fast-forwarded the hub, and started Phase 2 item 7 from current `main` in a dedicated worktree.
- Added a shared `AppNavigation` route-family mechanism with active-page semantics, stable prefix matching, 44px link targets, visible keyboard focus, and narrow-width horizontal overflow.
- Added an optional application-navigation region to `AppShell` and migrated the teacher utility layout from its duplicate logo/header/logout implementation to the canonical compact `AppHeader`, `UserMenu`, session watcher, and shared navigation band.
- Preserved the existing `Classrooms`, `Blueprints`, and `Calendar` destinations without adding a dashboard destination or changing classroom navigation, page content, API contracts, schema, production state, or data.
- Added direct navigation, shell-order, and teacher-layout regressions plus stable guidance for incremental utility-family migration.
- Browser-verified teacher Blueprints and Calendar at desktop/mobile widths in light/dark themes, including active-link focus and navigation-shell overflow isolation. The student mobile shell remained unchanged and overflow-free. Calendar's previously ranked narrow-screen content compression remains assigned to its Phase 3 vertical slice.
- Opened PR #903 for independent review.
- Accepted independent-review findings that the first implementation dropped the prior teacher-content gutters and used an outward focus ring that could be clipped by the navigation scroller. Restored the content geometry, moved focus treatment inside each link, and added a durable browser contract for every teacher utility route.

**Validation:**
- `pnpm test --run` (392 files / 3,584 tests)
- Focused application-navigation, app-shell, teacher-layout, and app-header suites (4 files / 12 tests)
- `pnpm exec tsc --noEmit`
- `pnpm lint`
- `pnpm check:architecture` (613 modules / 0 allowances)
- `pnpm build`
- `bash .codex/skills/pika-audit/scripts/audit.sh`
- Custom Playwright teacher desktop/mobile light/dark navigation matrix plus unchanged student mobile-dark regression (7 checks including auth setup)
- Durable Playwright teacher dashboard/Blueprints/Calendar desktop-light and mobile-dark navigation contract
- `node scripts/trim-session-log.mjs --check`
- `git diff --check`

**Remaining:**
- Complete full repository verification, independent review, and merge for the teacher navigation slice. Then migrate the student utility family as a separate Phase 2 item 7 PR.

## 2026-07-21 — Phase 2 student utility navigation

**Completed:**
- Merged independently reviewed PR #903 as `d157d4cf`, fast-forwarded the hub, and started the second Phase 2 item 7 slice from current `main` in a dedicated worktree.
- Migrated the student utility layout from its duplicate logo/header/logout implementation to the canonical `AppShell`, compact `AppHeader`, account menu, session watcher, and shared application-navigation band.
- Preserved the existing `Classrooms` and `History` destinations plus the original `max-w-4xl px-4 py-8` content geometry. This slice does not redirect, retire, or consolidate `/student/history`, and does not change classroom navigation.
- Added a direct student-layout regression and expanded the durable application-navigation Playwright contract with student desktop-light and mobile-dark checks for active state, inset focus, rendered target size, spacing, and overflow.
- Visually inspected populated student History at desktop and mobile widths; the two-column desktop layout and stacked mobile workflow remain intact with the cleaned shared header.
- Opened PR #904 for independent review.
- Accepted one independent accessibility finding: the newly activated shared header and account menu exposed sub-44px controls. Enlarged the Home, fullscreen, login, account, sidebar, and menu-item hit areas without changing icon sizes, removed the menu scale animation that temporarily shrank interactive rows, and added unit plus rendered-size keyboard regressions.

**Validation:**
- `pnpm test --run` (393 files / 3,585 tests)
- Focused student-layout, application-navigation, app-shell, and student-history suites (4 files / 10 tests)
- Focused remediation suite for the shared header, account menu, student shell, and navigation (6 files / 20 tests)
- `pnpm exec tsc --noEmit`
- `pnpm lint`
- `pnpm check:architecture` (613 modules / 0 allowances)
- `pnpm build`
- `bash .codex/skills/pika-audit/scripts/audit.sh`
- Durable Playwright application-navigation suite (10 checks including auth setup)
- Desktop/mobile teacher and student screenshots, including open mobile-dark account menus
- `node scripts/trim-session-log.mjs --check`
- `git diff --check`

**Remaining:**
- Complete full repository verification, independent review, and merge for the student navigation slice. Then continue Phase 2 with specialized-control policy enforcement.

## 2026-07-21 — Phase 2 specialized-control policy

**Completed:**
- Merged independently reviewed PR #904 as `f614fa61`, fast-forwarded the hub, and started Phase 2 item 8 from current `main` in a dedicated worktree.
- Replaced the brittle UI import grep with a TypeScript-AST policy checker and a versioned, Zod-validated exception registry covering 215 native controls across 67 files.
- Required exact per-file/per-kind counts, constrained rationale categories, explicit Phase 2/3/6 review ownership, canonical `@/ui` imports, and rejection of legacy UI component paths.
- Converted 22 remaining `@/ui/*` imports to the canonical barrel and retained narrow compatibility exports for existing component paths.
- Corrected seven full `@/ui` test mocks to preserve unmocked barrel exports after the full suite exposed their hidden coupling.
- Added direct semantic coverage for calendar navigation, creation dialogs, multiple-choice review states, announcement menus, edit toggles, split panes, and teacher action menus.
- No runtime UI behavior, schema, migration, API contract, production state, or data changed; visual verification is not required for this import/tooling-only slice.
- Opened PR #905 for independent review.
- Accepted initial review findings covering dynamic/CommonJS/import-equals bypasses, literal React factory controls, complete static input classification, and overly broad Tiptap exclusions; remediated them together with direct regression fixtures.
- Kept roadmap ownership in `reviewBy` and `.ai/features.json` rather than introducing date-dependent CI expiry for source exceptions.
- Targeted re-review found import-option/import-type bypasses, case/template static-input gaps, and missing namespace/root fixtures; closed all four in the second remediation batch.
- With explicit approval to exceed the default review budget, the third remediation batch closed final cumulative findings for relative UI paths, CommonJS/import-equals React factories, shorthand input props, strict registry metadata, and stale Phase 1 audit evidence.

**Validation:**
- `pnpm test --run` (full repository suite)
- Focused UI-policy, guidance, and composite-control suites
- `pnpm check:ui-policy` (215 controls / 67 files)
- `pnpm check:architecture`
- `pnpm exec tsc --noEmit`
- `pnpm lint`
- `pnpm build`
- `bash .codex/skills/pika-audit/scripts/audit.sh`
- `git diff --check`

**Remaining:**
- Publish, independently review, remediate, and merge the specialized-control policy PR. Then continue Phase 2 with mobile and light/dark Playwright projects plus representative teacher/student CI coverage.

## 2026-07-21 — Phase 2 browser experience matrix

**Completed:**
- Merged independently reviewed PR #905 as `126658e0`, fast-forwarded the hub, and started Phase 2 item 9 from current `main` in a dedicated worktree.
- Added desktop light, desktop dark, mobile light, and mobile dark Chromium projects while preserving the established `chromium-desktop` snapshot identity.
- Kept the broad feature and manual snapshot suites on the desktop-light project and limited the additional three projects to a focused experience contract, preventing a fourfold expansion of the full E2E suite.
- Added read-only seeded browser coverage for teacher Daily attendance, student Today, teacher Blueprints navigation, and student History navigation. The contract verifies real role authentication, classroom data, active navigation, mobile drawer behavior, persisted themes, viewport geometry, and horizontal overflow.
- Added a dedicated GitHub Actions job that starts ephemeral local Supabase, replays migrations, exports local-only credentials, runs `pnpm seed`, installs Chromium, executes the matrix, uploads failure diagnostics, and always tears down the database.
- Updated testing guidance and Phase 2 audit evidence. No runtime UI, API, schema, migration, production state, or production data changed.

**Validation:**
- `pnpm e2e:matrix` (18 checks across setup and four projects)
- `pnpm test` (397 files / 3,603 tests)
- `pnpm exec tsc --noEmit`
- `pnpm lint`
- `pnpm check:architecture` (613 modules / 0 allowances)
- `pnpm check:ui-policy` (215 controls / 67 files)
- `pnpm build`
- `bash .codex/skills/pika-audit/scripts/audit.sh`
- `git diff --check`

**Remaining:**
- Publish, independently review, remediate, and merge the browser matrix PR. Then confirm Phase 2 exit evidence and begin Phase 3 with the first independently releasable vertical product slice.

## 2026-07-21 — Phase 3 Classwork list states

**Completed:**
- Began Phase 3 with a narrow assignment slice that preserves the existing class-wide teacher workflow and student assignment list.
- Replaced ambiguous initial loading and failed-read empty states with governed `PageState` loading, error, and successful-empty states for teacher and student Classwork.
- Added bounded Retry actions that invalidate assignment, material, and survey list caches before reloading; failures never render "No classwork yet," and successful retry restores the normal list.
- Added focused role regressions and browser-verified loading, error, empty, retry, and restored-list states at desktop/mobile widths in light/dark themes. No API, schema, migration, production state, or production data changed.
- Independent review found that reactivating Classwork after a failed load used the content-preserving refresh path and could expose the empty state while retrying. Reactivation from an error now uses the blocking load path; both roles prove pending reactivation, repeated failure, and recovery.
- Final cumulative review found the remaining survey-list exception could still turn survey failures into empty or partial Classwork. Survey reads now participate in the same required failure/retry contract, with teacher and student survey-specific recovery regressions.

**Validation:**
- Focused Classwork component suites (2 files / 61 tests)
- `pnpm test --run` (397 files / 3,605 tests)
- `pnpm exec tsc --noEmit`
- `pnpm lint`
- `pnpm check:architecture` (613 modules / 0 allowances)
- `pnpm check:ui-policy` (215 controls / 67 files)
- `pnpm build`
- `bash .codex/skills/pika-audit/scripts/audit.sh`
- `git diff --check`
- Playwright forced-state matrix (16 checks across two focused local runs)

**Remaining:**
- Complete repository gates, independent review, and merge. Then continue the assignment slice with mobile workspace modes, save announcements/dialog semantics, and the Gradex status boundary.

## 2026-07-21 — Internal grading core foundation

**Risk profile:** async-grading

**Model recommendation:** GPT-5 Codex - grading contracts, provider error semantics, reproducibility metadata, and database security require cross-layer invariant analysis.

**Completed:**
- Started the internal modular-grading direction from current `main` without modifying the open remote Gradex worker branch or enabling remote grading.
- Added a database-independent grading core with Zod rubric/result contracts, profile and provider interfaces, canonical weighted criterion results, and versioned policy, prompt, profile, rubric, usage, and provider-request metadata.
- Extracted the OpenAI Responses structured-output transport behind the provider interface, including timeout/status classification, bounded output-cap fallback, structured response extraction, and cumulative token usage.
- Moved native assignment grading onto a pure Pika assignment profile while preserving the existing Completion/Thinking/Workflow rubric, prompt text, sanitization, teacher routes, durable run orchestration, retry semantics, and atomic writes.
- Added migration 100 to replace the legacy assignment-run claim with an empty search path, validated lease arguments, and service-role-only execution. No migration was applied.
- Added core engine/profile, assignment compatibility, usage, retry/error, and migration security regressions. No live provider call, production change, deployment setting, or data mutation occurred.

**Validation:**
- `pnpm test` (396 files / 3,593 tests)
- `pnpm exec tsc --noEmit`
- `pnpm lint`
- `pnpm check:architecture` (619 modules / 0 allowances)
- `pnpm build`
- `bash .codex/skills/pika-audit/scripts/audit.sh`
- Focused grading and assignment route suites (59 tests)
- `git diff --check`

**Remaining:**
- Add fully fenced assignment lease mutation contracts and durable grading audit/suggested-score persistence through the authorized schema workflow.
- Migrate test and repository-review profiles to the shared core, then add teacher-correction evaluation datasets and metrics.

## 2026-07-21 — Internal grading core review remediation

**Risk profile:** async-grading

**Completed:**
- Opened PR #906 and completed the initial independent review wave for the assignment grading core.
- Preserved the legacy direct-grading behavior by creating an abort signal only when the caller supplies a timeout; durable background runs continue to supply their existing 25-second timeout.
- Classified response-body `AbortError` and `TimeoutError` failures, including browser-style `DOMException` aborts, as retryable provider timeouts.
- Kept aggregate token usage unknown when either request in the output-cap fallback sequence omits usage, avoiding silently incomplete cost telemetry.
- Added a provider-to-run regression proving a response-body timeout requeues the assignment item with a future retry and leaves the batch running rather than failing it closed.
- No migration was applied, no live provider call was made, and no production state changed.

**Validation:**
- `pnpm test` (396 files / 3,597 tests)
- Focused grading, provider, and durable assignment-run suites (3 files / 27 tests)
- `pnpm exec tsc --noEmit`
- `pnpm lint`
- `pnpm check:architecture` (619 modules / 0 allowances)
- `pnpm build`
- `bash .codex/skills/pika-audit/scripts/audit.sh`
- `git diff --check`

**Remaining:**
- Complete targeted remediation and final cumulative reviews for PR #906, then obtain the required external approval before merge.
- Continue the active internal grading subsystem goal with assignment audit persistence, followed by test and repository-review profiles.

## 2026-07-21 — Durable assignment grading provenance

**Risk profile:** async-grading

**Completed:**
- Fixed the cumulative PR #906 review finding that versioned assignment grading metadata was computed but not durably persisted.
- Added a strict, bounded, pseudonymous provenance contract containing only provider/model, profile/rubric/prompt/policy versions, provider request count, and nullable token usage.
- Added migration 101 with an `assignment_docs.ai_grading_provenance` JSONB contract and additive service-role-only wrappers around the existing direct-grade and durable-item atomic RPCs, preserving rolling compatibility for old application instances.
- Added a compatibility trigger that clears provenance whenever legacy direct, durable, batch, repository-review, manual-grade, or missing-work writers replace grade/audit fields without supplying replacement provenance.
- Routed native Pika assignment grading through both provenance-aware persistence paths while legacy Gradex, missing-work, and repository-review callers write null provenance until their profiles migrate.
- Extended the CI database harness to verify wrapper privileges, direct persistence, durable-item persistence, transactionality, replay preservation, and stale-provenance clearing across old direct, durable, batch, and missing-work writers; updated generated and refined database contracts.
- No migration was applied locally, no live model call was made, and no production state changed.

**Validation:**
- `pnpm test` (401 files / 3,619 tests after rebasing onto `origin/main`)
- Focused grading, persistence, migration, Gradex compatibility, and database-contract suites (9 files / 64 tests)
- `pnpm exec tsc --noEmit`
- `pnpm lint`
- `pnpm check:architecture` (619 modules / 0 allowances)
- `pnpm build`
- `bash -n scripts/check-atomic-assignment-feedback-returns.sh`
- `bash .codex/skills/pika-audit/scripts/audit.sh`
- `git diff --check`

**Remaining:**
- Confirm migration replay, generated-type parity, and the database-backed provenance contract in PR CI, then complete the final independent re-review.
- Obtain required external approval before merge; continue with test and repository-review profile migration after this assignment foundation lands.

## 2026-07-22 — Phase 3 assignment accessibility evidence

**Completed:**
- Audited the remaining non-mobile assignment backlog against current `main` and confirmed #891 already shipped polite atomic save announcements and the shared restore-confirmation dialog.
- Replaced the assignment suite's hand-built confirmation stub with the real `ConfirmDialog`, added focused initial-focus coverage, and locked the visible save-status live-region attributes with regression assertions.
- Updated the product audit and current context to remove completed assignment work from the backlog. No runtime UI, API, schema, migration, production state, or production data changed.

**Validation:**
- `pnpm test tests/components/StudentAssignmentEditor.save-submit.test.tsx tests/ui/ModalLayer.test.tsx` (2 files / 52 tests)
- `pnpm exec tsc --noEmit --pretty false`
- `pnpm lint`
- `pnpm check:architecture` (613 modules / 0 allowances)
- `pnpm check:ui-policy` (215 controls / 67 files)
- `bash .codex/skills/pika-audit/scripts/audit.sh`
- `node scripts/trim-session-log.mjs --check`
- `git diff --check`

**Remaining:**
- Complete repository gates, independent review, and merge this evidence slice. Then start Daily/Attendance; assignment mobile UX remains deferred and Gradex remains owned by a separate session.

## 2026-07-22 — Internal repository-review grading profile and provenance

**Risk profile:** async-grading

**Model recommendation:** GPT-5.4 - this slice crosses structured provider contracts, sanitization, deterministic fallback semantics, revision fencing, and transactional database provenance.

**Completed:**
- Moved ambiguous-change classification and repository-review feedback into versioned, strict, bounded grading-core profiles using the shared OpenAI Responses provider, 25-second timeouts, minimal reasoning, and classification batches capped at 50 changes.
- Preserved Pika ownership of GitHub access, student identity mapping, sanitization, deterministic metrics, heuristic fallback, teacher workflow, and run orchestration; remote Gradex remains disabled.
- Added truthful per-result provenance for both model output and local heuristic fallback, with actual model/request/token metadata and zero provider requests for deterministic local grades.
- Added migration 103 with bounded result provenance, model/provenance linkage, an additive provenance-aware wrapper around the migration-087 completion RPC, completed-run replay preservation, exact student-row matching, and atomic propagation to assignment documents.
- Extended the database harness for service-role isolation, zero-request heuristic persistence, replay, and rollback on invalid provenance. Updated generated types and rollout/architecture guidance. No migration was applied locally, no live model call was made, and no production state changed.

**Validation:**
- `pnpm test` (405 files / 3,642 tests)
- Focused repository-review/core/migration suite (7 files / 30 tests)
- `pnpm exec tsc --noEmit`
- `pnpm lint`
- `pnpm check:architecture` (621 modules / 0 allowances)
- `pnpm build`
- `bash -n scripts/check-atomic-assignment-feedback-returns.sh`
- `git diff --check`

**Remaining:**
- Confirm migration 103 replay, database harness behavior, and generated-type parity in ephemeral PR CI; complete independent review and merge only after the assignment/test stack is approved.
- Add teacher-correction evaluation capture and offline comparison metrics across assignment, test, and repository-review grading.

## 2026-07-22 — Identity-free teacher grading reviews

**Risk profile:** async-grading, database, privacy, grading-quality

**Model recommendation:** GPT-5.4 - this slice crosses teacher outcome semantics, rolling-safe grading persistence, strict privacy contracts, and deterministic eval design.

**Completed:**
- Added a strict `grading-review-v1` core contract that cannot represent student identity, source assessment IDs, submission content, or raw feedback, plus deterministic summaries for criterion/overall score error, acceptance/edit rates, feedback dispositions, and model/profile counts.
- Added migration 104 with bounded `ai_grading_review` snapshots on assignment documents and test responses. Provenance-aware AI writes initialize reviews; manual edits update final outcomes; assignment/test return marks reviews final; test grade clearing records dismissal; changed student work and legacy AI replacement clear stale reviews.
- Kept repository-review grading on the assignment-document lifecycle, preserved existing routes and teacher UI, and prevented review-only test metadata updates from advancing response revisions.
- Added synthetic accepted, edited, dismissed, and pending fixtures plus `pnpm eval:grading-reviews` for free offline evaluation. Remote Gradex remains disabled, the existing Gradex archive extract is unchanged, and no live model call was made.
- Extended assignment/test database harnesses for suggestion preservation, correction capture, return finalization, dismissal, privacy rejection, legacy-writer clearing, and test revision stability; updated generated/refined types and rollout/privacy guidance.
- No migration was applied locally or remotely. The local Docker database had no Pika schema, so fresh migration replay and database harness execution remain PR CI gates.

**Validation:**
- `pnpm test` (407 files / 3,657 tests)
- `pnpm exec tsc --noEmit`
- `pnpm lint`
- `pnpm check:architecture` (622 modules / 0 allowances)
- `pnpm eval:grading-reviews scripts/fixtures/grading-review-scenarios.json`
- `git diff --check`

**Remaining:**
- Require fresh PR CI to replay migrations 001-104, verify generated type parity, and execute both atomic grading database harnesses.
- Complete independent review and obtain external approval before merging the stacked grading PRs.
- After the pilot collects 10-20 teacher-reviewed outcomes, add an explicit local-admin export of minimum sanitized grading inputs for paid candidate prompt/model comparisons.

## 2026-07-22 — Enforced grading-core isolation

**Risk profile:** async-grading, foundational architecture

**Model recommendation:** GPT-5.4 - enforcing extraction boundaries requires repository-wide import analysis while preserving existing grading policy behavior.

**Completed:**
- Added an architecture rule that prevents every `src/lib/grading/**` module from importing Pika-owned database, server, route, UI, shared application, or type modules, including type-only imports.
- Moved the canonical Pika test prompt guidelines into the versioned grading profile directory and retained the old application path as a compatibility re-export, preserving current consumers and prompt output.
- Added a regression test proving the boundary rejects both runtime Supabase and type-only database dependencies while allowing grading-core imports.
- Documented the enforced extraction boundary. No route, UI, schema, provider, prompt text, production state, or remote Gradex behavior changed.

**Validation:**
- `pnpm test` (407 files / 3,658 tests)
- `pnpm check:architecture` (623 modules / 0 allowances)
- focused architecture and test-grading suites (3 files / 43 tests)
- `pnpm exec tsc --noEmit`
- `pnpm lint`
- `pnpm build`
- Pika audit
- `git diff --check`

**Remaining:**
- Run the full repository gates and exact-head PR CI, then obtain the required external code-owner approval before merging the grading stack.
- Apply migrations 100-104 only with explicit target permission, deploy with remote Gradex disabled, and collect 10-20 teacher-reviewed outcomes before adding paid replay comparisons.

## 2026-07-22 — Corrected total-score grading eval error

**Risk profile:** none

**Model recommendation:** Current coding model - the correction is a small deterministic TypeScript aggregation change with focused regression coverage.

**Completed:**
- Changed overall grading-review error to compare the summed suggested score with the summed final score instead of adding absolute criterion errors.
- Added a regression scenario where opposite criterion corrections leave the total score unchanged while criterion-level errors remain visible.
- Preserved acceptance, feedback, and per-criterion metric behavior; no migration, provider, grading prompt, route, or production state changed.
- Pushed the correction to PR 911 and completed a bounded cumulative self-review with no new findings; the existing independent-review budget for this stack was already exhausted.

**Validation:**
- `pnpm test` (407 files / 3,659 tests)
- `pnpm exec tsc --noEmit`
- `pnpm lint`
- `pnpm check:architecture` (623 modules / 0 allowances)
- `pnpm build`
- Focused teacher-correction eval suite (1 file / 6 tests)
- `pnpm eval:grading-reviews scripts/fixtures/grading-review-scenarios.json`
- `node scripts/trim-session-log.mjs --check`
- `git diff --check`
- Pika changed-file audit
- Vercel preview checks at `769059be`

**CI note:**
- GitHub Actions did not trigger for the correction because PR 911 targets the stacked feature branch `codex/internal-repo-review-grading`, while the workflows listen only for pull requests into `main` or `production`. Full CI passed at the immediately preceding PR head; all correction-affected gates passed locally at `769059be`.

**Remaining:**
- After the lower stack lands and PR 911 is retargeted to `main`, require exact-head GitHub Actions and the repository's external approval before merge.

## 2026-07-22 — Hardened Daily and attendance read states

**Risk profile:** workspace-state

**Model recommendation:** GPT-5.6 Terra (high) - this slice crosses shared classroom schedule state, cached student work, teacher history selection, and asynchronous retry boundaries.

**Completed:**
- Added an explicit class-schedule error and snapshot contract. Cold failures block with retry; failed refreshes retain the last valid teacher/student workspace with a compact retry warning.
- Added explicit student Daily entry and teacher selected-student history failures, retry behavior, and persistent cached-snapshot recovery without replacing usable data with false empty states.
- Prevented previous-classroom Daily content from painting during classroom switches and prevented stale load-more responses from appending one student's logs to another student's history.
- Announced student Daily save status through a polite atomic live region and exposed save failures as alerts.
- Preserved the existing class-wide teacher table and student journal composition. Mobile workspace redesign and Gradex remained out of scope.

**Validation:**
- Focused Daily/Attendance and classroom integration suites (5 files / 72 tests)
- Full repository suite before the final provider-scope remediation (407 files / 3,670 tests); exact-head PR CI is required
- `pnpm exec tsc --noEmit`
- `pnpm lint`
- `pnpm check:architecture` (623 modules / 0 allowances)
- `pnpm build`
- Pika changed-file audit and composite-widget accessibility checklist
- Playwright experience matrix (18 cases across both roles, desktop/mobile, light/dark)
- Exact failure/stale-state screenshots for teacher and student; no horizontal overflow at 390px
- Three independent review passes; five findings fixed in two remediation batches; the first remediation re-reviews are clean and the final provider-scope re-review is pending

**Remaining:**
- Require exact-head PR CI and repository approval before merge.
- Defer Daily/Attendance mobile history/table modes until the later mobile UX phase; continue Phase 3 with Tests desktop/accessibility while Gradex remains separately owned.

## 2026-07-22 — Scoped Daily history across student switches

**Risk profile:** none

**Model recommendation:** GPT-5.6 Terra (high) - the fix is narrow, but correctness depends on React commit and effect ordering across student identity changes.

**Completed:**
- Remounted only the selected-student history state when the classroom/student scope changes, preventing the prior student's entries from committing beneath the next student's inspector heading.
- Initialized each scoped history view from that student's preview so the privacy fix does not introduce a false empty-state flash.
- Added a layout-effect regression test that observes the transition commit before passive effects run.
- Preserved the existing teacher Daily table and inspector UI; no student, mobile, schema, migration, or production behavior changed.

**Validation:**
- `pnpm test` (407 files / 3,672 tests)
- Focused Daily history and attendance suites (2 files / 25 tests)
- `pnpm exec tsc --noEmit`
- `pnpm lint`
- `pnpm check:architecture` (623 modules / 0 allowances)
- Pika changed-file audit
- Teacher Daily desktop screenshots after sequential student selection in light and dark themes; no horizontal overflow

**Remaining:**
- Require independent rereview and exact-head PR CI before merge.

## 2026-07-22 — Backported student classwork test isolation

**Risk profile:** none

**Model recommendation:** GPT-5.6 Terra (medium) - this is a localized test-only cache-isolation correction with no runtime behavior change.

**Completed:**
- Reset the student assignment, material, and survey request-cache namespaces before every `StudentAssignmentsTab` test.
- Removed the obsolete workaround that expected an already-viewed assignment to open its instructions modal automatically.
- Aligned `main` with the deterministic test behavior already proven on `production`; no application, schema, grading, or deployment behavior changed.

**Validation:**
- `pnpm exec vitest run tests/components/StudentAssignmentsTab.test.tsx` (1 file / 12 tests)
- `pnpm exec tsc --noEmit`
- `pnpm lint`
- `git diff --check`

**Remaining:**
- Require exact-head PR CI and normal protected merge into `main`.

## 2026-07-22 — Hardened Tests list read states

**Risk profile:** workspace-state

**Model recommendation:** GPT-5.6 Terra (high) - the slice crosses cached teacher/student lists, controlled workspace URLs, classroom transitions, and asynchronous retry boundaries.

**Completed:**
- Added explicit teacher and student Tests list loading, cold-error, successful-empty, and failed-refresh contracts with retry controls.
- Preserved the last valid list when refresh fails, rejected non-successful student list responses, and replaced one-off refresh cache keys with canonical invalidation.
- Scoped rendered list snapshots and errors to the active classroom so another classroom's tests cannot paint during navigation.
- Kept controlled teacher test URLs intact until a successful list snapshot proves the selected test is invalid.
- Resolved independent review feedback by moving focus from a replaced Retry button to a stable named Tests region for both failed and successful retries.
- Preserved the existing desktop list-first composition. Mobile UX, Gradex, schema, migrations, and production state were unchanged.

**Validation:**
- Focused teacher/student Tests list suites (3 files / 110 tests)
- Full repository suite before the focus-only remediation (407 files / 3,680 tests); exact-head PR CI is required
- `pnpm exec tsc --noEmit`
- `pnpm lint`
- `pnpm check:architecture` (623 modules / 0 allowances)
- `pnpm build`
- Pika changed-file audit and composite-widget accessibility checklist
- Playwright desktop matrix for both roles in light/dark across normal, cold-error, and preserved-refresh-error states (12 captures; no horizontal overflow)
- Post-remediation teacher/student desktop light/dark captures (4 captures; no layout change or horizontal overflow)
- `git diff --check`

**Remaining:**
- Require targeted remediation review and exact-head PR CI before merge.
- Continue Tests with authoring/grading mode separation; defer mobile navigation and Gradex to their separately owned phases.

## 2026-07-22 — Added canonical grading architecture guide

**Risk profile:** none

**Model recommendation:** GPT-5.6 Terra (medium) - this is a documentation-only reconciliation of implemented grading boundaries and contracts.

**Completed:**
- Added one canonical guide covering grading layers, assignment/test/repository-review flows, versioning, sanitization, atomic persistence, teacher-review evals, calibration limits, and the Pika/Gradex boundary.
- Routed grading work to the guide from the AI instruction table and core architecture.
- Updated current context to reflect verified migrations through 104.
- Documented current implementation separately from future Gradex and paid replay work; no runtime, schema, provider, grading, or deployment behavior changed.

**Validation:**
- Verified referenced source paths and relative documentation links.
- `node scripts/trim-session-log.mjs --check`
- `git diff --check`

**Remaining:**
- Require exact-head PR CI and normal protected merge into `main`.

## 2026-07-23 — Separated Tests authoring from grading

**Risk profile:** none

**Model recommendation:** GPT-5.6 Terra (high) - the slice crosses route-backed workspace mode, dialog accessibility, and a large teacher Tests coordinator while preserving existing grading behavior.

**Completed:**
- Preserved the grading-first, class-wide Tests table and prior decision not to restore large Authoring/Grading tabs.
- Replaced the icon-only pencil with a visible `Edit Test` command so teachers can distinguish test construction from student-work review without leaving the selected test.
- Gave the editor dialog an explicit accessible `Edit test` name and visible mode label.
- Extracted authoring-only dialog, markdown-view, and title-portal composition into `TeacherTestAuthoringDialog`, reducing state and presentation ownership in `TeacherTestsTab`.
- Left APIs, grading behavior, schema, migrations, Gradex, production state, student UI, and deferred mobile UX unchanged.

**Validation:**
- Focused teacher Tests authoring/workspace suites (2 files / 67 tests)
- Full repository suite (407 files / 3,680 tests)
- `pnpm exec tsc --noEmit`
- `pnpm lint`
- `pnpm check:architecture` (624 modules / 0 allowances)
- `pnpm build`
- Pika changed-file audit
- Composite-widget accessibility checklist: reviewed; keyboard focus return and dialog semantics covered by tests; no remaining manual accessibility follow-up
- In-app browser visual matrix: teacher Tests grading table plus `Edit Test` and `New Test` dialog states at desktop and mobile breakpoints in light and dark themes; no viewport overflow, clipped controls, or grading-workspace regression observed
- Keyboard verification: tab focus showed the browser focus outline on `Edit test title`, and closing the dialog returned focus to `Edit Test`
- The in-app browser capture compositor tiled each screenshot; the repeated rendered tiles and measured DOM bounds agreed, with dialog and document widths contained in every tested viewport
- `git diff --check`

**Remaining:**
- Complete targeted independent rereview and exact-head PR CI.
- Continue Tests with standalone preview authorization/framing, then student flag/save accessibility; keep mobile and Gradex deferred.

## 2026-07-23 — Retired legacy Quiz API response aliases

**Risk profile:** none

**Model recommendation:** GPT-5 Codex - the pass crosses student and teacher API producers, client normalizers, component consumers, and contract documentation.

**Completed:**
- Closed the internal Tests API compatibility window and removed legacy `quiz` / `quizzes` response aliases from active student and teacher Tests routes.
- Removed quiz-key fallback reads and compatibility fixtures while preserving current `test` / `tests` handling for optional and error payloads.
- Added route assertions and an architecture ratchet preventing the retired response helpers from returning.
- Documented the cutoff, older-client risk, code-only rollback, and remaining database, archive, gradebook, package, component, URL, and automation compatibility boundaries.
- Left schema, migrations, persisted `quiz_id` fields, archive v1 resources, gradebook tombstones, and course package compatibility unchanged.

**Validation:**
- Focused Tests API/client/component suites (12 files / 208 tests)
- Full repository suite (408 files / 3,674 tests)
- `pnpm exec tsc --noEmit`
- `pnpm lint`
- `pnpm check:architecture` (624 modules / 0 allowances)
- `pnpm build`
- Pika changed-file audit
- `git diff --check`

**Remaining:**
- Require independent PR review and exact-head CI before merge.
- Next retire unused component prop wrappers and the legacy test automation id; preserve database-shaped fields and the old `tab=quizzes` URL tombstone.

## 2026-07-23 — Retired legacy Quiz UI wrappers

**Risk profile:** none

**Model recommendation:** GPT-5 Codex - the pass crosses shared Test component contracts, draft identity, exam-mode E2E setup, and the legacy retirement ratchet without changing rendered behavior.

**Completed:**
- Removed unused `quiz`, `quizId`, `quizTitle`, and `onQuizUpdate` component and hook aliases after confirming no production callers remained.
- Made current Test identity and update props explicit and required.
- Renamed the internal student action-footer automation id from `student-quiz-action-footer` to `student-test-action-footer`.
- Updated student and teacher exam-mode E2E setup to decode the current `test` API response key.
- Removed the final quiz-keyed Tests list payload type from assessment URL-state E2E setup after independent review.
- Added an architecture ratchet preventing retired UI aliases and the old automation id from returning.
- Preserved the `tab=quizzes&quizId=...` old-link tombstone, persisted `quiz_id` fields, schema, archives, gradebook tombstones, and course package compatibility.

**Validation:**
- Focused wrapper and component suites (7 files / 115 tests)
- Full repository suite (408 files / 3,670 tests)
- Exam-mode Playwright discovery (10 tests)
- `pnpm exec tsc --noEmit`
- `pnpm lint`
- `pnpm check:architecture` (624 modules / 0 allowances)
- `pnpm build`
- Pika changed-file audit
- `git diff --check`

**Remaining:**
- Require independent PR review and exact-head CI before merge.
- Next prove and remove unreachable quiz-mode rendering and legacy quiz markdown code while preserving URL and data contracts.

## 2026-07-23 — Retired standalone legacy Quiz Markdown

**Risk profile:** none

**Model recommendation:** GPT-5 Codex - the pass removes an isolated compatibility parser/serializer and consolidates the shared editor on its already-current Test Markdown contract.

**Completed:**
- Removed `src/lib/quiz-markdown.ts` and its dedicated compatibility test after confirming no package, archive, import, or persisted-data reader depended on it.
- Consolidated `TestDetailPanel` draft serialization, Markdown parsing, document handling, and question-field preservation on `testToMarkdown` / `markdownToTest`.
- Added an architecture ratchet preventing the retired module and its assessment/quiz Markdown aliases from returning.
- Updated the cleanup guide to identify unreachable quiz-mode rendering as the next implementation pass.
- Preserved persisted `quiz_id` fields, schema, archives, gradebook tombstones, course package compatibility, and the `tab=quizzes` URL tombstone.

**Validation:**
- Focused Markdown, component, and architecture suites (3 files / 53 tests)
- Full repository suite (407 files / 3,666 tests)
- `pnpm exec tsc --noEmit`
- `pnpm lint`
- `pnpm check:architecture` (623 modules / 0 allowances)
- `pnpm build`
- Pika changed-file audit
- `git diff --check`

**Remaining:**
- Run full repository validation, independent PR review, and exact-head CI before merge.
- Next prove and remove unreachable quiz-mode rendering and wording from current Test components.

## 2026-07-23 — Retired unreachable Quiz rendering

**Risk profile:** none

**Model recommendation:** GPT-5 Codex - the pass traces Test-only callers through large teacher and student components, removes dead rendering/contracts, and preserves persistence and compatibility boundaries.

**Completed:**
- Removed assessment-mode switches and unreachable quiz submission, result, list-badge, authoring, preview, and grading branches from active Test components.
- Consolidated student Test form submissions and returned results on current structured Test payloads.
- Removed the orphaned `TestIndividualResponses` and `TestMultipleChoiceQuestionEditor` modules and their isolated compatibility coverage.
- Simplified Test detail draft saves on the already-current full Markdown snapshot path and retained stale-request guards by test, classroom, and API scope.
- Preserved authoring-preview freshness with uncached reads and a request-generation guard so a late stale response cannot replace a newer refresh.
- Updated the governed native-control registry for the removed controls and modules.
- Added architecture ratchets for retired modules, props, helpers, test ids, and rendering branches.
- Updated the cleanup guide so the next pass is archive/schema migration design and production evidence, not cosmetic naming.
- Preserved schema, migrations, persisted `quiz_id`, legacy archive resources, gradebook tombstones, course-package compatibility, and the `tab=quizzes` URL tombstone.

**Validation:**
- Focused component and architecture suites (7 files / 118 tests)
- Full repository suite (407 files / 3,662 tests)
- `pnpm exec tsc --noEmit`
- `pnpm lint`
- `pnpm check:architecture` (621 modules / 0 allowances)
- `pnpm run check:ui-policy` (207 registered native controls / 65 files)
- `pnpm build`
- Pika changed-file audit
- Teacher/student Test visual verification across desktop/mobile and light/dark, including teacher authoring and the student form
- `git diff --check`
- Independent review found one blocking in-flight preview freshness regression; fixed with a request-generation guard and deferred-response regression coverage.

**Remaining:**
- Require independent PR review and exact-head CI before merge.
- Next gather read-only production evidence and design the archive-compatible schema retirement plan; no migration may be applied without exact one-time approval.

## 2026-07-23 — Designed legacy Quiz schema retirement

**Risk profile:** none

**Model recommendation:** GPT-5 Codex - the pass crosses hosted evidence, archive format versioning, deterministic backfill, package compatibility, and destructive migration rollback without applying schema changes.

**Completed:**
- Added a target-pinned, redirect-rejecting, read-only inventory for legacy Quiz table rows, Quiz drafts, Quiz blueprint assessments, and verified archive manifest counts.
- Required two matching aggregate snapshots and emitted no row ids, titles, content, storage paths, or credentials.
- Ran the inventory against production project `zhioqbapgfcrronyuidm`: 1 quiz, 3 questions, 60 responses, 0 manual score overrides, 0 Quiz drafts, and 0 Quiz blueprint assessments.
- Confirmed the single verified archive-v1 manifest contains the same non-empty Quiz graph.
- Designed archive-v2 retired-assessment envelopes instead of mapping historical Quiz rows into active Tests, which would resurface removed product data and lose whole-assessment override semantics.
- Defined additive adapter, freeze/backfill, production-proof, destructive-retirement, gradebook, and course-package passes with explicit approval, validation, and forward-repair gates.
- Created no migration and performed no production write.

**Validation:**
- Focused inventory, archive, package, gradebook, docs, and architecture suites (8 files / 96 tests)
- Full repository suite after review remediation (409 files / 3,672 tests)
- `pnpm exec tsc --noEmit`
- `pnpm lint`
- `pnpm check:architecture` (622 modules / 0 allowances)
- `pnpm build`
- Pika changed-file audit
- Production inventory completed with two stable snapshots

**Review:**
- Independent review found that the plan needed an explicit version-keyed
  TypeScript/database archive transition and an atomic fate for zero-row Quiz
  blueprint assessments.
- The same review found that equal-count archive replacement was not part of
  private snapshot stability evidence.
- Added the versioned registry, operation/RPC, constraint, deployed-code fixture,
  and blueprint lock/preflight requirements; added private archive UUID/checksum
  comparison and concrete duplicate, count-drift, and truncated-page tests.
- Targeted review caught ambiguous destructive-pass wording; clarified that v2
  becomes current without deleting either immutable registry graph or the v1
  adapter, and required a post-drop v1 restore fixture.
- Re-ran the target-pinned production inventory with stable unchanged aggregates.

**Remaining:**
- Require independent PR review and exact-head CI before merge.
- Next implement the additive retired-resource envelope and archive-v2/v1 adapter only after explicit approval to create its named migration; do not apply it without separate exact target-and-filename authorization.

## 2026-07-23 — Established versioned Quiz archive compatibility

**Risk profile:** runtime-platform

**Model recommendation:** GPT-5.6 Terra - the pass freezes a historical archive
contract, adds version dispatch, and converts legacy relational data into a
future persistence shape without enabling unapproved schema behavior.

**Completed:**
- Froze the exact 42-resource archive-v1 table, primary-key, and actor-reference
  contract independently from the live database inventory.
- Added explicit v1/v2 manifest schemas and registry dispatch while retaining v1
  as the only enabled export and restore contract.
- Restricted locale-dependent canonical serialization/checksum recovery to v1;
  v2 accepts only the current deterministic canonical form.
- Defined the inactive v2 graph with generic retired-assessment record and actor
  resources instead of the four Quiz tables.
- Added a deterministic, non-mutating adapter that preserves complete Quiz and
  Quiz-draft payloads, parent identities, actor references, timestamps, and
  canonical SHA-256 evidence without mapping retired data into Tests.
- Expanded the verified non-empty v1 fixture to include all four Quiz resources,
  a manual score override, and a Quiz draft.
- Froze portable v1 tar-content, manifest-content, and per-resource hashes so
  the non-empty contract cannot be regenerated with silent Quiz drift.
- Tightened independent-review findings: Quiz drafts retain and validate their
  Quiz parent; adapter replay preserves existing envelopes; archived actor
  references must resolve; and strict v2 verification rejects malformed,
  checksum-invalid, orphaned, actor-invalid, or credential-shaped envelopes.
- Added an explicit Gradex capability gate and moved source download, checksum,
  strict verification, identity, and metadata-version binding before operation
  creation so disabled or mislabeled v2 causes zero RPC or storage writes.
- Restricted inactive-v2 envelopes to the declared legacy Quiz source contract
  and added a resource registry that enforces payload identity, required
  parent/FK shape, classroom binding, cross-parent Quiz identity, actor-to-
  payload equality, required actor fields/references, and credential-key
  rejection including client secrets, private keys, and token variants.
- Updated the retirement plan and cleanup guide to distinguish the completed
  application foundation from the approval-gated database/v2 activation work.
- Created no migration and performed no production write.

**Validation:**
- Focused archive contract, format, restore, adapter, Gradex, and docs suites
  (7 files / 59 tests)
- Full repository suite after review fixes (411 files / 3,690 tests)
- `pnpm exec tsc --noEmit`
- `pnpm lint`
- `pnpm check:architecture` (624 modules / 0 allowances)
- `pnpm build`
- Portable empty-v1 tar SHA:
  `4d3c518c262c5269844b112953dab52b08b68e7999ec235f422e126f54306093`
- Non-empty Quiz-v1 tar SHA:
  `32dd2bd5ed2bc3795076831385d01a2e046589b4b8d88949de4d24c731314e58`

**Remaining:**
- Require changed-file audit, independent PR review, and exact-head CI before merge.
- Next create the envelope tables and versioned database archive registry, then
  activate v2 export/restore, only after explicit approval to create the named
  migration; applying it requires separate exact target-and-filename permission.

## 2026-07-23 — Activated the additive archive-v2 contract locally

**Risk profile:** runtime-platform

**Completed:**
- Added migration `105_classroom_archive_v2_contract.sql` with private retired
  assessment envelopes, a version-keyed archive registry, operation contract
  pins, archive format-v2 metadata, and distinct v2 export/restore RPCs while
  preserving every deployed v1 RPC and source table.
- Activated archive-v2 export through deterministic v1 Quiz adaptation and
  activated both v1 and v2 restore into the generic envelope graph.
- Kept Gradex on v1 and made v2 compaction plus envelope-backed source export
  fail closed until the freeze/backfill pass provides direct v2 snapshots.
- Preserved full Quiz, question, response, manual-score, and Quiz-draft payloads
  with actor references; added a direct v1-to-v2 archive/restore round trip.
- Applied migration 105 only to the local validation database after explicit
  authorization. The first attempt rolled back on deferred FK ordering; moved
  the version-registry FK creation after seed rows and validated the corrected
  schema. No hosted database was changed.
- Regenerated `src/types/database.generated.ts` and added a transactional v2
  database harness to CI. Legacy v1 export/restore/compaction and Gradex
  database harnesses remain green.

**Validation:**
- Full repository suite at the final head: 412 files / 3,710 tests.
- Focused final suite: 20 files / 232 tests.
- Local v1 export, v1 restore, v1 compaction, Gradex, and v2 export/restore
  database contracts.
- `pnpm exec tsc --noEmit`, `pnpm lint`, `pnpm run db:types:check`, migration
  filename/static checks, `git diff --check`, and Pika changed-file audit.

**Remaining:**
- Run architecture/build/full final validation at the exact head.
- Open the PR, independently review and remediate it, then require exact-head CI.
- Migration 105 still requires separate explicit authorization for every hosted
  target. The next implementation pass is the atomic freeze/backfill ledger.

## 2026-07-23 — Closed archive-v2 contract review blockers

**Risk profile:** runtime-platform

**Completed:**
- Registered the retired assessment record and actor tables in the live
  44-resource classroom ownership graph while keeping archive v1 frozen at 42
  resources and archive v2 at 40.
- Preserved the deployed v1 production inventory contract and separated v1
  fixtures from the expanding live ownership graph.
- Reordered restore URL rewriting so v1 source rows are transformed before
  envelope adaptation, direct v2 payload checksums are recomputed, and the final
  staged envelope graph is validated after all transformations.
- Moved the original v1 export begin implementation to a private compatibility
  function. Both public v1 and v2 begin RPCs now lock the classroom revision
  before checking for envelopes, fail closed without snapshot rows, preserve
  completed replay, and serialize concurrent envelope insertion.
- Added a real two-session database race proving an uncommitted envelope cannot
  cross the export fence, plus legacy entry-point and zero-snapshot assertions.
- Made the v2 database harness select the configured Pika Supabase container
  instead of the first matching local project.
- Applied only the corrected 105 function segment to `supabase_db_pika` under
  the existing local authorization; migration history remains 001-105 and no
  hosted database was changed.

**Validation:**
- Full repository suite: 412 files / 3,710 tests.
- Local v1 export, restore, compaction, Gradex, and v2 database contracts.
- Live local ownership audit: 123 foreign-key relationships.
- `pnpm exec tsc --noEmit`, `pnpm lint`, `pnpm check:architecture`,
  `pnpm run check:ui-policy`, `pnpm run db:types:check`, `pnpm build`,
  `git diff --check`, shell syntax check, and Pika changed-file audit.

**Remaining:**
- Commit and push the remediation, run targeted and integration re-review, and
  require exact-head CI before merging PR 927.
- Migration 105 remains unapplied to every hosted target.
- After merge, implement the separately reviewed atomic Quiz freeze/backfill
  ledger; applying its migration requires a new exact authorization.
