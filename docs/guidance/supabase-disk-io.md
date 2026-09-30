# Supabase disk I/O incidents

Stored database bytes, file storage, and disk I/O are separate limits. Diagnose the
live workload before deleting data or upgrading compute.

## Grading conflict retry storm

On PostgREST 14, a custom SQLSTATE `40001` can cause an unbounded internal
transaction retry. A stale expected document revision cannot become current by
retrying the same RPC arguments. This produces database errors, rollbacks, and
log writes even after the originating HTTP request has gone away.

See [Supabase's documented failure and recovery procedure](https://supabase.com/docs/guides/troubleshooting/high-cpu-and-infinite-transaction-retries-when-using-custom-error-codes-in-rpc-functions-77326b).

Migration 223 changes only the stale-revision error in
`save_assignment_grades_atomic` to `PT409`. PostgREST returns HTTP 409 without
retrying. Both legacy and contextual manual-grading adapters accept `PT409` and
the previous `40001`, preserving compatibility before migration application.
Function arguments, grants, authorization, locks, and atomic writes are unchanged.

Deploy the adapter compatibility change before applying migration 223. Follow
the repository's exact-target migration authorization and preflight procedure.
Do not apply unrelated pending migrations as part of this incident.

## Containment and verification

1. Match the repeated error's process ID to `pg_stat_activity`, including role,
   application, backend start, and function name. Terminate only that confirmed
   runaway backend. Existing loops may require this even after a function fix.
2. Compare `pg_stat_database.xact_rollback` in two short samples and verify the
   identified process is gone. Database metrics and I/O credits can lag recovery.
3. After rollout, verify a fresh grade saves and a stale grade returns 409 once,
   with no document or batch changes. Check that the repeated log stream has ended.

Use catalog statistics for table sizes and query statistics for temporary spills;
avoid scanning document content during incident diagnosis. Query statistics are
cumulative and may reset or evict entries, so compare deltas before attributing
historical temporary-file bytes to a current query.

Other historical migrations also raise custom `40001` codes. Migration 223 is
limited to the confirmed manual-grading incident. Audit other current RPC
definitions and their server adapters in separate bounded changes; do not blindly
replace genuine database serialization failures or existing exception handlers.
