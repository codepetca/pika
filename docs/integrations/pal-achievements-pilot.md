# Pal achievements pilot

This document is the Pika-side implementation and operations guide for the
achievement pilot designed in [Pal PR #32](https://github.com/codepetca/pal/pull/32)
and made executable by the shared event contract in
[Pal PR #35](https://github.com/codepetca/pal/pull/35).

The ownership boundary is intentionally small:

> Pika determines what happened and sends a privacy-safe fact. Pal determines
> what that fact earns and renders the achievement roadmap.

Pika does not send assignment titles, work, grades, raw IDs, deadlines, or an
assignment catalog. A deleted assignment or archived classroom therefore does
not require a mirrored cleanup operation in Pal. Facts that were true when
they occurred remain historical.

## Pilot switch and configuration

`PAL_ENABLED` is the pilot's only feature flag. It defaults to disabled.

```dotenv
PAL_ENABLED=false
PAL_API_URL=
PAL_INTEGRATION_SECRET=
PAL_PSEUDONYM_SECRET=
```

The other values are server-only connection settings, not feature flags.
`PAL_API_URL` is the Pal origin used for event ingest, read-token minting, and
the chrome-free `/embed/roadmap` route. `PAL_INTEGRATION_SECRET` authenticates
Pika's backend. `PAL_PSEUDONYM_SECRET` creates stable HMAC tokens and must never
be shared with Pal or the browser.

When the switch is false or absent:

- Achievements is absent from student navigation.
- No new Pal outbox rows or weekly configurations are written.
- The read-token route returns unavailable.
- Delivery workers do not claim queued rows.
- Existing queued and failed rows are preserved.

## Required rollout order

Do not enable the switch until all prerequisites are true:

1. Apply `111_pal_pilot_transactional_outbox.sql` to the intended Pika
   environment using the normal human-authorized migration procedure.
2. Configure all server-only Pal settings.
3. Confirm Pal accepts the six version 1 event shapes.
4. Confirm Pal implements `POST /api/v1/integration/read-token`.
5. Confirm Pal serves `/embed/roadmap` and supports the nonce-bound
   `postMessage` handshake below.
6. Enable `PAL_ENABLED=true` in the pilot environment only, preferably before
   learners act on the first day of a pilot week.

Pal must support a contract version before Pika emits it. The current Pal
prototype does not yet satisfy steps 3–5; keeping the switch off is the safe
default while those Pal-side dependencies are completed.

The pilot does not backfill actions that happened while the switch was off.
Enabling midweek is safe, but Pal will only receive facts asserted from that
point forward, so a clean pilot comparison should start at a week boundary.

## Signal chain

```text
Learner action
  -> Pika validates and commits its authoritative source record
  -> the same database transaction inserts a privacy-safe Pal event
  -> daily sync claims a bounded outbox batch with a lease
  -> POST <PAL_API_URL>/api/v1/events
  -> 2xx marks delivered
  -> network/408/429/5xx schedules bounded exponential retry
  -> other 4xx or contract-invalid payloads become non-retryable
  -> an operator inspects or explicitly requeues the retained row
```

Pal being unavailable never rolls back a Pika learner action. The outbox
stores its local source references for Pika reconciliation, but only `payload`
is transmitted.

## Initial source facts

| Fact | Authoritative Pika transition | Durable identity |
|---|---|---|
| `platform.session.started` | A student session cookie was successfully saved | learner + generated source session |
| `classroom.joined` | A new classroom enrollment row was inserted | learner + classroom |
| `daily_log_week.configured` | Pika calculated or revised that learner's weekly opportunities | learner + period + monotonic version |
| `daily_log.completed` | A qualifying log was saved | learner + Toronto activity date |
| `learning_item.viewed` | The learner's assignment document was created by a genuine first open | learner + item |
| `learning_item.completed` | The first authoritative valid submission transition succeeded | learner + item |

Daily log identity deliberately omits classroom, so several logs on the same
date produce one outbound fact. Learning-item identity deliberately survives
unsubmit/resubmit, so a second submission cannot create a second version 1
fact.

All event builders execute the exact dependency-free validator copied from
Pal commit `db9f22e22cbf971744bea7a78a8306f2ae787d65`. Its matching valid and
invalid fixtures live in `tests/fixtures/pal-contract-v1`. Change the contract
in Pal first, then replace the vendored source and fixtures together.

## Weekly Rhythm

The daily Pal sync calculates the current Toronto Monday–Friday week for every
currently enrolled learner and revises any existing configuration affected by
a schedule change, midweek enrollment, withdrawal, or archive. It unions class
days across classrooms, so the same date counts once.

The prior week is closed once. Eligible days can fall when an unmet
opportunity disappears, but never below the number of distinct completion
dates Pika already asserted. Short weeks therefore reach Pal as their actual
opportunity count; Pal owns the grace-day target and recurring Weekly Rhythm
award.

## Delivery and reconciliation

Vercel calls `GET /api/cron/pal-sync` daily with
`Authorization: Bearer <CRON_SECRET>`. It reconciles weekly configurations
before draining one delivery batch.

The same credential protects the focused outbox operations:

- `GET /api/cron/pal-outbox` — counts plus up to 25 privacy-safe pending or
  failed summaries; no payloads or learner/source IDs.
- `POST /api/cron/pal-outbox` — deliver one bounded batch.
- `PATCH /api/cron/pal-outbox` with `{ "outbox_id": "<uuid>" }` — explicitly
  requeue a retained non-retryable row after its cause is corrected.

Delivery rows use leases and `FOR UPDATE SKIP LOCKED`, so overlapping workers
cannot process the same attempt concurrently. Pal independently deduplicates
by the integration-scoped idempotency key.

Delivery is at least once and may be delayed or out of order. Pal must retain
qualified facts, apply weekly configuration revisions monotonically, and
re-evaluate affected achievement progress when a related fact or later
configuration revision arrives; correctness must not depend on HTTP arrival
order.

## Embedded roadmap

When enabled, students see Achievements in the existing classroom sidebar.
Pika loads Pal's chrome-free roadmap inside the normal content pane; the full
roadmap is not a Pika overlay.

The iframe authentication exchange is:

1. Pika loads `/embed/roadmap#pika_nonce=<per-load-random-nonce>`.
2. Pal posts `{ type: "pal.embed.ready", nonce }`.
3. Pika verifies the exact Pal origin, iframe window, and nonce.
4. Pika's authenticated backend mints a learner-scoped short-lived token from
   `POST /api/v1/integration/read-token`.
5. Pika posts `{ type: "pal.embed.authenticate", nonce, token, theme }` using
   the exact Pal `targetOrigin`. `theme` is either `light` or `dark`.
6. Pal posts `{ type: "pal.embed.authenticated", nonce }` before Pika reveals
   the iframe.
7. After authentication, Pika posts
   `{ type: "pal.embed.appearance", nonce, theme }` whenever its theme changes.
   Pal owns applying that appearance to the roadmap; Pika does not restyle or
   recreate Pal content.

The integration secret and raw learner ID never enter the browser. The token
is never placed in the iframe URL. An unavailable or incomplete Pal
implementation produces a bounded retry state while the rest of Pika remains
usable.

## Verification

Before enabling an environment:

```bash
pnpm exec vitest run \
  tests/lib/server/pal-contract.test.ts \
  tests/lib/server/pal-events.test.ts \
  tests/lib/server/pal-outbox.test.ts \
  tests/lib/server/pal-weekly-config.test.ts

pnpm exec tsc --noEmit
pnpm check:architecture
pnpm check:ui-policy
```

Then run a real pilot vertical slice only after Pal's prerequisites exist:

1. Start one authenticated student session.
2. Inspect a pending Pika outbox row without exposing its payload.
3. Run the delivery worker.
4. Confirm Pal records the fact once.
5. Replay the same Pika delivery and confirm no extra Pal progress or reward.
6. Open Achievements and confirm the token handshake and roadmap state.
