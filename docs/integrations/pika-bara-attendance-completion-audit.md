# Pika–Bara native attendance completion audit

Status: the exact Codepet Labs canary passed end to end on 2026-08-22 after
production migrations 129 and 130 and both directional HMAC pairs were aligned.
Expansion remains blocked on reviewed recovery changes, separately authorized
migration 131/deployments, and a passing deployed bidirectional smoke.

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
| Exact production canary boundary | Complete locally. The global flag is combined with an exact Pika teacher/classroom UUID pair. Teacher reads render disabled outside the pair; mutations stop before WorkOS identity resolution; student tokens bind the classroom; inbound events and schedule/reconciliation/outbox workers use migration-129 scoped RPCs. Focused tests and a full local reset prove fail-closed behavior. | Production migrations 129 and 130 are applied. The exact canary flags are enabled and passed roster, schedule, session, QR mark revision 1, Pika projection, and duplicate-idempotency proof on 2026-08-22. No non-canary expansion is authorized. |
| Versioned contract fixtures and isolation | Complete. Bara is the v1 source and Pika vendors byte-identical closed types, validators, signing, and fixtures. Tests cover replay, idempotency conflicts, revision ordering, opaque mappings, tenant fences, and forbidden internal identifiers. A deployed bidirectional smoke gate is implemented with exact-canary database binding, separate HMAC legs, replay/rate bounds, and aggregate-only output. | The gate still requires reviewed merges, authorized migration 131, authorized deployments, and a production pass; local tests are not hosted evidence. |
| Archive/purge containment | Complete as a fail-closed interim boundary. Soft archive/restore retains attendance state. Every attendance row family, compaction start, purge start, final classroom delete, and individual-student purge begin/finalization is guarded until a versioned Bara decommission/reseed/erase protocol exists. Inbox/projections carry local classroom lineage and record projections carry student lineage. | Destructive archive/purge and attendance-linked student erasure remain intentionally unavailable until coordinated provider decommissioning exists. |
| Local verification and UI evidence | Complete at the last recorded gate: both repositories passed their complete tests, type checks, builds, and prescribed guards. Pika Playwright evidence covers native success and uncertain student states on desktop/mobile without leaving Pika. | Hosted full state-family browser evidence remains open. |
| Hosted scan latency/load | Harness complete at `scripts/measure-bara-attendance-scans.ts`, with validation tests and the runbook in `docs/integrations/bara-attendance-scan-load.md`. It requires 30–100 distinct sessions, refuses production, and emits only aggregate p50/p95/p99 metrics. | No hosted p50/p95/p99 measurement has been run. |

## Remaining release sequence

1. Preserve the verified 2026-08-22 exact canary and do not expand it. Review
   Bara recovery/smoke first, then Pika no-claim/smoke migration 131.
2. Obtain separate authorization for the matching deployments and for applying
   only migration 131 to the named production Pika project, with both flags
   false during the new pre-enable gate.
3. Run both aggregate-only pre-enable audits and the deployed bidirectional
   smoke. Preview records a production-only skip because no staging database
   exists; that skip never satisfies the production gate.
4. After a separate enablement decision, enable only the paired Pika/Bara flags
   for the controlled canary and prove
   real teacher and student roster/schedule/lifecycle/mark/correction/QR,
   duplicate/lost-response, tenant-isolation, reordered-event, and snapshot
   flows while attendance remains disabled for every non-canary pair. Run the
   Pika preflight again with `--mode enabled` before exercising the flow.
5. Run a non-production load rehearsal only after an isolated staging database
   is explicitly provisioned; never point preview at production. Production receives
   only the bounded real-flow latency measurements approved for the pilot.
6. Verify the complete UI state family, then run one allowlisted classroom
   canary with rollback. Production enablement remains a separate decision.

No item in this document authorizes a migration, deployment, dashboard change,
pilot, or production enablement.
