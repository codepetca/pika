# Billing verification — 2026-09-27

**Release verdict: not ready for paid launch.** The gated first-purchase backend
works with real Stripe sandbox payments. The complete subscription lifecycle is
not implemented. Passing rejection tests for unsupported transitions does not
prove those transitions work.

Policy authority: [subscription policy](subscription-policy.md). Implementation
plan: [Stripe foundation](stripe-billing-foundation.md). This report records
testing of main `43c170b5` plus the webhook validation correction and seven
regression cases on `codex/billing-flow-testing`.

## Earlier production rollout checkpoint

Before this testing request, the owner explicitly requested the PR merge and
migration application, then separately instructed “Apply them to prod.” The
approved 211/212 application completed in that earlier rollout. During review on
2026-09-27, a read-only linked migration-history check against production project
`zhioqbapgfcrronyuidm` confirmed remote 211 and 212 are recorded as applied. The
command was `supabase migration list --linked --workdir /Users/stew/Repos/pika`;
its local log is `/tmp/pika-billing-prod-migration-status-20260927.log`.

This explains the updated production schema summary in `.ai/CURRENT.md`.
It is separate from the local rehearsal below: this testing pass applied no
migrations and did not activate production billing. Previous application
permission is consumed and does not authorize any later schema change.

## Environment and method

- Used the existing local Pika database through migration 212, without resetting,
  reseeding, applying migrations, or modifying existing users/classrooms.
- Created six isolated local fixture users, initially Free. Used the existing
  Stripe sandbox with test credentials, never live credentials or real cards.
- Published all 12 approved catalog variants locally and verified idempotent
  registration against actual sandbox prices. No live catalog was published.
- Started the isolated local application on port 3199 and forwarded genuine
  Stripe events with Stripe CLI. Exercised actual login, purchase, status,
  catalog, webhook and worker HTTP routes, plus hosted Checkout in the browser.
- Used Stripe's documented [test cards](https://docs.stripe.com/testing): success,
  card decline, and 3D Secure authentication. No real money moved.
- The worker was invoked explicitly. These results do not prove a deployed
  scheduler, production connectivity, or automatic recovery cadence.

## Executed evidence

| Layer | Result |
| --- | --- |
| Billing unit/API suites | 18 files, 198 tests passed |
| Focused repository gate | 17 files, 162 tests passed; architecture, TypeScript and lint passed |
| Local foundation database contracts | Passed; transaction rolled back |
| Local checkout database contracts | Passed; transaction rolled back |
| Pika audit | Passed |
| Real sandbox catalog | 12 exact USD/CAD monthly/annual variants; registration replay preserved identity |
| Real HTTP authorization | Unauthenticated catalog 401; student purchase 403; foreign checkout 404; cross-origin purchase 403 |
| Real HTTP input bounds | Malformed JSON 400; purchase body over 4096 bytes 413; missing worker token 401; missing webhook signature 400 |

These counts overlap; do not add them. The CI-only binding/webhook concurrency
harness was deliberately not run against the shared local database. Final PR CI
must execute it in its disposable database. No student/teacher classroom UI
integration or billing lifecycle coverage is implied by the existing generic
authorization tests.

### Real payment and recovery cases

| Scenario | Observed outcome |
| --- | --- |
| Pro USD monthly, successful card | Stripe paid 1900 cents; worker assigned legacy `plus`, effective classroom quota 5, revision 2, exactly one invoice effect; public status `active` |
| Declined card, then successful retry in the same Checkout | Decline left Free/revision 1 with no binding or invoice effect; successful retry assigned Pro/quota 5 with one invoice effect |
| Basic CAD annual Checkout expired unpaid | Stripe expired the 13900-cent session; application status `expired`; account remained Free with no invoice effect |
| Max CAD annual, pending and failed 3D Secure | Pending authentication left Free with no invoice effect; explicit failure displayed authentication failure; retry allowed |
| Max CAD annual, successful authentication retry | Stripe paid 55900 cents; worker assigned legacy `pro`, effective quota 12, revision 2, one invoice effect |
| Repeating the completed purchase operation | Same attempt returned `active`; existing invoice effect and plan revision remained unchanged |
| Repeated worker processing | Already applied invoices returned replay; no additional plan revision or invoice effect |
| Basic USD annual with webhook forwarding stopped | Stripe paid 9900 cents while the account remained Free; two worker passes bound and verified it, assigning Basic with quota 2 with one invoice effect |

Three distinct paid offerings cover all public tiers, both currencies and both
billing intervals. All 12 catalog variants were verified, but this was not 12
separate successful card purchases. Currency changes, renewal invoices, and
annual/monthly transitions were not exercised against Stripe.

### Webhook cases and correction

Genuine `invoice.paid`, `customer.subscription.created`,
`checkout.session.completed`, and `checkout.session.expired` events reached the
local route with 200 responses. Different observed event orders converged on the
same paid assignment after the worker drained pending work.

Two new tests reproduced a defect: signed events containing empty `account` or
`context` strings bypassed truthiness checks. The corrected presence checks reject
both before persistence. Absent fields remain allowed, as does an explicitly
matching account. The regression tests failed before the correction and pass now.

Signed synthetic deliveries using the local test signing secret established:

- Identical event bytes submitted twice return 200 and do not duplicate effects.
- Stale signatures, invalid signatures, `livemode:true`, empty account and empty
  context each return 400.
- These synthetic deliveries are clearly separate from provider-originated
  events; they do not establish a real Stripe retransmission result.

An initial replay experiment fetched an existing event through the Stripe API
and serialized it again. It returned 500 because the stored raw-payload hash
conflicted. This is not a byte-identical delivery and was not counted as a
duplicate-delivery pass. The database intentionally rejects the same event ID
with changed bytes. A future replay tool must preserve original delivery bytes;
the operator-facing conflict response/alerting remains an operational follow-up.

## Remaining acceptance matrix

The following are **blocked by missing implementation or an unresolved contract**,
not passing tests and not features activated by this rehearsal.

| Priority | Flow | Required cases before launch |
| --- | --- | --- |
| P0 | Trial | One 30-day Pro trial per teacher; duplicate/concurrent starts; no card/charge; exact expiry; paid conversion and no stacked allowances |
| P0 | Renewal and grace | Verified renewal; failed renewal; seven elapsed days from previous paid-through; no initial-payment/trial/cancel grace; payment just before/at/after cutoff; recovery after delayed events |
| P0 | Cancellation and expiry | Cancel/undo; access until exact Stripe timestamp; cutoff at non-midnight times and Toronto DST; provider outage must not invent expiry; safe resubscription |
| P0 | Upgrade/proration | Same currency/interval at start/middle/end of term; authoritative quote and expiry; rounding; unchanged renewal date; failed charge retains old plan; concurrent requests cannot double-charge; no credit for unpaid time |
| P0 | Downgrade/interval change | Renewal scheduling; replace/cancel pending change; selected retained classrooms; deterministic recent-activity/tie fallback; cap enforcement; safe restoration |
| P0 | Publishing/tests | Block draft release and scheduled release after cutoff; no new test attempt/restart/retake; allow started attempts to original timer/deadline; missed schedules require manual release after recovery |
| P0 | Existing work and archives | Preserve published assignment use, grading, feedback, exports and data; subscription archive cannot enter ordinary purge; teacher/student/membership boundaries remain enforced |
| P0 | Customer billing surface | Pricing/annual-total/currency disclosure; active/pending/error states; working success/cancel return; status reflects effective access after operator overrides; portal restrictions; role/theme/viewport verification |
| P1 | Notices | Cancellation confirmation; future 7-day/24-hour reminders; immediate payment failure/grace deadline; expiry; deduplication; suppress obsolete notices after recovery |
| P1 | Purchased terms/cohorts | Old/new versions coexist; archived-price renewal preserves terms; explicit consent/notice and at least 60-day lead where required; renewal-only migration; duplicate/partial-failure recovery |
| P1 | Refunds/disputes/tax | Define entitlement consequences, then test first-purchase refund window and duplicate requests; dispute/refund reconciliation; approved tax configuration and totals |
| P1 | AI allowance | Finalize quantities and reset/rounding contract; usage/reservation ledger; trial/paid precedence; upgrades; warnings; no rollover/overage beyond approved rules |
| P1 | Operations | Scheduler cadence, exhaustion/requeue alerts, original-byte replay, provider interruption, concurrent workers and payment-versus-manual-plan races in disposable integration tests |

Unit and database tests already cover immutable versions, unknown price rejection,
unsupported financial terms, lost leases, bounded retries, malformed work,
manual-plan revision fences and initial-purchase eligibility. They cannot replace
the provider-backed lifecycle scenarios above. The separate unmerged lifecycle
calculator is not imported by this runtime and is excluded from the pass count.

The local `/billing?result=success` return route responded 404. Hosted Checkout
showed correct Pro monthly, Basic annual and Max annual descriptions/prices;
automatic browser return did not complete successfully in this rehearsal.
Customer billing UI is an explicit remaining launch requirement.

## Reproduction and continuation

```sh
pnpm exec vitest run tests/lib/billing tests/lib/server/billing tests/api/billing-purchase.test.ts tests/api/billing-stripe.test.ts
bash scripts/check-stripe-billing-foundation-database.sh
bash scripts/check-stripe-checkout-database.sh
pnpm check:focused -- --base origin/main
```

Provider rehearsal requires an explicitly isolated local runtime and existing
test-only credentials, the approved catalog, new identifiable fixtures, genuine
hosted Checkout and an authenticated worker. Never copy credentials or cookies
into the repository. Do not fake CI to run the concurrency harness on a shared
database. Retain fixture identifiers privately so cleanup touches only that run.

Next implementation order: lifecycle storage/services and timestamp boundaries;
then classroom enforcement; then customer UI/portal/notices; then the complete
Stripe lifecycle matrix above. Tax/refund/AI decisions remain explicit gates.


## Final recovery and cleanup evidence

With the Stripe listener stopped before Basic annual payment, the provider
reported paid while local access remained Free. Explicit reconciliation then
bound the checkout and applied exactly one verified invoice effect. The final
fixture quota vector was `[5, 5, 0, 12, 2, 0]`; invoice-effect counts were
`[1, 1, 0, 1, 1, 0]` for success, decline/retry, expired, authentication/retry,
missing-webhook recovery, and student respectively. All four paid accounts had
revision 2; expired/student accounts remained at revision 1.

Cleanup disabled the local database billing gate, expired any remaining open
Checkout sessions and canceled this run's four sandbox subscriptions without
proration or an additional invoice. The listener and local application were
stopped. Six local test users and their billing evidence are retained; the
original three users and one classroom were not reset or reseeded. Published
sandbox catalog rows remain local behind the disabled gate. No production
configuration or live Stripe object was changed by this testing pass.

The fixture plan rows intentionally retain their last verified grant: automatic
cancellation/expiry is not implemented, and cleanup is not evidence for it.
Private credentials, cookies and fixture identifiers stay outside the repository.
