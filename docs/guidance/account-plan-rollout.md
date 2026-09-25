# Account-plan rollout (not activated)

This is the operator sequence for moving from the original one-classroom
**Access** pilot to the Free/Basic/Plus/Pro account plans introduced by
migration 206. It is a preparation and verification guide, **not** authorization
to classify an account, change a grant, enable strict enforcement, apply a
migration, or deploy an app release. Follow the
[schema rollout checklist](schema-rollout-checklist.md) for any migration and
obtain separate approval for each hosted data change and for activation.

The old [classroom-creation cutover](classroom-creation-entitlement-cutover.md)
documents the Access pilot and its migration-181 mechanics. Do not use its
"grant Access to existing owners, Free to everyone else" instruction as the
plan-migration policy. An existing owner may need Basic, Plus, Pro, or a
separately approved accommodation to preserve creation capacity.

## Boundaries

| Plan | Maximum active owned classrooms | What this rollout does **not** grant |
| --- | ---: | --- |
| Free | 0 | Classroom ownership, teacher route access, or AI grading |
| Basic | 2 | Classroom ownership, teacher route access, or AI grading |
| Plus | 5 | Classroom ownership, teacher route access, or an AI allowance |
| Pro | 10 | Classroom ownership, teacher route access, or an AI allowance |

The plan setter derives only `classrooms.create`. Current `users.role` checks
still govern legacy teacher/student routes; neither a plan nor an entitlement
turns a student-valued account into a classroom owner. Existing classrooms
remain owned and usable after a downgrade, even above the new limit; creating,
restoring, or receiving another active classroom is blocked at capacity. No
payment, subscription, trial, cancellation, monthly AI allowance, or upgrade
UI is included. Joining and student work must remain independent of the
classroom-creation limit, subject to the still-live role and join-policy gates.

## Release 1 — read-only inventory and decisions

1. Record the exact app SHA, database target/project, migration history,
   operator, and change window. Require migrations 181 and 206 on that target;
   do not infer this from source control. Read the strict-creation setting and
   confirm whether it is still off. Stop on version or target ambiguity.
2. Inventory **every** current account: account ID, current plan/revision (or
   missing), `classrooms.create` grant source/enabled/limit/validity/revision
   (or missing), current active owned-classroom count, and any prior account-
   plan or entitlement audit. Report counts and anomalies first. Keep the
   identity-level inventory and operation IDs in a private release record,
   never in the repository or a public PR.
3. Mark accounts requiring an explicit owner decision: any active classroom
   owner, any current Access or other manual grant, any existing plan, and any
   plan/grant mismatch. Flag an audited account whose current creation grant is
   missing for immediate repair: it is already fail-closed, even before strict
   activation. Do not infer a paid plan from `users.role`, an email domain, or
   ownership count alone. Do not silently turn an old Access grant into Free
   or assume all existing owners fit within one classroom.
4. Produce a reviewed, account-by-account mapping to Free/Basic/Plus/Pro.
   Record the intended creation limit and whether current active count is
   above it. Resolve the owner experience for over-limit accounts **before**
   assigning a lower plan. A plan of Free for an existing owner preserves
   their classes but stops new active-classroom consumption; that effect must
   be an explicit decision, not a batch default.

This release makes no writes. If live database access is unavailable, stop at
the versioned source review; do not claim the inventory or account mapping is
verified.

## Release 2 — small, audited account batches

Only after the mapping and target-specific hosted-write approval, assign one
account at a time through the service-only `set_account_plan_v1` RPC. Use a
unique operation UUID, exact subject UUID, approved plan, actor reference,
reason code, and the account's **observed** expected plan revision (zero for a
missing plan). Record the operation ID privately so a retry uses the same ID
and identical inputs. Do not update the tables directly or use the older
`set_effective_feature_entitlement_v1` for a classified account: the plan and
its creation grant must change atomically.

After each small batch, read back every plan and effective grant. Require the
plan revision, grant source `plan`, enabled state, quota, and both immutable
audit records to match the intended result. Recount active owned classrooms
and check that no classroom was archived, transferred, or deleted by the
operation. Stop on a stale revision, unexpected prior plan, mismatch, or
creation denial outside the approved mapping; reconcile that account before
continuing. A correction is another audited `set_account_plan_v1` call with a
new operation ID and the new observed revision.

Classification is already effective for the accounts it touches while broad
strict enforcement remains off. Preserve normal login, classroom read/edit,
join, submission, grading, and attendance canaries during each batch. Test
creation and restore at/below/above the limit with synthetic accounts when
possible, including Blueprint creation, idempotent retry, and ownership transfer
to a recipient below, at, and above capacity. Require at/over-limit recipient
transfers to fail and stop on any bypass. Do not change a real teaching
classroom merely to exercise a canary.

## Release 3 — separately approved strict cutover

Do not activate strict creation merely because migration 206 or a plan batch
has landed. First require a fresh zero-unclassified-account result from
`get_classroom_creation_entitlement_cutover_status_v1`, complete plan/grant
parity for **all** accounts, expected account totals, and the pre-activation
canaries. Reconcile accounts created during the classification window. Strict
activation then requires its own production approval and the migration-181
activation RPC; it is one-way through the service API. After activation,
future signups receive Free plus its zero-capacity creation grant atomically.

The contextual owner/member rollout, neutral onboarding, billing and AI
metering remain separate gates. Do not present the plans as purchasable or
promise Plus/Pro AI allowance until those gates and quantities are approved.

## Stop and recovery

Stop on target drift, missing migration, changed account totals, unreviewed
owner mapping, unexpected Access/plan grant, plan-grant mismatch, failed audit
read-back, loss of existing classroom access, or a route that bypasses the
database creation assertion. Before strict activation, stop classification
and correct individual accounts through the setter. Only never-managed
accounts with no current creation grant **and no creation-grant audit history**
remain on the legacy compatibility path; an audited account with a missing
grant is already denied creation and needs immediate audited repair. After
activation, repair individual snapshots through the audited setter. A systemic
reversal requires a reviewed forward change; do not directly edit the private
switch or delete plan/grant records. Never archive or delete classrooms as an
automatic remediation.
