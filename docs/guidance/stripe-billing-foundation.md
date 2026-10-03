# Stripe billing foundation

Earlier phase-1 checkpoint on 2026-09-27: foundation PR #1366 and gated first-purchase PR #1368
are merged. Local and production databases have migrations through 212, including
the separately approved 211/212 applications. Schema application did not activate
billing. A real local Stripe sandbox rehearsal now covers successful payments,
decline/authentication retries, expired sessions and missed-webhook recovery.
See the [dated test report](billing-test-report-2026-09-27.md) for exact evidence,
limitations and remaining launch blockers. Live billing remains off; lifecycle,
customer billing UI, notices and classroom cutoff behavior remain unfinished.
The [subscription policy](subscription-policy.md) remains the product authority.
The historical implementation/review notes below describe earlier checkpoints;
the dated report supersedes their credential/rehearsal/readiness status.

## Current local schema checkpoint (2026-09-27)

PR #1377 now includes main `4d0c4474`. Main owns migration
`214_contextual_assignment_owner_precedence.sql`; production already has it.
The billing migrations remain byte-identical to the independently reviewed
`0a2c1c2d` source:

| Historical local number | Current number | Name |
| --- | --- | --- |
| 214 | 215 | subscription_lifecycle |
| 215 | 216 | subscription_lifecycle_validation |
| 216 | 217 | subscription_lifecycle_warning_cleanup |

The owner separately instructed the classroom task to reset the existing local
database to resolve this collision, then requested a local reseed. That task
backed up the database and successfully reset/replayed exact reviewed source
`0a2c1c2d` through 217, then ran the standard seed against the guarded local API.
All 217 migration versions and names match source. The current baseline is three
synthetic users, one classroom, two enrollments, three assignments, two tests and
three blueprints; the planned-course seed idempotency check passed. Billing stays
disabled with provider mode `test`. Production was not changed.

The earlier metadata-repair proposal is **superseded and must not be executed**.
Do not run the historical reconciliation helper's apply mode or reapply 214.
Its fail-closed precondition no longer matches the reset database. The old
migration numbers below are historical application evidence, not current state.

The verified pre-reset backup and reset/contract logs are held privately under
`~/.codex/backups/pika-local-reset-217.efCeer/`; no backup contents or credentials
belong in Git. The earlier pre-resequence backup is retained separately.

Owner-precedence and all four billing rollback database contracts pass after
replay. The coordinator independently verified current migration names, local
counts and the disabled gate; generated database types match and warning-level
lint reports no issues. All 285 billing tests and 248 focused checks passed on
the reviewed billing source. Eight independent-review launches are complete
with no remaining source blockers.

The owner approved a fifth, documentation-only correction batch to synchronize
new main history, preserve archived entries, record reset/reseed completion, and
run required CI. No additional reviewer, database mutation or merge is included.
Billing source and migration SQL must remain unchanged during this sync. Required
CI on the final synchronized commit remains the next gate; billing activation
and the later lifecycle phases remain unfinished.

## Scope and boundaries

This first slice proves initial paid assignment and renewal against an immutable,
previously bound offering in an isolated local database using Stripe test mode.
It does not enable live billing. No live prices or usable AI allowances are established.
The existing classroom authorization boundary remains authoritative.

The server must reject hosted database targets, live Stripe credentials/events,
and production hosting. A separate database sandbox gate starts disabled. The
shared development environment is not sufficient evidence of target isolation.

Purchased offering terms remain immutable. Catalog availability controls new
purchases only; reconciliation uses the stored version, including archived
offerings. An unexpected price or subscription change becomes an exception.
Pending or failed payments preserve the previous effective assignment. Paid
period timestamps are evidence, not approval for automatic expiry or downgrades.

Checkout, quotes and prorated upgrades, customer portal, automatic cancellation,
grace periods, refunds/disputes and subscriber migrations require later slices
and the unresolved decisions in the policy. No scheduler is enabled here.

## Execution plan

The current task owns this branch and integration. Workers own separate files;
only the coordinator commits and publishes. Risk profile: `runtime-platform`
with financial, authorization and schema correctness requiring independent review.
Model recommendation: GPT-6 Astra for architecture and coordination; GPT-5.6
Terra for bounded implementation; independent security and compatibility review
before readiness.

1. **Design:** identify version, identity, payment and environment boundaries.
   Exit: contracts preserve purchased terms and never trust browser claims or
   event delivery order as payment authority. Architecture review completed.
2. **Implement:** immutable catalog and trusted bindings; durable verified inbox;
   leased current-state synchronization; atomic version-aware plan assignment;
   bounded reconciliation. Exit: tests cover duplicate/conflicting events,
   stale workers, failed payments, version preservation and target isolation.
3. **Verify:** review exact migration before requesting local application;
   regenerate database types, run database contracts and focused checks.
   Exit: actual results recorded, with no live enablement or hosted mutations.
4. **Review:** draft PR, fixed-commit security and architecture review, batched
   remediation and stable-head CI. Exit: reviewable PR with rollout limitations.

## Current verification and next action

The coordinator and workers completed the isolated configuration, minimized
webhook intake, Stripe read adapter, synchronization/reconciliation, RPC adapter
and HTTP handler boundaries. The official Stripe SDK is pinned to `22.6.2` and
API version `2026-08-26.dahlia`. `/api/billing/stripe/webhook` accepts signed
events; `/api/billing/stripe/process` requires the separate worker secret and
processes at most one subscription per request. Both return unavailable while
the sandbox flag is off. No scheduler invokes them.

The owner approved the Stripe dependency and initial local migration209, then
explicitly approved consolidating the unreleased recovery changes into209 and
resetting/reseeding local on 2026-09-26. Migration210 was removed. All migrations
through209 replayed successfully, local fixtures were reseeded, and regenerated
database types match. Billing, account-plan and pre-activation classroom-creation
rollback harnesses pass. The private billing sandbox gate remains off.

Billing contracts cover preserved/new offering versions, repeated/conflicting
events, lease expiry, missing revision fences, atomic rollback, exact purchased
payment terms, bounded retry exhaustion, fair queue selection, early event
adoption and audited recovery. The final bind/webhook race correction serializes
both identity lookups with the same transaction lock and retains binding-before-
inbox row locking. Its real concurrent regression runs only in CI's disposable
database. The reseeded local database initially predated this function-body correction;
owner-approved migration211 has now restored both canonical definitions. Unit tests use simulated Stripe reads and real SDK
signature verification; they do not establish a real Stripe payment result.
Final integration review identified this concurrency correction; the owner
approved one additional correction and targeted review. That review and
stable-head CI passed before PR #1366 merged; this does not establish a real
Stripe payment rehearsal or update the existing local database.

Application of the schema does not activate the private sandbox gate. Database
rollback tests enable it only inside a transaction that rolls back. The CI-only
concurrency test commits disposable fixtures and restores the disabled gate
before CI destroys that database. A real test-mode
rehearsal still needs credentials and an explicitly isolated local runtime.

## Operational prerequisites

- Stripe's official Node dependency and consolidated local migration209 reset
  and reseed were approved and completed. That authorization is consumed. Further schema
  applications follow the [schema checklist](schema-rollout-checklist.md).
- Stripe test credentials and a local signing secret are not currently configured
  in the shared environment. Never commit them or copy hosted credentials into
  fixture data. Unit fixtures do not establish a real Stripe round-trip result.
- A successful test-mode rehearsal does not authorize production billing.

## Reference contracts

Implementation follows Stripe's [webhook delivery contract](https://docs.stripe.com/webhooks)
and [subscription events](https://docs.stripe.com/billing/subscriptions/webhooks).
Verify signatures over original bytes, durably accept before acknowledging,
and reconcile current provider state because delivery can repeat or arrive out
of order. Workers must fetch after obtaining a subscription lease and commit
only while its fencing token remains current.

## Supported payment evidence and recovery

This slice accepts only an initial or renewal invoice for one recurring item,
with its product, price, amount, currency and period matching the purchased
version. Invoice subtotal, total, amount due, amount paid and captured card
payment must match the stored unit amount. Discounts, customer balances,
credits, credit notes, taxes, extra lines and manual or prorated invoices require
later policy and are recorded as `financial_terms_unapproved` where applicable.

Migration209 selects due subscriptions globally after deduplication and skips
active leases. Only provider unavailability retries automatically: attempts 1–4
wait 1, 2, 4 and 8 minutes; the fifth failure becomes durable `attention`.
Other exceptions become attention immediately. Neither path changes paid access.
A new verified event for the exact bound customer/subscription schedules a fresh
read; duplicate delivery cannot reset retries. Provider event creation and local
receipt timestamps are separate from the first application of consolidated209.

After correcting an incident, a service operator can invoke the sandbox-gated
`billing_requeue_subscription_v1` RPC with `subscription_id`, `actor_ref` and
`reason_code`. It audits the request, resets retry state and schedules work; it
refuses to take an active worker lease. No browser or admin UI exposes this RPC.
Migration228 extends that same operator procedure to a held renewal closeout:
it preserves the invoice and mutation stage, checks the original plan/access/
entitlement fences, and resets the bounded retry budget. Changed assignment facts
remain a conflict. Ordinary work selection excludes active closeouts before its
limit so one held account cannot starve another account's paid reconciliation.

Consolidated migration209 must precede activation of this application revision: worker
bindings now require the immutable product and amount supplied by its RPCs.
Without its final schema, decoding fails closed and no paid access is granted. Keep both
application and database sandbox gates disabled during this rollout.

## Approved launch execution — coordinator plan (2026-09-26)

The owner authorized merging the approved policy and orchestrating implementation
through Stripe test-mode verification. Canonical terms are SUB-01–15 in the
subscription policy, including the final Basic/Pro/Max names. This is not live
billing or production deployment authorization. New migration application still
requires the exact target-and-migration approval in the schema checklist.

| Phase | Deliverable and exit evidence | State |
| --- | --- | --- |
| 0 | Land admin, Stripe foundation and policy dependency chain with required PR Gate on each final SHA | Complete: #1360, #1366 and #1367 merged |
| 1 | Exact 12-variant USD/CAD catalog; authenticated, durable hosted checkout; idempotent creation/recovery; verified payment grants selected version | Merged #1368; local sandbox first-purchase rehearsal passed; customer return UI pending |
| 2 | Once-only 30-day Pro trial and paid conversion; exact paid/trial expiry and seven-day renewal grace; safe resubscription | Lifecycle #1377 and renewal closeout #1429 merged; local228 applied and rollback contracts passed |
| 3 | Prorated upgrades, renewal-scheduled changes, classroom selection/activity fallback archive, publishing/test cutoff and preserved existing-work access | Plan-change architecture in progress; classroom/access integration remains pending |
| 4 | Billing UI, self-service portal, expiry/failure notifications and missed-schedule recovery; role/theme/viewport visual verification | Pending backend contracts |
| 5 | Full provider test-mode lifecycle rehearsal, concurrency/retry evidence, AI cost validation and tax setup review | First-purchase rehearsal completed; full lifecycle blocked by phases 2–4 and remaining policy contracts |

Current execution (2026-10-02): lifecycle PR #1377 merged as `261ee0b1` and
closeout PR #1429 as `25cc0691`. Its reviewed head `fe228354` passed all five CI
jobs, including 9,167 tests. Local228 remains applied; billing is disabled.
The coordinator owns `codex/subscription-plan-changes`, based on that main SHA,
for authoritative upgrade quotes and approved renewal-scheduled transitions.
Classroom-copy PR1431 merged493e752a, preserving applied229. The billing
branch is rebased onto that main; migration230 remains byte-identical.

Current ownership: three bounded workers completed the provider quote, frozen
invoice, API/runtime and additive schema implementations. The coordinator owns
integration, verification, documentation and the PR lifecycle. Workers did not
apply migrations, mutate Stripe, send email, merge or recursively delegate.
Existing closeout review extensions and application permissions are consumed.
The amount-confirmation design below implements SUB-04; deployment and payment
activation remain separate gates.

### Phase 3: first prorated upgrade candidate (2026-10-02)

Initial independent review begins2026-10-02T18:40:20Z: two complementary
reviewers, maximum seven launches, four fix batches and60minutes elapsed.
Security/financial review uses GPT-5.6 Sol/high; compatibility uses GPT-6.1
Sol/high because the preferred Terra model is unavailable. This review begins
with the concrete preapplication candidate; no database application is included.
Both initial reviewers completed a2e2d730 and its231 upgrade tests. Batch1 fixes
interrupted payment-request recovery and expiry cleanup at the paid boundary,
with coordinator/provider regressions and an ordinary-claim release SQL fixture.
Targeted financial review of ef8c4ece cleared payment replay but found partial
draft fixtures using completed totals. Batch2 validates actual draft subset
totals/no payments, completes exact lines, then enforces final frozen totals.
An integrated coordinator/provider regression covers the boundary. All576
billing tests pass. Targeted follow-up cleared c962f622 with73 coordinator/provider
tests. Four launches and two fix batches are used; final cumulative PR review
remains after database/types verification. Migration230 is byte-identical to the
initially reviewed source. The owner approved one local230 application on
2026-10-02, conditional on classroom229 PR1431 merging and a dry run containing
only230. The owner permission was consumed by one successful local230 push after
1431 merged. Local Pika/54322 history001–230 matches; generated types/check and
focused TypeScript/lint/architecture gates pass. Four existing database harnesses
passed after230; security advisor reports no issues. Data counts are unchanged
and sandbox OFF. The owner approved the two-line CASE assertion correction and
a20-minute extension starting2026-10-03T00:15:11Z (deadline00:35:11Z). The
corrected new upgrade database harness passes and rolls back its fixtures. Four
reviewer launches, two financial fix batches, one main sync and this fixture
correction are recorded; one final integration reviewer is authorized.

`codex/subscription-plan-changes` implements a dormant backend slice backed by
additive migration230 (`230_subscription_prorated_upgrades.sql`). It was
applied locally once after the owner-authorized230-only preview. The existing
shared database is retained without reset/reseed. Types are generated from its
matching migration schema. The corrected upgrade rollback harness passes; final
independent review, draft publication and stable-SHA CI remain pending.

- Require the existing loopback test sandbox, checkout configuration and separate
  `BILLING_UPGRADES_ENABLED=true` gate. No configuration is enabled by this PR.
  Teacher-only quote/confirmation/status APIs use the authenticated permanent
  account ID, trusted origin, bounded JSON and private, uncached responses.
- Resolve an available target offering server-side. Same-interval, same-currency
  higher-tier upgrades retain the original paid term and renewal date. A
  captured full-cycle payment for the current purchased version must anchor the
  operation. Currency changes, interval changes, unpaid renewals and canceled
  subscriptions cannot create unused-time credit through this path.
- Stripe previews the two signed proration lines at a fixed second. Persist a
  dedicated draft invoice identity before populating those exact provider amounts.
  Exclude unrelated pending items and keep `auto_advance=false`, including during
  finalization. The quote shown for confirmation is the verified final invoice;
  no invoice URL or automatic payment is exposed. Unsupported balances, taxes,
  discounts, credits or extra lines fail closed instead of being approximated.
- Quotes expire after 15 minutes, bounded by the original paid-through timestamp.
  Confirmation binds the operation, quote revision and canonical SHA-256 digest;
  changed payable facts cannot authorize payment. One unfinished operation per
  subscription serializes confirmation and recovery. Zero-due rounding is held
  for explicit payment-proof support, not treated as a paid upgrade.
- Persist intent before paying the exact invoice, verify a captured card payment,
  then change the exact subscription item with no additional proration and an
  unchanged anchor. Grant the immutable target version only after verifying both
  payment and provider item state; preserve the original period and usage boundary.
  A pending/failed payment keeps the existing paid plan. The ordinary renewal
  verifier remains strict; an applied upgrade receipt is observed separately and
  must never extend paid-through as if it were a renewal.
- Every write rechecks the existing binding lease, operation, plan, access and
  entitlement revisions immediately before the provider call. Durable stages and
  stable keys recover lost responses; five transport failures hold attention.
  Awaiting confirmation or payment does not consume that error budget. An unknown
  invoice-creation response can reuse its original key only within 23 hours of
  the quote and before the original term ends, never with a fresh key afterward.
  Known expired, definitively unpaid invoices are verified independently of the
  subscription period, completed with exact frozen lines if necessary, finalized
  without collection and voided even after renewal. Missing line writes retain
  their23-hour key window. Pending or captured money is held for attention.
  Unresolved payment requests replay the same key under fresh fences while the
  quote remains valid; definite card declines hold attention without another
  payment attempt.

This candidate is not a complete launch implementation. Repeated upgrades within
one paid term still need verified receipt-chain support; the current reserve gate
rejects them without creating an operation or charging. This is an implementation
limitation, not a one-upgrade-per-period product policy. Scheduled downgrade grace
version/capacity is awaiting an owner decision; scheduled changes and classroom
archive/access integration remain pending. Cancellation observation after an
upgrade, payment recovery UX, audited attention recovery, tax support and provider
rehearsal also need launch evidence. A payment captured before an unfulfillable
term/override race stays an actionable exception; compensation is not invented.
No migration, production change, live charge, email or activation is authorized
by this candidate or its tests.

The following first-lifecycle review evidence is historical; #1377 subsequently
passed required CI and merged. Its earlier application permissions are consumed.

Phase 2 exit requires an integrated runtime, not an unused calculator: lifetime
trial idempotency, verified paid conversion/renewal, exact known cancellation and
grace cutoffs, effective access at request time with a late worker, immutable
purchased terms, revision fences and payment/expiry race evidence. Unknown renewal
outcome is a synchronization-pending state; it must not fabricate cancellation or
grace. Provider outages must not remove recorded facts or suspend a local trial.

The first phase-2 slice is draft PR #1377. Its initial independent review found
two grace-recovery defects: cancellation or an original-invoice replay could
shorten recorded grace, and a first observation of an uncollectible renewal
could miss grace entirely. The remediation preserves the exact recorded cutoff
and failed-invoice identity; only a genuinely later verified paid term clears
grace. Strict unpaid-cycle evidence is evaluated before generic cancellation.
The billing suite passes 285 tests. Migration 214 was approved and applied once
to the existing local database; generated types and all focused checks pass.
Lifecycle and checkout database contracts pass. The older foundation contract
exposed missing invalid-request validation in the new lifecycle entrypoint;
forward migration 215 restores that contract without editing applied 214.
Migration 215 passed targeted security/compatibility review and was separately
approved and applied once locally. Foundation, checkout, lifecycle and validation
rollback database contracts now all pass; generated types match the applied schema.
Local data remains nine users and one classroom, with billing disabled. Final
cumulative review and required CI remain before this slice is ready. This evidence
does not complete phase 2 or authorize activation.

The first CI candidate passed Test & Build and billing database contracts but
failed the warning-free function gate on four unused variables. Under the owner's
bounded review extension, forward migration 216 removed only unused results while
preserving the writes, `FOUND` checks, row locks and permissions. It passed targeted
review, received exact local approval and was applied once. Warning-level database
lint now returns no issues; all four billing database contracts and generated-type
checks pass again. Applied migrations 214 and 215 remain unchanged. The corrected
candidate still requires final review and a passing PR Gate before merge.

Current phase-2 slice: unpaid-renewal financial closeout (SUB-11).
Migration **228_subscription_renewal_closeout.sql** is reserved for this slice:
classroom227 merged in PR #1426 as `a101fb28`; the billing branch is rebased onto
that main commit. Local228 is now applied and generated types match. Never copy
an unrelated migration into this PR or repair the shared migration history.

- Persist one operation for each bound failed invoice, with immutable invoice,
  paid-through and exact168-hour cutoff. Keep mutation stage separate from
  retry/attention state so ambiguous provider writes survive recovery.
- Run after local expiry has applied Free. Reuse the subscription lease and
  binding→plan→access lock order. Validate plan, access and entitlement revisions
  at claim, checkpoint and finish, including manual entitlement-only overrides.
- Always reread complete raw payment evidence. Pause automatic collection, reread,
  void the exact unpaid invoice, verify the void, then cancel without invoicing or
  proration. Persist intent before each action and recheck the lease after the
  adapter's fresh read, immediately before the actual provider request.
- Verified paid renewal wins via the existing lifecycle paid-access writer.
  Pending payment defers. Partial/unsupported payments, unknown later invoices
  and incomplete evidence prevent irreversible actions and require attention.
  Normalized `payments: []` alone never proves no payment is in flight.
  Five deferred attempts escalate to attention while retaining the current binding
  and mutation intent; a process crash alone does not consume this failure budget.
- Stable POST keys are derived from the durable operation. Timeouts are recovered
  by authoritative reads; DELETE cancellation has no idempotency-key guarantee.
- Closeout requires a voided target, canceled subscription and complete absence
  of outstanding obligations before the existing lifecycle writer retires the
  binding. Historical purchased terms/invoice effects remain intact; existing
  checkout eligibility then permits resubscription.
- Database fences cannot make a Stripe write atomic with a later manual override.
  Fresh local/provider checks, void-before-cancel and conservative attention states
  limit this cross-system race; real provider rehearsal remains required.
- Launch still requires a scheduler and alert policy. The once-daily hosting
  ceiling and outages prevent a promise of immediate provider closure. Exact
  access cutoffs remain independent of worker timing.

Unresolved launch policy remains explicit: tax/refund/dispute consequences and AI
quantities are not silently invented. Scheduled downgrade grace quotas, operational
defaults and classroom ranking need their own recorded implementation evidence.

Use the existing local database only after approval of the exact reviewed new
migration. No reset/reseed is planned. Current authority covers code, tests and
PR review/publication, not another merge, production rollout, live Stripe writes,
activation or email delivery. Use the current `pr-review` skill's bounded budget;
previous PR extensions are consumed and do not expand this review session.

Preapplication review started2026-10-02T12:16:19Z. Four of seven reviewer
launches were used (one capacity failure; two initial reviews and one targeted
review). Batch1 resolved ordinary queue starvation, operator attention recovery
and a rollback fixture that called the protected public plan setter. The setter
remains protected. Targeted review of source `8ebecac6` found no actionable blockers.
334 billing tests passed before application; all195 focused tests and the full
focused static gate pass after application/type generation. The owner approved
one application of **228_subscription_renewal_closeout.sql to the existing local
database after227 merges** on2026-10-02. That permission is consumed: matching
history and a preview containing only228 preceded one successful local push.
Approved SQL SHA256:
`7aba5de53766e5988284ae3f446c495954f171fadf83c64cc5bd053a25078f5a`.
Installed history is001–228; actual generated types/check pass. Foundation,
checkout and subscription lifecycle rollback checks pass; warning-level schema
lint and security advisor report no issues. The initial closeout harness failed
because its synthetic offering lacked `features.catalog_key`; the approved
fixture batch adds that metadata and verifies the selected offering identity.
The full rerun then exposed an ambiguous PL/pgSQL CASE expression in the retry
assertion; parentheses resolve it in the same batch. The complete closeout
harness now passes, including terminal/resubscription, late payment, durable
retry escalation, queue fairness and audited attention recovery. All fixtures rolled back;
users/classrooms/bindings counts and row digests match before/after, no closeout
operations remain, and sandbox remainsOFF. No real Stripe rehearsal occurred.
The owner approved a30-minute extension at14:17:44UTC, ending14:47:44UTC, for one
fixture correction batch, database rerun and one final integration reviewer.
The fixture batch and final integration review completed: five reviewer launches
and two correction batches. Final reviewed source `25f12dfd` passed all five CI
gates in run37019461972, including the browser matrix and concurrent Stripe
binding/webhook regression. PR #1429 then required synchronization with newer
main `a6c23954`; local merge preview was clean although GitHub reported conflicts.
The owner approved one main sync, one20-minute targeted review, fresh stable-SHA
CI and merge on green at16:52:17UTC (review deadline17:12:17UTC). The rebase is
clean; billing source, fixtures, generated types and installed228 remain
byte-identical. This is the third correction/sync batch; one sixth reviewer
launch is authorized. Required local checks, targeted sync review and fresh CI
precede the authorized merge. No new migration application or activation is
authorized. Real provider lifecycle rehearsal and launch scheduler/alert policy
remain later acceptance gates.

Targeted sync review cleared `87007a8e`; freshCI37037586582 found one
documentation failure among9174tests (9166passed/7skipped). Compact CURRENT
omitted the four characters in the required `Prod DB 001–` production-history
prefix. PR1429 returned to draft; restoring the prefix preserves the same
verified production/local histories and the startup-size budget. The focused
47 current-history/startup tests pass. This is correction batch4; billing code,
types and228 remain unchanged. The one approved sync reviewer is consumed, so
the corrected candidate needs authorization for one brief independent review
before fresh CI. Existing merge-on-green approval remains valid. The obsolete
failed-source CI run was canceled; no gate is bypassed.

The following paragraphs retain the historical phase-1 rollout evidence; their
pending statements describe that earlier slice, not current phase-2 completion.

The owner approved an additional45-minute review window and local211 application
after review. Two preapplication reviews are complete with no blockers; the
second covered the additive compatibility repair. The owner subsequently approved a sixth and final review launch. Full implementation review found one eligibility blocker, corrected in212. The owner approved one final integration review (launch6, up to20minutes) after local212 verification.

Phase 1 currently includes the exact public catalog, test-only price provisioning
with existing trusted products, authenticated catalog/start/status endpoints,
durable checkout reservation and provider recovery, and worker integration.
Checkout completion binds the purchased version; only the existing verified
payment reconciler may grant paid access. Both checkout and sandbox gates remain
disabled by default. No checkout UI or provider configuration has been performed.

Migration211 passed independent preapplication review and was applied once to
the existing local database under the owner's exact authorization. Gradebook migration210
has now merged in main and this branch is rebased onto it, so the shared database
is the current verification target; no separate database, reset or seed is needed.
Read-only inspection confirmed that its applied209 predates the two final
binding/webhook identity-lock fixes. Migration211 carries forward the canonical
209 function definitions using CREATE OR REPLACE, leaving209 immutable and
preserving existing data. Both definitions passed independent review before
application. That local211 application authorization is now consumed.

Billing and checkout rollback contracts pass against applied211. Database types
were regenerated from the actual schema. Focused checks pass207 tests plus
TypeScript, lint and architecture/UI/design policy checks. The security advisor reports no issues;
the three users and one classroom are preserved, and the billing sandbox remains
disabled. The updated194 billing-focused tests pass. Focused checks and full
independent implementation review precede final PR CI. Keep the PR draft until
all exit evidence passes. No real Stripe checkout or payment has been performed.

Full implementation review identified a blocking first-purchase eligibility gap:
legacy paid accounts could reserve a new checkout. Follow-up migration212
restricts new reservations to Free/legacy accounts and rechecks the reserved
plan revision before checkout provider work, binding and first-payment
reconciliation. Drift becomes attention instead of overwriting an existing
assignment; foundation bindings outside checkout keep their existing behavior.
The application maps an ineligible first purchase to a safe409 response.
Migrations211 and212 are applied locally and immutable. The owner explicitly
approved212 after its targeted review passed; that one-time authorization is
consumed. Expanded checkout and foundation database contracts pass, including
legacy-plan rejection and asynchronous plan-change cases. Corrected a SQL test
to capture the mutation result before inspecting its saved state. Regenerated
types include the reserved revision column. Keep both billing gates off through
final integration review and CI; live launch remains separately controlled. A previously issued hosted session may still be
paid after an operator changes a plan; access remains protected, while provider
cancellation/refund handling is part of the separate lifecycle phase.

A separate nonblocking launch follow-up remains: public active status should
match effective entitlement state after operator overrides. Address that with
the lifecycle/status integration before exposing the customer billing screen.

First checkout slice keeps taxes, discounts, upgrades, trials and subscription
restarts unavailable until their separate contracts are implemented. Catalog AI
quantities remain provisional metadata and do not grant usage. The existing
foundation's paid grant does not yet implement expiry; therefore partial checkout
implementation must not be treated as launch-ready. Subscription archiving needs
explicit completion and retention protections, not the ordinary archive action.

External prerequisites: locally configured Stripe test credentials/account/signing
secret, an isolated runtime, and reviewed authorization for exact schema changes.
Never paste keys into task messages or commit them. Missing prerequisites prevent
a real provider rehearsal, not the authorized code and fixture implementation.
