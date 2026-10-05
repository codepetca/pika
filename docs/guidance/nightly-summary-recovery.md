# Nightly summary recovery

The daily schedule is unchanged. Provider calls are bounded to20seconds for required summaries and5seconds for optional developer feedback; each invocation has a50second application budget inside the declared60second route duration. Optional feedback is best effort and runs after required summaries.

A complete invocation returns `{status:'ok', generated, skipped}`. Incomplete required work returns HTTP503 with `status:'partial'`, its Toronto calendar `date`, counts and `pendingClassroomIds`, plus Retry-After5seconds. This does not schedule an automatic retry. Retain unresolved dates and IDs until recovery succeeds; tomorrow's default date does not recover yesterday's pending work.

Retry the same date through the existing bearer-authenticated endpoint. Matching persisted input digests preserve completed summaries. If persistent early failures consume each whole-date retry, retry each pending classroom independently; a targeted200 resolves only that classroom. Unknown discovery progress reports null pending IDs: retry discovery for the same date rather than treating it as complete. Continued discovery exhaustion requires investigation.

For an operator whose origin and secret are already securely loaded:

```sh
curl --fail-with-body --silent --show-error --get \
  "$PIKA_BASE_URL/api/cron/nightly-log-summaries" \
  -H "Authorization: Bearer $CRON_SECRET" \
  --data-urlencode "date=$SUMMARY_DATE" \
  --data-urlencode "classroomId=$SUMMARY_CLASSROOM_ID"
```

Omit the classroom argument for a whole-date retry. Dates must be real calendar dates no later than yesterday in America/Toronto; the optional classroom selector must be a UUID. Authentication precedes parsing and discovery. Do not log secrets or private summary bodies. These command templates were not executed during remediation.

Concurrent authorized invocations can repeat provider work; the existing classroom/date upsert preserves one result row. This is not an exactly-once lease. A server write accepted just before cancellation can complete; recovery reads its checkpoint. Optional feedback is not durably queued and reused summaries do not regenerate skipped feedback.

Verification is source and mocked transport evidence: required-provider stalls, response-body stalls, cancellation,50second budget, partial-write recovery, targeted retries after permanent early failures, preserved checkpoints and changed-input regeneration. Hosted latency, limits and scheduling behavior remain unverified.
