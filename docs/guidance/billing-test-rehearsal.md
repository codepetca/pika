# Billing rehearsal preparation — 2026-10-08

Billing remains OFF. This is a fixture-first acceptance plan, not authorization
for provider/account changes, charges, email, migration application or activation.
Commercial rules remain in [subscription policy](subscription-policy.md); current
implementation scope is tracked in [the foundation](stripe-billing-foundation.md).

## Evidence boundary

Main `e24d591abb53713e01d75a5c95fc418cf57592eb` contains the first-purchase,
trial/expiry, failed-renewal closeout and first prorated-upgrade backends.
PR1435 merged `efe4eb3f` after exact-head CI37112129981 passed. The September 27
[provider report](billing-test-report-2026-09-27.md) covers actual sandbox first
purchases, not the complete lifecycle or scheduled changes. Historical local
migration receipts do not authorize reapplication or resetting today's database.

Fixtures may invoke actual policy, reconciliation and provider adapter code
through deterministic read ports. They must not construct a credentialed Stripe
client, mutate an account or claim actual provider acceptance. Passing a rejection
case for an unsupported transition does not make that transition implemented.

## Fixture acceptance matrix

| Flow | Required observations | Remaining evidence |
| --- | --- | --- |
| Purchase/trial conversion | Exact immutable offering and permanent account; failed/pending payment gives no grant; duplicate events/requests do not duplicate effects | Real purchase evidence is historical; full trial-to-paid provider rehearsal remains |
| Same-interval upgrade | Frozen exact amount/revision/digest; captured payment plus exact target item; unchanged original term; retry has no second charge | Existing fixtures and rollback contracts; full provider quote/payment/recovery run remains |
| Cancellation after upgrade | Read-only proof of exact captured payment/target/term; cancellation at paid-through; null renewal invoice/period fields; no provider writes | Current correction and targeted fixtures; shared database writer acceptance remains |
| Terminal cancellation | Complete empty draft/open/uncollectible enumeration before marking obligations cleared; unknown/outstanding evidence retains payer ownership | Fixture enumeration does not prove live provider completeness |
| Invalid upgraded observation | Wrong account/customer/subscription/item/period/payment, refunds/disputes, partial capture, schedule/pending update and unexpected invoice fail closed | Test actual adapter and reconciliation, not a locally reimplemented verifier |
| Undo cancellation after upgrade | Verified source access cutoff/expiry notices return to normal renewal state without extending the purchased term | Not implemented by the cancellation observation correction |
| Scheduled downgrade or interval change | Exact renewal boundary; immutable source/target; confirmed replacement; no midperiod refund or unpaid-time credit | No durable scheduling contract/provider adapter yet; grace offering choice pending |
| Scheduled renewal payment failure | Verify target invoice while attributing access to the explicitly chosen grace offering; preserve exact 168-hour cutoff and payment race recovery | Product decision and billing/access version split required |
| Classroom/work cutoff | Selected classes or deterministic activity fallback; preserved released assignments/started tests; no new release/start at cutoff | Ranking and archive/access integration remain pending |

Use affected Vitest files while iterating. Before PR readiness, run the required
`pnpm check:focused -- --base origin/main` gate and independent risk-matched review.
Unit fixture counts overlap with repository checks and must not be added together.

## Shared service proof gate

The coordinator must assign the shared execution slot before any heavyweight
database, browser or runtime proof. No slot is assigned in this continuation.
The five existing billing SQL harnesses are rollback-only and do not apply
migrations; discover the current target/history and confirm their prerequisites
before running them sequentially. Do not run concurrent fixture writers, reset,
reseed, repair history or use unrelated migration source to eliminate drift.
New migration application needs exact target-and-migration permission.

For cancellation observation, verify the actual existing lifecycle writer records
the cancellation cutoff, preserves recorded grace, keeps the original paid invoice
and paid-through, and releases terminal payer ownership only after complete
obligations and access expiry. Preserve unrelated records and capture rollback/
cleanup evidence. Unit mocks cannot establish these database effects.

## Future isolated Stripe test-mode gate

An actual provider rehearsal needs separate authorization for its specific test
account mutations, the shared runtime slot and reviewed synthetic fixture teardown.
No new credentials are requested or changed here. Existing configuration rejects
hosted runtime targets and live keys: sandbox URLs are loopback port54321; the
application origin is separately configured; checkout and upgrade gates are
independent. Keep shared `.env.local` and rollout flags unchanged during preparation.
Never publish secrets in receipts or logs.

Before that rehearsal, finalize the missing scheduling/undo-cancellation/receipt
chain and recovery contracts. Capture exact provider account/mode, source revision,
operation IDs, quote/invoice/target price/period facts, lost-response retries,
payment and assignment effects, duplicate/out-of-order processing and definitive
teardown. Include end-of-period cancellation and terminal outstanding invoices:
[Stripe documents](https://docs.stripe.com/billing/subscriptions/cancel) that
cancellation can leave invoice items and unpaid invoices requiring reconciliation.
No provider defaults override Pika policy.

## Paid activation remains separate

Require full backend/UI and customer portal recovery, notification suppression,
classroom/test cutoffs, approved tax setup and validated AI cost/allowance terms,
periodic reconciliation cadence and audited financial attention/compensation.
Then obtain the separately required production/schema/activation authority.
This plan and a merged dormant correction do not make billing ready to switch on.
