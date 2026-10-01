# Contextual learner Daily Log reads

Status: dormant implementation, not rollout permission. No schema change.
This is a bounded batch-1 slice following [Daily Log saves](contextual-daily-log-save.md).

## Scope

Only `GET /api/student/entries` integrates the existing shared classroom-experience
admission contract. Both the classroom history and the broad history feed use it.
Absent admission configuration preserves the original student-role and classroom
guards, query behavior and response shape. Non-admitted accounts remain legacy.
Authentication precedes configuration parsing; malformed configuration fails
closed. No new flag, account grant, signup, navigation or UI change is introduced.

Admitted accounts may read their own entries in active joined classrooms regardless
of global account role. A requested classroom must resolve to a member relationship;
owners are excluded even with historical self-enrollment. Missing classrooms return
404, disallowed relationships/archived classrooms 403, and invalid contextual IDs
400. Broad feeds omit nonmember, archived and owned classrooms rather than failing
because one account has several different classroom relationships.

## Privacy and consistency

The entry query joins the current classroom and enrollment in one database statement,
filtering the session-bound student ID, membership student ID, active classroom and
non-owner relationship. Do not replace this with an earlier enrollment-ID list.
For a scoped read, this query independently enforces the relationship even if
removal/archive commits after the status-preserving authorization preflight.
Revocation winning before the entry statement therefore yields no entries.

This is ordinary statement-snapshot read consistency, not a promise to recall data
already read before a later revocation commits. There is no write, lock, retry or
fallback to an unbound entry query. Database errors and malformed/cross-bound results
fail closed with a generic 503. Result identity, classroom binding, active state,
non-owner status and joined enrollment are independently validated before response.
The relationship metadata is removed; the existing entry payload remains intact.

Existing history bounds are preserved: broad reads default to 100 entries, positive
explicit limits cap at 100, classroom history has no application-imposed limit
unless requested, and date ordering stays newest first. Database API pagination
settings still apply. No client-provided student ID can select another learner.

## Verification and remaining work

Unit/API tests exercise both global roles, admission and authentication ordering,
owner exclusion, scoped denials, query binding, projection, limits, database errors
and malformed rows. `pnpm exec tsx scripts/check-contextual-daily-log-read.ts` verifies
real PostgREST joins and revocation between preflight and read using synthetic local
fixtures. It rejects nonlocal targets, applies no migrations, cleans up only its
random synthetic IDs, and runs in ephemeral database CI.

Teacher entry/log/student-history/summary reads, attendance, class-day surfaces,
other domains and product entry remain subsequent work. Do not activate the shared
cohort until the complete reachable experience and recovery-floor checks pass.
Risk profile: runtime-platform (authorization/privacy). Production migration and
application promotion remain separately authorized operations.
