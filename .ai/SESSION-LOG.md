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

## 2026-09-25 — Platform administration design proposal

- Coordinator task `01a0d8f5-aa5b-7643-8357-40883f4193cc`, active persistent goal; branch `codex/platform-administration-design`, main base `74648fd8`. Proposed phased plan/threat model in `docs/guidance/platform-administration.md`; owner review pending before implementation.
- Source and independent session inventory confirm service-only plan206 foundation, 180-day base sessions, and missing privileged elevation/MFA contract. Recommend capability membership independent of classroom roles/plans, read-only inventory first, scoped transactional plan writes and separate production gates.
- Live Supabase connector returned USER_NOT_LOGGED_IN; production plan assignments, migration206 and strict setting remain unverified. No code, migrations, grants, plan changes, PR, merge or deployment performed. Next: owner review of phase sequence, session policy and first authorization slice.

## 2026-09-25 — Fictional platform-admin prototype
## 2026-09-20 — Dormant contextual assignment history/restore

- User requested admin prototype screens. Added a development-only Pattern Lab route with fixed fictional inventory, account detail, activity and plan-preview screens. Confirm action remains disabled; no live account API or admin authority was added. Design brief and reuse decisions are recorded in `docs/guidance/platform-administration.md`.
- Browser-verified desktop/mobile and light/dark list/detail/preview/activity. Mobile inventory changed from horizontal table to cards with visible View actions; no page overflow or console errors. Focused checks pass (11 files, 93 tests, architecture, UI/design policy, TypeScript, lint).
- Design approval, real authorization and plan operations, production target verification, and all production enablement remain pending.

## 2026-09-25 — Admin prototype classroom shell revision

- User clarified the prototype should follow the regular classroom layout. Reused `AppShell`, `ThreePanelShell`, `LeftSidebar`, and `MainContent`; added fixture-only Overview, Accounts, Activity, and Plans sections in the classroom-style collapsible rail/mobile drawer. Account detail and disabled plan preview stay under Accounts. The prototype remains fictional and development-only.
- Extended the shared app-header sidebar trigger with an optional accessible label for admin navigation. Focused component coverage now checks section selection, mobile drawer closure, heading focus, and disabled confirmation. Playwright reviewed desktop/mobile, light/dark, expanded/collapsed rail, mobile drawer, and preview; no horizontal overflow or browser errors. UI brief and evidence are in `docs/guidance/platform-administration.md`. Teacher/student checks are n/a because no role session is involved. Risk profile: none. Model recommendation: GPT-6 Sol — scoped UI shell integration and review.
- Independent review found the shared sidebar cookie leaked a prototype-only collapse into real classroom preferences. The provider now supports non-persistent sidebar state for this fixture; component and browser checks confirm `pika_left_sidebar` stays unchanged.
- Final integration review found the unclassified account preview labeled a missing creation grant as zero. The preview now shows `—`; targeted component and browser checks cover the unknown value.

## 2026-09-25 — Read-only admin operations prototype

- Owner: codex/platform-administration-design, PR #1360. Product direction now assumes all tier and entitlement changes are automated. Replaced the prototype's Plans and plan-preview screens with Exceptions and exception detail, leaving tier as read-only account context; Overview, Accounts, and Activity now explain automated outcomes.
- Reused the classroom shell and governed UI controls. Fictional example.invalid fixtures only; no live reads or writes. Playwright reviewed desktop/mobile, light/dark, account and exception details, activity, and drawer. The mobile exception title now wraps, navigation resets scroll, and browser checks show no horizontal overflow or errors. Teacher/student roles are n/a for this session-free fixture. Risk profile: none. Model recommendation: GPT-6 Sol — scoped prototype and product-scope revision.
- The platform-administration proposal now describes a narrow read-only operations console. Live authorization, data scope, deployment, and any manual recovery action remain separate future decisions.
- Focused check passed 28 files / 248 tests plus architecture, UI/design, TypeScript and lint. Pika audit passed. The shared drawer passed an Escape/focus-return browser check; composite-widget checklist has no remaining prototype follow-up.
- Final independent integration review found the prototype theme button persisted a shared app preference. Removed the button so browsing this fixture cannot change the regular app's theme; light/dark verification uses isolated Playwright browser settings.
- A regression test confirms prototype navigation leaves the shared theme preference unchanged and exposes no theme control. Final focused check passed 28 files / 249 tests plus architecture, UI/design, TypeScript, and lint; audit passed. Removed five duplicated historical archive entries introduced by the trim after rebasing, retaining their earlier copies and the unique subsequent entry.

## 2026-09-25 — Subscription policy source of truth

- Owner: `codex/platform-administration-design`, PR #1360. Added `docs/guidance/subscription-policy.md` for automated tier assignment, verified payment/account mapping, immediate same-interval upgrade proration, unchanged renewal dates, clear quotes, and existing-class protection. Linked it from the AI router, decision log, access roadmap, plan foundation, and operations proposal.
- Explicitly separated agreed rules from proposed cancellation/grace/downgrade defaults and open provider, pricing, refund, grant-precedence, and AI-metering decisions. Billing is not implemented or activated by this documentation. Risk profile: none (documentation only). Model recommendation: GPT-6 Sol — bounded policy documentation.

## 2026-09-25 — Strict creation activation readiness

- User delegated final production checks and activation if gates pass. Subagent refreshed 182 classified accounts (180 Free, 1 Plus, 1 Pro), zero plan/grant/dual-audit mismatches, reviewed live database functions/triggers, and prepared guarded activation privately. Strict creation and automatic Free signup remain OFF; no hosted writes occurred.
- Parent verified production alias at app SHA `213b2787`, authenticated owner classroom/Daily attendance/Classwork/Gradebook read access, 69 focused tests, and local rollback-only plan database contracts. Production student join/submission and remaining synthetic/write-flow canaries need completion using a designated disposable classroom and student session; user clarification pending. Private evidence stays outside Git. Existing work and account assignments unchanged.

## 2026-09-26 — Ultra-compact Gradebook

Added a remembered More actions toggle for compact assessment codes, four-letter
categories, 44px weight inputs, and whole-number displayed percentages. First
name/Final widths and grade calculations retain their existing behavior. Raw
scores remain readable; production-owner Pattern Lab evidence added. Focused
component/helper tests and desktop/mobile light/dark Playwright checks passed,
including toggle persistence, editing, scroll, override marks and role isolation.

## 2026-09-26 — Ultra-compact name-column refinement

Hide the second displayed student name in ultra-compact mode, including metadata
and summary rows. Detailed mode restores both names. Regression checks cover
both name orders, ID visibility and raw-score alignment. Fresh raw screenshots
show full earned/possible marks on desktop/mobile in light/dark themes.

## 2026-09-26 — Raw Gradebook maximum row

Raw mode now shows a Max mark row before Weight in compact and regular layouts,
including when weights are hidden. Student and average cells show earned marks
only; precise earned/possible information remains in editing labels. Compact raw
columns are 64px. Tests cover zero/fractional values, row order and display-mode
switching; production-owner desktop/mobile light/dark screenshots verified.

## 2026-09-26 — Maximum override modal and calculation choices

Prepared the maximum editor with Keep existing marks / Preserve percentages,
refresh-to-original, persisted per-assessment maximum/scale, serialized normalized
mark writes, and matching returned-only student calculation. Production-owner
modal/table screenshots verified desktop/mobile light/dark. Migration 209 and a
rollback-only database contract are authored; application/types verification
requires one-time permission for local migration 209. No database changes applied.

Independent Sol/Terra review found and remediation fixed cold-archive defaults,
returned Classwork item scaling, fractional precision, manual input rounding,
and bounded cumulative scales. App-first activation and rollback gate documented.
Database harness now covers normalized fractions, historical archive keys,
repeated scale rejection and reset. Local application approval remains pending.

Second targeted review found an effective-maximum gate for empty/zero-point Tests.
Manual marks now count with a positive override in teacher cells, final/summary,
and returned student projection. Empty and zero-point tests have regressions.
Migration 209 still awaits local approval; PR1365 remains draft.

Final correction also handles fully scored zero-point Test questions without a
manual mark against a positive effective maximum. Empty/unscored Tests stay
omitted in both roles. Third fix batch; final integration review remains bounded.

Local preflight found an external task had applied migration209
stripe_billing_foundation (PR1366), which is absent from origin/main. Reserved
210_gradebook_maximum_overrides.sql and added harness name checking; did not
apply/repair/remove any migration. Local DB/types verification is additionally
blocked until this checkout includes the approved billing baseline. The earlier
209 approval request is obsolete; gradebook application would require local210.

## 2026-09-26 — Above-maximum Gradebook warning

Added amber border/background and warning triangle for assessment, final and
average marks above 100%; raw mode compares earned to maximum. Compact warning
and override icons coexist without clipping. Exact 100% and 150/200 stay normal.
Verified 16 Pattern Lab screenshots across density, raw/percent, viewport and
theme plus student-role isolation; focused checks and independent display review
recorded in PR1365. Existing migration210/type/harness gates keep PR draft.

## 2026-09-26 — Simplify Gradebook mark cells

Removed warning and refresh/override status icons from assessment, final, max
and average cells per user refinement. Amber above-maximum highlight and
accessible/hover explanation remain; dialog reset actions remain functional.
Raw preview retains earned-only values and Max mark before Weight. Sixteen
layout/theme/viewport/mode screenshots plus student-role isolation passed.

## 2026-09-26 — Apply Gradebook maximum migration locally

Owner explicitly approved210 locally. Applied exactly once from isolated detached
billing9b710884 baseline checkout with identical reviewed210; dry run listed only
210, local target verified. Migration history now001–210. Database harness passes
with rollback after fixing its question insert to canonical position column.
Isolated generated types verification recorded in PR1365; feature-branch type
integration awaits billing209 merge. Application permission is consumed.

## 2026-09-26 — Prepare production209/210 and gradebook merge

Owner explicitly authorized production209+210 then gradebook merge. Import the
unchanged reviewed billing209 schema and generated001–210 types so gradebook
can merge before billing application code. Remove temporary RPC cast; refine
nullable reset/clear arguments and preserve maxima in assignment atomic parser.
Production maximum edits default off until GRADEBOOK_MAXIMUM_EDITS_ENABLED is
true after full mark-writer deployment; reads/normalized writes/reset stay usable.
731 focused tests and canonical type checks pass; independent integration review,
production application and stable-head CI remain in progress.

## 2026-09-26 — Restore maximum access during paused production changes

Owner authorized reset-access remediation and one extra targeted Terra review
after the five-launch checkpoint. Separate schema availability from maximum edit
capability. Overridden columns remain accessible; paused dialog disables input,
behavior selection, Save and form submission while retaining reset. Integration
and failure-recovery tests pass; eight desktop/mobile, light/dark, regular/compact
visual matrices verify keyboard restore and student isolation. Canonical database
types and rollback-only maximum database harness pass. Production209/210 approval
is still unconsumed; exact-head targeted review and CI precede application/merge.

## 2026-09-26 — Disposable tier activation fixtures

- User authorized creating the production test classroom and Free student fixture. Created a clearly labeled disposable classroom through the authenticated owner UI and one isolated student record with an audited Free plan/zero creation limit. Private identities and execution records remain outside Git. No WorkOS identity, verified-email flag, or fabricated session was added.
- Subagent production rollback canaries passed creation/replay, Free/at-capacity Blueprint denial, restore, transfer, and downgrade preservation; independent before/after counts and row hashes prove no synthetic data persisted. Strict creation/automatic Free signup remain OFF. Actual student sign-in/join/submission require a user-controlled test mailbox for WorkOS verification; requested without passwords. No billing/admin enablement, migration, deploy, or real-class edits.

## 2026-09-26 — Strict creation and automatic Free signup activated

- Owner `codex/platform-administration-design`, PR #1360. Under the user's scoped activation authorization, the subagent executed the reviewed guarded production activation RPC once at 11:54:17 UTC. Migrations 181/206 verified; strict creation and default-Free provisioning now ON. Readback: 183 accounts (181 Free, one Plus, one Pro), complete plan/grant/paired-audit parity, original nine classrooms' ownership/archive states preserved. Identity-level records and exact operation evidence remain private outside Git.
- Normal user-controlled magic sign-in, Free student roster join, link/richtext submission, final grading and returned grade visibility passed in the disposable classroom. Teacher/student attendance views render expected non-class-day states; no fresh QR/check-in or attendance-write round trip claimed. After activation student returned work and teacher Gradebook remain accessible.
- Postactivation rollback-only synthetic account probe passed atomic Free provisioning, disabled quota0 creation, paired system audits, and missing-grant denial. Independent before/after counts, full class hash, plans/grants/audits and settings prove no synthetic probe records persisted. No migration, app deploy, billing/admin enablement, role rewrite or real-class teaching edit. Test fixtures remain available; no destructive cleanup performed.
- Updated current context, rollout status and administration proposal to distinguish active creation/default-Free behavior from unimplemented billing/admin. Synced latest main into the feature branch; resolved archive conflict by retaining existing unique history rather than reintroducing duplicated entries. Required documentation/prototype checks and stable-SHA review follow; no merge authorized.

## 2026-09-26 — Activation status-note CI correction

- PR #1360 CI passed the browser matrix but failed one of 8,088 tests because the compact production migration note no longer matched the established `Prod DB 001–NNN` format. Restored that format and removed a redundant undated health shorthand to retain the startup size limit. Runtime activation facts and application code are unchanged.
- Returned the PR to draft before correction. Verify the attendance rollout-note contract together with startup guidance and the focused gate, then independently review the fixed commit before requesting CI again. No production changes or merge performed. Risk profile: none; model recommendation: GPT-6 Sol for this documentation correction.

## 2026-09-26 — Stripe provider decision

- Owner selected Stripe for paid subscriptions. Added SUB-06 to the canonical subscription policy, recorded the decision, and removed provider selection from open decisions. Tier caps remain Free0/Basic2/Plus5/Pro10; paid prices and AI quantities remain undecided. This records provider selection only, without billing implementation or live charges.
- Corrected the plan-foundation status to point to the verified production strict/default-Free rollout. No runtime behavior changed. Risk profile: none; model recommendation: GPT-6 Sol for policy documentation. Validate focused checks and independent documentation review before marking the updated PR ready.

## 2026-09-26 — Versioned paid offerings policy

- Owner approved documenting future payment-model changes and existing-subscriber protection. Extended the existing canonical subscription policy with SUB-07/SUB-08: preserved offering versions before paid launch, exact purchase/entitlement binding, explicit grandfathering/renewal/optional migrations, annual paid-term protection, and audited idempotent transition/recovery. No universal grandfathering promise or new price, usage quantity or lifecycle default is assumed.
- Linked the decision and current fixed-writer limitation from the decision log and plan foundation. No implementation, account or production changes. Risk profile: none; model recommendation: GPT-6 Sol for bounded policy documentation. Focused verification and independent documentation review precede updated ready-PR CI.

## 2026-09-26 — Gradebook final CI test correction

Targeted Terra cleared reset remediation on11dfb1dd. Synced main with both
session histories retained; reviewed source diff was byte-identical. Final CI
36258739324 found an outdated explicit Gradebook helper allowlist and two
whole-gallery query timeouts. PR1365 returned to draft; production remains
through208 and209/210 permission is unconsumed. Test-only correction names
three reviewed helpers and scopes gallery role queries to their sections, with
all existing assertions/timeouts preserved.24 targeted tests pass, including
coverage instrumentation (partial-suite global coverage thresholds are not a
full coverage gate). Final focused checks and correction review precede new CI.

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
## 2026-09-21 — Prevent incomplete student image uploads

- Owner `codex/prevent-incomplete-image-uploads`, based on merged PR1313. The Assignment editor now opens the native picker before changing content, keeps progress/failure state outside Tiptap JSON, and inserts only completed managed images. Canceling leaves the response unchanged; failures expose Retry/Remove; paste/drop use the same transient path.
- Student submission is disabled and guarded imperatively while an image is uploading or awaiting recovery. Legacy saved `imageUpload` nodes remain readable through the inert compatibility note and can no longer be created by the toolbar/shortcut.
- Focused gate passes 45 files/699 tests plus architecture, UI/design policy, TypeScript and lint. Playwright verified default, uploading and failure recovery on student desktop/mobile in light/dark; teacher is n/a because this follow-up changes only editable student state. Composite checklist passed with a labeled native picker, polite live progress, alert recovery and keyboard-reachable actions. Risk profile: none. Model recommendation: GPT-5 — bounded editor state transition with autosave and submit coordination.
- Initial independent review found two non-blocking recovery gaps: paste/drop could replace a visible failed upload without an explicit student choice, and a finalized image could be orphaned if the editor became read-only before insertion. Remediation batch 1 preserves the failed item until Retry/Remove and requests reference-safe managed-storage cleanup for finalized-but-uninserted images; focused regressions and API coverage pass.
- Targeted review found a blocking commit-to-passive-effect race where read-only or document-identity changes could occur just before upload completion. Remediation batch 2 makes completion validate render-current editability and document identity synchronously, with layout-phase unmount invalidation and both transition regressions.

## 2026-09-21 — Classroom Grades page patterns

- Owner `codex/classroom-grades-patterns`, based on `origin/main@ed6e6ca1`. Pattern Lab now places a default-off “Show grades to students” switch at the top of the teacher Gradebook page pattern and adds a student Classroom Grades tab showing a returned-work-only 84% fixture with counted and excluded examples.
- The paired Student Grades visibility pattern reuses the same teacher control and student card, while retaining the standalone returned-marks comparison. These development-only fixtures do not alter production navigation, persistence, authorization, or grade APIs.
- Focused verification passes with 15 files and 147 tests plus architecture, UI/design policy, TypeScript and lint. Visual verification covered teacher and student desktop/mobile in light/dark, both teacher switch states, the enabled student Grades view, and zero horizontal page overflow. Risk profile: none.

## 2026-09-22 — Test grading repaired and calibrated against archived work

Goal was to improve AI grading of open-response test questions the way assignment grading
was improved in `b0557ac3`. Reaching that goal required fixing three defects the DeepSeek
migration left on the test path; the assignment path had been migrated thoroughly and the
test path had not.

Shipped: PR1316 raised test output budgets from 220/420 (and 600/900 batch) to 6000/8000.
DeepSeek counts reasoning against `max_tokens` and effort had been raised to `medium`
(provider tier `high`), so every open-response test grade truncated twice and threw —
broken in production, reachable from the teacher AI-suggest route, not only from tooling.
Values measured, not guessed: 12 real responses spent 71-4509 output tokens. PR1312 fixed
the gold-set harness, which gated on `OPENAI_API_KEY` and ran bare `tsx` with no
`--env-file`. PR1319 added transcription-tolerance guidance to both prompt profiles; policy
to v3, both prompt versions to v2.

PR1319 came from adjudicating real archived work with the teacher, not from inspection.
Codex exported two archived classrooms (684 teacher-scored responses, all coding,
de-identified via `sanitizeAiText`; retained as JSONB in
`classroom_retired_assessment_records`, no timed purge). A new `pnpm calibrate:test-grading`
samples balanced across classroom and point scale and ranks disagreements for human
adjudication, explicitly treating recorded marks as a second opinion rather than ground
truth — the teacher had stated their own marking may contain errors, and that proved
correct in both directions. Eight cases adjudicated. Finding: the grader reads concepts
accurately (it caught backwards inheritance and an integer-division bug) but over-penalised
transcription, costing a submission that matched the sample solution 3 of 10 marks for a
stray period and a missing parenthesis. The defect was inconsistent application of its own
leniency rule, not harshness. Post-fix run on the same seed: target cell improved from
-0.254 to -0.185, agreement 1/13 to 4/13.

Open and unresolved. The rule was validated on the same 80 responses it was derived from,
so generalisation is untested; a different seed on unseen work is the honest check. Only
1 of 13 nine-point cases was adjudicated, so that cell's apparent regression is read as a
yardstick artifact rather than demonstrated. PR1321 (request timeout 25s to 60s) is
deliberately draft until a full run is observed completing at the shipped value; the
evidence so far came from a temporary local override, and the timeout only began biting
because PR1316 let grading think longer. Branch `claude/test-grading-calibrator` holds the
calibrator, token/effort tracking and provenance stamping, unpushed with no PR; it carries
a production change (optional `reasoningEffort` override, production default unchanged) and
wants real review. Assignment and repo-review paths still carry the same 25s timeout,
untouched for lack of evidence. DeepSeek retention remains account-level only, confirmed
against `docs/guidance/ai-grading-egress.md` but not settled with the owner.

Process note: this session worked in the hub checkout rather than a feature worktree, and
opened its first two PRs ready instead of draft, which PR Gate correctly rejected. Both
violate `.ai/START-HERE.md`. Risk profile: async-grading.

## 2026-09-22 — Assignment AI grading lease-fencing prerequisite

- Owner `codex/meter-ai-grading`, based on merged metered-reservation PR1318. Migration202 adds a versioned worker contract plus service-only run/item patch and provenance-finalization boundaries. Existing and rolling-deploy runs remain legacy version0; future metered runs opt into version1, requiring the exact current, unexpired lease across DeepSeek and Gradex work while legacy finalizers/direct service-role updates are rejected.
- Under standing local-migration authorization, migration202 is applied locally. Generated types match local history001–202; the real takeover harness proves expired/stale run and item patches, stale finalization, legacy finalization and direct service-role DML cannot bypass a version1 replacement lease. This slice does not create version1 runs, call the usage ledger or activate metering; production remains001–180.

## 2026-09-22 — Accept required Assignment links without GitHub identity

- Standard link requirements now send only their URL instead of an irrelevant blank GitHub login; repository-link requirements retain the existing GitHub fields.
- The Assignment artifact request boundary normalizes a blank optional GitHub login to absent for compatibility with older clients. Component and API regressions cover both paths; the focused gate passes 60 files/664 tests plus architecture, UI/design policy, TypeScript and lint. Risk profile: none.
- Pattern Lab visual verification covers the student attachment checklist on desktop/mobile in light/dark; the existing layout and states are unchanged. Teacher is n/a because no teacher surface or data contract changed.
- Composite-widget checklist reviewed: no roles, keyboard behavior, focus handling or semantic state changed; remaining manual follow-up: none. Model recommendation: GPT-5 — bounded submission validation fix.

## 2026-09-22 — Dormant Assignment AI usage accounting

- Owner `codex/meter-assignment-ai-usage`, based on merged lease-fencing PR1323. Migration203 adds a service-only Assignment admission/finalization boundary: a version1 run reserves one shared `grading.ai` unit per queued student item, skipped missing/empty items reserve zero, successful grade/provenance finalization settles atomically, and terminal item/run failure releases atomically. Retry admission is idempotent and every operation revalidates the exact current lease and Assignment/Classroom/student/document binding.
- Migration203 also hardens shared quota accounting to refresh time after blocking locks and count reserved/settled usage across entitlement revisions, preventing metadata revisions from minting capacity. Expired Assignment operations fail closed and require a fresh run/item after terminal release.
- Under standing local-migration authorization, migration203 is applied locally. Generated types match local history001–203; warning-level DB lint is clean and the real database harness proves per-item reservation, replay safety, archive and malformed-count rejection, zero-cost skipped completion, atomic settlement rollback, terminal release, cross-revision quota enforcement, failed-admission rollback and the unchanged unmetered version0 path. No application route calls the new boundary, no grant or billing state changed, and production remains001–180.

## 2026-09-22 — Default-off Assignment metering application integration

- Owner `codex/assignment-ai-metering-integration`; risk profiles async-grading and workspace-state. Exact-true server flag admits all Assignment requests through version1 while flag-off single DeepSeek and new version0 runs retain legacy behavior. Persisted version1 controls per-item DeepSeek/Gradex admission, atomic settlement, retry retention, skip release and terminal release after flag rollback; quota/unavailable responses remain content-free.
- The rendered classroom AI Grade action continues to hand accepted durable runs to the existing `TeacherClassroomView` polling flow; the unused assignment-local controller remains unchanged. Reused all current busy, feedback and error owners; no new visual components or Pattern Lab contracts. Joining/student work and entitlement/plan state are unchanged; no flags enabled.
- `pnpm check:focused -- --base origin/main` passed 442 tests/31 files plus architecture, UI/design policy, TypeScript and lint; pre-commit audit is clean. Browser evidence uses the seeded local classroom and simulated AI responses (no provider work): teacher desktop/mobile, light/dark, default/loading/completion/quota/unavailable; student shared-route regression. Captures are local under `output/playwright/assignment-ai-metering/`.
- Independent DB review confirmed the expiry cleanup edge. Forward migration204 (201/203 unchanged), authorized/applied locally, preserves already-expired Assignment release evidence during terminal cleanup, renews only live lease-fenced reservations for 24 hours, and adds `internal_failure` cleanup classification. Real DB expiry/renewal/conflict/privilege cases, warning lint and generated-type check pass; dedicated concurrent expiry-vs-renewal stress remains a follow-up to the deterministic serialized harness. Model recommendation: GPT-6 — durable provider lifecycle and transactional accounting boundaries. Epic remains open and rollout disabled.
- Draft-review remediation keeps migration204 default-off while adding an exact service-only capability sentinel, complete per-item source fingerprints (Assignment, document, structured artifacts and workflow history), Assignment-only `internal_failure`, and lease-fenced durable Gradex run/item correlation. Admission and settlement now reject artifact deletion/replacement races; Gradex polling admits and fetches only live local items, survives pseudonym-salt rotation, and waits for all sibling terminal persistence before surfacing a failure. Validation used a disposable full migration replay because the earlier M204 shape was already applied to the normal local database; no local data was reset.

## 2026-09-22 — Daily Log attendance-save reliability

- Student Today now sends the first nonblank Daily Log immediately, retains per-student/classroom/Toronto-date device drafts, retries an unsent prior-day draft under its original date, and offers an explicit conflict choice when a saved log already exists. No separate check-in action was added; later edits retain throttled autosave, and page exit makes a best-effort save without treating it as confirmed.
- Client saves are serialized; the PATCH route accepts duplicate content idempotently, rejects a missing or stale entry identity, and uses version-conditional updates to prevent stale overwrites. Log-derived attendance remains tied to the entry's class date; QR attendance is unchanged. No migration or production database change.
- Focused checks pass 244 tests/16 files plus architecture, UI/design policy, TypeScript and lint; pre-commit audit passes. Student recovery reviewed on desktop/mobile light/dark and teacher Daily on desktop/mobile dark. Composite-widget checklist reviewed: existing buttons retain keyboard behavior, status and conflicts have textual labels, and component tests assert accessible status/actions; no manual follow-up identified. PR review pending.
- Independent review remediation: remove unscoped legacy session draft restore, clear pending saves after Reload latest, preserve blank edits to an existing log, keep old-day recovery from delaying today's save, and carry first post-midnight typing into a new-date draft rather than dropping it. Empty old-day drafts with no known entry are skipped; attendance itself already requires nonblank text. Focused checks now pass 249 tests/16 files plus the same policy/type/lint gates. Targeted re-review pending.
- Targeted review found a same-date classroom-switch queue collision and a lost-response/blank-clear recovery gap. Second batch binds queued saves to student/classroom/date and rereads that exact draft after switching, while blank older drafts first reconcile against server state before clearing or discarding. Regression tests cover both; focused checks pass 251 tests/16 files plus architecture, UI/design policy, TypeScript and lint. Final integration review pending.
- Final integration review found no blocker but identified storage-unavailable loss on stale-tab date rollover. Third batch retains the new-date keystroke in scoped memory when device storage rejects it, keeps the warning visible, and schedules a server save after the new-date load even if loading state was batched. Storage-failure regression added; focused checks pass 252 tests/16 files plus all policy/type/lint gates. Exact-head re-review and CI pending.
- User-approved fourth review batch addresses the remaining P1: later edits now supersede or clear the rollover-only memory draft, so a load cannot prefer first-typed A over newer durable AB. A deferred-first-save/reload regression covers the exact sequence. Focused checks pass 253 tests/16 files plus architecture, UI/design policy, TypeScript and lint; pre-commit audit passes. Current student Today and teacher Daily Playwright captures loaded and inspected at mobile/desktop; prior light/dark recovery-state captures remain valid because no visual treatment changed. Exact-head targeted review and CI pending.
- Cumulative review found a storage-failure rollover conflict gap: an in-memory draft could auto-save over a new-day log from another device. Fifth batch treats in-memory and durable drafts equally for conflict detection and waits for the fresh entry read before auto-saving a cached restore. A blocked-storage/existing-log regression confirms visible conflict and no PATCH. Focused checks pass 254 tests/16 files plus policy/type/lint gates; pre-commit audit passes. Final exact-head review and CI pending.

## 2026-09-22 — Production student Grades

- Owner `codex/student-grades-production`, based on merged Classroom Grades patterns. Added a default-off `student_grades` classroom preference, a teacher Gradebook visibility switch, and a student Classroom Grades tab backed by a private no-store server projection.
- The student projection includes only fully graded, returned work from currently visible Classwork/Test sources, honors per-assessment overrides, keeps excluded or non-contributing returned items visible as `Not counted`, and calculates the current grade with the teacher Gradebook category/assessment-weight rules. Final-grade overrides remain teacher-only.
- Migration202 is authored with default-off backfill, shape enforcement, and the latest cold-archive restore adapters, but was not applied to any database. Focused full verification passes 160 files/1,816 tests plus architecture, UI/design policy, TypeScript and lint; Pika audit passes. Playwright verified teacher/student desktop/mobile in light/dark, default-off/visible states, and the local classroom was restored to off. Composite checklist reviewed: native switch and links have keyboard coverage, checked/active state is semantic, and no manual follow-up remains. Independent PR review follows.
- PR1320 security review found migration202 would have replaced the top-level archive normalizer and bypassed the wrappers added by migrations147/150/164. Remediation batch1 now renames and delegates to the current adapter before adding only `student_grades`, preserves service-role-only execution, and ratchets the chain in a focused migration test; the full 161-file/1,823-test gate remains green.
- Cumulative review cleared the archive correction but found fractional scores were rounded before aggregate calculation, causing teacher/student current-grade drift. Remediation batch2 preserves raw earned/possible values through `calculateCategorizedFinalPercent`, rounds only the public response fields, adds a fractional rubric regression, and removes stale prototype copy.
- Final integration review found the teacher aggregate still consumed rounded assignment display cells. Remediation batch3 now carries raw rubric-earned values into both legacy and categorized teacher calculations while retaining rounded display fields, with an API regression asserting teacher/student parity at 3.33%.
- User-authorized extended review found returned assessment overrides were omitted from student Grades when underlying rubric/responses were incomplete. Remediation batch4 now evaluates assignment/test overrides before base-score completeness, preserves omission for incomplete work without overrides, and covers zero assignment and response-free closed-test overrides.
- Teacher Gradebook visibility refinement moves the control from a standalone settings card into the existing action bar immediately before More actions. The slightly enlarged settings-style switch is neutral and icon-free when hidden; when shown, its track is solid green and its right thumb contains the Lucide Users icon. The optimistic checked treatment now remains visible while the background save disables the switch, with failure rollback covered. Concise “Show grades to students” / “Hide grades from students” tooltips remain, and save errors stay in the Gradebook feedback area. Targeted component and Pattern Lab tests, TypeScript, UI/design policy checks, and desktop/mobile light/dark visual verification pass; the student Grades surface is unchanged.

## 2026-09-22 — Persistent students icon in Gradebook visibility switch

- The teacher Gradebook switch now shows a neutral Users icon at the right end of its track while off; when on, the icon moves with the thumb and the track remains green. The shared switch gained an optional off-state icon without changing switches that omit it. The full focused gate passes 166 files/1,904 tests plus architecture, TypeScript, lint and UI/design policy; Pika audit passes. Playwright confirms off/on at teacher desktop/mobile in light/dark, the live teacher off state, and the unchanged student Grades view at desktop/mobile. Risk profile: none. Model recommendation: GPT-6 — narrow shared-control styling change with role and state verification.

## 2026-09-22 — Student Grades merge preparation

- PR1320 was rebased onto current main after an AI-log archive conflict was resolved without dropping either existing archived entry. Main now owns migrations202–204, so the unapplied student Grades migration was resequenced to205 and its private archive-adapter name and regression updated. The first exact-head CI replay applied205 in its ephemeral database, then found the generated types lacked the new private adapter; the checked-in types were synchronized to CI's exact generated diff. The user requested merge; final CI and merge gates follow. No migration was applied to a persistent environment.
- The next exact-head CI passed build and database contracts but exposed two stale Pattern Lab selectors after production-component reuse and four outdated icon-catalog screenshots following the new student Grades navigation item. Browser tests now target the production switch name and `student-grades-view`; Linux screenshots come from the failed CI artifacts and Mac screenshots were regenerated locally. Targeted teacher/student desktop/mobile light/dark browser checks pass (12/12), as do the full focused gate (166 files/1,905 tests), TypeScript, lint, architecture, and UI/design policy. The normal local dev server was restored at port3001. PR1320 remains draft pending a fresh exact-head CI and merge.

## 2026-09-22 — Daily Log PR main synchronization

- PR1329 was brought up to date with main after its exact-head CI passed. The sole textual conflict was in the AI archive; both batch markers and all distinct history were retained. Classroom page and test changes merged automatically without altering the Daily Log implementation. Combined-tree focused checks pass 166 files/1,922 tests plus architecture, UI/design policy, TypeScript and lint. PR remains draft for the updated-head gate; no merge to main was performed.

## 2026-09-22 — Daily Log PR final review and up-to-date gate

- User authorized additional review. An exact-head integration review of 14d6f387 found no blocker, with 112 targeted tests passing. Ready CI run35803112343 passed Test & Build, browser, database and PR Gate on that head. The squash merge was rejected solely because main advanced during CI and the branch-up-to-date rule applies; no admin override was used.
- Main's two new commits affect only test-grading calibration and rubric scoring, with no Daily Log path overlap. They merged into the feature branch without a textual conflict. Fresh integration review and exact-head CI are required before the merge retry; no persistent database migration was applied.
- Exact-head 722c9e9e targeted re-review found no blocker (142 tests), and CI run35804835394 passed all lanes. During that run main advanced again via a session-log-only PR. The strict up-to-date gate requires another branch sync; the archive batch-marker conflict retains both markers and unique history, with duplicate rolling-log entries omitted. No Daily Log source changed.

## 2026-09-22 — Test grading calibrated against adjudicated work

Continuation of the earlier entry today; that one stopped before the second rule and the
harness landed. Shipped after it: PR1321 (request timeout 25s to 60s), PR1324 (retry at
reduced reasoning effort instead of failing when both token budgets truncate, plus
`reasoningEffortUsed` in assignment and test provenance), PR1330 (score itemized rubrics as
a checklist) and PR1331 (the calibration harness itself).

PR1330 came from adjudicating real responses with the teacher. On a ten-criterion key worth
ten marks, submissions satisfying six and seven criteria scored four; the teacher set both
at 6-8 and 7-8. Failures were being charged more than once. Measured on a fixed benchmark —
all 48 ten-point responses, five with verified targets — both adjudicated cases moved from
4 into band (8 and 7), cell harshness fell from 36/48 to 21/44, and weak submissions held
their low scores rather than floating up, which was the specific failure mode worth checking.
Generalisation was then measured by re-running the same 80 responses from the earlier seed-7
run: overall agreement 42 to 47, mean absolute disagreement 0.145 to 0.132, with the 10-point
cell improving on a different draw than the rule was derived from.

I dismissed this finding once before. A sweep of a second ten-point question graded
accurately and read as a refutation, but those submissions failed on concepts rather than
transcription and had fewer satisfied criteria, so the effect had little room to show. Two
non-comparable questions treated as if one disproved the other; it cost several rounds and
only resurfaced once PR1319 removed the masking noise.

Reasoning effort was tested and ruled out as the cause of 10-point harshness: low and medium
are harsh at an identical 36/48, and medium is marginally less harsh and more accurate for
1.5x the tokens. Keep medium; stop looking there.

OPEN, and the reason to keep the benchmark. The 9-point cell drifted more lenient under
PR1330 (+0.239 to +0.248). This was predicted before the run — a floor rule raises scores by
construction and that cell was already the most lenient — and it is NOT resolved. It cannot
be resolved by another run: that cell is scored against the marks with the strongest evidence
of being wrong, including the response recorded 2/9 which the teacher adjudicated at 8/9. It
needs a human to adjudicate a handful of 9-point cases. Also open: peak output reached 16,386
tokens after PR1330, so the 60s timeout binds again on the heaviest responses; four of 48 and
one of 80 responses failed on timeout or invalid output in the last two runs.

The benchmark is repeatable: `pnpm calibrate:test-grading --max-points 10 --all` over the 48
ten-point responses, with verified targets for student-21 (6-8), student-16 (7-8), student-20
(~10), student-12 (8-9) and student-06 (9). De-identified snapshots for both archived
classrooms sit gitignored in the repo root.

Process: this session again worked in the hub checkout rather than a feature worktree, and
pushed twice to ready PRs, which PR Gate correctly rejected both times. Risk profile:
async-grading.

## 2026-09-22 — Assignment AI metering canary gate

- Owner `codex/assignment-ai-metering-canary`; risk profiles async-grading and runtime-platform. Production and local ledgers were verified at migrations001–205. The production classroom-creation cutover remains disabled with181 accounts unclassified, Assignment metering has zero reservations, service-only privileges are intact, and migration205 has no malformed student Grades settings.
- Assignment AI metering now requires both the exact-`true` server master switch and the authenticated teacher's exact account ID in a bounded comma-separated cohort. Every Assignment request uses the existing durable coordinator: missing, malformed, oversized or unmatched cohorts create unmetered version0 runs, while exact matches create metered version1 runs. Persisted version1 runs remain resumable independently of later gate changes. No flag, cohort, entitlement, quota or active production rollout changed.
- Targeted Assignment usage/run/API coverage passes91 tests plus TypeScript. The focused gate passes309 tests across24 files plus architecture, UI/design policy, TypeScript and lint; Pika audit is clean. Model recommendation: GPT-6 — financial-usage admission and resumable async grading rollout boundary.
- Independent security and architecture review found that a single-student retry could leave the durable path after a teacher was removed from the cohort, bypassing an active version1 reservation. A standalone active-run check still had a creation race, so remediation removes the split entirely: all Assignment AI requests now enter the atomic durable coordinator, where matching work resumes and conflicting work remains blocked. The metered Gradex smoke also requires its stable teacher ID in the cohort and verifies a version1 run with exactly one settled `grading.ai` reservation.

## 2026-09-22 — Daily Log PR final merge window

- PR1329 reviewed head1d8a9d11 passed all required CI lanes, but main advanced to d09b8ec4 during the browser run, so strict up-to-date rules prevented merge. User paused other main merges for a quiet window. The Assignment AI metering commit merged into this branch without conflict or Daily Log source edits; refreshed checks, exact-head review and CI precede the normal squash merge. No admin bypass or persistent database migration.

## 2026-09-23 — Future classroom retention roadmap

- Owner `codex/classroom-retention-roadmap`; risk profile none. Documented a proposed, plan-independent archived-classroom retention sequence and advance notices in the lifecycle roadmap, with a pointer from the product roadmap. It remains future work; no email, timer, automatic cold transition, deletion worker, database migration, or rollout gate was enabled.

## 2026-09-23 — Dormant account plan foundation

- Owner `codex/account-plan-foundation`. Migration206 adds service-only, revisioned account plans and an audited writer that derives the `classrooms.create` snapshot from Free0, Basic2, Plus5 or Pro10 in one transaction. No caller-supplied quota, existing-account backfill, strict-cutover activation, billing, AI allowance, production configuration or UI change is included. Future signups acquire Free only after the existing strict cutover is activated.
- With exact authorization, migration206 SHA256 `bc29eefb4b074c4bbad5f43f9755edb5b80c0f91ff157e009784c742d35bd4b8` applied to the local Pika database only; local history is001–206, production remains001–205. The rollback-only contract passes plan mapping, post-cutover Free signup, operation replay/conflict, stale revisions, browser-role isolation and existing-class preservation on downgrade. Generated types match the local schema. The focused gate passes94 tests plus architecture, TypeScript and lint. Local advisors report no new account-plan warnings; hosted application and production data remain unchanged.
- Rebased onto `f6716e39` after the retention-roadmap merge. The only conflict was an archive-batch marker for identical session-history content; retained main's marker. Migration 206 stayed sequential and unchanged. Fresh local checks and exact-head review/CI are required before this PR is ready again.

## 2026-09-23 — Gradebook zero assessment weight

- Owner `codex/gradebook-zero-assessment-weight`; risk profile none. Gradebook assessment weights now accept 0–999 across teacher controls, APIs, blueprints, and stored constraints. Zero is preserved on reload and excluded from final-grade math; all-zero categories remain ungraded. Migration207 is prepared but not applied to any database.
- Focused checks passed 733 tests plus architecture, UI/design policy, TypeScript, and lint. Pattern Lab teacher Gradebook verified at desktop light/dark and mobile; a zero entry displayed 0% course weight. Local type check is blocked because migration207 has not been applied to the shared local database; final database replay remains a CI gate. Model recommendation: GPT-6 Sol — multi-layer gradebook contract and migration change.
- Independent review found two follow-ups: dropping assignment/test defaults would change generated Insert types, and returned zero-weight work would still appear counted in student views. The remediation uses a -1 insert-only default sentinel that the existing before-insert trigger resolves to the category default, and labels zero-weight assignment, test, and standalone marks as not counted. Route and server regressions cover those projections; final checks and targeted re-review follow.

## 2026-09-23 — Bulk test grading execution fix and provenance hotfix

- Owner `claude/fix-bulk-grading-limits` (PR1340, draft); risk profile async-grading. #1324 added `reasoningEffortUsed` to stored AI grading provenance, but migrations 101–104 whitelist provenance keys exactly, so every AI grade save failed. PR1342 (merged to main as `e31dcfc5`) removes the key from storage and adds `tests/lib/grading/provenance-db-contract.test.ts`, which reads the whitelists from the migrations. Anything new in stored provenance now needs a migration first. Production still runs the broken code until draft PR1344 (`claude/promote-grading-hotfix`: #1336, #1338, #1342; excludes #1339) merges; it must first take production after Codex's PR1343 lands.
- PR1340 makes "Grade all" for tests safe at any batch size without changing grades: attempts are recorded before each provider call, items whose attempts were all interrupted fail instead of restarting (previously an unbounded billed loop), no call starts unless it can finish and save inside a 270s tick budget, tick `maxDuration` 300s, request timeout 60s, lease 240s. Batch output budget grows with the call and caps batches at 4, which is production's size. The DeepSeek adapter captures cache and reasoning tokens in memory only; the stored schema strips them. Focused gate: 513 tests plus architecture, UI/design policy, TypeScript and lint; the contract test fails when a cost field is added to the stored schema.
- Next: independent review of PR1340, then ready and merge on a green PR Gate with owner approval. Then PR 2, a comparison harness in `scripts/calibrate-test-grading.ts`: batch size 1, 2 or 4 chunked like production, a shuffled-order seed, manual or bulk profile, per-answer latency and cost, scored against the verified targets; align its `MAX_BATCH_SIZE` of 20 with the cap of 4. Independent calls are a hypothesis until that harness measures them. Teacher calibration decisions and de-identified snapshots stay outside the repo (public): snapshots gitignored in the hub root, adjudication notes in the owner's local handoff folder. Open and unowned: the sanitizer turns common-word names into initials, DeepSeek errors reach teachers untranslated, and the middleware logs 25s timeouts.

## 2026-09-24 — Bulk test grading independent review

- Resumed PR #1340 after the Claude handoff. Initial Sol/Terra review found uncached reference generation ran before durable attempt accounting and missing-question recovery could exceed the attempt cap. One correction batch places preparation inside the counted microbatch attempt, checks the deadline again afterward, and caps missing-question recovery. Four new regressions fail before the correction and pass after it; runner suite passes 20 tests. No migration or grading-strategy change. Focused verification, targeted re-review, and owner merge approval remain required.
- Owner approved a final bounded review, merge on green PR Gate, and production promotion. Final review found database writes or lease renewals could consume the admission window after its check; recheck immediately before reference preparation and single/batch provider calls. Four additional regressions failed before this correction and pass afterward; runner suite now passes 24 tests. Final focused verification and independent confirmation remain required before ready.

## 2026-09-24 — Practice test local server

- Started Docker and Pika on port 3000 from `codex/practice-test-local`, based on main at `94bf3d37`, using the local-dev launcher and existing local Supabase data.
- Environment verification passed; Next.js reported Ready. Server retained for the user's practice test work.

## 2026-09-24 — Responsive teacher test preview

- Fixed embedded preview inheriting the editor's inactive background. Reused ModalLayer for top-layer focus, inertness, scroll locking, and return to the still-mounted editor; reused PageState so maximize/close survive pending reads. Student test-taking and fullscreen requirement unchanged.
- UI brief: teacher preview; reference DESIGN overlay contract and Pattern Lab dialog; reuse ModalLayer/PageState, extend preview composition. Teacher desktop/mobile (1440/390), light/dark, loading/ready/maximize/close/focus; student n/a (teacher-only component). Primary signal remains maximize action/Preview Mode; no new pattern or promotion. Composite keyboard/semantics checklist covered. Risk: workspace-state, exam-mode (teacher preview only). Model recommendation: current Codex for implementation; GPT-5.6 Terra high for one standard-risk independent review.
- Two new regressions failed before and passed after; 11 preview tests and focused gate (159 tests, architecture, UI/design policy, types, lint) pass. Playwright delayed-read/maximize/close/focus matrix passes; screenshots inspected at /tmp/pika-preview-visual; reproducible runner /tmp/pika-preview-verify.cjs. Existing async test-id/request guards retained. Pattern Lab shared modal reference inspected. No shared-component extraction needed.

## 2026-09-24 — Reusable classroom test-authoring guidance

- Owner `codex/test-authoring-guidance`; documentation-only, risk profile `none`. Added a general assessment-authoring guide and routed it from AI instructions, the docs index, and the markdown schema. Covers prompt/rubric/sample alignment, observable credit, diagrams, difficulty, preservation of existing tests, and content readiness versus measured AI grading consistency.
- Course-specific coding and Karel preferences belong in the companion ICS3U guide. This change does not modify assessment content, grading behavior, publication state, or production data.

## 2026-09-24 — Student test question scrolling

- Owner `codex/student-test-scroll`; risk `exam-mode` (layout only). Bound the existing student question section to its split pane height so long tests scroll to the final questions and Submit. No assessment, attempt, or focus-tracking changes.
- Reuse ExamDocumentWorkspace/WorkspaceSplitPane; extend StudentTestsTab with the same bounded scroller used by TeacherTestPreviewPage. Student desktop/mobile light/dark wheel-scroll and reference/answer retention checked; teacher n/a (student-only change), no new pattern or promotion. Existing divider keyboard resizing checked.
- Validation: 43 component tests, four mocked browser matrix checks, focused checks (186 tests, architecture, UI/design policies, types, lint). Local screenshots under `test-results/experience-matrix-student--3e2c4--final-questions-and-submit-*`; fixture avoids live student attempts. Production deployment remains separate.

## 2026-09-24 — Chrome PDF test reference fix

- Owner `codex/fix-test-pdf-embed`; risk profile `exam-mode`. Chrome blocks managed PDFs in the shared sandboxed test-document iframe with its exact "This page has been blocked by Chrome" error. Keep the sandbox for other references; open managed PDF uploads and PDF link snapshots without the iframe sandbox, mounting the PDF viewer only while selected. Both teacher preview and student tests use the shared workspace. Model recommendation: GPT-6 Sol — browser behavior and document isolation boundary.
- Focused gate passed 848 tests plus architecture, UI/design policy, TypeScript, and lint. A temporary local Playwright fixture reproduced the blocked sandboxed PDF and showed the corrected PDF rendering in the split pane at desktop and mobile sizes, including an HTTP redirect like the private file route. Fixture files were removed. Independent review and PR Gate remain.
- Initial Sol/Terra review found filename-based PDF detection could both miss a real PDF and omit the sandbox for a non-PDF named `.pdf`. One remediation batch uses registered managed-storage MIME in both test-detail APIs (and Storage metadata for pre-managed uploads), strips unverified JSON metadata, and identifies PDFs only from `application/pdf`. New uploads retain their verified MIME. Teacher/student rendering and server helper regressions cover mismatched names and MIME, with fail-closed behavior on metadata errors. Targeted security re-review follows.
