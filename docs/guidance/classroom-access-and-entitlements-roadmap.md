# Classroom access and entitlements

Status: approved direction; **phase 0 foundation only** in this change. This is a roadmap,
not a statement that neutral accounts, subscriptions or new permissions are live.

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

- Start teacher-first: students can join and complete assigned work without buying a
  plan. Classroom capabilities are funded by the owner, not by each student's plan.
- Launch a useful Free tier and one paid teacher tier first. Plus/Pro are product labels,
  not authorization roles. Add a second paid tier only when it has a distinct offering.
- Charge for demonstrated teacher value: advanced workflows and higher allowances for
  expensive features such as AI grading. Set actual prices, included features and quotas
  after measuring usage and delivery costs; none are hardcoded by this foundation.
- Model trial/active/expired/canceled/grace states separately from plan names. An
  "expired free plan" should normally mean an expired trial or promotional grant; a
  baseline Free tier need not expire. Cancellation need not imply immediate expiry.
- Expiry must not change ownership, delete classwork, or make students purchase access.
  Preserve access to existing work and a workable submission path. Restrict paid/new
  consumption rather than abruptly interrupting an active class. Exact grace periods,
  downgrade behavior for over-limit classrooms, exports and retention need explicit
  approval before enforcement; this is not a promise of indefinite free storage.
- Manual/school-sponsored grants can fit the same capability contract later. Defer school
  sales, organization administration, co-teachers, and a general billing framework.

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
| 0 — Dormant contracts (this PR) | Roadmap; read-only relationship resolver; pure permission and effective-entitlement decisions; legacy creation policy; tests. No live consumers. | Existing behavior unchanged, no schema changes, static/test gates and independent review. Small implementation, security-sensitive contracts. |
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
- These modules have **no live imports**. No endpoint, UI, session, database policy,
  attendance entitlement, dependency, signup flow or payment provider changes here.
- A pure quota check is not a reservation. Do not wire it to paid/expensive work until a
  transactional, idempotent reservation/settlement design prevents concurrent overspend.
  Mutations also need transaction-time ownership/archive/resource checks to avoid races
  between the read-only resolver and the write.

## Safe rollout while real classes continue

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

This PR adds no migration and does not approve promoting current main to production.
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

Creation eligibility at first public launch; free/paid feature matrix and plan names;
pricing and measured unit costs; trial length and nonpayment/cancellation/grace behavior;
over-limit downgrade handling and archive/export/retention promises; school/manual grant
precedence and revocation; abuse limits and support override authority. Keep these out of
hardcoded role checks and do not infer approval from the phase 0 implementation.
