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

## 2026-07-23 — Hardened standalone test preview

**Risk profile:** workspace-state, exam-mode, authorization, external-network, schema

**Model recommendation:** GPT-5.6 Sol and Terra (high) - this slice crosses authorization, concurrent ownership, outbound document fetching, atomic persistence, focus, and the full-screen exam-mode shell.

**Completed:**
- Added route regressions for unauthenticated, non-teacher, non-owner, classroom/test mismatch, and authorized teacher access.
- Made `testId` the preview-data owner and invalidated requests only at committed effect boundaries so abandoned concurrent renders cannot stall the active preview.
- Hid old-owner content until the current preview finishes loading and ignored every late visible-state write from superseded requests.
- Added A/B and suspended-render regressions proving preview B survives late A and committed A survives an abandoned B render.
- Added named preview, document, and question regions plus keyboard focus transfer into an opened document and restoration to its trigger on close.
- Revalidated the measured window fallback after blocked fullscreen/resize attempts and on later resize so non-maximized content relocks.
- Added a DNS-resolving, address-pinned outbound fetch boundary that rejects private/reserved IPv4 and IPv6 targets, mixed DNS answers, and public-to-private redirects.
- Added migration 105 for an atomic snapshot attach that locks test/classroom ownership, rejects archive/document/URL conflicts, preserves concurrent document changes, and returns the exact superseded snapshot for cleanup.
- Switched snapshots to unique immutable storage paths and remove uncommitted or superseded objects after persistence outcomes.
- Preserved the existing full-screen composition. Migration 105 was applied locally under one-time authorization and generated database types were refreshed; production, Gradex, and deferred mobile layout work were unchanged.

**Validation:**
- Focused preview, document sync, safe-fetch, migration, and existing editor suites (8 files / 77 tests)
- Full repository suite (413 files / 3,712 tests)
- `pnpm exec tsc --noEmit`
- `pnpm lint`
- `pnpm check:architecture` (625 modules / 0 allowances)
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

## 2026-07-23 — Staged the additive archive-v2 contract locally

**Risk profile:** runtime-platform

**Completed:**
- Added migration `105_classroom_archive_v2_contract.sql` with private retired
  assessment envelopes, a version-keyed archive registry, operation contract
  pins, archive format-v2 metadata, and distinct v2 export/restore RPCs while
  preserving every deployed v1 RPC and source table.
- Validated archive-v2 export through deterministic v1 Quiz adaptation and
  validated the explicit v1/v2-to-envelope restore path. Kept current
  application export and restore on v1 because compaction remains v1-only and
  migration 105 is not hosted.
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

## 2026-07-23 — Kept archive v1 current through compaction

**Risk profile:** runtime-platform

**Completed:**
- Final integration review found that making v2 the current application export
  format was incompatible with the still-v1-only compaction path.
- Kept explicit v2 construction and v1/v2 restore support, but restored v1 as
  the current application writer and retained the deployed v1 RPC flow.
- Updated contract and coordinator tests to prove the current writer preserves
  historical Quiz rows in v1 while the explicit v2 compatibility path remains
  independently testable.
- Shortened the continuity summary to restore the startup-document budget.

**Validation:**
- The full local archive recovery drill passes export, compaction, restore,
  cleanup, and idempotent replay with the frozen 42-resource v1 graph.
- Focused archive and migration suites, startup-document tests, TypeScript, and
  lint pass.

**Remaining:**
- Run final repository checks, integration review, and exact-head CI before
  merging PR 927.
- Migration 105 remains unapplied to every hosted target.

## 2026-07-23 — Preserved pre-105 archive restore rollout

**Risk profile:** runtime-platform

**Completed:**
- Final integration review found that the application restore coordinator
  required migration 105 even though no hosted target has it.
- Restored the active coordinator and compaction preflight to the deployed v1
  planner and migration-083 RPCs; current export, compaction, and restore now
  share the frozen 42-resource v1 contract.
- Kept a separate explicit v2 planner for compatibility validation without
  making it reachable from the current application coordinator.
- Froze the v1 restore order and protected it with a digest and exact resource
  set regression.
- Clarified that migration 105 is additive for data and public API surface, but
  broadens v1-only constraints and wraps selected implementations internally.
- Added a live database assertion that all six deployed v1 archive RPC
  signatures and service-role grants survive migration 105.

**Validation:**
- Active v1 and explicit v2 restore planning tests pass.
- Local v1 export, restore, compaction, Gradex, and v2 database harnesses pass.
- Full local archive recovery drill passes export, compaction, restore,
  cleanup, and idempotent replay.
- TypeScript, lint, shell syntax, Pika changed-file audit, and focused tests
  pass.

**Remaining:**
- Push the remediation, run the final authorized targeted review, and require
  exact-head CI before merging PR 927.
- Migration 105 remains unapplied to every hosted target.

## 2026-07-23 — Froze archive restore ordering

**Risk profile:** runtime-platform

**Completed:**
- Derived the inactive v2 restore order from the frozen topological v1 order
  with Quiz resources removed, then appended the retired-assessment record and
  actor resources parent-first.
- Removed the final live classroom-graph dependency from v1 compaction
  preflight staging.
- Added regressions for every declared v2 parent-before-child dependency and
  the actual non-empty v1 compaction staging sequence.

**Validation:**
- Focused archive contract, restore, and compaction tests pass.
- TypeScript and lint pass.
- Local compaction database harness and full archive recovery drill pass.

**Remaining:**
- Publish, independently review, and require exact-head CI before merge.
- Then proceed to the separately authorized atomic Quiz freeze/backfill pass.

## 2026-07-23 — Prepared atomic legacy Quiz freeze and backfill

**Risk profile:** runtime-platform

**Completed:**
- Added migration 106 to freeze the retired Quiz tables and drafts, prove Quiz
  blueprints are empty, and narrow the constraint to Test-only. Archive-ordered
  parent/child `NOWAIT` locks roll back immediately on live conflicts.
- Added deterministic SQL envelope IDs and canonical payload checksums matching
  the TypeScript adapter, parent and actor preflights, collision checks, and an
  aggregate-only five-resource parity ledger.
- Kept every source row intact for the observation window and added no
  dual-write or active Test-table mapping.
- Added a disposable rehearsal for v1/v2 compatibility, failed preflights,
  envelope/source lock contention, the freeze and ledger, and SQL/TS parity.
- Documented that migration 106 cannot be hosted until direct v2 snapshots,
  version-aware compaction, and v1-to-v2 restore dispatch are current.

**Validation:**
- Focused migration and archive-v2 unit tests, TypeScript, shell syntax, and
  `git diff --check` pass.
- Migration 106 was not applied to the shared local database or a hosted
  target; its executable rehearsal is reserved for disposable PR CI.

**Remaining:**
- Run repository checks, independent review, and exact-head CI before merge.
- Next pass: implement the version-aware archive runtime required before
  migration 106 can receive target-specific application approval.

## 2026-07-23 — Activated direct archive-v2 runtime

**Risk profile:** runtime-platform

**Completed:**
- Recorded the maintainer decision that experimental Quiz rows, drafts,
  envelopes, and Quiz portions of v1 artifacts are disposable.
- Added migration 107 to purge Quiz source rows/drafts/envelopes, narrow
  drafts to Tests, promote the live archive registry to v2, and capture source
  contract 2 directly.
- Made export, restore, and compaction strict v2 paths with no pre-107 RPC
  fallback. V1 restore now discards Quiz resources while retaining other
  classroom content.
- Extended disposable replay through migrations 106-107 and proved direct
  source counts, snapshot membership, upload intent, and finalization.
- Review remediation now purges the frozen Quiz source rows, fences retryable
  operations, and makes compaction use migration-107-specific v2 RPCs. V1
  archives must be re-exported before compaction.

**Validation:**
- Focused archive coordinator tests and TypeScript pass.
- The disposable freeze/backfill/direct-source database harness passes.
- Current-export and atomic-compaction database harnesses pass against the
  disposable post-107 schema, including a complete v2 cold transition.
- No shared local or hosted migration was applied.

**Remaining:**
- Complete repository validation, independent review, exact-head CI, and merge.
- Next pass: migration 108 hard-drops the legacy Quiz schema and removes the
  remaining active compatibility types and payload fields.

## 2026-07-23 — Prepared legacy Quiz hard removal

**Risk profile:** runtime-platform/destructive-schema

**Completed:**
- Added migration 108 to fail closed unless migration 107 purged all retired
  data, then drop the four Quiz tables, their catalog helpers, the private
  backfill ledger/functions, `gradebook_settings.quizzes_weight`, v1 database
  export RPCs/registry rows, and retired site-configuration keys.
- Removed active Quiz branches and aliases from assessment drafts, gradebook,
  course packages, publishing, blueprints, current domain types, and server
  helpers. Course packages now export v4 and import v2/v3/v4; the v2 reader
  discards `quizzes.md` while preserving reusable non-Quiz content.
- Reduced the live classroom ownership graph from 44 to 40 resources while
  retaining the immutable archive-v1 resource contract solely for discard-only
  restore of non-Quiz classroom data.
- Regenerated Supabase database types from a disposable post-108 database; the
  generated contract has no Quiz tables, fields, or functions.
- Removed obsolete retirement inventory, backfill parity, and envelope adapter
  utilities after their destructive decision was finalized.
- Review remediation preserves course-package v2 as an import-only boundary,
  discarding `quizzes.md` while retaining reusable non-Quiz content. V1
  classroom restore now excludes Quiz-only actors and storage objects from the
  restore plan after validating the complete source artifact.
- Migration 108 now requires exact equality between the live archive registry
  and versioned source contract 2. The disposable harness proves registry drift
  fails without deleting v1 metadata or Quiz tables before restoring the
  registry and completing hard removal.
- Final integration review found the production archive canary still bound to
  archive v1. The operator runner and runbook now use archive format 2, the
  40-resource graph, migration-107 source/restore contracts, and the current v2
  restore planner. A subprocess smoke test loads the actual excluded script so
  future import drift fails in Vitest.

**Validation:**
- Fresh disposable replay through migrations 106-108 passes freeze, direct
  archive-v2 activation, hard-removal catalog assertions, current export,
  restore, and compaction contracts.
- Generated Supabase types exactly match the disposable post-108 schema.
- TypeScript, lint, architecture, UI policy, shell syntax, `git diff --check`,
  and the Pika pre-commit audit pass.
- Full coverage passes: 413 files and 3,684 tests. The post-108 atomic blueprint
  database contract also passes against the disposable database.
- The focused post-review archive suite passes: 4 files and 53 tests, including
  actual operator-runner loading. TypeScript, lint, architecture, diff checks,
  and the Pika audit remain green after the canary port.
- Migration 108 was not applied to the shared local database or any hosted
  target.

**Remaining:**
- Complete PR review/remediation, exact-head CI, and merge. Applying migration
  108 remains separately target-authorized.

## 2026-07-23 — Rebased test-preview hardening after Quiz removal

**Risk profile:** workspace-state/exam-mode/runtime-platform/schema-mismatch

**Completed:**
- Rebased PR 920 onto the completed legacy Quiz removal on `main`, preserving
  the canonical test-only API and both preview request-order regressions.
- Resequenced the atomic snapshot migration to 109 and consolidated the
  uncommitted document-authoring and durable-cleanup schema into migration 110.
- Kept ordinary document writers behind compare-and-swap updates, added a
  leased storage-cleanup queue and cron worker, and retained real transport
  SSRF/timeout coverage.
- Left the shared local database unchanged. It remains reset and seeded through
  migration 104; migrations 105-110 are unapplied there.

**Validation:**
- Full Vitest coverage passes: 421 files and 3,749 tests.
- Pika pre-commit audit, ESLint, production build, and `git diff --check` pass.
- No local or hosted migration was applied.

**Remaining:**
- Run targeted security rereview and final integration review.
- Push the rebased exact head, wait for CI, and merge only after approval.

## 2026-07-24 — AI-readiness CLI probe, course-import fix, repo tidy

**Completed:**
- Explored making Pika "AI-ready"; built a delete-able CLI probe (`pnpm pika`, branch `cli-probe`) that drives teacher operations headlessly via the existing role-gated API — no server changes. Logs in through `POST /api/auth/login`, persists the session cookie to `.auth/` (gitignored), and reuses the shared markdown contracts so a script produces exactly what the UI does. Commands: `login`, `whoami`, `test pull/push`, `course list/push/instantiate`; writes are dry-run unless `--yes`. Added `scripts/pika-cli-smoke.ts` (`pnpm smoke:pika-cli`) whose pull→push→pull round-trip is a drift detector. Pushed the branch to start a usage trial; not a merge candidate.
- The probe surfaced a real bug on first use: importing a course package containing tests/lesson-plans failed with `400 assessments.N: Unrecognized key: "id"`, affecting both the JSON API and the UI's tar upload. Root cause: markdown parsers attach `id: existingMatch?.id` (undefined on fresh import), which zod 4 rejects on `.strict()` schemas; assignments were normalized but assessments and lesson templates were passed raw. Fixed by normalizing all three consistently in `buildCreateBlueprintWritePlan`, with regression tests at the write-plan layer (the existing route test mocks the function, so it could not catch this). Merged as PR #932.
- Fixed `scripts/repo-tidy.sh` to classify worktrees by PR state (reusing the existing `PR_MAP`) instead of remote presence, since squash-merge + delete-on-merge makes "not on remote" the normal state of merged work — the old logic inverted the risk signal (33 of 44 flagged items were already merged). Merged as PR #934.
- Repo hygiene: reduced worktrees from 48 to 6 (removed 42 merged/closed-PR worktrees and local branches, remotes preserved for recovery), deleted one merged remote branch, and closed stale PR #567.

**Validation:**
- Full `pnpm test` (413 files, 3688 tests) on the #932 fix; regression tests confirmed to fail without the patch with the exact production error.
- End-to-end via the CLI against fixed `main`: `course push` with `tests.md` imports, `course instantiate` creates a classroom, and both quizzes materialize as real tests — the exact case that failed pre-fix.
- `pnpm smoke:pika-cli --full` passes; typecheck and `pnpm check:architecture` clean on both PRs.

## 2026-07-24 — Aligned Claude workflow guidance

**Risk profile:** none

**Completed:**
- Aligned the Claude session-start and workflow-reset commands with the
  canonical startup and worktree guidance.
- Simplified the Claude issue helper to route worktree setup through
  `docs/dev-workflow.md` instead of hardcoding one named-worktree layout.
- Added semantic prompt invariants covering both Claude and Codex startup,
  workflow-reset, and issue-helper surfaces.

**Validation:**
- `pnpm vitest run tests/unit/ai-startup-docs.test.ts` passes: 31 tests.

**Remaining:**
- None.
- `pnpm run db:types:check`
- Pika changed-file audit and composite-widget accessibility checklist
- Playwright teacher preview captures at desktop and mobile light/dark, including mobile-dark document-open focus, plus a student-authenticated denial capture; no horizontal overflow
- Component keyboard regression for document focus entry/return and semantic region assertions
- Live pinned public HTTPS fetch returned `200`; direct/mixed/private/IPv4/IPv6/NAT64 and redirect rejection tests issue no unsafe request
- Local migration history reports 105 applied; generated types match; the RPC exists with execute granted only to `service_role`
- `git diff --check`

**Remaining:**
- Require targeted security review, final integration review, exact-head CI, and protected merge.
- Apply migration 105 to each deployment target before deploying the updated sync route.
- Continue Tests with student flag pressed semantics and save/flag announcements; keep mobile and Gradex deferred.

## 2026-07-24 — Remediated test-preview review findings

**Risk profile:** workspace-state/exam-mode/runtime-platform/schema-mismatch

**Completed:**
- Rebased PR 920 onto current `main` and retained collision-free migrations 109
  and 110 without changing the shared local or hosted databases.
- Closed snapshot cleanup races by requiring pending provisional evidence under
  a row lock before attachment and by making the database concurrency harness
  use a deterministic lock barrier.
- Defined durable snapshot ownership across live tests, cold archives, and
  defensive legacy blueprint rows. Reusable blueprint capture, persistence,
  export, and instantiation now strip classroom-specific snapshot metadata.
- Applied one absolute deadline across DNS, redirects, and response transport,
  and discard redirect bodies without buffering them.
- Rebound an open teacher-preview document to refreshed same-ID data and close
  the viewer when the document disappears.

**Validation:**
- Focused remediation suite: 12 files and 142 tests.
- Full Vitest suite: 421 files and 3,767 tests.
- TypeScript, ESLint, architecture boundaries, production build, shell syntax,
  `git diff --check`, and Pika changed-file audit pass.
- Teacher preview verified visually at desktop and mobile; student access to
  the teacher-only route correctly renders the unavailable state.
- No migration was applied to the shared local database or a hosted target.

**Remaining:**
- Push the rebased exact head, run the disposable migration/database checks in
  CI, and resolve any exact-head failures before merge.
