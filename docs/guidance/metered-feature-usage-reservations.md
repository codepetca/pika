# Metered feature usage reservations

Migration 201 establishes dormant accounting primitives for paid AI grading and
repository review. It does not price a plan, create an entitlement, call a
provider, change a route, or activate enforcement. Joining a Classroom and
completing assigned student work remain free and never use this ledger.

## Initial product boundary

The existing `grading.ai` entitlement is the first shared quota bucket. Usage is
classified as `assignment_ai_grading`, `test_ai_grading`, or
`repository_review`, so reporting remains distinct even though the initial quota
is shared. A later plan decision may split these into separate entitlement keys
without changing historical operation kinds.

Quota units are intentionally opaque in this slice. Route integration must name
the measured unit before enforcement (for example, one grading item or one
repository-review run). Pricing, allowances, billing periods, trials and grace
behavior remain separate product decisions.

## Reservation lifecycle

`feature_usage_reservations` records one business operation under one effective
entitlement revision:

- `reserved`: units immediately count against quota while paid work is pending;
- `settled`: successful paid work permanently consumes the units in that
  entitlement revision;
- `released`: cancelled, failed, stale, superseded or expired work no longer
  consumes quota.

Reservations expire after a caller-selected TTL between 60 seconds and 24
hours. A later reservation in the same bucket releases expired rows before
counting quota. Settlement rejects an expired reservation, so route workers must
choose a TTL that covers one bounded paid operation. Long-running coordinators
should reserve per bounded item/attempt, not hold one database transaction or
reservation across an unbounded run.

The operation UUID is the primary idempotency key. Replaying the same operation
with the same fingerprint returns the existing state; changing its subject,
kind, reference, units or TTL is rejected. `usage_ref` is additionally unique
within an entitlement revision, preventing a caller from charging the same
logical item twice with different operation UUIDs. Retries that are intended to
be separately billable must use an attempt-specific reference.
Settlement and release are likewise idempotent; replaying a release with a
different terminal reason is rejected instead of rewriting its audit history.

## Transaction and security contract

Every mutation takes the operation advisory fence before the existing
subject/feature entitlement fence. Reserve then validates the current effective
entitlement, releases expired rows in that revision, counts reserved plus
settled units, and inserts only when capacity remains. This serializes concurrent
requests so a quota cannot be overspent.

The table has RLS enabled and no browser/API-role access. Only `service_role`
may read it or execute the three `SECURITY DEFINER` functions; every function
uses an empty search path and schema-qualified relations. Provider and GitHub
calls must happen outside these short transactions.

## Future route integration

Migration 202 adds the Assignment worker prerequisite as a versioned contract. Existing
and rolling-deploy runs remain version 0 and retain legacy behavior. Future metered runs can
be created as version 1, where every run/item mutation and grade finalization is fenced by
the exact current, unexpired run lease; legacy finalizers and direct service-role DML are
rejected for those runs. This does not call the usage ledger or activate metering. Migration
202 must be present before deploying the version-aware coordinator code.

For each separately reviewed paid operation:

1. Authorize the current Classroom owner and bind the exact resource.
2. Reserve units with a stable operation UUID and attempt-specific usage ref.
3. Perform the sanitized provider or repository work outside the transaction.
4. Settle after success, or release after a terminal failure/cancellation.
5. Preserve the reservation across retryable process failure so resumable work
   cannot bypass or double-consume quota.

Repository-analysis and AI-grading routes remain legacy and unmetered until that
integration is complete. Production remains at migrations 001–180.
