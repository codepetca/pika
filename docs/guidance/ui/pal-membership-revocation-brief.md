# Pal membership revocation

Surface: the student Pal provider, achievement region and reward dialog.
Reference: the existing Phase2 Pal classroom fixture, governed Pal theme boundary,
and Pattern Lab controls, page states and modal owners. Baseline inspected at
localhost:3091/pattern-lab and /e2e-fixtures/pal-classroom on September13.

| Need | Existing candidate | Decision | Reason |
|---|---|---|---|
| Clear revoked provider data | Pal client and StudentPalExperience | extend | Existing membership and token owners |
| Dismiss stale reward | ModalLayer and Pal reward host | reuse | Existing focus, inertness and scroll behavior |
| Preserve layout | Current Pal surface and theme boundary | reuse | No visual pattern changes |

Role: student. Teacher n/a: this widget and token endpoint are student-only;
Pattern Lab teacher reference is inspected, but no teacher interface changes.
Viewports: desktop and mobile. Themes: light and dark. States: active, reward
open/pending, access revoked, delayed stale response, classroom switch, logout.
Primary signal: the revoked achievement/reward content disappears using the
existing empty/error state. Academic child state and focus remain usable.
Must not add: new controls, icons, dialogs, decorative treatments or cleanup claims.
Composite accessibility review: required for reward dismissal/focus restoration;
verify background inertness and scroll lock clear and academic input state survives.
No new shared primitive or Pattern Lab contract is introduced. No nearby duplicate
owner needs extraction for this change.

Verification: passed on September13 using synthetic local routes only. Eight
Playwright contracts passed (switch/logout/stale response and revocation in all
four viewport/theme projects). The45 focused browser-client/component/provider
unit tests pass; the actual PalClassroomFixture is covered by the component test.
The full focused source check passes66 files/605 tests plus architecture, UI/design
policies, TypeScript and lint. Pika audit passes.

Composite checklist reviewed: yes. Keyboard and semantic state covered: yes.
Escape initiates reward dismissal, revocation removes the pending dialog, focus
returns to a usable academic input, body scroll is restored, and no stale reward
or roadmap reappears. The academic input retains its value and DOM identity.
Manual follow-up: none for this UI matrix. Database and full integration review
are separate and still pending; these screenshots do not prove cleanup completion.

Evidence is in output/playwright/pal-phase3 with active, reward and revoked
captures for chromium-desktop, chromium-desktop-dark, chromium-mobile-light and
chromium-mobile-dark. Capture uses Playwright with animations disabled for stable
reward screenshots; animated intermediate frames were inspected and replaced.
Viewports are1440×900 and390×844; full-page captures can exceed viewport height.
Reference controls and modal behavior remain unchanged. No refactor or experimental
pattern promotion is needed.
