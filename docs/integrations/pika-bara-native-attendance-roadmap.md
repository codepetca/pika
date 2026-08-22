# Native Pika attendance powered by Bara

Status: local implementation and production migrations 129/130 are complete.
The exact production canary passed on 2026-08-22 after both HMAC pairs were
aligned. Expansion remains blocked on operational recovery, migration 131,
the deployed bidirectional credential smoke, and fresh authorization.

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
   Pika classroom, occurrence, raw Bara check-in token, and expiry into a public Pika entry
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

1. Review Bara recovery/smoke first, then Pika no-claim handling and migration
   131. Do not edit or reapply migrations 129/130.
2. Obtain separate authorization to apply only migration 131 to the named Pika
   production project and to deploy the matching reviewed commits. Run the
   pre-enable static audits and deployed bidirectional smoke before any later
   enablement or expansion decision.
3. Preserve the exact canary only. Its roster, schedule, session, QR mark,
   projection, and duplicate-idempotency path passed on 2026-08-22. Nine
   credential-era failed events remain untouched; snapshot reconciliation
   restored current state. Recover them only under the separately authorized,
   bounded requeue/supersede runbook.
4. There is no staging database. Preview records a production-only smoke skip
   and must never target production. Hosted load testing remains blocked until
   an isolated non-production database is explicitly provisioned.
5. Visually and functionally verify teacher and student flows on desktop/mobile
   and light/dark, including loading, success, duplicate, unmatched, invalid,
   closed, and unavailable states.
6. Before another exact-canary run, rerun the preflight with `--mode enabled`
   and the deployed smoke. Expansion beyond that pair is a separate decision.

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
