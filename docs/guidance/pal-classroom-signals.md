# Classroom Pal signals and presentation — Phase 2 implementation

Status: disabled implementation in progress. Migration169 applied once to the
existing local Pika database with exact approval; contracts and generated types
pass. Two database lint warnings, independent review and exact-head ready-PR CI
remain outstanding. This is not Phase 2 completion.
The [approved six-phase roadmap](classroom-pal-and-student-cleanup-plan.md) is
the single phase/approval authority. Risk: runtime-platform.

## Signal ownership

Migration 169 captures source facts in the academic transaction. It reuses
`pal_event_outbox` for payloads, leases, bounded retries and delivery outcomes.
Private outbox bindings retain the immutable enrollment generation, opaque
provider identity and internal source scope. Only validated v1 payloads leave
Pika. Private membership/week versions never read legacy configurations or
completion evidence.

| Existing event family | Fresh membership fact and deduplication |
|---|---|
| `classroom.joined` | Successful new enrollment; once per generation |
| `platform.session.started` | Authenticated same-origin classroom visit; once per Toronto day per generation; no login broadcast |
| `daily_log.completed` | Nonblank current Toronto-date log on a class day; once per generation/date |
| `learning_item.viewed` | First recorded view of a released assignment; once per generation/item |
| `learning_item.completed` | First submitted transition; once per generation/item, including unsubmit/resubmit |
| `daily_log_week.configured` | This membership's class days and fresh completion floor; monotonic generation/week revisions |

Fresh facts use `pika:membership:v1:` idempotency keys and the persisted
`pika-membership-v1-*` learner reference. Classroom/item/term tokens are scoped
to that random reference. Existing `pika:v1:` payloads are preserved unchanged.
Historical source rows predating activation and archive restores produce no
new facts, including later edits or submissions of those rows. Rows created
under an earlier enrollment cannot generate facts for a re-added membership.
Weekly sync creates only the current week and closes only previously
recorded membership weeks, at most 12 old periods per member. It never scans
academic history to award old activity.

The sync worker processes at most 100 generations per invocation with a durable
cursor. A transaction lock serializes concurrent planners; leases serialize
delivery. Immediate post-commit delivery claims at most three events belonging
to the action's current membership and returns within two seconds. Provider
outages preserve committed academic work and leave queued retries. Existing
cron timing remains unchanged. Capacity, backlog latency and the v1 five-day
weekly opportunity ceiling require pilot evidence before a supported rollout
population can be declared.

## Disabled controls and compatibility

- `PAL_CLASSROOM_ENABLED=true` selects classroom routing, strictly and server-side.
- `PAL_MEMBERSHIP_IDENTITY_ENABLED=true` and Phase 1's private database gate are
  also required for successful context resolution.
- `private.pal_classroom_signal_settings.enabled` defaults false; enabling it
  also requires an activation timestamp, which cannot subsequently be renamed.
- Existing `PAL_ENABLED` and provider configuration still gate network use.

Installation changes no ordinary-user behavior. Neither database gate nor any
application flag is enabled by this change. Source capture has no network
dependency. When database classroom capture is enabled, legacy enqueues and
batch claims are quiesced; existing queued data remains in its legacy namespace.
An already in-flight legacy application/server or token is a Phase 5 coordinated
cutover concern, not a completed rollout claim here. A classroom client that
outlives flag disablement cannot obtain a fallback account token.

The schema adds private tables and service-only JSON RPCs, with no browser
database path. Migration169 local approval was consumed by one successful
application. Canonical public types were regenerated and checked; direct typed
RPC calls replace the temporary adapter. Production remains through168. Any
forward correction requires its own exact-target approval.

## Presentation and provider boundary

The legacy provider remains at the classroom-family layout only while classroom
routing is off. The new path resolves context on the authenticated classroom
page and mounts the existing widget with an opaque generation-specific key.
The provider, browser token cache, refresh notifications and pending rewards
are isolated across classroom switches. Token responses must match the current
scope. Full widget remount and its existing aborted/stale-request protections
discard earlier classroom responses. Visits are emitted only by a mounted
browser surface, never by server rendering or prefetch.

The server token broker caches by provider origin/credential fingerprint and
opaque membership reference. Every request reauthorizes before and after the
mint/cache result. Worker sends likewise check generation and lease before
HTTP and recheck before recording success. These are snapshots: removal can
still race a provider request, and issued tokens remain valid at Pal until its
own revocation/fencing support exists. Observing removal drops the result or
terminates delivery; it cannot undo a provider-side effect already committed.

Pal was inspected read-only at `69c3c91`. Current v1 events and the integration
read-token endpoint accept the opaque identity without contract changes. The
read-token endpoint provisions identities, so no live mint/provisioning test
was run. Required Phase 3 provider work remains an authenticated exact-profile
deletion operation, durable idempotent completion evidence, token revocation,
and serialization/fencing of ingest, provisioning and scheduler work once
removal begins. No Pal or Bara repository code is changed here.

## Evidence and remaining gates

- Unit/API coverage: disabled gates, strict response/body schemas, actor binding,
  before/after membership checks, wrong-generation rejection, no fallback,
  namespaced claims, outage retry and bounded post-commit delivery.
  Final source gate passed 1,854 tests across 203 files, architecture, UI/design
  policy, TypeScript and lint; the pre-commit Pika audit passed.
- Browser contract: the installed widget, token client, classroom switches,
  reload, logout and delayed prior-class rewards use synthetic intercepted
  responses; all four viewport/theme cases passed on 2026-09-12. Eight ordinary
  teacher/student classroom cases also passed with rollout disabled (14 tests
  including auth setup); all 12 resulting screenshots were inspected.
- Database fixture: `check-pal-classroom-database.sh` targets only the existing
  local `pika` database and runs synthetic rows/settings in a rolled-back
  transaction. It never applies migrations or resets a database. Execution
  passed after approved local169 application, including concurrent planner exclusion.
- Local receipt: full ledger001–169 matches after pending-only169 preview and
  one successful application of SHA256
  `e98c01b2df3986aabf7f0539605f97ee742503a13020ec5b37331a3db55b63bd`.
  Both database gates remain false and activation is null. Sanitized receipt is
  `/Users/stew/.codex/metrics/pika-local-pal-migrations.jsonl`.
- Database lint found two merge blockers: term-calendar volatility is overstated,
  and the visit function retains an unread variable. A forward correction will
  be batched with independent review findings; applied169 will not be rewritten.
- [UI change brief](ui/pal-classroom-phase2-brief.md) records reuse and the
  required teacher/student, desktop/mobile, light/dark matrix.

Source-local evidence is not deployed provider compatibility, end-to-end
revocation/removal security, production rollout, or full-phase completion.
