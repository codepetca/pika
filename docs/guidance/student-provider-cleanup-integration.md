# Student provider cleanup integration

Status: explicit live-flow implementation in review; default disabled. Owner:
`01a09d38-cc38-7850-b061-e3575db13c17`, branch
`codex/explicit-live-membership-purge`. Coordinator:
`01a09083-d907-7532-ae50-9b46d292bdb6`. Risk: runtime-platform
(authorization, immutable policy, concurrency and destructive cleanup).
Model recommendation: GPT-6 Astra for implementation; Sol/high security and
concurrency review, Terra/high compatibility and coverage review.

The existing [six-phase roadmap](classroom-pal-and-student-cleanup-plan.md)
remains the plan. This record supersedes its earlier blanket backup/restore-proof
requirements for newly selected `pika-live-v1` operations only.

## Settled product policy

Remove the student immediately using the existing roster action. An explicit
later purge removes their LIVE data in that classroom. Keep the account,
other classrooms, classmates, teacher materials and shared assets. There is no
restore-student action. Verified completion permits a fresh invitation/join,
a new enrollment generation, a new Pal reference and a new Bara participant.
Old generations and their delivery identities remain closed forever.

Historical backups, retained historical classroom archives and archive-derived
exports may remain under their actual retention. Their physical absence, expiry,
restore rehearsal or independent restore suppression is not a live completion
requirement. Retention is not attested here. A privileged administrator restoring
an old database can revive historical data; this flow makes no contrary promise.
An active replica, current provider store, cache, mixed live resource or in-flight
writer is not historical merely because it is called a backup.

## Delivered dependencies and release distinctions

- Pika Phase1 PR1253 and Phase2 PR1256 are merged. Provider prerequisite PR1258
  merged at `29cde0b0df441cf1b55f305da5ed4a602ca1d642`; academic stage PR1259
  merged at `ea9f45a5376b15b4d5cd44c57f1f0683598e8e16`. PR1259 main CI
  `34784421380` passed6919 tests plus database/browser/build; automatic Preview
  was READY. Those are source/CI/Preview receipts, not live activation.
- Pal schema PR105 merged at `d032945`; production0014 is applied. Runtime
  PR106 merged at `60e9befb0b31fa164663658f5f09c2615596cc14`; exact-main CI
  `34791160069` succeeded. Production deployment
  `dpl_3n6iej97hKRGSfVdyHq5RqFXXdXL`, GitHub deployment6427990973, is READY
  at pal.codepet.ca. Its erasure allowlist remains absent/off; no live purge
  is evidenced. Canonical contracts: Pal `docs/profile-erasure-contract.md`
  and `docs/profile-erasure-runtime.md` at that commit.
- Bara participant PR60 merged at
  `39660c0e207f087cf96923a975ea0f55e6472943`,234 tests passed. The verified
  `cautious-tortoise-152` backend was an expiring Convex preview (September18),
  not a stable production release. A stable Bara release remains a rollout gate.
- Reported Pika ledgers: local001–174, production001–168. All earlier exact
  application approvals are consumed. Applied migrations remain immutable.
  Migration175 below is forward source, not an application receipt.

## Immutable provider contracts

New explicit live reservation uses the existing
`advance_removed_student_academic_cleanup` RPC with action `live_reserve`.
It reserves the same operation, student/classroom fence, retained generation,
provider references, origin/integration/installation and teacher binding before
any network attempt. It saves `pal_schema_version=2`, `pal_policy=pika-live-v1`.
The new private `live_enabled` gate defaults false.

Existing `reserve_student_provider_cleanup` still creates strict v1 bindings.
Existing pending/completed strict operations are never upgraded or reused; their
six-key Pal receipts and existing public binding shape stay compatible. Migration175 defaults
existing policy fields to strict v1 and the existing immutability trigger protects
them. No nullable-policy transition or receipt-driven policy selection exists.

Pal POST sends exactly `{schema_version:2, policy:"pika-live-v1", operation_id,
learner_id}`. It never sends the GET-only `Pal-Erasure-Policy` header. Pal GET
sends that header with value `pika-live-v1` and has no body; it only reads status.
An exact POST retry progresses Pal. V2 receipts require exactly nine keys,
canonical UTC millisecond timestamps, valid chronology, exact operation/reference,
`historical_backups:"excluded"` and `backup_retention:"not_attested"`.
Wrong policy, extra/missing keys, generic404, timeouts, malformed replies and
202 completion never establish cleanup. Lost responses reuse the saved binding.
Bara retains its strict participant-scoped receipt and signed transport; whole
class decommission is never called. Independent attempts prevent pending Pal
from starving Bara. Recording and finalization recheck current teacher authority,
configuration, private gates, the retained removal and absence of enrollment.

## Explicit invocation and status

The API is disabled unless `PIKA_LIVE_STUDENT_CLEANUP_ENABLED=true`.
The complete Pika application gate set is `PIKA_LIVE_STUDENT_CLEANUP_ENABLED`,
`STUDENT_PROVIDER_CLEANUP_ENABLED`, `PAL_PROFILE_ERASURE_ENABLED`,
`PIKA_BARA_PARTICIPANT_ERASURE_ENABLED`, and
`PIKA_REMOVED_STUDENT_ACADEMIC_CLEANUP_ENABLED`, each exactly `true` for writes.
All are default-false in `.env.example`; changing real configuration requires
separate rollout authority. Existing Pal/Bara credentials and the saved
`PAL_PROFILE_ERASURE_INTEGRATION_ID` must match the reviewed provider binding.
Database prerequisites are `private.student_provider_cleanup_settings.enabled`
and `.live_enabled`, exact tenant configuration/eligibility,
`private.removed_student_academic_settings.enabled`, and verified
`managed_storage_settings.mode='enforced'`. The existing generation/signal
capture gates must already have established eligible exact Pal/Bara membership
mappings. Pal's exact authenticated integration allowlist and Bara's participant
erasure activation require separate provider authority. None is enabled here. Ordinary roster removal and the legacy purge endpoints retain
their current behavior while these gates are off. No scheduled worker or
removal hook calls this flow.

Use the existing authenticated teacher session and the exact target URL:
`/api/teacher/classrooms/{classroomId}/students/{studentId}/purge/live`.
The caller cannot supply a teacher identity or provider tenant.

1. GET without a query returns the retained `generation_id`, existing live
   `operation` (or null), and application `enabled` state after teacher ownership
   validation. Existing operations remain readable while paused. It does not
   reserve or send a provider request.
2. Reuse any existing operation. Otherwise generate one operation UUID and save
   it with that generation before the first request. POST:

   ```json
   {
     "action": "reserve",
     "operation_id": "<saved-operation-UUID>",
     "generation_id": "<retained-generation-UUID>",
     "confirmation": "PURGE LIVE CLASSROOM DATA"
   }
   ```

   Reservation performs no provider HTTP or academic deletion. The confirmation
   declares the explicit destructive scope; it does not replace authentication.
3. POST the same body with `action:"advance"`. Each invocation attempts both
   providers independently, then, only with verified provider completion, the
   existing academic inventory and at most one physical file deletion. Repeat
   the same operation/generation to progress bounded work or recover a lost reply.
4. GET `?operation_id=<saved-UUID>&generation_id=<saved-generation-UUID>` reads
   durable status without progressing providers, even when new-work activation is off. Responses use `no-store`.
   Status includes Pal, Bara, local stage and concrete blockers. An advance may
   include sanitized per-provider retryability; upstream bodies are never echoed.
5. `cleanup_completed:true` and overall `completed` mean the guarded final
   transaction succeeded. Local `local_completed` alone cannot release re-add.
   A failed/unknown HTTP response is uncertainty: read the same operation.
   After completion, use ordinary roster invitation and student join. There is
   no restore action and no old-generation reopening.

## Local scope, shared data and finalization

The173/174 academic inventory remains authoritative: student+classroom ownership
selects rows; the removed generation authenticates the operation rather than
attributing individual rows by dates. The existing29-table allowlist, row/owner
hashes, exact object ownership, two file buckets, leases, retry/backoff, callback
checks, mixed attendance-child checks and storage absence verification are reused.
No generation-provenance capture or retrospective relabeling is introduced.

Completed verified archive objects and completed archive-derived Gradex extracts
are retained historical artifacts: `classroom-gradex-operations.ts` builds its
extract from a verified archived snapshot. A completed copy is not erased to
settle one student. In-progress/retryable archive/export operations, unfinished
provisional owners and unbound managed copy objects remain live/unknown blockers.
Cold classroom lifecycle state remains ineligible for this hot-classroom flow.
Exact selected-file references from any shared copy continue to block deletion;
this is an ownership constraint, not a backup-retention test.

Finalization reuses the transaction-scoped academic capability, existing locks,
READ COMMITTED checks and exact teacher/generation binding. It requires local
absence, both provider receipts, no unfinished file and a fresh blocker check.
It removes exact participant check-in inbox/invalidation payloads, removes only
the target participant from mixed roster snapshots, supersedes those snapshots,
and preserves their classmates. It removes scoped Pika Pal delivery payloads
and week configuration data. Final verification checks delivery absence.

Then it deletes only the target inactive current Bara mapping and retained roster
deny row, marks the old Pal generation purged, completes the operation and removes
its fence atomically. The public completed operation clears `student_id` and
`student_email` as required by its existing privacy constraint; completed replay
still verifies the exact teacher/classroom/generation and immutable private
student+classroom scope digest. Provider receipts, immutable attendance/Pal generation
identities, scoped delivery bindings, resource IDs and storage path tombstones
remain as control evidence. Fresh enrollment/mapping insertion generates new
opaque references. Old participant payload checks no longer depend on the deleted
current mapping. Deleted resource IDs cannot be reinserted and old Pal references
cannot create outbox work. Permanent fences survive disabled activation gates.

Genuine unsupported current-data boundaries still fail closed: remote grading
provenance/current external grading copies, mixed summaries/feedback candidates,
shared grading-run payloads, shared attendance override-request results, retired
assessment ownership, unknown/shared object ownership, and legacy invalidations
without an exact participant or unknown stored provider-response shapes.
These cases are reported as blockers; the flow does not claim completion or
silently delete classmates. No worker, queue, dashboard, broad cron scheduling,
legacy sitewide Pal retirement, historical backfill or two-day guarantee is added.

## Verification and rollout approval packet

Source verification and normal disposable CI database fixtures are authorized.
The SQL fixture `scripts/check-live-student-cleanup-database.sql` is rollback-only:
its Storage metadata deletion is not committed-row MVCC or real-byte evidence.
The existing storage coordinator mocks cover physical adapter calls and lost
callbacks. Existing Pal client tests cover memory/token invalidation and late
reply rejection without losing academic input. PR1260 did not change rendered UI;
the teacher dialog integration is recorded below.

PR1260 records the exact reviewed migration hash, fixed review SHA, PR Gate and
CI result as they become available. Until those checks finish this is an
implementation candidate, not a ready or applied release.

The rollout approval packet must name each separate action:

- Local schema: existing Pika local target `supabase_db_pika`, database `postgres`,
  only `175_explicit_live_student_cleanup.sql` after rechecking ledger001–174.
  This migration defines destructive runtime functions but performs no student
  data purge and enables no gate. It adds only private metadata and changes
  existing public RPC bodies; generated public signatures are unchanged.
- Production schema: reverify the recorded001–168 ledger and prepare exact
  immutable169–175 filenames/hashes and prerequisites as a separate batch.
  A local approval never authorizes production or schema-history repair.
- Application release: reviewed Pika commit and normal deployment approval;
  stable Bara participant runtime; Pal released60e9bef with verified live
  topology and fenced writers. Historical retention is not a gate.
- Activation/canary: exact environment, teacher, classroom, removed generation,
  operation, provider tenant/reference bindings and explicit live purge authority.
  Confirm current Pika/Pal/Bara writers and serving caches match reviewed paths;
  configure existing gates only under that separate authority. No live provider
  request, allowlist change or actual deletion is authorized by this source PR.

Rollback disables new begins/advances; retained guards and policy-aware readers
are the rollback floor. Never revert to a writer that can reopen a saved identity
or misread v2 as strict proof. Migration application follows the
[schema authorization checklist](schema-rollout-checklist.md); no prior approval
can be reused for175 or another target.

## Teacher dialog integration — 2026-09-13

Owner: `01a09d9e-e75e-7153-8cb6-c15e1d5e3d2a`, branch
`codex/teacher-live-purge-dialog`; based on merged backend PR1260 / `80505399`.
The roster's More actions menu opens **Clean up live class data** for retained
removed memberships. Active roster rows and ordinary Remove from class keep their
existing behavior. No live operation falls back to a legacy purge endpoint.
Existing strict-policy operations cannot advance through this dialog; the
original strict APIs retain their policy and behavior.

The server projects only authorized removed-membership selector fields. Pending
operations are recovered through the existing exact-scope binding reader,
including while activation is paused. Completed operations do not restore cleared
public student identifiers. The browser saves an opaque operation/classroom/
student/generation key in session storage before reservation; a lost completion
reply can be checked using that key even after the removed roster row disappears.
A new browser can discover a still-pending operation; completed recovery requires
the already-held exact key. Storage failure prevents starting new work.

The dialog requires case-sensitive email confirmation before reservation. One
explicit Continue performs one bounded advance. No timer or background worker
continues after closure. Reads validate the operation and guarded terminal status;
HTTP success alone and local completion do not release re-add. Retry preserves
the original operation, including uncertain reservation responses. Response epochs
and a per-membership request lock suppress stale updates and overlapping requests.
Provider or ownership blockers remain pending and require status refresh.

The existing provider coordinator now supports a live-only binding check before
any provider request. It rejects strict policy and mismatched operation/generation
without modifying strict behavior or adding schema. Client responses contain no
provider origins, credentials, private receipt bindings, or reconstructed identity.

### UI brief and verification contract

Surface: existing roster menu and `StudentPurgeDialog`. Reference: governed
`ContentDialog` and `/pattern-lab` Controls / QR sizing dialog, with the roster's
existing teacher work-surface menu. Primary signal: danger action and short
irreversible-scope copy. No dashboard, progress percentages, background promises,
whole-class archive deletion, restore action, or invitation redesign.

| Need | Existing candidate | Decision | Reason |
| --- | --- | --- | --- |
| Removed membership entry | Roster More actions | extend | Active rows stay unchanged |
| Overlay and focus | ContentDialog | reuse | Shared modal behavior |
| Scope and confirmation | Select, FormField, Input, Button | reuse | Canonical accessible controls |
| Request lifecycle | Feature hook/client module | create | Feature logic outside generic UI |

Teacher desktop/mobile, light/dark: loading, confirmation, pending, provider
waiting, error, retry, paused, and completed. Keyboard containment, Escape,
reopen, reload, saved-key recovery, and default-off entry are covered with mocked
API fixtures. Student dialog role is n/a because no student surface or shared
primitive changes; existing student Pal privacy/input-preservation fixture tests
are the regression evidence. Composite checklist reviewed; no experimental shared
pattern or human promotion is required. No nearby duplication warrants extraction.

Reproduction: `e2e/teacher-live-cleanup.spec.ts` (fixture API only); captures under
`output/playwright/live-cleanup`. Exact commit and reviewed capture evidence belong
in the PR handoff. No real purge, provider request, gate change, migration, or
production release is part of this UI verification.
