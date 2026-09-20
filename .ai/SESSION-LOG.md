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

## 2026-09-13 — Fence mixed attendance parent links

- PR1259 targeted Sol review found that the legacy attendance event FK permits cross-student/classroom children and cascading deletion outside the inventory. Batch2 blocks mismatched identity/occurrence, locks both event and parent scopes for reference mutations, and rejects every unstaged child during local finalization even after a cascading parent disappears. Added pre-existing peer/other-class mismatches and late insertion rejection fixtures; these are unexecuted serialized checks, not committed-row race proof. Migration173 remains unapplied.

## 2026-09-13 — Register academic cleanup CI verification

- Targeted Sol cleared source1498a9d7 after the mixed-attendance correction; no source blocker remains. Added the rollback academic harness to normal Architecture Database Contracts CI, following migration replay and generated-type checks. Workflow/routing tests pass28 cases. The exact173 file/hash is unchanged; direct local schema and separate fixture permission are still pending, and the PR remains draft. Final integration review remains reserved for the runtime/types/typed-bridge-complete change.

## 2026-09-13 — Apply local academic schema and connect generated RPC

- Direct owning-task approval authorized one LOCAL173 application and one separate rollback fixture execution. Normal migration command applied only reviewed173 at SHA256 df86be920c80d21b0530a7d9d3812c6d81608374679bf7b10e99958e6e39dbdd. Ledger001–173 verified; warning-level lint clean; academic/provider gates remain false.171–173 are immutable. Canonical types generated and checked; typed service-only RPC bridge and failure-category/privacy tests added.
- The single approved fixture run failed during setup: a student-only check-in reference collided across two classrooms. Transaction rolled back, zero synthetic users remain and both gates remain false. Corrected fixture ID to include classroom and student. No cleanup/runtime proof claimed; a fresh fixture-run approval is required. Final review extension (up to30minutes from runtime-complete final review launch, one cumulative plus one targeted correction review) has not started. No provider calls/live byte deletion/activation/merge.

## 2026-09-13 — Correct rollback fixture integration assumptions

- Direct approval allowed up to3 local rollback-only retries with fixture-only fixes. All3 attempts rolled back; failures exposed missing simulated storage-readiness fields, a PL/pgSQL variable/alias collision, then an existing Gradebook constraint intercepting the parent-move test. Fixed those fixture assumptions; parent-move now clears the category and requires the exact cleanup guard error. Latest run passed setup/inventory/blocked-case checks but did not reach storage/row deletion or final absence assertions.
- Zero synthetic users, both cleanup gates false and storage mode compatibility verified after each attempt.173 remains byte-identical. Retry permission consumed; further fixture execution needs direct approval. Final review clock has not started because runtime verification is incomplete.

## 2026-09-13 — Verify local academic cleanup end to end

- Direct approval resumed same-local rollback-only fixture validation with fixture-only corrections. Adopted the existing managed-storage fixture pattern for Storage API SQL-delete permission inside the transaction; added exact denial checks without completed providers and with expired leases. The full fixture passes, including22 success categories, all29 allowlisted row tables across success/blocked cases, two file leases, target absence and preserved peer/other-class/account/roster/provider/fence evidence.
- Postflight: zero synthetic users/managed objects/storage rows; both cleanup gates false; storage compatibility restored. Warning-level database lint clean and173 unchanged. No provider HTTP/live byte deletion or committed-row MVCC proof. Final cumulative review follows the runtime-complete committed head under the approved30-minute extension; PR1259 remains draft until review and actual stable-head CI pass.

## 2026-09-13 — Fence late repository grading producers

- Final cumulative Sol review found an unfenced repo-review run INSERT could race local cleanup after a route cached student data. Prepared forward174;173 remains immutable.174 extends the latest indirect purge guard to repo-review runs and installs insert/update/delete protection, preserving old/new scope locking and existing behavior.
- Added route regressions proving denied/failed run creation stops cached-data analysis/AI grading, and deterministic fixture regressions for late run insertion after inventory/completion and moves into/out of fenced classrooms. These do not claim committed-row MVCC proof.174 application requires fresh exact local approval. One targeted review remains within the approved20:20:10–20:50:10 extension; PR1259 remains draft. Latest execution/CI receipts are recorded in that PR.

## 2026-09-13 — Explicit live membership purge integration

Task01a09d38, branch codex/explicit-live-membership-purge: added default-off explicit
Palv2/Bara/academic orchestration, forward175 completion/rejoin candidate and
synthetic lifecycle tests. Preserves strictv1, permanent generation evidence and
shared-data blockers; updates existing roadmap to settled historical-backup
exclusion. No persistent DB/provider/config action. Review/CI still pending.

## 2026-09-13 — Teacher live classroom cleanup integration

Owner `01a09d9e-e75e-7153-8cb6-c15e1d5e3d2a`, branch `codex/teacher-live-purge-dialog` on PR1260 base. Added the removed-membership selector in the roster's existing dialog, explicit live-only confirmation, bounded progress, pre-request saved-key recovery, and guarded completion. Live provider entry rejects incompatible policy before transport; strict APIs and ordinary removal remain unchanged. DeepSeek attempt4 supplied verified bounded mapping (corrected persistence timing). Focused checks, mocked teacher desktop/mobile light/dark screenshots, Pattern Lab reference, and student privacy/draft-preservation fixtures pass. Draft-first independent review and final CI follow; no activation, live purge, migration, production release, or merge authority consumed.

Browser CI follow-up: replaced obsolete active-student purge expectations with absence assertions, retained ordinary removal/re-add/student boundaries, and added the seven-test live cleanup fixture to the existing CI browser selection. The first reviewed-commit Test & Build and database contracts passed; obsolete browser run canceled before this test-only correction. No application/gate configuration changed.

## 2026-09-14 — Keep Daily attendance columns beneath the sticky header

- Owner `codex/daily-attendance-sticky-fix`, PR1262, base `main@1fd8a1da`. On teacher Daily the four pinned attendance status cells and the trailing undo cell in each row shared the `z-sticky-table` layer with the sticky `thead`, so scrolled rows painted over the sortable header band (reported as the columns riding over the header and reaching the control bar).
- Removed the shared layer from those `tbody` cells in `TeacherAttendanceTab.tsx` and the Pattern Lab `DailyMockup.tsx`; they keep `position: sticky` and their left/right offsets, so pinning is unchanged. Header layer untouched, matching the Gradebook frozen-column pattern.
- Added a regression test: the header keeps `sticky top-0 z-sticky-table` and every `tbody td.sticky` omits it (fails if the old layer returns). Focused gate 17 files/244 tests; live hit-testing 0/8 pinned-cell samples above the header after the fix vs 8/8 with the layer re-applied, and no pinned cell reaches the control bar. Draft-first independent review, session entry and exact-head CI tracked on PR1262.

## 2026-09-15 — Compact student past logs
- Task/branch: student past logs, `codex/student-past-logs-compact`.
- Replaced stacked previews with muted date / single-line text rows, click/keyboard expansion, and viewport-sized Older/Newer pages over the existing ten class days. Mobile history now precedes lesson plans so the rows fit below the editor.
- Reused canonical Button (Pattern Lab controls); removed the retired native-button exception. Feature-owned composition only; no shared pattern promotion or unrelated refactor.
- Verification: history and paging interaction tests; focused checks; Playwright student light/dark at 1440×900, 1280×720, and 390×844, collapsed/expanded/focus/paging. Desktop fits 10 rows at 900px and 5 at 720px; mobile fits 10 rows. Teacher n/a (student-only owner). Local screenshots: `output/playwright/past-logs-*`.
- Risk profile: none. Model recommendation: GPT-6 — bounded student UI behavior and visual verification. No schema or data mutations.

## 2026-09-15 — Past logs without paging
- User refinement: removed Older/Newer and range controls. Show only the latest rows fitting the viewport, with an explicit maximum of ten; preserve click/keyboard expansion.
- Updated fit/resize coverage for the ten-row cap and insufficient remaining space. Existing Daily tests pass. Student light/dark desktop/mobile captures refreshed on the local smoke-test server at port 3015.

## 2026-09-15 — Student-work diagnostic privacy, second batch

- Owner `codex/log-privacy-grading-batch`, based on `main@d0971c02`. Replaced direct raw error logging in test save/submit/history/finalization, Gradebook reads/writes, assignment/test auto-grade entry points and test reference-cache writes with allowlisted content-free diagnostics. Existing authorization, queries, responses, retries and best-effort behavior unchanged.
- Added synthetic failure assertions using the real logger and extended the static adoption boundary. Targeted 9 suites/147 tests pass; required focused gate and independent draft-first review follow. Risk profiles: async-grading and runtime-platform. No UI, dependency or migration changes.
- `docs/guidance/application-log-privacy.md` records the diagnostic contract, debugging tradeoff, coverage limits and remaining audit inventory. No production records inspected, historical logs deleted, vendor settings changed or deployment performed. Kept the separate cleanup task and dirty hub context untouched.
- PR1267 initial review: Terra/high found no blockers; Sol/high identified the adjacent student test-history read endpoint as a coverage gap. Remediation batch1 adopts its four raw error sites, adds exact-output/fail-closed tests for each and expands the static boundary. Initial focused gate passed223suites/1993tests; updated focused checks, targeted privacy re-review and final integration review follow. No changes to query/access/response behavior.
- History remediation passed223suites/1998tests and Sol targeted/Terra final review. First ready CI35048462094 exposed one stale architecture-test import allowlist (7013passed/1failed), not a runtime failure. Returned PR to draft and stopped remaining CI. Remediation batch2 adds only the intentional diagnostics import to that exact allowlist; all retired-Quiz/transport guards remain. Final allowed targeted review and fresh exact-head CI follow; no production changes.

## 2026-09-15 Daily log save failure investigation

- Task owns `codex/fix-daily-log-save`. Production logs confirm PATCH student entries and Pal read-token HTTP 500s.
- Production environment had PAL_ENABLED=true and missing PAL_INTEGRATION_SECRET. Correction on 2026-09-16: PAL_PSEUDONYM_SECRET is sensitive and its empty export did not prove it was empty. Reproduced requirePalEnvironment exception with current production config; PAL_ENABLED=false bypasses the failing integration check. No secret values recorded.
- Proposed immediate recovery: disable Pal in production and redeploy the existing production revision. Awaiting live deployment approval; no application or database changes made.

## 2026-09-15 Daily log production recovery

- User approved temporarily disabling Pal achievements and redeploying the existing production revision. Set production PAL_ENABLED=false; verified configuration and removed temporary environment file.
- Redeployed existing production deployment dpl_12DNkzWZKgxpW95KCzPcCMLh8hL9 (production commit 08fae08) to dpl_AbQSHr2x2eDUADM5kfGugmztsLiB. Ready with pika.codepet.ca alias.
- Verification: login HTTP 200; real production PATCH /api/student/entries HTTP 200 at 13:57:52 Toronto; no HTTP 500 logs on new deployment at verification. Achievements remain disabled pending credential repair. No application or database changes.

## 2026-09-15 — Automatic removed-student cleanup source checkpoint

- User selected a five-minute conditional watchdog and automatic system-owned cleanup for new removals. On `codex/removed-student-cleanup`, added migration 176: a private future-only queue, redacted completion evidence, leased service-only claims, an asynchronous Vault-backed immediate callback, callback coalescing, and a conditional Supabase Cron schedule. Historical removals are not backfilled.
- Direct user approval authorized the exact local migration. It applied successfully at SHA256 `274fb228880248e982287c643f1f49d8c03fd7bd91c9082e6134508d2f3f8f71`; the local ledger now matches 001–176, database lint is clean, and all cleanup gates remain false. Canonical generated types include the claim/release RPCs.
- Added the default-off protected worker route and bounded retry orchestration. Removed the teacher-owned live cleanup action and documented system ownership. Focused unit/API/component coverage passes 71 tests; teacher and student Playwright verification passes 20 tests across desktop/mobile and light/dark, with screenshots inspected. No Vault configuration, schedule execution, provider request, student removal, purge, hosted migration, rollout, or production change occurred.
- Added a CI-registered rollback-only synthetic queue/lease harness covering enqueue identity, exclusive claims, retry, stale leases, and completed-row redaction. Its source contract passes, but the harness has not been executed locally because the migration-only approval does not authorize synthetic fixture writes.
- Direct user approval authorized one execution of the exact local rollback-only harness. It passed enqueue identity, exclusive claim, retry/reclaim, stale-lease rejection, and completed-row redaction, then rolled back. Postflight found zero synthetic users/classrooms/roster rows, zero queue jobs, all cleanup gates false, and migration 176 unchanged at its approved hash.
- Initial high-risk Sol/Terra review found three blocking rollout gaps: default-off UI overpromised deletion, claims omitted academic/storage prerequisites, and permanent failures retried forever. Batch1 makes confirmation copy gate-neutral, adds forward177 with atomic academic/enforced-storage claim requirements and terminal quarantine, and classifies non-retryable provider/unsupported ownership failures while continuing later jobs. A 288-attempt ceiling escalates otherwise endless transient retries. Targeted65tests/types and the14-case teacher/student visual matrix pass; revised mobile copy was inspected. Migration177 is source-only and unapplied pending separate exact local approval.
- Targeted Sol review cleared the copy but found post-claim prerequisite drift and lossy SQLSTATE55000 classification. Batch2 rechecks academic/enforced-storage settings at every live provider authorization, treats gate pauses plus active archive/copy conflicts as retryable, and keeps immutable generation/binding failures terminal. The live SQL harness now toggles each prerequisite after reservation, and an adapter-to-worker regression proves a real operation-conflict category performs no provider transport, records retry and avoids quarantine. Targeted42tests/types pass; migration177 remains unapplied.
- Second targeted Sol and final cumulative Terra review cleared all blockers at6d404341. With explicit extension and exact local approval, applied migration177 at SHA256 `f5d8df6e42a4443ca8a0abf954ccb7ff111985d477bfe87157aa97c432c8fbf5`; the expanded rollback-only automatic queue harness passed once. Postflight ledger177, queue/synthetic residues0, provider/live/automatic/academic gates false, storage compatibility, warning-level DB lint clean and generated types match. Batch3 corrects the Phase4 source status and declares/checks both harness prerequisites; one extra targeted review is authorized.
- Stable-head CI exposed a disposable-database portability issue: migration176 correctly installs/schedules pg_cron in the configured postgres database, while the Pal and individual-purge concurrency harnesses replay the migration chain into isolated temporary databases where pg_cron installation is forbidden. Both harnesses now omit only the host-specific extension/schedule statements while replaying all schema and function changes. The exact failed Pal harness, the second affected replay harness, and focused checks (23 files/267 tests plus architecture/UI/design/types/lint) pass locally. Migrations176–177 remain byte-identical; PR1266 stays draft pending a new reviewed stable SHA and green CI.

## 2026-09-16 — Pal empty-request follow-up

- Daily-log resilience PR1269 and production PR1270 merged; production SHA `6375ca1591cf271ecf746e93680383218929e520` deployed, then PAL_ENABLED restored true on deployment `dpl_GE22YKr7oTSgbGhP6brhfW6oEPJ5`. Shared integration credential repaired on both services; original pseudonym secret preserved.
- Live achievement-token requests returned404 without500s. Found account-token route used request.body non-null as a classroom-request signal, but Next server adapters can supply an empty stream for a bodyless POST. Added regression reproducing404 before fix; use actual content length, continuing to reject every nonempty request when classroom rollout is off.
- No classroom rollout flags enabled, no migrations, no student data changed. User authorized release and restoration in this task.

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

## 2026-09-16 Daily log Pal failure containment and credential repair

- Owner `codex/fix-daily-log-save`. Added best-effort preparation/delivery boundaries for POST and PATCH daily logs; malformed Pal configuration/event construction cannot block an authorized save, and delivery exceptions cannot turn a committed entry into a failure. Atomic RPC errors and version conflicts still fail without a second write. Content-free diagnostics; no UI, schema, dependency, or authorization change.
- Regression: 20 failures reproduced before the fix. Initial focused gate passed 2,028 tests plus static checks; added classroom-delivery and preparation privacy checks pass 35 tests. Final focused gate and independent review follow.
- Production metadata corrects prior diagnosis: original sensitive pseudonym secret remains present and unchanged; only shared integration credential was missing from both Pika and Pal. Restored a new matching sensitive integration credential to both projects. Pal current production revision is being redeployed; Pika achievements remain disabled pending provider verification and code release. Existing Pal profiles preserved; no learner data written by verification.

## 2026-09-16 — Student past-log date wrapping
- Keep the StudentPastLogs date label on one line with whitespace-nowrap; reuse existing date column and Button, following stable classroom date language and Pattern Lab controls. No new pattern or composite behavior; teacher n/a.
- Playwright rendered the production component with deterministic September 14/11 fixtures at 1440, 390, and 320px in light/dark, collapsed/expanded and missing-entry states. Date text occupied one line in all 12 captures (/tmp/pika-date-*.png); temporary fixture removed.

## 2026-09-16 — Automatic cleanup production eligibility guard

- Broad production activation was paused before enabling gates: production has 173 active memberships, 61 attendance mappings, and zero immutable provider-generation captures because provider cleanup remains disabled. Migration176 would have queued those legacy removals and quarantined them during reservation.
- Branch `codex/automatic-cleanup-eligibility-guard` adds forward-only migration178. Its trigger queues only an exact post-activation generation with immutable Pal/attendance evidence plus matching participant, roster, and teacher-principal mappings; historical or partial memberships remain removable but are skipped by automation.
- Initial high-risk review found queue enrollment was not serialized with a concurrent operator gate change. Batch1 takes the settings update lock before eligibility and insertion, adds a disposable two-session proof for both lock winners, distinguishes true pre-cutoff history from partial provider evidence, and updates rollout guidance. The concurrency proof and focused checks pass (99 tests plus architecture, UI/design policy, TypeScript and lint). Migration178 remains unapplied locally and in production pending exact target-specific authorization and CI replay; every production cleanup gate remains off.

## 2026-09-17 — Grading moved to DeepSeek; score anchors staged

Branch `claude/beautiful-mayer-4jk2lf`, remote-container session. Replaced the OpenAI Responses grading provider with DeepSeek `deepseek-flash` across assignment, test and repository-review paths; `openai-responses.ts` is deleted and log summaries/developer feedback/curriculum import stay on OpenAI. DeepSeek guarantees only syntactic JSON, so the provider requests `json_object`, appends the profile schema to the system prompt, and relies on the engine's existing per-field validation. Reasoning effort raised `minimal`→`medium` on all three paths, assignment output budget 220/420→800/1600, and all four grading policy versions bumped to v2. Config is now `DEEPSEEK_API_KEY`/`DEEPSEEK_GRADING_MODEL`. Open item: DeepSeek exposes no `store: false` equivalent, so grading retention is account-level only; recorded in the egress audit, unconfirmed with the owner.

Stage 1 of per-assignment score anchors landed disabled behind `ASSIGNMENT_GRADING_ANCHORS_ENABLED`. `pika-assignment-anchors` generates four fixed-band descriptors per criterion; `pika-assignment-anchored` is a sibling grading profile sharing rubric, output schema and normalization, so provenance records which prompt ran with no schema change and no migration. No caller passes anchors yet, so live grading is unchanged. `pnpm eval:assignment-anchors <class-code> <title>` reads an assignment through `buildAssignmentGradingRequest` and A/Bs anchored against unanchored; `--show` prints the sanitized payload without calling the provider. Added `.claude/settings.json` denying reads of `.env*`.

Verification: tsc, lint, `check:architecture` (961 modules) clean; 7083/7084 tests. The one failure, `ai-startup-docs > keeps verify-env fast by default`, is pre-existing (container runs Node 22, repo requires 24) and reproduces on a stashed clean tree.

NEXT: run `pnpm eval:assignment-anchors ppz3c A1` locally with a real key and compare anchored vs baseline spread against the teacher's own marks. Proceed to stage 2 (migration 176, anchor caching, read-only teacher panel — specified in `docs/plans/assignment-grading-anchors.md`) only if spread widens without inverting that ranking. Type regeneration without Docker images is documented in that plan and was verified against all 175 migrations.

## 2026-09-17 — Calendar due-chip prefix
- Reused LessonDayCell's expanded due-label wording in compact cells: `Due: <assignment title>`; added compact coverage to the existing chip test.
- Reference: existing expanded calendar chip and Pattern Lab calendar owner. Risk: none. Both roles, desktop/mobile, light/dark default chips captured using a temporary fixture of the production LessonCalendar (output/playwright); narrow cells retain ellipsis. No new design pattern or composite interaction.
- First focused run hit two unrelated 5-second test timeouts while the preview compiled; rerunning without the preview server.

## 2026-09-17 — Removed-student cleanup reliability follow-up

- Owner `codex/student-purge-reliability`, based on `origin/main@f8d0e514`. Production investigation found Zoe's post-activation removal was silently skipped because her exact Pal generation and active attendance mapping existed but the immutable attendance-generation row did not.
- Migration179 repairs that exact evidence at removal time only when the retained enrollment timestamp is post-cutoff, the Pal generation/scope match, and the active classroom/student participant mapping is exact. Eligible incomplete mappings become durable quarantined jobs instead of invisible skips; pre-cutoff memberships remain excluded.
- Local finalization now invalidates target-tainted daily summary/feedback derivative caches while preserving classmate source rows, ignores aggregate-only attendance override receipts, and permits exact ledger-authorized deletion of immutable submit history. Full migration replay plus queue, local academic cleanup, and failure-concurrency rollback harnesses pass in a disposable database; focused checks pass 10 files/91 tests plus architecture, TypeScript and lint. Migration179 remains source-only pending exact local approval and reviewed PR/canary rollout.
- PR1278 initial Sol/Terra review found one blocker: unconstrained legacy attendance receipt JSON could have been mistaken for aggregate-only data. Batch1 adds fail-closed canonical shape/fingerprint/count/occurrence validation plus hostile extra-key, nested-reference, wrong-type and bad-fingerprint fixtures; it also documents admission quarantine visibility. Disposable replay/harnesses pass; targeted re-review and stable-head checks follow.
- Sol targeted review found a late-insert race after receipt validation. Batch2 enforces canonical aggregate receipts at the INSERT boundary and takes the classroom operation advisory lock, so a finalizer lock winner rejects the concurrent write and an insert winner can commit only non-student aggregate data. A disposable two-session proof covers the lock race and post-lock payload rejection; full replay, all three cleanup harnesses and focused checks pass.
- Extended batch3 corrects superseded Phase3 ledger and rollout packets to the current001–178 baseline and migration179-only pending state, including the updated derivative-cache and aggregate-receipt policy. Sixth Terra review pending.
- Sixth review found one remaining Phase3/Phase4 prose contradiction. The final docs correction scopes the old no-worker language to superseded Phase3 and explicitly recognizes the deployed Phase4 queue, worker, and five-minute conditional watchdog; seventh review follows.
- Seventh review cleared the stable source. Preflight then disproved the assumed local178 state: local was001–177 and the dry run named only178/179. With exact renewed approval, one local push applied178 (`ffb1c571aa287d5c858baf91af637aab714539efd5b39be1f91bb8bd1a12e9b4`) and179 (`9b89a92111e6485d7704372c8da413e1645f2cd58c0d452cb354033dbd96bfa8`). Postflight ledger001–179, required functions/receipt trigger present, all cleanup gates false, queue empty, storage compatibility, and warning-level DB lint clean. Production remains001–178; no production migration, synthetic fixture, provider request, gate change, or purge occurred. Eighth review follows the corrected rollout record.
- Eighth review cleared the local179/production178 rollout record. Ready CI run35260054853 then exposed two source-contract mismatches, not a database failure: CURRENT had dropped the established attendance-release wording, and one unit test still expected partial removals to be skipped rather than durably quarantined under179. The PR returned to draft; authorized final batch6 restores the continuity wording and aligns the assertion with the exercised quarantine fixture. The eight-launch review hard cap is exhausted, so no ninth AI review is permitted; fresh checks/CI and human stable-SHA review remain.

## 2026-09-17 — Integrated attendance optimistic updates

- Owner `codex/optimistic-integrated-attendance`. Production's integrated teacher attendance controller now projects manual present/late/absent marks immediately, preserves the projection through stale confirmation polls, and restores the derived automatic state immediately on undo. Failed requests restore the full previous record.
- Shared the automatic attendance derivation between the server view and client reset projection to prevent drift. Added controller, component, and experience-matrix regression coverage, including delayed confirmations and rollback.
- Verification: focused checks pass 16 files/221 tests plus architecture, UI/design policy, TypeScript and lint; targeted suites pass 73 tests; Playwright teacher/student desktop/mobile light/dark passes 8 cases and screenshots were inspected. No schema, API contract, dependency, or new design-pattern change.
- Initial Terra/high review found that a second student's confirmation poll could replace an earlier unresolved optimistic projection. Batch1 reapplies every unresolved mark overlay to all incoming views and adds a two-student regression; targeted re-review and refreshed focused checks follow.
- Targeted review found the same overlay was not registered until foreground polling expired, leaving in-flight marks vulnerable to concurrent timing-dialog refreshes. Batch2 registers marks before the request, removes them only on confirmation/rollback, and covers stale refresh plus two simultaneously unresolved marks during background revalidation.

## 2026-09-18 — Deterministic roster Join sorting and attendance header cleanup

- Owner `codex/roster-join-sort`. Roster sorting by Joined now uses ascending last name, first name, and roster ID tie-breakers inside each joined/unjoined group; toggling direction changes only the group priority.
- Removed the Daily attendance count-bubble chevron while preserving button names, `aria-pressed`, tooltips, and the active focus ring. Updated the production control, Pattern Lab mockup, and component/UI regression coverage.
- Verification: focused checks pass 20 files/285 tests plus architecture, UI/design policy, TypeScript, and lint; targeted suites pass 116 tests. Playwright teacher desktop/mobile, student guardrail, light/dark, loaded roster Join-sort, and Daily attendance captures were inspected. Composite checklist reviewed: yes; keyboard behavior unchanged and covered; semantic state covered by tests; remaining manual follow-up: none.

## 2026-09-18 — Hourly removed-student cleanup watchdog

- Owner `codex/hourly-student-purge-watchdog`. User requested reducing the conditional Supabase recovery watchdog from every five minutes to hourly; the immediate removal-triggered callback remains unchanged.
- Migration180 uses `cron.alter_job` on the exact named watchdog and a source regression rejects direct `cron.job` updates, unscheduling, or command replacement. Worker comments and rollout guidance now describe hourly recovery while preserving immediate callbacks and 240-second retry readiness. Targeted18 tests and focused checks (14 files/115 tests plus architecture, TypeScript, and lint) pass. No migration has been applied; production remains001–178 and requires exact approval for pending179 plus180 before rollout.

## 2026-09-18 — Classroom creation entitlement cutover foundation

- Owner `codex/access-entitlement-cutover`, based on `origin/main@c0b3d898`. Migration181 installs dormant Free provisioning, leaves existing and pre-activation accounts compatible, and exposes service-only readiness/one-way activation that refuses incomplete account coverage. Activation atomically starts strict enforcement and audited default-Free provisioning for future accounts.
- The signup trigger, classroom assertion and activation share a transaction-held settings-row lock, closing signup/activation and legacy-creation/activation races. Existing direct, ordinary retry, Blueprint, restore and transfer enforcement continues through the migration166/167 database assertion; Access remains one active classroom and existing over-limit classrooms are preserved.
- Disposable migration replay, warning-level database lint, generated-type comparison, rollback-only entitlement harness and activation-before-signup concurrency proof pass. Focused checks pass 95 tests plus architecture, TypeScript and lint. Migration181 has not been applied to shared local or production; no account was classified, granted Access or cut over. The runbook requires separate exact authorization for schema application and later production classification/activation.
- Initial Sol/Terra review found that immediate post-migration Free provisioning violated the dormant Release-A boundary and that the new assertion reversed the established creation lock order. Remediation gates provisioning on successful strict activation, restores subject-before-settings locking, proves both signup/activation lock winners, adds ownership-transfer/reactivation quota coverage, and skips the destructive activation race on persistent local databases with unrelated accounts. Exact-head re-review follows.

## 2026-09-19 — Calibrated assignment grading rules and screenshot fix

- Branch `claude/beautiful-mayer-4jk2lf`. Calibrated AI assignment grading against real submissions from two courses (PPZ3C A1, GLD2O A1/A4/A6) with the teacher, one submission at a time. The approved rule set and the de-identified snapshots stay private and gitignored (`*.grading-snapshot.json`, `*.grader-calibration.json`).
- Fixed two production bugs found during calibration. Since #1158 privatized submission storage, uploaded images carry an app-relative src, so URL-based artifact extraction dropped every screenshot: grading had been blind to them. Images now appear as `[Image attached]` where the student placed them, so captions can be matched, and attachments are credited as completion evidence. Separately, an email or phone number written with no separating space bypassed redaction; both patterns now end on a non-letter/non-digit boundary. Six GLD2O resumes were affected.
- Grade composition changed. The grader now scores Completion, Thinking and Presentation (0–4) by explicit deductions, and `assignment-workflow-process.ts` derives the rest of Workflow from save history (lateness scale, sittings, authenticity). Feedback lists every missed requirement even at full marks, with reminders for pasted or unsubmitted work; work under ten words with no attachments scores 0/0/0 with no provider call. Prompt/profile/policy/rubric versions bumped; output budget raised to 2400/4800 because reasoning tokens truncated the longer feedback.
- Removed the per-assignment score anchor feature (profiles, generation, flag, eval script, plan doc): the general deduction rules replaced it.
- Verification: 7,085 tests including 13 new process-scoring cases, plus typecheck, lint, architecture. Re-graded five calibration submissions through the shipped path; scores matched the calibrated results within a point.

## 2026-09-19 — Supabase classroom RPC receiver fix

- Owner `codex/fix-classroom-rpc-binding`. Bound `SupabaseClient.rpc` to its client before invoking the atomic classroom-creation RPC; the prior detached call failed before PostgREST could return the expected entitlement denial. Added a receiver-sensitive regression test. Local Access-at-limit behavior now returns the safe “Archive an active classroom before creating another.” response; focused checks pass 30 files/263 tests plus architecture, TypeScript and lint. No policy, schema, UI, migration, or production change.

## 2026-09-19 — Dormant contextual classroom home backend

- Owner `codex/contextual-classroom-access`. Added an authenticated, exact-user-cohort `GET /api/classrooms/home` contract that returns separate active `owned` and `joined` summaries without consulting global role. Service-role reads are subject-bound; returned evidence is validated and sanitized, ownership wins over historical self-enrollment, and either-source failure returns no partial home. The current `/classrooms` page has no consumer and the gate defaults off. Targeted 53 tests and TypeScript pass; an aggregate-only real local Supabase canary returned one owned, zero joined, with owner precedence true. Initial security review required exact enrollment `classroom_id` binding and rejection of null source payloads; remediation adds both with regressions and the real canary remains green. No UI, migration, signup, production configuration or rollout change.

## 2026-09-19 — Dormant contextual classroom page routing

- Owner `codex/contextual-classroom-page-routing`. Added an independent, off-by-default exact user/classroom pair gate for classroom SSR routing. Admitted ownership selects the existing teacher experience and active membership selects the existing student experience while the real session role remains unchanged for session validation; contextual owner switching is limited to the current admitted classroom. Invalid enabled configuration and malformed relationship evidence fail closed, unmatched pairs retain the legacy branch, and the API pilot gate is not reused.
- Targeted relationship/page/client coverage passes 70 tests plus TypeScript and lint. The existing local owner/member fixture passed the teacher/student desktop/mobile light/dark browser matrix; inspected light and dark captures showed the current shell without overflow. No database mutation, migration, new visual pattern, home consumer, downstream-domain widening or production activation.

## 2026-09-19 — Dormant contextual announcement reads

- Owner `codex/contextual-classroom-api-navigation`. Added an independent, off-by-default exact user/classroom pair gate to the owner and member announcement list endpoints. A student-valued owner receives the owner projection; a teacher-valued active member receives only published member-visible announcements. Contextual arrays and every announcement/classroom binding fail closed on malformed or substituted evidence.
- Teacher announcement mutations and member read receipts remain on their legacy guards because their writes still need transaction-time owner/archive or enrollment binding. No page/home consumer, UI, migration, production configuration or cohort activation changed. Targeted 50 tests and the focused gate (14 files/141 tests plus architecture, UI/design policy, TypeScript and lint) pass.
- Initial compatibility review found that both GET handlers resolved route parameters before authentication and an enabled-gate wrong-role malformed identifier returned 400 instead of the legacy role-first 403. Batch1 defers parameter resolution until after authentication, preserves the 403 before any relationship/data query, and adds route-level regressions for both owner and member endpoints. The refreshed focused gate passes 145 tests plus architecture, UI/design policy, TypeScript and lint; targeted and final integration re-review follow.

## 2026-09-19 — Dormant contextual lesson-plan reads

- Owner `codex/contextual-classroom-next-domain`. Added an independent, off-by-default exact user/classroom pair gate to the owner and member lesson-plan list endpoints. A student-valued owner receives the owner calendar projection; a teacher-valued active member keeps the classroom visibility window. Contextual plan arrays, every plan/classroom binding and the member visibility record fail closed on malformed or substituted service-role evidence.
- Lesson-plan date, bulk and copy writes remain on their legacy guards pending transaction-time owner/archive binding. No page/home consumer, UI, migration, production configuration or cohort activation changed. Targeted route/access coverage passes 48 tests; focused checks and independent review follow.
- Initial Sol security review found that PostgreSQL-compatible non-ISO date aliases could evade the member visibility ceiling's lexical clamp. Batch1 strictly validates real canonical `YYYY-MM-DD` bounds only for contextual members, rejects aliases before lesson-plan data reads and adds bypass plus canonical-clamp regressions; legacy request behavior remains unchanged. Targeted and focused verification plus targeted re-review follow.

## 2026-09-19 — Dormant contextual material reads

- Owner `codex/contextual-classroom-material-reads`. Added an independent, off-by-default exact user/classroom pair gate to the owner and member material list endpoints. A student-valued owner receives the owner projection including drafts; a teacher-valued active member retains published-only filtering. Contextual arrays and every material/classroom binding fail closed on malformed or substituted service-role evidence, including after the existing missing-position fallback.
- Material create/edit/delete operations remain on their legacy guards pending transaction-time owner/archive and resource binding. The missing-table empty-list compatibility response is preserved. No page/home consumer, UI, migration, production configuration or cohort activation changed. Initial targeted access/route/legacy coverage passes 42 tests; focused checks and independent review follow.
- Initial security and compatibility reviews found that same-class draft evidence could pass the generic contextual row validator despite the member query predicate. Batch1 adds member-specific `is_draft: false` validation after both primary and missing-position fallback reads, with same-class draft regressions while preserving owner draft visibility. Refreshed verification and targeted re-review follow.

## 2026-09-19 — Dormant contextual assignment reads

- Owner `codex/contextual-classroom-assignment-reads`, based on merged material-read PR1290. Added an independent, off-by-default exact user/classroom pair gate to the owner and member assignment list endpoints. A student-valued owner retains drafts, roster-scoped statistics and submission requirements; a teacher-valued active member retains live-only assignments and their own sanitized assignment document.
- Contextual assignment, roster, statistics-document, requirement and member-document evidence is validated against the authenticated subject and authorized classroom/resources. Assignment item routes, mutations, submissions, artifacts and grading remain legacy. No UI, migration, production configuration or cohort activation changed. Initial targeted route/access/legacy coverage passes 54 tests plus TypeScript; focused checks and independent review follow.
- Initial security/compatibility review found two fail-closed gaps: member release/return policy fields were not shape-validated before visibility/sanitization, and shared stats/requirement loaders normalized unexpected null evidence to empty arrays. Batch1 requires valid release, return and feedback-return timestamps; adds strict opt-in raw-array handling while preserving legacy normalization and the intentional missing-schema fallback; and covers null/malformed evidence. Refreshed verification and targeted re-review follow.

## 2026-09-19 — Dormant contextual assignment aggregate detail

- Owner `codex/contextual-assignment-detail-reads`, based on merged assignment-list PR1291. Added an independent, off-by-default exact user/assignment gate to `GET /api/teacher/assignments/[id]`. A student-valued classroom owner retains the existing aggregate assignment, roster and submission summary, including archived-classroom reads.
- Contextual mode binds the admitted assignment to its classroom and validates roster/users, optional profiles, assignment documents, requirements, artifacts, history and active grading-run evidence before returning anything. Strict loader mode rejects unexpected null evidence while legacy behavior is unchanged.
- The learner assignment-document GET remains legacy because it can create a document, refresh viewed state and emit Pal events; individual student-work reads and every assignment mutation remain out of scope. No UI, migration, schema, production configuration or cohort activation changed. Initial targeted access/route/legacy coverage passes 40 tests plus TypeScript; focused verification and independent review follow.
- Initial compatibility review found the independent gate absent from `.env.example`. Batch1 adds explicit disabled/empty defaults and scoped operational comments; exact-head verification and re-review follow.
- The same review found active grading-run schema/null evidence still normalized to “no run.” Batch2 adds strict contextual active-run and run-item evidence loading through the already-authorized service client while preserving legacy missing-schema fallbacks, with null and missing-schema regressions.
- Final compatibility review found uppercase admitted UUIDs could mismatch lowercase grading evidence. Batch3 canonicalizes the contextual assignment ID once for every downstream detail query and adds an uppercase active-run regression; the legacy identifier path remains unchanged.

## 2026-09-19 — Dormant contextual individual assignment work read

- Owner `codex/contextual-assignment-student-work-read`, based on merged aggregate-detail PR1292. Extended the same off-by-default exact user/assignment gate to `GET /api/teacher/assignments/[id]/students/[studentId]`. A student-valued classroom owner may read one enrolled student's existing work, including an archived classroom, without changing the account's legacy role.
- Contextual mode canonicalizes the student identifier after assignment-pair admission, proves the exact classroom enrollment, and validates profile, document, feedback, requirement, artifact, repository-target and completed repository-review bindings. Optional single-row evidence uses bounded arrays so unavailable or duplicate service-role results cannot be normalized to absence; the already-authorized client is reused by supporting loaders. The learner document route and every assignment mutation remain legacy.
- No UI, migration, schema, dependency, production configuration or cohort activation changed. Initial targeted contextual/legacy/helper coverage passes 48 tests plus TypeScript; focused verification and independent review follow.
- Initial security and compatibility review found that the repository-review result was bound to the requested assignment/student but its joined run was validated only by completed status. Batch1 selects the nested run ID and assignment, proves `result.run_id` and assignment match that run, and adds helper plus route regressions for substituted cross-assignment run evidence; refreshed checks and exact-head re-review follow.

## 2026-09-19 — Dormant transactional learner assignment open

- Owner `codex/contextual-assignment-doc-open`, based on merged individual-work PR1293. Migration182 adds a service-only transaction that rechecks live assignment/classroom state and exact enrollment under the membership-removal fences before creating or refreshing one learner assignment document. It preserves first-view/returned-feedback acknowledgment and constrains the optional legacy Pal event to the assignment-view contract.
- No route, feature flag, UI, production database or cohort activation uses the function in this slice. The strict server adapter validates actor/assignment/document evidence; rollback-only behavior and multi-connection harnesses cover removal-first, archive-first, draft-first, open-first and duplicate-open ordering.
- With exact local authorization, migration182 SHA256 `181d8124527349599b8d772eeb213ac0e3d12eb48f557ebe4838ab9c17cd3a74` applied after one corrected retry authorization. Local history001–182, behavior/concurrency contracts, generated types, warning-level database lint, 117 focused tests, architecture, UI/design policy, TypeScript, lint and Pika audit pass. Independent high-risk review follows.
- Initial compatibility review was clean. Initial security review found membership-scoped Pal routing still depended on the account's legacy student role, so a teacher-valued exact member could create the document without emitting its first-view fact. Batch1 adds migration183 to make Pal identity relationship-based while preserving all removal/archive/purge/generation fences, with teacher- and student-valued exact-member plus retry-dedup coverage. With exact authorization, migration183 SHA256 `d2153b9e3cbf94c991abbaf177ba6d16e5fa9d2147ad4c1a03d0b57c861664ea` applied locally; local history001–183 and the assignment-open, membership identity and classroom Pal contracts pass.

## 2026-09-19 — Dormant contextual learner assignment-open route

- Owner `codex/contextual-assignment-route`, based on merged transactional-open PR1294. Added an independent, off-by-default exact user/assignment gate to `GET /api/assignment-docs/[id]`. A matched teacher- or student-valued active member opens only their own document through migration182; the transaction remains the membership/visibility authority and a foreign `student_id` teacher projection is rejected.
- Contextual mode binds RPC assignment/document evidence plus feedback, requirements, artifacts and optional GitHub identity before returning, sanitizes the member document and preserves immediate Pal delivery after a transaction-created document. Disabled and unmatched requests retain the legacy route. Autosave, submission and artifact mutations remain legacy, so no cohort may be activated yet. No UI, migration, production configuration or database state changed in this slice.
- Initial security review found strict requirement/artifact loaders still normalized missing-schema errors to empty evidence, and downstream evidence failure could skip immediate Pal delivery after the transaction committed creation. Batch1 makes missing schema fail closed only in strict mode while preserving legacy compatibility, and moves immediate delivery directly after the successful create result with global- and classroom-Pal failure-path regressions. Targeted re-review follows.

## 2026-09-19 — Dormant contextual learner assignment save

- Owner `codex/contextual-assignment-save`, based on merged assignment-open route PR1295. Migration184 adds a service-only transaction that rechecks live assignment/classroom state and exact enrollment under membership-removal fences before delegating revision, idempotency, history and metric behavior to the established atomic save.
- Added an independent off-by-default exact user/assignment PATCH gate. A matched teacher- or student-valued active member saves only their own document; bounded preflight and RPC evidence are strictly rebound to the authenticated actor and assignment. Disabled and unmatched requests retain the legacy student-only route, and missing schema never falls back after admission.
- With exact local authorization, migration184 SHA256 `5a761230159d7ad1b795426eac2b290d58e75da508124bb389e4a90a080edc5d` applied locally. Rollback-only behavior and multi-connection removal/archive/draft/save/duplicate-save contracts pass, generated types match local history001–184, and the GET/PATCH gates remain off. Submission, unsubmit, history/restore and artifact mutations remain legacy, so no cohort may be activated.
- Initial security review found that migration184 could hold classroom/member fences while an existing submit, unsubmit, restore or legacy save held its document fence, making ordinary overlap deadlock or surface raw contention. Batch1 adds migration185's fixed submission→editor-save→classroom/member ordering, maps guarded assignment/classroom contention to safe 409 retry responses, and expands real two-connection coverage to both save/submit and contextual/legacy-save orderings, unsubmit-first, and save-first draft/archive retries. With exact local authorization, migration185 SHA256 `833b009433c95d288bccb241b6a360234186b6b5ae143be717950e67a3febd88` applied locally; all 12 race cases pass and randomized fixtures are removed.

## 2026-09-20 — Dormant contextual learner assignment submit/unsubmit

- Owner `codex/contextual-assignment-submit`, based on merged assignment-save PR1297. Migration186 adds service-only submit and unsubmit transactions that recheck live assignment/classroom state and exact enrollment under the established submission→editor→classroom/member lock order before delegating to the legacy atomic operations.
- Added one independent off-by-default exact user/assignment gate shared by the submit and unsubmit routes. Matched teacher- or student-valued active members mutate only their own document; strict adapter and preflight evidence binding fail closed without legacy fallback. Disabled and unmatched requests retain the legacy student-only path.
- With exact local-only authorization, migration186 SHA256 `a06d0915a0df1930ef35e3acf459e271f93d6a7d579d52b23afe48cb5047959f` applied after local history001–185. Warning-level schema lint, generated-type parity, rollback-only behavior checks and all 18 removal/save/submit/unsubmit concurrency contracts pass; randomized fixtures are removed. Production remains001–180 and every contextual assignment gate remains off. History/restore and artifact mutations still block cohort activation.
- PR1298 initial Sol/Terra review found attachment-race errors collapsed to503, service-role preflight evidence returned before membership authorization, and a post-transaction authenticity write outside the member boundary. Remediation batch1 preserves both attachment outcomes, moves all contextual preflight evidence into migration187's service-only locked transaction, and removes the contextual authenticity write. Under the user's standing local-migration authorization, migration187 SHA256 `5f84d7f11c37807b525dda31e8015906accdcc1a93490322d023c4aa7c3d636d` applied locally; local history001–187, removed-member denial, type parity, lint, both rollback harnesses and all18 concurrency cases pass. Targeted re-review follows; production/gates remain unchanged.
