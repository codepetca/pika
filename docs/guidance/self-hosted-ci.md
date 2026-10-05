# Pika CI on your hardware

Heavy CI can run on a dedicated Linux runner while GitHub runs change
classification and the required `PR Gate`. All existing checks and risk selectors
remain required. A successful local run does not replace the PR gate.

## Delivery plan and acceptance

1. Preserve job IDs, names and commands; add private-repository compute routing
   and an explicit hosted fallback.
2. Provide `pnpm ci:local` to execute canonical workflow commands in a clean
   checkout of a named commit with private logs and disposable stack isolation.
3. Test routing/refusal behavior, dry-run all lanes, run local checks, independently
   review a fixed SHA, and obtain its required PR CI result.
4. Choose and prepare the Linux host, register and rehearse its runner, then
   enable it after the repository is private. Verify an eligible PR run uses the
   runner and passes `PR Gate` before claiming operational completion.

Preparation does not change visibility, register a runner, or enable the setting.
Hardware activation remains pending until a host is chosen and a real self-hosted
run passes.

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

## Register and enable

**Do not register a repository runner while Pika is public.** Routing code alone
cannot constrain a public PR that changes the workflow. GitHub recommends private
repositories for self-hosting; see [runner setup](https://docs.github.com/en/actions/how-tos/manage-runners/self-hosted-runners/add-runners).

After the owner makes the repository private:

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

Unset/false settings and public or fork PRs use hosted compute. Malformed settings
fail. An explicit self-hosted dispatch is refused for a public repository.
Production migrations keep their existing manual hosted workflow and separate
authorization. This change gives CI no production credentials or rollout authority.

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

The live command runs committed source, not uncommitted edits. Database/browser
lanes require the isolated Linux VM and empty daemon. Inspect dry-run output for
the exact SHA, complete migration inventory and commands. Local migration replay
retains the one-time exact-target authorization in the schema rollout checklist;
the runner also requires an explicit acknowledgement:

```bash
pnpm ci:local -- --lane database --ref <reviewed-sha> --dry-run
pnpm ci:local -- --lane database --ref <reviewed-sha> --ack=DISPOSABLE_CI_DATABASE
pnpm ci:local -- --lane browser --ref <reviewed-sha> --ack=DISPOSABLE_CI_DATABASE
```

The temporary checkout retains `.git` for commit-bound rehearsals, excludes
environment files and uses a restricted child environment. Commands come from
`.github/workflows/ci.yml`; unsupported syntax fails rather than dropping checks.
Setup actions become local tool verification; cache/artifact actions use local
storage. Logs and browser artifacts remain in the reported private directory.
`check:focused` remains the faster iteration command, not the full suite.

## Measurement

Compare job timings and runner identities for similarly classified runs. A single
VM saves hosted minutes but serializes heavy work. Artifact/cache storage has
separate billing. Verify [current billing terms](https://docs.github.com/en/billing/concepts/product-billing/github-actions)
before activation; self-hosted execution is currently listed as free.
