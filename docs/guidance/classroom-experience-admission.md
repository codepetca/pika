# Classroom experience admission

## Current implementation and activation hold

This is a dormant first slice of batch 1 in the
[classroom-access roadmap](classroom-access-and-entitlements-roadmap.md).
Current receipt: learner reads PR #1418 is merged in main; Daily saves PR #1380
is merged and production migrations 224–225 are installed and verified via
GitHub run `36869449834`. The pending migration statements below describe their
earlier review history, not current application state. Shared admission remains
off. The [teacher entry/history read slice](contextual-teacher-daily-log-read.md)
is merged in PR #1420. The [roster-wide logs/preview slice](contextual-teacher-daily-logs.md)
is in development; cached summaries remain subsequent work.

The existing owner/member material-list GET routes consume this policy. The
[Daily Log save slice](contextual-daily-log-save.md) adds dormant POST/PATCH
integration, with canonical migration 224 pending production. Its identical SQL
was applied under the old 223 on 2026-09-30; an exact owner-approved local history
repair now records it as 224 and main's real 223 was applied once. Local history,
types and Daily contracts pass. Additive migration225 corrects the reviewed
custom-40001 retry risk; the adapter accepts PT409 and the former code. Its exact
local application and one targeted review are owner-approved, not permission for
production or admission activation. PR1380 carries the latest verification receipt.
The unchanged transaction
passed local verification under its original number 218 on 2026-09-27; that
function was absent before the owner-approved local 221–223 application.
The [learner Daily Log read slice](contextual-daily-log-read.md) adds dormant GET
integration for own classroom history and the broad active-membership feed.
The teacher entry/history GETs also use shared admission, with current-owner
evidence bound to their data reads. Roster-wide logs/previews are being integrated
with current-owner and enrollment evidence in each data page. Cached summary reads,
material writes, other domains, home/page routing and enrollment retain their
existing authorization. No environment is configured by this change.

Do **not** configure a live cohort until the roadmap's full integrated release
checks establish the complete reachable classroom experience. This is not an
Assignment-only or materials-only product rollout. Adding this contract to a
release does not prove the other domains are compatible.

## Configuration and authorization

`PIKA_CLASSROOM_EXPERIENCE_ADMISSION` is the one server-side, optional cohort
configuration for compatible classroom-experience slices. Its absence preserves
the legacy installation. A present value is strict JSON:

```json
{ "version": 1, "admittedUserIds": ["canonical-user-uuid"] }
```

The object has no additional keys. User IDs are UUIDs, canonicalized to lowercase,
must be unique, and are capped at 100; the raw variable is capped at 20,000
characters. A present empty list admits nobody. Any present malformed, unsupported,
oversized, duplicate, or invalid configuration returns 503 after authentication;
it never falls back to legacy authorization.

Admission only identifies an actor cohort. It grants no role, classroom ownership,
enrollment, plan, relationship, or resource permission. Each migrated route must
still authenticate first and enforce its current relationship, archive, resource
binding, and response-projection rules. Non-admitted actors retain that route's
existing pilot or legacy behavior.

## Retained admission and recovery

Inclusion in the list is an explicit operator admission decision. There is no
automatic admission on the first request, subscription change, creation or join.
To stop new admission, stop adding user IDs while retaining all previously
admitted IDs. This leaves existing accounts on the compatible access path.

Before activation, record the exact reviewed and fully rehearsed release that is
the minimum compatible recovery build. A recovery deployment must retain that
build's complete classroom behavior and the admitted cohort; merely recognizing
configuration version 1 is insufficient. Do not delete the variable or move
admitted accounts back to global-role routing as a stop-new-admission procedure.

This stateless environment reader cannot detect a deleted value or an older
deployment. Retention and the compatible deployment floor are operational
requirements, not durable guarantees. Automatic admission or independent,
concurrent admission administration would require a separately designed durable
admission store. No such store or workflow is introduced here.
