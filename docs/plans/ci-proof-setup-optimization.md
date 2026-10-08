# CI proof optimization execution plan

Coordinator: the existing architecture/development-workflow chat. User authorized
planning and orchestration on 2026-10-08. Worktree: `ci-proof-setup-optimization`;
branch: `codex/ci-proof-setup-optimization`; base: `d826a01a3`.
Risk: `runtime-platform`. No application, schema, rollout-setting or required-gate
change is planned. No dependency additions, hosted operations or monitor restart.

## Evidence and first decision

Full successful runs [37762412864](https://github.com/codepetca/pika/actions/runs/37762412864)
and [37749468329](https://github.com/codepetca/pika/actions/runs/37749468329)
took 69m02s and 67m26s. Database contracts were the critical path at 68m35s
and 66m59s. These establish an actionable bottleneck, not a long-term percentile.

The current disposable proof contract requires normal and both forced modes to
use fresh projects with complete reviewed migration replay. Sharing their database
would require a separately reviewed contract redesign. It is not the first patch.

The first patch removes discarded whole-table fingerprints from repeated
ephemeral safety checks in the older Test owner-detail/list proofs. The caller
currently consumes only cron evidence from these snapshots. Preserve the complete
metadata query and its assertions as well as cron evidence; opt in only these two
profiles. Default adapters, canonical before/after snapshots and restoration
snapshots keep their full scopes. This eliminates repeated scans, not migration
replays. Approximately 108 safety checks span the two profiles' six runs; verify
the actual counts in timing receipts rather than treating this estimate as a
measured result.

## Delivery sequence and exits

1. **Design and safety investigation:** source-verify the redundant read and
   retained invariants. Exit: concrete bounded interface and independent safety
   assessment. Delivered by two read-only Sol/high workers.
2. **Implement and measure together:** metadata-only safety-snapshot opt-in,
   sanitized private timing receipts, workflow collection, and an extension of
   the existing `measure:ci` tool to report jobs/steps, reviewed SHA, failure
   locations and cancelled runner consumption. Keep startup/replay reported as
   one stage until separately observable. Exit: meaningful offline regressions,
   typecheck/focused checks, unchanged exact failure receipts and no weaker gate.
3. **Publish and review:** draft PR, independent correctness/privacy and
   compatibility/workflow reviews on a fixed SHA, batch any remediation, and
   record the stable reviewed SHA before ready-for-CI. Exit: no unresolved
   blocker and required CI on that SHA, including native normal/after-fixture/
   before-capture runs for both profiles. No local disposable DB replay while the
   learner/reorder task owns the shared host resources.
4. **Evaluate the pilot:** compare the two proof step durations against the two
   baseline runs on the same runner class and migration checkpoint where possible.
   Report runner differences, sample size and exact migration/revision differences.
   Use per-operation counts/timing to explain results. A single run can validate
   safety and provide an initial result; it cannot establish p95 or causality.
   Exit: useful measured saving with equivalent proof coverage, or explicitly
   reject the speed claim and retain/revert based on evidence. Do not promise a
   numerical speedup before measurement.
5. **Next bounded setup change:** if the pilot succeeds, consider expanding the
   opt-in to compatible proofs after the active harness changes land. Separately
   design balanced proof jobs on independent Docker daemons/runners, preserving
   every command and aggregate-gate dependency. One shared self-hosted VM remains
   serial; splitting jobs alone does not create capacity. Do not introduce shared
   resets/reseeds as a shortcut. This phase requires a new concrete design and
   acceptance decision, not another metrics waiting period.

## Safety acceptance and rollback

- All six fresh-project starts, full migration-chain validation, SDK authorization
  and storage checks, revocations and forced failures remain.
- Complete live inventories, exact resource identity/closure, guard/settings/
  grading/Vault/cron checks, restoration checks, canonical equality and cleanup
  remain; no lifecycle, deadline or cleanup ownership change.
- Offline tests prove the metadata scope omits table fingerprints while retaining
  metadata/cron SQL and that full snapshot paths stay complete.
- Timing files contain only fixed operation names, counts, monotonic durations,
  closed outcomes, profile/mode and SHA. No SQL, arguments, rows, credentials,
  resource IDs or error text. Timing never changes the two-line failure output.
- Native CI must pass both profiles and all existing selected lanes. Rollback is
  removing the two opt-ins; the default adapter stays available throughout.
- Merge and deployment retain the normal authority gates. No production
  migration or rollout action is part of this work.

## Ownership and effort record

Implementation worker: requested GPT-6.1-Sol/high for the bounded adapter/profile
change and private timing helper. Coordinator owns workflow, measurement tool,
plan, integration, PR lifecycle and acceptance. Active learner/reorder work is
not taken over; no shared lifecycle edits. Independent reviewers will receive
fresh briefs and a fixed revision. Effective model configuration is unavailable.

Weekly usage at phase start: 31% used, 69% remaining. DeepSeek is paused, so native
workers were used. Design workers made no edits or DB calls. Startup initially
failed for missing dependencies; frozen-lockfile install resolved it and startup
passed. Worker tokens and active time are unavailable; do not substitute wall
time for active time. Record delivery/rework and CI evidence below as it arrives.

Status: implementation delivered; offline validation passed; preparing fixed-SHA
independent review. Full focused checks passed 1,007 tests plus architecture,
UI/design policy, TypeScript and lint; the final clean-source check is running.
Targeted pilot tests passed 124/124 and metrics/workflow/local-CI tests 52/52.

Initial baseline from the refreshed 20-run sample: 18 completed, one successful
full run, 14 skipped and three cancelled. On that successful hosted run, detail
was 239 seconds and list 234 seconds. The small sample and native timestamps are
explicitly preserved; no post-change saving is claimed.

Review ledger: runtime-platform safety evidence is consequential, so use two
fresh Sol/high reviewers: correctness/privacy and architecture/compatibility.
Budget: at most seven launches, one full-diff wave, four targeted remediation
waves, one final integration wave, four fix batches, 60 minutes total and
30 minutes per reviewer. Initial wave not yet launched; zero remediation batches.
Review receipts will bind base/head in the PR and local lifecycle record.
