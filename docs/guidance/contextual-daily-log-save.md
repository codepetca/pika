# Contextual Daily Log saves

Status: in development, dormant. The migration is now
`223_contextual_daily_log_save.sql`, resequenced after current main to avoid
the Blueprint migration's 218. Migration 223 is not applied locally or to
production. This is one bounded part of batch 1 in the
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
reset, or new migration application is part of this source reconciliation.
Generated types retain the previously generated Daily Log signature alongside
main's generated contracts; CI must verify them against a clean replay through 223.
Local and production application require their own exact permission. Finish independent
high-risk review and pass CI before merge. Deploying the
dormant code or applying the function must not configure a live admission cohort.
The full experience and recovery-floor checks in the main roadmap still gate
activation.
