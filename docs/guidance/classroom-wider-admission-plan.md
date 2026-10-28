# Wider classroom admission design and rollout scope

Prepared October 27, 2026. **Proposal only: not implementation, migration,
deployment, automatic signup admission or cohort activation approval.** The
[accepted 70 accounts](classroom-rollout-acceptance-2026-10-27.md) and their
compatible routing remain unchanged. All other provider, account/plan, billing
and schema-operation holds remain in place.

## Recommended direction

Keep the existing authentication, server/service-role architecture and
classroom relationship checks. Replace the two growing environment user lists
with one durable, service-owned admission registry, introduced in an inactive
compatibility release. Import exactly the existing 70 first, prove equivalent
decisions, then separately approve small additional batches. Automatic admission
of new verified accounts is a later policy decision, initially off.

Admission selects the classroom experience; it grants no ownership, enrollment,
creation allowance, paid capability or provider permission. A person may teach
one classroom and join another. Creation continues to use server-resolved
entitlements and the atomic writer. Existing plans/purchases are preserved;
Free accounts can do assigned work without receiving creation or paid allowances.

Do not raise the current list cap or add a wildcard as the general rollout.
Neither solves durable retention, independent concurrent administration, atomic
growth control or the existing Home/API divergence risk. This is one admission
contract, not a replacement permission framework or a set of per-route flags.

## Confirmed current constraints

Planning baseline is main `e457db17482119e6f578eef70aa01f1c52a7feed`.
The accepted runtime is separately frozen at
`405ef92cc1dead539e21d77a4193208b9166994d`, schema 001–293. The admission, Home,
page/enrollment and Bara selector files below match between those revisions;
this is not a claim that their entire application trees match. A future release
must review its complete actual promotion diff and coordinate with other owners.

| Existing surface | Constraint and design consequence |
| --- | --- |
| [`classroom-experience-admission.ts`](../../src/lib/server/classroom-experience-admission.ts) | Strict synchronous version-1 JSON, at most 100 unique UUIDs and 20,000 characters. Malformed configuration fails 503. At 70 accounts only 30 list positions remain; this is an operational pilot bound, not a subscription allowance. |
| [`contextual-classroom-home.ts`](../../src/lib/server/contextual-classroom-home.ts) | A second list is also capped at 100. Home requires its switch plus list membership, and the composition intersects this with experience admission. Registry mode must resolve one audience for both. |
| [Home composition](../../src/app/classrooms/page.tsx), [page access](../../src/lib/server/classroom-page-access.ts), [enrollment entry](../../src/lib/server/classroom-enrollment-access.ts) | Home, page routing, code join, creation/authoring and visibility depend on the same intersection. Widening only one parser leaves inconsistent workflows. Independent page/pair switches remain absent. |
| [Attendance automation](../../src/lib/server/bara-attendance-automation.ts), [student attendance](../../src/lib/server/bara-attendance-student.ts) | Admission currently selects membership-aware owner synchronization and learner scan-generation behavior. Broad classroom admission must not silently broaden either provider protocol path. |
| [Pal adapter](../../src/lib/server/contextual-pal-classroom.ts), [Pal configuration](../../src/lib/server/pal-config.ts) | Admission/routing and provider switches are separate. Preserve the current disabled membership/signals/provider controls and fail-closed behavior; no account-profile or legacy-provider fallback. |
| [Creation contract](../../src/lib/server/classroom-creation-entitlement.ts) | Admission does not replace the managed entitlement snapshot, idempotency key or atomic quota writer. No new plan assignment, allowance or enforcement is proposed. |

Many SSR/API adapters and jobs consume the synchronous reader. Its migration
therefore includes a complete consumer inventory, rather than changing only
the environment parser. The existing [version-1 contract](classroom-experience-admission.md#configuration-and-authorization)
and its malformed/empty/duplicate/100/101 identity tests remain supported.

## Proposed registry contract

These are logical requirements, not applied SQL or a reserved migration number:

- A unique local user UUID admission row records its immutable origin batch,
  policy/contract revision and admitted timestamp. It stores no email, global
  role, classroom content, payment secret or duplicated membership permissions.
- An approved batch records an opaque approval reference, exact manifest digest,
  expected predecessor revision and committed counts. An operator commits the
  complete reviewed set atomically and idempotently; incomplete or stale batches
  refuse without partial grants. Retrying a committed operation returns the
  same result, rather than adding a second batch or consuming allowance.
- One service-owned policy revision controls **new grants**. A transactional
  growth stop wins against concurrent batch admission; already committed grants
  remain admitted. A failed read/write never causes implicit admission or a
  successful empty result. No browser table/RPC administration or client-provided
  role/plan/metadata claim can grant access. Follow the existing schema ACL and
  service-role rules without an auth/RLS architecture rewrite.
- Import exactly the current 70 as an immutable bootstrap origin. The private
  import manifest must match both current live lists, the accepted value digest
  and canonical identities. A grant cannot disappear because a subscription
  changes, a batch ends or a classroom membership is removed. Membership removal
  still removes classroom access through the existing relationship rules.
- Protected exclusions bind canonical local UUIDs in the private rollout packet,
  never names, email domains or historical teacher/student labels. Known excluded
  accounts stay outside new batches. An
  exclusion must not silently eject any of the retained 70. Blocking a person
  across unrelated alternate identities is not established by an account-UUID
  exclusion; no new identity matching or security-ban policy is authorized here.

Use an indexed, typed service-only point read for an authenticated actor's
admission decision. Resolve it once per request and share that validated result
across Home, page, join/create and contextual adapters. Initially use request
memoization only, with no new dependency or cross-request positive/negative cache.
Jobs obtain identities from their already-authorized target rows, not request
parameters. Membership, ownership, archive and resource checks still run at the
data/transaction boundary; a cached admission answer is not relationship evidence.

### Version and Home transition

Introduce an explicitly versioned registry-source configuration understood by
all consumers. Exact syntax and SQL/RPC names are implementation review inputs;
unknown versions and unavailable/malformed registry decisions must return the
existing bounded error/503 behavior, with no fallback to version 1 or global-role
authorization. Version 1 remains unchanged while the new source is inactive.

In registry mode, Home's existing enabled switch remains a composition switch,
but Home and experience admission use the same validated registry decision.
The old Home list is retained as bootstrap/recovery evidence, not a second
editable authority or a condition that strands the 101st admitted account.
Independent page/pair gates remain absent. A missing required Home read remains
an error, not an empty or legacy success.

### Preserve provider semantics before widening

Before registry activation, separate the Bara protocol-compatibility predicate
from general classroom admission. Preserve its current exact decision set using
the immutable 70-account bootstrap origin for both worker owner identities and
learner scan-generation identities. A later classroom batch must not implicitly
enter that protocol set. This is a narrow compatibility boundary for an existing
selector, not a new attendance entitlement or general provider rollout system.
Existing attendance entitlement, classroom mapping, membership/generation and
database-lock authorization still follow protocol selection; deactivation keeps
its current expiry path. Any future change to that compatibility set needs its
own provider readiness and authority.

Verify equivalence for the retained 70 **and currently nonadmitted users**,
including the worker and learner paths. Preserve current behavior in both sets;
do not switch outside users to a different provider route or weaken identity
checks while refactoring. A candidate requiring newly enabled native/provider
behavior is outside the first expansion scope until separately qualified and
approved. Do not disable existing integrations to make a candidate look inert.

Pal, AI, RepoLight, email and billing switches/connections/egress remain under
their existing controls and holds. Admission must not create connections,
enqueue backfills, trigger jobs or call a provider. PPZ remains Tests/native off,
with no native policy/mapping, expected absent pointers and manual `log` mode.

## Rollout scope and sequence

The planning endpoint is verified existing and new Pika users accessing the
same relationship-based classroom experience, subject to explicit exclusions
and independent capabilities. It is not blanket activation now. No additional
user IDs, live class selection or future account counts have been inventoried or
approved by this proposal. Each batch must qualify the actor's **account-wide**
owned/joined/archived relationships, not just the selected classroom.

| Stage | Proposed scope | Gate before advancing |
| --- | --- | --- |
| 0 — Preserve current installation | Existing 70 only; prepare inactive code/schema and migration/import tooling. | Complete consumer inventory; protocol-equivalence design; isolated SQL/ACL/concurrency/types and adapter/UI checks; independent review and CI. Current production/configuration unchanged. |
| 1 — Import and compare | Exact 70 registry rows, growth stopped; version 1 still authoritative. | Separate exact migration/target and import approval, fresh private manifest, transactional preservation, read-only decision comparison with no routing/provider effects. No grant-on-read. |
| 2 — Registry reads for retained cohort | Same 70 only, same provider behavior; Home/API share one source. | Separately approved compatible release/configuration cutover; all consumers version-aware; equivalent positive and negative decisions; retained-cohort canaries and one fixed 30-minute observation outside teaching. |
| 3 — First wider existing-user batch | Recommend one additional owner and one exact selected roster, with a planning ceiling of 30 new accounts. No new joiners yet; total at most 100 for this first batch, although the registry is tested beyond 100. | Actual private inventory may yield no eligible batch. Select an exact provider-compatible scope, preserve exclusions/plans, review full account-wide interactions and obtain separate batch approval. Larger rosters require an explicit revised scope, not silent truncation or automatic inclusion. |
| 4 — Further existing users | Repeat approved, bounded owner/roster batches beyond the pilot cap. | Current source/provider applicability, exact transaction/preservation readbacks and representative canaries per changed interaction. Reuse accepted unchanged proofs; no per-person login requirement or repeated full domain rehearsals solely for timestamps. |
| 5 — New-account/new-joiner policy | A separately approved verified-signup rule and class-join policy; initially off. | Normal verified identity/local UUID mapping and existing default-plan provisioning, atomic idempotent admission under an active policy revision, abuse/identity boundaries, failed-join behavior and provider implications verified before enabling. |

The first-batch ceiling is a proposal for limiting impact, not an approved list
or a new permanent capacity limit. Existing known exclusions are not candidates
by default. Future teaching windows, exact manifests, source/deployment and
observation start/end are chosen only after real readiness and coordination.

For stage 5, recommend admitting a newly verified identity through an explicit
server-side signup-completion operation only after the policy is approved. The
ordinary admission reader remains read-only. The grant permits a neutral Home
and code-join entry, not a classroom membership or Create. Existing atomic join
policy still checks roster/open/closed status, code limits and revocation; a
failed join grants no relationship. Immediate rejoining after owner removal
remains the existing deferred policy change, not a rollout requirement. A policy
revision must define whether existing unadmitted accounts enter via a reviewed
batch or a separately approved rule; login alone never silently imports them.

Automatic signup admission must not imply permission to join previously held
provider profiles. Before that stage, explicitly qualify all reachable joins
and native/provider transitions under the unchanged holds. If this cannot be
done, keep automatic signup/new-joiner activation off while approved existing
accounts continue working. Do not relabel plans, charge users or enable billing
to implement an admission rule.

## Verification, recovery and authority

Required implementation evidence includes:

- Version-1 regression compatibility and exact bootstrap equivalence; indexed
  registry behavior with 100, 101 and larger finite fixture populations; unique
  canonical identities, exact batch counts and no truncated global list reads.
- Service-only ACLs; no browser or spoofed actor admission; concurrent duplicate
  grants, overlapping batches, policy-revision conflicts and stop-growth versus
  commit races; failed/unknown transaction outcomes reconciled before retry.
- A complete consumer migration: no Promise-truthiness mistakes or forgotten
  synchronous paths; unavailable registry/configuration fails closed, with Home
  error states and no legacy authorization fallback. Request-only memoization
  must not turn relation or admission changes into stale cross-request rights.
- Home/API/page/join/create/image/visibility agreement and retained relationship,
  archive, revocation, resource-binding and creation entitlement/idempotency
  tests. Preserve the existing verification matrix for affected UI behavior.
- Provider-selector equivalence, including nonadmitted users, deactivation and
  no unintended job/queue/network activity. Mocks do not establish live-provider
  readiness and do not release a provider hold.
- Fresh cohort/plan/relationship and selected-work preservation checks, suitable
  real signed-in canaries, a bounded timed observer with seven receipts and
  lateness/gap limits, then a final receipt and explicit coordination release.

Record a new minimum compatible recovery build before registry reads activate.
It must understand registry-source configuration, retained grants and the
unchanged provider boundaries. The present version-1-only runtime cannot serve
as a general rollback after registry-only users are admitted. Do not restore the
old 70-ID payload, remove the Home switch or delete admission rows to stop growth.
An admission-store outage may fail closed; recover its service or a compatible
build rather than silently sending existing users into legacy authorization.

Stop **new grants** on an unexpected authorization/privacy failure, lost work,
identity/manifest mismatch, unqualified provider effect or incompatible recovery
state. Freeze the admission writer/policy at its actual committed revision,
preserve already admitted users/data/routing and investigate. Security revocation
or account deletion remains a separate explicitly authorized operation. No
automatic rollback, destructive cleanup or observer renewal is proposed.

The owner still needs to approve implementation scope, any exact migration/import
and compatible production cutover, the first concrete wider batch, and eventually
the automatic new-user policy. Preparing or merging this plan supplies none of
those permissions. Billing/subscriptions, broad role cleanup, retention, provider
activation and the paused tool-backed goal/DeepSeek remain separate and unchanged.
