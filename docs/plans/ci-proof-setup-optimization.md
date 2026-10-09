# CI proof optimization execution plan

## Current phase: browser critical-path investigation

User authorized the proposed browser investigation and bounded implementation on
2026-10-09. Coordinator remains the existing architecture/development-workflow
chat; branch `codex/ci-browser-optimization`, base `48f27a9870c7705187f0fd5708bec7ff5e89ed3e`.
Risk: `runtime-platform`. One GPT-6.1 Sol/high read-only worker is auditing
project partitioning and mutation isolation before implementation. No project,
spec, role, retry or snapshot coverage may be removed; no new dependencies or
application/schema changes. Local canonical database mutation, self-hosted
activation/purchases, production and Clarity collection remain outside this phase.

The existing hosted SDK slice was delivered unchanged through combined
[PR 1550](https://github.com/codepetca/pika/pull/1550), main
`763edbb180f32a32c0584add894d79415bbb9945`, reviewed merge tree
`29c3a84404d8584be2ea81dc461907ce177bbac0`. All six jobs in
[37913960793](https://github.com/codepetca/pika/actions/runs/37913960793) passed.
Original PR 1546 was closed as delivered; its ready/merge instructions below are
historical and retired. Earlier budgets, failed attempts and receipts remain.

Browser native duration was 48m01s (test step 44m06s) in run 37913960793, versus
58m36s in run 37879210697. Four serial experience-matrix project/file groups
dominate the execution. The current canonical inventory is 573 test/project
cases including two setup cases. Two independently isolated partitions were selected; retain serial file behavior
and two workers per runner. The
database lane ran 44m59s in the latest run, limiting whole-CI improvement there
to roughly three minutes even if browser execution falls much further. The prior
run permits roughly fourteen minutes. Neither projection is a measured saving.

Acceptance: conserve the complete canonical inventory; independently seeded and
cleaned ephemeral databases; fail-closed PR Gate and complete historical local-CI
plans; focused/static contracts; fixed-SHA independent review; one eligible native
CI run with every selected lane passing. Compare elapsed gate time and summed
job consumption including failed attempts. No speed claim before native evidence.
Weekly allowance at phase start: 39% remaining, account-wide; effective worker
configuration, tokens and active time unknown. DeepSeek paused. Review counters
for this new candidate start at zero; prior candidates remain unchanged.

Design accepted: partition by theme. Light selects `chromium-desktop`,
`chromium-mobile-light`, `pattern-lab-desktop-light` and
`pattern-lab-mobile-light`; dark selects `chromium-desktop-dark`,
`chromium-mobile-dark`, `pattern-lab-desktop-dark` and
`pattern-lab-mobile-dark`. List-only collection gives 301 light and 274 dark
cases: union 573, with only the two auth setup cases duplicated deliberately
for independent databases. All eight spec filters and the Playwright config
remain unchanged. Real database writes remain on their original desktop-light
project; controlled/read cases can run dark only against its separate seeded
stack. Independent timing analysis projects roughly 28–32 minute light and
23–27 minute dark jobs, with extra startup/auth and runner consumption to be
measured. These are projections, not acceptance evidence.

Implementation owner: the same GPT-6.1 Sol/high worker, limited to workflow,
local driver/preflight and offline regressions. Coordinator owns documentation,
publication, independent review and native acceptance. The new hosted dark job
must be a required browser dependency of PR Gate. Local `--lane browser` retains
both partitions serially with separate receipts and diagnostics; historical
combined lanes remain executable. No local database rehearsal is authorized.

## Historical hosted owner SDK shard

The first pilot below was delivered through [PR 1541](https://github.com/codepetca/pika/pull/1541);
original [PR 1538](https://github.com/codepetca/pika/pull/1538) was closed as delivered.
The local-CI policy from [PR 1537](https://github.com/codepetca/pika/pull/1537) is also merged.
Historical review receipts and counters below remain historical; this phase does
not restart their budgets or claim that the pilot caused a measured speedup.

Current branch: `codex/ci-sdk-proof-shard`, managed worktree `ci-sdk-proof-shard`,
base `e24d591abb53713e01d75a5c95fc418cf57592eb`. Risk: `runtime-platform` because
the required gate gains a job dependency. The integration coordinator has allocated
the first exclusive remote CI slot: after focused checks and fixed-SHA independent
review pass, mark ready for one fresh eligible hosted execution. Main merge stays
pending the coordinator's integration order. Local canonical database mutation and
local-runner
activation remains held; this change requires no registration or new dependency.

Move the seven established Test owner detail/list/draft-get/draft-save/create/
pristine-discard/publication step blocks unchanged into `contextual-test-owner-sdk`.
Keep member-list and reorder in the original database job. The new job uses the
existing database selector and a fixed `ubuntu-latest` runner. Each hosted job
has an independent VM and Docker daemon. The shard starts its own canonical
stack; all 21 fresh disposable proof replays, forced modes, exact failure output,
restoration, canonical comparisons and cleanup remain. No database state is shared
or cached. PR Gate must require both database jobs whenever database coverage is
selected. Manual self-hosted dispatch therefore becomes mixed compute; the shard
stays hosted.

Local `--lane database` retains complete coverage by executing original database
then SDK jobs sequentially; `--lane all` executes each once. Explicit
`--lane test-owner-sdk` uses the same full isolation preflight. Local rehearsal is
not parallelism and does not replace reviewed-head PR CI.

Observed successful hosted runs (seconds from actual job/step timestamps):

| Run | Head | Database | Seven proofs | Browser |
| --- | --- | ---: | ---: | ---: |
| [37810321964](https://github.com/codepetca/pika/actions/runs/37810321964) | `ad19bee721` | 3849 | 1941 | 3579 |
| [37831362311](https://github.com/codepetca/pika/actions/runs/37831362311) | `d9b22680a0` | 4338 | 2223 | 3911 |
| [37865407019](https://github.com/codepetca/pika/actions/runs/37865407019) | `e68198ede7` | 4930 | 2244 | 3598 |

Different heads include different proof/migration checkpoints. These are three
observations, not p95 estimates or causal comparisons. Seven proofs account for
32m21s–37m24s of the database job. If hosted capacity and runtimes remain similar,
the browser job becomes the expected critical path: projected end-to-end saving
is approximately 4m30s, 7m07s and 22m12s respectively. The additional canonical
startup measured 82–92 seconds in these runs; setup/install overhead and queueing
must also be included in the first shard result. No saving is accepted yet.
Six sanitized pilot timing receipts per run confirm normal modes pass and forced
modes fail, with 52 ephemeral checks per normal profile and one per forced mode.

Acceptance before ready: source comparison shows every moved command block
unchanged and present exactly once; offline tests execute the actual gate for
failed/cancelled/skipped shard results and verify CLI expansion, full preflight
and cleanup. Complete focused/static checks and fixed-SHA independent review.
Acceptance after slot release: eligible final-head CI passes both database jobs,
browser, test/build and PR Gate; runner telemetry confirms hosted separation and
all moved modes execute. Compare queue, job, setup, seven-proof and whole-run
durations against the observations above, including added runner consumption.
Rollback restores the original job placement and gate dependency together.

Delegation: one Sol/high worker first completed bounded read-only design, then
owns workflow/driver/preflight/tests implementation. Coordinator owns this plan,
documentation, acceptance and PR lifecycle. Weekly allowance at start: 54%
remaining; DeepSeek paused. Effective worker configuration, tokens and active
time are unknown. Startup passed after frozen-lockfile installation; no package
changes. Separate high-risk review ledger for this new PR: two fresh Sol/high
reviewers (correctness/isolation and architecture/compatibility), maximum seven
launches, one initial wave, four targeted waves/fix batches, one final integration
wave, 60 minutes total and 30 minutes per reviewer. No review launched yet.

Implementation delivered without rework or edit conflicts. Seven code/test files
changed; coordinator independently confirmed all seven original raw step blocks
occur unchanged exactly once in the shard. Worker targeted tests passed 97/97;
canonical workflow checks passed 231/231. Coordinator focused integration passed
the same 231 workflow/affected tests plus architecture, UI policy, design policy,
TypeScript and lint. Pre-commit Pika audit and whitespace checks passed. No native
job has run for this phase yet. Durable PR lifecycle metadata and the PR body
will bind review/CI receipts to their actual SHAs without rewriting this history.

Draft [PR 1546](https://github.com/codepetca/pika/pull/1546), initial head
`af08e1113cec17b8b63bf094a359fbe673fe28de`: both independent initial reviews
completed assigned scope and found the same P2 historical `--ref` regression.
The new unconditional job inventory rejected earlier supported workflows, even
though they retained every proof inside the original database job. Coordinator
reproduced it. One batched fix will distinguish a complete legacy topology from
a broken new split: legacy database/all coverage remains complete, explicit SDK
selection rejects absent legacy lane, and missing/renamed modern SDK stays an
error. No hosted-isolation, proof or aggregate-gate defect found. New-PR budget:
two launches, one initial wave, one accepted issue after deduplication; first fix
batch underway. Targeted compatibility review then final cumulative integration
remain before ready. Reviewer active time/tokens unavailable; actual per-turn
findings and SHA receipts recorded in the append-only lifecycle log.

First batched correction delivered: complete legacy extraction and conditional
plan expansion plus shallow-checkout-safe regressions. Actual base `e24d591`
database dry-run changed from RED to GREEN; all/test-build/browser extraction and
explicit legacy SDK refusal verified. New split missing/deleted/renamed shard
and incomplete proof inventories still reject. Focused integration passed 244/244
tests plus all prior static gates; audit and whitespace checks passed. One fix
batch consumed, no further implementation scope added.

Targeted review and the final cumulative review completed clean at
`f7ebd67c63eca1e26aa10ad8d23944e2fd9621b7`: four actual review turns, one initial,
one targeted and one final wave, one fix batch. Ready event started eligible
[run 37877681068](https://github.com/codepetca/pika/actions/runs/37877681068).
Four heavy jobs started together on distinct GitHub-hosted Ubuntu runners; extra
canonical startup measured 87 seconds. Owner-detail normal/two forced modes passed.
Full coverage tests then exposed six assertions that compared global step order
across the now-independent jobs (15,754 tests passed, six failed, eight skipped).
The focused inventory missed these disk-reading workflow tests. Coordinator
cancelled remaining jobs, returned the PR to draft and retained attempt telemetry.
No speedup or native acceptance is claimed from this incomplete attempt.

CI correction batch two changes only workflow-contract test scoping and the
canonical `check:workflow` test inventory. Preserve every command/receipt/safety
assertion while expressing ordering inside the owning job; original native/type
checks remain required in their original job, without cross-runner order. Add
these tests to focused checks because filesystem reads are not import-graph
dependencies. Targeted review of the correction will combine with unchanged
final cumulative source coverage; no second full/final wave is planned. Existing
review clock and counters remain running; native retry must use its new reviewed
head, with main merge and all other holds unchanged.

Second correction delivered and focused checks passed 532/532 across 53 files
plus architecture, UI/design policy, TypeScript, lint, audit and whitespace gates.
All 44 tests that literally read CI YAML are now in the canonical inventory; an
offline regression detects omissions. A worker's broad check had one existing
Tart subprocess scheduling failure, followed by isolated 51/51 success; coordinator
whole focused check passed 532/532 without changing that test or infrastructure.
Full offline coverage is running as additional validation of the CI-exposed gap.
First incomplete attempt: 593 seconds workflow time, zero workflow queue seconds,
2,148 observed job seconds including cancelled work; retain it in total effort.
Actual classifier was full, selecting both database jobs, test/build and browser.

CI-correction review at `009d63748c7f62afa1cd1452f05f867fd8600843` found one
additional P2: the inventory covered 44 unit readers but omitted the architecture
Vitest reader. Coordinator accepted and directly corrected this small third
batch: include `tests/architecture/atomic-test-grading-contract.test.ts`, scan
all test directories in the omission regression, and retain the same source and
runtime coverage. Total literal CI-YAML readers is 45. Five review turns and
three fix batches consumed; the next targeted turn must validate only this delta
and combine with unchanged cumulative coverage. Original review clock/budget
remain unchanged. Full offline CI coverage at `009d63748` passed 15,761 tests,
eight existing skips and all thresholds (85.5% statements, 77.74% branches,
91.67% functions, 87.48% lines); production/proof sources remain unchanged.
Third-batch focused checks passed 541/541 across 54 files and every static/audit
gate. Native acceptance still requires one eligible run at the final reviewed SHA.

## Historical first pilot

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

Initial review completed against `47e705976c75289ff13fd899f96b69d340684964`:
correctness/privacy passed (independent 249/249 tests); compatibility found two
P2 measurement issues: earlier attempts were omitted and missing workflow times
dropped usable job evidence. One batched correction retains all job attempts,
deduplicates carried successes by physical intervals, preserves failed attempts
and validates workflow/job/step intervals independently. New regression cases
cover both failures. Draft PR: https://github.com/codepetca/pika/pull/1538.
Reviewer effective configurations, tokens and active elapsed time are unknown.
Final cumulative review follows the corrective fixed SHA; no proof code changed
in this remediation batch. Review budget consumed: two initial launches, one
remediation batch; final integration wave pending.


Browser implementation verification: targeted red/green regressions retained
(23 expected pre-implementation failures; 143 final tests pass). Coordinator
focused checks pass 575 tests in 54 files plus architecture, UI/design policy,
TypeScript and lint. Four changed TypeScript test files pass Pika audit; script
syntax and whitespace checks pass. Real list-only collection proves the exact
573-case union and only the two setup cases repeated. Historical browser plans
at current pre-split `48f27a9870c7705187f0fd5708bec7ff5e89ed3e` and older local-CI
`b8169adaa7802e79e44ea8236021ce9297d61d2e` execute dry-run successfully. Separate
local reports retain failure diagnostics without attributing preceding-lane
reports to a setup-failed dark lane. No browser runtime or canonical database
mutation was performed locally. Independent review and final hosted acceptance
remain pending; the draft-first lifecycle binds their receipts to actual SHAs.
