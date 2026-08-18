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
Pal or the browser. Both secrets must be distinct and at least 32 characters;
use independently generated high-entropy values rather than human phrases.

`PAL_API_URL` must be an HTTPS origin with no credentials, path, query, or
fragment. Loopback HTTP is allowed only outside production. When
`PAL_ENABLED=true`, incomplete or unsafe configuration fails at the feature
gate instead of silently running authoritative learner actions without their
achievement fact. The optional browser widget is contained separately: invalid
widget configuration removes its navigation and shell surfaces instead of
blocking academic pages. Authenticated-session telemetry remains best-effort so
an adapter outage cannot invalidate a genuine login.

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
5. Publish a reviewed `@codepet/pal-widget` package version exposing
   `@codepet/pal-widget/theme-contract`.
6. Mount the native widget surfaces, import
   `@codepet/pal-widget/styles.css` once, wrap each surface in
   `PalWidgetThemeBoundary`, and pass Pika's scoped theme, density, viewport,
   and motion values.
7. Run the Pika/Pal theme-contract drift test and visual verification matrix.
8. Enable `PAL_ENABLED=true` in the pilot environment only, preferably before
   learners act on the first day of a pilot week.

Pal must support a contract version before Pika emits it. Pika pins the reviewed
public `@codepet/pal-widget@0.1.0-alpha.2` release exactly. Keep the switch off
until steps 3–7 are complete in the target environment.

The pilot does not backfill actions that happened while the switch was off.
Enabling midweek is safe, but Pal will only receive facts asserted from that
point forward, so a clean pilot comparison should start at a week boundary.

## Signal chain

```text
Learner action
  -> Pika validates and commits its authoritative source record
  -> the same database transaction inserts a privacy-safe Pal event
  -> after commit, Pika claims that specific outbox row
  -> Pika attempts POST <PAL_API_URL>/api/v1/events for at most two seconds
  -> 2xx marks delivered and the browser refreshes the learner Pal snapshot
  -> network/408/429/5xx keeps the event queued with exponential backoff
  -> daily sync recovers queued, expired-lease, and backlog events
  -> other 4xx or contract-invalid payloads become non-retryable
  -> an operator inspects or explicitly requeues the retained row
```

Pal being unavailable never rolls back a Pika learner action. The outbox
stores its local source references for Pika reconciliation, but only `payload`
is transmitted. Immediate delivery starts only after the source transaction
commits and catches every adapter failure, so it can add bounded response
latency but cannot turn a completed Pika action into an error.

## Reusable SaaS integration pattern

The pilot uses a provider-owned integration boundary that can be reused for
future Pika services:

- Pika owns academic source data and decides when a domain fact is true.
- The provider owns its derived state, rules, database, and UI package.
- Pika sends versioned, privacy-minimized facts with stable pseudonymous IDs;
  it does not mirror the provider's database or embed provider rules.
- Pika atomically records each outbound fact beside the source change, then
  makes a bounded post-commit delivery attempt for responsive UX.
- A durable asynchronous worker remains the correctness and outage-recovery
  path. Both sides use the same idempotency key because delivery is at least
  once, not exactly once.
- The provider's browser client refreshes only after Pika confirms a new
  delivery. Periodic polling remains a stale-state safety net.

This is the same broad separation used by mature SaaS integrations: a narrow
API/contract connects independently owned systems, while installation secrets,
identity mapping, retries, observability, and lifecycle controls remain in the
host adapter. The synchronous attempt is a latency optimization over the
transactional outbox, not a replacement for it.

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
Pal commit `88bab8e30319089e45d7f5e129e76dd265bc2b4c`. Its matching valid and
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

Prospective current-week configurations also include Pika's complete adaptive
term calendar: an opaque HMAC term token, Toronto term boundaries, the
authoritative 6–24 week count, and the current week start/index. The calendar
uses Monday-aligned February, July, and September boundaries so the global
learner opportunity week cannot straddle two Pal terms. An existing open current
week receives one monotonic calendar-bearing revision. Historical calendar-less
weeks are only closed and are never upgraded, so this rollout does not backfill
story collectibles. A later closure preserves calendar metadata when that week
already carried it.

Pika emits only academic facts and this calendar. Pal exclusively calculates
and owns story collectibles, visual finish tiers, XP, and achievements.

## Delivery and reconciliation

Each user-triggered fact first gets one targeted post-commit delivery attempt.
The adapter claims by idempotency key, uses a 60-second lease, and caps the
attempt at two seconds. A competing worker can win the claim, in which case the
request does not send a duplicate. Once a request receives a 2xx response and
records the row as delivered, it tells the mounted widget provider to refresh;
the existing 60-second widget poll remains fallback protection.

Vercel separately calls `GET /api/cron/pal-sync` daily with `Authorization:
Bearer <CRON_SECRET>`. The cron has two recovery responsibilities: reconcile
weekly configurations that are not tied to a single learner request, then
drain queued delivery failures and backlog. It processes up to 10 batches of
20 events within an eight-second worker budget. The response reports batches,
stop reason, and the number of rows still ready, so capacity exhaustion is
visible rather than silently deferred for a day.

The worker budget covers database claims, Pal requests, delivery-state
transitions, and the final ready count. A hard caller deadline still returns a
sanitized `deadline` telemetry outcome if an adapter ignores cancellation.

Each batch uses at most 10 concurrent deliveries. Network attempts are bounded
by the worker's remaining deadline, which stays well inside the 60-second row
lease so an overlapping worker cannot reclaim a slow in-flight batch.

The same credential protects the focused outbox operations:

- `GET /api/cron/pal-outbox` — counts plus up to 25 privacy-safe pending or
  failed summaries; no payloads or learner/source IDs. Its `observability`
  block reports the exact ready and retrying counts, expired leases, oldest
  ready age measured from `next_attempt_at` or an expired `lease_expires_at`,
  and p50/p95/max end-to-end delivery latency from up to the latest 500
  deliveries in the previous 24 hours.
- `POST /api/cron/pal-outbox` — deliver one bounded batch.
- `PATCH /api/cron/pal-outbox` with `{ "outbox_id": "<uuid>" }` — explicitly
  requeue a retained non-retryable row after its cause is corrected.

Immediate attempts emit one privacy-safe structured `[pal-delivery]` log with
delivery mode, event type, outcome, and duration. Daily recovery emits one
`[pal-outbox-drain]` log with claimed, delivered, retrying, non-retryable,
remaining-ready, stop-reason, and duration fields. These logs deliberately omit
idempotency keys, learner IDs, source IDs, payloads, and error bodies. Use the
protected status endpoint for current backlog and retained error-code detail;
use the structured logs for latency and outcome trends in Vercel.

Batch delivery rows use leases and `FOR UPDATE SKIP LOCKED`; targeted delivery
uses a conditional pending-row update with the same lease fields. Overlapping
requests or workers therefore cannot claim the same attempt concurrently. Pal
independently deduplicates by the integration-scoped idempotency key.

Delivery is at least once and may be delayed or out of order. Pal must retain
qualified facts, apply weekly configuration revisions monotonically, and
re-evaluate affected achievement progress when a related fact or later
configuration revision arrives; correctness must not depend on HTTP arrival
order.

## Native widget boundary

The rollout target is the native React `@codepet/pal-widget` package. When enabled,
students see Achievements in the existing classroom sidebar.
`PalAchievements` renders inside the normal content pane; the full roadmap is
not a Pika overlay. `PalCompanion` and `PalRewardCelebration` mount only in
Pika-approved host layers.

Pika imports Pal's stylesheet but does not copy it. The
`PalWidgetThemeBoundary` wrapper aliases current Pika semantic tokens into the
public `--pal-*` inputs. `PalProvider` receives the active theme plus explicit
`density`, `viewport`, and motion values. Pal does not inspect Pika routes,
roles, Tailwind breakpoints, theme context, or `@/ui` components. Pika's
canonical `ModalLayer` owns reward portal/dialog semantics, inertness, focus,
Escape/backdrop policy, and scroll lock. Pal renders reward content with
`hostManaged`; every host close path acknowledges the pending reward and a
failed acknowledgement leaves the same reward visible and retryable.
Pika suppresses ambient companion and reward layers on the student Tests
surface so Pal cannot interrupt an assessment; pending rewards appear after the
learner leaves that surface.

The package contract is the single machine-readable theme authority; Pika does
not retain a vendored copy. `StudentAchievementsTab` renders the native roadmap
component directly and contains Pal loading/error/retry states inside the
Achievements pane. The companion and reward layers share the same learner
provider without creating an iframe or a second application shell.

The integration secret and raw learner ID never enter the browser. The token
is supplied only through Pal's learner client and cached until its server-provided
`expires_at` enters the safe refresh window. Pika also creates a fresh opaque
scope generation in the persistent authenticated student classroom layout. The scope is
not a learner identifier and is never sent to Pal; it only prevents an in-flight
or cached snapshot from one authenticated session from appearing in another.
The provider therefore survives classroom route and tab changes but unmounts
before the user can leave that authenticated route family and switch sessions.
An unavailable, incomplete, or synchronously failing Pal implementation falls
back to the unchanged Pika classroom shell. Pika rejects malformed or
already-expired read tokens and caps accepted token lifetime at ten minutes,
with a small allowance for server clock skew.

## Verification

Before enabling an environment:

```bash
pnpm exec vitest run \
  tests/lib/server/pal-contract.test.ts \
  tests/lib/server/pal-term-calendar.test.ts \
  tests/lib/server/pal-events.test.ts \
  tests/lib/server/pal-outbox.test.ts \
  tests/lib/server/pal-weekly-config.test.ts \
  tests/integration/pal-weekly-story-collectibles.test.ts

pnpm exec tsc --noEmit
pnpm check:architecture
pnpm check:ui-policy
bash scripts/check-pal-outbox-concurrency.sh
pnpm run smoke:pal-delivery-recovery
```

The PostgreSQL harness creates and drops a disposable database, replays the
current migrations, and proves that two concurrent workers produce exactly one
winner for pending and expired batch claims as well as the conditional UPDATE
used by targeted delivery. The recovery smoke command refuses non-loopback
Supabase targets, atomically records one adaptive weekly configuration and its
outbox event, receives a real HTTP 503, proves durable retry evidence, restores
the local HTTP peer, drains the queued event once with the same idempotency key,
and removes the fixture.

Then run a real pilot vertical slice only after Pal's prerequisites exist:

1. Start one authenticated student session.
2. Complete one achievement-bearing learner action and confirm its response
   reports `pal_delivery: "delivered"`.
3. Confirm the mounted companion/roadmap refreshes without waiting for the
   60-second poll and Pal records the fact once.
4. Replay the same idempotent Pika action and confirm no extra progress,
   reward, delivery, or browser refresh.
5. Make Pal temporarily unavailable, repeat an action, and confirm Pika still
   succeeds while the event remains queued.
6. Restore Pal, run the delivery worker, and confirm the queued fact is applied
   once.

Do not deliberately interrupt the production Pal service to perform step 5.
Use the guarded local recovery smoke for the outage path. In a deployed pilot,
verify the success path with a dedicated or already-authorized learner account,
then inspect the protected status endpoint and `[pal-delivery]` log for the same
time window. Production verification must not create a testing backdoor, expose
integration credentials to a preview, or reuse a real learner's identity as a
fixture.
