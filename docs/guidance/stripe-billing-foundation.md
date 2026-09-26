# Stripe billing foundation

Status: isolated test-mode implementation on `codex/stripe-billing-foundation`;
the consolidated migration 209 is applied locally after an owner-approved reset
and reseed. Final integration review and CI remain pending.
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
adoption and audited recovery. Unit tests use simulated Stripe reads and real SDK
signature verification; they do not establish a real Stripe payment result.
Initial and targeted review findings were corrected. Final integration review
and stable-head CI remain required before PR readiness.

Application of the schema does not activate the private sandbox gate. Database
tests enable it only inside a transaction that rolls back. A real test-mode
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
