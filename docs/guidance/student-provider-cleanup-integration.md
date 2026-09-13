# Student provider cleanup integration — Phase 3 prerequisite

Status: initial source review and one correction review complete; runtime integration,
canonical database types and local rollback verification complete at171. Final review
corrections await targeted review and local172 verification. No provider requests.
This is a prerequisite increment, not Phase 3
completion. Owner: task `01a09b31-f9d8-7ce0-8a20-0bfd61f67009`, branch
`codex/pal-student-cleanup-integration`. Risk: runtime-platform.
Model recommendation: GPT-6 Astra for implementation; Sol/high security and
concurrency review, Terra/high compatibility and coverage review.

The selected [six-phase plan](classroom-pal-and-student-cleanup-plan.md) governs
product intent. Main is `f67852cf` (Phase 2 PR1256 merged); local Pika is verified
through001–171 after the direct user-approved local171 application. Production remains through168 according to the coordinator's
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

## Verification and remaining review

- Exact reviewed migration171 (SHA256598ee035bea90e47aade94acb7d79ce2227e110c343e57be0661e71ce4ccd587)
  applied once to the existing local Pika database. Ledger001–171, all private
  gates off, no synthetic fixture rows retained. Canonical generated types and
  their drift check passed at171. Generated types were not edited by hand.
  Forward correction172 preserves the function signature and authorization call
  while removing an unused return variable flagged by warning-level database lint.
  It remains unapplied pending its own exact local approval; post172 lint/type
  drift and database verification are not yet claimed.
- The bounded coordinator's direct typed RPC bridge and generation-aware
  attendance scan/pre-send/replay consumers are authored and covered by synthetic
  tests. TypeScript passes against the generated contract; the nullable replay
  lease has an application-level refinement because PostgreSQL metadata omits
  input nullability. No generic RPC escape hatch is used.
- Host browser invalidation is implemented and visually verified: every scoped
  operation reauthorizes with Pika, denied membership invalidates token/memory and
  ignores late replies without remounting academic children. Legacy caching stays.
  Final independent integration review remains pending.
- Rollback SQL covers held leases, source isolation, copy ownership/intents,
  strict receipts, legacy finalizers/callbacks and aged-operation health. The
  separate contention harness runs two real connections and verifies five RPC/
  producer lock conflicts plus rollback and lock release. Fixtures remain
  uncommitted: this is not a committed-row MVCC claim/removal race rehearsal.
- Complete final focused checks, remediation if needed and cumulative
  independent review, then draft-first exact-SHA PR Gate CI.

Initial evidence: full focused source checks passed (61 files / 520 tests,
architecture, UI/design policies, TypeScript and lint). The first independent
Sol/Terra wave found three blockers: provisional-copy coverage, same-command
attendance lease closure, and provider-pending cron health. The correction batch
adds both provisional-object and unfinished-intent checks, serializes copy
producers with reservation, drives closure from the exact transitioning reference,
and keeps pending visible while excluding it from ordinary stuck counts. The
43 affected cron/purge tests and TypeScript passed at the correction checkpoint.
The rollback SQL cases now pass against local171. Initial fixture setup was
corrected to register objects before marking provisional owners adopted, and to
accept the earlier lifecycle-conflict denial for unfinished restore intents.
The applied migration itself is unchanged from the reviewed hash.

The committed browser checkpoint97384ff8 passed605 tests and eight synthetic
browser cases, with desktop/mobile and light/dark captures visually inspected.
Subsequent runtime integration has its own attendance/provider regression coverage;
those mocked checks do not establish real SQL race safety. The independent-review
session ended at15:44UTC with three launches and one correction batch. The user
approved an extension of up to30minutes and two additional launches; prior usage
remains counted. Its clock starts when the final review begins.
Final cumulative review found the Pal retry classification and the known SQL lint
blocker; both are batched into the next source checkpoint for targeted review.
The extension runs16:01–16:31UTC, with at most five launches total.

## Remaining release and product gates

No merge, deployment, additional migration application, provider activation,
live canary or scheduled cleanup is authorized by this implementation. Unknown managed copy
classes remain blocked. Academic files, archive/Gradex copies, remote grading,
restore-independent suppression, retention policy and complete local inventory
remain independent obligations. Never delete a whole-class archive or invoke
whole-roster Bara decommission to satisfy one participant's cleanup. No physical
erasure, two-day promise, legacy profile retirement, historical-removal backfill,
achievement copying or reset is claimed. Phase4 worker policy and Phase5 pilot
remain separate.
