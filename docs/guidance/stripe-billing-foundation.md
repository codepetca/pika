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
| 3 | Prorated upgrades, renewal-scheduled changes, classroom selection/activity fallback archive, publishing/test cutoff and preserved existing-work access | First prorated-upgrade backend #1435 merged; scheduling and classroom/access integration remain pending |
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

### Phase 3: first prorated upgrade review history (2026-10-02)

The dormant first-upgrade backend uses migrations230 and231. Both were applied
locally once, with existing records retained; production remains through225.
Migration230 is immutable. Forward231 resolves revision conflicts under the
existing lock order: safe operations before invoice intent expire, while unknown
invoice/payment outcomes become audited attention. The worker discovers conflicts
and retired bindings; stale claims and altered expected revisions cannot quarantine
valid ownership. Ordinary requeue cannot erase financial recovery or adopt override
revisions. Attention resolution/compensation remain launch gates.

The initial complementary security and compatibility reviews found two financial
corrections: interrupted payment-intent recovery/expiry cleanup, then actual partial
draft evidence before completion/void. The final integration reviewer found the
revision-conflict queue blocker, corrected by231. Targeted GPT-5.6 Sol/high review
cleared exact4209da62 with246upgrade/API tests and no verified blockers. Main66fa5de3
integration preserved all billing source and230 bytes. Six reviewer launches and
five composite correction/sync batches preceded the final fixture batch.

Local acceptance:521focused tests plus architecture, UI/design policy, TypeScript
and lint; four existing billing database harnesses pass after231. Types matched
this branch at001–231 and the security advisor found no issues. The announcement
coordinator subsequently applied232; shared local history is001–232 and expected
branch/history drift must not trigger reset/repair or unrelated232 source adoption.
Required CI must replay the exact billing branch and verify its generated types.

The expanded upgrade rollback harness now passes on the shared local database.
Its fixture-only repair normalizes synthetic Stripe IDs, leases the earlier valid
queue case through the real RPC before a conflict-only drain, and removes a loop/
SQL-alias collision. Application code, installed230/231 and generated types remain
unchanged from reviewed4209da62. All fixture data rolls back; persistent user/
classroom/upgrade/receipt counts are3/1/0/0 and sandboxfalse. The DB writer slot is
released after proof.

On2026-10-03 the human directly overrode approval checkpoints for corrections and
main merges in this billing task. Required independent review and stable-head CI
remain gates. The fixture batch is composite batch6, followed by one mechanical
independent review (launch7); no additional initial or final full-diff wave is
needed. Draft PR1435 remains pending that review and exact-head CI. Billing stays
OFF; the first-upgrade slice does not complete phase3 scheduling or launch.

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

### Phase 3 continuation — 2026-10-08

PR1435 merged as `efe4eb3fcbb88cd2b24d53122a77ed1f70b85cc8` on October 3,
after all exact-head CI37112129981 gates passed at reviewed `0de5d0ea`.
The candidate, migration and local-database descriptions above are dated review
history, not current environment claims. Continuation starts from main
`e24d591abb53713e01d75a5c95fc418cf57592eb`; billing remains disabled.

The next bounded correction observes cancellation after an applied upgrade.
The ordinary verifier correctly refuses to treat its manual proration invoice
as a full-cycle renewal. Its existing receipt fallback rejects cancellation,
so it cannot deliver the verified cutoff to the existing cancellation writer.
A separate read-only observation must verify the captured upgrade payment,
exact target item and original paid term, then use the existing fenced
`canceled` completion with null invoice/period fields. Strict upgrade mutation
schemas remain unchanged. No new migration or provider mutation is needed.
Undo-cancellation after upgrade and later renewal/receipt chaining remain
separate acceptance gates; an `observed` completion does not clear the access
row's cancellation reason.

Scheduled execution cannot be implemented by merely accepting a changed Stripe
price. The existing binding represents both the billed version and effective
access version; both ordinary verifiers reject unapproved schedules and changed
prices. The future contract must record the confirmed target separately from
the version whose paid capabilities are currently in effect, with one pending
change, atomic replacement and verified boundary/payment recovery.

The owner question about failed renewal at a scheduled downgrade is pending.
Neither option below is approved by this continuation:

| Option | During the exact seven-day failed-payment grace | Capacity/archive transition |
| --- | --- | --- |
| Retain the previously paid offering (recommended) | Keep source-version capabilities; the target price remains the renewal billing target | Apply target capacity after verified target payment; unpaid grace ends with Free restrictions |
| Apply the lower offering at renewal | Use target-version capabilities while its renewal invoice is unpaid | Apply target capacity at the renewal timestamp, including classroom selection/archive protections |

Acceptance must distinguish target invoice/price verification from source access,
cover payment recovery before/at/after the 168-hour cutoff, missed and repeated
events, and an in-flight upgrade/cancellation/replacement. Do not infer an
answer from silence, a provider default or a fixture. Deterministic classroom
activity ranking and archive/access integration remain separate unresolved
implementation prerequisites.

The [fixture and provider rehearsal plan](billing-test-rehearsal.md) separates
implemented paths from pending ones and preserves shared execution, exact-target
migration and activation gates.

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

## Customer billing and recovery checkpoint — 2026-11-08

The teacher billing page uses the authenticated Pika account and the existing
local sandbox. It displays stored purchased terms, starts the cardless Pro
trial, opens versioned checkout, recovers an unfinished checkout, and shows
payment and plan activation only after server verification. An optional Stripe
portal configuration supports invoices and payment methods. It must disable
subscription changes and cancellation. The separate upgrade gate enables the
existing same-currency, same-interval confirmed quote. The page displays
Toronto timestamps and uses legacy `plus` and `pro` only at the internal boundary.

Migration 302 handles a verified end-of-term cancellation being undone after
an applied prorated upgrade. It keeps the original invoice, offering and
cutoff. It also schedules a read of a verified pending renewal every 15
minutes through 73 hours after the paid term. While the invoice is pending, the
last verified access end remains authoritative. A later verified capture can
settle without a fresh webhook. Migration 303 projects eligible customer
actions and immutable purchased terms without sending Stripe identifiers to
the browser. Its extra fields are opt-in; an earlier schema can still return
plan status, while the new page hides unsupported actions.

### Dormant live target attestation

Migration 311 adds an optional private live Stripe account and Supabase project
identity. The settings row cannot contain that pair while the sandbox is
enabled. The service-role RPC returns one boolean for the exact pair on a
database free of sandbox billing evidence. It can attest a target that already
contains legacy account plans. The settings row starts with both live fields
unset. The isolated sandbox can still run against its own loopback database.

The operator command is `pnpm exec tsx scripts/check-billing-live-target.ts`.
It uses environment variables already supplied by the operator, including
`BILLING_LIVE_TARGET_CHECK_ENABLED=true` and `STRIPE_LIVE_ACCOUNT_ID`. It requires
`VERCEL=1`, `VERCEL_ENV=production`, the canonical HTTPS
`NEXT_PUBLIC_APP_URL`, and the exact production `NEXT_PUBLIC_SUPABASE_URL`.
The existing Supabase service credential is read only after
the target passes these checks. The transport permits one read-only RPC and
rejects redirects. Output is limited to the attestation status. It needs no
Stripe API key, webhook secret, or worker token.

A successful attestation verifies the dormant database target at the time of
the read. Operational billing requires separate scoped provider evidence,
database writer gates, and rollout authorization. Use
`scripts/check-billing-live-target.sql` for the rollback-only proof on an owned
disposable replay through 311.

### Live Pro trial source

Migration 313 binds live trial admission, status and expiry to the exact
production target. The application lifecycle and admission flags default off
and the database repeats both checks. Stopping admission keeps existing trial
status and expiry available. The Billing page shows the plan and cardless trial
without needing a purchase catalog. The trial worker uses a dedicated bearer
at `POST /api/billing/trial/process`. It processes expiry and due assignment
releases and then attempts the separate RepoLight provisioning outbox.

The teacher view reuses the existing Billing cards and shared action. The
browser proof covers eligibility, keyboard start, the five-classroom trial and
expired status on desktop and mobile in both themes. The page remains
teacher-only. The sealed 313 database proof separately checks the exact cutoff,
RepoLight eligibility and retained learner work. The rollout still needs an
authorized worker caller and resolution of existing future assignments for
eligible teachers. The runtime declines admission while those assignments exist.

### Live Pro and Max source verification

Migrations 314–316 establish the pinned live receipt intake, catalog and checkout
binding. A binding records the customer, session and subscription for one
teacher. The next reconciliation lease uses fresh Stripe evidence to record the
paid invoice and grant its exact term. New checkout can be paused while an
existing session finishes.

The isolated 317–319 replay verifies first payment, trial conversion, renewal
deferral, failed renewal and recovery, cancellation and retirement. It checks
RepoLight access for verified Pro and Max and denial at the exact Max cutoff.
The paid expiry worker can apply Free after financial retirement without
creating another payment effect.

Before opening checkout, verify production customer and worker routing, the
live catalog, tax settings, refund and dispute handling, worker cadence and
notices on the authorized rollout path.

### Live customer and worker routing

The live billing routes use the pinned project and Stripe account. The owner
status and checkout-recovery routes remain available when new checkout is
paused. New checkout requires signed webhook configuration, a separate paid
worker credential, a verified live cancellation portal, and database permission
for admission, provider writes and renewal closeout. Existing legacy future
assignments hold new checkout until the teacher resolves those schedules. The
database fences new legacy releases and classroom transfers during a live
checkout or live paid ownership. The durable assignment schedule continues to
use the existing draft flow.

The paid worker accepts authenticated `POST /api/billing/stripe/live/process`.
Use a credential distinct from trial recovery, webhook signing and the Stripe
API key. It processes checkout recovery, verified invoices, paid expiry, unpaid
closeout, assignment release and RepoLight provisioning. At the end of
grace, the closeout lease excludes a competing reconciliation claim. If fresh
Stripe evidence confirms payment, the worker applies the verified renewal.
Otherwise it pauses collection, verifies the invoice can be voided, then
confirms there are no outstanding customer invoices before cancellation.

The separate live portal configuration enables invoice history, payment
methods and period-end cancellation without proration. Verify the portal's
cancel and undo behavior with the production configuration before offering it
to customers. Checkout, portal and both worker routes can be tested with
fixtures before configuring credentials. Before production admission, verify
successful signed webhook receipts, recurring authenticated worker runs and
alerts for failed or delayed work on the pinned target.

### Exclusive Stripe Tax for live billing

Migration 326 records `stripe_exclusive` on an immutable live offering
version. The Checkout attempt, subscription binding and scheduled change
carry that mode through recovery. The pre-tax catalog amount stays fixed.
Stripe-hosted Checkout collects and saves a billing address and verifies
the tax breakdown. The portal for new taxed Checkout must allow address
updates only, along with the existing invoice, payment method and
period-end cancellation controls.

With `BILLING_LIVE_STRIPE_TAX_ADMISSION_ENABLED=true`, new live Checkout selects
taxed offerings. Pika verifies the pinned Stripe account, active Tax settings,
Canadian standard registration, and the portal policy before showing the
catalog. Keep the flag false until the reviewed provider and database
configuration is ready. Existing attempts and subscriptions continue to use
their saved tax mode during an admission pause. New scheduled Pro quotes use
the teacher's current paid Max binding and matching tax mode.

Pika verifies the exact pre-tax line, exclusive tax entries at both line and
invoice level, and gross amount due. A paid effect requires one bound captured
card payment for that gross amount. A draft awaiting tax can defer renewal
verification. Collection pause, void and cancellation verify the same gross
obligation, and a verified payment can still win the closeout race. The
calculated tax amount never changes the plan's classroom limit or RepoLight
entitlement. [Stripe Checkout Tax](https://docs.stripe.com/tax/checkout/page)
[Stripe invoice evidence](https://docs.stripe.com/api/invoices/object)

Use the reviewed catalog provisioner to preview the exact products, Prices
and inactive offering versions. The command requires a reviewed hosted
software tax code already configured on both Stripe products. The tax
variant has separate provider Price identities and starts unavailable.

```sh
pnpm exec tsx scripts/provision-live-tax-catalog.ts --dry-run \
  --tax-mode stripe_exclusive --account <stripe-account> \
  --pro-product <pro-product> --max-product <max-product> \
  --version-base <unused-version-base> --reviewed-tax-code <approved-code>
```

Preview the migration and verify the proposed version range against the
pinned database. The catalog dry run reads Stripe and validates the offer
plan. An authorized apply registers versions unavailable so they can be
reviewed before publication. An interrupted apply can leave provider prices
or unavailable database rows. Replay uses the same pinned terms and keys.

Verify a taxable sandbox checkout, both live-style renewal outcomes, scheduled
change and undo, and refund accounting before production activation. Compare
the Stripe invoice's base, tax and captured gross against the Pika receipt
and retained purchased version. Check that the Stripe Tax settings and
Canadian test registration are active on the intended sandbox before starting
the rehearsal. [Stripe Tax test guide](https://docs.stripe.com/tax/testing)

### Periodic recovery caller

The private Cloudflare Worker in `workers/billing-recovery` calls the existing
paid and trial POST endpoints every two minutes in UTC. This is the initial
canary cadence. Pika's database still owns the exact access cutoff, work
leases, retries and Stripe idempotency. The two calls run independently.
Each tick makes one attempt per enabled lane. It records a failed invocation
on transport or HTTP failure, invalid receipts, or an application receipt
that reports failures, exceptions or attention. The Worker requests redirects
in manual mode and treats redirect responses as failures. Structured logs
use a fixed allowlist of lane, scheduled time, delay, outcome and numeric
counts.

Both caller switches are false in the checked-in configuration. Worker and
Preview URLs are disabled. For local verification, package with Wrangler
`deploy --dry-run` and run `dev --local --test-scheduled` with both switches off.
The scheduler test passes synthetic bearer credentials through the actual
Pika POST handlers with synthetic configuration and downstream financial work. GitHub
CI also runs the 322–325 rollback fixtures after replaying the schema.
[Cloudflare scheduled handler](https://developers.cloudflare.com/workers/runtime-apis/handlers/scheduled/)
[Cloudflare request redirect behavior](https://developers.cloudflare.com/workers/runtime-apis/request/)

For an authorized deployment, pin the approved Cloudflare account and Worker
name. Generate separate bearer tokens for `BILLING_LIVE_PAYMENT_WORKER_SECRET`
and `BILLING_LIVE_TRIAL_WORKER_SECRET` using 32 to 256 base64url characters each.
Set the matching value for each lane in Cloudflare and Pika using their
protected secret inputs. Cloudflare's secret command deploys a Worker
version, so stage credentials while the caller switches are off. After the
matching Pika schema and endpoint are verified, enable the corresponding
caller variable, `BILLING_PAID_RECOVERY_ENABLED` or
`BILLING_TRIAL_RECOVERY_ENABLED`, through the reviewed Worker configuration
with customer admission still closed. Cron configuration changes can take
up to 15 minutes to propagate.
[Cloudflare secrets](https://developers.cloudflare.com/workers/configuration/secrets/)
[Cloudflare Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/)

Verify at least five distinct consecutive scheduled times with a successful
receipt for each enabled lane. Check the observed delay and oldest due work
before admitting customers. Alert on a failed Worker invocation, a lane's
`needs_attention` receipt, and a missing heartbeat per enabled lane. Verify
the alert receiver and trigger an intentional failure using an isolated
target. Worker receipts describe work attempted on each tick. Check durable
Stripe inbox and checkout, reconciliation, installation, cancellation and
closeout backlogs separately for unmatched receipts, retry exhaustion or
age. Resolve and document those checks before opening paid admission.
[Cloudflare Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/)
[Cloudflare Monitors](https://developers.cloudflare.com/notifications/monitors/)

During an admission pause, keep the appropriate recovery caller running for
existing paid subscriptions and trials. For a caller incident, stop the
affected lane with its own variable and use a scoped operator invocation of
the same POST endpoint while resolving the issue. During rotation, an enabled
lane uses only its own binding. Both lanes reject a shared token when enabled
together.

### Live scheduled Max-to-Pro changes

Migrations 322–323 add target-scoped quote, confirmation, installation and
settlement contracts. The live installation provider verifies the last paid
Max invoice before writing a schedule. A failed Pro cycle records the Pro
invoice while retaining the Max receipt, classroom limit and RepoLight access
through the exact 168-hour grace period. Settlement pairs the original Max
checkout and receipt with the first verified Pro invoice and updates the plan
in the same transaction. The worker requires independent Stripe phase evidence
even when Stripe labels the target invoice as a normal subscription cycle.

Migration 324 gives a due scheduled grace the shared closeout lease. Verified
payment for its exact Pro invoice can still win. Otherwise verified invoice
voiding and terminal Stripe evidence close the schedule and retire the binding
in the same transaction. The database flag `live_scheduled_closeout_enabled`
and worker setting `BILLING_LIVE_SCHEDULED_CLOSEOUT_ENABLED` default off.
Deploy and verify the matching database and worker before enabling either
scheduled admission or Stripe installation writes.

Migration 325 adds teacher cancellation and undo from Plans and billing for an
installed live Max-to-Pro change. Stripe's portal disables cancellation when an
update is pending in a schedule. The authenticated cancellation route saves
intent in Pika. The paid worker verifies and applies it against the pinned Stripe
schedule. The original Max payment, twelve-classroom limit and RepoLight access
continue through the paid term. Undo restores the Pro renewal. Stripe sandbox
testing confirmed that a cancellation ends at the paid cutoff without a Pro
invoice. If a response is lost across renewal, the worker reads Stripe again
without changing the schedule. An exact restored Pro phase returns custody to
normal renewal processing, which independently verifies the invoice and any
payment. Ambiguous changes remain visible for support and the worker can retry
verification without making another Stripe write.

Deploy the matching database and paid worker first. With scheduled admission
closed, verify signed webhook delivery and recurring authenticated worker runs.
Enable the scheduled installation, cancellation and closeout worker lanes before
opening `BILLING_LIVE_SCHEDULED_CHANGES_ENABLED`. Database readiness also requires
ordinary closeout, scheduled closeout, installation admission and writes, and
cancellation admission and writes on the same pinned target. To stop new
scheduled changes, pause scheduled admission and leave recovery running for
existing schedules. Use the separate database provider-write flags when a
provider write must be paused. Verify the customer path and alerts for delayed
or attention work before admitting production customers.

### Release sequence

1. Keep live billing disabled. Finish the source contracts for live/test
   isolation, secure hosted origins, provider account and mode binding on each
   read/write, and separate controls for new checkout, new trials and upgrades
   versus continuing processing for existing customers. RepoLight must consume
   the same authoritative paid/trial state. Preserve the migration 301 legacy
   path, existing report and feedback reads, and the rule-based provider only.
2. Complete renewal-boundary changes and the customer cancellation path.
   Persist the confirmed source and target offering, exact effective date and
   provider schedule identity. Require verified target payment to advance the
   purchased version. The 2026-11-08 owner decision retains the last paid Max
   classroom limit if the scheduled Pro renewal payment fails. Keep target
   invoice proof separate from the offering supplying grace access. Fence replacement,
   cancellation and upgrade against outstanding financial operations. Use
   Stripe schedule phases with no immediate proration for eligible scheduled
   changes. [Stripe schedule contract](https://docs.stripe.com/billing/subscriptions/subscription-schedules)
3. Complete classroom selection and archive behavior, exact publish/test
   admission guards, preserved released work and started attempts, and
   cancellation, failure and expiry notifications. Keep a separate subscription
   restriction state for retained classrooms. The ordinary archive status blocks
   student participation and can make data eligible for compaction or purge.
   Fence Test Start at the shared attempt RPC and preserve Save/Submit for an
   attempt started before cutoff. Record suppressed scheduled assignment releases
   durably so resubscription cannot expose work that missed its release.
   Confirm Ontario tax treatment and verify exclusive Stripe Tax on the opted-in
   catalog. Complete the agreed refund and dispute handling. Publish AI allowance
   quantities after the approved unit-cost and usage tests.
4. Rehearse against a designated isolated Stripe sandbox and disposable Pika
   stack after authorization for synthetic provider writes. Register exact
   approved recurring prices, bind the scoped account and webhook secret, and
   select the explicit test portal configuration with invoices and payment
   updates on and subscription changes off. Use the private billing worker
   endpoint with a synthetic signer and a bounded periodic caller. Confirm
   signed duplicate/out-of-order delivery, an eventless capture, cancellation
   and undo, trial conversion and expiry, grace/closeout races, scheduled
   downgrades, and preserved RepoLight history. Record account/mode and source
   revisions without storing credentials. [Stripe event behavior](https://docs.stripe.com/billing/subscriptions/webhooks)
5. Review the complete final source SHA and obtain the required main CI
   receipts. Preview the exact pending set on the production database target.
   For this slice, schema prerequisites are `302_billing_resume_verified_paid_term.sql`
   and `303_billing_customer_options.sql`, in addition to the verified
   predecessor inventory. Include later launch migrations in that preview.
   Apply only the complete exact set authorized for production in the
   canonical migration workflow, then verify history and ACLs. A source merge
   does not authorize application, provider writes, or a production promotion.
6. For the final dormant production candidate, review immutable catalog prices
   and currency/interval mapping against the approved policy, Stripe tax and
   payment settings, dedicated signing secrets, mode-specific portal and
   webhook configuration, collection/retry settings, and the external worker
   cadence against observed queue latency. Configure and test alerting on
   unmatched receipts, invoice/entitlement drift, retry exhaustion and closeout
   attention. Rehearse stopping new sales while continuing to reconcile existing
   payments. Obtain separate precise authorization for the provider settings,
   protected production promotion and each activation step. Watch payment,
   entitlement and RepoLight decisions on the first authorized cohort before
   expanding admission.

The shared local environment has no configured Stripe sandbox credentials for
this worktree. Provider-port fixtures and database replays are separate from
the actual provider rehearsal. The September 27 receipt is historical first
purchase evidence only.

### Classroom activity fallback

On a verified drop in classroom capacity, consider the owner's current
classrooms that are neither ordinarily archived nor already restricted by a
subscription. A confirmed selection applies to that specific downgrade. A
selection of fewer classrooms than the cap keeps only those eligible selected
classrooms. Free keeps none. Preserve earlier restrictions across renewals and
resubscription until the teacher explicitly restores a classroom within capacity.

When there is no selection, order eligible classrooms by the latest recorded
assignment release, assignment submission, Test attempt start or Test
submission. Use only activity at or before the effective reduction. Sort
classrooms without recorded activity after classrooms with activity, then break
ties by classroom creation time (newest first) and classroom UUID (ascending).
Draft edits, page views and classroom renames do not affect the ranking. For a
scheduled downgrade, the reduction takes effect when Pika verifies the target
payment and commits the smaller entitlement. A failed target invoice leaves
the Max classroom limit and selection unchanged through grace.
An expired trial or a closed paid term still requires explicit classroom
restoration when payment is reconciled before expiry processing. Verified
unpaid payer retirement records the same restrictions when Stripe has already
closed the obligations.

### Scheduled assignment release contract

For classrooms governed by the billing cutoff, keep a scheduled assignment
in its canonical draft state until an authorized worker releases it. Store the
schedule generation, classroom, owner, due time and result separately. Owner
views need to show that schedule, and draft cleanup must preserve its work.
Student reads and submissions can continue using the canonical publication
state. Convert existing future schedules only within the enabled cohort and
after verifying that the assignments have no learner work.

Apply migration 310 and verify the legacy bulk RPC in the Data API schema
cache before deploying the application route. The atomic legacy writer
preserves edits to Blueprint-retired history in a mixed batch.

Release under the existing assignment and classroom locks, then acquire the
owner account and entitlement locks. Require eligible access both at the
scheduled time and after any lock wait. For the scheduled time, use an
entitlement audit recorded by that time and the classroom's restriction
history. A grant written later with an earlier period start cannot rescue a
missed release. Persist the suppressed generation and its teacher notice in
one transaction. A teacher can explicitly reschedule or release it after
regaining access. Released assignments keep their existing student rules.

Owner Classwork list, summary and detail responses expose the latest relevant
release generation separately from the assignment draft and publication fields.
Only the service can query these generations, and the database binds each query
to the classroom owner. Cancel, reschedule and Post check the generation the
teacher saw. If a worker completes it first, the editor refreshes the assignment.
Cancelling preserves the draft even when the cutoff flag is off or access has
expired. The missed status remains visible until the teacher takes action.

The assignment card and authoring dialog are the reference surfaces. Verify
scheduled and overdue pending states, missed release, the open schedule dialog
and cancellation on teacher desktop and mobile in both themes. Check keyboard
entry to the existing schedule dialog and its focus behavior. The student
browser check covers absence of owner controls. The database proof covers
learner assignment access before and after worker publication.

| Need | Existing candidate | Decision | Reason |
| --- | --- | --- | --- |
| Release status in Classwork | `SortableAssignmentCard` | extend | Keep the current badge and distinguish a pending or missed release. |
| Teacher scheduling controls | `AssignmentActionButton` and `ScheduleDateTimePicker` | reuse | Preserve the existing date, time and cancel controls. |
| Visual verification | Pattern Lab assignment controller | extend | Exercise the production owner controls with deterministic records. |

### Worker recovery follow-up

Keep the base sandbox and its validated local app origin configured when
stopping new checkout and upgrade admissions. The authenticated worker still
drains checkout and upgrade operations already recorded in Pika. Customer
mutations continue to check their respective admission gates. A blank app
origin leaves the base subscription, expiry and closeout paths available.
Invalid optional recovery configuration or a failed checkout or upgrade
recovery call returns a diagnostic for that lane while the other work continues.

Migration 304 isolates expiry conflicts. A stale account-plan or entitlement
revision stays available for investigation, and a limited batch can still
expire an unrelated healthy account. The worker rechecks revisions after
taking the same account and entitlement locks used by the writer. The isolated
rollback fixture places both conflict types ahead of a healthy expired trial
and verifies that a batch of one completes only the healthy expiry.

### Scheduled Max-to-Pro sandbox checkpoint

Migrations 305–306 add an exact same-interval, same-currency renewal quote,
teacher confirmation, and leased Stripe schedule installation. The worker
records each possible attach or configure request before sending it, pins its
replay window, and commits a schedule only after checking its identity and
terms. Recovery is independent of the customer admission flag. A verified
target renewal payment changes the purchased version atomically. A failed
target invoice enters the exact seven-day grace period on the paid Max terms.

Both application flags and the database admission flag default to off. This
checkpoint has a sealed disposable replay and a separate draft review. Customer
scheduling and replacement controls are still pending. Migration 307 reserves
due scheduled closeout work before ordinary reconciliation can lease it and
ties the claim to the exact target invoice. A verified capture that wins the
closeout race commits the Pro term. A verified void plus terminal schedule and
invoice evidence keeps Free in force and retires the payer binding. Keep the
scheduling flags off outside the isolated rehearsal until the remaining
contracts pass.

A verified target payment first observed after the grace window can settle
under the existing lease if closeout has yet to take ownership. The SQL
settlement and closeout checks both derive the exact UTC cycle end from the
immutable target offering. Admission and installation listing are scoped to the
configured Stripe test account. After Stripe cancels a scheduled subscription,
a fresh read of the saved terminal schedule and exact target phase supports
failed-invoice closeout or settlement of an already captured target payment.
The first verified paid term keeps its actual paid-through date.

The November 8 isolated Stripe rehearsal reused all 12 existing sandbox prices.
Hosted Pro and Max test payments produced one verified receipt each, with five
and twelve classrooms and eligible RepoLight access. The signed webhook reached
the local app, and the paid Pro account opened the invoice and payment-method
portal. The cardless Pro trial granted five classrooms for 720 hours and reused
the same cutoff on replay. An accelerated rollback test confirmed RepoLight
denied new work after the trial cutoff, before the expiry worker applied Free.
The disposable rehearsal needed Free plan rows for its synthetic teachers. The
live rollout depends on the separately governed account-plan provisioning step.

The installed same-interval Stripe schedule issued its exact target renewal as
`subscription_update` with a full, non-prorated line at the phase boundary.
Reconciliation accepts that reason only after a fresh read verifies the exact
installed schedule and target phase. Closeout applies the same distinction.
Ordinary renewal and upgrade verifiers keep their existing invoice contracts.

The real scheduled decline preserved Max's twelve classrooms and RepoLight
with an exact 168-hour cutoff. Successful retry of the same invoice changed the
account to Pro with five classrooms and retained both distinct receipts. A
separate historical test clock used a seeded exact schedule and verified the
unpaid closeout through the actual worker. Stripe retained the original amount
remaining after void. The worker used the void status, canceled payment and
complete outstanding-invoice checks before canceling the schedule without
proration or a final invoice. Pika retired the binding and kept Free with
RepoLight denied. The audited requeue resumed the saved stage after the fix.
