# RepoLight analysis access boundary

Source implementation, 2026-10-29. Migration296 is additive and inactive by
default. This document does not authorize shared/hosted migration application,
billing activation, provider provisioning or rollout.

`public.get_repolight_analysis_access_v1(p_subject_user_id uuid)` is service-only.
Its JSON response has `enforced`, `allowed`, `reason`, `source` (`legacy`, `trial`,
`offering` or null), `access_ends_at` and `plan_revision`. `allowed` evaluates
eligibility independently of `enforced`; dormant enforcement does not grant a
benefit. The authenticated server must choose the subject. The resolver grants
no classroom authority and accepts no browser plan claim.

Source/run read replies carry this as optional internal `analysis_access`
metadata. The server projects configured enforced denial as context
`state: 'access_required'` and disables `canAdvance` for unknown-create runs;
known `analysis_id` continuation retains its existing source/lease restrictions.
The metadata itself is not exposed in classroom API replies. Optional absence
retains compatibility with the unmodified293 schema/pilot; the296 SQL admission
checks remain the actual authority. Missing private settings produce enforced
`access_unavailable` denial while saved report reads remain available.

Three additional private settings start false on `private.repolight_settings`:

| Setting | Effect |
| --- | --- |
| `plan_enforcement_enabled` | New run admission and unknown-create claim/authorization require eligibility. False retains the controlled pilot's current behavior. |
| `legacy_plan_access_enabled` | Permit legacy public Pro/Max (internal `plus`/`pro`) only when the account plan audit binds the current plan and creation-entitlement revisions and limit. Direct/manual creation grants do not suffice. |
| `billing_access_enabled` | Evaluate the existing billing/trial lifecycle. The billing sandbox must also be enabled. Current provider schemas accept test mode only; this is not a live billing launch mechanism. |

Billing-managed access additionally requires exact account/access/entitlement
revision and timestamp agreement, current subject/subscription binding, the
purchased immutable offering and a matching recorded paid invoice effect (with
immutable verified upgrade receipts when the original paid invoice predates the
current offering). Only
the JSON boolean `features.repolight_analysis=true` includes the benefit; a
missing key, string, current catalog label or another purchased version does not.
New offering publication and existing subscriber transitions remain separately
owned work. This migration never edits offerings or assigns plans.

Trials require the actual unconverted Pro trial, its immutable definition,
matching effective state and its precise start/end. Existing billing rules
still determine who can start a trial. In particular, this guard does not broaden
the currently teacher-labelled trial-start API to contextual owners. Renewal
grace remains eligible through the stored access deadline; trial and cancellation
get no additional grace. Expiry and renewal-pending cutoffs deny new work without
waiting for maintenance. Missing or mismatched facts fail closed.

The existing begin/advance RPC signatures stay unchanged. Refusal raises SQLSTATE
`P2961`; the server maps it to HTTP403 `repolight_analysis_access_required`.
Ownership, enrollment, source, lease and cleanup checks remain authoritative.
The new service resolver holds billing settings FOR SHARE first, then RepoLight
settings FOR SHARE, then the existing
`account-plan-subject:` advisory lock (seed20620260924), then the existing
`classrooms.create` feature fence. Begin/advance acquire those before their
assignment/classroom/run locks; cutoff checks sample `clock_timestamp()` after
the waits. Provisioning transactions should call the resolver before registry
locks and recheck after blocking waits. Never add a subscription-row lock after
the account lock: billing writers already use subscription then account.

Only advance `claim`/`authorize` with persisted `analysis_id IS NULL` require
current analysis access. This includes uncertain initial outcomes because
`reconcileAnalysis` re-POSTs create and can start a job. Known remote jobs can
poll, retrieve their result and settle after expiry. Saving an ID returned by an
already-authorized create also remains possible after expiry. Cached reports,
feedback import and required erasure do not acquire a paid entitlement check.

SQL authorization commits before HTTP; a plan change or expiry can win the gap
between that check and network dispatch. Authorization runs immediately before
each fetch, but no cross-service atomicity or cancellation of already accepted
jobs is claimed. An unknown response remains a durable subject requiring cleanup;
expiry does not erase it or permit an unsafe reconciliation POST.

`scripts/check-repolight-analysis-access-database.sh` replays001–296 in an owned,
network-isolated database, runs rollback-only compatibility/access contracts,
executes actual two-session contention and compares generated public types.
`--write-types` regenerates the checked-in types from that disposable schema.
The shared local stack supplies platform Auth/Storage schema read-only; its
schema/history/image identity are compared afterward. No shared or hosted
migrations are applied. The separate exact-source CI profile extensions must be
integrated with subsequent migrations before the complete branch is CI-ready.
