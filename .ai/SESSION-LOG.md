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

## 2026-09-12 — Abbreviate calendar day modal dates

- Updated the shared week-header day modal to show `Fri Sep 11, 2026`; adjusted its two existing dialog-name assertions.
- Verified: focused checks passed (254 tests, TypeScript, lint, architecture, UI/design policy); audit clean. Playwright screenshots reviewed for teacher/student, 1440×900 and 390×844, light/dark; next-day, ArrowLeft, and Escape checks passed in all eight combinations. Evidence: `output/playwright/calendar-*.png` in the task worktree.
- Owner: calendar modal date task; branch `codex/calendar-modal-date-format`. Risk profile: none. Reused LessonCalendar date formatting and DialogPanel; Pattern Lab controls/dialog reference inspected. No new pattern or composite behavior.
- Follow-up: gave the date/navigation row a full-width muted header band and divider using existing semantic tokens. Rechecked all eight screenshots, day navigation/Escape, and 254 focused tests. The pre-commit audit's whole-file composite heuristic requests a newly changed test for this class-only follow-up; existing dialog tests and the keyboard browser matrix passed, with no semantics or handlers changed. Targeted independent review will cover the refinement in the same PR.

## 2026-09-12 — Begin Free / Access classroom-creation enforcement

- Approved policy: Free is join/participate-only; Access permits one active owned classroom and unlimited joining. Initial Access is manually granted. Trial remains a separate, time-limited future overlay with at most one trial period per account; Plus/Pro and billing are deferred.
- Authored additive migration166 with service-only effective snapshots, immutable idempotent audit, exact validity windows and a transaction-serialized active-classroom limit. Missing snapshots preserve current teacher-role behavior and no cohort is seeded. The database trigger covers direct inserts, reactivation and ownership transfer; the Blueprint entry point is wrapped before its internal error boundary.
- Ordinary and Blueprint creation paths map exact database denials to safe 403/409/503 responses. Added source, API/helper and Blueprint tests plus a rollback-only database/concurrency harness wired into CI. Owner authorized and consumed one local application of migration166 checksum `c66842db8c504d50a438c8e6f3c841e759cac87923fa3531300b6a84ceeede6c`; preview contained only166 and application succeeded. Transactional and two-writer race contracts pass, database lint is warning-free, and regenerated public types match. Production remains164 and no entitlement row/cohort was created.

## 2026-09-12 — Make ordinary classroom creation retry-safe

- Initial Sol/Terra review of draft PR #1252 found that a lost ordinary-create response could duplicate an unmanaged classroom or consume Access capacity before the retry, and that reactivation denials collapsed to a generic 500. Remediation batch1 adds forward migration167 with a service-only operation ledger and atomic replay RPC, gives the existing blank-class modal a stable per-request idempotency key, and maps exact entitlement errors on restore. No visible modal contract changed.
- Owner authorized and consumed one shared-local application of migration167 checksum `f14c853330729d6e48a8e6d6cf18c9a7fbf34f32bb11067a5edf175062a29759`; dry run contained only167. Sequential replay, changed-request conflict, missing-result fail-closed behavior, same-key concurrency, Access quota concurrency, privileges, database lint and generated types all pass. Production remains164 and no entitlement cohort was seeded.
- Focused gate passes1144 tests/105files plus static checks. The Create Classroom browser scenario passes; teacher modal desktop/mobile light/dark and mobile error-state captures were inspected with no visible drift. A real browser retry probe sent the same UUID key twice. Student is n/a because creation remains teacher-gated. Targeted and final independent review remain before exact-head CI; no merge/deployment authorization.
- Targeted Sol review found one lost-success-body edge: the modal discarded its operation key before validating the returned classroom identity. Remediation batch2 now retains that key until a usable classroom ID is confirmed, so a retry replays the committed operation instead of attempting a duplicate. The focused component regression passes23/23; cumulative checks and review follow. No migration, entitlement, UI layout or rollout change.
- Targeted Sol and final Terra reviews then cleared stable `1da0bc20`. Ready-head CI run34706856667 passed full test/build but its schema inventory correctly rejected `classroom_creation_operations` as unclassified; returning the PR to draft cancelled the still-running browser lane. Owner approved a bounded extension for remediation batch3 and reviewer launches6–7. The ledger is now explicitly account-owned, non-portable workflow metadata for both its classroom result pointer and subject-account reference; the exact live-schema audit passes241 foreign-key relationships and the inventory suite passes16tests. No migration or runtime behavior changed.
- Targeted Terra and final Sol reviews cleared corrected `6dbc0741`; exact-head CI run34707881236 then passed classification, full test/build, database architecture including the corrected schema inventory, browser matrix, and PR Gate. Main advanced during that run through calendar-only #1255, leaving conflicts only in the continuity logs. Owner authorized one final sync, reviewer launch8, exact-head CI, and merge to main if green. Rebased onto `5cc127ec`, preserving both log histories; range comparison shows no product/migration change beyond the already reviewed PR. Production remains164 and no rollout state changed.

## 2026-09-12 — Use the existing local Pika database for Pal

User corrected the target to the existing local database. Integrated reviewed prerequisite#1252 at7923cfaf into this branch, preserving both history logs. Shared local already had001–167; verified project pika, exact pending-only168 preview, unchanged reviewed checksum and no ambiguous backfill generations, then applied168 once with db push --local. History001–168, source/ledger backfill counts and both disabled rollout gates verified. Rollback-only membership lifecycle/lock tests, canonical generated types/check, warning-free DB lint and241-relationship schema audit pass. Combined focused gate passes1676tests/145files plus static checks. Stopped only task-created disposable containers and retained volumes. Notified the prerequisite owner of shared local168; #1252 final CI/authorized main merge still running, so #1253 remains draft pending final integration review/CI. No production application, provider calls or real-data erasure.

## 2026-09-12 — Sync Pal with merged classroom prerequisites

Prerequisite#1252 merged to main as0aeba623 after all exact-head CI gates passed. Synced main into the Pal branch, resolving only continuity conflicts and retaining verified shared local001–168 status. Product and migration trees remain unchanged from the locally verified7eb26f75 integration. Final focused checks and the approved sixth review (Sol/high,20minute cap) precede stable-head Pal CI; production remains untouched.

## 2026-09-12 — Implement disabled classroom Pal signals and presentation

- Owner task01a0978b-297c-70c1-9199-76a9f104cac0, branch codex/pal-classroom-signals, base3a225b0f. Authored migration169 with disabled database gate, immutable activation boundary, private generation-bound outbox/week state, all six existing v1 event families, legacy quiescence, scoped claims and bounded weekly planning. Historical/earlier-generation source rows are excluded; academic and outbox writes remain atomic.
- Added authenticated classroom token/visit paths with before/after authorization, generation/provider-config token cache boundaries, two-second immediate delivery and leased background retries. Reused the existing widget with complete generation remount, scoped refresh and stale reward protections. All application/database rollout gates remain disabled; no provider provisioning, production action, migration application, reset or real-data erasure occurred.
- Browser matrix passed14 tests including setup: four synthetic A/B switching, reload, logout and stale-response contracts plus eight ordinary teacher/student desktop/mobile light/dark regressions. Inspected all12 settled screenshots in output/playwright/pal-phase2. Unit/API and source checks cover actor isolation, no fallback, outages, leases and cache boundaries. SQL rollback/concurrency fixtures are authored but not executed.
- Exact local migration preview contains only169; existing local history matches001–168. Canonical type check correctly stops at missing169. One-time exact local169 approval is required before SQL execution, generated public types, draft PR publication, independent review and exact-head CI. Goal remains active; full Phase2/provider exit gates are not claimed. Updated the existing approved roadmap and Phase1 completion evidence; see docs/guidance/pal-classroom-signals.md.

## 2026-09-12 — Apply approved local classroom Pal schema

Coordinator relayed explicit one-time approval for169 on the existing local Pika database. Verified checkpoint6c8ab914, approved SHA256 e98c01b2df3986aabf7f0539605f97ee742503a13020ec5b37331a3db55b63bd, container/project pika, matching001–168 and pending-only169 dry run. One db push --local succeeded; ledger001–169 matches, both private gates false and activation null. Rollback-only six-family/isolation/week/lease/removal/academic rollback and concurrent-planner contracts pass. Canonical public types generated and checked; replaced temporary RPC adapter with direct typed calls. Source focused gate passes1854tests/203files and static checks. DB lint reports two warnings (calendar volatility, unread visit variable), to correct forward after initial independent review. Production remains168; no provider calls, activation, reset or erasure. Sanitized receipt: ~/.codex/metrics/pika-local-pal-migrations.jsonl. Draft PR/review/CI next; no Pika merge authority.

## 2026-09-12 — Correct reviewed classroom Pal producer boundaries

DraftPR1256 at95c87afb received independent Sol/high and Terra/high review. Both found the enabled contextual join would demand suppressed legacy evidence and roll back; Terra also found partial classroom flags still constructed legacy daily/assignment/join events. One remediation batch suppresses legacy payloads on every touched source whenever classroom routing is requested while preserving atomic academic RPCs and scoped immediate delivery. Added actual contextual-join/daily/view/submit database contracts, including no legacy events under partial gates and no residual roster/enrollment/outbox on failed join. Those rollback-only contracts pass on local169; app flag-matrix and null-payload/no-HTTP tests pass. Authored forward170 for calendar volatility and unused visit variable; hash70ffa9a3ed187fa95e66f59d87946437b58711b09cac66068045e7259f7decb8, exact local approval pending.169 remains unchanged. Two reviewer launches/one batch consumed; targeted/final review and exact-head CI pending. UI unchanged, visual evidence reused. No provider/production/activation/erasure or merge action.

## 2026-09-13 — Restore student action-bar header clearance

- Task branch `codex/student-actionbar-spacing`: student-density `PageActionBar` now owns the existing 12px comfortable top inset, fixing Calendar and Classwork Instructions/Submit header collisions. Teacher/default spacing remains caller-owned. Updated the canonical API note and role-aware Pattern Lab example; reused existing controls and spacing tokens. Risk profile: none; no new visual pattern or interaction semantics.
- Local Playwright matrix covers student/teacher Calendar, selected assignment, and Pattern Lab at 1440×900/390×844 in light/dark; student Calendar Week/Month/All and assignment focus/open-instructions states also captured. Evidence: ignored `output/playwright/`, capture script `/tmp/pika-actionbar-verify.cjs`, local port3137. No page overflow; student action bars have 12px padding and controls retain 44px targets.
- Focused check passed 1,665 tests in168 files plus architecture, UI/design policy, TypeScript and lint. The optional audit flags unchanged composite semantics by scanning whole touched files; this spacing-only diff changes no ARIA or keyboard behavior and has direct browser focus/dialog verification. Draft-first independent review and final CI follow; no merge or production authorization.

## 2026-09-13 — Phase3 provider prerequisite checkpoint

Fresh owner task01a09b31 starts at merged Phase2f67852cf. Authored disabled exact
Pal/Bara adapters, provider_pending prerequisite and permanent generation guards
in unapplied171; initial source review requested before local application approval.
85 unit tests pass; local ledger001–170 and pending-only171 dry run verified.
No provider/network erase, SQL application, rollout, merge or deployment performed.
See docs/guidance/student-provider-cleanup-integration.md for pending verification.

## 2026-09-13 — Phase3 initial review correction batch

Independent Sol/high and Terra/high reviewed frozen8aab0054 before local171 application approval. Corrected three accepted blockers: provisional whole-class copy/intent policy and producer serialization, exact-reference attendance removal closure, and provider-pending ordinary-cron health. Added transaction-only SQL cases (unexecuted), plus43 passing cron/purge tests and passing TypeScript. Full initial source gate passed520 tests. No SQL/provider traffic/config/rollout or PR publication occurred. Further typed RPC integration, browser revocation, actual SQL and race verification remain incomplete.

## 2026-09-13 — Phase3 browser revocation and independent provider steps

Finished membership browser reauthorization/cache-memory clearing on revoked access, preserving academic children and dismissing pending rewards/late replies. Synthetic Playwright8cases desktop/mobile/light/dark passed and screenshots inspected;45focused unit tests and full source605tests/types/policies/lint passed, Pikaauditpassed. Provider advancement now explicitly selects one provider per bounded step so Pal pending does not starve Bara. SQL171 remains unchanged at reviewedhash598ee035 and unapplied; exactlocalpacket sent coordinator. Typed RPC bridge, attendance consumers, actual SQL/concurrency verification and final review/PR remain pending. No rollout/provider calls.

## 2026-09-13 — Phase3 runtime integration pending generated contract

Authored direct typed provider reservation/read/authorization/receipt RPC bridge and attendance generation consumers. Scans recheck before retry and response; exact participant joins enabled payload/idempotency scope; delivery and stored replay authorize exact payload/lease. Pre171 missing-RPC fallback is restricted to disabled rollout, with real permission/malformed failures closed. Attendance/provider regression:191 tests in28files pass; architecture, lint and all11changedTypeScriptfile audit pass. TypeScript has exactly six missing new RPC names until authorized171 application and canonical generation; no generated contract edits or generic RPC workaround. Changes remain uncommitted pending that validation. Migration hash598ee035 remains unchanged; no SQL/provider requests. Review45minute cap expired15:44UTC after3launches/1batch; final independent review requires explicit extension. Full SQL and cross-connection race evidence remain unexecuted.

## 2026-09-13 — Approved local171 application and runtime verification

Direct user approval authorized exactlocal171/hash598ee035 and bounded review extension. Single application succeeded; ledger001–171 and membership/signals/cleanup gates remainoff. Canonical types generated and drift check pass; nullable replay input refined in application contract. Fixed two SQL fixture assumptions, then rollback suite passed with no retained c171rows. Two-connection harness verifies five real RPC/producer lock conflicts and rollback/release; no committed-row MVCC rehearsal or fixture seed is claimed. Full focused checks passed622tests/types/policies/lint; prior8browsercases and visuals remain applicable. Review extension up30minutes/MAX2extra launches begins at final review, prior3launches/1batch retained. No hosted rollout/provider requests/merge; stable draft PR and cumulative review follow.

## 2026-09-13 — Phase3 final review correction batch

DraftPR1258 atf168c2c3 received final Sol/high cumulative review. Accepted Pal retry classification finding and independently detected warning-level SQL lint failure. Batched retryable generic404/malformed/unexpected-success outcomes with same-binding/no-proof regressions;42focused tests pass. Added forward172 replacing only receipt authorization's unused assignment withPERFORM, preserving171/hash598ee035 and all behavior/signatures/grants. New172hash4aac47ce is unapplied; requires separate exactlocalapproval and postapplication lint/type/DB validation. Final targeted review pending within16:31UTC cap/MAX5launches. No provider traffic, committed fixtures, rollout or merge.

## 2026-09-13 — Disabled removed-membership academic stage source checkpoint

- Owner01a09bf4 on codex/removed-membership-academic-cleanup, base29cde0b0. Clarified academic ownership is student+classroom; retained generation authenticates operation. No prospective provenance capture or backfill.
- Authored forward173, existing-ledger local progress/claims, strict provider/no-copy fences, narrow retained marks redaction and rollback-only harness. Existing171/172 hashes preserved. No schema or provider action.
-14 orchestration tests,10 source contracts and focused checks passed; TypeScript passed. Canonical types check correctly stops at unapplied173. DB/storage/MVCC proofs remain unexecuted; source review and exact local approval next. Refreshed existing roadmap/integration status.

## 2026-09-13 — Batch academic cleanup source-review corrections

- PR1259 initial Sol/high and Terra/high reviews found exact attendance overblocking and incomplete rollback coverage. One batch permits only staged exact attendance deletes, orders override events before parents, and tightens file ownership to exact assignment docs. All overall provider/re-add fences remain.
- Expanded the unexecuted rollback harness to22 success resource categories, all29 allowlisted tables across success/blocked fixtures, two files, eight blocked cases, row-hash isolation and callback/backoff/lease scenarios. Source tests pass; SQL173 remains unapplied and database/types proof remains gated on direct local173 approval. Targeted source review follows; no migration or provider activation occurred.

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
