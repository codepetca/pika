# Contextual classroom Pal selection

Surface: existing server-rendered classroom member page and optional Achievements
availability. This is a permission selection change, not a layout or widget redesign.
Reference: the governed Pika-to-Pal boundary in `DESIGN.md`, existing
`StudentPalExperience`, and the approved classroom Pal phase-2 brief. Pattern Lab's
existing Controls/dialog and PageState owners remain executable shared references;
no control, layout, status or reusable component contract is changed.

| Need | Existing candidate | Decision | Reason |
| --- | --- | --- | --- |
| Academic page and optional Achievements tab | ClassroomPageClient | reuse | Keep existing teacher/member presentation and unavailable-tab redirect |
| Membership-scoped provider | StudentPalExperience | reuse | Retain scope remount, revocation and academic-state isolation |
| Pet, rewards and accessible overlay | Published Pal widget, theme boundary and ModalLayer | reuse | No art, interaction, keyboard, focus or overlay change |

Primary signal: only the actual current member's classroom progression is
available. An enrolled owner remains an owner. An admitted teacher-valued member
must not be offered account-level Achievements when only the legacy student layout
could provide it. Student-valued legacy account-Pal remains unchanged.

Roles: both historical account labels as current member; both labels as owner;
ordinary teacher/student legacy regression. Viewports: desktop1440x900 and
mobile390x844. Themes: light and dark. States: active scoped membership, denied/
revoked membership, classroom Pal disabled, legacy account path and ordinary
academic page. Reuse the existing intercepted local Pal browser fixture and exact
local badge assets; no real provider mint, ingestion or asset fetch is authorized.

Exclusions: no rollout/page/admission activation, new controls, copy, icons, quota
notice, shell changes, provider provisioning, settings or new visual pattern.
Composite review: existing reward/focus/Escape behavior is unchanged; retain the
existing semantic/keyboard regressions. No nearby duplication justifies extraction.
Focused SSR and browser/visual results must be recorded before readiness.

Visual composition: temporarily extend the existing development-only Pal fixture to mount
the actual `ClassroomPageClient` and existing provider with fixed SSR-result
props. Capture both historical roles as owner/member, scoped/unavailable/account
and ordinary legacy states at both viewports/themes. This verifies production
renderers, not a lookalike page; it does not claim authenticated route or live
provider proof. Pair it with the focused SSR selection tests and separately
accepted actual native permission/identity proof. The exact temporary fixture
sources and capture manifest are retained in private coordinator evidence; the
existing public widget fixture is restored unchanged, avoiding an unrelated
permanent full-page fixture bundle. No real account/provider traffic, server
admission or production fixture exposure is enabled.

Verification2026-10-19: forty actual-renderer screenshots cover ten fixed cases
at1440×900/390×844 and light/dark, with reduced motion. Both account labels are
members with scoped Pal, unavailable Pal and account-only Pal, and owners;
ordinary legacy teacher-owner/student-member cases are included. The coordinator
inspected every image: expected navigation/availability, legible hierarchy and no
horizontal overflow.221 synthetic intercepted requests, zero unexpected requests,
page errors or console errors. Existing eight widget captures separately cover
revocation and academic draft/focus retention.27 focused SSR tests prove selection
and no legacy fallback. Authentication, live provider delivery and rollout are
not asserted by these visual fixtures.
