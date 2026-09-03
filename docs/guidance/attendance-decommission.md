# Coordinated attendance deletion (disabled rollout)

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

- Migration 153 creates disabled settings and installs fences; applying it does
  not delete rows. Missing migration fails closed. Migrations 153–154 are applied
  locally only; generated types, a clean database checker, and rollback-only
  decommission/hot/cold/Blueprint tests passed. Migration 154 makes the unused
  lookup result and array-element loop explicit for the checker without changing
  deletion behavior. Both migrations still need separate production approval.
- Pika transport: `PIKA_BARA_DECOMMISSION_MODE=canary` plus
  `PIKA_BARA_DECOMMISSION_CANARY_ROSTER_REF`; database settings independently
  bind the installation, teacher, and classroom. All are disabled by default.
- Bara: `PIKA_DECOMMISSION_MODE=canary` and the exact
  `PIKA_DECOMMISSION_CANARY_ROSTER_REF`. Only enable after Pika's DB fence is
  installed and verified. `enabled` means all otherwise-authorized rosters.
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
- Run `bash scripts/check-attendance-decommission-database.sh` after approved
  local application. It rejects hosted targets and rolls all fixtures back.
  Then exercise a real signed synthetic cross-service run, interrupted ticks,
  delayed delivery, and existing final purge before any broader enablement.
- Production migration, rollout settings, and real-data erasure each require
  exact owner authorization. The previously retained production QR canaries
  are not authorized deletion targets here. Access PRs 1172/1174/1175 are
  separately authorized for main only and must not be swept into production.

Review model recommendation: GPT-5.6 Sol (security/concurrency) and GPT-5.6 Terra
(architecture/compatibility), high reasoning, one bounded initial wave.
