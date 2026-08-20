# Native Pika attendance powered by Bara

Status: local implementation complete; hosted data, migration, latency, and pilot gates remain.

Risk profile: `runtime-platform`.

Model recommendation: use a high-reasoning coding model because identity,
cross-service authorization, schedule automation, privacy, retries, and
rollback must remain independently correct.

## Goal

Deliver attendance as a native Pika workflow backed by independently operable
Bara. Teachers and students authenticate once in Pika and stay on
`pika.codepet.ca`. Pika's server calls Bara's versioned attendance adapter;
the browser never enters or embeds the Bara frontend.

Standalone Bara remains independently usable with its own AuthKit session,
frontend, rosters, sessions, check-in flow, corrections, and audit tools.

## Ownership and boundary

| Concern | Owner | Boundary |
|---|---|---|
| Browser authentication and native attendance UI | Pika | Pika WorkOS Application and Pika session only |
| Classrooms, academic rosters, class days, schedule intent, projection | Pika/Supabase | Pika IDs and tables stay private |
| Attendance lifecycle, QR/manual rules, records, corrections, audit | Bara/Convex | Convex IDs and tables stay private |
| Integration | Versioned HTTPS commands/events | Closed schemas, opaque references, signatures, idempotency, reconciliation |

Pika and Bara remain separate WorkOS Applications. No cross-application
browser session, cookie, authorization-code handoff, shared WorkOS client, or
second Bara login is part of native Pika attendance. Pika verifies WorkOS
locally, maps the user to a random Pika attendance principal, and sends only
that principal through the installation-scoped adapter.

## Implemented local flows

### Teacher

1. Pika owns classroom authorization and materializes roster and schedule
   snapshots with random contract references.
2. Bara executes exact open/close lifecycle and returns authoritative revisions.
3. Teacher commands enter Pika's durable outbox and remain pending until a
   Bara revision reaches Pika's projection.
4. QR presentation is fetched server-to-server. Pika encrypts the roster,
   occurrence, raw Bara check-in token, and expiry into a public Pika entry
   token. The raw Bara token is not stored in Pika's database or exposed as a
   Bara URL.

### Student

1. The QR opens `/attendance/check-in/<opaque-pika-token>` on Pika.
2. A signed-out student completes Pika's existing login/passcode flow and
   returns to the exact Pika entry path.
3. Pika validates and decrypts the entry token on its server, requires the
   student role, verifies the Pika WorkOS session, and cross-checks the WorkOS
   subject and email against the linked local Pika UUID.
4. Pika calls Bara's signed v1 `student_check_in` command. No client-supplied
   identity is accepted.
5. Each logical scan has a fresh browser-generated attempt ID. Its command key
   is stable only across transport retries of that attempt; a later independent
   scan gets a different key. A timeout is retried once with the same body/key
   and a fresh transport nonce. An uncertain second failure is never shown as
   success or queued for delayed application.
6. Pika renders Bara's synchronous authoritative result, while normal events
   and snapshots reconcile the monotonic Supabase projection.

## Contract and recovery

- Pika vendors Bara's exact v1 types, closed validators, and provider fixtures.
- Roster requests include a deployment-scoped `tenant_ref`; Pika internal IDs
  never cross the boundary.
- Commands/events contain only opaque references and bounded operational data.
- Outbox claims enforce roster-before-schedule and
  roster/schedule-before-command dependencies under concurrent workers.
- Event receipt and projection updates commit atomically. Session and record
  revisions ignore duplicates and stale/reordered events.
- A separate reconciliation worker repairs webhook loss from authoritative
  Bara snapshots.
- Pika does not put student scans in its durable command outbox. Teachers may
  see pending state; students receive only a synchronous confirmed result or an
  explicit unavailable state.

## Remaining gates

1. If a hosted pilot is desired, first provision and authorize a named isolated
   Pika Supabase target; none exists today. Migration 126 has only been replayed
   and tested against the disposable local stack.
2. Deploy matching Bara and Pika previews with distinct WorkOS Applications,
   cookie/session secrets, transport/event/entry-token secrets, and exact API
   origins. Keep the legacy browser-handoff flag false.
3. Prove real roster, schedule, automatic lifecycle, teacher correction,
   student scan, duplicate/lost-response retry, event reorder, and snapshot
   reconciliation round trips.
4. Measure hosted student-scan latency and record p50/p95/p99 under roughly
   30–100 concurrent scans with the preview-only aggregate harness in
   `docs/integrations/bara-attendance-scan-load.md`. Local unit timing is not a
   hosted latency claim.
5. Visually and functionally verify teacher and student flows on desktop/mobile
   and light/dark, including loading, success, duplicate, unmatched, invalid,
   closed, and unavailable states.
6. Run one allowlisted classroom canary with rollback flags. Do not promote or
   enable production attendance until the teacher and student flows pass.

Archive-v2 does not yet know how to decommission Bara authority. Soft
archive/restore preserves attendance rows, but compaction and permanent purge
are deliberately blocked until a versioned decommission/reseed protocol ships.

The requirement-by-requirement local evidence and hosted gate ledger is in
`docs/integrations/pika-bara-attendance-completion-audit.md`.

## Rollback

Disable Pika's attendance surface and Bara's integration adapter independently.
Preserve the Pika inbox/outbox/projection and Bara audit/outbox data for
diagnosis. A disabled Pika event ingress returns temporary unavailability so
Bara retains and retries its event, and a disabled Bara adapter returns the same
retryable `503 temporarily_unavailable` state to Pika. Resource and contract
404s remain permanent. Never roll one side back across a breaking contract
version.
