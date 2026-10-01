# Contextual teacher Daily roster logs and previews

Status: bounded batch-1 implementation; dormant, not rollout permission.
Follows merged teacher entry/history PR #1420 and reuses
[shared admission](classroom-experience-admission.md). No schema, account-plan,
global-role, UI or production change.

## Scope and compatibility

Only `GET /api/teacher/logs` adopts the shared actor authorization. Authenticate
before admission/input parsing. Absent configuration and non-admitted actors keep
the legacy teacher-role branch, errors and queries. Invalid admission fails closed
after authentication. Either global account-role value is supported for an admitted
current owner. Paid plans, joining or a client-asserted role do not grant teacher reads.

Keep archived-owner access and the legacy response: classroom ID, requested date
or null, and logs sorted by learner email then identity. Each log has learner
identity/email/optional profile names, the selected-date entry or null, and up to
five newest history entries ordered by date then update time descending. No date
means no selected entry, not the newest entry. Preserve the explicit legacy entry
field projection and empty-roster response; do not leak joined relationship metadata.

## Statement-bound query

An owner preflight retains missing-classroom 404/non-owner 403 behavior. It does
not authorize any later payload. Every data page is rooted in current classroom
enrollments, joined to the classroom filtered by the current session actor owner,
and joined to that enrollment's learner, optional profile and two entry aliases.
Both entry aliases filter the same classroom. The selected alias additionally
filters the exact date (or has limit zero); the preview alias orders and caps five
entries **per learner**, not per page. Current membership and ownership are part
of the same statement that retrieves profile and entry payloads.

Validate every enrollment/classroom/learner/profile/entry identity and shape;
verify selected dates and preview bounds/order before projecting the response.
Return generic unavailable on query errors, rejected requests or malformed and
cross-bound evidence. Never use the existing preview RPC or its per-student
fallback as contextual authority; both trust previously supplied identities.

Read deterministic 1000-enrollment pages with a strictly advancing UUID keyset.
This avoids an already-read enrollment deletion shifting an offset and skipping
the final unread learner. Validate page progression and unique learner identities;
do not add an arbitrary classroom-size cap. Ownership/membership changes before
a data page suppress affected unread data. Earlier authorized page snapshots are
not recalled by later revocation. This is ordinary per-statement consistency, not
an atomic whole-roster snapshot or locking guarantee.

## Acceptance and next work

Local-only `scripts/check-contextual-teacher-daily-logs.ts` uses exact random
synthetic users/classrooms/profiles/entries, not hosted credentials or existing
classrooms. Prove a 1001-learner roster with seven entries each yields all learners
and five previews per learner, optional profile shape, both role values, cross-class
isolation, exact-date/undated/empty/archived behavior and non-owner denials. Force
committed removal/transfer before a page and removal between pages; assert no
unbound profile/entry/RPC requests and exact cleanup. Apply no migrations, reset
or reseed. Wire this harness into ephemeral CI and run focused unit/API/legacy
checks plus canonical focused checks, independent high-risk review and exact-head
PR Gate before merge. Receipts belong in the PR; this document proves no result.

If actual nested PostgREST behavior cannot satisfy the contract, stop and reconcile
an additive actor-bound service-only paged RPC, with current numbering/types/review
and rollout authorization. Do not silently weaken binding or introduce N+1 fallback.
Cached teacher summary reads are the next separate slice, followed by remaining
everyday operations in the [roadmap](classroom-access-and-entitlements-roadmap.md).
Full experience activation still waits for all roadmap batches and the compatible
recovery rehearsal. Risk: runtime-platform; independent-review risk high.
