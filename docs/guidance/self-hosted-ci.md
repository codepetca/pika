# Pika CI on your hardware

Heavy CI can run on a dedicated Linux runner while GitHub runs change
classification, the hosted database lifecycle, Test owner SDK and dark-browser
shards, and the required `PR Gate`. All existing checks and risk selectors
remain required. A successful local run does not replace the PR gate.

## Delivery plan and acceptance

1. Preserve job IDs, names and commands; add same-repository compute routing
   and an explicit hosted fallback.
2. Provide `pnpm ci:local` to execute canonical workflow commands in a clean
   checkout of a named commit with private logs and disposable stack isolation.
3. Test routing/refusal behavior, dry-run all lanes, run local checks, independently
   review a fixed SHA, and obtain its required PR CI result.
4. Choose and prepare the Linux host, register and rehearse its runner, then
   enable it for public or private Pika. Verify an eligible PR run uses the
   runner and passes `PR Gate` before claiming operational completion.

Preparation does not change visibility, register a runner, or enable the setting.
Hardware activation remains pending until a host is chosen and a real self-hosted
run passes.

The `Contextual Test Owner SDK` and `Contextual Test Owner SDK Lifecycle` jobs
always use `ubuntu-latest`, selected by the existing database flag. The first runs
detail, list, draft-save and create; the second runs draft-get, pristine-discard
and publication. Each has a separate hosted VM/daemon and independent canonical
stack. Every normal and forced proof still uses its own fresh disposable project
and complete migration replay. Proofs run serially within each job. Database-selected
PRs require both database-contract jobs and both SDK jobs to pass. The original
database, test/build and browser jobs continue to follow the configured routing;
`runner=self-hosted` therefore means mixed compute with hosted shards. This
does not activate a local runner. See the [proof optimization plan](../plans/ci-proof-setup-optimization.md)
for observed timings and the comparative acceptance gate.

`Architecture Database Contracts` retains its original routing and the first
51 proof blocks through Test member-list. `Architecture Database Contracts
Lifecycle` runs the remaining 85 blocks, starting with owner reorder, on
`ubuntu-latest`. Both use the same database selector, independent complete
migration replay, pinned setup, empty-daemon/port preflight and guarded stop.
Proof blocks stay unchanged and serial within each job. The migration rehearsal
and generated types check remain in the original job; the lifecycle job requires
no fixture or receipt from it. The hosted lifecycle job adds no local runner
registration or activation.

Browser-selected runs require both browser jobs. The original job runs the
light desktop/mobile and light Pattern Lab projects using configured routing;
`Browser Experience Matrix Dark` runs the corresponding four dark projects on
`ubuntu-latest`. Both use the complete canonical `e2e:ci` spec list with explicit
project filters and their own fresh startup, fixture seed, auth setup, artifacts
and cleanup. Playwright serial-file behavior, two workers, retries and snapshots
remain unchanged. The hosted dark shard never shares a database with the
routable browser job or activates a local runner.

The initial host choice is the existing Mac shared with HQ, using separate Linux
templates and a cooperative exclusive lease. Pika's host driver below admits one
job on demand. Automatic queue discovery and fairness between repositories remain
unimplemented.

## Runner requirements

Use Ubuntu 24.04 on a dedicated machine or VM. On a Mac, use a Linux VM. An
initial allocation of 4 CPUs, 12 GB RAM and 60 GB disk is a starting estimate;
adjust from measured Supabase, Chromium and Next.js use.

Use **one runner process per VM and Docker daemon**. Existing contracts use
`supabase_db_pika`, ports 54321/54322 and sibling ports 54331/54332/54340. One
runner runs jobs sequentially. Parallel runners require separate VMs and Docker
daemons. Do not share these with development or another repository.
For a manual local database/browser lane on a runner VM, stop its runner service
first and run only one local CI process. The resource preflight checks for an
empty daemon; it is not a mutex for competing processes.

Provision Git, Bash, Docker Engine, Node 24, pnpm 10.25.0 and Supabase CLI 2.103.0.
Workflow setup actions verify/install Node, pnpm and Supabase. Playwright installs
Chromium and system packages; provision those packages first or give the dedicated
runner user the required package-installation privileges. It also needs Docker
access. Use a dedicated account without provider credentials or developer `.env`
files. Images and package/browser caches may persist; database containers, volumes
and custom networks may not.

Preflight refuses existing Docker resources, occupied test ports or checkout
environment files before stack startup, without deleting them. Jobs stop their
own stack without backup. If interruption leaves resources, inspect and repair
or recreate the dedicated VM; do not prune a development daemon.
Local cancellation waits for the whole command process group, including children
that outlive the shell. If termination cannot be confirmed, it fails without
starting database cleanup; inspect the VM before retrying.

## Register and enable

Public and private Pika repositories may use the isolated local runner. The owner
removed the private-repository prerequisite on 2026-10-08. Registration remains
an explicit operator action, and automatic routing remains opt-in through
`PIKA_SELF_HOSTED_CI=true`. Canonical fork PRs use hosted compute; explicit
self-hosted requests for fork PRs are refused.

Treat guest workflow execution as untrusted. Repository-level labels do not bind
an ephemeral runner to the run named by the operator, and a modified public fork
workflow can request those labels directly. The routing script cannot enforce its
policy against altered workflow code. Retain the disposable, one-job VM, dedicated
credential-free guest, no host mounts, cooperative host lease, bounded execution,
and verified teardown. See [GitHub's self-hosted runner guidance](https://docs.github.com/en/actions/how-tos/manage-runners/self-hosted-runners/add-runners).

For the shared Mac pilot, use the one-job admission procedure below to perform
registration and execution. The general setup sequence also applies to a
separately dedicated Linux host:

1. Use Settings → Actions → Runners → New self-hosted runner for the host's Linux
   architecture. Follow its current download/checksum instructions. Keep the
   short-lived registration token out of source and logs.
2. Add custom label `pika-ci` alongside `self-hosted` and `Linux`. Start exactly
   one runner process/service per VM.
3. Leave `PIKA_SELF_HOSTED_CI` unset during installation. A deliberate full manual
   diagnostic with `runner=self-hosted` can rehearse the host. Verify its runner
   identity, all lane results and clean Docker inventory.
4. Set repository variable `PIKA_SELF_HOSTED_CI=true`. Verify the next eligible
   same-repository PR ready event uses that runner and passes `PR Gate` for the
   reviewed head.

Unset/false settings and fork PRs use hosted compute. Malformed settings
fail. An explicit self-hosted dispatch is allowed for public or private Pika.
Production migrations keep their existing manual hosted workflow and separate
authorization. This change gives CI no production credentials or rollout authority.

## Shared Mac admission

Run the operator driver from this trusted checkout on the prepared Mac:

```bash
python3 scripts/run-ci-tart-host.py
python3 scripts/run-ci-tart-host.py --rehearse
```

The default prints a plan without booting or registering anything. Rehearsal
claims `/private/tmp/hq-books-deep-validation-host.lock`, clones the stopped
`pika-ci-linux-template-prep` template, and checks the unregistered Linux ARM64
guest as the dedicated runner user. It transfers only the canonical resource
preflight into a fresh guest directory and checks all three lanes. It does not
replay migrations. Receipts and child logs are private files under
`~/.codex/artifacts/pika/ci-tart-host` on the prepared operator account.
While host admission and child containment remain verified, the driver collects
bounded tails of allowlisted guest
runner diagnostics into that private directory. It excludes configuration,
credentials, and environment files. The host redacts its known registration token
from collected files; diagnostics never send that token back into the guest after
runner configuration.
The receipt records collection failure or skipped collection. These
bounded logs may be truncated and do not replace GitHub job results.

The shared lease covers clone, boot, guest checks, and destruction. A held lease
or unexpected running Tart VM causes refusal; the driver never steals a stale
lease. It checks ownership before releasing it and retains its lease when VM
destruction or registration cleanup cannot be verified. Inspect that receipt and the owned
VM before recovery. Do not delete another provisioner's lease or stop its VM.
HQ's provisioner must honor the same lease for mutual exclusion to work.

After the owner authorizes runner registration, leave `PIKA_SELF_HOSTED_CI` unset
and prepare a deliberate self-hosted diagnostic.
Once an eligible CI job is queued, serve one job:

```bash
python3 scripts/run-ci-tart-host.py --serve-one \
  --ack PIKA_ONE_JOB_RUNNER --run-id <github-run-id>
```

The driver verifies the exact `codepetca/pika` repository identity and consistent
public/private metadata before admission and registration, and requires queued
same-repository Pika CI demand. The host's `gh` authentication obtains the
short-lived registration token; stdin carries it into
the guest. Host credentials and developer environment files stay on the host.
The runner is ephemeral and its VM is disposable. GitHub deregisters an
ephemeral runner after its one job; see [runner lifecycle and routing](https://docs.github.com/en/actions/reference/runners/self-hosted-runners).

`--run-id` is a demand hint. GitHub routes matching labels and may assign a
different eligible Pika job. The receipt leaves the actual assignment unknown.
Verify the unique runner name in GitHub job telemetry and check its lane result;
do not infer assignment from the requested run ID. The driver exits after one job;
invoke it again for another job, after HQ or another Pika invocation releases the
lease. Its default idle limit is 300 seconds and lifetime limit is 7200 seconds;
`--idle-seconds` and `--lifetime-seconds` set explicit bounds. Keep an operator
present for this pilot. It installs no background scheduler or launch service.

Verify runner identity, lane results, teardown, and the required PR gate before
enabling automatic routing. This on-demand pilot alone does not establish that
the shared host can keep up with the full queue.

## Hosted fallback

1. Cancel the affected eligible CI run and return the PR to draft.
2. Set `PIKA_SELF_HOSTED_CI=false` or unset it. This affects new runs repository-wide;
   it does not move already queued jobs.
3. Verify the reviewed SHA is still the head, then mark the PR ready again. The
   new `pull_request` run performs the same selected checks on hosted Ubuntu.
4. Restore the setting only after validating runner recovery.

Do not run duplicate full suites concurrently. Manual `workflow_dispatch` with
`runner=hosted` is a full diagnostic escape hatch. It **does not** satisfy
PR-required ruleset checks even on the head SHA; see [GitHub's required-check
rules](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/troubleshooting-required-status-checks#checks-from-some-workflow-jobs-are-not-evaluated).

## Local commands

```bash
pnpm ci:local -- --lane all --ref HEAD --dry-run
pnpm ci:local -- --lane test-build --ref HEAD
```

The live command runs committed source, not uncommitted edits. Database/SDK/browser
lanes require the isolated Linux VM and empty daemon. Inspect dry-run output for
the exact SHA, complete migration inventory and commands. Local migration replay
retains the one-time exact-target authorization in the schema rollout checklist;
the runner also requires an explicit acknowledgement:

```bash
pnpm ci:local -- --lane database --ref <reviewed-sha> --dry-run
pnpm ci:local -- --lane database --ref <reviewed-sha> --ack=DISPOSABLE_CI_DATABASE
pnpm ci:local -- --lane database-lifecycle --ref <reviewed-sha> --dry-run
pnpm ci:local -- --lane test-owner-sdk --ref <reviewed-sha> --dry-run
pnpm ci:local -- --lane test-owner-sdk-lifecycle --ref <reviewed-sha> --dry-run
pnpm ci:local -- --lane browser --ref <reviewed-sha> --ack=DISPOSABLE_CI_DATABASE
pnpm ci:local -- --lane browser-dark --ref <reviewed-sha> --dry-run
pnpm ci:local -- --lane browser-pattern-dark --ref <reviewed-sha> --dry-run
```

`--lane database` runs both database jobs followed by both SDK partitions
to preserve complete database coverage. `--lane database-lifecycle` selects only
the second database partition. `--lane test-owner-sdk` runs both SDK
partitions; `--lane test-owner-sdk-lifecycle` selects only the second partition.
Live execution has the same isolation and migration-authorization gates. Older
reviewed commits retain their complete combined SDK job or original database job;
each explicit lifecycle lane rejects a historical layout that lacks that job.
`--lane browser` runs light, dark Experience and dark Pattern Lab sequentially.
`--lane browser-dark` runs both dark jobs; `--lane browser-pattern-dark` selects
only dark Pattern Lab. Both dark jobs use hosted Ubuntu, including when the
primary lanes route to self-hosted compute. Each retains its own guarded fresh
Supabase replay, seed, Chromium verification and diagnostic artifact. Splitting
by family removes the Pattern Lab phase barrier before dark Experience without
changing Playwright workers, retries, timeouts or test selection.
Older reviewed commits retain their complete combined browser lane or original
two-job light/dark layout. The explicit Pattern Lab lane rejects historical
layouts that lack that job.
`--lane all` includes every job exactly once. Local jobs run sequentially with
separate start/preflight/cleanup cycles. The host admission rehearsal still
checks the three routable local lanes; it does not register or serve the hosted
database lifecycle, SDK or dark-browser shards.

The temporary checkout retains `.git` for commit-bound rehearsals, excludes
environment files and uses a restricted child environment. Commands come from
`.github/workflows/ci.yml`; unsupported syntax fails rather than dropping checks.
The split database plan also validates its ordered proof-name inventory.
Intentional proof additions, renames or repartitioning must update that reviewed
inventory contract and preserve supported historical layouts; ordinary command
changes do not require new inventory digests.
Setup actions become local tool verification; cache/artifact actions use local
storage. Logs and browser artifacts remain in the reported private directory.
`check:focused` remains the faster iteration command, not the full suite.

## Measurement

Compare job timings and runner identities for similarly classified runs. A single
VM saves hosted minutes but serializes heavy work. Artifact/cache storage has
separate billing. Verify [current billing terms](https://docs.github.com/en/billing/concepts/product-billing/github-actions)
before activation; self-hosted execution is currently listed as free.

The fixed usage cohort captured from 2026-09-29 13:12:43 UTC through
2026-10-06 13:12:43 UTC contained at least 11,588 projected private job-rounded
minutes: 11,090 in heavy jobs and 498 in classification/PR Gate. Moving the heavy
jobs would remove 95.7% of that known projection. These are projected minutes for
that public-repository cohort, not an actual private bill or a future forecast;
three unfinished jobs were excluded.

The same cohort contained 179.58 heavy-job hours. A single serial host offers at
most 168 hours per week before startup and HQ use. The shared Mac pilot therefore
does not satisfy the measured demand at that run frequency. Measure queue age
and throughput during the pilot before deciding whether to reduce redundant CI
requests or add capacity. Retain all selected checks and the required PR gate.
