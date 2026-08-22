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
idempotency, require a linked Pika actor, and return no service identifiers.
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
The additive Supabase history was replayed from scratch against the disposable
local stack before hosted use. Production migrations through 131 are now
recorded as applied to the named Pika project under separate authorization, and
the exact canary has prior evidence; no broader production rollout is enabled.

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

Migration 127 also defines Pika-private durable mappings from
classrooms, enrolled students, and class dates to random contract references,
plus a teacher-local Toronto attendance-window policy. The authenticated
read-only teacher route joins authoritative projections through those mappings
and strips all opaque service references before returning browser-facing state.
It returns a disabled view without touching integration tables while the
feature is not ready. Migration 127 provides the base schema; the completed
production canary proof additionally used migrations 129 and 130. This
operational-recovery release requires separately authorized migration 131 and
both global attendance flags remaining false until the exact-pair deployed
pre-enable gate passes.

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

Migration 127 provides the Pal-style Pika outbound transport:
contract-validated payload staging, idempotency conflict detection, leases,
bounded exponential retry, explicit non-retryable retention, cached closed
responses, a recovery drain, and service-role-only aggregate backlog health.
Manual session and mark commands use it.
Roster and schedule producers now use the same transport through source-token
preparation and locked staging RPCs: each source revision and its outbox message
commit atomically, and a concurrent source change returns a stable retry
conflict. Local reset/replay and the attendance database regression now prove
the RPC privileges, dependency ordering, and destructive-operation fences.
An adequately frequent hosted worker is still deliberately unconfigured;
the current no-charge Vercel cron policy cannot be assumed to meet live
attendance latency. Those items remain rollout gates.

Attendance differs from achievements because it is bidirectional and
operational. Pika sends roster/schedule desired state and staff commands. Bara
publishes actual session and attendance events. Both products retain the data
they need; Bara is not a derived-statistics cache.

## Pika adapter responsibilities

1. Generate durable random `roster_ref`, `participant_ref`, `occurrence_ref`,
   and `principal_ref` mappings. Never transmit Supabase IDs or WorkOS subjects.
2. Keep a minimal operational roster replica in Bara: display name and active
   state, with no school email by default.
3. Verify WorkOS only inside Pika, then translate the linked Pika user to a
   random `principal_ref`. Bara provisions or resolves that opaque principal
   only inside the signed installation. Standalone Bara WorkOS identities are
   never searched or reused by the Pika adapter.
4. Materialize explicit UTC occurrence windows from Pika class days and a
   teacher-owned local attendance-window policy.
5. Authorize every browser action in Pika, then call Bara from the server with
   the installation credential and opaque Pika actor principal. Bara performs
   its own installation, tenant, roster, role, and lifecycle checks.
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
`docs/system/pika-bara-contract-v1.md`. The current recovery gate is an
explicitly authorized production application (or verified prior application)
of Pika migration 131 while attendance is disabled, followed by the deployed
signed `pre-enable` round trip. Only after that gate passes and enablement is
separately authorized may the exact canary rerun its real
roster/schedule/session/mark/event/snapshot/QR flow. The Attendance UI remains
disabled by configuration until those gates pass. Its teacher flow, state
family, and Pika-owned view-model boundary are maintained in
`docs/guidance/pika-attendance-teacher-surface-v1.md`.

Attendance integration state is intentionally nonportable in archive-v2.
Ordinary soft archive/restore retains it, while archive compaction, hot purge,
and the final classroom delete fail with
`attendance_classroom_decommission_required` until a versioned Bara
decommission/reseed protocol exists. Migration 127 links inbox and projections
to their local classroom (and record projections to the local student), removes
service-role delete authority, and tests every guarded row family.
Individual-student purge is likewise blocked at begin and finalization whenever
that classroom/student has attendance mappings or records. This prevents Pika
from reporting privacy deletion complete while Bara still retains the linked
attendance identity or ledger; a versioned cross-service erase protocol remains
a rollout prerequisite for that path.

## Hosted rollout preflight

Run `pnpm attendance:rollout:preflight` only with the target deployment's
environment loaded. It requires explicit stage, expected non-secret Supabase
refs, exact Pika app and Bara API origins, and `--mode pre-enable` or
`--mode enabled`. Pre-enable mode requires the global Pika attendance flag to
remain false; enabled mode requires it to be true. Both modes verify through
the service-role database boundary that the configured classroom exists, is
active, and belongs to the configured teacher. Preview mode additionally
requires an isolated Supabase project and staging WorkOS credentials. Production
mode requires the expected and production Supabase refs to match. Every mode
fails if mock or WorkOS-default Magic Auth email is enabled, the retired
browser-handoff flag is on, or the deployment
omits the Brevo delivery contract, or reuses session/cron/transport/event/entry
secrets. Output contains only aggregate
counts and failed check identifiers; it never includes configured values.

Example operator shape:

```bash
pnpm attendance:rollout:preflight -- \
  --mode pre-enable \
  --stage production \
  --expected-supabase-ref "$PIKA_PRODUCTION_SUPABASE_REF" \
  --production-supabase-ref "$PIKA_PRODUCTION_SUPABASE_REF" \
  --expected-pika-origin "https://pika.codepet.ca" \
  --expected-bara-api-origin "$BARA_PRODUCTION_CONVEX_SITE_ORIGIN"
```

Vercel intentionally redacts Sensitive values from `vercel env pull` and
`vercel env run`, so this local command is advisory when fed a downloaded
Production environment. The production rollout gate is the operator-protected
`attendance:smoke:deployed -- --mode <pre-enable|enabled>` command: its deployed
Pika route runs this environment audit against pinned targets before the signed
round trip. A failed local audit must not be rewritten as a pass.

This environment preflight does not replace the database gate. Production
migrations through 130 are already applied. Before enabling this operational-
recovery release, inspect remote migration history, dry-run migration 131,
obtain its separate one-time production authorization, apply only 131 while
both global flags remain false, and rerun the pre-enable audit. If remote
history already includes 131, do not reapply it; verify the recorded migration
and continue with the deployed pre-enable gate.

The hosted scan measurement procedure is deliberately separate from this
environment audit. Follow `docs/integrations/bara-attendance-scan-load.md`
only after the isolated preview migration and signed smoke pass. The harness
refuses production and emits aggregate results only.

The 2026-08-17 read-only audit found that Vercel Preview still referenced a
deleted Supabase project whose hostname no longer resolves, while Production
uses the healthy `Pika` project. WorkOS and Bara integration variables were not
present in Preview, and its existing `SESSION_SECRET` value was empty. No
staging database is currently available. Do not reuse the production database
for the preview-only load harness.

A same-day Supabase CLI recheck found two active healthy Free projects (`Pika`
and `Codepet HQ`) plus an inactive project named `Attend`. Supabase currently
allows two active Free projects across the account, and paused projects do not
count toward that limit or incur compute charges. Do not resume or repurpose
`Attend`: its ownership and retained data have not been verified. The clean
no-charge route to a future hosted load test is to obtain explicit permission
to pause one named active project, provision a fresh Pika Preview target, and
then obtain the separate one-time authorization required by the schema rollout
checklist to apply the complete migration history through 131 to that target.

References: [Supabase Free Plan billing](https://supabase.com/docs/guides/platform/billing-on-supabase)
and [project pausing](https://supabase.com/docs/guides/platform/free-project-pausing).
