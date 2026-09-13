# Classroom-specific Pal and automatic student cleanup

Date: 2026-09-12
Status: Phase 1 delivered; Phase 2 dispatched. Live rollout remains disabled.
Scope: Pika, Pal, and the required Bara attendance integration.
Risk profile for implementation: runtime-platform; identity, authorization and
irreversible data deletion.

## Outcome

One teacher action removes a student from a classroom immediately. The system
then safely deletes that membership's academic data and entire Pal profile in
the background. Other classrooms, classmates and the student's account remain
unaffected. Re-addition is allowed only after verified cleanup and creates a
fresh membership and fresh Pal.

Every Pal feature is classroom-specific: pet, world, XP, achievements, rewards,
story progression and weekly opportunities. No shared Pika-wide progression.
Keep Pal as a separate service and reuse its existing engine and widget wherever
the scoped-profile model already fits. Do not change unrelated Pal integrations.

## Decisions carried forward

- Use one opaque Pal identity per **classroom membership generation**, not one
  per account or a permanently reused student/classroom pair.
- Existing students start fresh classroom Pals at a clearly announced cutover.
  Do not split, copy or backfill old site-wide rewards.
- Stop using old Pika site-wide profiles at cutover, but retain them temporarily.
  No second legacy-Pal interface. Their eventual deletion requires separate
  approval of exact scope and retention timing.
- Existing removals were not consent to a newly introduced automatic erasure
  policy. Historical removed students require separate backfill approval.
- Keep current production behavior until the appropriate rollout gates pass.
  Build the new behavior behind disabled server-side rollout controls.
- A two-day cleanup time is an operational target to validate, not an established
  guarantee. Do not add that promise to the modal now.

## Starting point and gaps

The prior final-removal release already revokes class access and blocks re-add
while old class data remains. Migration 165 and production PR #1251 were verified
in this task; the committed startup summary predates that rollout.

Current Pal integration uses an account-level learner token, cross-course daily
facts/weekly opportunities and a shared widget provider. Pika blocks purge on
any Pal row for that student. Pal documents a learner-delete API, but the reviewed
main has no production route for it; a dev reset helper is not a substitute.
Single-student Bara erasure and safe treatment of whole-classroom archive/Gradex
copies are also missing. Merely scheduling the current purger is insufficient.

The investigation used Pika `3d820f1a` and Pal `69c3c91`. Refresh repository heads,
guidance, migration numbering and existing owners before each implementation
slice; origin/main has advanced since that investigation.

## Phases at a glance

| Phase | Deliverable | Completion gate |
|---|---|---|
| 1 | Membership-scoped identity foundation | Two memberships cannot share a Pal identity; removed generations cannot reopen |
| 2 | Classroom-only signals and widget | All Pal features stay isolated across classroom switches |
| 3 | Verified deletion across services and copies | One membership can be erased without collateral classroom/account loss |
| 4 | Durable automatic cleanup | Removal queues once, failures retry safely, completion releases re-add |
| 5 | Limited fresh-start cutover and pilot | Isolation, deletion and recovery pass in the approved cohort |
| 6 | Broad rollout and concise UX | Observed capacity/health supports the stated expectations |

Phases 1–4 are built without changing ordinary users' experience. Phase 3's
provider work can be developed after the Phase 1 identity contract is fixed,
while Phase 2 proceeds. Phase 5 needs all four implementation phases complete.

## Phase 1 — Membership-scoped identity foundation

Primary owner: Pika. Pal contract compatibility is checked, not assumed.

- Define and persist an immutable generation for one classroom membership.
  Reuse a suitable existing identifier only if it survives the required lifecycle.
  Removal must retain the mapping needed for cleanup after enrollment deletion.
- Derive a versioned opaque Pal reference from that generation. Keep raw Pika
  student/classroom identifiers and mapping secrets out of Pal and the browser.
- Require authenticated, active membership for profile resolution and read-token
  minting. A removed membership never falls back to the account-level profile.
- Preserve lifecycle identity during legitimate classroom archive/restore, while
  ensuring restore cannot revive a purged generation. Preserve references through
  secret rotation and deploy retries.
- Keep the foundation disabled until its schema and compatibility are verified.

**Exit evidence:** same student in two courses has distinct references; retries
retain one reference; cross-student and cross-course requests fail; removed
membership cannot mint access; re-add after cleanup receives a new generation;
archive/restore does not reopen a purged identity.

## Phase 2 — Classroom-specific signals and presentation

Primary owner: Pika. Change Pal's versioned contract only where testing proves a
change is necessary; deploy provider support before emitting a new contract.

- Route joins, daily logs, assignment views/completions and weekly configuration
  through the resolved membership profile. Daily deduplication and weekly
  opportunities operate within that classroom, using America/Toronto time.
- Do not broadcast a site login to every classroom. Map the existing session
  achievement, if retained, to a genuine authenticated classroom visit and keep
  its deduplication explicit.
- Scope local outbox identities, configuration versions, completion evidence and
  worker reads to the membership. Preserve atomic source writes, bounded delivery
  and retries; provider outages must not undo committed academic actions.
- Update read-token caches, provider scope keys, background refreshes and pending
  celebrations so switching classes never shows another class's pet or rewards.
  Ignore stale in-flight responses from the prior classroom.
- No old events or pre-cutover academic history are relabeled as fresh-profile
  activity. Keep new and legacy delivery namespaces distinguishable.
- Reuse current UI owners and Pal widget surfaces; create no migration dashboard
  or legacy-profile screen. Use Pika's UI-change and visual-verification workflow.

**Exit evidence:** all six existing event families are accounted for; one daily log
in each of two courses advances only its own profile; switching/reloading/logout
cannot leak caches or celebrations; teacher/student desktop/mobile light/dark
verification passes. Other Pal integrations retain their existing behavior.

## Phase 3 — Safe membership deletion across systems

Owners: Pika coordinates; Pal and Bara own their respective erasure contracts.
This phase is not complete when only the Pal problem is solved.

### Pal profile deletion

- Add an authenticated, integration-scoped production deletion operation for one
  opaque profile, with stable operation identity, idempotent retries and verified
  completion status. Do not expose the development reset helper.
- Stop profile token issuance and signal production; serialize with in-flight
  delivery and provider ingest. Invalidate prior access and reject old-profile
  events, read-token provisioning and scheduler work after deletion begins.
- Delete all profile-owned facts, schedules, pet/world state, achievements,
  rewards and caches. Retain only the minimal approved deletion evidence needed
  to reject resurrection; a timeout or generic 404 is not proof of completion.
- Rejoining uses a new generation, never removal of the old generation's guard.

### Attendance, Pika records and historical copies

- Implement Bara deletion for exactly one student/classroom scope with a durable
  receipt. Do not call the whole-classroom decommission endpoint.
- Extend academic/file cleanup to retained removed identities without temporary
  reenrollment. Inventory exact resources and managed objects, preserve ownership
  fences, and verify final absence before deleting the re-add restriction.
- Resolve archives, Gradex extracts and remote grading data explicitly. Existing
  student purge can delete whole-classroom backup copies; automatic removal must
  not silently inherit that behavior. Start with no-copy cases. Before covering
  affected copies, obtain an approved retention/expiry, exclusion-on-restore, or
  safe replacement strategy and prove it cannot restore erased student data.
  Retained copies must be disclosed rather than described as physically erased.
- If a copy or provider cannot yet be safely handled, keep that membership pending
  and alert an operator. Never report complete cleanup or release re-add early.

**Exit evidence:** exact-scope provider receipts, verified object absence, complete
resource inventory and post-delete checks; concurrent ingest/restore/write and
lost-response tests; classmates, other courses and accounts unchanged. Unresolved
backup/provider classes remain an explicit rollout blocker for those cases.

## Phase 4 — Automatic cleanup orchestration

Primary owner: Pika. Reuse current durable purge mechanisms where their authority
and scope fit; do not build a second competing deletion engine.

- Under the new removal policy, commit access revocation, retained target identity
  and one cleanup request atomically. A failed queue write must not silently
  return successful scheduled removal.
- Persist the minimum state needed to distinguish pending, working, retryable
  failure, blocked and completed work, including completed provider stages.
- Use an independently gated, authenticated daily worker with bounded batches,
  leases, time budgets, backoff and fair progress. Resume approved existing work
  without starting unrelated destructive operations. Follow the host's daily
  scheduling constraint; reassess execution capacity if daily work is insufficient.
- Replace blanket Pal conflicts only after scoped lifecycle guards pass review.
  Keep all remaining provider, ownership and active-operation safeguards.
- Clear the re-add restriction only after all required stages are verified. An
  operator cannot resolve a stuck job by simply clearing its safety fence.
- Monitor oldest pending age, blocked/failed counts, queue depth and throughput.
  Alert at 48 hours with privacy-safe logs and an exact-operation runbook.

**Exit evidence:** duplicate removal requests queue one job; overlapping workers
cannot double-delete; interruptions resume committed stages; one blocked job does
not starve others; no false completion; re-add creates clean academic/Pal state.
Load tests establish supported cohort/file/backlog bounds, not just a happy-path
single-student demonstration.

## Phase 5 — Fresh-start transition and limited pilot

- Announce that classroom Pals begin fresh and old achievements are not copied.
  Select a named cohort and cutover boundary with explicit owner approval.
- Switch profile reads and event routing consistently. Quiesce legacy producers,
  read-token minting and delivery workers; account for in-flight requests. Old
  queued events remain in the legacy namespace and are not replayed into new Pals.
- Retain old site-wide profiles and necessary legacy ledgers temporarily. Set an
  owner-approved retention deadline and treatment of existing queued work;
  preservation is not approval for indefinite storage or immediate deletion.
- First test with synthetic identities. Any live removal/purge canary requires
  separate authorization naming the targets and irreversible consequences.
- Prove one student's two classroom Pals evolve independently, one membership is
  removed and cleaned, and re-add starts fresh without changing the other course.
- Rollback means stop rollout/worker activity safely while retaining identities,
  queues and fences. Do not merge progress into old profiles or imply deleted data
  can be restored. Preserve durable cleanup requests for controlled resumption.

**Exit evidence:** two-course isolation, visual matrix, provider outage/recovery,
delayed-event rejection, cleanup/re-add, scheduled-run health and measured latency
all pass. No real student loses legacy data during the initial cutover.

## Phase 6 — Broad rollout, concise modal and legacy retirement

- Enable the verified path for the approved population; monitor capacity and
  failures before expanding further. Clearly exclude unsupported backup/provider
  cases rather than claiming universal completion.
- Keep one teacher action and one confirmation: immediate access loss, no undo,
  and inability to re-add until old course-data cleanup finishes. Keep operational
  details out of the modal; surface failures through the appropriate support flow.
- Use no two-day promise until end-to-end evidence supports it for the enabled
  population. Prefer an honest normal-time estimate with an exception path over
  a hard maximum that outages or backlog can violate.
- Retire old site-wide Pal profiles only in a separate, authorized cleanup of
  exact Pika integration identities after the agreed retention period. Do not
  touch other Pal integrations. Treat historical removed-student backfill as a
  separately approved operation, not an automatic side effect of enabling cron.

**Exit evidence:** broad scheduled health, isolation and deletion verification,
accurate UX, tested operator recovery, and recorded retention/deletion decisions.
Legacy-profile retirement may follow later; until then, report it as retained,
not erased.

## Delivery and approval rules

- This document creates a plan only. It does not enable a flag, create an external
  automation, apply a migration, publish a PR or authorize real-data deletion.
- Use one focused feature worktree/PR per independently verifiable slice in each
  repository. Refresh main and reserve collision-free migration numbers when
  implementing, not in advance in this plan. No new dependencies without approval.
- Use source tests and database-backed contracts for identity/destructive work;
  generated public types must come from the verified schema. Follow draft-first,
  stable-SHA CI and risk-matched independent review before merge.
- Migration application requires fresh one-time permission naming the exact file
  and environment. Deployments, live cutover, destructive canaries, broad worker
  enablement and legacy-data cleanup have distinct approval gates.
- Review recommendation: Sol/high for identity/security/concurrency/deletion and
  Terra/high for compatibility/architecture in high-risk slices. Follow the
  bounded review budget; do not launch reviewers merely to approve this plan.

## Immediate next step

Deliver Phase 2's disabled classroom-scoped signals and widget implementation,
tracking provider compatibility and full-phase exit evidence separately from
the implementation PR. No student-facing cutover, achievement reset or
production deletion in this step.

## Coordination handoff — 2026-09-12

- Coordinator: `01a09083-d907-7532-ae50-9b46d292bdb6`; tool-backed overall goal
  active. One implementation owner at a time; use the dispatch/orchestrate skills.
- Phase 1 owner: `01a095fb-07ff-73b3-90df-5bb6d69d5330`,
  “Build classroom-specific Pal identity…”. Goal complete; not archived.
  PR #1253 merge verified from GitHub, main
  `3a225b0f51dbf791bf0c7ee02d7760368b0823e5`; reviewed head
  `941ca944a9a5017675bb66396b93f0ff5ea55419`, all five CI checks including
  PR Gate passed. Canonical main was synchronized and feature checkout cleaned.
- Local and production migration ledgers are verified through 168. Production
  166–168 applied once with explicit exact-set approval; 13 function comparisons
  and 14 read-only postflight checks passed. Sanitized receipt:
  `/Users/stew/.codex/metrics/pika-production-migrations.jsonl`.
  Both Pal gates remain disabled; no deployment or existing-achievement changes.
- Phase 2 owner: `01a0978b-297c-70c1-9199-76a9f104cac0`,
  “Phase 2 classroom-specific Pal implementation”, in
  `/Users/stew/.codex/worktrees/d432/pika`. Tool-backed goal confirmed active;
  branch `codex/pal-classroom-signals`. Disabled source implementation and all
  six event-family paths authored; 14 browser checks passed across both roles,
  viewports and themes. Exact local169 approval consumed by one successful
  application; rollback-only contracts and canonical generated types pass. Draft
  PR#1256 completed initial Sol/Terra review; one correction batch addresses
  contextual joins and residual legacy producers. Forward170 approval and
  targeted/final review/CI remain. Applied169 is immutable.
  See [implementation evidence](pal-classroom-signals.md). The owner will publish
  this existing roadmap through the normal reviewed PR workflow.
- Coordinator heartbeat: `advance-classroom-pal-and-cleanup-phases`, active
  every 15 minutes; report meaningful transitions only and update the tracked
  owner after each verified delivery. This is not a product cleanup cron.
- Current authorization: bounded implementation, dispatch, normal PR/review/CI
  workflow and coordinator monitoring. Prior exact PR merge and migration
  approvals are consumed; future merges, migrations, deployments, live rollout,
  real-data erasure and archival require their applicable explicit authority.
  Do not infer historical-removal backfill or legacy-profile deletion approval.
- Phases 3–6 remain pending their exit evidence and approval gates. A ready PR
  is not a merge, and a merged component is not proof of a complete phase.

This plan supersedes the earlier account-level recommendation in
[Pal lifecycle review](pal-lifecycle-review.md) and the narrower proposal in
[removed-student cleanup](removed-student-cleanup-plan.md). Their investigation
findings remain useful; their proposed product policies are not the selected path.
