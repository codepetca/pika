# Shared classroom roster management read

This is a dormant batch-1 consumer of the existing server-owned
[complete-experience admission](classroom-experience-admission.md) contract.
It covers only `GET /api/teacher/classrooms/[id]/roster`; it does not activate
the shared experience, change subscriptions, or make roster mutations cross-role.

## Authority and compatibility

Authentication precedes admission parsing and request parameters. An admitted
actor with either global role may read a classroom they currently own, including
an archived classroom. Enrollment alone never grants roster-management access.
Absent or unmatched admission retains the complete existing handler, including
its historical removed-column and missing-binding-table fallbacks. The shared
handler fails closed on missing schema, malformed evidence or SDK failures and
never retries the legacy handler.

A classroom preflight distinguishes missing and non-owned classrooms but does
not authorize data reads. Every roster and enrollment payload statement selects
the requested classroom with its current authenticated owner. This includes the
terminal empty page for each collection. Removed roster rows are filtered out.
Real foreign-key embeds carry the roster's one-to-one stable binding and each
enrollment's user identity; all parent, child and binding identities are checked
independently. UUID keyset pagination fetches at most 1,000 children per statement,
rejecting repeated or out-of-order IDs rather than silently truncating the list.
This is statement-time authority, not a whole-list atomic snapshot or a promise
of revocation after a completed statement.

## Output and stable learner identity

The output remains `{ roster, student_purge_enabled_ids }`. Roster rows retain
only the existing display fields, join source, timestamps, joined status,
stable student identity and enrollment timestamp. Account roles, user profiles,
removed-student history and attendance data are not returned.

A stable roster binding takes precedence over an email match and survives email
changes. A binding without a current enrollment is not joined and exposes no
student ID. An unbound email match may display joined status but still has a null
student ID; it must not become mutation authority. Matching uses trimmed,
case-normalized email while preserving the original displayed roster email.
Teacher-valued learners are not excluded by a global-role filter.
Multiple valid roster rows may share one stable learner binding; they remain
separate display rows, while availability receives that learner ID only once.

The existing purge helper remains an availability check, not authorization to
purge. It receives the authenticated actor, requested classroom and only stable
joined student IDs. Returned IDs must be canonical, unique and a subset of those
eligible IDs. Existing disabled/canary/enabled and safe missing-settings behavior
are retained. Errors or malformed availability evidence return a generic 503.
The optional resolver injection is server-only and cannot be supplied by HTTP.
Purge mutations retain their separately governed access paths.

## Verification and remaining work

Red-first unit/API tests cover authentication order, both global-role owners,
member denial, archived/empty/removed cases, strict SDK envelopes and cardinality,
foreign identities, pagination and terminal-page authority, stable bindings,
email matching and purge-availability boundaries. An installed-SDK fake fetch
checks the serialized PostgREST query rather than only fluent mocks.

The separate actual-local-SDK harness is
`scripts/check-contextual-classroom-roster-read.ts`. It is constrained to the
Pika local Docker project and API, uses invocation-specific synthetic fixtures,
and must prove normal and forced-failure cleanup before acceptance. Source tests
alone do not establish database behavior. No migration or generated type change
is required for the read contract.

Local acceptance evidence on 2026-10-03: 407 focused tests across 21 files and
architecture/UI/design/TypeScript/lint checks passed. The actual local SDK harness
passed normal execution with 1,001 bulk learners plus special identity cases,
including a valid duplicate stable binding, current-owner checks on both
collections' terminal pages and malformed actual-array transport. The forced
post-fixture run exited with its expected error and the exact zero-residual/global
baseline cleanup sentinel. No hosted database or real account was changed.
Independent review and final stable-head CI are still required before merge.

Roster additions, confirmed CSV imports and counselor updates still need
transaction-time current-owner/active-class fences. Preserving removal's existing
stable-identity and legacy role-filter edges need their own mixed-role parity
review. Class-day/core reconciliation also remains batch-1 work. This read slice
does not satisfy the entire five-batch cutover's acceptance gate.
