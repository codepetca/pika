# Classroom access and entitlements

Status: approved direction; phase 0 merged in PR #1170. The owner approved main-only
landing of observation #1172, [classroom-core #1174](classroom-core-contextual-access.md)
and [calendar writes #1175](contextual-calendar-writes.md), in that order after
synchronization, integration review and fresh CI. Their PR records contain the exact
landing SHAs and checks. These implemented backend slices remain off by default;
hosted parity is unmeasured and the reachable mixed-role domain is incomplete.
The [enrollment foundation](contextual-enrollment-access.md) begins batch C with a guarded,
disabled-by-default join-route adopter. It does not enable a cohort or make the Owned/Joined
home available.
See the [compatibility inventory and runbook](classroom-access-compatibility.md).
This is not approval for production rollout, neutral onboarding or monetization enforcement.

## Product direction

Pika authenticates a person once. Teaching and learning are relationships to a classroom,
not permanent account types. The same person can own one classroom and join another.
Creating a classroom makes that person its owner; joining with a valid code creates a
member relationship, never ownership. Do not ask users to choose a permanent teacher or
student role during signup.

Classroom creation is a product capability: initially preserve today's teacher-only
behavior, then separately approve opening it to authenticated accounts. Later eligibility
can depend on plan, trial, an explicit grant, and limits without changing classroom roles.
An invitation code grants only the ability to request enrollment under the classroom's
join policy. Closed enrollment and roster-only restrictions remain meaningful.

### Monetization strategy

The [subscription policy](subscription-policy.md) is canonical for automated
tier assignment and prorated upgrades. It distinguishes agreed product rules
from provisional AI quantities and remaining launch prerequisites. This roadmap
continues to own classroom limits, role separation, and phased rollout.

- Start teacher-first: Free accounts can join and complete assigned work without buying a
  plan, but cannot create a classroom. Classroom capabilities are funded by the owner,
  not by each student's plan.
- The original **Access** capability (one active owned classroom) was an initial
  rollout grant, not the eventual subscription model. The approved account-plan
  direction is Free, Basic, Pro and Max; no account is a permanent teacher or
  student based on its plan.
- Charge for demonstrated teacher value: advanced workflows and higher allowances for
  expensive features such as AI grading. Launch prices and core features are approved
  in the subscription policy;
  candidate AI quantities still require measured delivery-cost validation.
- Model trial/active/expired/canceled/grace states separately from plan names. An
  "expired free plan" should normally mean an expired trial or promotional grant; a
  baseline Free tier need not expire. Cancellation need not imply immediate expiry.
- Expiry must not change ownership, delete classwork, or make students purchase access.
  Preserve access to existing work and a workable submission path. Restrict paid/new
  consumption rather than abruptly interrupting an active class. The approved
  subscription policy now defines grace periods,
  over-limit automatic archiving and existing-work protections; enforcement still
  requires implementation and verification. This is not a promise of indefinite
  free storage.
- Manual/school-sponsored grants can fit the same capability contract later. Defer school
  sales, organization administration, co-teachers, and a general billing framework.

### Account-plan classroom limits

Approved launch limits are below. Migration 206 introduced the original fixed
plan assignment; legacy `pro` (now marketed as Max) has a current limit of 10,
not Max's new launch limit of 12. Legacy `plus` maps to the new Pro product.
A future version-aware implementation must apply the new terms without rewriting
historical migrations or existing purchases:

| Account plan | Active owned classrooms | Tests per classroom | Other agreed direction |
| --- | ---: | ---: | --- |
| Free | 0 | 0 new | May join classrooms; preserve existing work |
| Basic | 2 | 20 | Core teaching tools; no included AI grading |
| Pro | 5 | 50 | Candidate 300 AI grading runs/month; validate costs |
| Max | 12 | 100 | Candidate 1,000 AI grading runs/month; validate costs |

The owner approved Test limits on 2026-10-07. SUB-16 in the subscription policy
defines counting, over-limit preservation and immutable paid-offering terms.
These numbers are not yet live. Implement a disabled database insertion/movement
guard first, verify exact-boundary and concurrency behavior, then integrate
creation/import error handling and the contextual proof catalog before activation.
Do not treat a smaller Test allowance as proof that grandfathered over-limit
classrooms satisfy the pending atomic reorder capacity gate.

Applying migration 206 alone does not classify existing accounts, change their
effective grants, activate strict enforcement, charge anyone, or enable AI
metering. Plan assignment is service-only and derives the classroom limit; the
operator does not enter a per-user classroom quota. A separate, reviewed rollout
must reconcile existing accounts (including current owner classes), replace the
Access pilot assignments, and verify snapshots before any UI or billing change.
The [account-plan rollout runbook](account-plan-rollout.md) defines the
read-only inventory, separately approved account batches and later strict
activation without using the old Access/Free mapping as a plan default.
Current assignment code does not archive existing classrooms; it blocks further
creation/restore at the lower limit. The newly approved launch policy instead
keeps the teacher-selected classrooms, or those with most recent activity if no
selection was made, and archives the rest at downgrade. This needs new integration
that preserves existing assignments, started tests, grading and exports, and
prevents subscription archiving from triggering deletion. See SUB-05/SUB-12.
Pricing, 30-day Pro trials, grace and cancellation are now decided in the
subscription policy; AI quantities remain provisional pending cost validation.

#### Superseded Access-pilot policy

The table below records the original entitlement cutover. It is not the target
subscription policy above.

| Tier/state | Join classrooms | Create active classrooms | Initial provisioning |
| --- | --- | --- | --- |
| Free | Yes | No | Default future public baseline |
| Access | Yes | Up to 1 | Manual grant during initial development |
| Trial | Yes | Defined by its grant | Separate, time-limited overlay; at most one trial period per account when implemented |
| Plus / Pro | Yes | Not offered in this pilot | Deferred beyond the initial Access grant |

The one-trial-per-account ledger, billing synchronization, upgrade purchase flow and
Plus/Pro limits were not part of the original Access enforcement slice. Their
approved launch limits are now defined above; pricing is in the subscription
policy and AI quantities remain provisional. The following describes only the
superseded pilot behavior, not the new downgrade policy. An archived classroom
did not consume Access capacity.
Downgrade or expiry never deletes, archives, or changes ownership of existing
classrooms; it blocks new active-classroom consumption.

## Four separate decisions

| Layer | Question | Authority |
| --- | --- | --- |
| Identity | Who is signed in? | Valid server-backed session and current user |
| Classroom relationship | What may they do in this class? | Owner/enrollment records and lifecycle state |
| Feature entitlement | Is this capability available, in what quantity, until when? | Server-resolved effective grant for the feature's sponsor |
| Operational/resource rules | Is this specific operation currently valid? | Resource/classroom binding, release/visibility, enrollment policy, rollout gates, deadlines |

All applicable checks must pass on the server. A paid plan cannot grant ownership or
access to another class. UI visibility is a convenience, never enforcement. An owner
with an expired AI allowance is still the owner; ordinary access does not consult that
allowance. Domain-specific checks remain necessary after a base classroom permission.

Use feature keys (`classrooms.create`, `grading.ai` initially), not scattered checks such
as `plan === 'pro'`. A future server resolver maps approved product plans/grants into
effective capabilities. The initial evaluator consumes **one already-resolved snapshot**;
it does not resolve competing grants or trust a request's asserted plan/source.

## Current implementation and compatibility constraints

- `users.role` still has teacher/student values and drives live guards, routing and other
  behavior. Signup still derives a role from the existing policy. Do not remove or relax
  these contracts in phase 0.
- Current sessions use an opaque cookie token backed by `auth_sessions`; identity/role
  are loaded server-side. Do not reintroduce role or plan authority in a client cookie.
- `classrooms.teacher_id` already represents the owner, and
  `classroom_enrollments.student_id` represents membership. Keep these columns and
  existing route names initially; no new membership table is required for one owner.
- Existing classroom creation is teacher-gated. Joining is student-gated and supports
  roster/open-join policy, enrollment enablement, and profile/roster side effects.
- `attendance_teacher_entitlements` is a separate, attendance-specific rollout facility,
  not a general subscription system. Leave its checks and data unchanged.
- Archived owner access and member access have different rules. Archive/restore,
  managed storage, grading, exports, attendance, public sites, blueprints and background
  jobs each need their own migration audit. Replacing a top-level role check is not enough.

## Phases and release gates

| Phase | Bounded work | Exit gate / relative complexity |
| --- | --- | --- |
| 0 — Dormant contracts (merged #1170) | Roadmap; read-only relationship resolver; pure permission and effective-entitlement decisions; legacy creation policy; tests. No live consumers at phase 0. | Existing behavior unchanged, no schema changes, static/test gates and independent review. Small implementation, security-sensitive contracts. |
| 1 — Compatibility adapters | Inventory live role checks by domain; define trusted entitlement loading and failure policy; add legacy grants/administrative override only as needed. Run sampled shadow decisions while legacy authorization remains authoritative. | No new grants to users, no changed denials, measured parity and explained differences. Moderate. |
| 2 — Contextual backend and UI readiness | Migrate one complete vertical domain at a time, beginning with classroom read/manage. Then enrollments, work/submissions, grading, attendance, files, exports, archive/restore and non-classroom teacher features. Build a combined Owned/Joined home and classroom-context navigation behind an off-by-default rollout. | Cross-role and cross-tenant tests; all routes/jobs/resources reachable by the pilot support mixed relationships. No public neutral onboarding yet. High: broad existing assumptions. |
| 3 — Create/join onboarding pilot | Enable neutral onboarding for a controlled cohort only after phase 2 coverage. Keep current authentication. Separately approve creation eligibility; implement server policy/limits. Join by code/link respects roster/open-join/closed state. | Teacher and student production canaries plus mixed-role account; no owner/member escalation; rollback-compatible release floor. Moderate UI, high rollout sensitivity. |
| 4 — Paid offering | Decide feature matrix, trial/downgrade rules and prices; implement billing-to-entitlement synchronization, atomic metering and upgrade UI. Start enforcement with a controlled cohort and existing-class protection. | Webhook/idempotency/reconciliation, expiry/cancellation/grace tests, quota races, recovery, cost measurements and support procedure verified. Separate high-risk project. |
| 5 — Cleanup and expansion | Retire obsolete global role dependencies only after a complete usage audit; consider Pro/schools/co-teachers when justified. | No live consumers of the old contract and a deliberately revised rollback plan. Deferred. |

Phases 1–2 may ship as several small PRs while existing classes remain on legacy
behavior. The entitlement **separation** comes before new onboarding; a full payment
integration does not. Do not bundle signup, route authorization, schema changes and
billing into one release. The broad route/UI migration is the largest complexity, not
the basic owner/member lookup. Calendar estimates require the phase 1 inventory and
actual integration findings; this roadmap is not a delivery-date commitment.

### Phase 0 code contract

- `src/lib/server/classroom-access.ts` resolves only owner/member/none plus archive
  state using narrow, user-and-classroom-scoped reads. It is not authentication or
  authorization. Missing class returns null; failed/malformed reads reject. Callers must
  authenticate first and must not disclose the context before authorizing access.
- `src/lib/access/classroom-policy.ts` defines coarse read/manage/participate permission.
  Owners can read archived classes but not ordinarily mutate them; restore is a future
  separately reviewed lifecycle capability. Members access only active enrolled classes.
- `src/lib/access/feature-entitlements.ts` validates effective snapshot shape, sponsor,
  feature, enabled state, validity interval and requested quota units. Exact expiry denies.
  The grading composition requires active-owner management permission AND the owner's
  entitlement. Its legacy creation adapter preserves teacher-only creation.
- Phase 0 added no live imports. Phase 1 adds off-by-default, non-authoritative
  observers to existing classroom helpers and ordinary creation. The phase 2 core
  slices separately gate six classroom-core handlers plus four calendar-write handlers.
  Migration 152 adds two service-only calendar RPCs, verified locally with separate exact
  permission; hosted application remains unapproved. Other guards stay legacy. UI,
  sessions, attendance entitlements, dependencies, signup and payment providers remain unchanged.
- The enrollment foundation preserves the legacy student path when disabled and defines
  fail-closed exact-pair/admission decisions. Migration 159 provides the service-only atomic
  write and private actor/actor-invitation windows; forward migration 161 provides the
  service-only rejected-guess adopter. Together they have rollback/concurrency harnesses.
  The guarded join route now adopts those contracts only for an exact configured pair; its
  flag remains unset. Migration 159 is already deployed and its source remains fixed to that
  deployed definition; migration 161 requires separate target-specific application
  authorization. No cohort or production configuration changed, so
  every current production request remains on the legacy join path.
- The contextual classroom home backend exposes a new authenticated `owned` / `joined`
  summary only for an exact server-configured user cohort. It is off by default and has no
  live page consumer, so `/classrooms`, global-role routing and current users remain unchanged.
  It fails closed on either source or malformed relationship evidence and gives ownership
  precedence over historical self-enrollment. See
  [the home backend contract](contextual-classroom-home.md).
- Classroom SSR routing/navigation has a separate dormant exact-pair gate. Admitted
  relationships select the existing owner/member experience while the authenticated
  session role remains unchanged. It is intentionally independent from the classroom-core
  API gate and must not be enabled until every downstream surface reachable from that
  experience is compatible. See the
  [UI change record](ui/changes/contextual-classroom-page-routing.md).
- Classroom announcement list reads have their own dormant exact-pair gate. It lets a
  student-valued owner use the owner projection and a teacher-valued member use the
  published member projection while validating every returned classroom binding.
  Publishing/editing/deleting and member read receipts remain legacy mutations pending
  transaction-time relationship checks, so this does not make the announcement tab or
  classroom page rollout-ready. See
  [the announcement read contract](contextual-classroom-announcement-reads.md).
- Classroom lesson-plan list reads have a separate dormant exact-pair gate. It lets a
  student-valued owner use the owner calendar projection and a teacher-valued active
  member use the visibility-limited member projection, while binding both returned
  plans and the visibility record to the requested classroom. Date, bulk and copy
  writes remain legacy pending transaction-time relationship checks, so the calendar
  and page gates must remain disabled. See
  [the lesson-plan read contract](contextual-classroom-lesson-plan-reads.md).
- Classroom material list reads have another dormant exact-pair gate. It lets a
  student-valued owner receive the owner projection, including drafts, and a
  teacher-valued active member receive only published materials. Every returned
  material is bound to the requested classroom, including after the legacy ordering
  fallback. Create/edit/delete remain legacy pending transaction-time relationship
  and resource checks. See
  [the material read contract](contextual-classroom-material-reads.md).
- Classroom assignment list reads have a separate dormant exact-pair gate. It lets a
  student-valued owner receive drafts plus roster-scoped statistics and lets a
  teacher-valued active member receive only live assignments and their own sanitized
  document. Assignment, roster, statistics, requirement and member-document evidence
  is bound before use. All assignment writes, grading and submission flows remain
  legacy. See
  [the assignment read contract](contextual-classroom-assignment-reads.md).
- The owner aggregate and individual student-work assignment-detail reads share a
  dormant exact user/assignment gate. They let a student-valued owner inspect the
  existing roster, submission summary and one enrolled student's work while
  validating assignment/classroom, roster, profile, document, feedback, requirement,
  artifact, repository-target, repository-review, history and grading-run bindings.
  The learner assignment-document GET now has its own dormant exact user/assignment
  gate. A matched teacher- or student-valued active member opens only their own document
  through the migration 182 transaction; the route binds the returned document,
  feedback, requirements, artifacts and GitHub identity before responding and preserves
  immediate Pal delivery. Disabled and unmatched requests remain on the legacy path.
  Learner autosave/PATCH now has a second independent exact-pair gate and migrations 184–185
  transaction. A matched teacher- or student-valued active member can save only their own
  document while live enrollment and assignment visibility are locked; revision, history
  and metric behavior stays delegated to the established atomic save. Disabled and
  unmatched requests remain legacy. Submit and unsubmit now have a third independent
  exact-pair gate backed by migrations 186–187; its preflight and mutation independently
  recheck the same live enrollment and visibility rules under the shared document and
  membership fences before any evidence or write is returned. History reads and restores
  now share a fourth dormant exact-pair gate and migrations 188–189. A matched owner can read
  one current enrollee's history regardless of global role; a matched member can read and
  restore only their own live-assignment history. Restore independently rechecks current
  membership, visibility, document revision and the exact history target under the shared
  fences. Artifact add, replace and delete now have a fifth independent exact-pair gate
  and migration 190. A matched teacher- or student-valued active member can mutate only
  their own exact requirement/document binding; image attachment rechecks membership after
  upload and binds the managed object to database-derived classroom, subject and document
  evidence. Existing-assignment owner edit, release, delete and pristine-draft discard now
  have a sixth independent exact-pair gate and migration 191. A matched teacher- or
  student-valued current owner is authorized under the shared assignment/classroom lock
  order, with allowed update keys, release state, archive state and ownership rechecked in
  the mutation transaction. Classwork creation now has a seventh independent exact
  user/Classroom gate and migrations 192–193. A matched teacher- or student-valued current
  owner is rechecked under the shared Classroom-operation fence before an Assignment,
  material or survey and its mixed-classwork position are inserted atomically; Assignment
  requirements are included in that transaction. Bulk flows remain legacy.
  Manual Assignment grading now has an eighth independent exact user/Assignment
  gate and migrations 194–195. Matched teacher- or student-valued current owners are rechecked
  under the established grading then Classroom-operation fences before the existing atomic
  grade save runs. Feedback-only and selected-student return now share a ninth independent
  exact user/Assignment gate and migration 196. Matched teacher- or student-valued current
  owners are rechecked under the established feedback-return then Classroom-operation and
  learner-purge fences before the existing atomic return operations run. Assignment-only
  and mixed-classwork ordering now share a tenth independent exact user/Classroom gate and
  migration 197. Matched teacher- or student-valued current owners are rechecked under the
  shared Classroom-operation fence before the established ordering functions run, so
  contextual classwork creation and ordering serialize. The markdown Assignment bulk editor
  now has an eleventh independent exact user/Classroom gate and migrations 198–199. Matched
  teacher- or student-valued current owners are rechecked under canonically ordered Assignment
  fences and the shared Classroom-operation fence before the complete create/update/release/
  position batch commits atomically. Owner repository-target selection now has a twelfth
  independent exact user/Assignment gate and migration 200. A matched teacher- or
  student-valued current owner is rechecked under the Assignment submission,
  Classroom-operation and target learner purge fences before saving or resetting an enrolled
  learner's repository target. Read-only ownership/enrollment preflight happens before the
  external GitHub validation call, and the transaction rechecks authority afterward.
  Repository analysis and AI grading remain legacy. All twelve gates must therefore stay
  disabled.
  See [the assignment detail contract](contextual-classroom-assignment-detail-reads.md).
  See also [the learner assignment-open contract](contextual-assignment-doc-open.md).
  See also [the learner assignment-save contract](contextual-assignment-doc-save.md).
  See also [the learner assignment-submission contract](contextual-assignment-doc-submission.md).
  See also [the learner assignment-history contract](contextual-assignment-doc-history.md).
  See also [the learner assignment-artifact contract](contextual-assignment-artifacts.md).
  See also [the owner assignment-mutation contract](contextual-assignment-owner-mutations.md).
  See also [the Assignment creation contract](contextual-assignment-creation.md).
  See also [the manual Assignment grading contract](contextual-assignment-grading.md).
  See also [the Assignment feedback-return contract](contextual-assignment-feedback-return.md).
  See also [the classwork reorder contract](contextual-classwork-reorder.md).
  See also [the Assignment bulk contract](contextual-assignment-bulk.md).
  See also [the Assignment repository-target contract](contextual-assignment-repo-target.md).
- A pure quota check is not a reservation. Do not wire it to paid/expensive work until a
  transactional, idempotent reservation/settlement design prevents concurrent overspend.
  Mutations also need transaction-time ownership/archive/resource checks to avoid races
  between the read-only resolver and the write.
- Migration 201 adds that dormant reservation foundation for the shared `grading.ai`
  entitlement bucket. Assignment AI grading, Test AI grading and repository review have
  distinct operation kinds for reporting, while reserve/settle/release serialize against one
  subject/feature bucket and reject idempotency conflicts or concurrent overspend.
  No route uses the ledger yet, and no price, allowance, billing period or grant is inferred.
  Joining Classrooms and completing assigned student work remain free and unmetered. See
  [the metered usage contract](metered-feature-usage-reservations.md).
- Migration 202 adds the first AI-grading integration prerequisite without activating
  metering: a versioned Assignment-worker contract. Existing runs remain version 0 for
  rolling compatibility; future metered runs opt into version 1, where every run/item
  mutation and grade finalization is bound to the exact current, unexpired lease and legacy
  service-role paths are rejected.
- Migration 203 adds the dormant Assignment reservation boundary. A future gated
  coordinator can atomically admit a version-1 run at one unit per queued student item,
  settle the unit with grade/provenance finalization, or release it with terminal item/run
  failure. Skipped missing/empty work costs zero, retries reuse the item reservation, quota
  admission is all-or-nothing, and quota remains consumed across entitlement metadata
  revisions. No application route calls these RPCs yet, so current behavior remains
  version-0 and unmetered.
- Migration 166 authors the first database-resolved effective-entitlement snapshot and an
  atomic `classrooms.create` active-count guard. Missing snapshots preserve legacy behavior;
  no account is seeded or cut over. Ordinary inserts, Blueprint instantiation, reactivation
  and ownership transfer share the database guard. Forward migration 167 makes ordinary
  creation retries replay one stored classroom instead of consuming capacity twice.
- Migration 181 is the separately controlled Free-provisioning and fail-closed cutover
  slice. After activation it gives future accounts an audited Free snapshot transactionally;
  before activation it leaves existing and newly created unmanaged accounts compatible.
  Strict activation is permitted only after every current account has an explicit snapshot.
  Source landing does not authorize applying it or
  classifying/activating any environment. The exact two-release procedure and canaries are
  in the [classroom creation entitlement cutover runbook](classroom-creation-entitlement-cutover.md).

## Safe rollout while real classes continue

### Completion sequence — 2026-09-27

The owner requested the full rollout and orchestration of the remaining work.
PR #1371 is merged and its image boundary passed independent review, focused
checks, database races and CI. A fresh source audit confirms that the live home
still uses global account roles, and the ordinary classroom shell exposes
unmigrated Tests, Surveys, Daily, Grades and owner mutations. The full rollout
therefore requires the remaining integrations below; enabling the existing page
gate alone is not sufficient. Preserve the current classroom UI and functionality.
Do not substitute an Assignment-only product for this goal.

The immediate integration checkpoint is a real local manual Assignment lifecycle
rehearsal using synthetic mixed-role identities. The first run exposed an
owner-precedence defect: an admitted owner with historical self-enrollment can
open a learner document (200 rather than 403). PR #1376 corrected the learner
transaction boundaries and passed all seven real route/database scenarios,
the database contract suite and browser CI before merging as `7758ed44`.
Migration 214 is applied and catalog-verified in production. The separately
authorized local reset/reseed on 2026-09-27 resolved the billing numbering collision;
local history now matches main through 217, with 214 retaining owner precedence
and billing using 215–217. Do not reuse the superseded history-repair proposal.
The remaining full-experience work follows these five batches:

| Batch | Scope | Exit evidence |
| --- | --- | --- |
| 1. Shared access and everyday classroom work | One server-owned complete-experience admission contract; Daily, lesson plans, announcements, materials and roster | Both account-role values can perform their actual owner/member operations; resource binding, archive/removal races, revision semantics and Pal atomicity remain enforced |
| 2. Assessments and grades | Existing Assignment adapters, Tests, Surveys, Gradebook/Grades and their files/history; preserve current grading entrypoints | Create/release/start/save/submit/inspect/grade/return/results work through existing screens, including cross-role identities and denied cross-class access |
| 3. Lifecycle and attached services | Archive/restore, reorder/reuse/blueprints, recovery/export/purge boundaries, attendance and Pal/Bara adapters | Existing owner operations and jobs remain tenant-bound; creation/restore retain entitlement enforcement; connected services use the current classroom relationship |
| 4. Product entry and navigation | Approved Teaching/Joined home, classroom page/shell, shared menu, join/create, ordering and persisted hide/unhide | One account teaches A and joins B; owner archive differs from member hide; Hidden appears below Archived; desktop/mobile light/dark verification passes |
| 5. Integrated release | Full teacher/student/mixed-role rehearsal, production canaries, compatible release floor and stop-new-admission procedure | Complete reachable experience works, including existing classes, with concrete recovery evidence before cohort activation |

Batch 2 consumes the shared contract from batch 1. Batch 3 may be implemented
independently once that contract is stable. Batch 4 remains dormant until batches
1–3 are complete. Batch 5 verifies their integrated result. Each implementation
batch may contain bounded reviewable PRs; do not add unrelated infrastructure or
a new per-feature rollout switch for each route family.

### Owner-approved completion strategy — 2026-10-09

The owner approved keeping the existing architecture and simplifying delivery,
then requested updating this goal and orchestrating the remaining work. This is
the current execution plan; older checkpoint labels below remain historical.

**Goal:** complete a production-safe classroom experience in which one signed-in
person can teach Classroom A and join Classroom B. Classroom ownership/membership
controls access; server-resolved subscription capabilities independently control
creation and paid consumption. Free members can complete assigned work. Preserve
existing classes, work, grading and privacy throughout the cutover. Keep the
current server/session and service-role architecture; no auth/RLS rewrite.

The target baseline is main `763edbb180f32a32c0584add894d79415bbb9945` (#1550).
Batch 1's backend exit remains recorded. Member Test list preparation #1534 was
delivered through #1541 (`1dd532581`); owner atomic Test reorder preparation #1515
was delivered through #1543 (`e24d591ab`). Both original drafts are closed as
delivered, not separately merged. #1543's merge tree equals reviewed head
`e68198ede7409912dbccf7c574de2b1514c9160f`; its six finite native modes and
exact-head CI `37865407019` passed. Do not repeat that accepted work. These are
component receipts, not a batch-2 exit or feature activation.

| Remaining batch | Deliver complete workflows | Acceptance before advancing |
| --- | --- | --- |
| 2 — Assessments and grades (current) | Finish Test owner authoring and learner participation/disclosure, then Surveys and Gradebook/returned Grades; integrate existing Assignment and grading-entrypoint authorization | Through existing screens, mixed-role accounts can author/release/start/save/submit/inspect/manual-grade/return/read results; nonmembers and cross-class substitutions are denied; current visibility, archive and revocation rules hold |
| 3 — Lifecycle and attached services | Complete remaining archive/restore, reuse/blueprint, export/recovery/purge and attendance/Pal/Bara relationship boundaries | Preserve existing work and tenant isolation; creation/restore retain entitlement enforcement; jobs and services bind the actual classroom relationship |
| 4 — Product entry and navigation | Connect the approved Teaching/Joined reference, classroom shell, shared menu, join/create, ordering and persisted hide/unhide | One account teaches A and joins B; owner archive differs from member hide; Hidden appears below Archived; teacher/student/mixed-role desktop/mobile light/dark verification passes |
| 5 — Integrated release | Rehearse the whole reachable experience, verify a compatible recovery release, then prepare a controlled canary and expansion | Existing and mixed-role classes work end to end; concrete stop/recovery evidence and exact authorized migration/release/configuration receipts precede activation |

Deliver coherent, reviewable workflow groups, not a new PR for every helper or
endpoint. A complete workflow may still need more than one PR when its transaction
or integration boundary justifies it. Reuse existing relationship/admission,
transaction, validation and verification contracts; add schema only for a concrete
missing atomic boundary or persistence requirement. Do not invent a parallel
permission framework, per-route rollout flags or a new verification framework.
Use focused regression checks during iteration and risk-matched independent
review once per stable cumulative scope, followed by targeted remediation review.
Reuse valid unchanged evidence; retain necessary real database/concurrency proof,
visual verification, final-SHA CI and PR Gate. Do not weaken safety gates to gain
speed. Integrate against a current frozen base before readiness, not repeatedly
recheck stale candidates. This changes delivery strategy, not correctness criteria.

The bounded Test workflow map is accepted against main `763edbb18`. One Sol/high
implementation worker now owns the coherent dormant owner group: metadata edits,
reference-document reservation/finalization/sync/readback/removal and selected
learner open/close access. Reuse existing atomic document/lifecycle transactions
and the migration-248 selected-access writer; no unlocked metadata-only write.
The coordinator owns this roadmap, integration, verification and Git/PR operations
on `codex/classroom-completion`; the worker owns only that subsystem's source/tests
and necessary additive schema source. No live/shared database writes are delegated.
Learner detail/start/save/submit/recovery/disclosure is the next dependent workflow;
its revision-conflict returns must authorize membership/visibility before disclosure.
Do not perform another architecture audit or revisit accepted reorder/list work.
Only concretely independent batch-3 work may run beside batch 2; batch 4's live
entry remains gated on completed batches 1–3. The coordinator owns integration,
phase exits, independent-review acceptance and normal authorized main merges.

Billing/subscription implementation remains separately owned and is not a reason
to expand this cutover into billing, AI/provider activation, analytics or general
infrastructure. Keep the approved tier/entitlement contracts and coordinate any
concrete existing-work compatibility dependency. Quota explanations remain only
on upgrade pages/tier summaries, never classroom/Test/create surfaces. Cold-archive
retention/email/deletion and final obsolete-role cleanup remain future work.

Existing exact-target migration and release holds are unchanged: canonical local
and production migrations 249+, quota enforcement, account/plan/provider changes,
admission/home/page/cohort/cutover activation and production promotion are not
authorized merely by this plan update. Prior separately authorized production
promotion #1549 does not activate the classroom experience. Routine in-scope
implementation, independent review/extensions and normal protected main merges
retain the owner's authority and cumulative clocks/counters. Preserve explicit
holds, including prototype #1217 and the separate privacy-audit priority.

The epic is complete only after all four remaining batch exits and the authorized
integrated cutover are evidenced. Merged dormant components, a prototype, billing
readiness or source-only tests alone are not goal completion. The stored app goal
cannot be rewritten/resumed by the available status-only goal tool; this roadmap
records the owner's superseding objective and execution strategy without replacing
the unfinished goal or falsely marking it complete.

Owner Test workflow source delivery is prepared on `codex/classroom-completion`.
The worker reported 167 affected checks; coordinator reran 93 across six affected
files and 29 focused post-reconcile checks successfully. Architecture passes.
Full source/type/native acceptance remains pending, not a phase exit. Main
`ff3685d3e` (#1552/#1553) was reconciled without changing its list-edit behavior,
return-to-draft transaction or UI byte guard. The original prepared migration 255
was renamed to `256_contextual_test_owner_workflow.sql` because main allocated
255 to return-to-draft; its SQL body is unchanged. Shared canonical local and
production remain untouched. Genuine generation of the new service-only RPC
signature requires a disposable full-chain replay through 256. The earlier
disposable-through-255 question is superseded, not reusable approval. No PR is
ready; independent review, actual native evidence and exact-head CI remain gates.

The owner approved one isolated replay of 001–256 from `1dc0891e7`. That attempt
failed at 256 with SQLSTATE 42601: an unparenthesized CASE operand in an IF
comparison was interpreted at its inner THEN. No new SQL contract, SDK or type
artifact was accepted. Exact disposable-resource teardown, full global Docker
closure and canonical row/control/cron baseline equality passed (21.251 seconds).
Private receipt: `/private/tmp/pika-owner-workflow-proof.ylCUiF/result.json`.
The coordinator parenthesized the CASE operands and added a failing-then-passing
regression (5/5); the existing ephemeral Database Contract lane now invokes the
same rollback SQL. This is a source correction, not a proven replay. The one-time
permission was consumed; corrected-source native verification needs fresh exact
approval. Shared local/prod, source readiness and activation holds remain intact.
Bounded independent correction review of `50016e316` found one additional blocker
in the rollback assertion, not an authorization change: JSON extraction must be
parenthesized before subtracting metadata fields. Coordinator corrected it with
a second RED→GREEN regression (6/6). Targeted correction review remains distinct
from full PR review/native acceptance; no replay was retried.

Superseding native receipt: after direct fresh approval, the one disposable replay
from `a1bcab47e` passed all 001–256 history and the rollback SQL/ACL contracts.
Real SDK Storage uploads, MIME/size finalization, signed byte readback, owner
transfer/archive/member invalidation, cancellation ordering, metadata/snapshot CAS,
HTML snapshot read/CSP and replacement cleanup passed (63 contained requests,
85.718 seconds). Exact disposable teardown/global Docker closure and full canonical
row/control/cron/resource equality passed. Receipt:
`/private/tmp/pika-owner-workflow-proof.NHXKxe/result.json`. External URL fetching
was not exercised; downstream snapshot handling used real local Storage bytes.
Genuine public types hash `6ccab478f97b0df7140e38e2f60b1f3ca4c6d8b50d7f5f36d35c56b994e362e9`
adds only the new RPC. Application refinement describes its native-proved nullable
inspect parent; it does not hand-edit generated types. Rebase onto `e405fbfab`
preserved all runtime/schema/rollback bytes and both source/main history bodies;
only incoming browser-CI partition and related guidance changed. Shared local and
production remain untouched; full independent PR review, stable CI and merge
remain pending. No phase exit or activation.

### Execution checkpoint — 2026-10-08

The owner requested orchestration of the remaining goal in this coordinator.
Frozen main `47659857d` contains owner Test publication #1510 (`473a5de8a`) and
the disabled Test-cap foundation #1524 (`50185559f`). Earlier pending-publication
receipts below are historical, not the current PR state. Neither merge completes
batch 2 or activates a classroom experience, database migration or quota.

Owner reorder #1515 remains draft at `9b1da5ac7`, with a numbering collision
against merged quota migration 253 and unresolved 10,000-Test capacity acceptance.
Its original failure receipts, limits and review counters remain intact. An owner
decision is pending between a smaller supported atomic reorder contract and a
separately reviewed inherited-trigger redesign; do not substitute the new plan
caps for grandfathered/unlimited or already-over-limit preservation evidence.

One independent batch-2 slice has source preparation on
`codex/contextual-test-member-list-read`: dormant member Test list GET. The app
writer owns the route/helper/validation/tests; a separate proof worker prepares
the finite installed-SDK fixture source. The coordinator owns guidance,
integration, review, PR lifecycle and acceptance. Every payload/child/terminal
page must bind current nonowner membership, active Classroom, Tests visibility
and fixed Test controls; preserve the legacy student DTO and unmatched dispatch.
Source preparation and mock tests are not actual SDK or phase-exit acceptance.
Do not expose the Tests tab while detail, participation, materials/history and
returned results remain incomplete.

Member-list #1534 is draft: initial two reviews identified one CI catalog-profile
defect, remediated with exact held248/post253 catalogs and no preservation
exclusions. Targeted review/native checks remain pending. A readonly pre-run check
found only local login-session/rate-limit drift from the prior private checkpoint;
preserve it and reconcile activity before native acceptance. No fixture has run.

Continue within batch 2: owner metadata/documents/participation/manual-grade and
return boundaries; member list/detail/recovery/start/save/submit/focus/results;
Surveys owner/member transactions; Gradebook/returned Grades; existing grading
entrypoint/job authorization without AI or billing activation. Use existing
transaction contracts where sufficient, rather than adding a switch per route.
Batch 3 advances only for concretely independent lifecycle/service work; batch 4
waits for complete batches 1–3; batch 5 rehearses the integrated experience before
any controlled cutover. The separate billing task retains subscription ownership.

Current owner restriction: quota counters, warnings, limit explanations and
upgrade prompts belong only on upgrade pages/tier summaries, not classroom or
Test/create surfaces. Friendly creation-error integration is deferred; this does
not authorize hidden/generic failures or enforcement activation. Canonical local
and production migrations 249 onward, production promotion, quota enforcement,
admission/home/page/cohort/cutover activation and account/billing/provider/runner
changes remain held. Routine in-scope work, independent review/extensions and
normal reviewed main merges retain existing authority and cumulative receipts.
The epic remains incomplete.

Current2026-10-03 checkpoint: batch1 exited after actual metadata1450 squash
`e86283f8` and all five exact-head CI37150788872 gates. Batch2's shared Assignment
write bridge1451 actually merged as3b62de062 after all five exact-head
CI37156761577 gates on reviewed9af304a0. Focused949 checks and real mounted
route/RPC normal plus two deterministic cleanup-failure proofs pass. Next
assessment reads bind every payload page to current authority/visibility.
Independent batch3 [retained group consumers](retained-roster-group-consumers.md)
prepare239 before a later coordinated grouped-removal invariant/writer.239 is
applied locally; actual rollbackSQL/SDK normal+forced baseline/types/two-session
locks pass. PR1452 remains draft after CI exposed a CURRENT receipt-prefix
contract failure; runtime SQL/SDK gates passed in that run.164 singleton and236
duplicate rejection remain. Full experience/cohort/UI/provider/billing activation
stays off, and historical preparation receipts below are retained.

The first bounded batch-1 implementation is the
[retained shared admission contract](classroom-experience-admission.md) and its
material-list read consumer. It uses one strict server-managed actor cohort;
current owner/member/resource checks remain authoritative. Absent configuration
preserves legacy/pair-pilot behavior. No live cohort is configured; writes, Daily,
other domains and product entry remain unfinished. Cohort retention and compatible
recovery versions are operator obligations, not guarantees of the stateless reader.

The next bounded implementation is [Daily Log POST/PATCH saves](contextual-daily-log-save.md).
The owner elected to continue the current server/session and service-role
architecture after comparison; a user-JWT RLS or restricted-credential redesign
is not part of this work. Migration 224 adds the transaction-time member boundary,
controlled by the same shared admission contract. It was resequenced from the
branch's original 218, then 223, after main allocated 218–223. Its SQL body is unchanged;
the earlier local verification is historical. The owner subsequently approved
221–223 locally, applied once on 2026-09-30; history and generated types match
through that branch's 223 and the function is present. Main subsequently assigned
223 to the assignment-grade conflict correction. On 2026-09-30 the owner approved
the exact local repair: remove the old 223 receipt, record identical installed
Daily SQL as 224, and apply only canonical main 223 with `--include-all` after its
exact preview. All history identities through 224, generated types, security,
assignment conflict behavior and Daily rollback/eight concurrency cases pass;
the data-preservation check passes. That one-time approval is consumed.
Final review at 57ccc26f found a custom-40001 retry risk in Daily's defensive
binding check. Owner approved the additive225 correction, one seventh targeted
review and exactly225 locally after verification. Migration224 remains unchanged;
225 replaces only the defensive conflict code with PT409 and the adapter accepts
both codes. A rollback-only fault-injection contract covers the defensive branch.
PR1380 records application and final-review outcomes; these must pass before merge.
The one-time225 approval does not authorize production. Production Daily Log
application remains pending; no reset, reseed or production repair was performed.
The [learner Daily Log read slice](contextual-daily-log-read.md) integrates scoped
and broad own-entry history behind the same dormant shared admission, without a
migration. Teacher Daily reads and other batch-1 domains remain subsequent work;
no cohort or home/page activation is authorized by this slice.

The shared cohort grants admission to the compatible experience, never classroom
ownership or enrollment. Resource-specific authorization remains mandatory.
Stopping new admission must not strand people already teaching or learning: retain
their compatible access configuration and minimum application version. Entitlements
continue to govern creation and expensive operations independently. Members may
complete assigned work on Free. Billing and subscription implementation remain owned
by the separate billing task.

Use the existing owner and enrollment records. New schema is justified only for
missing transaction boundaries or persistence requirements: Daily's existing atomic
writer lacks a transaction-time classroom/enrollment check, the ordered lesson-plan
writer lacks an actor check, and resource/roster writes require actor-bound owner
checks. Add service-only wrappers/versioned functions rather than rewriting applied
migrations. Hidden joined classrooms need an actor-scoped preference that never
changes membership or the classroom's archived state. Exact migration application
permissions still follow the schema rollout checklist.

The design reference remains `src/app/__ui/OwnedJoinedHomeMockup.tsx`: Teaching and
Joined without count badges or an All/Teaching/Joined filter; one top-right menu;
owner archive/restore and member hide/unhide, with Hidden below Archived. Apply the
UI-change and visual-verification workflow when implementing its live consumer.

### Coordinator checkpoint — 2026-10-01

This checkpoint supersedes pending-state statements in the historical sequence
above; it does not change the five-batch plan or authorize activation. Main baseline
is `6c44c254d7412e5a4c574c4c5d03a8b0ca1aeff1` (PR #1418). Learner Daily Log
reads passed two independent reviews, the real local PostgREST revocation contract
and every exact-head CI lane, including PR Gate. The slice is merged into main,
not independently promoted to production. Daily saves PR #1380 is merged; production
migrations 224–225 were installed and semantically verified through the separately
approved GitHub run `36869449834`. Shared admission remains dormant.

Teacher entry/history PR #1420 is now merged in main at
`3cf01b06200819d8df53a41cf469973b102c8c7e`. Initial security/compatibility reviews,
one correction batch, targeted security re-review and cumulative integration
review passed; 44 focused tests, 135 canonical focused tests/static checks and
the real PostgREST contract passed. Every exact-head CI lane, including PR Gate,
passed in run `36936773832` on reviewed SHA `5d795bb0`. No promotion or activation.

Roster logs/previews PR1421 is merged at
`e87d322a0aca946730b5949b720a42261052bfab`. Four independent review launches and
one correction batch resolved builder/envelope errors and synthetic audit cleanup;
28 targeted/119 focused tests, static checks, the real1001-learner PostgREST
contract and all exact-head CI36940960454 gates passed on reviewed5adf5905.
The keyset roster read and per-learner previews require no schema. No promotion
or activation occurred. The hub is synchronized; merged Git retains the work.

The **Teacher vs student login** task retains overall coordination. Its current
worktree is `codex/contextual-lesson-plan-bulk-writes`; the coordinator owns Git,
roadmap, verification, independent review and integration. One implementation
worker owns the bulk route/helper/schema, tests and synthetic concurrency harness;
the coordinator owns migration application, generated types, CI and continuity.
Current-relationship checks must bind each read or mutation. No AI or activation.
See the [entry/history contract](contextual-teacher-daily-log-read.md) and
[roster-wide logs contract](contextual-teacher-daily-logs.md).
Implementation must preserve absent and
non-admitted legacy behavior, accept either account-role value for an admitted
owner, enforce current owner/resource binding at the data read, retain existing
projections and archive rules, and fail closed on unverified evidence. Do not
substitute an earlier owner or roster preflight for a bound data query.

The independent [cached summary read](contextual-teacher-daily-summary.md) began
in parallel from the already-merged1420 actor helper, then rebased onto merged1421.
Continuity and CI-placement conflicts retain both slices; no migration was added
or renumbered. Initial security/compatibility review found two accepted blockers:
microsecond freshness truncation and silently dropped unresolved name-map warnings.
One correction batch retains full timestamp precision and validates nonblank own
map references before restoration. Targeted/final reviews passed on45cecd2a;
every exact-head CI36943420208 lane passed (0queue/1498run seconds). PR1422 is
merged in main at `7c0ded24a4746e383a80a26d4649e81d2c3ed259`; no activation.
The real local contract proves owner-bound
stats, HEAD count and cache queries, including transfers before each statement;
no summary/name payload may rely on an earlier preflight. No AI or schema change.

A read-only lesson-plan inventory, verified by the coordinator, establishes the
next domain after summaries: first current-relationship-bound list reads using
shared admission while retaining pair/legacy fallback, then transaction-bound
owner writes. Existing pair/legacy list queries trust earlier owner/member/visibility
preflights; the ordered writer checks sequence but has no actor/owner/archive
boundary. Date, bulk and copy writes therefore need separately reviewed additive
actor-bound transactions and real race tests, not just role-gate replacement.
Migration application retains its separate exact-target authorization.

The independent `codex/contextual-lesson-plan-reads` worktree began at e87d322a
and reconciled with merged1422. A bounded GPT-6 Astra/high proposal selected
classroom-rooted left plans and inner current-membership/visibility evidence, with
date keyset pages through the terminal empty page. One GPT-6 Sol/high worker owns
the two GET early branches, feature schemas/helper and TDD tests; coordinator owns
the actual1004-plan PostgREST harness, CI/docs/Git and risk-matched independent
review. The accepted design and verified source inventory are retained privately;
the executable contract is [lesson-plan reads](contextual-classroom-lesson-plan-reads.md).
All current-owner/member, visibility, pagination and exact cleanup database cases
pass;77 targeted/168 canonical focused tests and static checks pass after one
accepted JSONB-null content correction, reproduced by unit and actual PostgREST
regressions. Compatibility, targeted security and final cumulative reviews are
clean; all exact-head CI36946345369 lanes passed (0queue/1499run seconds).
PR1423 is merged main at478fd94ed24f0db202bbaa8fa23190a780d4f17d; hub is
fast-forwarded and finished worktrees cleaned. No activation or production change.

The next bounded slice is [single-date owner saves/clears](contextual-lesson-plan-date-writes.md),
PUT/POST only. A read-only GPT-6 Astra/high design selected an additive service-only
transaction using the existing classroom-operation fence, current parent owner/archive
checks and NOWAIT row locks; the ordered branch reuses unchanged SQL125. Bulk and
copy retain legacy semantics pending their own transactions. User explicitly approved
226 locally; preview contained only226, one application succeeded, service-only grants
and generated types were verified. Production remains225. Do not edit installed226
or infer permission for another migration/application. Current synthetic proofs cover
both owner role values, stale/equal no-side-effects, artifact/Blueprint lineage,
archive/transfer orderings, row contention and translated Blueprint conflicts with
head/plan/revision rollback and exact fixture/audit cleanup. Final SDK-boundary and
lifecycle-fence verification passes; both initial independent reviewers are clean
on c1eedd0d. CI36950939593 passed the date database harness but found a CURRENT
documentation-format regression (9043 unit tests passed, one failed). The single
missing space was reproduced and corrected in f86d5f85; targeted review and all
216 focused/static checks pass. Targeted and final cumulative reviews are clean;
PR1424 final CI36952067498 passed every gate atf86d5f85, but GitHub denied merge
because main advanced through scrolling PR1419. Returned to draft and rebased onto
1220d586 with both reviewed patches identical. Targeted reconciliation review and
216 focused checks pass atd9b7d780; ready-event CI36954995904 passed all five gates.
PR1424 merged as42789d40; canonical main is synced. Its conditional follow-up is
paused after completion; no admin/auto bypass, production change or activation.

Source/TDD preparation for [bulk owner writes](contextual-lesson-plan-bulk-writes.md)
can proceed independently in a stacked checkout while date CI runs. The selected
dedicated bulk wrapper reuses unchanged226 in one transaction, preserving success,
sequence, count and blank-upsert semantics. The new admitted path intentionally
rolls back the entire request on database failure; the legacy route stays unchanged.
A bounded GPT-6 Astra/high proposal is verified; one GPT-6 Sol/high worker owns
source/tests/harness preparation and the coordinator owns docs/CI/Git. Tentative227
requires latest-main numbering verification and separate exact-target application
approval. New-RPC database evidence and legitimate generated types remain pending;
do not hand-edit generated types, apply schema or claim acceptance prematurely.
Bulk SQL is statically clean. One accepted harness cleanup gap under strict auto-Free
provisioning was corrected: exact UUID/tagged provisioning operation pairs, both
durable audit tables, outsider residual checks, unconditional ambiguous-setup cleanup
and bounded session termination.36 source tests and targeted independent review pass
at4759f24b; SQL227 digest remainsc840869da61aa5a343a225f02d06cd99e428c93cb9a707f7e61f8cbb66097b8a.
Local strict enforcement is currentlyfalse (read-only verified), so that risk is
conditional, not a claim of existing residue. No harness or227 application occurred.
That preparation checkpoint is superseded by owner-approved LOCAL227 application
on2026-10-01, once, with unchanged SQL digest. Matching generated types, TypeScript,
service-only privileges and the full synthetic atomicity/concurrency harness pass.
The deliberate post-fixture failure also proves zero residual rows. Runtime tests
exposed stale test sequencing and an invalid direct Blueprint teardown; one batched
harness-only correction uses a fresh nonce plus an accepted-save probe and guarded
owner cascade.38 affected tests and targeted independent review pass. Strict-enabled
auto-Free cleanup remains statically reviewed, not locally exercised. Full-PR review
and final CI follow1424 merge. Production and admission activation are not authorized.
The prepared bulk branch is reconciled onto merged main42789d40, preserving1419;
installed226/227 digests are unchanged. Its draft publication and initial full
high-risk review now proceed. The user approved a30-minute review-window extension
after the original elapsed window expired during prerequisite CI; prior counters
remain3launches/2fixbatches before the full initial wave. No budget reset or rollout.
Draft1426 was published atde2feb04; full initial security/compatibility reviews clean
and238 focused/type/audit checks pass. CI36997772883 passed build/browser and the
positive bulk/forced-failure cleanup contracts, but its final proof wrapper failed
because GitHub lacked `rg`. Returned to draft. User approved20additional review
minutes for a portable `grep -F` correction with a strict two-sentinel regression;
SQL226/227 and application behavior remain unchanged. Targeted/final review and new
exact-head CI are still required. Billing plans228; no local or production apply.

That1426 checkpoint is superseded by targeted/final clean review and all five
exact-head gates on38c7edfb, CI37014848829. Normal squash mergea101fb28 is verified;
canonical main fast-forwarded cleanly.239 focused checks pass; installed226/227
remain unchanged. No production application/promotion or cohort activation occurred.

The authorized next bounded slice is [lesson-plan copy](contextual-lesson-plan-copy-writes.md)
on `codex/contextual-lesson-plan-copy-writes`, based ona101fb28. A bounded read-only
GPT-6 Astra/high design and one GPT-6 Sol/high implementation worker prepared the
owner-bound RPC, strict admitted route and tests; the coordinator owns harness,
docs, CI and Git. Proposed229 copies raw content plus nullable Markdown atomically,
preserving destination identity/lineage and untouched ordered heads; legacy copy
stays unchanged. Recursive persisted-content validation occurs before any write.
Source/CI-wrapper tests pass, but real runtime evidence/generated types are pending.
The local read-only preview found installed228 absent from this branch/main;
billing owns228 and must merge/reconcile first. Do not repair history or apply229
out of order. New exact local229 approval, SQL review and full draft-first PR review
remain required; production stays held. This does not advance batch1's exit gate.
Independent GPT-5.6 Sol/high SQL/security/concurrency preapplication review of
1d3ff46f againsta101fb28 is clean.32 source/legacy tests, architecture and audit
pass. The only broader workflow failure was a68-character startup-document excess;
CURRENT is compressed without changing the16,000-character gate. Runtime/type
generation and full PR review remain held, not waived by preapplication review.
The owner subsequently approved LOCAL229 after billing228 merge/reconciliation and
60additional copy-review minutes16:50:54–17:50:54Z; counters retained. Explicit
billing coordination dispatched without assuming production or billing activation.
Own branch rebased cleanly on1428/a6c23954 with copy source and229 digest unchanged.
Billing1429's independently approved sync is separately owned. Local229 remains
unapplied until that prerequisite lands; no duplicate review/CI watcher or takeover.
Superseded by billing1429/25cc0691 merge and one approved LOCAL229 application:
229-only preview, matching228 digest, pika/54322 and001–228 history verified first.
Local001–229/types/service-only grants,263focused checks and both positive/forced
cleanup harnesses pass; zero residue and pre-outer-rollback late-failure proof.
Fixture-only lineage collision fixed with distinct source artifact IDs; installed
229 digest9b4c9b8b immutable. Full PR review/CI still pending; production/admission held.

PR1431's full independent security and compatibility reviews are clean at4516bc85;
all five exact-head gates passed on CI37046563313. The final merge gate found
attendance1430 had advanced main to8dc05d47; only JOURNAL-ARCHIVE conflicted.
Returned1431 to draft. Owner approved20additional review minutes18:55:24–19:15:24Z,
retaining counters. Rebased onto1430 preserving both histories; all16 non-log owned
files and installed229 digest match the reviewed candidate before receipt updates.
Reconciliation is batch4; one final changed-base integration review and fresh CI
remain mandatory. No further default remediation batch remains. No SQL changes,
schema application, production promotion, billing or admission activation occurred.

Superseded by the verified normal squash merge of PR1431 at493e752a on2026-10-02,
after the owner-approved unchanged-head CI retry37076238068 passed all five gates
on reviewedca403202. Canonical main fast-forwarded cleanly; copy/date/bulk worktrees
remain preserved. Source229 stays immutable. Production and admission remain held.

Announcement owner/member shared GETs merged in PR1436 (`66fa5de3`), with191
focused checks, real pagination/revocation/zero-residue cleanup proofs and exact-head
CI37083358161 including PR Gate. No schema, UI or activation changed. The next
bounded slice is [transaction-safe owner announcement writes](contextual-announcement-owner-writes.md).
The owner authorized routine implementation, independent review and normal main
merges through the cutover on2026-10-03; failed gates, review-budget checkpoints and
integrated activation evidence still apply. The owner explicitly waived separate
local migration approvals in this task; production approval remains unchanged.
Local231/232 are now applied once and immutable after source/target/history checks.
Both initial1438 reviews at2f6fe7e and installed SDK/concurrency/forced-cleanup
checks pass, with unchanged existing records and billing disabled. Billing1435
merged efe4eb3f; announcement source rebased and genuine generated types/check
match001–232. Final integration review, exact-head CI and1438 merge remain.
The owner clarified the requested bounded elapsed extension; counters stay intact.
The owner subsequently explicitly authorized needed review extensions without
repeat approval requests. Preserve original clocks/counters, document each
extension and retain absolute skill caps, exact-head CI and normal merge gates.
No source ownership is transferred. Member read receipts follow. Shared
admission and product cutover stay dormant.

Superseded by PR1438 normal squash merge875316af on2026-10-03: final cumulative
and targeted documentation review clean, four targeted tests/245focused pass;
exact-head CI37114898975 passes all five gates on b4eb9801. Canonical main cleanly
fast-forwarded; source/local232 immutable, production unchanged. Next bounded slice
is transaction-safe member mark-all-announcements-read POST. Owner/member global
roles remain separate from classroom permissions; full five-batch cutover is held.

Member receipts now merged in PR1439 at98887743 on2026-10-03. Initial and final
integration reviews clean on2166a3c6; exact-head CI37118772779 passes all five gates.
Local233 was applied once from reviewed source; generated types, rollback,
concurrency, real SDK/adapter and forced-fixture cleanup pass. Canonical main cleanly
fast-forwarded. Production remains001–225; shared admission and cutover are OFF.

The next independent batch-1 preparation is the shared
[material-list read consumer](contextual-classroom-material-reads.md). It binds
current classroom ownership or active non-owner membership into every payload
statement, keeps all 14 fields and existing publication/order rules, and uses
precise keysets beyond 1,000 rows. Missing-table/position fallbacks remain only in
unmatched legacy/exact-pair paths. Native implementation and SDK-proof workers
have separate source/script ownership; the coordinator owns documentation, CI,
acceptance and merge order. No schema or UI change is included. The material
candidate reconciles onto the verified1439 merge before publication/review.
Superseded by PR1440 squash merge04f8d1e3 at12:17:30Z on2026-10-03. Security,
targeted remediation and cumulative integration reviews clean at5a1df811;
all five exact-head CI37120967402 gates pass (0queue/1509run seconds). Main cleanly
fast-forwarded. Local001–233 and production001–225 unchanged, shared admission OFF.

The next bounded slice is [shared material owner writes](contextual-material-owner-writes.md):
POST/PATCH/DELETE with service-only transaction-time current-owner/active/resource
binding, retaining creator193, historical identity/lineage and publication presence.
Prepared source has245tests, complete mixed-classwork/reorder and rollback/SDK
harnesses. Exact reviewed234 is applied locally once; local001–234 matches and
genuine generated types add only the three public RPCs. Installed SQL is immutable.
Draft PR1441 reconciles onto1440. Initial compatibility review is clean; accepted
security finding is corrected by full-row transport validation inside the transaction,
with historical malformed-content/UUID/timestamp no-effects regressions. Targeted
security review is clean.322 focused checks, SQL rollback and actual SDK concurrency,
normal/forced exact cleanup and type drift checks pass; final integration/CI pending.
Production application and activation remain separately controlled.
Linked Blueprint reads, other classwork boundaries and roster operations remain
separate work; this does not satisfy batch1's whole-experience exit criteria.

Independent batch1 [calendar owner-write preparation](contextual-class-day-owner-writes.md)
adds only sharedPOST/PATCH branches on both calendar routes, reusing installed152.
Both owner labels/member/archive/former-owner denial, actualSDK503aftercommit,
Toronto/bounds/prompt/CTID preservation and normal/forcedcleanup pass. Existing
SQLrollback and allfive observed-lock concurrency races pass. Fullindependent
draftreview/currentmain reconciliation/exactCI remain beforemerge. No newSQL,
globalrole/plan/provider/UI/activation changes;235belongs toseparate rosterwrites.

Calendar reconciliation now follows verified roster235 PR1445 squashmerge2fe79a8b
at17:03:33Z on2026-10-03, after allfive exact596081dc CI37137272675 gates pass.
Reviewed calendar runtime/proofs remain unchanged; the shared CI test file retains
both exact roster/calendar blocks. Changed-base review and new exact-head CI still
precede1446 merge; local001–236/production001–225 and admission/cutoverOFF unchanged.

Superseding merge receipt: PR1441 normal squash merge d913eebd at14:18:23Z on
2026-10-03 followed all five successful exact-head74995349 CI37127414505 gates
(0queue/1774runseconds). Canonical main fast-forwarded cleanly. Reviewed234 remains
immutable and local001–234 matched; production001–225/admission OFF unchanged.
Queued reads reconcile onto that actual merge; their own reviews/final CI still
govern acceptance. User expressly authorizes review extensions without repeated
prompts, with original counters and absolute skill caps/security gates retained.

Independent adjacent preparation: [linked Blueprint material reads](contextual-linked-blueprint-material-reads.md)
bind the current classroom/link/Blueprint owner and latest saved version in one
payload statement. Both global-role owners are allowed; members are denied. The
actual SDK proof passes1,001-version ordering/limit, current source/owner changes,
500/501 bounds and normal/forced zero-residual cleanup. No new schema or UI change;
a stacked draft review may run while1441CI completes; ready/merge waits verified
parent merge and reconciliation. The batch3 Blueprint tab still needs its separate
authoring-guidance boundary. This does not complete batch1 or activate shared admission.
The next batch-1 read preparation is
[shared roster management GET](contextual-classroom-roster-management-read.md).
Every roster/enrollment page, including each terminal empty page, binds the
current classroom owner; real nested bindings retain stable learner identity
without turning email-only matches into mutation authority. Both global-role
owners are supported, members denied, and archived owner reads retained.
This changes no schema or UI and leaves legacy handlers and purge mutations
unchanged. Source tests are not database evidence: actual installed-SDK normal
and forced-cleanup proofs, independent review and exact-head CI precede merge.
Roster write fences and class-day/core reconciliation remain batch-1 work;
linked Blueprint material reads are adjacent batch-3 work, not phase closure.

Superseding linked-material receipt: PR1442 merged3351d85f at14:56:00Z on
2026-10-03 after all five exact-reviewed-headcc2681d8 CI37129553521 checks
(0queue/1757runseconds); canonicalmain cleanFF. Roster1443 reconciles onto that
actual merge before targeted preservation review/final CI. Local235 is installed
by the separate roster-write slice; production001–225 and shared admission OFF.

The class-day dependency now has a bounded
[shared GET consumer](contextual-class-day-shared-read.md) in preparation for both
neutral and compatibility URLs. Current owner/member predicates bind every
payload and terminal page, retaining archived owner reads and active unarchived
member access without global-role routing. Complete date/ID pagination and strict
safe projection are required. No schema/UI/admission change is included; shared
calendar writes still need migration-152 boundary consolidation. Roster write
fences also remain batch-1 work. Linked Blueprint material reads are batch-3
adjacent and do not replace those everyday-access dependencies.

Superseding roster-read receipt: PR1443 normal squash merge7e5c6422 at15:28:30Z
on2026-10-03 follows all five exact77995c95 CI37131666194 gates (0queue/1642run).
Canonicalmain cleanFF. Class-day1444 nowreconciles onto that actualmain; original
runtime/proof/CIsteps remain unchanged, with targeted changed-base review and
fresh readyCI required. Local236 is installedby separate preservingremoval work;
thisGET addsnoSQL/types. Production001–225/sharedadmission/fullcutoverOFF remain.
PR1441 is now verified merged at `d913eebd` on2026-10-03, after all five gates in
exact-head CI37127414505 passed on reviewed74995349. Canonical main fast-forwarded
cleanly; local234 is immutable and production remains001–225. Shared admission
and the integrated cutover remain OFF. Read slices1442/1443/1444 retain their
separate draft-first review and merge evidence; their preparation is not rollout.
The next independent mutation slice is
[shared roster owner writes](contextual-roster-owner-writes.md). Its proposed
additive SQL is not yet applied or reviewed. Source-only implementation and
proof workers have disjoint file ownership; the coordinator owns review, exact
local application, real database execution, generated types and integration.

Superseding roster-write evidence: local235 was installed after frozen security
review and parser correction on2026-10-03; immutableSHA256
dded003c0fdd92235af163ef73751e1a9442146ee2129015ace83acdc2ff685b. Firstordinary
attempt rolledback completely; fresh235-onlypreview preceded successfulretry.
Genuine types, actualSQL rollback and SDKnormal/forcedcleanup pass;273focused
tests17files+staticlint pass. FullPRreview andfinalCI remain; source rebases onto
actual1442main3351d85f without changing runtime/proofs/installedSQL. Separate
rosterGET1443/calendarGET1444 integration order remains; batch1 is notcomplete.

Superseding integration receipt: PR1444 merged actual main `a8c4e9b2` at
16:04:51Z on2026-10-03 after all five CI37133784223 gates. PR1441–1444 are
merged; roster-owner writes1445 now reconcile onto that actual main. Reviewed
runtime, tests, proof scripts, generated/curated contracts and installed235 bytes
remain unchanged. Local001–236 includes separate unmerged preserving-removal
work; main migration tail remains234 before this slice.1446 is prepared,
removal1448draft/detail1447draft. Changed-base review and fresh exact-head CI
precede1445 merge. Production001–225/sharedadmission/fullcutoverOFF remain.

[Shared classroom-detail GETs](contextual-classroom-detail-reads.md) are the next
bounded batch1 read integration: explicit30field owner/member payloads bind the
current relationship in the data query and retain member privacy/hydration.
Metadata PATCH, Course Guide assembly and SSR/home routing are not widened.
Actual SDK cleanup, independent review and final CI remain release gates;
no source-only result activates shared admission or closes the phase.

[Contextual classroom metadata PATCH](../guides/contextual-classroom-metadata.md)
is a separate bounded batch1 mutation: strict13 metadata fields, current active
owner authority and service-only transactional full30/revision postconditions.
Local immutable237, rollback SQL/genuine types and corrected SDKnormal/twoforced
exact cleanup proofs pass after independently reviewed proof-only recovery of
the first fixture-whitelist failure. Full initial source review, exact-head CI and
actual-main integration remain gates. Explicit archive keys are reserved400 for batch3; existing GETs and
legacy PATCH remain unchanged. Production001–225/sharedadmission/fullcutoverOFF.

Metadata1450 preparation receipt: source0cfb4c26 is prepared locally on PENDING Guide d0db1331
and detaila653d0ac, NOT merged. Actualmain remains73a85f26/PR1448. All eleven
metadata-owned files retain source bytes; incoming GET/legacy PATCH and GET tests
retain exact remainder with only the approved metadata additions/two PATCH tests.
Whole incoming CI plus the original metadata step and full history are preserved.
Immutable001–238/genuine types remain incoming bytes. Actual-parent reconciliation,
final cumulative independent review and exact-head CI remain required. No new DB,
proof replay, generation, production promotion or shared-admission/full-cutover activation.

Metadata1450 actual-parent receipt: prepared f8b91ec3 is reconciled onto actual
Guide1449 squash668912ab, merged2026-10-03T20:03:52Z after all five exact reviewed
ce68b9e1 CI37148238240 checks succeeded (0queue/1871s). Squash and reviewed Guide
trees are identical. Original metadata bytes, incoming source/SQL/types, whole CI
and earlier prepared receipt remain unchanged. Final cumulative independent review
and metadata exact-head CI remain required; no rollout or production activation.

Superseding class-day-read receipt: PR1444 normal squash mergea8c4e9b at16:04:51Z
on2026-10-03 followed all five exact7d341d23 CI37133784223 checks
(0queue/1697runseconds); canonicalmain cleanFF. Roster1445/calendar1446 remain
prepared writes. Detail1447 has clean initial reviews and actualSDK normal/two
forcedcleanup PASS after a proof-only parsed-clone correction. Removal1448 has
actual SQL/SDK normal/threeforcedcleanup PASS; full draft reviews remain pending.
These are bounded batch1 receipts, not complete rollout or cohort activation.

Detail1447 is now prepared locally on reviewed pending1448 head88a1bfd6
while its one readyCI37143487206 runs. This is NOT a main merge: actual main
remains2095/calendar1446, and root-owned actual-squash reconciliation, changed-base
review, publication and exact-head detail CI remain gates. Original detail
paragraphs and receipts above are preserved as historical evidence; their older
pending-write language is superseded by this preparation receipt. All10reviewed
detail files remain unchanged, while the complete parent's roster/calendar/
removal and dormant237/forward238 SQL, genuine types, proofs/tests and CI gates
are retained. No detail SQL/types generation, metadata runtime or cohort change;
shared local001–238/production225/sharedadmission/fullcutoverOFF remain.

Historical PR1436 preparation: the bounded batch1 slice integrates announcement owner/member GETs with shared
admission and binds every payload page to the current relationship. No new schema,
UI, cohort or mutation is included. Astra/high performed a read-only query design;
Sol6.1/high owns helper/schema/GET regression implementation, while this coordinator
owns the real PostgREST fixture contract, CI, documentation and acceptance. Evidence
must include empty/hidden lists, precise publication keysets beyond1,000 rows,
short pages and revocation before first/later/terminal payload statements. Local
history001–230 was observed;230 is installed by the billing task but not merged into
this base. Do not regenerate types from that mismatch, reapply/repair230 or reset
the database. Owner create/edit/delete and member read receipts follow as separate
atomic-write slices with exact-target schema permission when needed. Shared admission
and page activation remain dormant throughout this integration.

Member receipt implementation was prepared separately on
`codex/contextual-announcement-member-receipts`; see
[its atomicity contract](contextual-announcement-member-receipts.md). PR1439 initial
high-risk source reviews are clean;233 applied locally once under the explicit task
waiver, after exact history/binding and one-file preview. SQL is immutable and
genuine generated types match; installed races/SDK/forced cleanup pass. Final
integration and exact-head CI37118772779 passed on2166a3c6; main merge98887743
is verified above.
The shared classroom experience remains dormant.

The bounded [Course Guide reader](contextual-course-guide-reads.md) is being
prepared behind the same dormant shared admission. Every enabled singleton,
collection page, empty terminal and final control proves current owner/member
authority and raw JSONB visibility configuration in its own statement. Its DTO,
public-site/legacy handlers and assessment publication behavior remain intact;
no answer-bearing broad site loader, SQL/types, UI or billing changes are included.
Source TDD/installed-SDK serialization checks pass. Root actual local PostgREST
normal and both forced-cleanup modes now pass, after correcting two fixture
assumptions without changing product code or weakening existing constraints.
Whole-row global baselines/zero residue/enabled generation guards are preserved;
independent full PR review, actual-main reconciliation and final CI remain gates.
This does not complete everyday work or permit cohort activation.

The next bounded batch-1 source slice is
[shared preserving roster removal](contextual-roster-preserving-removal.md),
behind the same dormant admission contract. Proposed236 wraps only the current
active-owner removal transaction; legacy164/bulk/purge/restore remain unchanged.
Frozen preapplication security review is CLEAN and236 was applied locally once
after exact target/history/digest/one-file preview. Source tests and genuine type
generation/drift pass; actual local SQL/SDK evidence and full PR lifecycle remain
pending. Installed236 is immutable; production remains225/admission OFF.
Installed164 retained-row uniqueness and173/175 exact-one cleanup checks are
preserved. Duplicate active roster identities fail closed whether one or all rows
are selected, without DML or discarded history. Coordinated multirow removal and
retained-generation/cleanup/re-add/Pal/purge compatibility are a batch3 prerequisite
before full cutover, not completed support in this defensive batch1 slice.
The latest owner instruction explicitly carries all routine in-scope work and
necessary review extensions without repeated prompts; original clocks/counters,
absolute review caps and all security/exact-head/release gates remain intact.

Superseding removal evidence: installed236 remains immutable; actual rollbackSQL,
SDKnormal and three forced-cleanup modes passed exact cleanup/global baselines.
Earlier proof-harness defects were corrected without changing236. PR1448's full
initial security/compatibility review is CLEAN on reviewed8e81327a. The child is
now prepared on updated1445parenta9613f46, with all14reviewed child files unchanged.
This draft stack still awaits actual1445main merge and squash-base reconciliation,
changed-base review and exact-head CI; parent preparation is not readiness or
batch1/full-phase completion. Original1448clock15:19:13Z, extension17:19:13Z and
launch8/initial1/targeted5/fix5 counters remain. Local001–236/production001–225,
sharedadmission/fullcutoverOFF; duplicate-row lifecycle remains the batch3 limit.

Removal reconciliation now follows verified calendar PR1446 squash merge2095efec
(2026-10-03T17:40:27Z; reviewed795a528a, all five eligible checks/PR Gate passed
in37139673399). The two removal paragraphs above remain historical receipts;
their pending-parent language does not describe the current integrated base.
All13nonshared reviewed removal files, immutable236 and its genuine eight-line
generated RPC remain unchanged; CI tests add the original removal block after
the exact incoming roster/calendar blocks. Whole actual-main runtime,235/curated
contracts and calendar forced-concurrency CI are retained. This is local
integration only: changed-base independent review, publication and exact-head CI
remain pending. Original1448clock15:19:13Z/extended18:19:13Z and launch8/initial1/
targeted5/fix5 remain; shared local metadata237 is not regenerated into this
001–236 branch. Production225/sharedadmission/fullcutoverOFF remain unchanged.

### Superseding coordinator checkpoint — 2026-10-03

Batch 1's everyday-classroom backend is complete on actual canonical main
`e86283f82741078563cd4d1e49710f501c074891`. PR #1450 normally squash-merged at
20:44:36Z after all five exact reviewed `aa27ed1e` checks in CI `37150788872`
passed (0 queue / 1823 run seconds); the squash tree equals the reviewed tree.
Its initial, targeted and final independent reviews and actual local238 SQL/SDK
normal/two forced-cleanup receipts remain valid, not rerun for timestamps.
The original ledger retains 7 launches / 2 targeted / 1 final / 3 fix batches.
The preceding pending-parent statements are historical, not current merge state.

Delivered backend families: learner Daily reads/saves; teacher entry/history,
roster logs/previews and cached summary; lesson list/date/bulk/copy; announcement
read/owner-write/member-receipt; material read/owner-write; roster read/add/CSV/
counselor/preserving-remove; class-day read/calendar-write; classroom detail,
Course Guide and strict13-field metadata. Both mounted Resources tabs render the
Course Guide; unmounted legacy resource sidebars are not another required screen.
Duplicated active learner roster identities still fail closed without deleting
history. Coordinated multirow removal/generation/re-add/Pal/purge support remains
required in batch 3 before cutover; do not merely drop a unique index.

Batch 2 is active on `codex/contextual-assignment-shared-writes`, based on actual
main `e86283f8`. Its first bounded deliverable, [shared Assignment write admission](shared-assignment-write-admission.md), integrates existing actor-bound
Assignment/classwork write, history/restore/artifact and inline-image adapters
with the one strict shared admission reader. No new SQL, dependency, rollout
flag, entitlement or provider operation is expected. Absent configuration retains
literal pair/legacy behavior; malformed configuration fails after authentication
before input discovery or compatibility fallback; admission grants no relationship.
GET/open supplemental payload reads remain unchanged until their following
statement-bound read slice. Independent review and an exact-cleanup local
route-to-RPC proof are required before this deliverable can merge.

Superseding integration receipt (2026-10-03 Toronto):1451 is merged as3b62de06,
all five exact-head checks37156761577 passed.1452 is merged asf6b9c8a4 after all
five exact-head checks37161407268 passed; canonical main is clean, local/main001–239.
Its retained-group consumers do not enable the grouped writer or remove164/236
singleton defenses. Grouped write/lifecycle compatibility remains batch3 work.
The next batch2 [Assignment list slice](contextual-assignment-list-reads.md)
binds every payload page to the current relationship.322 focused checks and
actual clean5ba2d3fa isolated nine SDK cases/fourteen revocations/normal plus two
forced exact-cleanup and unchanged-canonical proofs pass. Initial/targeted
reviews are clean; final cumulative review and exact-head CI/mainmerge remain
gates. No new migration, production promotion or activation is included.

Superseding Assignment-list receipt (2026-10-03 Toronto):1453 merged as88d54c94
after clean final cumulative review and all five exact-head CI37168905602 checks,
including PR Gate. Squash tree equals reviewed91a64eca; canonical main cleanFF.
The [owner Assignment overview](contextual-assignment-overview-reads.md) is now
the bounded implementation. Student-specific owner detail and learner opening
supplements follow separately because each has additional disclosure/side-effect
boundaries. No production or cohort activation accompanied1453.

Assignment-owner overview1454 now has accepted isolated normal/two forced
cleanup evidence at78aed851. Seven new SDK cases verify owner/member authority,
1001 roster/documents/requirements and099-triggered histories, alongside the
existing nine list cases/fourteen list revocations.266focused/1skip+105targeted
checks pass. Initial/three targeted reviews are complete; one path compatibility
finding and a real sparse-history pagination issue were corrected without new
SQL or relaxed limits. Final cumulative review and exact-head CI/mainmerge
remain gates; shared admission, home cutover and production remain untouched.

Superseding overview receipt:1454 merged9591ee1e at2026-10-04T04:27:09Z after
all five exact-reviewed-headf93a411e CI37175526420 gates pass (0queue/1754runseconds).
Normal squash tree equals reviewed tree; canonical main cleanFF. Production and
all admission/cutover gates remain unchanged.

The next bounded [owner student-detail GET](contextual-assignment-student-detail-reads.md)
is reconciled onto actual1454 merge9591ee1e. It preserves complete sensitive
owner-work fields and proves both current ownership and exact nonowner target
enrollment at every payload/page/terminal/final statement, including before image
signing. No migration, provider operation, UI or admission activation is included.
Publication/review follows actual1454 merge and base reconciliation. Its new
isolated observer reuses the immutable list fixture/platform and exact existing
owner-transfer/member-removal SQL at six detail first/later/terminal boundaries;
the original list observer owns the single restoration and fingerprint checks.
Offline proof/serial-CI guards pass24 tests. Superseding receipt:1455 initial
security/compatibility reviews CLEAN at4716a817; actual isolated eight detail SDK
cases/six live revocations plus existing nine list cases/fourteen revocations and
both forced cleanup modes PASS, including unchanged full canonical fingerprints.
384focused/8skip/all static gates pass; documentation re-review and exact-head
CI/mainmerge remain gates. Superseding receipt:1455 merged97e16dec at
2026-10-04T05:21:54Z after all five exactea080944 CI37178120557 checks PASS;
normal squash tree equals reviewed tree and canonical main cleanFF.
Empty artifact/feedback/repository fixture
collections do not prove nonempty supplements or live Storage signing.
The same slice closes1454's non-blocking exhausted-bound signing follow-up with
a lazy overview request and two installed-SDK RED-to-GREEN zero-late-POST tests;
no DTO/query/relationship/limit change. This correction is required before
admission/cutover activation; it is not a deployment or live-signing claim.

The next opening prerequisite is [locked Classwork visibility](contextual-assignment-open-classwork.md):
candidate240 replaces only214's complete member-open function, adding locked
visibility concealment before document create/view/Pal effects. Source-only while
1455 CI runs; now reconciled onto actual1455 merge97e16dec without executable
changes. Draft publication freezes source for independent review; exact local
preview/application/runtime precede ready/CI/mainmerge.240 is
UNAPPLIED. Normalization defaults, owner precedence, transaction/signature/security
and all001239SQL/fixtureDML/platform/cleanup authority remain unchanged; only the
explicit reviewed replay floor advances to240. Sibling learner write/history/
artifact visibility and shared GET supplements remain separate integration work.

Superseding240 receipt: draft1456 initial independent security/compatibility
reviews CLEAN atf0567a3c. Exact local preview listed only240; one application
succeeded and exact001–240 history/type regeneration/check pass without generated
drift. The reviewed rollback-only Classwork/Pals fixture, existing open atomicity
and all five existing concurrency scenarios pass. A fresh disposable001–240 SDK
replay passes eight detail cases/six detail revocations plus existing list cases/
revocations; both forced cleanup modes exit1 with only expected markers and
unchanged whole canonical fingerprints/exact teardown. Two-session visibility
races and nonempty supplements remain unproved. Receipt-only review/exact-head
CI/mainmerge remain gates. Production/admission/home/cutover unchanged. A separate
child worktree prepares the dormant shared learner GET; it cannot activate it.

Superseding locked-open receipt:1456 mergedc7e5a487 at2026-10-04T06:21:11Z
after all five exact2c9ee58f CI37181022226 checks PASS, including PR Gate
(0queue/1326runseconds). Normal squash tree equals the reviewed tree; canonical
main cleanFF.240 applied once locally with exact001–240 history, genuine type
generation/check with zero diff, new rollback proof and unchanged original
atomicity/five concurrency scenarios PASS. Fixed-source security/compatibility
and four-document receipt reviews CLEAN. Fresh240 detail SDK normal and both
forced cleanup modes PASS with unchanged complete canonical fingerprints.
No production, admission or UI activation accompanied this merge.

The next bounded [shared learner Assignment GET](contextual-assignment-learner-open.md)
preserves240's open transaction and existing learner response while binding every
supplementary read to the current exact learner relationship. Source preparation
has161 targeted checks passing. Its separate observer is read/projection-only:
the open RPC is a sealed existing-fixture-document stub with no create/view/Pal
effects; real supplementary SDK reads reuse the immutable fixture/transitions.
Independent review and actual isolated proof remain gates, not claimed receipts.
Integrated open effects, nonempty supplements/live signing and sibling visibility
remain distinct work. Shared admission/page/home/cutover and production stay OFF.

Superseding learner-GET receipt: draft1457 initial ecfcf714 security/compatibility
CLEAN; actual normal first failed with exact baseline/cleanup PASS. One proof-only
stub-content regression REDtoGREEN and targeted ec274c75 review CLEAN preserve
all application/SQL/fixture/platform/transition/cleanup authority. Actual ec274c75
normal passes9projection/6original revocations/nine controlled false-flag RPCstubs
and zero actualRPC/Storage/provider network, plus originallistcases/revocations;
both forced modes exactexit1/two markers/full canonical unchanged PASS.
318focused8skip/static/explicitproofTS/audit PASS. Final cumulative review and
exact-head CI/mainmerge remain gates. Source-only next241 worker prepares hidden
Classwork denial for save/submit/unsubmit/preflight only; history/restore/artifacts/
inline images remain separate. No241application or production/activation implied.

Remaining batch-2 groups, in integration order: Assignment detail/open
enrichments and [locked learner write visibility](contextual-assignment-member-classwork.md).
Candidate241 replaces four complete214 member save/submit/unsubmit/preflight
definitions, only adding240's locked Classwork predicate. Root inspected source,
corrected the rollback fixture's fresh-null activation prerequisite without changing
169's immutable boundary/guard, and retains regression-first evidence. Source-only,
UNAPPLIED; independent source review, exact local preview/application/types and
rollback/runtime proofs precede ready/CI/mainmerge. Existing001–240 SQL, fixture DML,
allowed transitions and cleanup authority remain unchanged; the explicit disposable
replay floor advances only to241. Sibling history/restore/artifact/inline guards
and integrated authenticated opening remain separate pre-cutover work.

Superseding1457/1458 receipt:1457 reviewed0e5cd1ba merged2595c775 at07:56:37Z
after all five exact-head CI37185801031 checks PASS; canonical main cleanFF.
1458 source reviews clean;241 applied once locally with exact001–241 history and
genuine types zero drift. A five-null-due-date rollback fixture failure left exact
canonical baseline unchanged; two-file regression-first correction/targeted review
clean, then new241 and unchanged save rollback harnesses PASS. Rebasecc206cce
preserves applied SQL/proof/test bytes and resolves continuity-only conflicts.
Strict001–241 combined replay passes9learner projections/6original revocations,
original list controls and both exact forced-failure cleanup/full baseline receipts.
Open effects remain sealed false-flag stubs, not real RPC/signing/nonempty supplement
or authenticated HTTP evidence. Canonical committed-fixture concurrency was not
run because168 retains immutable identities; final CI's ephemeral database owns
that unchanged check. Final cumulative review/CI/mainmerge remain gates; local241,
main240, productionlast225/sharedadmission/cutover/billing/providerOFF unchanged.

Next bounded source preparation is [supplemental learner visibility](contextual-assignment-member-supplement-visibility.md).
Candidate242 replaces only complete latest214 history/restore/artifact context and
213 inline-write context, adding locked Classwork concealment with owner-history
inspection preserved. Source-only worker21new/80related checks PASS; root65related
checks PASS and inspected scoped rollback harness. No241SQL changed. New serialCI
and explicit242 isolated floor are regression-first23RED then61GREEN; all existing
fixture/transition/restoration/cleanup authority stays unchanged.242UNAPPLIED;
independent review, exact local application/types/runtime and parent1458actualmain
reconciliation remain gates. Source-only synthetic rollback Storage metadata
does not grant Storage API/bytes/network/cleanup authority. Same-actor removal,
concurrency and authenticated lifecycle remain separate; latest213 inline-image
READ also needs locked learner concealment with owner/404 semantics preserved.
No production/admission/home/cutover/account/billing/provider change implied.

Superseding1458 merge receipt: reviewed28e8af46 merged61c44aec at08:38:57Z
after exactCI37188214976/all5PASS, including unchanged save concurrency and new241
rollback steps (0queue/1426runseconds). Reviewed/squash tree parity and canonical
clean mainFF verified; local/main001–241. Prepared242 branch189focused/staticPASS,
stillUNAPPLIED. Actualparent reconciliation, independent reviews and genuine local
types/runtime/disposable replay precede ready/CI/mainmerge. Assessmentphase/goal
remain incomplete; no production/activation implied.

Superseding1459 local verification: actual-parent branch reconciled onto61c44aec;
242 applied once after independent source review, exact001–242 history and genuine
generated types/check zero drift. Three proof-only corrections close NULL-scope
retained-generation baseline and conditional CASE grammar, with RED→GREEN22checks
and targeted reviews; applied SQL immutable. Actual new242 plus unchanged history/
artifact rollback contracts PASS, all full canonical row/metadata/settings/cron/
resource fingerprints unchanged. Runtime d5dea393 strict242 isolated normal and
both forced modes PASS, exact teardown/private0600 receipts; original observer
authority unchanged. These nine projections/six revocations use sealed false-open
stubs, not actual open effects/nonempty SDK supplements/live signing/HTTP/browser.
Final cumulative review/exact-head CI/mainmerge remain gates; main241/local242,
productionlast225 and all activation controls unchanged. Inline-image read boundary
remains the next bounded prerequisite before image admission. Phase/goal incomplete.

Next bounded prerequisite: [locked inline-image reads](contextual-assignment-inline-read-classwork.md).
Candidate243 replaces only the complete latest213 image READ function, with its
equivalent ACL; it adds locked Classwork concealment only for nonowners. Owners
retain hidden/archive/draft ready-object inspection of still-enrolled subjects.
Worker9new/90related and root71new/CI/floor checks PASS; prepared rollback matrix
is NOTRUN. No001–242 SQL changes, signing/upload/finalize or feature activation.
Original isolated observer authority is unchanged; only strict243 replay floor
advances.1459 final cumulative review CLEAN on9f15e6e2, exactCI37191597295 running;
actual parent merge/reconciliation must precede243 publication or local application.
Independent source review, real SQL/types/rollback/replay and reviewed CI/mainmerge
remain gates. Local242/main241; productionlast225 and admission/home/cutover OFF.

Superseding1459 merge receipt: reviewed9f15e6e2 merged01aedcec8 at09:46:04Z,
exactCI37191597295/all5PASS includingPRGate (0queue/1698runseconds). Reviewed/squash
tree parity and canonical clean mainFF verified. Local/main001–242. Prepared243
reconciled onto actual identical parent with complete source-tree parity and all
unrelated stashes preserved. Candidate remains UNAPPLIED; frozen independent review
and genuine local runtime/replay are next. Assessmentphase/goal incomplete; no
production/admission/home/cutover/provider or billing change implied.

Superseding1460 local receipt: draft47724239 independently reviewed CLEAN;
243 applied once locally, exact001–243 history and genuine types/check zero drift.
First rollback fixture hit existing179 submit-history guard; full canonical baseline
unchanged. Proof-only two-file regression-first1RED/9PASS→10GREEN/targeted reviewCLEAN
corrects already-submitted snapshot tags, preserving every applied SQL/control.
Runtime40ce325b actual image-read hidden/visible/owner/lifecycle/subject/object/status/
fullDTO/no-effects and unchanged242 supplemental rollback PASS. Strict243 original
isolated normal and2forced modes PASS, exact owned teardown and full canonical
row/metadata/settings/cron/resource equality; private0600 receipts67HS1D/25vnVp.
Open remains nine sealed false-create/view stubs, not real effects/signing/nonempty
SDK/authHTTP/browser/race proof. Final cumulative review/exactCI/mainmerge gates
remain; main242/local243, productionlast225 and all admission/home/cutover controls
unchanged. Actual open/private-delivery integration remains a separate prerequisite;
original observer authority is not silently extended. Phase/goal incomplete.

Historical source preparation of [integrated SDK proof](contextual-assignment-learner-integrated-proof.md)
is a sibling runner with a finite, disjoint extension manifest, not a migration or
silent expansion of the sealed observer. Its intended cases include real open/
create/view, nonempty own supplements and private byte/signing delivery. Original
fixtures/transport/SQL allowlist/transitions/restoration/cleanup stay immutable.
Only source preparation is underway; no extension SQL/Storage bytes/signing calls
are authorized by preparation or have run. Root must accept an independently
reviewed finite manifest before later execution. Authenticated route/browser and
same-actor removal/race remain separate.1460 reviewed e98b78ef merged as3c5d7097
on2026-10-04T10:43:25Z after all five exact CI37194768940 checks passed; reviewed/
squash full-tree parity and clean canonical main fast-forward verified. Prepared
source31 new offline checks/136 related checks/full TypeScript/ESLint pass, not a
runtime receipt. Actual-parent reconciliation precedes next publication.
Local/main243/productionlast225 and all admission/home/cutover controls unchanged.

Superseding1461 receipt: actual-parent reconciliation/publication complete;
targeted45084a8b guard-equivalence review CLEAN and root finite-manifest acceptance
preceded serial runtime. Normal29 actual SDK cases PASS with real create/view,
nonempty own supplements and bounded artifact/inline signed PNG reads. Both
after-fixture/before-capture expectedexit1/exact2marker forced modes PASS after
full setup/eight uploads, exact owned teardown and full canonical closure.
Independent saved public/private/Storage/168/settings/cron/resource fingerprints
match before/after the run. Runtime/app/schema/native original proof bytes remain
unchanged in the final facts-only batch; final cumulative review/exactCI/mainmerge
pending. This is NOT authenticated appHTTP/browser/removal-race or phase-exit
evidence. Tests/Surveys/Grades groups below and later cutover gates still apply.

Final1461 receipt supersedes the pending state: exact reviewedff0a45a2 passed all
five CI37202212433 checks including PR Gate; normal squash7c8fd90e merged
2026-10-04T12:59:35Z. Reviewed/squash full-tree parity and clean canonical main
fast-forward verified;36 unrelated stashes and dependency worktrees retained.
No production, cohort, account, provider or billing activation. The next bounded
Tests slice is [owner Test detail GET](contextual-test-detail-read.md), using
existing shared admission and current owner-bound nested reads. Draft GET is
excluded because its ensure helper can create/repair a draft; its transaction
boundary belongs to subsequent owner authoring work. Source preparation and a
schema relationship map are not actual SDK evidence or a phase exit.

PR1468 now contains that owner Test detail GET. Its ba42f662 disposable run passed
eight actual SDK cases plus both full-setup forced teardown modes; separate saved
whole-canonical fingerprints match after every run. Initial/targeted source
reviews are clean, including copied-question/cache compatibility coverage.
Superseding1468 receipt: reviewed039642ac passed all five CI37211414037 checks,
including PR Gate, and normally merged902cbf76 at2026-10-04T15:36:48Z. Full-tree
reviewed/squash parity and clean canonical main fast-forward passed;36 unrelated
stashes and dependency worktrees remain. CI contract corrections preserve the
24-entry body-validation debt baseline and required production-history prefix;
final source/parity checks and targeted review are clean. No production,
migration, admission, account or provider action occurred. This completes only
owner Test detail GET; all broader Tests operations and phase-exit gates remain.

Current slice is [complete owner Test list GET](contextual-test-list-read.md),
preserving the full existing DTO and six statistics. Isolated source preparation
ran alongside1468 CI; current-owner/Test/current-enrollment statement binding,
complete bounded pagination and draft/document compatibility are source-tested.
PR1469's independently reviewed/accepted fixed `d82aa4e` passed eight actual SDK
cases and both full-setup forced cleanup modes. Exact receipts and the SAME saved
whole-canonical baseline match after every run; immutable001–246 were replayed
only in disposable projects. Earlier failures remain recorded, not relabeled as
passing runs. Final cumulative review, stable-head CI and normal main merge still
precede completion. No phase exit, home or cohort activation follows from this
slice, and no shared-local or production migration was applied.

Superseding1469 receipt: reviewed `e8906c29` passed all five ready-event checks in
CI37243490974, including PR Gate, and normally squash-merged `7570a9d6` at
2026-10-04T23:59:49Z. Exact reviewed/squash tree parity, linear parent and clean
canonical main fast-forward passed; all36 unrelated stashes and env link remain.
The earlier failed attempts and native receipts remain recorded. This completes
only owner Test list GET, not a phase exit or activation.

Superseding 2026-10-05 coordinator receipt: owner draft GET PR #1473 merged
as `6586847c1` after five exact-head CI37258057073 gates passed on reviewed
`f5ba277a5`. Normal installed-SDK/SQL/native proof, both full-setup forced cleanup
modes, genuinely generated contracts and unchanged canonical baseline passed.
Audit #1474 is merged as `5708750d0`, retaining its conflict fix at 248 and our
immutable GET at 247. Its separate production receipt records schema001–248;
this does not activate shared admission, home/page or full cutover.

Historical preparation was [owner Test draft saves](contextual-test-draft-save.md),
preparing only admitted PATCH with current-owner transaction/source/document CAS,
existing durable started-Test restrictions and literal legacy compatibility.
GET owns initialization/repair; a missing/invalid draft baseline requires reload
without partial PATCH writes. No Storage fallback or immediate deletion belongs
to this boundary. Coordinator begins on actual main `c25ebf78f`; source-only
workers own separate application, SQL and proof files. Full runtime evidence,
independent review and exact-head CI remain required. No goal or phase exit.

Superseding2026-10-06 receipt: #1480 reviewed `7fa6674c1` passed all five CI
37403984915 checks, including warning-free SQL lint and PR Gate, and normally
squash-merged `25457e2d1` at03:17:42UTC. Clean canonical main fast-forward passed;
all36 unrelated stashes remain. Corrected249 normal11, both forced cleanup modes,
genuine types and SAME whole-canonical equality passed. No canonical249 migration
application, production promotion or activation occurred. The next bounded slice
is [ordinary owner Test creation](contextual-test-create.md), not a phase exit.

Historical successor creation250 isolated acceptance on2026-10-06: exact59a4 normal3 and
both serial forced cleanup modes passed, with SAME whole immutable canonical B1
and byte-identical genuine CLI types. Earlier source-inventory failures remain
recorded; exact17-trigger closure corrected, not weakened. Final PR review/CI
remain pending in that earlier receipt. No canonical249/250 application, production act or activation.

Superseding2026-10-06: creation PR#1500 merged5bf3dbacc after all five exact-head
CI37422413824 checks passed on reviewed dba18a9e. Squash-tree parity and clean
canonical main fast-forward passed, preserving36 ordered unrelated stashes.
Next is [pristine Test draft discard](contextual-test-pristine-discard.md), not
general deletion. Clean reviewed5f5f097673c5 isolated normal proof and genuine
CLI types passed:18 SDK cases/20 RPC/0 Storage/6 pair removals,2 physically restored
privilege probes,56 rollback checks and14 contention schedules. Both serial
forced cleanup modes and SAME whole canonical equality passed. Final local
checks, independent integration review and reviewed-head PR Gate remain pending.
Canonical249–251 and all experience/billing activation remain held; real lifecycle
state profiles and other owner/learner operations still prevent phase closure.

Superseding2026-10-06: discard#1503 normally squash-merged865d837b7 after
reviewed9c39132d passed all five CI37435496517 checks, including the serial
normal/forced251 database profile and PR Gate. Canonical main cleanFF and36
ordered unrelated stashes were verified unchanged. Next is
[owner Test publication](contextual-test-publication.md): a dedicated dormant
POST publishes the current saved draft to closed, retaining the legacy PATCH
and UI byte-for-byte. HTTP/reader/SQL source-contract TDD186/4 passed. Native
fixture/SDK/SQL-race source was initially integrated with one existing engine, four
capability probes, unchanged budgets and separate committed-transition effects;
all author deliveries are frozen and root offline integration296/6 and109/3
checks pass, plus the additive shared180s race-clock test (native77/1).
At that historical pre-type checkpoint, SerialCI3 source checks passed, but genuine252
RPC generation, native proof, independent review and exact-head CI were unaccepted.
That sourcefreeze was not PR readiness.

Superseding2026-10-06: publication normal proof at735d6ab passed isolated001–252
replay,49 rollback contracts,12 held-lock schedules,five committed transitions and
ten actual installed-SDK cases (three exact closed publications,four restored
raw42501 probes,20 RPC/0 Storage). Genuine CLI types added only the seven-argument
252 declaration. Exact owned cleanup and a separate whole183-table/five-field B5
check passed; B1–B4 were retained without exemptions. Current-owner publication,
proof/migration/CI source bytes are unchanged after rebase onto2d89088cd.
Cumulative code/SQL/security review at9dcf0d2 was clean apart from stale pre-type
documentation. Combined focused777/30+policies/TypeScript/lint and fullcoverage
14229/8SKIP passed at9dc with unchanged thresholds. Serialforced cleanup,
documentation-correction review, stable exact-head CI/PR Gate and main merge
remain required; this is draft PR#1510, not rollout. Canonical249–252,
production promotion, admission/home/page/cutover and billing remain held.
No component receipt constitutes the Tests batch or access phase exit.

Superseding2026-10-07: publication#1510 merged473a5de8a after reviewed2f3e6d41
passed changed-base review, focused1304/44 and all five CI37564268228 jobs/PRGate.
Publication normal/forced transactions passed; squash-tree equality and clean
canonical main fast-forward preserved all37 ordered stashes. Canonical/local/prod
249–252 and all experience/billing activation remain held. Next bounded source
design is atomic current-owner Test-list reorder: preserve complete descending
presentation, including Blueprint-retired Test positions without content edits;
reject stale/incomplete current lists. Verify existing trigger/lifecycle policy
before implementation. No legacy reorder/UI adopter or phase exit is implied.
Source implementation is now prepared in the dedicated reorder checkout;
21 rollback and seven committed proof schedules are source-only. Initial source
reviews completed; cleanup-verification and budget-evidence fixes are in progress.
Native/types, final independent review and exact-head CI remain pending. Canonical/prod249–253
remain unapplied; see [reorder contract](contextual-test-reorder.md).

Superseding2026-10-08: owner approved the 1,000-Test atomic operating ceiling.
The new source rejects 1,001 request IDs and refuses a larger Classroom before
mutation, including partial-list and would-be no-op attempts. All existing data
is preserved; this is not quota enforcement, deletion or legacy UI adoption.
Current-main synchronization keeps quota253 disabled and resequences the dormant
reorder migration to254. Source-bound 999/1,000 success and 1,001 denial proofs
retain unchanged time/byte/action/rollback limits; historical failed10,000 runs
remain evidence, not new-cap acceptance. Independent source review, genuine CLI
types, actual finite native modes and exact-head CI remain gates. Canonical249+
and production/experience/billing/quota activation remain held; no batch exit.

Historical source preparation below predates that actual merge receipt:
[contextual owner Test draft GET](contextual-test-draft-get.md), including
its hidden create/repair behavior. Source preparation on main7570 uses a two-phase
service-only snapshot/CAS transaction, unchanged legacy dispatch and public DTO,
current owner/fixed-parent checks and explicit retired-Test inspection/write rules.
Additive247 is source only. Initial/targeted source reviews, normal finite native/SQL
proof, genuine isolated contracts, both forced cleanup modes and corrected full
coverage passed. Targeted/final review, exact-head CI and normal merge remain pending.
No shared-local or production migration, cohort, home, provider or billing action
is implied; other Test authoring and learner operations remain future slices.

Further batch-2 groups, in integration order: Tests owner operations then learner
participation/disclosure; complete
Surveys owner/member transactions; Gradebook/returned Grades; existing grading
entrypoint/job authorization and compatibility, without activating AI or billing.
Existing062/063 actor stamps do not constitute owner checks;143 participation also
needs owner precedence. Every nested read/page and response/history write must
bind the current relationship, resource and visibility at its own boundary.
Subscription-expiry existing-work protections require explicit integration with
the separately owned billing work; ordinary archive remains a participation denial.
Inactive/cold-archive/email/deletion policy remains future work.

This is a backend phase exit, not a full experience or production rollout. Local
001–238 remains immutable; production is last verified001–225, not freshly queried
for this checkpoint. Shared admission, page/home pilots and full cutover remain
OFF. No production promotion, plan/cohort mutation or billing/provider activation
is implied. The epic remains incomplete. The owner explicitly authorizes routine
in-scope work, local migrations, independent reviews and review extensions, and
normal main merges through cutover. Carry that authority forward without repeating
approval requests; retain original ledger clocks/counters, absolute review hard
caps unless directly waived, normal security/CI/release gates and required material
product decisions. The owner's later explicit task-stop/review-extension waiver
applies to this coordinator: preserve cumulative counters without repeatedly
requiring budget approval. It does not waive correctness, runtime limits,
production holds or material product decisions.

First batch2 receipt: PR1451 draft `9843ebe1` passed945 focused tests/68files and
both initial independent security/compatibility reviews. Its first actual local
normal run failed while exact whole-row cleanup passed; independent baseline3users/
1class/zero synthetic roots/guard168O is restored. No passing lifecycle is claimed.
One source-only proof correction retains087 return clearing/099 not-submitted400
and adds bounded safe diagnostics; transaction cleanup SQL and application code
are unchanged. Targeted fixed-source review precedes normal/two forced reruns,
then cumulative review and stable-head CI/merge. This does not close batch2.

Superseding1451 evidence atb09fb2e9: targeted security and final integration CLEAN;
948focused/68files+staticPASS. Actual normal and both intended forced modes restore
the exact whole-row baseline with zero residue/guard168O; final local238receipts/
3users/1class and Palcapture+scheduledOFF verified. ExactheadCI37154626010 failed
the new wrapper because the runner lacksrg; the PR returned to draft. A second
wrapper-only correction uses existinggrep while retaining exact marker/exit/privacy
checks; targeted review and new local/CI evidence precede merge. Earlier source/
runtime receipts remain historical, not CI or rollout approval. Original clocks,
counts and explicit extension authority persist; no permission or migration change.

Execution follows the table above: batch 1's backend is complete; finish batch 2's
assessment/grade integrations next. Batch 3
may run alongside independent batch-2 work only after concrete file/subsystem
ownership and dependencies are established. Batch 4's live consumer waits for
batches 1–3; batch 5 requires their full integrated rehearsal and an explicitly
authorized release. The separate billing task owns subscription implementation;
the separate Daily scrolling task owns its UI-only work. Do not duplicate either.

Each bounded implementation returns tests, real database evidence where required,
an exact reviewed SHA and merged-PR evidence before phase advancement. Use the
draft-first stable-SHA review budget with the owner's explicit extensions; stop for
a new material owner decision, authority outside the agreed scope or an absolute
review hard cap. Do not enable cohorts,
change account plans or deploy production merely because an individual slice passes.

### Current bounded integration slice — Assignment inline images

The 2026-09-27 source audit found that private inline-image delivery still branches
on the global account role, despite the gated contextual Assignment foundation.
The authorized next slice is relationship-aware image delivery and upload/finalization
lifecycle authorization. Implementation lives on `codex/contextual-assignment-images`;
this task coordinates integration and review, separately from billing.

Exit evidence: default-off exact-pair admission; unchanged unmatched legacy behavior;
complete managed object/document/assignment/classroom binding; mixed-role owner/member
tests; visibility, archive, enrollment-revocation and retry checks; transaction-time
authorization for writes; focused checks and independent security/compatibility review.
Any required migration application remains a separate exact-target authorization.

After the image boundary is verified, rehearse a restricted synthetic manual Assignment
flow (author/release, open/save/images, submit, inspect/manual grade/return, feedback).
Do not enable the unrestricted classroom page or Teaching/Joined home for that rehearsal:
their other reachable domains are not yet contextual. No cohort activation, production
deployment, AI enablement, signup change or billing work is included in this slice.

1. Establish baseline login, open-class, submission, grading and attendance canaries;
   capture the exact app/database versions and active rollout settings before each release.
2. Ship additive code and any separately reviewed additive schema first. Existing accounts,
   roles, ownership, enrollments, grades and sessions remain intact. Migration application
   is human-controlled under `schema-rollout-checklist.md`, with exact target/file permission.
3. Shadow mode logs sanitized decision/reason counters only, not classwork, codes or personal
   data. Old authorization remains authoritative. New authorization failing must not result
   in permissive fallback; define availability/recovery behavior before enforcement.
4. Pilot complete domains with test accounts, then one deliberately selected class outside
   teaching time. Monitor unexpected denials, login/submission errors and entitlement
   availability; predeclare stop thresholds and who can disable the rollout.
5. After mixed-role accounts or student-valued legacy accounts can own classes, an old
   teacher-only build is **not** a safe rollback. Keep a minimum compatible app release
   available; disable new signups/creation gates without stranding existing owners/members.
   Do not revert schemas or rewrite roles as an emergency shortcut.
6. Gradually expand only after canaries and metrics pass. Do not delete/reclassify current
   user or classroom data as part of the rollout. Destructive cleanup is a separate decision.

Phases 0 and the phase 1 observation slice add no migration and do not approve promoting main to production.
Other migration and release work retains its own rollout requirements and approval.
Check current rollout evidence and the full release diff before any deployment; do not
treat a migration status copied into this roadmap as authority.

## Acceptance matrix before enabling neutral accounts

- Existing teacher and student login/signup/reset sessions and current classes still work.
- One account owns A and joins B; managing B and submitting as a student in A are denied.
- Another authenticated account, another teacher, or a paying nonmember cannot read private
  classwork or forge role, subject, owner, enrollment or entitlement information.
- Every nested resource is bound to the authorized classroom; no ID substitution bypass.
- Code joins enforce enabled enrollment and join policy; invalid/revoked codes fail safely,
  duplicate joins are idempotent, own-class joins are rejected, guessing is rate-limited,
  and the current classroom-ID join path cannot bypass intended invitation requirements.
- Archived classes preserve ownership/history, deny member participation, and use explicit
  owner-only restore/lifecycle authorization. Storage/archive jobs remain tenant-scoped.
- Unknown feature/plan, malformed snapshot, expiry, quota exhaustion and unavailable grant
  source cannot silently enable a feature. Free students can still do assigned work.
- Exact time boundaries, UTC entitlement timestamps, atomic quota races and retry-safe
  consumption are tested. Classroom deadline calculations still use America/Toronto.
- Both roles plus mixed-role accounts pass desktop/mobile and light/dark visual verification
  under Pika's UI-change workflow before UI rollout.
- Disabling rollout and recovering the entitlement service are rehearsed on the minimum
  compatible build without losing work or leaving already-created classes inaccessible.

## Decisions still required before monetization enforcement

Prices, launch classroom limits, trial length and lifecycle rules are approved
in [subscription policy](subscription-policy.md). Remaining gates include measured
AI unit costs, once-per-teacher trial enforcement, deterministic activity ranking,
archive/completion/retention compatibility, tax configuration, refund entitlement
and dispute contracts, abuse limits and support authority. School/manual grant
precedence remains deferred. Product approval does not activate enforcement.
