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

## 2026-09-25 — Disable student actions for unpublished tests

- Owner: `codex/disable-draft-test-student-actions`. Draft test student tables now disable selection, batch grading/return/unsubmit/delete, access controls, and row unsubmit; row activation cannot open the grading inspector. Publish remains available from the action bar and editor. Publishing restores student selection and actions.
- Reused the existing teacher test action bar, student table, and status controls; Pattern Lab teacher operational controls were the visual reference. No student-facing surface changed. Teacher desktop/mobile light/dark fixture verification passed for draft and published states; screenshots under ignored `output/playwright/`.
- Component coverage includes stale submitted/open draft rows and confirms controls remain disabled; 77 direct component tests passed. Pika audit passed. Composite-widget accessibility checklist reviewed: keyboard behavior yes, semantic disabled state tested yes, manual follow-up none. Focused checks and PR review follow.
- Independent review found direct draft grading/deletion API access despite UI gating. One remediation batch adds draft rejection to AI grading/suggestion, manual grade/save/clear, and single/bulk work deletion routes, with no-mutation API regressions. Exit-alert activation is also disabled for drafts; draft student tables do not start exit polling. Affected tests: 126 passed; focused gate: 269 passed plus architecture/UI/design/types/lint; audit clean. Targeted re-review and stable-SHA CI follow.
- Targeted re-review found queued AI grading runs could still tick for draft tests. Second correction rejects draft ticks server-side and stops client polling for draft runs; API and component regressions pass (81 targeted tests). Final targeted review and ready-SHA CI follow.

## 2026-09-25 — Draft test selection guidance

- Updated PR1361 on `codex/disable-draft-test-student-actions`: disabled draft student header/row checkboxes and the Student actions menu now show concise Publish-first tooltips on hover and keyboard focus. The shared `TableSelectionCheckbox` has an optional `disabledTooltip` prop; Pattern Lab documents it with a deterministic teacher example. No student UI changed.
- Reused canonical Tooltip and existing teacher table/menu owners; no new visual pattern. Teacher draft/published states passed Playwright at 1440/390 widths, light/dark; Pattern Lab teacher example passed the same matrix. Screenshots under ignored `output/playwright/`. Composite widget checklist: relationships retained; focusable disabled guidance and semantics tested; no manual follow-up. Focused gate passed 1820 tests plus architecture/UI/design/type/lint checks; audit clean. Independent review and stable-SHA CI follow.
- User approved resuming the time-limited independent reviews. Both reviewers confirmed two blockers: Turkish/German case variants could evade name masking, and unknown batch-grading provider refs could reach durable Test-run errors. Batched fixes add folded matching with original grapheme-offset substitution and fixed unknown/duplicate-ref errors, preserving existing retry/classification behavior. Also corrected UTF-16-only initials for astral names.
- Added regressions for Turkish-I, sharp-S in both directions, Greek sigma, unchanged surrounding text/context, astral initials, and actual batch-adapter errors through saved Test-run items. Targeted tests pass 4 files / 75 tests. Focused gate, targeted privacy re-review and final cumulative integration review remain required before ready/CI. No migration, dependency, production setting or deployment change.

## 2026-09-25 — Remove Test split-pane prototype header

- Removed the visible full-width Edit Test header and made the experimental modal flush to its pane edges. Saved status now sits beside the Title label and Settings icon; the accessible Close control remains at the top-right without overlapping the mobile controls. Production Test editing and other creation modals are unchanged.
- Extended the shared modal shell with an optional panel class hook, used only by this prototype. The focused gate passes 21 files / 276 tests plus architecture, UI/design policy, TypeScript, and lint. Pattern Lab interaction and visual verification pass for teacher desktop/mobile in light/dark; student is n/a because Test authoring is teacher-only.
- Centered the Test question number/previous-next selector at the top of the right pane and consolidated Points, open-response Code, Duplicate, and Delete into its action bar. Removed the redundant question-reorder arrows and the right-pane Questions heading. On mobile, Close now lives in the scrolling Title row rather than floating over Publish. Four teacher Pattern Lab browser variants and the refreshed 276-test focused gate pass; production Test editing remains unchanged.
- Removed the full-width header from both the Pattern Lab assignment edit prototype and the production Assignment edit modal while preserving the create modal's visible header. The edit Title line now contains autosave status and the accessible Close control, leaving the editor toolbar unobstructed; the split panes begin at the dialog edge. Focused checks pass 21 files / 277 tests plus architecture, UI/design policy, TypeScript, and lint. Eight assignment/Test Pattern Lab browser variants pass; live teacher edit was visually inspected desktop/mobile in light/dark. Student is n/a for teacher editing.
- Consolidated the Test prototype's question selector, type, compact in-field Points label, Add question, and overflow options into one top action bar. Open-response Code response, Duplicate, and Delete now use the accessible overflow menu; the close control stays beside Title at all widths. Four teacher desktop/mobile, light/dark interaction and visual checks pass. Production Test editing remains unchanged.
- Replaced the separate Add and overflow triggers in the experimental Test edit action bar with one blue `ListPlus` Question actions menu. It offers add multiple-choice/open-response, open-only Code response, Duplicate, and destructive Delete, with semantic checked state and focus restoration. Desktop/mobile, light/dark Pattern Lab checks and open-menu screenshots pass; production Test editing remains unchanged.
- Replaced the Test prototype's selected-question Preview dialog with the existing full-screen teacher Test Preview/StudentTestForm composition, fed by its unsaved in-memory draft and reference list without API writes. The editor dialog suspends while previewing and restores focus on Close; browser full-screen/maximize behavior matches the saved-test preview. MC answer options and correct choices are now stored per question so a full-test preview reflects each draft independently. Unit and four teacher Pattern Lab desktop/mobile light/dark interaction and visual checks pass; production saved-test preview behavior remains unchanged.
- Made New Assignment use the existing headerless split-pane AssignmentForm in both production and its Pattern Lab example, matching Edit Assignment without changing create/draft behavior. Teacher desktop/mobile light/dark screenshots and interactions pass; focused checks pass 23 files / 292 tests plus architecture, UI/design policy, TypeScript, and lint. Student is n/a for teacher authoring.
- Pulled main `f4c6e3ff` into the uncommitted prototype worktree. Resolved the sole stash-restore conflict in the continuity archive, retaining main and prototype history; product code auto-merged. The refreshed focused gate passes 23 files / 305 tests plus architecture, UI/design policy, TypeScript, and lint, and eight Assignment/Test Pattern Lab desktop/mobile light/dark checks pass. No migration was applied by this sync.
- Brought the Pattern Lab split Test Text reference in line with production authoring: its add/edit dialog now captures a required title and up to 20,000 characters of Markdown, supports cancel/validation, and feeds actual content into the full-test preview. The prototype's Reference Docs row opens the editor; no API writes or production Test editor changes. Focused checks pass 23 files / 305 tests plus architecture/UI/design policy, TypeScript and lint; four teacher desktop/mobile light/dark add/edit/preview flows and screenshots pass. Student authoring is n/a; teacher preview uses the student-facing reference renderer.
- Synced main `513aeaa0` before the split-pane PR; the only restore conflict was the shared archive, preserving both histories. Added a Title/Close accessibility regression test and passed the pre-commit audit plus refreshed focused gate (23 files / 306 tests, architecture, UI/design policy, TypeScript and lint). The 12-case Pattern Lab split Assignment/Test and Markdown-reference browser matrix passed across teacher desktop/mobile light/dark; an initial mobile-dark 404 was traced to two local servers sharing one checkout, then rerun successfully on a single server. Production Test editing remains unchanged; draft PR, independent review and stable-head CI follow.
- Draft PR1362 independent review found five prototype edge cases: whole-Test Markdown rejected Text reference headings, preview Close left browser fullscreen, sample PDF opened unavailable/blank, Publish ignored errors on other questions, and reference/option drag handles lacked a keyboard path. One remediation batch preserves headings and field-like Text content in the existing Test Markdown parser; makes the sample reference a visibly rendered Text doc and labels new PDFs as pending prototype uploads; owns/exits preview fullscreen; validates all questions; and adds arrow-key reordering with focus and browser/component coverage. The focused gate passes 49 files / 774 tests plus architecture, UI/design policy, TypeScript, and lint; audit passes; 12 teacher desktop/mobile light/dark Pattern Lab browser checks pass. Targeted review, final integration review and ready-PR CI follow.
- Targeted re-review at `ddd5e498` found two residual edges: a literal `### Document N` heading still collided with whole-Test Markdown delimiters, and fullscreen entered through the preview's retry button was not released. Batch2 adds reversible escaping for reserved structural headings in prompt/reference Markdown, preserves literal backslashes, and exits fullscreen if preview began outside fullscreen regardless of which preview control entered it. Link rows join PDF rows as clearly labeled unbound Pattern Lab placeholders rather than fake student references. Parser round-trip regressions, a desktop fullscreen-retry browser case, all 12 teacher desktop/mobile light/dark Pattern Lab cases, focused checks (49 files / 774 tests), and audit pass. Final integration review and ready-PR CI remain.

## 2026-09-25 — Platform administration design proposal

- Coordinator task `01a0d8f5-aa5b-7643-8357-40883f4193cc`, active persistent goal; branch `codex/platform-administration-design`, main base `74648fd8`. Proposed phased plan/threat model in `docs/guidance/platform-administration.md`; owner review pending before implementation.
- Source and independent session inventory confirm service-only plan206 foundation, 180-day base sessions, and missing privileged elevation/MFA contract. Recommend capability membership independent of classroom roles/plans, read-only inventory first, scoped transactional plan writes and separate production gates.
- Live Supabase connector returned USER_NOT_LOGGED_IN; production plan assignments, migration206 and strict setting remain unverified. No code, migrations, grants, plan changes, PR, merge or deployment performed. Next: owner review of phase sequence, session policy and first authorization slice.

## 2026-09-25 — Fictional platform-admin prototype

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
