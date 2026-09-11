# Coordinated student removal

Status: partial implementation; Pal erasure policy is unresolved. Do not enable
Pal-backed purge admission on the strength of this document.

## Intended outcome

One teacher confirmation starts a durable operation. The roster displays
“Removing student…” until erasure is verified. The teacher can close the dialog,
inspect saved progress later, and recover delayed operations. The student loses
access to the affected classroom; their account and other classrooms survive.

## Verified constraints

- Pika migration 123 rejects any student with Pal outbox or weekly-configuration
  records, even if those records originated outside the selected classroom.
- Pal's production API has event ingestion and learner reads, but no erasure
  endpoint in the inspected local checkout.
- Pal's learner identity is shared across Pika classrooms. Daily-log facts are
  unique per learner/day; weekly configurations aggregate classroom schedules.
  Neither payload retains the full contributing classroom provenance.
- Pal ingestion creates a missing learner. Deleting a learner alone does not
  prevent delayed deliveries from recreating it.
- Pal's engine is forward-only. Removing an event is not an inverse operation
  for XP, achievements, story plans, or rewards.
- Pika's current student fence protects writes, not a complete read-access
  boundary. Its Pal branch blocks the student's events across all classrooms.
- The existing cleanup-history recovery cron runs daily. Post-response work is
  bounded by the request's runtime limit, not an unlimited durable worker.

## Plan and implementation sequence

1. Give accepted operations a bounded server-side head start after the response.
   Reuse the existing database leases, finalizer, and cron recovery. Preserve
   admission safeguards. Implemented in student-purge-worker.ts and the start
   route, with worker and route tests. The browser still drives its existing
   progress loop; closing is not yet advertised as prompt independent completion.
2. Resolve historical Pal erasure semantics. Preferred scope preserves other
   classrooms. A deterministic rebuild must account for retained source facts,
   configuration history, reward provenance, and mutable learner choices. Missing
   evidence must block admission. An alternative whole-Pal reset requires an
   explicit product decision and teacher-facing disclosure; it is not implied by
   removing one classroom enrollment.
3. Implement Pal's authenticated erasure/reconciliation protocol. Bind each
   request and response to integration, opaque learner, operation, scope, and
   immutable manifest digest. Serialize with ingestion and scheduled rewards.
   Reject old deliveries after acknowledgement, including attempts with new
   transport keys. Define enrollment generations so a legitimate later rejoin
   cannot be confused with stale work. Retry returns the same receipt.
4. Extend Pika's durable operation with the external manifest, receipt, phase,
   lease, retry time, and error category. Stop or version affected outbound
   events before requesting erasure. Require the verified receipt before local
   finalization. Keep required identities until that finalization succeeds.
   Preserve unrelated-class writes and provider activity.
5. Add pending-removal access enforcement for legacy and contextual student
   reads, writes, joins, cached access, and relevant file URLs. Inventory existing
   signed URLs and their expiry before promising immediate file revocation.
   Expose pending operation status through teacher-authorized roster reads.
6. Extend the existing StudentPurgeDialog and roster status treatment. Keep one
   confirmation; show preparing/removing/finalizing in plain language. After
   admission use Close, not Cancel. Keep pending status discoverable after
   navigation. Distinguish automatic retry from permanent failure; never expose
   internal error codes. Only show completed after all required erasure receipts
   and database finalization are committed.
7. Validate against an isolated database and mocked provider, then the real
   provider contract. Publish draft PRs, obtain independent review, and complete
   the required checks before rollout. Migration application needs separate
   authorization naming the exact target and migration files.

## Execution choice

The implemented post-response worker attempts at most 25 steps and stops starting
new steps after 20 seconds. A slow in-flight call can still reach the hosting
timeout; durable leases and cron recovery remain necessary. This does not promise
completion in seconds for large inventories. A prompt guaranteed continuation
after every runtime expiration requires a durable trigger beyond the daily cron.
Do not present that guarantee in the UI until the trigger exists and is tested.

## Acceptance evidence required before enabling Pal removal

- Two classes contributing on one day: remove one, preserve the other's valid
  activity and recompute shared results according to the approved policy.
- Retained history is insufficient: admission fails before destructive work.
- An event arrives before, during, or after erasure, including a delayed lease
  and a new transport key: deleted activity cannot reappear.
- Lost provider acknowledgement, duplicate workers, server termination, browser
  closure, and stale leases: recovery uses the same operation and scope.
- Permanent provider rejection remains visible and never reports completion.
- Other classrooms, their roster access, and the Pika user remain intact.
- Rejoin cannot replay pre-removal events or unblock a pending removal.
- Direct student API calls fail appropriately while removal is pending.
- Desktop/mobile, light/dark teacher progress and recovery screenshots, plus
  student pending-access verification, pass the Pika visual workflow.

## Sources

- Pika: src/lib/server/student-purge.ts, StudentPurgeDialog.tsx, vercel.json,
  migrations 111 and 123, pal-events.ts, and pal-weekly-config.ts.
- Pal: packages/contract/src/v1/types.ts, packages/db/README.md,
  apps/web/src/lib/db-learner.ts, and apps/web/src/app/api/v1/.

Repository inspection establishes the code contract, not the deployed provider's
schema or operational capabilities. No live data was deleted or migrated.
