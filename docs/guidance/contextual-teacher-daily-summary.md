# Contextual teacher cached Daily summary reads

Status: bounded batch-1 implementation; dormant, not activation permission.
Reuses [shared admission](classroom-experience-admission.md) and the teacher Daily
actor helper from merged PR1420. No schema, role, plan, UI or production change.

## Scope and compatibility

Only GET `/api/teacher/log-summary` gains a contextual branch. Authenticate before
admission and query validation. Absent configuration and non-admitted actors keep
the legacy teacher-role path, queries and response. Invalid admission fails closed.
An admitted actor of either global account role must currently own the requested
classroom; joining or paying never grants owner reads. Archived owners retain
historical reads. Missing classrooms remain404; other relationships remain403.

Preserve existing statuses and payload: empty entries produce `no_entries`, a
missing/stale cache produces `pending`, a non-current summary policy produces
`unavailable`, and a current fresh cache produces `ready` with existing
`restoreNames` output and generation time. Retired policy is evaluated before
freshness; a current policy without an overview remains pending. Names are restored
only from validated current cached JSON. Malformed current evidence fails closed
with generic503, never provider/database details or an unverified fallback.

This reads an already-generated cache. It does not invoke AI, change generation,
metering, model/policy, charging, nightly cron or stored rows. The nightly generator
already operates on active classrooms rather than a global teacher-role filter.

## Data-statement authorization

Ownership preflight preserves status behavior but does not authorize later reads.
Every entry stats, exact HEAD count and cached-summary statement independently
joins the requested classroom and filters its current owner by session actor.
Every statement also filters the requested classroom/date. Explicitly select and
validate resource identity, date, ownership evidence and returned values; strip
joined metadata before responding. Validate query-result envelopes, safe counts,
timestamps and cached names/items as unknown; include query construction and await
in error containment. No unbound RPC/query or retry fallback is permitted.

Freshness retains entry count and max-update semantics, including the existing
nullable cache update timestamp behavior. These are ordinary independently
authorized statement snapshots, not an atomic multi-query snapshot or a lock.
If ownership transfers before a later query, that query cannot disclose the former
owner's cache or names; previous non-payload stats do not authorize the cache.

## Acceptance and next work

The local-only `scripts/check-contextual-teacher-daily-summary.ts` creates exact
synthetic fixtures using local credentials, no AI or existing classrooms. Verify
both owner role values, both enrolled learner role values being denied owner reads,
class/date/name-map isolation, output projection, exact count, all cache statuses,
archived owner, malformed name-map containment and committed ownership transfer
before stats/count/cache statements. Assert actual HEAD count obeys the inner
owner join, not just mocked query syntax. Track exact entitlement operation IDs,
guard removal by operation/subject/actor/reason/feature/fixture identity, and assert
live-state/audit cleanup. No reset, reseed or migration application.

Require TDD unit/API/unchanged-legacy tests, canonical focused/static checks, real
PostgREST evidence, independent fixed-SHA review and exact-head PR Gate before merge.
If inner-join/count behavior fails the actual contract, reconcile a reviewed
actor-bound service-only RPC instead of accepting a preflight-only substitute.
Receipts belong in the PR; this document alone proves no passing result.

Lesson-plan reads and transaction-bound owner writes follow; other everyday work,
assessments, lifecycle/services, product navigation and integrated release still
follow the [five-batch roadmap](classroom-access-and-entitlements-roadmap.md).
No individual slice authorizes the shared cohort or the new Teaching/Joined UI.
Risk profile: runtime-platform; independent authorization/privacy review risk high.
