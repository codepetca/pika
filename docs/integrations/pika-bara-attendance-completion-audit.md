# Pika–Bara native attendance completion audit

Status: the exact Codepet Labs canary passed end to end on 2026-08-22 after both
directional HMAC pairs were aligned. Production migrations through 132 are
recorded as applied, production is enabled in `teacher_entitlements` mode, and
the deployed signed smoke passed 4/4 in that mode on 2026-08-24. Additional
entitlements and remaining hosted workflow or pilot gates require separate
evidence and authorization. The atomic aggregate readiness RPC in proposed
migration 133 has not been applied.

The current recovery sequence requires migrations 142 and 145 together.
Migration 142 adds the service-role-only, fully audited obsolete-epoch recovery;
migration 145 makes the resulting epoch change advance both roster and schedule
source revisions so replacement snapshots receive new keys. Neither migration
application nor recovery execution is authorized by this audit or performed by
this work. Applying or authorizing 142 alone is incomplete: both migrations must
be applied and verified before the exact bounded recovery, fresh preparation,
tenant-link repair, delivery, and canary proceed under their separate gates.

This ledger prevents local test evidence from being mistaken for a rollout.
Paths are relative to the owning repository: this Pika worktree or the sibling
Bara worktree.

## Requirement evidence

| Requested outcome | Local status and evidence | Hosted status |
|---|---|---|
| Audit, brief, and retire cross-application browser handoff | Complete for native attendance. Bara `docs/features/briefs/bara-attendance-engine-boundary.md` and both native-attendance roadmaps define one Pika login and separate WorkOS Applications. Pika's runtime handoff routes are removed. Historical Bara handoff endpoints remain gated off, and both rollout checks require the legacy flag to stay false. | No hosted mutation required. |
| Provider-neutral authoritative Bara engine | Complete. Bara `convex/attendanceEngine.ts` owns lifecycle, marks/corrections, and student check-in with explicit actors. `convex/attendance-engine-equivalence.test.ts` proves standalone and signed-integration adapters use the same rules. | Standalone hosted regression remains part of pilot proof. |
| Transport/auth outside engine | Complete. Bara separates signed request authentication, tenant/installation mapping, identity linking, roster/schedule mapping, commands, event translation, outbox, and retention. Standalone AuthKit resolves Bara `app_users`; Pika requests map verified external principals before engine calls. | Matching preview credentials/origins are not configured. |
| Preserve Bara internal identity and roster ownership | Complete in code. Bara retains `app_users` + `auth_identities`; `rosters.ownerAppUserId` is the domain owner. Pika sends only random installation-scoped principals, so the adapter cannot reuse a standalone WorkOS identity or organization. | The Bara roster-owner backfill has not been run against a hosted deployment. |
| Controlled Pika-only provisioning/linking | Complete. Tenant-bound staff/student provisioning is narrow, cannot create integration admins, and rejects tenant moves, role conflict, participant relinking, and identity relinking. Bara integration tests cover these fences. | Real unmatched and newly provisioned teacher/student flows remain unproved. |
| Versioned idempotent student check-in | Complete. The closed v1 `student_check_in` response is synchronous and includes authoritative revisions. Each logical scan has a fresh attempt ID; only transport retries reuse its key. Pika never queues student scans. Invalid, closed, duplicate, unmatched, independent-attempt, lost-response, and contract cases have local tests. | Real timeout/lost-response behavior remains unproved. |
| Immediate events plus recovery | Complete. Bara attempts delivery after commit and keeps leased cron/outbox recovery. Pika commits inbox receipt and monotonic projection atomically and reconciles from authoritative snapshots. Local Supabase reset/replay proves migration execution, RLS/privileges, dependency ordering, and deletion guards. | Hosted event reordering and outage recovery remain unproved; an adequately frequent hosted outbox trigger is not configured. |
| Obsolete entitlement-epoch recovery | Requires migrations 142 and 145. The operator RPC requires the exact teacher, entitlement revision, complete unresolved row set, operation ID, actor, and reason; rejects live leases and changed scope; rotates the entitlement epoch and supersedes the approved rows atomically; and writes immutable audit evidence. The companion source-document change makes the next roster and schedule revisions and keys strictly newer. The package command is dry-run by default and execution requires an exact target-and-payload authorization binding. | Neither migration application nor recovery is authorized by this audit. Before recovery, both migrations require exact-target application and verification. After supersession, newer revision/key proof, fresh staging, tenant-link repair, delivery, and the production canary remain separately authorized gates. |
| Exact-time schedule jobs plus recovery | Complete. Bara owns exact open/close jobs and a recovery sweep; Pika sends concrete UTC intent generated from its class days and teacher policy. Schedule revision/removal tests preserve opened/closed history. | Hosted scheduler timing and schedule-change round trips remain unproved. |
| Timeout and retention policy | Complete and documented in the v1 contract. Bara retains request nonces for 24 hours and idempotency results for 30 days with bounded cleanup. Pika distinguishes definitive results from uncertain transport outcomes. | Operational cron cadence/alerting remains a pilot gate. |
| Native Pika teacher client | Complete locally. The Attendance surface, policy, sync, QR, session, marks, corrections, durable pending state, projection, and recovery workers are Pika-owned. WorkOS is verified locally; outbound commands carry only the mapped Pika principal. Retryable delivery uncertainty returns pending and survives reload from the durable outbox. | The entitled teacher saw Attendance in the sole active production classroom on 2026-08-25. That classroom's enabled policy and opaque roster/schedule mapping were fully synced. The unconfigured and cross-class save checks remain blocked because this teacher has no second active classroom. Real teacher correction and lifecycle flows remain unproved. |
| Native Pika student client | Complete locally. The QR opens a Pika URL; the raw Bara token is encrypted in a Pika-owned entry token and is not persisted. The server derives the student only from the verified Pika session and renders Bara's authoritative success/duplicate/invalid/closed/needs-help/unavailable state. | Real student mobile/login/scan flows remain unproved. |
| Exact production canary boundary | Complete locally. The global flag is combined with an exact Pika teacher/classroom UUID pair in `exact_canary` mode; `teacher_entitlements` mode instead requires an active audited teacher grant. Student tokens bind the classroom; inbound events and schedule/reconciliation/outbox workers use scoped RPCs. Focused tests and a full local reset prove fail-closed behavior. | Production migrations through 132 are recorded as applied. The exact canary passed roster, schedule, session, QR mark revision 1, Pika projection, and duplicate-idempotency proof on 2026-08-22. Production now uses `teacher_entitlements`; the exact pair remains the smoke scope. |
| Versioned contract fixtures and isolation | Complete. Bara is the v1 source and Pika vendors byte-identical closed types, validators, signing, and fixtures. Tests cover replay, idempotency conflicts, revision ordering, opaque mappings, tenant fences, and forbidden internal identifiers. A deployed bidirectional smoke gate is implemented with exact-canary database binding, separate HMAC legs, replay/rate bounds, and aggregate-only output. | The enabled `teacher_entitlements` gate passed 4/4 in production on 2026-08-24. Future deployments and scope-sensitive changes still require the authorized deployed gate; local tests are not hosted evidence. |
| Archive/purge containment | Complete as a fail-closed interim boundary. Soft archive/restore retains attendance state. Every attendance row family, compaction start, purge start, final classroom delete, and individual-student purge begin/finalization is guarded until a versioned Bara decommission/reseed/erase protocol exists. Inbox/projections carry local classroom lineage and record projections carry student lineage. | Destructive archive/purge and attendance-linked student erasure remain intentionally unavailable until coordinated provider decommissioning exists. |
| Local verification and UI evidence | Complete at the last recorded gate: both repositories passed their complete tests, type checks, builds, and prescribed guards. Pika Playwright evidence covers native success and uncertain student states on desktop/mobile without leaving Pika. | Hosted full state-family browser evidence remains open. |
| Hosted scan latency/load | Harness complete at `scripts/measure-bara-attendance-scans.ts`, with validation tests and the runbook in `docs/integrations/bara-attendance-scan-load.md`. It requires 30–100 distinct sessions, refuses production, and emits only aggregate p50/p95/p99 metrics. | No hosted p50/p95/p99 measurement has been run. |

## Remaining verification sequence

1. Verify the entitled teacher sees Attendance in every active classroom, a
   classroom without hours reports not configured, and saving hours produces
   only that classroom's opaque roster and schedule. The aggregate-only
   initial read-only inventory recorded one configured, fully synced active
   classroom on 2026-08-25 and made no production changes. The hardened
   `attendance:pilot:readiness` operator requires proposed migration 133. The
   workflow remains blocked until a second intended active classroom is
   available or an exact temporary setup and restoration is separately
   authorized.
2. Prove real teacher and student roster/schedule/lifecycle/mark/correction/QR,
   duplicate/lost-response, tenant-isolation, reordered-event, and snapshot
   flows under the enabled entitlement boundary.
3. Run a non-production load rehearsal only after an isolated staging database
   is explicitly provisioned; never point preview at production. Production receives
   only the bounded real-flow latency measurements approved for the pilot.
4. Verify the complete UI state family and rollback behavior. Grant additional
   teacher entitlements only through the audited operator flow under separate
   authorization.

No item in this document authorizes a migration, deployment, dashboard change,
pilot, or production enablement.
