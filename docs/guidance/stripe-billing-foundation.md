# Stripe billing foundation

Status: isolated test-mode foundation merged in PR #1366 on 2026-09-26 after
independent review and all required checks. Consolidated migration 209 was
applied locally after an owner-approved reset and reseed; the existing local
database predates the final binding/webhook race correction. Checkout is a
separate, incomplete follow-up described in the coordinator plan below.
The [subscription policy](subscription-policy.md) remains the product authority.

## Scope and boundaries

This first slice proves initial paid assignment and renewal against an immutable,
previously bound offering in an isolated local database using Stripe test mode.
It does not enable live billing. No real prices or AI allowances are established.
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
database. The reseeded local database predates this last function-body correction;
refreshing it requires new explicit local migration/reset authorization. Unit tests use simulated Stripe reads and real SDK
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
| 1 | Exact 12-variant USD/CAD catalog; authenticated, durable hosted checkout; idempotent creation/recovery; verified payment grants selected version | Implementation on `codex/stripe-checkout-trial` |
| 2 | Once-only 30-day Pro trial and paid conversion; exact paid/trial expiry and seven-day renewal grace; safe resubscription | Pending phase 1 contracts |
| 3 | Prorated upgrades, renewal-scheduled changes, classroom selection/activity fallback archive, publishing/test cutoff and preserved existing-work access | Pending lifecycle integration |
| 4 | Billing UI, self-service portal, expiry/failure notifications and missed-schedule recovery; role/theme/viewport visual verification | Pending backend contracts |
| 5 | Full provider test-mode lifecycle rehearsal, concurrency/retry evidence, AI cost validation and tax setup review | Test credentials absent; live launch remains separate |

Current ownership: coordinator owns shared runtime/HTTP integration and PRs;
Astra/high worker owns durable checkout/provider/schema implementation;
Terra/high worker owns the pure launch catalog and catalog tests. No worker may
apply schema changes, mutate Stripe, publish, merge or recursively delegate.
Financial/schema review uses independent reviewers with the bounded HQ review
budget (one initial wave, at most three targeted fix waves, at most five launches
and 45 minutes; any extension needs explicit approval). The agent thread limit
prevented fresh reviewer creation, so the existing independent architecture
reviewer completed the migration preapplication review. Full implementation
review remains pending integration verification.

Phase 1 currently includes the exact public catalog, test-only price provisioning
with existing trusted products, authenticated catalog/start/status endpoints,
durable checkout reservation and provider recovery, and worker integration.
Checkout completion binds the purchased version; only the existing verified
payment reconciler may grant paid access. Both checkout and sandbox gates remain
disabled by default. No checkout UI or provider configuration has been performed.

Migration 211 passed independent preapplication review but remains unapplied.
The existing shared local database contains an unrelated gradebook migration210;
do not reset it or use its schema to generate this branch's types. The proposed
verification target is a separate disposable `pika_billing_checkout` database
with migrations001–209 and211, no seed. Explicit application approval is pending.
The checkout database contract is wired into disposable CI but has not run yet.
The 192 billing-focused tests pass; focused checks passed 293 tests and policy
checks, then stopped at TypeScript because the unapplied migration's eight RPCs
are absent from generated types. Proper generation and full verification remain
required; do not hand-edit types or cast around this gap.

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
