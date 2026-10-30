# Automatic managed RepoLight provisioning (source only)

Migration298 depends on296's exact plan/trial/offering entitlement resolver and
297's encrypted, idempotent managed registry. No migration or configuration in
this change enables hosted billing, provisioning, analysis, or AI. Billing stays
sandbox-only and the existing provider/production rollout hold still applies.

After explicit operator configuration, successful trial or verified subscription
activation records a private provisioning hint in the same billing transaction.
The transaction does not call RepoLight. A failed/rolled-back activation cannot
leave a committed hint. A best-effort post-commit worker kick uses the trial
subject, captured subscription binding, or validated applied upgrade subject;
its failure leaves the durable hint
available for recovery and does not turn billing success into an error.

The runtime requires `PIKA_REPOLIGHT_MANAGED_ENABLED=true` and valid297 control
and encryption configuration. The database separately requires
`private.repolight_settings.managed_provisioning_enabled=true` (default false).
Neither setting replaces296's exact current entitlement proof. Recovery scans
up to25 active billing/trial or eligible legacy Plus/Pro account revisions per
claim to discover accounts predating gate activation. Legacy discovery requires
the independent legacy-access gate; account-plan changes also emit hints.
Legacy identity roles do not determine eligibility. The opaque
registry operation and tenant references are the only tenant bindings sent to
RepoLight; the Pika user UUID stays inside Pika.

Each queue row coalesces one account's monotonically ordered billing/plan/
entitlement revisions. A newer revision clears the old lease, so an old worker
cannot acknowledge it. A90-second lease permits recovery after process death;
each revision has at most three attempts, with a five-minute retry delay.
Expired third leases and terminal non-retryable failures remain inspectable as
`failed`. Identical billing replays and recovery scans cannot restart exhausted
work. A relevant database rollout-gate change increments one private epoch row.
Claims repair at most25 old-epoch denials and25 exhausted leases at a time;
there is no bulk queue reset in a settings transaction. A processing worker
retains its claim epoch, so a late denial remains discoverable even when the
gate change commits between its epoch read and denial write. This allows an
unchanged plan to become eligible after rollout. Failed operations
need explicit maintenance; the worker does not rotate or replace credentials.

The authenticated `/api/cron/repolight-provision` route uses `CRON_SECRET` and
has one daily Vercel Hobby-compatible schedule. It processes at most ten claims
sequentially, with a40-second delivery budget, five-second SQL request deadlines,
four-second provider request deadlines, and acknowledgement reserve inside the
route's60-second maximum. It reports `empty`, `batch_limit`, or `time_limit`;
the latter two can indicate remaining backlog. Daily recovery can therefore take
multiple runs after an extended outage or larger rollout; successful activation
also gets the immediate kick. There is no unlimited retry or background loop.

Saved report reads, cleanup credentials, expiry, and AI controls are independent
of this queue. Deleting an account cascades its queue metadata;297 deliberately
retains cleanup credentials. The worker invokes `registry.ensure`, which checks
exact current eligibility before allocation and activation and resumes the same
durable encrypted operation after an uncertain provider result.

Migration297 places the default-off managed provisioning switch under the same
billing-settings → RepoLight-settings → account/feature → owner lock order as
eligibility. New and resumed provisions cross prepare immediately before HTTP,
and activation checks the switch again. A committed disable therefore fences
waiting prepare/activation calls. SQL authorization commits before HTTP; a
disable can still win between authorization and the network send, so the remote
workspace may be allocated while local activation is denied. Its exact pending
operation/key stays durable for recovery. No SQL transaction spans HTTP.
Interrupted rotations and saved cleanup credentials remain recoverable while
provisioning and analysis access are disabled.

`bash scripts/check-repolight-provision-outbox.sh` replays actual298 into a fresh
native PostgreSQL cluster with minimal prerequisite tables and a private Unix
socket. It verifies queue transaction, gate, lease/revision, retry, ACL, and
account-removal contracts. It neither applies a migration to shared Supabase
nor replaces combined296–298 replay, generated-schema checks, or registry/provider
contract tests. The combined offline proof now replays actual001–298, checks
role-neutral legacy discovery/plan changes and disabled rotation recovery, and
runs two-session late-denial/epoch and prepare/activation cutoff interleavings.
Runtime/API tests cover safe failure persistence, cron auth,
sequential batch/deadline bounds, and post-commit ordering. Hosted activation and
provider behavior remain untested by this source-only change.

## Catalog rollout

New checkout requests use the historical launch catalog until the separately
controlled `BILLING_REPOLIGHT_CATALOG_ENABLED` setting is explicitly enabled.
Enable it only after the new immutable RepoLight catalog variants are provisioned
and verified. The switch affects fresh checkout selection, not already reserved
checkout attempts or purchased offering versions. It does not enable billing,
RepoLight analysis, provisioning, or AI by itself.
