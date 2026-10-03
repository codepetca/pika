# Shared calendar owner writes

This dormant batch1 slice adds shared-admission POST/PATCH branches to both
calendar route families. Only the authenticated current active classroom owner
can create/toggle a calendar, regardless of global account-role label. Membership
alone does not authorize writes. Shared GET is the separate class-day read slice.
Absent/unmatched admission retains every existing pilot/legacy handler unchanged.

## Boundary

Authentication precedes parameters/body parsing. The compatibility URL reads its
body once, validates classroom identity and operation through named schemas,
and discards client actor/role/plan/date-array claims. Server-generated Monday–Friday
dates retain existing semester/custom-range precedence and bounded range semantics.
No new migration or generated type is needed: installed152 already exposes the
two typed, service-only calendar operations and rechecks owner/archive state under
the classroom lock. It checks Toronto today after any lock wait.

The feature-owned adapter validates the genuine SDK envelope, exact five-field
projection, unique IDs/dates and requested classroom/date/value set. Malformed,
foreign, duplicated or missing evidence returns503 without legacy retry or raw
database details. Known missing/member/archive/past-date/repeated-calendar errors
remain404/403/400/409. Transport validation can fail after a committed RPC; refresh
before retrying. No claim of rollback is made for that uncertain outcome.

Identical toggles preserve the calendar row, prompt and CTID. Existing082/095
BEFORE INSERT resource triggers still bump the archive revision for a conflict
attempt, even when152 performs no UPDATE. Row idempotency is not revision idempotency;
this slice does not modify the installed trigger or152 to change that behavior.

## Evidence

Source tests passed176 new assertions plus315 unchanged read/calendar assertions.
Scoped ESLint, architecture, genuine TypeScript and diff hygiene pass. The complete
focused final-main gate and independent full draft review remain required.

The local-only installed-SDK proof passes both global-role owners, member/outsider
denial, exact weekday projections, bounds, Toronto dates, archived and former-owner
denial, prompt/row/CTID preservation and exactly-one-call malformed-response503
after a real committed mutation. Normal and forced-fixture runs restore exact
synthetic fixtures, audit rows and global baselines. The actual rollback-only152
SQL harness passes privileges and insertion-failure range/day rollback.

The reused calendar concurrency harness passes all five observed-lock races:
archive wins, owner transfer wins, write wins, duplicate generation and competing
toggles. It observes pg_blocking_pids, closes only this invocation's precisely named
sessions before cleanup, and checks exact residuals and global baseline equality.
Normal and deliberate post-fixture failure both pass cleanup. Explicit synthetic
creation grants/default-Free audit cleanup keep it compatible with current local
schema; no real account or plan is touched. CI must run SDK and forced-cleanup
proofs alongside the existing rollback and concurrency checks.

## Integration and authority

Prepared as a disjoint child of reviewed class-day GET PR1444, fixed parentd8c828ad.
Reconcile onto its actual main merge and the roster235 schema before final readyCI,
preserving the already reviewed GET/legacy branches and installed contracts.
Local235 belongs to the separate roster-owner-write slice; this branch adds noSQL.
Do not generate types against mismatched history, reset/repair the shared local DB,
or infer a new production migration from this preparation.

The owner explicitly authorizes implementation, native independent reviews,
normal main merges, local migrations and needed review extensions without repeated
asks. Record extensions while retaining original clocks/counters and absolute caps.
Shared admission and whole cutover remainOFF until all five batches meet their
integrated gates; source tests or individual merged slices do not enable access.
Production application/promotion, real account/provider changes and cohort decisions
retain separate release controls. Preserving roster removal/join parity and the
remaining batch1 everyday operations still precede assessment integration.
