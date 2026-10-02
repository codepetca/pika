# Dormant shared-admission bulk lesson-plan writes

This is preparation within batch 1, not activation. The single-date transaction
in PR1424 is reviewed and in CI; it must merge before this slice is published.
Migration226 is installed locally and must remain unchanged. The next additive
migration is tentatively227, subject to a latest-main numbering check and separate
exact-target application authorization. No new migration is applied by this work.

The proposed admitted path authenticates before params or body, validates the
classroom identifier and current-owner preflight, then sends one normalized batch
to a service-only actor-bound transaction. Admission grants no classroom access.
Both global role values can act as the actual current owner; absent/nonadmitted
callers retain the original teacher-only route unchanged. There is no read-pair
gate reuse, subscription-to-owner inference or unguarded fallback after failure.

## Transaction and compatibility contract

The dedicated bulk RPC calls unchanged226 inside one transaction. It acquires
the classroom operation fence, checks the purge guard, locks the current parent
NOWAIT and verifies owner/active state. Before processing any date, it prelocks
all affected existing client heads in deterministic date order, then all affected
lesson rows NOWAIT. No trigger or lifecycle guard is disabled.

For this new admitted path, any database failure rolls back the entire batch,
including earlier rows, heads and archive/Blueprint revisions. This differs from
legacy partial completion on failure and is intentional. Successful behavior stays
compatible:250 plans plus250 clears, unique disjoint dates, per-date/client ordering,
versioned saves before clears and unversioned clears before saves. A blank plan
is an upsert; only explicit cleared_dates delete. Content conversion, identity,
lineage and existing triggers are preserved.

A stale/equal date is a successful no-op within the batch, not a batch failure.
Accepted saves and clears count as mutations, including clears of missing dates;
upsert results include nonnull current rows for stale/equal saves in original
plan-input order. A stale save after an accepted delete returns null and is omitted;
stale-clear rows are also omitted. Unversioned writes do not advance
heads. The public response remains `{ updated, cleared, lesson_plans }`.

The private per-operation result must have exact cardinality, order, operation,
date and classroom binding, with the existing explicit eleven-field row projection.
The server validates named SDK success/error envelopes, including nullable error
metadata. Invalid requests return400, missing classroom404, nonowner/archive403,
transaction/lifecycle contention409, absent RPC or unverifiable evidence503.

Atomic database rollback does not remove ambiguous postcommit network failures.
The existing browser retains failed drafts and can replay the same ordered nonce;
equal-sequence retries converge on the current authorized row. Unversioned retry
and revision behavior stays unchanged. No UI changes or new byte cap are included.

## Acceptance and rollout hold

Source TDD, strict route/SDK contract tests, static migration checks, generated
types from an authorized matching schema, and a real synthetic database/concurrency
harness are required. In particular, a late Blueprint-clear conflict must leave
earlier saves, heads and both revision families unchanged. Tests must cover both
owner roles, denial and transfer/archive orderings, batch/date/legacy contention,
the500-date boundary, stale/equal replay, actual REST/SDK conflicts, privileges,
lineage and exact fixture/audit cleanup. These are acceptance requirements, not
completed receipts at preparation time.

Copy remains a separate later slice. Complete decommission transitions remain an
integrated lifecycle/release gate. Production schema, billing, AI, account plans,
cohort admission and the live home/page routing remain unchanged. The five-batch
goal is not complete until its integrated rehearsal and authorized release.
