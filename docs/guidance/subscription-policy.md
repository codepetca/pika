# Subscription and tier policy

Status: owner-approved launch policy, updated 2026-09-26 after pricing and
lifecycle decisions. Ontario is the initial market; USD is the base currency,
with fixed CAD prices below. The isolated Stripe test-mode foundation exists;
checkout and the complete lifecycle remain future implementation. Live billing
is off. This document is the canonical product policy, not authorization to
charge customers, deploy, or apply migrations.

## Authority and change rules

- Read this policy before changing billing, plan selection, subscription state,
  upgrade quotes, or billing-derived entitlements. Follow the repository's
  architecture, authorization, and rollout requirements as well.
- The agreed rules below are requirements for future implementation. Provisional
  AI quantities and remaining open decisions are explicitly labeled; an AI must not
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
follow the same remaining-period rule. Monthly/annual interval changes take
effect at renewal under SUB-10.
In-place currency changes remain outside the launch scope.

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

A downgrade or expiry must not delete work, transfer classrooms, or remove
ownership. Preserve existing-work access and the student completion protections
in SUB-12, including when a classroom is archived for subscription reasons.
Students never need to purchase an owner subscription to join or complete
eligible work. Restore and creation must respect the new active-classroom cap.

At a downgrade's effective timestamp, keep the teacher's selected classrooms
active up to the new cap. If no selection was made, automatically keep the
classrooms with the most recent meaningful teaching or student activity and
archive the remainder. Free has zero active classrooms. Notify the teacher of
the resulting selection. Archiving is reversible subject to available capacity;
it does not transfer or delete data. Do not silently unarchive on resubscription.
Define deterministic activity ranking and ties before implementation. Ordinary
archive restrictions must not override SUB-12's existing-assignment completion,
started-test completion, grading or export protections. This requires explicit
archive/access integration; blindly calling the current archive action is not
sufficient. Subscription expiry alone must not trigger data purging. Any separate
retention policy needs its own notice and export provisions.

### SUB-06 — Payment provider

Use Stripe for paid subscriptions, selected by the owner on 2026-09-26. The
existing verified-payment, proration, account-mapping and reconciliation rules
apply to the Stripe implementation. Provider selection does not change current
customer access or authorize live charges. Approved launch prices and lifecycle
rules are recorded below; unresolved
implementation details and launch prerequisites remain explicitly listed.
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
- The legacy fixed Free/Basic/Plus/Pro writer does not implement versioned paid
  benefits. The isolated billing foundation adds a version-aware assignment
  boundary; complete and verify its launch integration rather than simulating
  grandfathering through direct grant-table edits.

The isolated foundation supports immutable offerings and paid assignments.
Complete customer transitions remain future work; versioning is not a promise
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

New offerings apply to new purchases by default. Existing subscribers keep
their purchased terms until a separately approved transition; indefinite
grandfathering is not implied. Any planned migration of existing subscribers
requires at least 60 days of notice, an eligible renewal boundary, and any
required consent. Preserve the price and benefits already paid for
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

## Approved launch decisions

### SUB-09 — Pricing, market and payment methods

Initial market: Ontario. USD is the base currency; CAD uses fixed, rounded
catalog prices at approximately 1.4 times USD, not a live exchange-rate formula.
Prices exclude applicable tax. Confirm required tax registrations and configure
tax collection before launch. Currency and tax must be clear before purchase.

| Plan | Active classrooms | USD monthly | USD annual | CAD monthly | CAD annual |
| --- | ---: | ---: | ---: | ---: | ---: |
| Free | 0 | 0 | 0 | 0 | 0 |
| Basic | 2 | $9 | $99 | $13 | $139 |
| Pro | 5 | $19 | $199 | $27 | $279 |
| Max | 12 | $39 | $399 | $55 | $559 |

The owner renamed Plus to **Pro** and the former Pro to **Max**. Prices,
classroom limits, AI allowance candidates and trial benefits are unchanged by
this rename. The 30-day trial uses the five-classroom Pro offering. Legacy
runtime keys remain `plus` and `pro` until a reviewed implementation updates
their mapping; never interpret legacy `pro` as the new five-classroom product
or rewrite historical purchased terms solely because a display name changed.

Annual plans charge the full annual amount upfront. Show that total clearly;
do not advertise the previously proposed two-month discount, which these final
prices supersede. Paid plans share core teaching tools and differ primarily by
classroom capacity and AI allowance. Basic includes no AI grading.

Use Stripe hosted checkout and cards initially. Customer self-service supports
payment details, invoices and cancellation. Plan changes run through Pika's
confirmed quote and policy flow; disable portal actions that bypass it. Launch
without coupons, automatic overage charges, school contracts, bulk seats or
purchase-order billing. Sponsored/manual grant precedence remains deferred.

### SUB-10 — Renewal, cancellation and scheduled changes

- Verified renewal extends access for the paid term. Cancellation stops the next
  renewal and preserves access until Stripe's exact paid-through timestamp.
  Do not round access expiry to midnight; display the timezone explicitly.
- Before expiry, a teacher may undo cancellation. After expiry, restore paid
  capabilities only after a new successful subscription payment.
- Downgrades and monthly/annual interval changes take effect at the next renewal,
  with no automatic midperiod refund. Preserve the paid annual term.
- Keep one pending confirmed plan change. Clearly show its effective date and
  recurring price; a new confirmed change replaces the previous pending change.
- Same-interval, same-currency upgrades follow SUB-03/SUB-04. Resolve an
  outstanding failed-renewal invoice before upgrading; do not credit unpaid time.
- A failed upgrade retains the existing valid paid plan. Reactivation removes
  obsolete expiry warnings but never publishes missed scheduled work.

### SUB-11 — Trial, renewal failure and refunds

- Offer one explicitly started **30-day Pro trial per teacher**, without a card
  or automatic charge. Include a provisional **30 AI student grading runs total**
  for the trial; do not reset it monthly. Free itself never expires.
- Trial expiry follows SUB-05/SUB-12. No extra grace applies to trial expiry,
  voluntary cancellation, unsuccessful first purchase or failed upgrade.
- Failed renewals get **seven days of grace from the paid period's end**, keeping
  paid capabilities during retries. Use an exact timestamp, not seven calendar
  midnights. Success clears failed-payment/expiry notices.
- At the unpaid grace deadline, apply Free restrictions, end the failed
  subscription and close out the unpaid renewal invoice so later automatic
  collection cannot unexpectedly charge it. Grace is complimentary. Reconcile
  any payment racing with this transition before closing the invoice or access.
- Offer a **seven-day first-purchase refund window**, including annual purchases.
  Thereafter cancellation normally stops renewal without refunding unused time,
  subject to applicable requirements. Correct duplicate/incorrect charges;
  handle exceptional refund requests through support with an audit trail.
- Refund requests, provider refund state and entitlement effects need an explicit
  implementation contract before activation; do not invent reversal/grant rules.

### SUB-12 — Teaching access after expiry or classroom downgrade

These rules apply when paid access ends (after renewal grace where applicable),
and to classrooms archived because they exceed a downgraded plan's capacity.
They must remain valid even if ordinary archived classrooms block mutations.

| Action or content | Required behavior |
| --- | --- |
| Draft assignments/tests | Preserve preparation and editing access, but block new publishing/releasing |
| Scheduled assignments/tests | Recheck entitlement at execution; leave unpublished and notify the teacher if ineligible |
| Already published assignments | Students may continue working and submitting under existing assignment rules |
| Already published tests | Block new attempts, restarts and retakes |
| Test attempts started before cutoff | Allow saving, finishing and submission under the original timer/deadline; no extension |
| Past classroom work | Preserve viewing, grading, feedback and export; no subscription-triggered deletion |
| Successful resubscription | Restore eligible paid capabilities; require manual release/rescheduling of missed work |

Test start and cutoff must have a race-safe server decision. Existing test timers,
assignment deadlines and membership/authorization checks still apply. A subscription
must not grant access to another person's classroom.

### SUB-13 — Notifications

Send cancellation confirmation with the exact access-end date/time, reminders
seven days and 24 hours before actual access ends where those times are still
in the future, and an expiry notice explaining restrictions and preserved work.
Use email plus an in-app teacher banner for expiry reminders. Do not send a
backlog of reminders when cancellation occurs close to expiry.

Notify immediately on failed renewal, with a payment-update link and exact grace
deadline. Warn on scheduling releases beyond a known access cutoff. Normally
renewing accounts say "Renews on…", not "Expiring". Successful payment or resumed
renewal cancels obsolete reminders. Deduplicate notifications and recheck current
state before sending; automated reminders do not authorize sending real email
from a development task.

### SUB-14 — AI allowance policy (quantities provisional)

Candidate included monthly quantities are **Pro 300** and **Max 1,000** student
grading runs. Validate real delivery costs before promising or activating these
quantities. Basic has no included AI allowance; the trial gets 30 total runs.

- Share the owner's allowance across classrooms and supported grading activities.
  One student's submission graded once consumes one run, not one unit per
  question. Skipped empty work and failed jobs consume none. System retries reuse
  the reservation; an explicitly requested fresh grading consumes a new run.
- Reset monthly even on annual subscriptions. No rollover, automatic overage
  charges or paid top-ups at launch. Warn at 80% and 100%; exhaustion pauses new
  AI grading, never manual grading or access to previously graded work.
- Upgrades add a prorated share of the allowance difference for the remaining
  monthly allowance period, preserving consumed usage and the reset boundary.
  Do not use the remaining annual billing fraction for a monthly AI allowance.
- Cancellation, resubscription and repeated plan changes must not generate
  repeated fresh allowances. Payment proration does not reset usage.

### SUB-15 — Operations and future changes

Routine subscriptions and tiers are automatic. Admin handles analysis, failed
payments, automation exceptions and audited support/refund recovery. Do not
build routine manual tier assignment as the purchase workflow.

Preserve purchased terms and follow SUB-07/SUB-08 for all catalog changes and
subscriber migrations. The legacy runtime key `plus` corresponds to the new
Pro product; legacy `pro` corresponds to Max. The legacy `pro` classroom limit
of 10 does not override Max's newly approved launch limit of 12. Updating the
runtime requires a separately reviewed version-aware implementation; this policy
edit must not rewrite an already-purchased offering or a historical migration.

## Remaining launch prerequisites

- Validate AI unit costs, publish final quantities, and specify reset anchors,
  whole-unit rounding, workload limits and reservation behavior at transitions.
- Implement once-per-teacher trial eligibility, verified paid conversion and
  precedence preventing stacked trial/paid allowances.
- Define deterministic classroom activity ranking and tie-breaking, and implement
  subscription archives that preserve SUB-12 without enabling unrelated archived
  mutations or automatic retention purges.
- Confirm tax registrations/configuration, refund entitlement effects and
  disputes/chargeback handling. Currency changes within a subscription and
  promotional/sponsored/manual grant precedence remain outside launch scope.
- Implement checkout, authoritative upgrade quotes, scheduled changes, portal,
  grace/expiry, notices and reconciliation with exact-cutoff/concurrency tests.
  Set quote validity and scheduler cadence explicitly; hosting constraints apply.
- Rehearse real Stripe test-mode flows in an isolated runtime. No live enablement,
  production deployment, account changes or migration application is authorized
  by this policy. See the [foundation](stripe-billing-foundation.md).

## Acceptance evidence for implementation

Before launch, test verified purchase-to-account mapping, failed/pending
payments, duplicate and out-of-order events, concurrent upgrades, retries
after partial failure, reconciliation after missed events, and scheduled
transitions. Verify same-interval proration near period start/end and halfway
through, discounts/taxes/rounding, quote-to-charge consistency, unchanged
renewal date, unpaid-invoice credit protection, and no duplicate charge.
Exercise the approved cancellation/grace/downgrade/trial policies,
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
live billing. Commercial terms and lifecycle requirements are owned here.

Also verify both fixed currency catalogs, the 12-classroom Max offering, 30-day
trial boundaries, over-limit teacher selection and deterministic fallback,
subscription archive protections, publish/attempt-start races at cutoff,
missed schedules remaining unpublished after payment, and obsolete notification
suppression. Existing runtime limits or archive behavior are not acceptance
proof for these new requirements.
