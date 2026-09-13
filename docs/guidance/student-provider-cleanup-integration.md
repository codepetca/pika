# Student provider cleanup integration — Phase 3 prerequisite

Status: source checkpoint for initial independent review; no SQL applied, no
provider requests, no draft PR yet. This is a prerequisite increment, not Phase 3
completion. Owner: task `01a09b31-f9d8-7ce0-8a20-0bfd61f67009`, branch
`codex/pal-student-cleanup-integration`. Risk: runtime-platform.
Model recommendation: GPT-6 Astra for implementation; Sol/high security and
concurrency review, Terra/high compatibility and coverage review.

The selected [six-phase plan](classroom-pal-and-student-cleanup-plan.md) governs
product intent. Main is `f67852cf` (Phase 2 PR1256 merged); local Pika is verified
through001–170. Production remains through168 according to the coordinator's
verified ledger; this new worktree has no linked hosted target.

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

Pal uses the existing backend bearer credential; Bara uses its existing signed
attendance envelope and fresh nonce for each attempt. Saved origin/integration
or installation bindings must match current server configuration. Every receipt
is versioned, structurally strict and bound to the saved operation/reference.
404, 202 completion, timeouts, transport failures, malformed responses and scope
mismatches never prove cleanup. Pal pending/copy-blocked and Bara blocked states
stay pending. These receipts cover provider-defined scope, not all Pika data.

## Outstanding work at this review checkpoint

- Canonical generated public types and real rollback/concurrency SQL verification
  after exact local171 application approval. Never hand-edit generated types.
- Connect the bounded coordinator to generated typed RPC calls and add the
  generation-aware attendance scan/pre-send/replay consumers.
- Host browser invalidation is implemented and visually verified: every scoped
  operation reauthorizes with Pika, denied membership invalidates token/memory and
  ignores late replies without remounting academic children. Legacy caching stays.
  Final independent integration review remains pending.
- Extend adversarial SQL coverage (held leases, source races, restore and legacy
  finalizer/callback paths), focused checks, remediation and final cumulative
  independent review, then draft-first exact-SHA PR Gate CI.

Initial evidence: full focused source checks passed (61 files / 520 tests,
architecture, UI/design policies, TypeScript and lint). The first independent
Sol/Terra wave found three blockers: provisional-copy coverage, same-command
attendance lease closure, and provider-pending cron health. The correction batch
adds both provisional-object and unfinished-intent checks, serializes copy
producers with reservation, drives closure from the exact transitioning reference,
and keeps pending visible while excluding it from ordinary stuck counts. The
43 affected cron/purge tests and TypeScript pass. Rollback SQL cases for these
findings are authored but unexecuted; cross-connection race evidence is pending. The pending-only171 dry run is read-only. The current migration hash
and review checkpoint are recorded in the coordinator packet, not a claim of
schema acceptance.

## Remaining release and product gates

No merge, deployment, migration application, provider activation, live canary or
scheduled cleanup is authorized by this implementation. Unknown managed copy
classes remain blocked. Academic files, archive/Gradex copies, remote grading,
restore-independent suppression, retention policy and complete local inventory
remain independent obligations. Never delete a whole-class archive or invoke
whole-roster Bara decommission to satisfy one participant's cleanup. No physical
erasure, two-day promise, legacy profile retirement, historical-removal backfill,
achievement copying or reset is claimed. Phase4 worker policy and Phase5 pilot
remain separate.
