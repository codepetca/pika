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

## 2026-09-26 — Stripe test-mode foundation prepared

- Owner `codex/stripe-billing-foundation`, based on the unmerged admin/policy branch at `85138d24`; risk `runtime-platform`. Astra architecture review and two bounded Terra workers prepared immutable offering versions, trusted bindings, durable event intake, fenced payment synchronization and bounded reconciliation. Coordinator integrated local-only gates, provider decoding, transport adapters and handler boundaries.
- Migration 209 and rollback-only contracts are prepared but unapplied. Local dry run includes only 209. Test fixtures establish neither real Stripe connectivity nor deployed billing. No live or hosted changes; no HTTP route/runtime activation yet.
- Local unit/static checks pass; exact verification and remaining gates live in `docs/guidance/stripe-billing-foundation.md`. Awaiting explicit approval for `stripe@22.6.2` and one-time application of migration 209 to local. Next: SDK/runtime wiring, authorized local DB application, generated types and database proof, draft PR and independent fixed-SHA review.

## 2026-09-26 — Approved local Stripe integration verification

- Owner approved exact `stripe@22.6.2` and one-time local migration 209. Both completed; migration approval consumed. Generated database types match; Stripe and existing account-plan rollback harnesses pass, including forced partial failure rollback and lease takeover. Billing sandbox setting remains false. The older classroom harness correctly refuses the post-cutover local setting; CI runs it against fresh replay.
- Added real SDK signature verification and local-only webhook/operator-worker routes, with pinned API version, bounded requests and shared database origin/redirect checks. New database harnesses are wired into CI. Credentials are absent, so no real Stripe payment rehearsal or live activation is claimed.
- Proceeding with focused checks, draft publication and bounded independent fixed-SHA security/compatibility review. No merge or production authority implied.

## 2026-09-26 — Stripe billing review remediation prepared

- Draft PR #1366 is stacked on #1360. Initial fixed-SHA Sol/Terra review found financial-adjustment and retry-fairness blockers; architecture review found no separate blocker. Batched fixes verify immutable product/amount and exact unadjusted card payment, preserve signed event timestamps, and add migration210 for fair due selection, bounded transient retries, durable attention and audited operator requeue. Existing209 is unchanged and its local application permission is consumed.
- Focused checks pass342 tests plus TypeScript, lint and architecture/UI/design policies; Pika audit passes. Migration210 remains unapplied pending exact local authorization, including clearing unrecoverable legacy provider-created timestamps. Its rollback database contracts and regenerated types remain pending; no real Stripe round trip, live enablement or merge is claimed. Targeted correction review follows before the application checkpoint.

- Targeted Sol review found a missing nullable-schedule alteration, non-isolated retry fixtures, and early-event adoption compatibility. Batch2 fixes all three in unapplied210 and its harness, adding explicit claimed-state assertions and an early-event binding regression. No further schema application is authorized yet.

## 2026-09-26 — Consolidated billing209 and rebuilt local database

- User explicitly approved combining unreleased209/210, erasing/resetting local and reseeding. Consolidated the reviewed final functions and table definitions into209; removed210 and its upgrade-only backfill. Verified local target/history; one `supabase db reset --local --no-seed` replayed001–209 successfully. Reseeded via local runtime credentials with shared hosted env excluded. Local fixtures: three users and one classroom; billing sandbox off and no billing inbox records. Reset restores migration defaults, including local creation/Free-provisioning gates; production is unchanged.
- Generated types match the rebuilt schema. Billing recovery/payment, account-plan and classroom-creation rollback harnesses pass. Corrected SQL harness evaluation ordering by capturing the mutation result before inspecting persisted state. Focused checks pass342 tests plus TypeScript/lint/policy checks; final integration review and CI remain pending. Earlier209/reset authorization is consumed. No live Stripe payment rehearsal, production change or merge.

## 2026-09-26 — Billing binding/webhook race correction

- Owner approved one extra correction batch and targeted review after the review-budget checkpoint. Added the same transaction advisory lock before subscription identity lookup in bind and record RPCs, and locked an existing binding before adopting its inbox events. Consolidated209 remains the unreleased schema source.
- Added a deterministic multi-session regression for CI's disposable database. No local schema mutation/reset was attempted; the reseeded local database still has the prior209 function bodies. Generated type shapes are unchanged. Focused checks pass343 tests plus type/lint/policy gates; shell syntax and refusal outside CI pass. Targeted Sol review follows before stable-head CI; no live billing or merge authorized.

## 2026-09-26 — Approved subscription launch policy

- This task owns `codex/subscription-launch-policy`, stacked on the unchanged
  Stripe foundation head 9b710884. Recorded final USD/CAD prices, Pro 12, 30-day
  Plus trial, downgrade activity-based archiving and agreed lifecycle/AI rules.
  Updated the access roadmap and durable decisions; distinguished approved
  product terms from provisional AI costs and missing runtime implementation.
- Documentation-only risk profile: none. No database, Stripe account, production
  runtime or existing subscription changed. Next implementation milestone is an
  isolated Stripe test checkout plus lifecycle/access verification.

## 2026-09-26 — Rename launch plans to Basic, Pro and Max

- Owner renamed Plus to Pro and the former Pro to Max. Updated canonical policy,
  launch limits, trial/AI labels and decision log while retaining prices/benefits.
  Documented legacy `plus` → Pro and `pro` → Max to avoid accidental entitlement
  reassignment. Historical runtime/schema keys remain unchanged.
- Continued policy PR1367; documentation-only verification and independent review
  cover the cumulative approved-policy change. No runtime or live billing change.

## 2026-09-26 — Land policy and prepare durable test checkout

- Owner authorized merging the policy and orchestrating implementation. Merged
  admin1360, foundation1366 and policy1367 into main after their final required
  PR Gate passed. Descendant rebases preserved complete reviewed trees.
- Coordinator owns `codex/stripe-checkout-trial`. Workers completed the immutable
  12-variant Basic/Pro/Max USD/CAD catalog, test-price provisioning, durable
  checkout/service/provider/schema contracts. Coordinator added authenticated
  catalog/start/status routes, bounded worker integration and disabled-by-default
  checkout configuration. Browser redirects cannot grant access.
- Independent preapplication review found no blockers in migration211, checksum
  `567b4dfe360266c1b70899e34b70a7ec388a5fdc99494162dbf524207e3c61e9`.
  It remains unapplied. Shared local has unrelated gradebook210; do not reset it.
  Await explicit approval for disposable local `pika_billing_checkout`, applying
  001–209 plus211 without seed. Prior209 reset authorization was consumed.
- Billing-focused tests192/18 files pass; focused checks passed293 tests and
  architecture/UI/design policy checks, then stopped at TypeScript because eight
  new RPCs await proper generated types. Changed-file ESLint, Pika audit and22 CI
  workflow tests pass. SQL harness is wired into CI but unexecuted locally.
- Keep the checkout PR draft until SQL tests, generated types, full focused checks
  and independent implementation review complete. Stripe test credentials remain
  absent; no provider objects/payments or live billing were created. Trial,
  lifecycle/access enforcement, billing UI and provider rehearsal remain pending
  under the durable coordinator plan in `docs/guidance/stripe-billing-foundation.md`.

## 2026-09-26 — Reuse shared local database for checkout verification

- Owner requested the existing local database. Rebased checkout PR1368 onto
  main402f8028 after gradebook210 merged. Read-only comparison found exactly two
  outdated209 billing functions; additive211 now reinstalls their canonical
  definitions without changing209 or data. New static parity and SQL assertions
  cover grants and identity-lock ordering. Billing tests194/18 files pass.
- Local migration list and dry-run preview only211. No application, reset or seed
  occurred. Updated211 SHA256 is
  `e5c30fbb3fa0ead4d4c05ea617ed79e8a5ba3928615ece3991738e8c0d58dc03`.
  Prior independent review covered the original211, not this compatibility delta.
- Review checkpoint: one preapplication launch, zero remediation waves; the
  45-minute elapsed window expired including the user-input pause. Further
  independent reviews need explicit additional review-time approval. Local211
  application also awaits exact authorization. PR stays draft; generated types,
  database contracts and full implementation review remain pending.

## 2026-09-26 — Apply and verify local checkout211

- Owner approved45 additional review minutes and existing-local211 application
  after review. Independent delta review passed frozen SHAe5c30fbb. Verified
  local project/port/history and preview; one `supabase db push --local` applied
  only211. That approval is consumed. No reset or reseed.
- Billing and checkout rollback contracts pass; generated types refreshed from
  applied schema. Security advisor reports no issues. Three users, one classroom
  and the disabled billing sandbox are preserved. Focused checks pass207 tests,
  TypeScript, lint and architecture/UI/design gates. Full financial/security and
  compatibility review follows before ready CI; no provider payment performed.

## 2026-09-26 — Preserve legacy plans during first checkout

- Full review of41c75110 found a P1: legacy paid accounts could reserve first
  checkout and be implicitly migrated. Batched fix adds unapplied212 requiring
  unchanged legacy Free eligibility at reservation, resumption, progress save,
  binding and first-payment claim. Changed plans become attention; existing
  paid-finish revision fencing handles the subsequent race. Applied209/211 are
  unchanged. API returns a safe409 for initial ineligibility.
- Focused checks pass212 tests plus types/lint/policy checks. New SQL cases cover
  legacy paid rejection and plan-change races; they remain unrun until exact
  local212 authorization. The harness refuses a database without212. Migration
  SHA256 `0053ac7fd7ed9a7bc1302c18fa8eed8657f98a09749cc651bdcbac6c285d0c50`.
- Targeted correction/preapplication review follows as launch5/5, remediation
  batch1. New212 and refreshed generated types/final integration review require
  a further owner checkpoint. Previously issued provider sessions may still be
  paid after an operator changes a plan; this patch prevents access overwrite,
  and provider cancellation/refund handling remains a prelaunch lifecycle task.

## 2026-09-26 — Apply checkout eligibility212 and prepare final review

- Owner approved local212 and one final integration review up to20 minutes
  (launch6). Verified the reviewed hash, local target/history and preview;
  applied only212 once. Authorization consumed; no reset or reseed.
- Expanded checkout SQL exposed a test-expression ordering bug: capture the
  claim result before inspecting saved state. The test-only fix passes;
  migration212 is unchanged. Checkout and foundation rollback contracts pass;
  generated types refreshed. Existing three users, one classroom and disabled
  sandbox are preserved. Final focused checks and review precede ready CI;
  no Stripe provider purchase or live activation.

## 2026-09-27 — Preserve test references during Preview saves

Fixed the teacher editor resetting authoritative document state from document-free parent summaries. References now reset only on owner changes (test/classroom/API scope); detail reads and document mutations own same-test updates. Regression covers a parent summary refresh, Preview payload/source Markdown, and the save-triggered parent refresh; existing stale-response tests remain passing. No schema, API, grading, fullscreen, or visual contract changes. Reuse: existing split Tests editor and Preview/reference controls. Risk: workspace-state.

Verification: TestDetailPanel 48/48; focused checks 276 tests plus architecture/UI/design/TypeScript/lint; 12 mocked Playwright contracts across teacher/student, desktop/mobile, light/dark (image uploads/preview/retry/zoom/answer retention plus Pattern Lab Markdown reference preview), with screenshots inspected at /tmp/pika-preview-browser-results. Local Supabase stopped; fixture server uses loopback-only placeholders. Production quiz content remains unchanged by this code task. Pending independent PR review and release.

Independent review identified a pending document-mutation response crossing selected-test boundaries. Batched remediation guards all document callbacks and auto-sync by captured assessment scope, and keys document editors by owner so pending child state cannot carry into another test. Deferred edit regression verifies the new test's references and Preview payload survive the old response. Editor suite now 49/49; final focused checks and targeted review follow.
Final integration review caught auto-sync attempt suppression resetting only on test ID changes. Second batch aligns suppression reset with classroom/API/test ownership, with both classroom and API transition regressions. Final focused checks and bounded correction/integration review follow.
Third correction attaches an owner key to document state and prevents auto-sync effects from mixing prior documents with a newly selected endpoint during the transition render. Different-link API transition regression confirms only the new owner's link is synced. Final focused checks pass 280 tests plus architecture/UI/design/TypeScript/lint. Bounded final correction review pending; release remains separate.

Main sync: resolved only continuity-document overlap after PR1368 landed; reviewed application/test blobs remain identical to fe74df85. Independent review complete, no blockers. Updated-base focused checks and exact-head CI precede authorized squash merge.

## 2026-09-27 — Stage contextual Assignment inline-image fix

- User authorized orchestration of the audited image-access boundary. This task owns codex/contextual-assignment-images based on main402f8028. Terra implementation worker staged the independent default-off exact user/Classroom gate, relationship-aware delivery, transaction-fenced reservation/finalization and migration213. A separate read-only worker mapped restricted API/RPC lifecycle verification; no classroom UI or billing activation is included.
- Image-focused tests pass33 checks and TypeScript passes after installing existing locked dependencies into this worktree. Behavioral rollback-only database fixtures and CI wiring are authored, not executed. Database types remain unchanged. Source review and final focused checks follow; concurrent removal/submission proof and persisted manual lifecycle rehearsal remain outstanding before readiness.
- Started Docker solely for local diagnostic checks. Local database history is001–212; main source is001–210 because billing PR1368 is still open. No migration, reset, hosted data, runtime gate or production change. Sync billing migration source before the exact local213 application/type-generation checkpoint; do not import or modify the other task's work.
- Draft PR1371 at initial head a8679dff is attached. Full focused checks pass124 tests across14 files plus TypeScript/lint/policies; staged-file Pika audit passes. Sol/Terra initial source review found a fixture revocation ordering blocker, a creator-binding gap and missing archived-owner/revocation coverage. One remediation batch fixes all three; targeted Sol review follows. Local dry-run refused missing211/212 source; no history repair attempted. Review ledger: /private/tmp/pika-assignment-images-review-ledger.json (two initial launches, one initial wave, batch1; final integration deferred until schema/types evidence).
- Correction68632997 pushed; repeated full focused checks pass124 tests and all static gates. Targeted Sol review found no actionable issue and independently passed33 tests plus shell syntax/diff hygiene. Three reviewer launches and one fix batch consumed. PR remains draft; next is billing1368 landing/sync, then exact local migration213 authorization, generated types, database/race evidence and final integration review. This final continuity note is local/uncommitted to preserve the reviewed source SHA.
- User reported billing1368 merged and212 applied. Verified merge43c170b5, rebased this branch onto main, resolved only duplicate historical archive notes while retaining main's history, and restored the local handoff note. No image runtime/schema/harness/test content changed from reviewed68632997; migration remains213. Local history through212 verified; dry-run previews only213. This task's temporary rebase stash is consumed; unrelated existing stashes are untouched. Post-sync checks precede updating draft1371; exact local213 application authorization is still needed. No migration or production action performed.
- Owner approved exact local213 application. Rechecked clean feature worktree, local history and dry-run containing only213; applied213 once successfully. Rollback-only image database contracts pass and fixture users are absent afterward. Generated types add only the three image RPC signatures; generation/check pass. No production migration or gate activation. Concurrency evidence and final integration review remain pending; keep1371 draft and check the existing review deadline before any additional reviewer launch.
- Owner approved one final integration review capped at20minutes. Terra test worker added four actual removal/submission versus image reservation/finalization races; coordinator corrected test cleanup to use the local compatibility metadata protocol, exact fixture IDs, collision preflight and bounded background sessions. All four race cases and the mixed-role image contract passed; mutable fixtures/test schema artifacts clear, immutable anonymous PAL audit evidence intentionally remains. Synced main6650e76a (#1370), resolving only duplicate archive notes. Reviewed runtime/migration213 unchanged. Final checks/review/CI precede authorized merge; restricted full Assignment rehearsal is the next separate integration phase, not claimed by these image tests. No production or gate activation.

## 2026-09-27 — Billing flow and edge-case verification

- Owner: `codex/billing-flow-testing`. Audited the complete subscription policy against runtime; recorded implemented coverage, missing lifecycle/customer UI, and launch blockers in `docs/guidance/billing-test-report-2026-09-27.md`. Updated stale checkout/prod-schema continuity (211/212 were previously approved and applied; no migration applied this pass).
- Added seven billing regressions and fixed empty signed webhook account/context fields bypassing presence validation. Red tests reproduced the defect; all198 billing tests and162 focused tests plus types/lint/architecture passed. Both local billing database rollback harnesses and Pika audit passed.
- Real isolated Stripe sandbox:12 catalog variants; Pro purchase, decline/retry, unpaid expiry, Max CAD annual 3DS failure/retry, Basic annual recovery without webhook delivery, duplicate synthetic delivery and HTTP authorization/signature checks. Exactly one invoice effect per paid fixture and correct2/5/12 effective caps. Billing return route404 remains a launch blocker. No live billing or production writes; cleanup disabled local gate and canceled test subscriptions. Independent review and final CI follow.

- Final CI caught the production-history summary format expected by an existing attendance migration contract (8,369 other tests passed). Restored `Prod DB 001–212` without changing the verified schema state or billing runtime. Targeted contract and focused checks precede correction review and a new stable-SHA CI run.
- Reviewed head1f49006a passed all8,370 CI tests, production build, database contracts, Stripe binding/webhook race and PR Gate (run36337177687). Main then advanced via1371/39c948e8, causing only a duplicate archive-marker conflict. Rebased while draft, preserving both sessions; billing runtime/test patch is unchanged. Five reviewer launches and three correction/sync batches are consumed. New-head focused checks precede an owner checkpoint for one additional bounded rebase review; no new CI or merge until that review passes.

## 2026-09-27 — Verify classroom rollout readiness

- PR1371 merged as39c948e8 after final review,125 focused tests and full CI. Continued rollout in `codex/contextual-rollout-rehearsal`; startup verified. Fresh production history matches001–212; linked dry-run previews only213. Exact production213 approval requested, not yet received; no production writes or activation. Existing production PR1373 belongs to another active task and excludes1371; leave its branch untouched.
- Read-only Terra source audit confirms live home still routes by global role; contextual home has no live consumer. Full classroom shell exposes legacy-role Tests, Daily, Grades/Gradebook, roster and content writes; owner Classwork also fetches legacy surveys. Full UI rollout therefore needs implementation, not just enabling gates. Restricted manual Assignment integration remains next; do not present an Assignment-only pilot as the completed full-classroom rollout. Private checkpoint: `/private/tmp/pika-contextual-rollout-status-20260927.md`.

## 2026-09-27 — Orchestrate full rollout and correct owner precedence

- Owner authorized production213. Fresh target/history and dry-run matched only213; the single application attempt timed out connecting before reporting execution. Subsequent linked history confirms001–212,213 pending. Fresh retry approval requested, no second attempt. Production code PR1373 merged separately as6904c2ed and excludes image1371.
- Terra built a real local route-handler/DB manual Assignment rehearsal with mocked request identity only, exact-loopback/demo-JWT validation, outbound transport containment and tracked synthetic cleanup. Coordinator strengthened negative cases: six scenarios pass, but admitted owner with historical self-enrollment can open/create learner work (200 vs403). Pre-return saved grades/feedback remain correctly hidden. No browser/session or image-byte round trip claimed; exact-object byte cleanup is unavailable on the shared local stack.
- Astra mapped five finite full-experience batches into the existing roadmap, then implemented forward migration214: eight contextual learner definitions reject the owner from locked classroom evidence while preserving signatures, locks, prior bodies and owner-history inspection. Added18 passing static regressions plus a rollback-only behavioral harness; migration214 not applied. Added both the harness and real route rehearsal to ephemeral-database CI. Focused checks and independent review follow; keep all product gates off.

## 2026-09-27 — Apply migration 213 to production

- Fresh exact owner authorization allowed one retry. Verified production binding zhioqbapgfcrronyuidm, merged1371 migration bytes, passing CI36335825410, matching history001–212 and dry-run containing only213. Linked push succeeded; post-apply history matches001–213 with no drift.
- Read-only catalog check confirms all four image functions, empty search paths, service-only public entrypoints and no direct application-role access to the private helper. No214 application, deployment, rollout activation or account changes. Continuity-only edits remain uncommitted in the existing draft1376 worktree; PR review checkpoint is not resumed by this migration-only request.

## 2026-09-27 — Merge owner precedence and begin shared admission

- Resumed with explicit approval. PR1376/f3c00147 passed fullCI36344942279, including7realroute scenarios and browsermatrix; merged as7758ed44 and hubfastforwarded. Five reviewer passes, one formatting correction; final CI22m50s. User authorized214 for both targets. Production preflight previewed only214; apply succeeded and history001–214 plus8function ownerchecks/privileges were verified. No feature activation.
- Local preflight instead found214 subscription_lifecycle,215 subscription_lifecycle_validation,216 subscription_lifecycle_warning_cleanup. No owner214 local apply or history repair attempted. Notified billing task Admin dashboard with exact collision and main/prod precedence; preserve all data and obtain coordinated repair authorization.
- Began independent batch1 in codex/classroom-shared-admission: strict optional manual actorcohort consumed by materialGET authorization, preserving relationships/projections/legacy pairpilots. No migration, env activation, role/plan rewrite, home/page/signup or materialwrite change. Astra bounded design and Terra implementation; coordinator corrected absent-config behavior and strengthened sameactorA/B/C and archived-member tests.69targeted tests/types pass; focused checks and independent review follow.

## 2026-09-27 Subscription automation implementation in progress

Owner requested remaining lifecycle, classroom enforcement, billing screens and full sandbox testing after #1372 merged. Worktree `codex/subscription-automation`, base `85e8a2bf`; active coordinator plan in `docs/guidance/stripe-billing-foundation.md`. Phase 2 lifecycle storage/runtime and authenticated trial/effective-status endpoints are being implemented, with provider unpaid-invoice decoding. Migration214 is being authored, not applied; existing local database remains unchanged. New merge, production rollout, live billing and real email remain outside authorization. Phase 3 must cover timestamp-based scheduled assignments and subscription-specific archive protections before exposing launch UI. Preserve the separate dirty `subscription-lifecycle` prototype; it is not the runtime implementation.

## 2026-09-27 Subscription lifecycle draft and first review

Draft PR #1377 adds gated once-only Pro trials, finite version-bound paid access, renewal/grace/cancellation observations, due expiry, authenticated status/trial APIs, and rollback-only SQL contracts. Initial Sol/high security and Terra/high compatibility reviews completed; batch 1 fixes grace truncation by cancellation/original-invoice replay and missed uncollectible renewal recovery. Billing tests pass 285; SQL harness and generated RPC types remain pending exact local migration 214 approval. Existing local DB is still at 213 and unchanged. Further lifecycle commands/financial closeout, classroom restrictions, UI/notices and full sandbox rehearsal remain in the coordinator plan. No new merge, production, live billing or real email authority.

## 2026-09-27 Local subscription schema verification

Owner approved local214; one reviewed push applied only214 successfully. Generated types refreshed; focused248tests/architecture/UI/design/TypeScript/lint pass. Lifecycle and checkout SQL contracts pass after a harness-only CASE parenthesis correction. Foundation SQL contract exposed changed malformed-fence responses; forward215 restores original22023 validation for both entrypoints and adds rollback-only validation coverage.214 remains immutable.215 passed targeted security/compatibility review, then owner approved local215 and one push applied only215 successfully. Foundation, checkout, lifecycle and validation rollback database contracts all pass; generated types match. Local9users/1classroom/billingsandboxfalse preserved. PR1377 remains draft pending final cumulative review and required CI; reviewbudget4launches and2fixbatches (45minute cap19:57UTC).

## 2026-09-27 Billing CI warning cleanup checkpoint

PR1377 returned to draft after CI database warning gate found unused variables in trial-start and three checkout functions; Test & Build and all billing database contracts passed. Owner approved one cleanup batch plus two further reviews within30minutes (19:46:49–20:16:49UTC). Forward216 replaces unused result assignments with PERFORM while retaining writes, row locks, FOUND checks, ACLs and behavior.214/215 remain immutable.216 passed targeted review and received exact local approval; one push applied only216. Warninglint returnszeroissues, allfourDBcontracts pass, generatedtypes match, and9users/1classroom/billingsandboxfalse remain. Reviewbudget now3fixbatches; launches6, with finalreview7 reserved beforeCI. Dependent renewal-closeout worktree preserved/paused with only corecontract and worker-handler changes; no closeoutmigration or provideradapter yet.

## 2026-09-27 — Billing migration collision correction

PR #1377 rebased onto main ede9b218; preserved main owner-precedence migration214. Renamed reviewed billing214/215/216 to215/216/217 byte for byte and made lifecycle harness prerequisites check names as well as versions. Saved private local backup/history/checksum evidence; prepared a guarded metadata-only local reconciliation helper whose default check rolls back. No history repair/application performed. Owner approved fourth correction batch and eighth/final review (30minutes); exact local history repair and owner214 --include-all application still need separate approval. Existing local data and disabled billing gate preserved. Next: final independent review, exact local repair approval, verification and stable-SHA CI.

## 2026-09-27 — Resume Chrome PDF reference fix PR1353

- User explicitly authorized merging PR1353 when ready. Rebased the previously reviewed PDF fix onto current main, preserving image-viewer routing and combining PDF MIME metadata with image metadata. Prior 853-test gate and Sol/Terra reviews cleared original head89ab04a8; updated integration checks and independent review required before merge. Risk profile: exam-mode.

## 2026-09-27 — Titlebar clock visibility
- Task branch `codex/titlebar-clock-visibility`: show the existing Toronto date/time only in fullscreen, maximized windows, or exam mode. Keep exam compliance enforcement and mobile clock treatment unchanged. Reuse AppHeader clock/useFullscreen; extend visibility with a resize/focus-aware maximize hook. Risk: exam-mode presentation only; no compliance changes or new composite widget.
- Shared app header is the approved shell reference; Pattern Lab now renders normal/exam production owners for both roles. Visual verification passed16 Playwright captures: teacher/student, light/dark, restored/maximized/fullscreen/mobile. Screenshots and reproducible capture script remain local under artifacts/titlebar-clock and /tmp/pika-titlebar-visual.cjs.
- Initial focused checks passed203 tests, architecture, UI/design policy, TypeScript and lint. Header tests passed17, including resizing, initial fullscreen/exit and exam recovery. Draft-first publication and independent fixed-SHA review follow; no merge or production rollout authorized.

- Independent Terra review identified near-full restored windows being mistaken for maximized. Replaced the viewport ratios with outer-window/screen bounds; added near-full and one-dimension restored regressions plus Pattern Lab header accessibility coverage. Targeted review flagged the8px boundary too; removed tolerance and added within8px restored regressions. Final review follows strict screen-bounds matching.

## 2026-09-27 — Correct titlebar fullscreen interpretation
- User clarified that the date/time must stay hidden whenever Pika is not fullscreen, for both teacher and student. Removed the OS-window size inference, which could re-enable the clock after hydration; visibility now uses only the existing Fullscreen API state or exam header state. Exam enforcement is unchanged.
- Reuse AppHeader/useFullscreen and existing clock styling; shared shell/Pattern Lab remain the reference. Verify both roles, light/dark, windowed (including screen-sized browser), fullscreen entry/exit, reload, mobile and exam header. No new components or composite-widget behavior.
- Focused checks passed206 tests plus type/lint/architecture/UI/design gates;18 header tests cover screen-sized normal windows after effects/resize/focus and real fullscreen events. Browser verification and fixed-SHA review follow before returning PR1374 to ready.

## 2026-09-27 — Titlebar clock merge preparation
- User approved the fullscreen-only result and authorized PR1374 merge to main. Synced main85e8a2bf; the sole conflict was a duplicate archive-batch marker, resolved in favor of main's marker. Application and test files match reviewed687b3469; no product behavior changed during sync.
- Required focused checks and targeted sync review precede stable-SHA CI and squash merge. Local server3107 remains the preview; no production promotion requested.

## 2026-09-27 — Titlebar mobile CI stabilization
- Owner extended the review budget to resolve PR1374's mobile Pattern Lab tooltip failure and complete merge. CI passed Test & Build but failed the student mobile attendance tooltip checks. Reproduced the scroll/focus race locally; scrolling the absent chip into view before focus preserves the tooltip assertion and avoids the tooltip being dismissed by focus-induced scrolling.
- Synced main ede9b218; conflicts were confined to duplicate archive history, preserving main's entries. Titlebar application/component-test files are byte-identical to reviewed632136b0. One-line browser-test correction, focused checks, bounded independent review and final-SHA CI precede merge.

## 2026-09-27 — Test-mode pane layout

Removed the redundant separator line from the shared student/teacher-preview document workspace. One 30/70-default width state now survives reference opening, Back, and switching documents; the resize control is available in the list too. Kept answer forms mounted and existing pointer/keyboard controls. Verification: 245 focused tests plus architecture/UI/design/typecheck/lint; student and teacher Playwright desktop/mobile light/dark captures and pane-width regressions. Composite accessibility checklist reviewed; keyboard and semantic state tested; no manual follow-up. Branch: codex/test-mode-pane-layout.

## 2026-09-27 — Test reference image scrollbar stability

Fixed image resize feedback by measuring fractional border-box viewport dimensions and using CSS minimum canvas dimensions instead of previous content-box measurements. Preserves zoom, Fit, scrolling, and mounted answers. Unit regression covers scrollbar-area changes and real pane resizing; browser regressions reserve scrollbar space and sample image geometry across 40 frames. Teacher/student desktop/mobile light/dark verification passed (8 scenarios); focused suite 250 tests plus architecture/UI/design/typecheck/lint passed. Also verified the local seeded Markdown/PNG test. PR1375 returned to draft before this correction.

User chose image-specific maximum pane width. Opening an image now expands documents to the existing 50% limit, allows manual resizing while open, and restores the previous list width on Back; text and link references keep the user-selected width. Shared workspace state owns the behavior. Unit regression covers expand/manual resize/restore; eight teacher/student desktop/mobile light/dark browser scenarios pass, and all screenshots were inspected. Four affected component suites pass (76 tests); architecture/UI/design/TypeScript/lint and Pika audit pass. A broad focused rerun hit Vitest worker/test timeouts under local load, so final CI remains the full-suite gate. PR1375 correction review/CI pending.

Checked whether divider dragging could record an exam exit. The divider changes only its CSS pane width, and its pointer interactions mark an allowed document interaction; window-compliance telemetry observes browser-window resize, fullscreen, visibility, focus, and navigation instead. Added a desktop student browser drag through the actual divider, then explicitly dispatched a transient window blur and asserted no focus-event request after the 600ms blur grace period. Light and dark variants pass. No product-code change was needed.

Main advanced while PR1375 was open. Rebasing onto cdc48bc3 retained the new PDF-reference handling; the only conflicts were duplicate archived continuity entries, so main's copies were kept. On the rebased source, focused checks pass 255 tests plus architecture/UI/design/TypeScript/lint; all eight teacher/student image browser scenarios pass across desktop/mobile light/dark, and screenshots show the intended layout. The local dev server was relaunched with the repository launcher. Targeted sync review and exact-head CI follow.

Exact-head CI passed Test & Build but failed two desktop long-test browser scenarios because their older text-reference assertion expected a 50% open pane. Updated the assertion to verify the new 30% preserved width and keyboard expansion to 35%; all four long-test desktop/mobile light/dark scenarios now pass locally, as do 255 focused tests and static gates. Seven unrelated browser scenarios were flaky but passed on retry in that CI run. PR returned to draft before this test correction; final review and fresh CI follow.

## 2026-09-27 — Pause Pal UI CI

Owner confirmed Pal is disabled until further notice. Recorded the pause in the current-state summary and Pal operations guide. Required CI now excludes the two Pal learner-component suites and dedicated Pal classroom browser scenario; backend, API, feature-gate, and theme-contract checks remain. Full component suites remain available through `pnpm test:coverage`, and the browser scenario can still be run directly before reactivation. PR1375 returned to draft before this correction. The CI test-selection check confirms the UI suites are absent and backend checks remain; workflow and focused validation follow.

Independent review confirmed the CI exclusion scope and found the reactivation guide still named widget alpha.4 while the pinned dependency is alpha.6. Updated both guide references to alpha.6. Focused checks passed 255 tests and architecture/UI/design/TypeScript/lint; full CI coverage run follows.

Full CI coverage command passed 885 files / 8,438 tests with coverage thresholds met. A first run exposed that the compact CURRENT note had changed exact phrases used by the Bara attendance documentation contract; restored those phrases while staying under the startup size budget. Both targeted contracts and the full coverage rerun passed. Targeted re-review reported no remaining blockers.

## 2026-09-27 — Owner-authorized local database reset

Owner explicitly requested resetting local DB to resolve migration numbering. From reviewed source0a2c1c2d, one local-only reset through217 with no seed succeeded after a fresh private custom-format database backup and archive-list verification. All217 history versions/names match source; dry-run reports up to date. Classroom owner-precedence and billing foundation/checkout/lifecycle/validation rollback contracts pass. Post-check: zero local users/classrooms; billing sandboxfalse/test. Production untouched. Prior metadata-repair proposal is superseded and must not run. Billing215–217 remain PR1377 source, not yet merged main. Backup and logs: /Users/stew/.codex/backups/pika-local-reset-217.efCeer. No accounts restored or test data seeded.

## 2026-09-27 — Authorized local reseed

Owner subsequently requested local reseeding. Standard pnpm seed (seed.ts plus planned-course fixtures) succeeded using in-memory credentials from the running local stack, guarded API127.0.0.1:54321 and ENV_FILE=/dev/null. Verified3users,1classroom,2enrollments,3assignments,2tests,3blueprints; planned-course idempotency check passed. Migration214–217 names unchanged, billing sandboxfalse/test. No second reset, hosted access, real account restore or gate activation.

## 2026-09-27 — Billing documentation sync after local reset

Owner approved one documentation-only fifth correction batch and CI, with no additional reviewer, database changes or merge. Merged main4d0c4474 into PR1377; the sole archive conflict contained branch entries already present verbatim in main, so retained main archive without losing history. Consolidated reset/reseed receipts and superseded the old history-repair plan. Billing source/migration bytes stay identical to independently reviewed0a2c1c2d. Verified local001–217,3demo users/1classroom,sandboxfalse/test; generated types match and warning lint is clean. Focused checks and stable-commit CI follow. Review count remains8 (hard cap); no new launch.

## 2026-09-27 — Billing final documentation-format correction

Owner approved the sixth/final documentation-only correction and CI rerun. Restored CURRENT’s required `Prod DB 001–214` prefix after the prior shortening failed the rollout-format contract; no billing code, tests, migration SQL or database state changed. Prior CI passed8524tests plus billing DB contracts and warning lint; remaining jobs were incomplete at the failure checkpoint. Verify both startup size and rollout-format tests, focused checks, then fixed-commit CI. No additional reviewer or merge authority.

## 2026-09-28 — Selected assessment label size

Enlarged the teacher assignment and test edit labels above their student tables to 18px mobile and 20px desktop. Follow-up: each existing ghost edit button now fills the available left section of the context bar, stopping before the centered action cluster. Student-facing pages and composite behavior are unchanged. Local seeded teacher Playwright captures covered both workspaces at desktop/mobile in light/dark, measured full-width click targets with no page overflow, verified keyboard focus, and confirmed each label opens its editor. PR1382's first final-SHA CI passed Test & Build but failed unrelated mobile Pattern Lab attendance-tooltip checks. The test now uses a real keyboard focus transition; all eight focused Pattern Lab cases pass across teacher/student, desktop/mobile, light/dark. Focused checks pass 275 tests plus architecture, UI/design policy, TypeScript, and lint. Risk: none. Model recommendation: GPT-6 Sol for the localized UI adjustment. Final review and CI follow.

## 2026-09-28 — Coding-test reference authoring conventions

- Documented the reusable student-facing reference order: general `Instructions` first, language or subject reference second, and question visuals afterward. Added a general Markdown outline, concise question guidance, assessment-specific marking policy, and copy/adaptation checks based on the Unit 1 Karel quiz authoring work.
- Documentation only; no product, grading, database, or published-test changes. Risk profile: none. Model recommendation: GPT-6 Sol for the focused documentation update. Focused checks, independent documentation review, and draft-first PR gate precede merge.

## 2026-09-28 — Image reference first-load measurement

Inspected the teacher/student private image route and measured it on a temporary seeded local Test using 787,252-byte and 7,081,652-byte PNGs. The first small request took 428ms to authorize/redirect and 10ms to transfer; repeat requests took 38–41ms plus 8–21ms. The large image took 33–40ms to authorize and 61–70ms to transfer. The temporary Test was deleted through the teacher API; its two managed objects entered normal cleanup_pending state. No application code, migration or hosted data changed. Live production timing and the actual reference-file size remain unknown because browser control timed out and the connected Supabase app was unavailable. A 1MB cap is not justified by this local evidence alone.

## 2026-09-28 — Image reference first-open preload

Mounted the first image reference when the teacher preview or started student test workspace appears, and kept the same image instance for first open and return. Other images continue to load on demand. The viewer resets zoom on close and keeps the existing authenticated route, full-resolution image, and retry behavior. Component tests and targeted Playwright teacher/student cases passed across desktop/mobile and light/dark; the browser case observed one image file request before first click and no second request on open. Visual screenshots were reviewed. Hosted latency and file size remain unmeasured.
