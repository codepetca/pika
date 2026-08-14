# Managed deletion monitoring

This monitoring baseline is read-only. It observes the durable hot-Classroom,
cold-Classroom, and Course Blueprint purge protocols plus managed-storage ownership drift. It
does not enable a deletion scope, claim work, retry an operation, delete a
Storage object, change a rollout gate, or enable generic orphan cleanup.

Migration 121 defines the service-role-only
`get_managed_deletion_health_snapshot` RPC. The existing authenticated daily
`/api/cron/cleanup-history` route calls it after its normal cleanup and purge
safety-net work. This lightweight snapshot uses relational/indexable evidence;
it does not recursively parse unbounded JSON history. No additional schedule is
installed.

Migration 122 preserves the version-1 aggregate response and extends the
Classroom fence reconciliation so a valid cold fence satisfies its cold purge
operation while an orphan cold fence remains critical. Cold operations use the
same aggregate failure, stuck-operation, lease, partial-progress, and object-
reappearance findings. The migration does not change the schedule.

Migration 124 adds durable invocation evidence for the same existing
`/api/cron/cleanup-history` route. It installs no schedule. Authenticated runs
write one service-only ledger row at start and finalize it with the HTTP result
and allowlisted aggregate counters. The documented Vercel
`x-vercel-cron-schedule` header distinguishes a Vercel cron invocation from a
manual request, so a successful no-op run remains observable after short-lived
platform logs expire.

The same migration defines a separate service-role-only
`get_managed_deletion_deep_health_snapshot` diagnostic for recursive embedded
payload reconciliation. It is not called by the cron or any application route,
has no scheduler, and requires a separately authorized operator query.

## Privacy and response contract

The snapshot contains only a version, timestamp, threshold, health state, and
aggregate counts. It never returns user, teacher, Classroom, Blueprint,
operation, managed-object, bucket/path, title, email, or content identities.
The application validates the exact JSON shape and emits structured log fields
containing only health/count values or a bounded application error code.

The default stuck threshold is one hour. The RPC and server reader accept only
300 through 604,800 seconds. The threshold is diagnostic; it does not expire a
fence, authorize deletion, or change retry state.

The migration-124 ledger stores no user, teacher, Classroom, Blueprint,
operation, managed-object, bucket/path, title, email, or content identity. Its
database validator accepts only named nonnegative counters plus the
managed-health boolean. Direct writes are denied even to `service_role`;
security-definer begin/finish functions own the row lifecycle, and a separate
service-only health RPC omits run UUIDs and deployment identity.

The begin function serializes the daily job. A concurrent invocation is
recorded as `skipped_overlap` and does no cleanup work. A `running` row is
superseded only after two hours, well beyond the route's 60-second budget. The
finish function permits exactly one transition to `succeeded` or `failed`.
Before migration 124 exists, only the exact missing-RPC compatibility code lets
the route continue without a ledger; other ledger failures return a sanitized
failure.

Operators can read the latest durable evidence without scanning the table:

```sql
select public.get_cleanup_history_cron_health_snapshot(120);
```

Verify `latest_vercel_run.schedule = '0 7 * * *'`, a start time within Vercel's
daily execution window, `status = 'succeeded'`, `http_status = 200`, zero stale
runs, and expected aggregate counters. This proves scheduler invocation and job
outcome; the student-purge and managed-deletion snapshots remain authoritative
for current safety state.

The cron behavior is:

- Before migration 121 exists, the exact PostgREST missing-RPC code `PGRST202`
  is a code-first compatibility state. Cleanup returns normally and logs
  `schema unavailable` without provider details.
- Missing dependency functions/tables and relation-cache errors are probe
  failures, not rollout compatibility, and return the sanitized `503`.
- A healthy snapshot returns the existing successful cleanup response.
- Warning-only findings return success and remain visible in the aggregate log.
  They are expected to need trend/operational review, not an automatic mutation.
- Any critical finding returns a sanitized `503` with critical and warning
  totals after the normal cleanup work has run.
- Query or contract validation failure returns a sanitized `503`; raw provider
  errors are not returned or logged.

## Findings

Critical purge findings cover terminal non-retryable operations, operations or
partially completed object inventories that have not advanced within the stuck
threshold, expired object leases, missing/stale fences, and a provider object
reappearing after the exact purge ledger recorded it deleted. Due retryable
failed objects are warning counts until the enclosing operation becomes stale.

Critical managed-storage findings cover:

- Storage bytes in a managed bucket with no managed registry row;
- verified/ready registry rows whose provider object is missing;
- referenced objects that are not ready;
- relational raw references with no managed UUID or with mismatched path/owner
  evidence;
- registered embedded references whose owner/data-subject evidence differs
  from the host;
- managed Classroom objects with neither exactly one hot Classroom nor exactly
  one cold tombstone owner;
- objects left attached to a settled provisional owner; and
- expired generic-cleanup leases.

Warning managed-storage findings cover ready-but-unreferenced objects, expired
upload reservations, expired provisional owners, and cleanup-pending objects
older than the stuck threshold. These warnings are intentionally not deletion
authority. Counts may overlap when one corrupt entity violates more than one
contract, so totals represent findings rather than unique objects.

The separately invoked deep diagnostic detects embedded managed-bucket payloads
missing their relational registry, payload UUIDs that disagree with the
registered UUID for the same host/path, and payload digests that no longer match
the registry evidence, including when a payload's final managed reference was
removed while its registry row remained. These recursive findings are
intentionally excluded from the daily cron so growth in immutable assignment
history cannot consume the cleanup route's 60-second platform budget.

## Operator response

Treat a critical count or probe failure as an alert. First identify the finding
category from the structured snapshot in a separately authorized,
access-controlled diagnostic session. Do not add identifiers to the cron
response or application logs. Do not clear a fence, mark a ledger complete,
rewrite managed ownership, retry a purge, or remove a provider object merely to
make the count zero. Each repair requires its own evidence-backed plan and fresh
authorization naming the exact target and operation.

Warning-only counts should be trended. In particular, a stable
`ready_objects_unreferenced` or `stale_cleanup_pending` count is evidence for a
possible separately gated cleanup rollout, not permission to enable it. Generic
orphan cleanup remains disabled.

Run the deep diagnostic only in an access-controlled, separately authorized
session. Treat nonzero findings or query failure as evidence for investigation,
not permission to rewrite a payload, registry row, or Storage object. Record its
runtime and cancel/redesign the diagnostic if production-scale history cannot be
scanned safely within the operator session's explicit query budget.

## Staged rollout

Production migrations 121–123 are applied. Cold-Classroom deletion remains
disabled, individual-student purge is enabled, and generic cleanup remains off.
Migration 124 and its compatible application code require normal review and
rollout; applying migration 124 does not invoke the cron or change a deletion
rollout.

1. Run static/unit/route tests and repository checks without a database reset or
   migration application.
2. With fresh authorization naming the disposable/local target and migration
   121, replay the schema and validate SQL execution, query plans, empty/seeded
   counts, privacy shape, degraded fixtures, embedded UUID/digest drift, and
   lightweight snapshot runtime below the cron budget.
   After application, run `pnpm check:managed-deletion-health-db`; the harness
   refuses an unexpected Docker project, keeps all synthetic findings inside
   rollback-only transactions, removes its fixed Storage-owner test helper, and
   exercises eight concurrent readers.
3. Deploy the application code first. The missing-schema compatibility path
   keeps the existing cron successful while emitting a bounded warning. For
   migration 122, the cold safety net is a no-op until its table exists and the
   hot status/safety-net readers treat pre-122 rows as hot while rejecting
   cross-scope operations after the column exists.
4. With fresh authorization naming staging and migration 121, apply it and
   observe at least two daily runs. Investigate every nonzero critical count and
   establish a warning baseline before production.
5. With separate fresh authorization naming production and migration 121,
   apply the read-only RPC. Migration application is the production activation;
   the aggregate query has no safe per-object canary. Observe the first
   scheduled run and query/runtime telemetry before considering monitoring
   broadly established. A manual production cron invocation is a separate
   operation because it also advances existing cleanup/purge safety nets and
   therefore requires explicit authorization.

For migration 124, deploy compatible code first: the exact missing-RPC path
continues the existing job while emitting a bounded warning. Then apply
migration 124 only with fresh target-specific authorization and inspect the
first Vercel-scheduled ledger row through the health RPC. A manual route
invocation remains a separate cleanup/purge operation requiring explicit
authorization and is recorded as `manual`.

If the lightweight aggregate cannot reliably finish within the existing
60-second route budget, keep migration 121 unapplied (or remove the cron call in
a normal code rollback before application). Do not add the recursive diagnostic
to a cron, weaken the ownership contract, or replace exact-object purge
processing to make monitoring cheaper.

## Local validation evidence

The authorized migration preview contained only migration 121, and local
history records 001–121. The pre-review database harness proved read-only execution,
service-role-only access, bounded thresholds, privacy-safe aggregate output,
warning-only and critical classification, partial purge and expired lease
detection, provider-side object reappearance, exact rollback cleanup, and eight
concurrent readers. A 1,000-managed-object fixture completed in 9–34 ms during
repeated runs; its `EXPLAIN (ANALYZE, BUFFERS)` execution used 6,265 shared-buffer
hits and remained far below the five-second local guard and 60-second cron
budget. Review then separated recursive payload work into the unscheduled deep
diagnostic and tightened dependency failures; the one-time local application
permission was not reused. The final migration and deep UUID/digest regression
therefore require the PR's fresh ephemeral-database replay before merge.

Migration 124 adds `pnpm run check:cleanup-history-cron-db`. Its rollback-only
fixture proves service-only privileges, metric-key privacy enforcement,
single-run serialization, durable overlap evidence, one-way finalization,
stale-run supersession, scheduled-versus-manual attribution, bounded health
thresholds, and identity-free operator snapshots.
