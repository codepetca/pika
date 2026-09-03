# Contextual calendar write boundary

Next phase 2 slice after [classroom-core APIs](classroom-core-contextual-access.md).
Branch: `codex/contextual-calendar-writes`, originally stacked on reviewed #1174 at `6e5a4ffc`.
Migration 152 is applied and behaviorally verified on local Supabase only after the
user's exact one-time authorization. Runtime wiring is implemented, disabled by default;
the initial independent reviews and CI passed at `45687915`. Main-only landing is
owner-approved after dependency synchronization, integration review and fresh CI;
the PR records the final SHA/evidence. No hosted rollout is approved.

## Why the database boundary comes first

The existing calendar generator updates the classroom range and then inserts day
rows in separate requests. A failure can leave a range without its calendar. Existing
toggles authorize before a separate read/insert/update sequence. Substituting a
contextual role check alone cannot guarantee that ownership/archive state still permits
the write. Outside the exact classroom-core pilot pairs, both route families retain
their legacy writers, ownership guards and disabled-gate request behavior.

## Migration 152 (local verification only)

`152_contextual_classroom_calendar_writes.sql` adds two service-role-only functions;
applying it does not change existing classroom rows or grant browser execution:

- `create_classroom_calendar_v1`: validate a bounded range/date set, lock the classroom
  row, recheck its current owner/archive state, reject an existing calendar, update the
  range and insert the days in one transaction. An insert/trigger error rolls back both.
- `set_classroom_calendar_day_v1`: lock and recheck the classroom, then enforce the
  actual Toronto date after any lock wait. Upsert by classroom/date, retain the prompt,
  and avoid an update for an identical repeated value.

The actor UUID must come from the authenticated server identity, never a request body.
Neither function consults global teacher/student roles or subscription labels. Public,
anonymous and authenticated execution is revoked; only the server service role is granted
execution. The search path is fixed and application tables are schema-qualified.

Generation accepts a range of at most 366 days' difference (367 inclusive dates), with
at least one distinct, non-null date inside the range. This is an execution bound for
the new pilot path, not a plan allowance or a decision about classroom-creation quotas.
The server caller generates dates with existing Ontario calendar/holiday helpers;
it never forwards client-supplied date arrays. Existing disabled-gate input behavior stays
unchanged. Calendar creation retains the existing 409-on-repeat semantics; a retry must
read the current calendar and must not erase later edits.

## API contract and failure handling

Both `POST` and `PATCH` on `/api/classrooms/[classroomId]/class-days` and
`/api/teacher/class-days` use the existing server-only classroom-core flag and exact
user/classroom pairs. There is no additional rollout flag, subscription check or
client-selectable mode. The trusted authenticated owner may have either global role.
Membership alone never permits these writes. Archived owners are denied in the server
and rechecked under the database lock; the RPC actor/classroom come only from that
trusted access context.

The body-addressed compatibility URL defers its one JSON read until authentication.
With the gate disabled it retains `requireRole('teacher')` before parsing anything.
When enabled, a wrong-role actor with no pilot pairs is rejected before body parsing;
an actor admitted elsewhere must supply a valid identity-bearing body so the exact
pair can be determined. Noncanonical UUID spellings never escape to the legacy writer.
Malformed configuration fails closed. Nonpilot ownership checks remain mandatory.

Named Zod schemas validate pilot input once after authorization (the compatibility
URL decodes only classroom identity beforehand). POST accepts existing semester/year
or valid custom dates, preferring a complete valid semester; the semester year supports
1900–9998 to keep generated dates representable. Date arrays and actor/plan claims are
discarded. PATCH requires a real calendar date and boolean. Past toggles use Toronto
today, also rechecked with database wall-clock time after any lock wait. The API-Zod
baseline removes these two files because they now have named boundaries; their
deliberately unchanged nonpilot branches still retain legacy validation debt.

Returned days must have valid fields, unique IDs/dates and exactly the expected
classroom/date/value set. Foreign, missing, duplicated or malformed evidence returns
503. Known RPC errors map to 404 (missing classroom), 403 (owner/archive denial),
400 (invalid input/past day), or 409 (existing calendar). Missing functions and other
database errors return 503, never raw error details or a legacy retry. A failure after
the database commits (transport or response validation) is an uncertain outcome, **not**
proof of rollback: refresh before retrying. POST retries preserve the 409 conflict;
same-value PATCH retries do not erase prompts or re-update the row.

The atomicity guarantee is for the new RPC operations and parent-row lifecycle writes.
Unmigrated legacy writers retain their existing behavior; this is not a general audit
or locking protocol for every writer touching a classroom/calendar. Broader mixed-role
access remains blocked on the other phase-2 surfaces and recovery controls.

## Verification

- Four red-first structural tests pass. They check privilege statements, fixed search
  paths, lock/check/write ordering, generation bounds and Toronto-time placement.
  They do **not** execute or prove PostgreSQL behavior.
- `scripts/check-contextual-calendar-database.sh` passes shell syntax and the actual
  local database run after authorized application. It targets only `supabase_db_pika`
  container and uses synthetic fixtures inside one rolled-back transaction. It never
  applies migrations or leaves seeded rows. A fixture-only trigger forces an insert
  failure to test rollback of the preceding range update.
- Local migration history matched 001–151 before application. Fresh preflight listed
  only 152 as pending; one authorized `supabase db push --local --yes` applied it.
  History now matches 001–152 with no drift. Types were generated from that schema
  (only the two new function contracts were added), and `db:types:check` passes.
- `node scripts/check-contextual-calendar-concurrency.mjs` passes actual independent
  PostgreSQL sessions: archive wins, ownership transfer wins, calendar write wins,
  duplicate generation and competing toggles. It observes `pg_blocking_pids` before
  releasing the holder; sleeps alone are never evidence of lock serialization. Only
  invocation-specific random synthetic fixtures are committed and removed in `finally`.
  It verifies the exact local project/container/port and never applies migrations.
- Server and API tests cover both global-role owners, nonowners/members, archive and
  Toronto past-day denials, malformed input/configuration, UUID aliases, missing RPCs,
  invalid returned evidence, authenticated identity binding and nonpilot compatibility.
- Both database harnesses run in the ephemeral CI database lane after normal migration
  replay; adding CI replay coverage does not authorize any hosted migration application.

## Remaining work and authority

1. Local application authorization for migration 152 has been consumed successfully.
   Any retry, correction migration or other target needs fresh authorization under the
   [schema checklist](schema-rollout-checklist.md); never repair/reset history implicitly.
2. Complete focused checks, Pika audit, draft-first high-risk independent review and CI.
   Coordinate dependency/main changes and migration numbering before publication.
3. Follow the classroom-core rollout prerequisites: finish reachable surfaces and a
   compatible recovery floor before admitting real mixed-role classes. Disabling the
   flag/removing pairs can strand an admitted mixed-role user and is not a safe rollback.
   Retain additive functions when rolling back code; do not drop them while callers exist.

The release coordinator cleared the #1169 window after production canaries. The owner
then explicitly approved #1172, #1174 and #1175 landing in main after synchronization
and fresh checks. Each child must target main, not merge into its feature dependency.
Local migration approval never authorizes hosted application, enabling the pilot,
production deployment or broadening classroom creation eligibility. Neutral onboarding
still requires the rest of the [roadmap](classroom-access-and-entitlements-roadmap.md).
