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

| Account plan | Active owned classrooms | Other agreed direction |
| --- | ---: | --- |
| Free | 0 | May join classrooms |
| Basic | 2 | Core teaching tools; no included AI grading |
| Pro | 5 | Candidate 300 AI grading runs/month; validate costs |
| Max | 12 | Candidate 1,000 AI grading runs/month; validate costs |

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
No source ownership is transferred. Member read receipts follow. Shared
admission and product cutover stay dormant.

Superseded by PR1438 normal squash merge875316af on2026-10-03: final cumulative
and targeted documentation review clean, four targeted tests/245focused pass;
exact-head CI37114898975 passes all five gates on b4eb9801. Canonical main cleanly
fast-forwarded; source/local232 immutable, production unchanged. Next bounded slice
is transaction-safe member mark-all-announcements-read POST. Owner/member global
roles remain separate from classroom permissions; full five-batch cutover is held.

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

Member receipt implementation is now prepared separately on
`codex/contextual-announcement-member-receipts`; see
[its atomicity contract](contextual-announcement-member-receipts.md). Proposed233
has passed a definition-only rollback rehearsal, not an application or PR review.
The shared classroom experience remains dormant.

Execution follows the table above: finish batch 1's teacher Daily reads and other
everyday operations first; then batch 2's assessment/grade integrations. Batch 3
may run alongside independent batch-2 work only after concrete file/subsystem
ownership and dependencies are established. Batch 4's live consumer waits for
batches 1–3; batch 5 requires their full integrated rehearsal and an explicitly
authorized release. The separate billing task owns subscription implementation;
the separate Daily scrolling task owns its UI-only work. Do not duplicate either.

Each bounded implementation returns tests, real database evidence where required,
an exact reviewed SHA and merged-PR evidence before phase advancement. Use the
draft-first stable-SHA review budget; stop for a required owner decision, migration
authorization, release authority or exhausted review budget. Do not enable cohorts,
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
