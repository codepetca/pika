# Contextual Daily Log saves

Status: in development, dormant. The migration is now
`224_contextual_daily_log_save.sql`, resequenced after current main allocated
223 to `stop_assignment_grade_conflict_retries`. The unchanged Daily Log SQL
was applied locally under its former number 223 with the owner-approved
221–223 set on 2026-09-30. Local migration history now needs alignment;
production application of Daily Log remains pending.
This is one bounded part of batch 1 in the
[classroom-access roadmap](classroom-access-and-entitlements-roadmap.md), not
permission to activate a cohort or the Teaching/Joined interface.

## Scope and architecture

Keep Pika's existing server/session authorization and service-role database
client. Do not switch to browser database access, Supabase Auth, user-JWT RLS,
or a new database credential. The server authenticates the actor; a service-only
transaction independently checks the actor's classroom relationship at save
time. The supplied actor ID remains a trusted-server assertion, not a database
proof of the end user's session.

Only `POST` and `PATCH /api/student/entries` consume the existing
`PIKA_CLASSROOM_EXPERIENCE_ADMISSION` contract in this slice. Absent configuration
preserves the legacy path. Non-admitted accounts retain student-role checks.
Malformed configuration fails closed after authentication. Admitted accounts
must be members of the requested live classroom, regardless of their global
role; owners cannot submit learner logs even with historical self-enrollment.

Daily Log GET, teacher log/history/summary reads, attendance, other domains,
navigation and the home interface remain outside this slice. In particular,
this write adapter alone does not provide a complete mixed-role Daily experience.

## Transaction contract

`save_daily_log_for_member_v1` is additive and callable only by `service_role`.
It has an empty search path and qualified application references. It:

- Acquires the existing Daily Log atomic-writer fence, then classroom and
  membership/purge fences; checks the current classroom, owner precedence,
  enrollment, class-day state and Toronto-local date under locks.
- Uses nonwaiting row locks after advisory fences so a legacy direct writer
  with reverse-order locks produces a retryable error instead of a deadlock.
- Requires both entry ID and version for updates. A null pair means create-only.
  Stale revisions and delete/recreate identity changes cannot overwrite work.
- Reuses the established academic-write/Pal-outbox transaction and existing
  purge, tombstone, archive-revision and membership-Pal triggers. It validates
  any optional Pal event against the activity date; HMAC identity generation
  remains the server's responsibility.

The new transaction is used even when Pal is disabled or optional preparation
fails. Delivery happens after commit. Missing migration, malformed response,
database failure or denied authorization never fall back to direct writes.
API adapters validate returned entry identity before exposing success/conflict
data. An update conflict may contain the current replacement entry only if it
still belongs to the same actor/classroom/day.

## Verification and rollout

Risk: authorization, compatibility and concurrent writes (`runtime-platform`).
No new schedule, dependency, table, backfill, account grant or plan change.

- Unit/API regressions cover admission, both global roles, owner exclusion,
  lifecycle denial, response binding, conflicts and Pal-independent writes.
- `check-contextual-daily-log-save-database.sh` is a local-only rollback fixture
  for actual privileges, membership, date, revision and outbox behavior.
- `check-contextual-daily-log-save-concurrency.mjs` uses isolated synthetic local
  rows and removes them afterward. It checks row-lock retries, removal/archive/
  class-day races and competing revisions. Neither harness applies migrations.

The owner authorized one local application under the original number 218;
it succeeded on 2026-09-27 and both database harnesses passed. The SQL body is
unchanged by resequencing. That receipt does not describe the current shared
local database: on 2026-09-30 it records main's migrations through 220, including
the Blueprint 218, and the Daily Log function is absent. No history repair,
reset, or new migration application was part of that source reconciliation.
The owner subsequently authorized exactly 221–223 locally; one application
succeeded on 2026-09-30. At that checkpoint, history matched the branch's 223, the Daily Log
function exists, generated types match, and the security advisor reports no issues.
The local rollback behavior and all eight concurrency cases pass; synthetic
fixtures were removed. Blueprint provenance/adoption checks also pass against
the explicitly pinned local container.
Independent final integration review and exact-head CI passed at 656a9a1e.
Those checks predate the new main migration 223; the reconciled 224 candidate
requires its own fixed-head review and CI.
Production application still requires its own exact permission. Deploying the
dormant code or applying the function must not configure a live admission cohort.
The full experience and recovery-floor checks in the main roadmap still gate
activation.

## Local 223 collision recovery — proposed, not executed

The CLI compares migration versions, not SQL identity: before repair a dry-run
can incorrectly report only 224 pending, even though local 223 records Daily Log
and main 223 is the assignment-grade conflict correction. Do not apply that
preview: Daily Log's `CREATE FUNCTION` would target an existing function and the
real main 223 would remain unapplied.

After independent review and exact owner authorization, preserve the installed
Daily Log function and existing data:

1. Verify local project `pika`, exact container `supabase_db_pika`, history through
   222, and old 223 name `contextual_daily_log_save`. Confirm the installed Daily
   function body, signature, definer/search path and grants match migration 224;
   SQL SHA-256 is `338fb8b314ae278944575369eef8841aba5dc873c72b6d42d4937af179f88767`.
2. Remove only the old 223 history receipt with
   `supabase migration repair 223 --status reverted --local`. This edits history,
   not the schema, and does not drop the function.
3. Record that already-installed identical function under the canonical number:
   `supabase migration repair 224 --status applied --local`.
4. Run `supabase migration list --local` and
   `supabase db push --local --include-all --dry-run`. Proceed only if the complete
   preview is exactly `223_stop_assignment_grade_conflict_retries.sql`.
5. Apply that main correction once using
   `supabase db push --local --include-all`. The exceptional flag is necessary
   because missing 223 precedes the already-recorded 224; it requires explicit
   approval and does not permit any additional pending migration.
6. Verify all history identities through 224, generated types, assignment-grade
   conflict behavior and Daily Log rollback/concurrency contracts; confirm real
   data and rollout settings are unchanged.

The previous local 221–223 application permission is consumed and did not
authorize either repair or another application. Request approval for this exact
local sequence; stop on any unexpected state or command failure. Do not retry a
failed application, reset/reseed, repair production, paste migration SQL, or mark
an unverified function as applied. If another task changes the migration sequence
or local schema, re-plan before mutating it.
