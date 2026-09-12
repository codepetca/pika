# Pal / Pika lifecycle review

Historical recommendation: the user subsequently selected a complete Pal profile
per classroom membership. Use the [phased plan](classroom-pal-and-student-cleanup-plan.md)
for the current direction; the account-level proposal below was not selected.

2026-09-12. Recommendation only; no runtime changes or rollout authorization.
Reviewed Pika main `3d820f1a` and freshly fetched Pal main `69c3c91`.

## Recommendation

Keep Pal as an account-level achievement companion. Rework the lifecycle and
delivery boundary, not the game engine. Course removal and academic-data purge
must not require erasing a learner's cross-course achievements. Full Pal-profile
erasure is a distinct explicit operation with its own safe lifecycle.

This corrects the earlier assumption that course-scoped Pal erasure is inherently
required before any removed-student cleanup. Whether course-derived achievement
history must also be erased is a product/retention decision; it cannot be inferred
from the existence of a purge guard or from pseudonymous identifiers.

## Evidence

- Pika's integration guide explicitly says academic objects are not mirrored;
  previously true facts and earned achievements survive source deletion/archive.
- `pal-events.ts` uses one learner token across courses. Daily-log facts are
  unique by learner/date and intentionally have no course identity. Weekly
  opportunities union dates across active courses. Assignment facts carry opaque
  item tokens, not student writing, titles, or grades.
- `student_purge_conflict` blocks if either Pal table contains any row for the
  student, without course or delivery-status filtering. A delivered event from
  another course can therefore block this course's purge.
- Pika's outbox retains raw local student and source references. Weekly
  reconciliation reads completion dates and calendar metadata back out of that
  outbox. It currently mixes delivery storage with durable achievement evidence.
- Pal's schema separates pseudonymous learners, immutable events/facts, and
  derived rewards. Its docs advertise `/api/v1/learner/delete`, but current main
  has no corresponding route. `resetLearnerInDb` is explicitly a development
  sandbox helper, not a production erasure protocol.

## Proposed ownership policy

| Action | Pika academic state | Pal state |
|---|---|---|
| Remove from a course | Revoke membership immediately; retain data until cleanup | Preserve earned progress; reconcile future opportunities |
| Purge old course data | Erase scoped academic records, files, and local source links | Preserve expressly retained account-level achievements/history |
| Explicit full Pal erasure | Stop Pal emission/token issuance; clean associated local adapter state | Erase learner facts, rewards, pet/world and other learner-owned state |

Pal history remains pseudonymous learner-linked data, not anonymous data. Keeping
it must be stated explicitly in the product's retention semantics. Do not call
course cleanup "all student data erased" if Pal history is intentionally retained.
If the owner instead requires every course-derived Pal trace to disappear, V1's
global daily facts lack sufficient per-course provenance: that requires a new
versioned provenance/retraction design and an award-recomputation policy, not
simply adding a course-delete endpoint.

## Smallest sound implementation sequence

1. Confirm the ownership policy above. Keep all existing destructive guards until
   their replacements have tests and rollout evidence.
2. Separate durable, minimal account-level fact receipts/weekly configuration
   state from the transient delivery queue. Preserve semantic deduplication,
   original timestamps, configuration monotonicity and completion floors before
   pruning delivered payloads or raw source references. Define retention rather
   than guessing a number during this review.
3. Add a Pika-owned course-cleanup adapter that reliably resolves legacy source
   links, fences new course activity, and serializes with outbox claims. Preserve
   previously committed valid account-level facts under the accepted policy;
   remove/redact course-specific local provenance only after durable handoff or
   receipt capture. Treat ambiguous legacy attribution as a reported exception.
   Do not bulk-delete every Pal row for the student or fabricate withdrawal of
   cross-course facts. Remote Pal availability should not be a permanent
   prerequisite for academic cleanup once the durable boundary is established.
4. Replace the blanket Pal purge conflict with scoped checks for unsafe local
   adapter work. Prove course A cleanup preserves course B and global rewards;
   delayed delivery and retries cannot recreate academic data or double-award.
5. Independently implement a real Pal-profile erasure contract: authenticated
   integration/learner scope, durable operation identity, idempotent status and
   completion evidence, coordinated producer stop, rejection of old ingest/read
   tokens, and protection against queued events or read-token auto-provisioning
   recreating the erased profile. Explicit later opt-in needs a new generation.
   Do not expose the development reset helper as the production solution.

Keep the current widget, HMAC identity boundary, validated facts, transactional
outbox delivery, and pure reward engine. No new game service, mirrored academic
database, per-course pet, or migration into Pika is justified by this issue.

## Remaining independent work

This resolves the Pal-specific coupling, not every cleanup dependency. Single-
student Bara attendance erasure and whole-course archive/Gradex handling remain
separate blockers. A daily cron does not establish a universal two-day maximum.
Keep modal timing out until the complete cleanup path is operationally verified.

## Required tests

- Course A removal/purge with delivered and pending Pal facts, while course B
  remains active; preserved account-level rewards and weekly completion floors.
- Source-reference redaction with intact semantic deduplication and retries;
  identical-day activity across multiple courses; remove/re-add without farming
  the same historical award or restoring academic work.
- Worker/purge races, delayed responses, provider outage and lost acknowledgements.
- Full Pal erasure versus ingest, read-token provisioning, scheduler work, cached
  token reads and delayed delivery; no resurrection before explicit new opt-in.

No database migrations, provider writes, purge, schedule enablement, or product
UI changes were made as part of this review.
