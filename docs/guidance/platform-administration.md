# Platform administration: proposed phased design

Status: proposed for owner review, 2026-09-25. A fictional UI prototype is
implemented for review; live authorization and plan operations are not approved
by this document. Coordinator: Codex task
`01a0d8f5-aa5b-7643-8357-40883f4193cc`; branch
`codex/platform-administration-design`. The persistent goal is active.

## Outcome and verified baseline

Let explicitly authorized operators inspect accounts and change account plans
through audited server operations. Platform authority is independent of
`users.role`, Classroom ownership/enrollment, and Free/Basic/Plus/Pro.

Source reviewed at `74648fd8b384b4e4f9462ad5b7bd6befe1735a7a`, freshly fetched
`origin/main`. The fetched production branch is
`42478978848e2e1477ae3b132925eb5ee93ec0e7`; a Git branch is not deployment evidence.
No platform-admin route, membership model, or application caller of
`set_account_plan_v1` was found.

Migration 206 supplies a service-only setter, operation-ID replay, expected plan
revision, and atomic plan plus creation-entitlement audit. Limits are 0/2/5/10.
It does not authorize a human operator: `actor_ref` is trusted caller input.
It also does not activate strict creation, billing, or AI allowances.

`src/lib/auth.ts` resolves opaque, hashed server sessions and current user
credential versions. `src/lib/auth-session-policy.ts` allows 180-day ordinary
sessions. These are useful identity foundations, but are not sufficient proof of
recent privileged authentication. No admin elevation contract exists.

Live Supabase verification was attempted; the connector returned
`USER_NOT_LOGGED_IN`. The dispatch's two provisional production assignments,
older zero-capacity grants, migration-206 application, and strict-off setting
remain **reported, not freshly verified**. `.ai/CURRENT.md` records production
through 205; preserve the discrepancy until target-bound read-only verification.
Neither account classification nor production readiness may rely on those reports.

## Proposed authority and session design

- Store service-only operator membership with explicit capability grants,
  active/revoked state, optional expiry, revision, and immutable grant/revoke
  history. Start with `accounts.read`, `plans.read`, and `plans.change`;
  never a wildcard or authority inferred from email, role, or subscription.
- Initial inventory capability covers minimal account/plan metadata across the
  platform; that visibility itself requires explicit approval. Mutation grants
  initially require an exact target-account allowlist. No grant-management UI,
  self-grants, impersonation, or self-plan changes in this release. Bootstrap and
  recovery remain separately authorized operator procedures.
- Every page load, read endpoint, and mutation calls a server-only guard, using
  current membership, capability, target scope, live session, and elevation.
  Navigation visibility is never an authorization boundary. Missing schema,
  malformed evidence, revoked access, or unavailable authorization denies access.
- Keep ordinary login unchanged. Add revocable admin elevation bound to the
  exact base session and credential version; never accept browser-supplied
  authentication timestamps, actor identity, assurance, or capabilities.
  Persist a distinct server-only elevation record referencing the hashed base
  session, membership revision and verified assurance. Authentication challenges
  are one-use; elevation validation and activity timestamps are server-owned.
  Base-session revocation makes any associated elevation unusable immediately.
  Proposed limits: 15-minute idle timeout, 60-minute absolute elevation lifetime,
  and authentication within five minutes for a write. Renewal requires verified
  authentication; ordinary session restoration does not refresh elevation.
- Recommend verified MFA before any production admin access. Provider-backed
  assurance must be proven on Pika's actual authentication path; email verification
  or a magic link alone is not MFA. Provider/method selection is a phase-1 exit
  decision, not permission to switch the application's authentication provider.
  If that proof is unavailable, production administration remains disabled.
- Logout, credential reset, operator revocation, capability/scope changes, and
  elevation expiry invalidate admin use. Concurrent revocation must serialize
  with privileged writes: a write already authorized under the shared lock may
  finish first; once revocation commits, subsequent writes must fail.

## Delivery phases and exit gates

| Phase | Deliverable | Required exit evidence |
| --- | --- | --- |
| 0 — Review | This design, threat model, minimal fields, session policy, and authority boundaries | Owner approves the design and next slice; unresolved production facts stay explicit |
| 1 — Authorization | Additive service-only membership/capability and elevation contracts, grant/revoke audit, centralized server guard; no operator seeded | Unauthorized/expired/revoked/malformed cases, reset/logout and concurrency tests; authentication assurance method resolved; reviewed fixed SHA; any database application separately authorized |
| 2 — Inventory | Read-only account search/detail and plan/grant discrepancy view behind an independent default-off read gate | Exact subject binding, narrow fields, bounded pagination/rate limits, private no-store responses and read audit; both role-valued operators and unauthorized roles tested; desktop/mobile/light/dark visual verification |
| 3 — Plan changes | Preview and explicit confirmation for one account, narrow server endpoint, transactional authorized wrapper around migration 206 | Revision/replay/scope/audit/concurrency/rollback matrix passes; default-off write gate; no batch or automatic classification |
| 4 — Rollout | Target-bound inventory, bootstrap/revoke procedures, staged operator canary, rollback drill and operations guide | Separate exact migration, deployment, live membership, target-plan-write and activation approvals; teacher/student canaries; explicit merged/deployed/enabled ledger |

Each approved slice uses one owner and bounded workers in this task. Run the
startup environment check before code edits. Follow focused checks, draft PR,
risk-matched independent review, batched remediation, stable reviewed SHA,
and `PR Gate`; merge requires normal authority. New schema numbering is selected
against current main. UI work first records approved references and
reuse/extend/create choices through the Pika UI-change skill and `/pattern-lab`.
This proposal does not constitute that later UI implementation brief.

## Admin prototype UI brief (2026-09-25)

Surface: development-only `/pattern-lab/admin-prototype` with account inventory,
detail, plan preview, and audit-history screens. Reference: `/pattern-lab`
canonical Page, Card, Button, FormField, and DataTable examples; Attendance is
the approved compact-table reference. Affected role: `n/a` because the prototype
uses fixed fictional accounts, with no teacher/student session or production
admin identity. Verify desktop and mobile, light and dark, plus list, search,
selected detail, preview, and blocked confirmation states. Primary signal:
semantic border/surface hierarchy with the blue action accent. Do not add a
live admin route, real account data, role-dependent controls, or a functional
plan writer. Composite-widget accessibility review: yes for screen navigation;
use ordinary buttons/links where possible and avoid a new composite widget.

| Need | Existing candidate | Decision | Reason |
| --- | --- | --- | --- |
| Page framing | `PageLayout`, `PageHeading`, `PageContent` | reuse | Own width, heading and content rhythm |
| Inventory table | `DataTable` and `TableCard` | reuse | Compact scannable rows with shared semantics |
| Filters and plan choice | `FormField`, `Input`, `Select` | reuse | Shared labels, focus and touch targets |
| Detail and preview surfaces | `Card`, `Button` | reuse | Existing surface and action hierarchy |
| Admin prototype composition | Pattern Lab fixture pages | create | Experimental, domain-only arrangement; no shared primitive contract |

This composition remains experimental and requires human review before any live
admin UI adoption. No change to stable UI guidance or Pattern Lab primitives.
The prototype is implemented at `/pattern-lab/admin-prototype` with four fixed
`example.invalid` accounts. It is gated by the same non-production,
`ENABLE_UI_GALLERY` rule as Pattern Lab and its confirmation action is disabled.
No account, authentication, or plan API is called. Anyone with access to an
enabled non-production gallery can inspect the fictional prototype.

Visual verification: Playwright captured list, detail, activity, and preview
at 1440×900 and 390×844 in light and dark modes, including a downgrade warning
and disabled confirmation. The mobile list was revised to keep each account's
View action visible. Final browser checks found no page overflow at either
viewport and no console errors. Teacher/student perspectives are `n/a` because
the prototype has no role-specific state. Captures are local under
`output/playwright/admin-prototype-*.png` and are not production evidence.
Composite-widget checklist reviewed: yes. Screen navigation uses ordinary
buttons with `aria-current`, keyboard Tab/Enter behavior from native controls,
and visible shared focus styles; the Select uses the canonical control. Screen
changes move focus to the destination heading. Tests cover labeled fields,
selection, disabled confirmation, active navigation semantics, and focus
transfer. This prototype does not create a tab widget.

### Classroom-shell revision brief (2026-09-25)

Surface: the same development-only prototype. The explicit reference is the
teacher classroom shell (`AppShell`, `ThreePanelShell`, `LeftSidebar`,
`MainContent`, and the classroom `NavItems` visual treatment), with the
`/pattern-lab` controls above as component evidence. The regular teacher
classroom is the approved shell reference; the admin information architecture
remains experimental. Roles are `n/a` because this fixture does not represent
an authenticated teacher, student, or operator. Verify desktop (1440×900) and
mobile (390×844), light and dark, with expanded/collapsed left navigation,
mobile drawer, selected section, account detail, preview, and disabled
confirmation. The primary signal is the classroom sidebar's selected surface
and compact header. Do not add real account reads, administration controls,
authorization claims, or live writes. Composite-widget review: yes for the
mobile drawer and section navigation; reuse the shell's drawer/focus behavior
and ordinary section links.

| Need | Existing candidate | Decision | Reason |
| --- | --- | --- | --- |
| Header and content grid | `AppShell`, `ThreePanelShell`, `MainContent` | reuse | Matches the classroom geometry and responsive framing |
| Sidebar and mobile drawer | `LeftSidebar`, `ThreePanelProvider` | reuse | Preserves classroom collapse, focus, and drawer behavior |
| Admin section items | classroom `NavItems` treatment | create | Admin labels and screens are fixture-specific; no durable shared navigation API yet |
| Compact cards, table and forms | Existing `@/ui` owners | reuse | Same controls and density as teacher work surfaces |
| Mobile sidebar label | `AppShell`/`AppHeader` | extend | Lets non-classroom consumers name the existing menu accurately |

The sidebar offers Overview, Accounts, Activity, and Plans; account detail and
plan preview remain nested Accounts states. No new stable UI guidance or shared
component is proposed. A future real admin route can justify a shared nav
extraction once its authorization and URL contracts are approved.

Visual verification passed against the classroom shell at 1440×900 and
390×844. Playwright captures include expanded and collapsed desktop navigation,
the mobile drawer, Accounts, Activity, Plans, and a full-height plan preview in
both themes under `output/playwright/admin-prototype-*-v2.png`. The mobile
drawer closes after section selection and focus moves to the new heading.
Neither viewport overflowed horizontally; the browser reported no errors.
Teacher/student role checks remain `n/a` because this route renders the same
fictional content without either session. Composite checklist reviewed: yes;
keyboard navigation uses native section buttons, drawer Escape/focus behavior
comes from `LeftSidebar`/`ModalLayer`, active section uses `aria-current`, and
focused tests cover selection, drawer closure, heading focus, and disabled
confirmation. No manual accessibility follow-up remains for this prototype.

## Inventory and mutation contract

Inventory returns account UUID and the minimum identity needed to distinguish
accounts, current plan/revision or explicitly unclassified, creation-grant
source/enabled/limit/validity/revision, active owned-classroom count, parity status,
and a bounded audit summary. Review identity fields before implementation. Do not
include student work, grades, passwords, session tokens, unrelated feature data,
or unrestricted exports. Do not silently label an unclassified account Free.
Proposed first search supports only an exact account UUID or complete normalized
email, with no wildcard/substring queries. A separately explicit list action
returns at most 25 minimal summaries per page through validated cursors, within
the approved read scope. Select and test numerical rate limits before phase 2
exits. Neither list nor search widens the mutation target allowlist.

Preview binds the exact subject, observed plan and grant revisions, requested
plan, derived limit, and above-limit impact. Any changed preview evidence
requires refresh and confirmation. Existing classes remain usable after a
downgrade; new active-classroom consumption can stop immediately even while
strict creation is off. Plan/grant drift blocks ordinary changes pending
explicit reconciliation rather than silently overwriting a manual grant.

The server accepts only subject, approved plan enum, expected revision,
operation ID, controlled reason code, and the preview-binding evidence. It
derives the actor from the verified session. Require same-origin POST and a
session-bound CSRF token, strict payload validation, request size limits and
operator/target rate limits. Do not add an arbitrary RPC/table-operation proxy.

A new service-only wrapper must validate live session/elevation, membership,
capability and subject scope **inside the same transaction** as the setter,
including on replay. Share deterministic authorization/revocation and plan/grant
locks; verify the lock order against migration 206 and the older entitlement
setter. After current authorization, resolve an existing operation receipt first:
an identical retry returns its original receipt without requiring its old preview
to match today's state. For a new operation, validate observed grant drift under
that fence before delegation. The
existing setter remains the sole plan/quota writer; preserve its provisioning
and operator contracts rather than editing deployed migration 206.

Store a durable operation receipt linking verified actor, subject, session
reference (not token), capability revision, reason, request fingerprint and the
plan/grant audit revisions in the same transaction. Failure to write mandatory
audit rolls back the change. Log denial events separately from rolled-back
transactions with minimal metadata. Table ACLs/RLS deny browser access; immutable
means protected against application roles, not a promise against the database
owner or compromised service credentials.

Retry a timeout with the identical operation ID and semantic request. A stale
revision or reused key with different inputs is a conflict; never manufacture a
fresh ID automatically to force success. A replay receipt describes the original
operation, which may no longer be the current plan; fetch current state separately.
Reauthentication may bind a new live session to the same actor's retry without
changing the semantic fingerprint or losing original actor evidence.

## Threat model and acceptance tests

| Threat | Boundary and required negative test |
| --- | --- |
| Teacher, student or paying account escalates | No membership means no inventory or mutation, for every role and plan; forged browser claims cannot grant authority |
| Read operator substitutes another account or writes | Separate capability and target checks; path/body/preview/receipt subject mismatch fails; allowed target A cannot authorize target B |
| Stolen/stale session or revoked operator | Live session plus short elevation and verified assurance; reset/logout/revocation/expiry before request and racing a write deny at the defined boundary |
| CSRF, enumeration, cache or audit leakage | Cross-origin/missing-token writes fail; unauthorized reads return no account evidence; sanitized logs, pagination limits, no shared caching or browser table/RPC access |
| Lost response, duplicate click or concurrent edits | Identical replay produces one effect/audit; changed request conflicts; concurrent same-revision writes have one winner; revoked actor cannot replay a receipt |
| Plan/grant drift or partial audit | Grant-only changes invalidate preview; malformed results fail closed; injected audit/setter failures roll back plan, grant and receipt together |
| Downgrade harms teaching | Above-limit downgrade preserves ownership, classes, enrollment and work; creation/restore/transfer obey limits; teaching, submission, grading and attendance canaries pass |
| Operator mistake or compromised application service | One-account scope, preview, reason and immutable history limit mistakes; no broad operational console. Service compromise remains a separate infrastructure trust risk |

Use meaningful route/service tests plus database privilege, rollback and
multi-connection race contracts; source-text migration tests alone are insufficient.
Fixtures are synthetic. Any test that applies migrations or writes to a shared
database still requires the repository's exact target/migration authorization.

## Operations, recovery and remaining decisions

Record environment, deployed app SHA, schema history, gate states, expected
operator/target scope, canary evidence, and approved operation privately before
activation. First enable reads only; enable writes later for one approved operator
and target. A code merge grants no runtime authority. Bootstrap requires the
exact local user UUID, target, capabilities, scope, expiry and approving owner;
never resolve admin authority automatically from an email address.

Stop on unexpected access, missing audit, parity drift, target/version ambiguity,
or loss of teaching access. Disable writes first, revoke affected elevation or
membership, and reconcile operation receipts before retrying. Correct a mistaken
plan with a new audited setter operation and fresh expected revision. Do not
delete history, restore an old revision number, archive classrooms, or roll back
the schema. Accounts previously lacking a plan cannot simply be restored to
"unmanaged" through this setter; recovery needs an explicitly approved plan or
separate reviewed forward design. Keep the minimum compatible application build.

Owner decisions: approve the phase sequence; approve the proposed MFA/session
policy and minimal cross-account inventory scope; select the verified MFA path
before phase 1 exits. Approving a design/slice does not approve dependencies,
migration application, deployment, live grants, plan assignments or production
activation. Future controls require separately named capabilities and threat
review; no billing, AI allowances or strict-creation switch in this console.

Current delivery: design proposal plus fictional UI prototype, pending owner
review. No live authorization, inventory API, or plan-change endpoint exists;
no schema was applied, live grant/plan changed, or production admin gate enabled.
The prototype component has focused interaction tests and passes the repository
focused check. Next action: review the design and screens, then implement only
the approved authorization slice. Production facts remain blocked on
authenticated, target-verified read access.

A bounded independent source/proposal review informed the elevation and search
requirements. Coordinator verification rejected one incorrect review finding:
migration 181 enforces existing grants while strict mode is off; strict mode
controls the missing-grant compatibility path. This design has not undergone
implementation or production-readiness review.

References: [plan foundation](account-plan-foundation.md),
[plan rollout](account-plan-rollout.md),
[Classroom access roadmap](classroom-access-and-entitlements-roadmap.md),
[schema authorization](schema-rollout-checklist.md),
[development workflow](../dev-workflow.md).
