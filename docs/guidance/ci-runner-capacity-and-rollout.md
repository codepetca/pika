# CI runner capacity and public-repository hold

Owner request, 2026-10-23: move heavy CI onto isolated runners, reduce artifact
uploads, protect the development Mac, and keep Pika public until actual usage is
comfortably within GitHub Free. There is no separate runner machine yet. Hardware
purchase, provisioning of a new machine, and repository visibility changes have
not occurred. The existing hosted route remains available while capacity is built.

## Measured baseline

The read-only GitHub audit covers runs created from 2026-10-16 19:04:36 UTC
through 2026-10-23 19:04:36 UTC (15:04:36 America/Toronto on both dates).
All job attempts were retrieved and carried-forward physical executions deduplicated.
There were 369 workflows, 223 skipped, and 1,226 completed hosted executions:
15,035 per-job-rounded minutes. Eleven unfinished jobs were excluded. This is a
creation-cohort measurement, not an invoice or a complete ledger of older-run
reruns. GitHub's separate billing report records 14,652 Linux minutes for the
seven complete UTC days October 16–22 and no net Pika charges while public.

The eight heavy lanes account for 941 executions and **238.12 actual runner-hours**.
Successful heavy jobs alone used 192.36 hours. On October 20 in Toronto, the cohort
contained 282 arrivals and 73.51 runner-hours. These measurements include failures
and cancellations and exclude unfinished jobs; they are a lower bound for capacity.

Allowing an illustrative two minutes for clone, boot, admission, runner setup and
teardown per heavy execution adds 31.37 hours/week. That overhead has not been
measured on a new host. At unchanged execution speed:

| Simultaneous isolated slots, available all week | Weekly utilization including assumed overhead |
| --- | --- |
| 1 | 160%: cannot keep up |
| 2 | 80%: little burst or maintenance margin |
| 3 | 53.5%: useful starting capacity, subject to real queue measurements |

These are runner-slot hours, not CPU-core hours. SMT threads are not physical cores,
and guest vCPUs do not establish equivalent performance. Faster hardware, VM startup,
dependency downloads, bursty arrivals and contention all require live measurement.
Routing the small final gate adds about five slot-hours/week with this assumed
startup overhead. Do not promise the current hosted parallel latency on a serial host.

## Hardware to obtain

Recommended starting point: an always-on x86-64 Linux machine with **64 GiB RAM,
1 TB NVMe SSD, wired Ethernet, and a modern CPU with at least eight strong physical
cores and sixteen logical threads**. Twelve physical performance cores are preferable
for three concurrent 4-vCPU guests. A small desktop or mini workstation is suitable
if its sustained cooling and power limits support the measured load; a short turbo
benchmark is insufficient. Choose hardware supporting AMD-V/VT-x and KVM.

Start with three isolated 4-vCPU, 12-GiB guest slots and approximately 120–150 GB
thin-provisioned disposable disk per slot. Keep capacity for the base image,
dependency/image caches and at least 200 GB actual host free space. This is a
starting budget, not permission to remove unrelated data. Recheck actual storage
before image builds. A 32-GiB/two-slot machine is a possible lower-cost experiment,
but has less throughput margin and is not the default capacity recommendation.

No particular product or price is accepted yet. Memory upgradeability, NVMe
replacement, Linux support, sustained cooling, power draw and warranty matter
more than a marketing core count. Hardware purchase needs an owner selection.

## Linux and Tailscale setup

1. Install Ubuntu Server 24.04 LTS on the dedicated machine, enable virtualization
   in firmware, apply OS security updates and verify KVM support. Use libvirt/KVM
   to create a reusable clean Linux guest image. The existing Tart driver is
   specific to the Mac and is **not** a Linux provisioning implementation.
2. Install Tailscale on the **management host**, tag it as a CI server and restrict
   both network access and Tailscale SSH to the owner's administration identity.
   Keep SSH off the public internet; no router port forwarding is needed. Protect
   host authentication and runner-registration credentials outside CI guests.
3. Create a separate guest bridge and explicit firewall policy. Allow required
   outbound GitHub/package/image HTTPS, and controlled DNS/time services. Deny
   guests access to host administration, other guests, the LAN, metadata services
   and the tailnet (including 100.64.0.0/10 and applicable IPv6 ranges). NAT alone
   does not supply this boundary. Do not install a Tailscale agent or auth key in
   untrusted disposable CI guests. Test both allowed egress and denied management
   access from the guest before GitHub registration.
4. Prepare the guest with the pinned Node, pnpm, Supabase, Docker, Chromium and
   Actions runner versions required by the canonical workflow and preflight. Give
   each VM its own rootless Docker daemon, writable disk and scratch workspace.
   No host mounts, developer environment files, persistent operator credentials
   or shared live database. Do not weaken toolchain or resource preflights.
5. Implement/review a Linux admission controller using the same ownership,
   credential separation, exact repository, cancellation and cleanup contracts as
   the Mac driver. It must cap active guests, register an **ephemeral one-job**
   runner with `self-hosted`, `Linux`, `pika-ci` labels, preserve bounded diagnostics,
   then verify deregistration and destroy that guest after every job. A missing
   cleanup receipt stops further admission. Never reuse a dirty guest.
6. Measure one slot first, then two, then three. Admit more only when memory,
   swap, CPU, thermal, disk and queue evidence support it. Bound discovery polls,
   back off when idle, share no registration tokens with workflow source, and
   preserve the ability to disable new admissions safely. Never silently shift a
   whole backlogged queue to hosted compute.

GitHub runners initiate outbound HTTPS connections. Tailscale provides host
management, not a requirement for GitHub to reach the runner. Public fork workflows
can request self-hosted labels in modified code; labels are not an access-control
boundary. The disposable guest and network boundary must therefore protect the host
even when workflow code is hostile. Same-repository routing checks alone are not
permission to run public source beside host credentials.

References: [Ubuntu libvirt](https://ubuntu.com/server/docs/how-to/virtualisation/libvirt/),
[GitHub runner lifecycle and communication](https://docs.github.com/en/actions/reference/runners/self-hosted-runners),
[Tailscale servers](https://tailscale.com/docs/how-to/set-up-servers),
[Tailscale SSH](https://tailscale.com/docs/features/tailscale-ssh).

## Protect the development Mac

The inspected Mac is an Apple M3 with four performance and four efficiency cores,
24 GiB RAM, and a stopped 4-vCPU/12-GiB Tart template. During the October 23 sample,
free + inactive + speculative memory was about 8.4 GiB. Existing swap was about
2.84 GB; a 60-second sample recorded no new swap-outs and normal memory pressure.
Historical swap use alone is not a refusal; it is not available memory either.

Use `python3 scripts/run-ci-tart-host.py --capacity` for a read-only assessment.
Before clone and immediately before boot, admission now requires:

- normal memory pressure, at least 18 GiB free + inactive + speculative memory
  (12 GiB guest plus 6 GiB host reserve; no added purgeable/compressor pages);
- at least eight logical CPUs, one-minute load at most half the CPU count, and
  no swap-out growth across the sampled interval;
- at least 80 decimal GB actual free storage, the owned shared HQ lease and no
  other running Tart VM.

Missing or malformed telemetry refuses admission. The current Mac fails the memory
reserve. Do not reduce thresholds merely to make a pilot start. These are conservative
admission checks, not continuous throttling or a guarantee against later pressure.
The Mac remains an operator-present one-job pilot; no automatic Mac service is
installed, and the shared lease remains exclusive with HQ.

## Activation and usage acceptance

Keep `PIKA_SELF_HOSTED_CI` unset until a real runner pool is ready. Obtain an eligible
exact-head PR run, verify actual runner identities for every selected lane and final
`PR Gate`, and verify guest destruction and deregistration. Complete a deliberate
hosted fallback rehearsal without duplicate full suites. Never bypass PR Gate or
use a manual diagnostic as a substitute for the required pull-request gate.

The revised workflow routes all eight heavy jobs and the final gate through the
selected compute location. Classification remains hosted. Applying this layout to
the baseline leaves about 132 hosted minutes/week, or 566 per 30-day month, before
other repositories and exceptional/fork runs. That is a **projection**, not accepted
savings. If the classifier fails, skips or has no runner output, PR Gate stays hosted
and retains its existing refusal logic.

Success runs upload no artifacts. Four failure upload sites have one-day retention
and a maximum 256 KiB/eight staged files each, including the manifest. HTML reports,
traces and videos are excluded. If all 143 previously executed runs failed at all
four upload sites, staged payload would be at most 143 MiB before archive overhead.
This cohort bound is not an arbitrary-burst aggregate storage guarantee. Old seven-day
artifacts remain until their existing expiry; no historical evidence was deleted.

Before considering private visibility, require at least seven complete measured
days **after activation**, including representative busy-day demand, and:

- hosted usage projects to at most **1,000 minutes per 30-day month**, including
  failures, cancellations, retries and any other private repositories sharing the
  organization's allowance;
- current unexpired artifact storage stays below **250 MB**, with no unexpectedly
  large uploads, and organization-wide shared storage also fits the free allowance;
- measured service demand stays below 70% of available slot-hours, queued work
  drains between bursts, and the host has no sustained memory pressure, growing
  swap, thermal throttling or storage pressure;
- all required checks and teardown receipts pass, and private-repository rulesets,
  migration environment secrets, Vercel plan and integration permissions have been
  separately resolved. GitHub Free's private-repository feature restrictions are
  not removed by self-hosting.

Run `pnpm check:ci-quota --not-before <actual-activation-UTC-date-or-instant>`
for the read-only seven-day audit. `--end YYYY-MM-DD` selects an exclusive UTC
midnight endpoint; by default it leaves two complete days for billing ingestion.
Missing activation evidence, no measured self-hosted execution, incomplete or
unknown runner evidence, or a recent billing window makes the report inconclusive.
It checks the maximum of per-job rounded cohort minutes and the repository's
billing-ledger Linux minutes, so reruns of older workflows are not silently lost
from the projection. A report without `--not-before` is observation only. API
errors never change repository settings. Organization-wide allowance and complete
selected-lane/queue acceptance remain separate checks.

A passing quota report only makes the change eligible for owner review. It does
not change visibility, downgrade the organization, authorize a purchase or release
production. Current status: implementation and capacity planning in progress;
dedicated machine, live activation and post-activation usage acceptance pending.
