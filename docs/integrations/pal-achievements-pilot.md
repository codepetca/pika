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
learner widget reads. `PAL_INTEGRATION_SECRET` authenticates Pika's backend.
`PAL_PSEUDONYM_SECRET` creates stable HMAC tokens and must never be shared with
Pal or the browser.

`PAL_API_URL` must be an HTTPS origin with no credentials, path, query, or
fragment. Loopback HTTP is allowed only outside production. When
`PAL_ENABLED=true`, incomplete or unsafe configuration fails at the feature
gate instead of silently running authoritative learner actions without their
achievement fact. Authenticated-session telemetry remains best-effort so an
adapter outage cannot invalidate a genuine login.

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
5. Publish a reviewed `@pal/widget` package version exposing
   `@pal/widget/theme-contract`.
6. Replace the interim iframe host with the native widget surfaces, import
   `@pal/widget/styles.css` once, wrap the provider in
   `PalWidgetThemeBoundary`, and pass Pika's scoped theme, density, viewport,
   and motion values.
7. Run the Pika/Pal theme-contract drift test and visual verification matrix.
8. Enable `PAL_ENABLED=true` in the pilot environment only, preferably before
   learners act on the first day of a pilot week.

Pal must support a contract version before Pika emits it. The current package is
private and unpublished, so the switch must remain off until steps 3–7 are
complete.

The pilot does not backfill actions that happened while the switch was off.
Enabling midweek is safe, but Pal will only receive facts asserted from that
point forward, so a clean pilot comparison should start at a week boundary.

## Signal chain

```text
Learner action
  -> Pika validates and commits its authoritative source record
  -> the same database transaction inserts a privacy-safe Pal event
  -> daily sync drains bounded outbox batches with leases
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
Pal commit `cd9fc872b646b8c91551fd44f9b4b36725ab0fe4`. Its matching valid and
invalid fixtures live in `tests/fixtures/pal-contract-v1`. Both the event
envelope and each event's metadata are closed allow-lists; unexpected fields
are rejected before delivery. Change the contract in Pal first, then replace
the vendored source and fixtures together.

## Weekly Rhythm

The daily Pal sync calculates the current Toronto Monday–Friday week for every
currently enrolled learner and revises any existing configuration affected by
a schedule change, midweek enrollment, withdrawal, or archive. It unions class
days across classrooms, so the same date counts once.

Every open week before the current week is closed once. Recovery handles up to
12 missed periods per daily run and reports whether another catch-up run is
needed. Eligible days can fall when an unmet opportunity disappears, but never
below the number of distinct completion dates Pika already asserted. Short
weeks therefore reach Pal as their actual opportunity count; Pal owns the
grace-day target and recurring Weekly Rhythm award.

## Delivery and reconciliation

Vercel calls `GET /api/cron/pal-sync` daily with
`Authorization: Bearer <CRON_SECRET>`. It reconciles weekly configurations
before draining up to 10 batches of 50 events within an eight-second worker
budget. The response reports batches, stop reason, and the number of rows still
ready, so capacity exhaustion is visible rather than silently deferred for a
day.

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

## Native widget boundary

The rollout target is the native React `@pal/widget` package. When enabled,
students see Achievements in the existing classroom sidebar.
`PalAchievements` renders inside the normal content pane; the full roadmap is
not a Pika overlay. `PalCompanion` and `PalRewardCelebration` mount only in
Pika-approved host layers.

Pika imports Pal's stylesheet but does not copy it. The
`PalWidgetThemeBoundary` wrapper aliases current Pika semantic tokens into the
public `--pal-*` inputs. `PalProvider` receives the active theme plus explicit
`density`, `viewport`, and motion values. Pal does not inspect Pika routes,
roles, Tailwind breakpoints, theme context, or `@/ui` components.

The adapter, vendored contract manifest, and their drift tests can land before
package publication. They do not make the interim iframe themeable: CSS custom
properties do not cross an iframe origin. `StudentAchievementsTab` remains a
disabled prototype on this branch and must be replaced, not enabled, after the
package release.

The integration secret and raw learner ID never enter the browser. The token
is supplied only through Pal's learner client. An unavailable or incomplete Pal
implementation produces a bounded retry state while the rest of Pika remains
usable. Pika rejects malformed or already-expired read tokens and caps accepted
token lifetime at ten minutes, with a small allowance for server clock skew.

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
