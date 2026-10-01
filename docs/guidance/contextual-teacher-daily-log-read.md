# Contextual teacher Daily entry and learner-history reads

Status: bounded batch-1 implementation; dormant, not rollout permission.
No schema, UI or account-plan change. This follows the
[learner reads](contextual-daily-log-read.md) and uses the same
[shared admission](classroom-experience-admission.md).

## Scope and compatibility

Only `GET /api/teacher/entry/[id]` and `GET /api/teacher/student-history`
adopt shared admission. Authenticate before admission or input parsing. Absent
configuration and non-admitted actors retain the existing teacher-role branch,
query, response and errors. Malformed admission fails closed after authentication.
An admitted account with either global role may read only as the classroom owner;
joining, a paid plan or a client-asserted role never grants this permission.

Both reads preserve archived-owner access. Neither changes lifecycle state,
membership, quotas, signup or the authenticated account's global role. Contextual
identifiers are validated as UUIDs; database failures and malformed/cross-bound
evidence return a generic unavailable response, without legacy fallback.

## Statement-bound authorization

Entry drill-down selects the entry, its learner email and its current classroom
owner in one database statement. Validate the entry identifier, learner/classroom
identities and joined classroom binding; check the joined owner before returning
the payload. No separate ownership preflight is needed. Missing entries retain
404 and non-owner requests 403. Strip the joined classroom metadata while keeping
the legacy entry and learner-email projection. As in legacy behavior, an owner
may inspect a historical entry after that learner's enrollment is removed.

Learner history preserves classroom-owner and target-enrollment preflights for
the existing 404/403 status behavior. They do not authorize the final data read.
Its entry statement independently joins and filters current classroom ownership
and the target learner's current enrollment, plus the entry's classroom/learner
IDs. Validate every returned binding and strip relationship metadata. If removal
or ownership transfer commits after preflight but before that statement, no
entries may be returned. Do not use a previously fetched roster as authority.

This is ordinary statement-snapshot read consistency, not a guarantee to recall
data read before a later revocation. There is no new write, lock, retry or
unbound fallback. History keeps newest-first order, its default 10/cap 50 limit,
and the existing exact-date or strictly-before-date contract.

## Acceptance and follow-up

Unit/API checks must cover both role values, legacy compatibility, authentication
ordering, admission errors, archived owners, membership/ownership denials, UUID
and result binding, projections, date filters, limits and unavailable evidence.
The local-only `scripts/check-contextual-teacher-daily-read.ts` contract must
exercise real PostgREST joins, isolated synthetic fixtures, owner transfer and
enrollment removal at the entry read, and exact fixture cleanup. It applies no
migrations and is also wired into ephemeral CI. Passing evidence and the fixed
reviewed SHA belong in the PR receipt; this specification alone proves no result.

Roster-wide teacher logs and previews are the next separate slice; the existing
preview RPC trusts its supplied classroom/student IDs and must not be reused as
an unfenced contextual read. Cached log summaries then need current ownership
bound to their own data reads. Class-day/attendance and other batch-1 operations
remain outstanding. Full-experience activation still waits for every roadmap
batch and the compatible recovery-floor rehearsal. Risk: runtime-platform;
independent-review risk is high (authorization/privacy).
