# Student provider cleanup integration — Phase 3 prerequisite

Status: disabled prerequisite delivered. PR #1258 merged at
`29cde0b0df441cf1b55f305da5ed4a602ca1d642`; the automatic main Preview is READY.
This is a prerequisite increment, not Phase 3 completion. Prior owner: task
`01a09b31-f9d8-7ce0-8a20-0bfd61f67009`, preserved branch
`codex/pal-student-cleanup-integration`. Risk: runtime-platform.
Model recommendation: GPT-6 Astra for implementation; Sol/high security and
concurrency review, Terra/high compatibility and coverage review.

The selected [six-phase plan](classroom-pal-and-student-cleanup-plan.md) governs
product intent and records the current academic/file-stage owner. Phase 2 PR1256
is merged. Local Pika is verified through001–172; both exact local application
permissions are consumed. Production remains through168. Provider and academic
cleanup remain disabled. The merge/Preview receipt is
`/Users/stew/.codex/metrics/pika-phase3-merge-preview-receipt-2026-09-13.md`.

Pal PR104 is released at `5ef9070471e4d409082f1146b584ab76cfc3a1d3`. Its exact
begin/status contract is implemented but disabled, and managed-copy proof is
unconditionally unavailable. No hosted completion is possible. Bara PR60 is
merged at `39660c0e207f087cf96923a975ea0f55e6472943`; its deployed backend is the
expiring Preview `cautious-tortoise-152` (September18), not a stable production
backend. No provider code or configuration is modified here.

## Compatibility boundary

Migration171 adds `provider_pending` to the EXISTING student purge operation
record plus private immutable generation and provider bindings. Reservation
requires an exact retained removed enrollment generation, current classroom
owner, fresh policy eligibility and verified participant mapping. Operation and
provider references are captured atomically with the existing student fence
before the first HTTP attempt. There is no public route, removal autoenqueue,
new scheduler, or temporary reenrollment. Legacy typed-email purge remains.

A provider prerequisite has no academic inventory and cannot enter the ordinary
object/finalization stages. Binding-backed operation and child triggers block
both exposed and legacy finalizers, callbacks, status mutation and fence removal.
Provider receipts cannot mark a Pika generation purged, complete the operation,
rotate references or release re-add. Active-operation conflicts and health counts
continue to recognize the pending stage; the ordinary cron excludes it.

Provider advancement explicitly selects Pal or Bara and makes at most one HTTP
attempt. One provider's pending copy policy cannot prevent beginning the other's
fence. Returned persistence evidence must contain the exact receipt just recorded;
both providers can complete without advancing Pika beyond provider_pending.

All gates default off. New attendance generation capture also requires the new
private database gate and an enrollment created after its eligibility boundary.
No historical participant mapping is attributed or backfilled. Missing or
ambiguous mappings stop reservation. Captured mappings cannot be renamed, moved
or deleted; eventual rotation needs verified full cleanup and a separately
implemented fresh-generation transition. No such transition exists in this slice.

Removal closes scoped Pal delivery leases and tracked attendance leases. The
same permanent generation predicate governs attendance source construction,
preparation, strict stage comparison, inbox replay and fact writes. Reconciliation
omits closed-generation check-ins while preserving classmates. No old payload is
reinterpreted with a fresh mapping. Provider fences remain necessary for the
network gap after host authorization; already transmitted bytes cannot be recalled.

Student scans resolve the current membership before sending, before a bounded
retry, and before returning the result. Changed or removed generations discard
the response; enabled scans bind the exact participant in both the request and
idempotency digest, and reject a response for another participant. Outbox delivery
and stored-response replay authorize the exact payload and lease immediately
before use. Missing generation RPCs preserve pre171 behavior only while the new
application gate is off; permission errors and malformed results fail closed.
Once the RPCs exist, their durable fences apply even when that gate is paused.

Pal uses the existing backend bearer credential; Bara uses its existing signed
attendance envelope and fresh nonce for each attempt. Saved origin/integration
or installation bindings must match current server configuration. Every receipt
is versioned, structurally strict and bound to the saved operation/reference.
404, 202 completion, timeouts, transport failures, malformed responses and scope
mismatches never prove cleanup. Pal pending/copy-blocked and Bara blocked states
stay pending. These receipts cover provider-defined scope, not all Pika data.
Pal generic404, malformed receipts and unexpected successful HTTP statuses are
retryable uncertainty using the same operation binding; definite authorization,
binding and configuration errors remain blocked. No rejected reply is persisted
as cleanup proof.

## Delivered verification and limitations

- Exact migration171 SHA256
  `598ee035bea90e47aade94acb7d79ce2227e110c343e57be0661e71ce4ccd587`
  and correction172 SHA256
  `4aac47ce59b41d8b1de87ec07710ff4d4df8bb7e2292456335c1c836a6e65424`
  were each applied once to the existing local Pika database with direct approval.
  Both files remain byte-immutable. Canonical generated types came from the
  verified schema; no hand editing of generated types was used.
- Independent source review and corrections completed at reviewed head
  `215c805bf7c8d01ef92fc7d13536c36f91557eec`. Exact-head PR Gate passed before
  normal merge. The merged tree matches that reviewed candidate.
- The typed RPC coordinator and generation-aware attendance scan/pre-send/replay
  consumers have synthetic regression coverage. Host browser invalidation was
  visually verified: denied membership invalidates token/memory and ignores late
  replies without remounting academic children; legacy caching stays.
- Rollback SQL covers held leases, source isolation, provisional-copy ownership
  and unfinished intents, strict receipts, legacy finalizers/callbacks and
  aged-operation health. The separate contention harness uses two connections
  and verifies RPC/producer lock conflicts and release. Fixtures remain
  uncommitted: this is not a committed-row MVCC claim/removal race rehearsal.
- Unknown provider replies, Pal retry classification, copy ownership/intents and
  provider-pending cron health were addressed during bounded independent review.
  Local and mocked checks do not establish hosted erase safety.
- Preview verification read deployment metadata only. It did not perform a
  hosted smoke, provider request, manual redeployment, activation or live erase.

## Remaining release and product gates

The prerequisite merge and automatic Preview are delivered. Further merge, deployment,
migration application, provider activation, live canary or scheduled cleanup need
their applicable authority. Unknown managed copy
classes remain blocked. Academic files, archive/Gradex copies, remote grading,
restore-independent suppression, retention policy and complete local inventory
remain independent obligations. Never delete a whole-class archive or invoke
whole-roster Bara decommission to satisfy one participant's cleanup. No physical
erasure, two-day promise, legacy profile retirement, historical-removal backfill,
achievement copying or reset is claimed. Phase4 worker policy and Phase5 pilot
remain separate.

## Next local academic stage — source checkpoint

Owner: `01a09bf4-0b2a-7762-8043-45c5698b8492`, branch
`codex/removed-membership-academic-cleanup`. Forward173 is authored, unapplied,
and awaiting independent source review. The database RPC bridge and canonical
generated contract must follow approved schema verification before readiness.
No runtime/database or committed-row rehearsal is claimed by this checkpoint.

Academic data ownership is the exact student/classroom pair. The saved current
removed generation authenticates the operation; dates do not attribute rows to
a generation. Every local RPC and physical storage deletion rechecks current
teacher authority, the immutable operation/provider tuple, exact retained roster
identity, absence of enrollment, private gates and the retained fence under the
existing locks. Repeatable-read/serializable caller snapshots are rejected.

The stage reuses `student_purge_operations`, `student_purge_resources` and
`student_purge_objects`. Full row and managed-owner hashes freeze inventory
revision1, including content changes that an ID/count-only hash would miss.
Inventory replay preserves that revision; drift stops progress. An internal
transaction-scoped capability permits narrow ledger/row mutations and is removed
before the RPC returns. It is not a persisted work queue or a caller-set flag.
The ordinary purger still stops at `provider_pending` and cannot call this stage.

| Resource class | Treatment in this increment |
|---|---|
| Assignment docs, history, save operations, teacher feedback, student artifacts | Exact current inventory; row hashes; delete only after all gates pass |
| Test attempts/history/responses/focus/availability, survey responses, announcement reads, report-card rows, daily entries | Reuse existing exact student/classroom inventory |
| Gradebook overrides and standalone scores | Reuse157/163 inventory extensions |
| Removed roster manual attendance marks | Inventory payload separately; clear to an empty object while retaining every identity/control field and timestamp |
| Embedded managed-object references | Explicit inventory of exact doc/history references; forbid any shared owner |
| Student-managed artifacts/images | Exact owner/purpose/bucket checks; existing object leases, retries and permanent path reservations; SQL absence verification |
| Shared summaries, feedback candidates, grading runs, repo grading, AI provenance, retired assessment data | Block; no collateral deletion or shared-run redaction |
| Archives, Gradex extracts, provisional intents, cleanup ledgers and cross-owner object references | Block; no whole-class copy cleanup |
| Local attendance facts/projections/overrides/events | Exact student/classroom inventory and deletion; child events before overrides; mixed parent/event identities block and both scopes are fenced; immutable participant mapping retained |
| Shared attendance override-request results | Block pending shared-result handling |
| Pal/Bara delivery ledgers and identity evidence | Remain under the provider/integration obligation; never erased or declared complete by local academic evidence |
| Account, profile, classmates, other classes, teacher materials and shared assets | Preserved |

Inventory can run before provider completion. Every destructive step requires the
saved exact Pal completion and Bara participant absence receipts plus all no-copy
conditions. Pal's live managed-copy proof is unavailable, so synthetic receipts
validate dormant behavior only. `local_completed` records local academic/file
absence; overall remains `provider_pending`. Resources, path tombstones, immutable
bindings and the re-add fence remain. No worker, cron, public route, teacher UI,
reenrollment, reference rotation or overall finalizer is added.

Verification authored: orchestration/storage mocks, a source contract that requires fixtures for all29 allowlisted row tables, and the rollback-only
`scripts/check-removed-student-academic-database.sql` harness. The harness requires
approved local173. It covers22 exact deletion/redaction categories, two leased files, ten blocked scenarios, exact target absence and classmate/other-class row hashes. Failed callbacks/backoff and lease expiry are simulated in rolled-back subtransactions. It changes only synthetic transaction-local fixtures; it must
never be described as committed-row MVCC or storage-byte deletion proof. Required
remaining evidence includes exact schema/types, isolation/callback/lease tests,
independent review and stable-head CI. No schema application authority is implied.
