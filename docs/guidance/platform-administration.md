# Platform operations: read-only proposal

Status: product direction updated 2026-09-25. Tier assignment and entitlement
changes are assumed to be automated. The admin prototype is a fictional,
development-only exploration of operational visibility, not a live control
surface. The earlier manual plan-change proposal is superseded by this document.

## Purpose and boundary

The console helps an authorized operator answer three questions: what state is
an account in, what did automation do, and which failed or inconsistent outcomes
need investigation? It does not assign tiers, edit grants, retry jobs, impersonate
users, or act as a billing console. Routine tier and entitlement work belongs to
the automated system. If support can answer these questions with existing tools
and exception volume is low, a dedicated admin product may not be needed.

No live admin route, operator membership, or account inventory API currently
exists. Migration 206 provides a service-only plan setter and audit foundation;
it does not authorize a human UI. Production schema and account state reported
in earlier planning remain unverified: the authenticated Supabase read attempt
returned USER_NOT_LOGGED_IN, while .ai/CURRENT.md records production through
205. A Git branch or prototype is not deployment evidence.

## Proposed information architecture

| Screen | Question answered | Prototype content |
| --- | --- | --- |
| Overview | Is the automated system healthy, and what needs attention? | Small fixture summary, recent events, exceptions |
| Accounts | What is this account's current observed state? | Minimal search/list, read-only detail, current tier and entitlement as context |
| Exceptions | Which outcomes need investigation? | Pending retry and discrepancy examples with evidence and system response |
| Activity | What happened and when? | Chronological automation events with account and outcome |

Tier is an account attribute, not a navigation destination or operator action.
An exception detail may point to the affected account and event. The prototype
must never imply that an operator can fix a tier by choosing a new plan.

## UI change brief

Surface: development-only /pattern-lab/admin-prototype. Reference: the regular
teacher classroom shell (AppShell, ThreePanelShell, LeftSidebar, MainContent)
and the existing Pattern Lab Card, Button, Input, Select, PageHeading, and
DataTable owners. Roles: teacher/student n/a because this fixture has no role
session; the same fictional content renders for both. Viewports: 1440x900 and
390x844. Themes: light and dark. States: overview, filtered/empty accounts,
account detail, exceptions, exception detail, activity, collapsed rail, and
mobile drawer. Primary signal: the selected classroom-style sidebar surface
and precise status text. Do not add live reads, writes, editable tier controls,
new shared UI owners, or claims that sample metrics are production data.
Composite-widget review: yes for shell navigation and mobile drawer; reuse
native buttons and the shared drawer focus contract.

| Need | Existing candidate | Decision | Reason |
| --- | --- | --- | --- |
| Header, grid, sidebar, mobile drawer | AppShell, ThreePanelShell, LeftSidebar, ThreePanelProvider | reuse | Already own classroom geometry, responsive navigation, and focus |
| Page, cards, table, filters, status | Existing @/ui owners | reuse | Governed spacing, touch targets, and semantic tokens |
| Operations content and fixture events | AdminPrototype feature component | create | Experimental domain composition with no shared contract |

The prototype stays behind the non-production ENABLE_UI_GALLERY gate and uses
only fixed example.invalid identities. It does not call an account, plan,
billing, or authentication API. Visual evidence is local under
output/playwright/admin-prototype-*.png.

Visual verification: the read-only revision was checked in Playwright at
1440x900 and 390x844, in light and dark themes. Captures under
output/playwright/admin-operations-*.png cover overview, account inventory,
account detail, exception list and detail, activity, and the mobile drawer.
The mobile exception title was adjusted to wrap instead of truncating.
Browser inspection found no horizontal overflow at 390px and no console
errors. Teacher/student views are n/a because the prototype is the same
session-free fictional fixture for either role. Section changes focus the
new heading and reset scroll to the top; the existing drawer supplies Escape
and focus-return behavior. Focused interaction tests cover navigation,
filtering and empty results, the exception-to-account path, the absence of
tier controls, mobile drawer closure, and sidebar cookie isolation.
Composite-widget checklist reviewed: yes; keyboard behavior covered: yes,
using native section buttons and the existing drawer (Playwright confirmed
Escape closes it and returns focus to the trigger); semantic state covered
by tests: yes; remaining manual follow-up: none for this prototype.

## If a live read-only slice is approved

Cross-account visibility still requires explicit authorization independent of
teacher/student role and subscription tier. Start with a narrow accounts.read
capability, active/revoked membership, explicit scope, and an audited server
guard. The exact authentication assurance method and inventory scope need owner
approval before implementation. Missing or malformed membership denies access.
Navigation visibility alone never grants authority.

Return only the identity and account/automation metadata needed for support.
Do not expose student work, grades, passwords, tokens, or unrestricted exports.
Use bounded pagination, exact-identity search, private no-store responses,
read audits, and rate limits. Distinguish loading, empty, failed, and forbidden
states. An unclassified account is not silently Free. A discrepancy is evidence
for investigation, not authority to overwrite an automated entitlement.

No migration, live grant, deployment, or production gate is authorized by the
prototype. Any future manual recovery action needs a separately approved
problem statement, capability, audit design, and safe operational procedure.

References: [plan foundation](account-plan-foundation.md),
[plan rollout](account-plan-rollout.md),
[Classroom access roadmap](classroom-access-and-entitlements-roadmap.md),
[schema authorization](schema-rollout-checklist.md),
[development workflow](../dev-workflow.md).
