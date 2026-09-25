# Account plan foundation (migration 206)

Status: dormant schema and service-only writer. This is not a billing launch or
permission cutover.

The [account-plan rollout runbook](account-plan-rollout.md) separates read-only
inventory, approved account batches, and the later strict cutover. The older
Access-pilot cutover is not a plan-classification runbook.

`public.account_plans` stores one current account-level plan (`free`, `basic`,
`plus`, `pro`), with a revision. `set_account_plan_v1` takes a unique operation
ID, expected plan revision, actor reference and reason code. It derives the
`classrooms.create` effective entitlement in the same transaction: 0, 2, 5 or
10 active owned classrooms respectively. It accepts no quota argument. Both
plan assignment and derived entitlement have immutable audit records. Browser
roles cannot read or write plan records or execute the assignment RPC.

The existing classroom creation/restore database guard remains authoritative;
no UI plan label is authorization. The setter deliberately overwrites the
current `classrooms.create` snapshot for a classified account, including an
old manual Access snapshot. It does not affect `grading.ai` or any other
feature, and it never archives, deletes or transfers classrooms. If the new
limit is below the existing active count, current classrooms remain available
but new active-classroom consumption is denied.

Applying migration 206 does **not** populate existing accounts, change current
entitlements, or activate the strict-creation setting. Once strict creation is
activated separately, future signups receive a Free plan and the matching Free
snapshot in one transaction. Before activation, signup behavior stays as it
was. Existing accounts must be reconciled by a separately reviewed, explicit
assignment run; no email address or production user ID is embedded here.

The plan record and effective grant can drift if an operator uses the older
direct entitlement setter after a plan assignment. Until the separate billing
and grant-precedence resolver exists, operational tooling must use
`set_account_plan_v1` for plan changes and compare both records during rollout.
No trial, cancellation, payment state, AI quota, temporary override, upgrade UI
or automated downgrade policy is implied by this migration.
