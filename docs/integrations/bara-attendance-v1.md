# Bara attendance adapter v1

Status: local adapter and native student flow implemented; hosted gates remain.
Pure v1 types, validators, provider fixtures, and signing are vendored
from Bara, and the disabled Pika server client can send a signed roster
or materialized schedule snapshot plus authorized open/close commands to
Bara's tested adapter. Pika now has a signed event-ingress route, transactional
inbox, and monotonic session/record projections; Bara delivers through a leased
retrying outbox. Bounded staff marks/corrections and signed authoritative
snapshot reconciliation are also implemented. Pika now exposes owner-authorized
manual session and bounded bulk-mark routes that translate only inside the
server from Pika IDs to private contract references, use request-scoped
idempotency, require a linked WorkOS actor, and return no service identifiers.
Those teacher commands are now staged in a private leased outbox before the
signed request; retryable failures remain recoverable through a bounded,
cron-secret-protected drain route. Every automated or operator drain now ends
with an aggregate-only health read; unresolved or permanent work returns an
unhealthy HTTP status instead of a false success, without exposing roster,
classroom, payload, contract-reference, or provider-error details.
The teacher QR slice is also implemented locally: Pika requests a bounded
presentation from Bara through the signed adapter, encrypts it into a Pika-owned
entry URL, and keeps the raw Bara token out of Pika persistence and logs. The
student stays in Pika, which derives the actor from its verified server session
and renders Bara's synchronous authoritative result.
The additive Supabase migration
has not been applied to a live environment, and no production rollout is
enabled yet.

Automatic schedule materialization is now wired locally: a daily,
secret-protected Pika worker advances a rolling 90-day class-day horizon for
the least-recently-staged eligible classrooms and drains the durable outbox.
This worker prepares future occurrences; Bara's independent scheduler remains
responsible for opening and closing them at their exact UTC instants.

A separate daily reconciliation worker repairs missed-event divergence. It
selects at most 50 active or recently closed occurrences from a 48-hour window,
least-recently reconciled first, and applies Bara's signed authoritative
snapshots with bounded concurrency. Failed or truncated work returns HTTP 503
with aggregate counts only. Keeping this job separate prevents reconciliation
from consuming the schedule/outbox worker's serverless time budget.

The unapplied migration now also defines Pika-private durable mappings from
classrooms, enrolled students, and class dates to random contract references,
plus a teacher-local Toronto attendance-window policy. The authenticated
read-only teacher route joins authoritative projections through those mappings
and strips all opaque service references before returning browser-facing state.
It returns a disabled view without touching the unapplied integration tables;
configured database reads remain gated on applying migration 126.

Pika also exposes an authenticated owner-only attendance-policy API backed by
an optimistic-concurrency RPC. This supplies the missing local class window for
schedule materialization without teaching Bara about Pika class-day tables or
guessing a universal school-day window.

The native Attendance action bar exposes that policy as explicit Toronto
opening and closing times, including an intentional next-day close option. It
does not invent defaults. Saving requests an immediate bounded sync; a failed
delivery preserves the saved policy and reports that automatic recovery will
retry instead of presenting an unconfirmed schedule as current.

Pika owns classroom, enrolment, class-day, and teacher scheduling intent. Bara
owns attendance execution and audit history. Pika integrates through versioned
HTTP requests and privacy-minimized events; it never imports Bara code, calls
Convex directly, shares database tables, or stores Convex IDs.

## Reused Pal architecture

The useful Pal pattern is retained:

- a disabled-by-default server adapter;
- pure vendored contract types, closed validators, and shared fixtures;
- random integration references instead of raw local IDs;
- source change plus outbox/inbox work committed atomically;
- bounded immediate delivery for responsive UI plus a durable worker for
  correctness;
- at-least-once delivery, idempotency keys, leases, backoff, and explicit
  non-retryable retention;
- privacy-safe operational telemetry and an authoritative reconciliation path.

The unapplied migration now provides the Pal-style Pika outbound transport:
contract-validated payload staging, idempotency conflict detection, leases,
bounded exponential retry, explicit non-retryable retention, cached closed
responses, a recovery drain, and service-role-only aggregate backlog health.
Manual session and mark commands use it.
Roster and schedule producers now use the same transport through source-token
preparation and locked staging RPCs: each source revision and its outbox message
commit atomically, and a concurrent source change returns a stable retry
conflict. The RPCs remain unapplied and therefore are not yet database-tested.
An adequately frequent production worker is also deliberately unconfigured;
the current no-charge Vercel cron policy cannot be assumed to meet live
attendance latency. Those items remain rollout gates.

Attendance differs from achievements because it is bidirectional and
operational. Pika sends roster/schedule desired state and staff commands. Bara
publishes actual session and attendance events. Both products retain the data
they need; Bara is not a derived-statistics cache.

## Pika adapter responsibilities

1. Generate durable random `roster_ref`, `participant_ref`, and
   `occurrence_ref` mappings. Never transmit Supabase IDs.
2. Keep a minimal operational roster replica in Bara: display name and active
   state, with no school email by default.
3. Link a verified student by a separate WorkOS-subject assertion. Bara must
   resolve it through its own `auth_identities`; it is never an ownership ID.
   Each roster snapshot also includes the owning staff user's verified WorkOS
   subject so Bara can resolve the corresponding Bara `app_user` before
   assigning ownership.
4. Materialize explicit UTC occurrence windows from Pika class days and a
   teacher-owned local attendance-window policy.
5. Authorize every browser action in Pika, then call Bara from the server with
   the installation credential and verified WorkOS actor subject. Bara performs
   its own access check.
6. Commit received Bara events to an inbox and update the Supabase attendance
   projection in the same transaction. Reject roster/occurrence or participant
   references that do not resolve to the same local classroom. Use
   session/record revisions to ignore duplicates and stale delivery.
7. Reconcile active/recent sessions from Bara snapshots so webhook loss cannot
   become permanent divergence. Rotate least-recently reconciled occurrences
   through a bounded, aggregate-only worker and fail closed on mapping drift.

## Schedule input

Pika `class_days` identifies dates, so the local adapter adds a teacher-owned
classroom attendance-window policy before automatic opening is enabled. Pika,
not Bara, combines that policy and class dates. Bara receives concrete
`opens_at` and `closes_at` UTC instants and simply executes them.

## Proposed boundaries

Pika calls Bara under `/api/integrations/pika/v1/*` for roster snapshots,
future occurrence snapshots, open/close commands, batch marks, QR retrieval,
and reconciliation snapshots. Bara posts events to Pika at
`/api/integrations/attendance/v1/events`.

The initial event set is session scheduled/opened/closed/cancelled and
attendance record changed. Event payloads use only opaque integration
references, a cross-system correlation reference, revisions, status, source,
actor type, and bounded reason codes.
They exclude names, emails, internal IDs, check-in tokens, provider responses,
and free-form notes. Pika validates that each received roster, occurrence, and
participant reference belongs to one local classroom before committing the
event or an authoritative snapshot.

Pika's Attendance tab reads Pika's projection and issues Pika commands. It does
not embed the Bara app. Pika requests the current presentation with signed
`POST /api/integrations/pika/v1/sessions/{occurrence_ref}/check-in`; the actor
assertion stays in its closed JSON body instead of a query string. The returned
path is exposed to the browser only as the Pika entry
`/attendance/check-in/{token}`. A signed-out student passes through the existing
Pika email/passcode screen, establishes the Pika WorkOS session, and returns to
that exact Pika entry. Pika's server validates the encrypted entry, verifies the
student's Pika session and local WorkOS link, and invokes Bara's versioned
`student_check_in` command. The browser never opens Bara and no Bara browser
session is required. The durable phased decision and release
gates live in
`docs/integrations/pika-bara-native-attendance-roadmap.md`.

The roster request signs the exact method, pathname, Unix-second timestamp,
nonce, and raw JSON body. Pika sends only the configured opaque installation
reference and secret from its server. It accepts only the closed response of
outcome, roster reference, revision, and aggregate counts; an unexpected field
such as a Convex ID fails the request.

The complete ownership, privacy, route, event, versioning, and acceptance
baseline is maintained in Bara's
`docs/system/pika-bara-contract-v1.md`. The next gate is an explicitly
authorized hosted-development migration and a real
roster/schedule/session/mark/event/snapshot/QR round trip. The Attendance UI
remains disabled by configuration until that gate passes. Its teacher flow,
state family, and Pika-owned view-model boundary are maintained in
`docs/guidance/pika-attendance-teacher-surface-v1.md`.

## Hosted rollout preflight

Run `pnpm attendance:rollout:preflight` only with the target deployment's
environment loaded. It requires explicit stage, expected non-secret Supabase
refs, and exact Pika app and Bara API origins. The preview audit fails if it shares the
production Supabase ref, uses a non-Staging WorkOS API key, leaves mock or
WorkOS-default Magic Auth email enabled, turns on the retired browser-handoff
flag,
omits the Brevo delivery contract, or reuses session/cron/transport/event/entry
secrets. Output contains only aggregate
counts and failed check identifiers; it never includes configured values.

Example operator shape:

```bash
pnpm attendance:rollout:preflight -- \
  --stage preview \
  --expected-supabase-ref "$PIKA_PREVIEW_SUPABASE_REF" \
  --production-supabase-ref "$PIKA_PRODUCTION_SUPABASE_REF" \
  --expected-pika-origin "$PIKA_PREVIEW_ORIGIN" \
  --expected-bara-api-origin "$BARA_PREVIEW_CONVEX_SITE_ORIGIN"
```

This environment preflight does not replace the database gate. Before applying
migration 126, separately prove the expected preview hostname resolves, bind a
non-persisted database credential to that exact ref, inspect remote migration
history, and dry-run the additive migration. After applying it, run the full
signed cross-app smoke before enabling a pilot classroom.

The hosted scan measurement procedure is deliberately separate from this
environment audit. Follow `docs/integrations/bara-attendance-scan-load.md`
only after the isolated preview migration and signed smoke pass. The harness
refuses production and emits aggregate results only.

The 2026-08-17 read-only audit found that Vercel Preview still referenced a
deleted Supabase project whose hostname no longer resolves, while Production
uses the healthy `Pika` project. WorkOS and Bara integration variables were not
present in Preview, and its existing `SESSION_SECRET` value was empty. Do not
reuse the production Supabase project, enable the integration, or apply
migration 126 until an isolated preview target exists.

A same-day Supabase CLI recheck found two active healthy Free projects (`Pika`
and `Codepet HQ`) plus an inactive project named `Attend`. Supabase currently
allows two active Free projects across the account, and paused projects do not
count toward that limit or incur compute charges. Do not resume or repurpose
`Attend`: its ownership and retained data have not been verified. The clean
no-charge route is to obtain explicit permission to pause one named active
project, provision a fresh Pika Preview target, and then obtain the separate
one-time authorization required by the schema rollout checklist to apply only
migration 126 to that staging target.

References: [Supabase Free Plan billing](https://supabase.com/docs/guides/platform/billing-on-supabase)
and [project pausing](https://supabase.com/docs/guides/platform/free-project-pausing).
