# Shared roster owner writes

This batch-1 slice prepares manual roster additions, CSV preview/confirmation and
counselor-email edits for the shared classroom experience. Current classroom
ownership, not the actor's global teacher/student label, permits these operations.
Members cannot manage a roster. Archived classrooms cannot be changed.

The shared admission and full cutover remain disabled. This contract does not
enable onboarding, create enrollments, change subscription allowances, widen
purge permissions, or replace the existing preserving-removal path.

## Authority and bounded rollout

On 2026-10-03 the owner explicitly authorized completion of the remaining task,
including implementation, local migrations, independent review, ordinary main
merges and necessary review extensions without repeat approval requests. Each
extension must retain the original clock and counters and be recorded in the
review ledger. Absolute reviewer/fix caps, branch protections, exact-head CI,
privacy requirements and integrated release prerequisites remain mandatory.

Local migration application still requires reviewed immutable SQL, the exact
local project binding, matching history, current numbering, a one-file preview
and one ordinary application. Do not reset, repair, reseed or reapply history.
Production application and activation do not follow from a successful slice.

## Atomic database boundary

The proposed additive migration adds two server-service-only operations:

- `upsert_classroom_roster_for_owner_v1`: manual additions and CSV operations.
- `update_classroom_roster_counselor_for_owner_v1`: one optimistic counselor edit.

Authenticated server identity supplies the actor; HTTP actor/role/plan claims
never supply authority. The transaction locks and rechecks the current active
classroom owner and relevant roster, enrollment, user and stable-binding state.
Existing lifecycle and student-purge fences remain authoritative. Nonblocking
locks make conflicting legacy or purge operations return a refreshable conflict
without partial writes or an implicit SDK mutation retry.

Stable bindings take precedence over email matching. Otherwise, only an exact
classroom enrollment and current normalized account email may derive a binding,
regardless of global role. Ambiguous or removed identities fail closed. Existing
historical IDs, removal/retained-attendance fields and stable bindings survive.
Multiple legitimate roster rows for the same enrolled learner remain supported.
No operation enrolls a user or restores removed historical data implicitly.

Persisted values, full transport rows, identity, affected-row cardinality and
immutable historical state are verified after triggers and before commit. A
suppressed/substituted mutation or late failure rolls back the entire operation,
including derived bindings and archive revisions. The adapter independently
validates the returned envelope before projecting the existing HTTP response.
A transport failure after commit remains an uncertain outcome, not rollback.

## Input and compatibility

Only admitted shared requests use the new branches. Authentication precedes
shared route parameters and body parsing; malformed admitted inputs or database
errors never retry through legacy code. Existing unmatched/exact-pair branches
and all removal, bulk-removal and purge behavior remain unchanged.

Manual additions retain existing partial missing-field errors. CSV retains the
existing optional student-number/header/simple-comma decoding behavior. Actual
changes to names, student number or counselor email require confirmation; preview
returns the existing changes/counts without writing rows, repairing bindings or
bumping revisions. A no-change preview may upsert immediately, as before, so the
preview decision and write share one transaction.

Counselor edits preserve case, trim whitespace and map blank values to null.
The expected timestamp retains its original offset and fractional precision;
PostgreSQL compares it without a JavaScript Date round trip. Stale or removed
rows conflict; a missing or cross-classroom row is not found.

Execution defenses bound decoded operations to 1,000 rows, raw CSV to 1 MiB,
email fields to 320 Unicode code points, names to 500 and student numbers to 128.
These bounds are not subscription quotas. Duplicate normalized request emails
are invalid; ambiguous existing normalized identities conflict.

## Acceptance evidence

Source/structural tests are not proof of PostgreSQL atomicity. Before landing,
the coordinator must verify the reviewed migration locally and run genuine SDK
and serialized SQL proofs covering both owner labels, member/archive denial,
CSV preview/confirmation, precise optimistic timestamps, stable and derived
bindings, removed identities, user-email changes, exact purge fences and
classmate isolation. Contention, suppressed/late-failing writes and all retained
state/revision rollback require actual database evidence.

Both ordinary and deliberately failed fixture runs must restore exact synthetic
state and global baseline counts. The harness uses only the verified local
container and loopback API, never hosted endpoints or real accounts. CI must
replay the additive migration and run both proofs. Genuine generated types must
match the installed schema; no fabricated function contracts are permitted.

Migration235 was applied locally on2026-10-03 after a narrow independent security
review and two targeted checks. The immutable installed SHA256 is
`dded003c0fdd92235af163ef73751e1a9442146ee2129015ace83acdc2ff685b`.
The first ordinary application failed on an unparenthesized PL/pgSQL CASE operand;
read-only inspection confirmed complete rollback: no235 history or functions and
latest234. The parser-only correction passed12 structural tests and targeted review.
A fresh exact235-only preview preceded the successful ordinary second application;
history now001–235, two publicRPCs present. Genuine generated types match the schema.
Serialized SQL proofs pass retained-identity denial, exact purge fences, optimistic
PATCH and full-row/binding/revision rollback. RealSDK normal and forced-cleanup
proofs pass both roles, CSV/bindings/Unicode/timestamps, observed contention and
exact cleanup/global baseline.273 focused tests across17 files and allstatic/lint
checks pass. A curated nullable-input refinement derives from the genuine235RPC
signature using the existing FunctionContract seam; generated source and installed
SQL remain unchanged. Full draft-PR review, exactCI and merge remain pending;
narrow pre-application review is not a fullPR review. Production/rollout unchanged.
Shared roster GET is separate PR #1443. Mixed-role joining and preserving removal
remain independent prerequisites; this slice does not complete batch 1.
