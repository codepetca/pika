# Classroom Home recovery and pilot readiness

This is a preparation packet, not an activation instruction or approval.
Production Home/page/cohort activation and all live-provider calls/configuration
remain held. Immediate readmission policy is deferred; keep the existing final
removal guard. Billing and subscription work is separately owned.

## Compatible recovery floor

The [inactive foundation release](production-home-foundation-release-2026-10-24.md)
records production `4778514b0a4de839f55459d7255fa91e305bd1bb` and installed schema
001–292. That release is the minimum compatible application payload for this
packet, not permission to promote whatever later becomes `main`. Any later
candidate needs its own reviewed diff, checks and exact deployment receipt.
Do not downgrade to a teacher-only build, drop additive schema, rewrite account
roles, or delete ownership, enrollments, preferences or classwork to recover.

At the inactive release, all five Home/page/admission environment settings were
absent. That is a baseline receipt, not a perpetual claim about current settings.
Before any separately approved activation, re-read exact deployed app/schema and
configuration metadata privately; keep codes, user IDs and environment values out
of public logs and PRs.

## What stopping growth means

Retain the exact already-admitted IDs in
`PIKA_CLASSROOM_EXPERIENCE_ADMISSION` and
`PIKA_CLASSROOM_HOME_ACCESS_USER_IDS`, with the Home enable flag. Retain applicable
independent `PIKA_CLASSROOM_PAGE_ACCESS_ENABLED`/`PIKA_CLASSROOM_PAGE_ACCESS_PAIRS`
configuration as well. Stop adding IDs/pairs; do **not** remove existing admission
or turn off their compatible routing as an emergency shortcut. These controls
are distinct from subscription/creation entitlements.

A managed, disabled creation grant prevents a **new** creation, but existing
classroom relationships remain valid and a completed creation operation can
replay its original result. Changing grants is not part of an ordinary
growth-freeze response and requires its own authority. Do not alter real account
plans or trigger billing reconciliation to perform a rollout stop.

An unavailable creation evidence source instead returns503 and must not fall
back to legacy creation. Even a completed replay cannot bypass that required
preflight while it is unavailable. The Home server-rendered page currently
shows its generic error state when a required capability read fails; this packet
does **not** promise uninterrupted full Home rendering during that outage.
Independent authenticated Home/list/classroom relationship reads do not acquire
creation permission merely because creation is disabled or unavailable. After
the source recovers, fresh reads recover without changing admission or roles.

## Evidence and its limits

| Evidence | What it establishes | What it does not establish |
| --- | --- | --- |
| Accepted isolated real-cookie Home rehearsal, frozen `28fc6de8960946dcc18fbe5b6c2b2efc02b97693`, schema292 | Real signed-in mixed-role create/replay, code join, Teaching/Joined navigation, persisted hide/unhide, removal/privacy and screenshots | Production activation, a later changed app, live providers or a capability-source outage |
| Recovery SQL contract in the existing offline owned-clone verifier | **Pending execution:** installed atomic creation, managed disable/new-operation denial/completed replay, real service-role42501, exact ACL restoration, relationships/work preservation and rollback equality | HTTP/PostgREST connection-pool/cache behavior, browser outage behavior or deployed recovery |
| Focused route/adapter/server-page recovery tests | Actual application mapping of capability42501 to503 with no writer/legacy fallback, retained independent reads and subsequent recovery for both global-role labels | Real transport/database provenance; their database responses are synthetic |
| Inactive production release receipt | Exact released payload, schema292, public unauthenticated smoke checks and activation-off metadata at that observation | Signed-in production canaries or future configuration stability |

The combined check is a **layered isolated prepilot growth-freeze/recovery
proof**, not one operational PostgREST→SDK outage journey. Preserve this
distinction in release decisions. Reuse accepted domain/lifecycle/privacy and
rollback evidence only where the application/schema bytes and interactions are
unchanged; close specific gaps rather than restart broad architecture work.

## Pilot decision sheet — not yet authorized

Record these privately before activating anything:

- Operator and backup: **UNSET**; name who can stop growth and restore a
  compatible deployment, with access verified before the window.
- Exact release/schema/configuration commitments: **UNSET** for activation;
  compare against the compatible floor above. No implicit latest-main release.
- Cohort: **UNSET**. Proposed first cohort is explicitly selected synthetic
  accounts: one owner of A/member of B, the reciprocal account, and an unrelated
  denial-control account. No existing user is silently admitted.
- Window: **UNSET**; outside teaching time. Proposed initial observation is one
  fixed30-minute window, with no automatic expansion or renewal.
- Provider surface decision: **UNSET**. Confirm the selected journeys cannot
  issue held Bara/Pal/AI calls. Mocks are not live-provider readiness. If the
  reachable candidate requires them, keep activation held until their separate
  readiness/authority is resolved; do not remove controls to make a canary pass.
- Separate activation authorization and approved configuration diff: **UNSET**.
  This packet, a source merge, or a green test does not supply either.

## Proposed canaries and exact stop conditions

Capture baseline outcomes before the change, then repeat with the selected
signed-in accounts after separately approved activation:

1. Login and existing owned/member classroom reads; Teaching/Joined lists and
   links; original account role remains unchanged.
2. Creation capability and one authorized synthetic create plus exact-operation
   replay; code join follows existing invitation/removal policy; hide/unhide
   persists across reload without changing another account's view.
3. Existing synthetic submission and manual-grade/return flows; applicable
   attendance reads/writes only when their separately controlled service path is
   ready and authorized. Do not invoke held providers as a test.
4. Deny a nonmember, a member's owner action, an owner's learner action and a
   substituted classroom/resource identity, without exposing private content.

Stop new admissions immediately on **one** unexpected authorization denial,
unexpected401/403/5xx on these authenticated positive canaries, duplicate or lost
creation, lost/changed classwork, cross-account visibility, unauthorized access,
or accepted creation despite managed-disabled permission. An expected negative
control is not a failure. If a positive canary cannot be executed, record it as
unverified and do not expand. No deliberate production entitlement outage or
database grant fault is authorized by this checklist.

Keep private receipts of exact versions, scenario labels, expected/observed
status, counts, duration and decision; never classwork, codes, token/cookie
contents or raw personal identifiers. Unavailable metrics are unknown, not zero.
Use existing observation tools; adding production telemetry is a separate change.

## Recovery and exit

On a stop, retain the existing admitted cohort and minimum compatible build;
freeze additions and diagnose the concrete failing path. If a deployment
rollback is needed, use the approved compatible artifact and normal release
procedure, not an old global-role build or a database rollback. Any new
deployment/configuration/account action still needs the appropriate authority.
Re-run the failed and preservation canaries after recovery before resuming.

Expand only after the full fixed window and every applicable positive/negative
canary pass with no unresolved privacy, data or provider gap, and a separate
expansion decision is recorded. Final goal completion requires that controlled
activation and observed expansion; this preparation packet cannot mark rollout
complete. See the [bounded cutover roadmap](classroom-access-and-entitlements-roadmap.md)
and [retained admission contract](classroom-experience-admission.md#retained-admission-and-recovery).
