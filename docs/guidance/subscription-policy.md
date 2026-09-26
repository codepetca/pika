# Subscription and tier policy

Status: product policy recorded 2026-09-25; Stripe selected by the owner on
2026-09-26; versioned offerings and subscriber transitions approved the same day.
Billing automation is not implemented or activated. This document
is the canonical product policy for subscriptions, automated tier assignment,
and upgrade proration. It does not set prices, authorize charges, or activate
a deployment or migration.

## Authority and change rules

- Read this policy before changing billing, plan selection, subscription state,
  upgrade quotes, or billing-derived entitlements. Follow the repository's
  architecture, authorization, and rollout requirements as well.
- The agreed rules below are requirements for future implementation. Proposed
  lifecycle defaults and open decisions are explicitly labeled; an AI must not
  silently promote them into approved behavior.
- Change this document in the same PR as any approved change to these rules.
  Record the owner decision, affected rule IDs, customer impact, transition for
  existing subscriptions, and verification. Do not infer a policy change from
  provider defaults, prototype fixtures, or behavior in another product.
- Implementation and deployment status belongs in the feature ledger and
  rollout evidence. A policy requirement is not evidence that it is live.
- Classroom limits and role separation remain governed by the
  [access roadmap](classroom-access-and-entitlements-roadmap.md). The
  [plan foundation](account-plan-foundation.md) documents the current writer;
  the [rollout runbook](account-plan-rollout.md) governs legacy classification
  and activation. Routine subscription automation does not replace those gates.

## Agreed product rules

### SUB-01 — Automatic assignment

Routine subscription purchases, renewals, and tier transitions must be handled
automatically. An operator does not manually assign a tier after each payment.
The [operations console](platform-administration.md) is for read-only account
state, history, and exceptions. Manual recovery, sponsored grants, and override
precedence require their own approved contract.

### SUB-02 — Verified payment and account identity

Checkout must be linked server-side to the authenticated user's permanent Pika
account ID. Resolve purchased products/prices through a server-controlled tier
mapping. Do not infer identity or paid access from an email match, browser plan
label, checkout redirect, or client-supplied payment claim.

Grant a purchased paid tier only after the server verifies the required payment
and corresponding subscription state with the provider. A pending or failed
upgrade payment must not unlock the higher tier. Preserve the user's existing
paid access through its valid term while the upgrade remains unpaid.

### SUB-03 — Prorated upgrades

For a paid account upgrading within the same billing interval and currency,
charge the difference for the unused portion of the current paid period:

`upgrade charge = new plan's remaining-period cost - unused old-plan credit`

For undiscounted fixed prices over the same period, this simplifies to:

`(new period price - old period price) × remaining fraction of the period`

Keep the existing renewal date. Collect the upgrade amount immediately and
activate the higher tier after successful payment verification. At the next
renewal, bill the new plan's full recurring price, subject to applicable
discounts and taxes. Credit only time the customer has actually paid for;
unpaid invoices must not create unearned upgrade credit.

Example only, not Pika pricing: upgrading from $20/month to $40/month with
exactly half the period remaining costs $10 before taxes or discounts. The
next renewal is $40 on the original renewal date. Annual-to-annual upgrades
follow the same remaining-period rule. Monthly-to-annual changes and currency
changes are separate open decisions.

### SUB-04 — Clear confirmation

Before confirmation, show the target plan, unused-time credit, remaining-time
charge, applicable tax/discount adjustments, total due now, and next renewal
date and recurring amount. Use the provider's authoritative quote and billing
period timestamps; the example formula is not a substitute for invoice math.
Keep the quote and executed change consistent; if the payable amount changes,
refresh the quote and obtain confirmation before charging the revised amount.

Show pending payment or synchronization honestly. Do not claim the upgrade
succeeded until payment and Pika access are confirmed. Retrying a confirmation
must not create a second subscription or charge twice.

### SUB-05 — Preserve classrooms and separate permissions

A subscription never grants classroom ownership, membership, teacher-route
authorization, or admin authority. Server-side effective entitlements govern
paid capabilities; a tier label alone is not authorization.

A downgrade or expiry must not delete, archive, transfer, or remove ownership
of existing classrooms or work. Preserve existing-work access and a workable
student submission path. Enforce lower creation limits against new active
classroom consumption, including creation and restore; joining and student
work must not require purchasing an owner subscription. This is not a promise
of indefinite free storage; retention and paid-feature rules remain separate.

### SUB-06 — Payment provider

Use Stripe for paid subscriptions, selected by the owner on 2026-09-26. The
existing verified-payment, proration, account-mapping and reconciliation rules
apply to the Stripe implementation. Provider selection does not change current
customer access or authorize live charges. Prices, currencies, payment methods,
billing intervals and the remaining lifecycle decisions below are still open.
Existing Pika plan assignments stay unchanged; this decision does not migrate
subscriptions or implement billing. Verify test-mode purchase and subscription
transitions before any separately authorized billing launch.

### SUB-07 — Versioned offerings before paid launch

Prices, tier names, classroom limits, included features, AI allowances and the
payment model may change. Before paid billing launches, implement versioned
offerings so these changes cannot silently rewrite an existing purchase.

- Give each published offering a stable version ID. Preserve its commercial
  terms and entitlement definition, including the billing model, interval,
  currency/price mapping, classroom limit, included features, and any approved
  AI quantities and reset rules. Record the applicable customer-specific
  discounts and quoted adjustments separately. Do not invent undecided values.
- Link each subscription and effective paid assignment to its purchased version
  and exact Stripe price/environment. A tier label such as `plus` alone is not
  sufficient. Retain historical versions for billing, support and audit.
- Changes to published purchase terms create a new version. A new Stripe price
  amount uses a new Price; publishing or archiving a catalog price must not
  itself move existing subscribers to a different version.
- Checkout uses the offering selected and confirmed for that purchase. Renewal,
  webhook processing, reconciliation and entitlement resolution use the
  subscriber's recorded version and approved scheduled transitions, rather
  than whatever offering is currently advertised under the same tier name.
- The current fixed Free/Basic/Plus/Pro plan writer does not implement versioned
  paid benefits. Extend the authorized resolver/writer consistently before
  launch; do not simulate grandfathering through direct grant-table edits.

Versioning is a design requirement, not an implemented capability or a promise
that any particular price or benefit lasts forever.

### SUB-08 — Explicit transitions for existing subscribers

Publishing a new offering applies it to new purchases selected under that
offering; existing subscriptions keep their recorded version unless an
explicitly approved transition changes it. Before migrating an existing cohort,
record the chosen approach:

| Approach | Existing subscribers | Decision required for that change |
| --- | --- | --- |
| Grandfather | Keep their prior price and specified benefits | Eligibility, duration, and what happens after upgrade, cancellation or return |
| Future renewal transition | Move to the new offering at a specified future renewal | Affected cohort, advance notice, opportunity to cancel, and applicable commitments/consent |
| Optional migration | Keep the old offering until they choose the new one | Clear comparison, confirmation, effective date, and any charge or credit |

No one approach is the universal default for future changes, and indefinite
grandfathering is not implied. Preserve the price and benefits already paid for
through the paid term when the business changes its offering, unless the
subscriber explicitly chooses a change under a confirmed quote. For an annual
subscription, preserve the remaining annual term, not merely the current month.
Voluntary same-interval upgrades continue to follow SUB-03 and SUB-04.

Moving between subscriptions, usage billing or credits requires its own
approved transition: define the treatment of remaining paid time, existing
credits, consumed usage, renewal timing, refunds and access before execution.
Do not infer credit conversion, a usage reset, or a new full allowance from
payment proration. Preserve classrooms and work under SUB-05.

Each migration must identify the eligible subscriptions, old/new versions,
effective dates, charge/credit treatment, communication and any required
confirmation, and recovery procedure. Apply changes idempotently and audit
scheduled and completed transitions. A partially failed migration must not
leave Stripe billing and Pika access permanently on different versions.

## Required automation design

These are implementation requirements, not claims about existing services:

- The provider is authoritative for billing facts. Pika persists subscription
  state and derives server-side effective access from verified facts and this
  policy. Keep subscription status distinct from tier and entitlement state.
- Link account ID, provider/environment, customer ID, subscription ID, and
  product/price IDs and offering versions. Track the purchased and effective
  plan/version, billing period,
  paid-through/access end, scheduled changes, cancellation timing, payment
  status, last successful synchronization, and processing/audit references.
  Do not equate an invoice's period end with proof that it was paid. Do not
  store card details or provider secrets in these records or logs.
- Verify provider event authenticity, durably record events, and process them
  with idempotent operations, retries, and per-subscription concurrency control.
  Duplicate or out-of-order notifications must not repeat a charge, reset usage,
  or overwrite newer access. Fetch current provider state when needed; delivery
  order is not authority. Audit the cause and old/new state of each transition.
- Update the plan and derived entitlements consistently through the authorized
  service boundary. Resolve stale revisions by re-reading current state, not
  overwriting blindly. Do not bypass the plan writer with direct grant edits.
- Reconcile subscriptions periodically against provider records and process
  scheduled access transitions even when no webhook arrives. Define cadence
  and recovery objectives before launch, compatible with hosting limits.
  Temporary provider outages must not be treated as proof of cancellation.
- Surface exhausted retries, unmatched payments, and subscription/entitlement
  discrepancies as actionable exceptions. Recover automatically where safe;
  human investigation is the exceptional path.

## Proposed lifecycle defaults — not yet approved

| Event | Proposed behavior | Decision still required |
| --- | --- | --- |
| Successful renewal | Extend access for the paid period | Supported payment methods |
| User cancellation | Keep benefits through the paid term, then apply baseline Free access | Cancellation/refund policy and any grant precedence |
| Renewal failure | Retry payment and allow a defined grace period before reducing access | Grace duration, notifications, retry/exhaustion rules |
| Downgrade request | Apply the lower plan at the next renewal; keep current benefits until then | Downgrade timing and credits/refunds |
| Final expiry/nonpayment | Remove expired paid benefits while preserving existing work | Interaction with other grants, retention, and recovery |

Do not implement these defaults as settled policy merely because they appear
here. The confirmed immediate, prorated upgrade rule is independent of these
remaining lifecycle choices.

## Open decisions before billing launch

- Supported currencies/payment methods, prices, monthly/annual
  offerings, tax and discount configuration, and customer billing management.
- Trial eligibility and conversion, promotional/sponsored/manual grants, and
  precedence when more than one source could fund access.
- Cancellation, failed-payment grace/recovery, downgrade scheduling, refunds,
  disputes/chargebacks, and the treatment of an outstanding unpaid invoice
  when a customer requests an upgrade. Never credit unpaid time.
- Billing interval/currency changes, rounding/quote validity, and concurrent
  or repeated plan-change requests.
- Included AI quantities, reset periods, and allowance treatment on upgrade.
  Payment proration does not define usage proration. Do not reset consumed
  usage or grant a new full allowance on each upgrade without an approved
  metering policy; the plan foundation currently grants no AI allowance.

## Acceptance evidence for implementation

Before launch, test verified purchase-to-account mapping, failed/pending
payments, duplicate and out-of-order events, concurrent upgrades, retries
after partial failure, reconciliation after missed events, and scheduled
transitions. Verify same-interval proration near period start/end and halfway
through, discounts/taxes/rounding, quote-to-charge consistency, unchanged
renewal date, unpaid-invoice credit protection, and no duplicate charge.
Exercise the chosen cancellation/grace/downgrade policies once approved,
existing-class protection, role isolation, and eventual recovery of access
after payment succeeds but synchronization initially fails.

Before paid launch, verify that publishing a new price or benefit version does
not alter existing subscriptions, renewals or effective benefits. Test concurrent
old/new versions, exact checkout-version binding, and recovery after missed,
duplicated or out-of-order events without switching to the latest catalog terms.
Before any later cohort migration, test its approved grandfathering/renewal/opt-in
rules, annual paid-term protection, scheduled transition, duplicate execution,
partial-failure recovery and charge/credit consistency. Versioning and cohort
migration support are not enabled for customers; this policy does not activate them.

Selected-provider implementation references:
[price changes and archiving](https://docs.stripe.com/products-prices/manage-prices),
[scheduled subscription changes](https://docs.stripe.com/billing/subscriptions/subscription-schedules),
[Stripe prorations](https://docs.stripe.com/billing/subscriptions/prorations),
[subscription events](https://docs.stripe.com/billing/subscriptions/webhooks),
and [webhook delivery](https://docs.stripe.com/webhooks). Verify current provider
behavior when implementing; provider defaults never supersede this policy.

The [Stripe foundation execution plan](stripe-billing-foundation.md) tracks the
isolated test-mode implementation and its verification gates. It does not approve
live billing, commercial terms, or the unresolved lifecycle decisions above.
