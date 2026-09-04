# Coordinated attendance deletion

Owner: Audit Pika security and privacy, `codex/coordinated-classroom-deletion`
in Pika and Bara. Risk: runtime-platform / destructive privacy workflow.

## Sequence

1. An owning teacher explicitly confirms deletion for one archived-hot classroom.
   The new teacher-only start endpoint commits a durable Supabase fence before
   contacting Bara. Reuse the same UUID after an uncertain response.
2. Explicit POST ticks use the signed, separately namespaced
   `/api/integrations/pika/decommission/v1` contract. Bara verifies the owner
   without provisioning identities, fences the roster, and erases bounded
   batches. Old snapshots, cached command successes, QR tokens, native writes,
   and automation cannot reopen it. In-flight event bytes may still arrive;
   Pika's database fence must reject them.
3. Pika accepts only a receipt bound to the installation, roster, and operation,
   with `state=deleted` and `absence_verified=true`. A 404 or timeout is not
   erasure evidence. Only after persisting that receipt may local attendance
   deletion begin (at most 500 rows per database tick).
4. Local completion reports `attendance_removed=true`, **not** classroom
   deletion. Invoke the existing independently gated hot-Classroom purge with
   its normal fresh inventory/confirmation checks to remove files and the
   classroom. No new path bypasses managed Storage ownership or deletion leases.

The existing hot-archived Classroom deletion dialog is the teacher-facing
orchestrator. It first attempts the existing permanent purge so classrooms with
no linked Bara state keep the direct path. Only the database's exact
attendance-decommission requirement activates the linked-attendance stage.
That stage uses a deterministic per-Classroom operation UUID, resumes saved
status after reload, removes remote and local attendance, refreshes the purge
inventory, and then invokes the unchanged managed-file/Classroom purge. There
is no separate unlink action. If attendance finishes after a reload or other
lost UI state, the dialog requires fresh typed confirmation before it starts
the final Classroom/file purge. The controls remain hidden until their
existing rollout gates authorize the Classroom.

## Ownership and retention

Bara erases the roster, participant copies, sessions, legacy records/events,
occurrences, check-in facts, schedule windows, integration mappings, access
rows, every scoped outbox status, and cached command responses. Legacy rows
are attributed through validated payloads/mappings in bounded installation
pages, never by matching names. Unattributable legacy state stops verification
and needs operator investigation; do not delete arbitrary installation data.

Pika removes its 14 classroom-scoped attendance/QR/operational tables. Shared
users, WorkOS/Pika principal identities, organizations, memberships, other
classrooms, and Blueprints remain. Neither system claims account erasure.
Minimal permanent operation/scope fences prevent identifier reuse; they carry
no student names, email, grades, or attendance payloads. Database backups have
their provider retention lifecycle and are not claimed to be physically erased
by live-table verification.

## Rollout and recovery

- Production migrations through 156 were verified on 2026-09-04. Migration 153
  creates the settings and fences; applying it does not delete rows. Missing
  migration fails closed. Migration 154 makes the unused lookup result and
  array-element loop explicit for the checker without changing deletion
  behavior.
- The production rollout is enabled in all three gates: Pika's database setting,
  Pika's Vercel transport setting, and Bara's Convex setting. The temporary
  canary roster bindings have been removed. `enabled` means all otherwise-
  authorized rosters; the owning-teacher, archived-classroom, confirmation,
  inventory, and durable-fence checks still apply.
- Before broad enablement, an exact synthetic teacher/classroom/roster canary
  completed the real signed cross-service flow. Pika removed 9 local attendance
  records, Bara removed 12 remote entities and verified their absence, and the
  final Classroom purge completed. Both user accounts, five unrelated student
  enrollments, and the previously retained QR attendance canary remained. A
  teacher browser smoke test and post-deletion database checks passed.
- For a future staged rollback or re-enable, Pika transport can use
  `PIKA_BARA_DECOMMISSION_MODE=canary` with
  `PIKA_BARA_DECOMMISSION_CANARY_ROSTER_REF`; database settings independently
  bind the installation, teacher, and classroom. Bara uses
  `PIKA_DECOMMISSION_MODE=canary` with its exact roster reference. Only broaden
  after Pika's database fence is installed and verified.
- Disabling a rollout gate pauses further deletion but never removes an existing
  fence. Each remote request requires fresh database authorization, including
  the installation binding; pausing cannot recall an already-authorized request
  in flight. The owning teacher can still read the operation's status while the
  application gate is disabled, but cannot begin or advance an operation. Retry
  the same operation after the gate is restored. There is no unfence/undo
  operation after destructive intent begins; do not clear tombstones manually.
- There is no new schedule. Each explicit tick does bounded work. Deletion adds
  no network round trip to ordinary attendance; active fences add indexed reads
  at write boundaries. Legacy cleanup scans cost work proportional to the
  installation's cached/outbox history, not merely this classroom's row count.
- Run `bash scripts/check-attendance-decommission-database.sh` after an approved
  local application. It rejects hosted targets and rolls all fixtures back.
  For future material changes, exercise a real signed synthetic cross-service
  run, interrupted ticks, delayed delivery, and the existing final purge before
  restoring broad enablement.
- Production migrations, rollout-setting changes, and real-data erasure each
  require exact owner authorization. Synthetic canaries must remain isolated;
  do not repurpose retained production QR canaries as deletion targets.

Review model recommendation: GPT-5.6 Sol (security/concurrency) and GPT-5.6 Terra
(architecture/compatibility), high reasoning, one bounded initial wave.
