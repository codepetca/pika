# Pika–Bara native attendance completion audit

Status: all requested local architecture and behavior slices are implemented.
Production migration 129 is applied; migration 130 capability retirement,
cross-service, latency, and canary proof remain intentionally open.

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
| Exact-time schedule jobs plus recovery | Complete. Bara owns exact open/close jobs and a recovery sweep; Pika sends concrete UTC intent generated from its class days and teacher policy. Schedule revision/removal tests preserve opened/closed history. | Hosted scheduler timing and schedule-change round trips remain unproved. |
| Timeout and retention policy | Complete and documented in the v1 contract. Bara retains request nonces for 24 hours and idempotency results for 30 days with bounded cleanup. Pika distinguishes definitive results from uncertain transport outcomes. | Operational cron cadence/alerting remains a pilot gate. |
| Native Pika teacher client | Complete locally. The Attendance surface, policy, sync, QR, session, marks, corrections, durable pending state, projection, and recovery workers are Pika-owned. WorkOS is verified locally; outbound commands carry only the mapped Pika principal. Retryable delivery uncertainty returns pending and survives reload from the durable outbox. | Real teacher correction and lifecycle flows remain unproved. |
| Native Pika student client | Complete locally. The QR opens a Pika URL; the raw Bara token is encrypted in a Pika-owned entry token and is not persisted. The server derives the student only from the verified Pika session and renders Bara's authoritative success/duplicate/invalid/closed/needs-help/unavailable state. | Real student mobile/login/scan flows remain unproved. |
| Exact production canary boundary | Complete locally. The global flag is combined with an exact Pika teacher/classroom UUID pair. Teacher reads render disabled outside the pair; mutations stop before WorkOS identity resolution; student tokens bind the classroom; inbound events and schedule/reconciliation/outbox workers use migration-129 scoped RPCs. Focused tests and a full local reset prove fail-closed behavior. | Production migration 129 is applied. Migration 130 must retire the superseded unscoped service-role RPC capabilities before enablement. The exact canary variables remain unconfigured and both global flags remain false. |
| Versioned contract fixtures and isolation | Complete. Bara is the v1 source and Pika vendors byte-identical closed types, validators, signing, and fixtures. Tests cover replay, idempotency conflicts, revision ordering, opaque mappings, tenant fences, and forbidden internal identifiers. | Provider/consumer requests still need a deployed cross-service smoke. |
| Archive/purge containment | Complete as a fail-closed interim boundary. Soft archive/restore retains attendance state. Every attendance row family, compaction start, purge start, final classroom delete, and individual-student purge begin/finalization is guarded until a versioned Bara decommission/reseed/erase protocol exists. Inbox/projections carry local classroom lineage and record projections carry student lineage. | Destructive archive/purge and attendance-linked student erasure remain intentionally unavailable until coordinated provider decommissioning exists. |
| Local verification and UI evidence | Complete at the last recorded gate: both repositories passed their complete tests, type checks, builds, and prescribed guards. Pika Playwright evidence covers native success and uncertain student states on desktop/mobile without leaving Pika. | Hosted full state-family browser evidence remains open. |
| Hosted scan latency/load | Harness complete at `scripts/measure-bara-attendance-scans.ts`, with validation tests and the runbook in `docs/integrations/bara-attendance-scan-load.md`. It requires 30–100 distinct sessions, refuses production, and emits only aggregate p50/p95/p99 metrics. | No hosted p50/p95/p99 measurement has been run. |

## Remaining release sequence

1. Review and merge the disabled-by-default Pika production release containing
   migration 130. Verify production history already contains migration 129; do
   not edit or reapply it.
2. Obtain separate one-time authorization and apply only migration 130 to the
   Pika production project while both global attendance flags remain false.
3. Configure the exact teacher/classroom canary UUIDs, redeploy with both global
   attendance flags still false, and run the aggregate-only rollout preflight
   with `--mode pre-enable`. It must prove the active classroom still belongs to
   the configured teacher.
4. Enable only the paired Pika/Bara flags for the controlled canary and prove
   real teacher and student roster/schedule/lifecycle/mark/correction/QR,
   duplicate/lost-response, tenant-isolation, reordered-event, and snapshot
   flows while attendance remains disabled for every non-canary pair. Run the
   Pika preflight again with `--mode enabled` before exercising the flow.
5. Run a non-production load rehearsal before the canary; production receives
   only the bounded real-flow latency measurements approved for the pilot.
6. Verify the complete UI state family, then run one allowlisted classroom
   canary with rollback. Production enablement remains a separate decision.

No item in this document authorizes a migration, deployment, dashboard change,
pilot, or production enablement.
